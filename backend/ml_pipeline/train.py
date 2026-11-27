"""
Pipeline de entrenamiento ML sobre Cloud Firestore — Metodología CRISP-DM.
Separado de la API FastAPI (ejecución offline desde CLI o tarea programada).

Mejoras integradas:
- Extracción desde Cloud Firestore + snapshot CSV local en `storage/cache/` (ahorra cuota Spark).
- Variables del Calendario M07 (`es_feriado`, `es_dia_especial`, `es_cierre`) sin fuga de futuro.
- Métricas completas de evaluación: MAE, RMSE y R² (`r2_score`) frente a baseline.
- Publicación de versión y métricas en la colección `ml_model_versions` de Firestore.
"""
import logging
from datetime import date
from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from app.db.collections import (
    CONSUMPTION_DAILY,
    ML_MODEL_VERSIONS,
    OPERATION_EVENTS,
    apply_filter,
)
from app.db.firestore_client import get_firestore_client
from app.db.models import now_utc
from app.ml.features import (
    FEATURE_COLUMNS,
    VALIDATED_STATUSES,
    attach_calendar_features,
)

logger = logging.getLogger(__name__)

MODELS_DIR = Path("storage/models")
CACHE_DIR = Path("storage/cache")
MIN_TRAINING_SAMPLES = 60  # Días mínimos de consumo real validado
SPLIT_RATIO = 0.8  # 80% entrenamiento, 20% prueba temporal (sin barajar)


def extract_training_data(
    db: Any,
    item_id: str,
    branch_id: Optional[str] = None,
    save_cache: bool = True,
) -> pd.DataFrame:
    """
    Extrae consumo real validado (`medido` o `calculado_validado`) desde Cloud Firestore
    y lo enriquece con los eventos del calendario operativo (`operation_events`).
    NUNCA utiliza registros `desconocido` ni datos sintéticos.
    """
    q = apply_filter(db.collection(CONSUMPTION_DAILY), "item_id", "==", item_id)
    if branch_id:
        q = apply_filter(q, "branch_id", "==", branch_id)

    rows = []
    for doc in q.stream():
        d = doc.to_dict() or {}
        if d.get("status") not in VALIDATED_STATUSES:
            continue
        qty = d.get("quantity_base")
        if qty is None or not d.get("consumption_date"):
            continue
        rows.append({
            "ds": d["consumption_date"],
            "y": float(qty),
            "branch_id": str(d.get("branch_id", "")),
        })

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df["ds"] = pd.to_datetime(df["ds"])
    df = df.sort_values(["ds", "branch_id"]).reset_index(drop=True)

    # Extraer eventos del calendario M07 para las sucursales presentes
    ev_query = db.collection(OPERATION_EVENTS)
    if branch_id:
        ev_query = apply_filter(ev_query, "branch_id", "==", branch_id)
    events = [doc.to_dict() or {} for doc in ev_query.stream()]
    df = attach_calendar_features(df, events)

    if save_cache:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file = CACHE_DIR / f"train_item_{item_id}_b_{branch_id or 'global'}.csv"
        df.to_csv(cache_file, index=False)
        logger.info("Snapshot de entrenamiento guardado en %s (%d filas).", cache_file, len(df))

    return df


def build_features(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, pd.DataFrame]:
    """
    Construye matriz X (10 features), vector y y DataFrame alineado SIN filtración de futuro.
    Si hay múltiples sucursales en `df`, calcula lags y rolling por separado dentro de cada
    sucursal para evitar fuga entre sucursales, luego ordena cronológicamente por fecha `ds`.
    """
    work = df.copy()
    work["ds"] = pd.to_datetime(work["ds"])

    for col in ("es_feriado", "es_dia_especial", "es_cierre"):
        if col not in work.columns:
            work[col] = 0

    def _compute_group_lags(g: pd.DataFrame) -> pd.DataFrame:
        g = g.sort_values("ds").reset_index(drop=True)
        g["dow"] = g["ds"].dt.dayofweek
        g["month"] = g["ds"].dt.month
        g["lag_1"] = g["y"].shift(1)
        g["lag_7"] = g["y"].shift(7)
        g["lag_14"] = g["y"].shift(14)
        g["rolling_7"] = g["y"].shift(1).rolling(7).mean()
        g["rolling_30"] = g["y"].shift(1).rolling(30).mean()
        return g

    if "branch_id" in work.columns and work["branch_id"].nunique() > 1:
        parts = [_compute_group_lags(g) for _, g in work.groupby("branch_id", sort=False)]
        work = pd.concat(parts, ignore_index=True)
        work = work.sort_values(["ds", "branch_id"]).reset_index(drop=True)
    else:
        work = _compute_group_lags(work)

    work = work.dropna(subset=FEATURE_COLUMNS + ["y"]).reset_index(drop=True)

    X = work[FEATURE_COLUMNS].astype(float).values
    y = work["y"].astype(float).values
    return X, y, work


def train_and_evaluate(
    item_id: str,
    branch_id: Optional[str] = None,
    published_by_uid: str = "cli_trainer",
    db: Any = None,
    models_dir: Optional[Path] = None,
    save_cache: bool = True,
) -> dict[str, Any]:
    """
    Proceso completo CRISP-DM para un ítem sobre Cloud Firestore:
      1. Extraer datos reales validados + eventos calendario M07.
      2. Validar cobertura mínima (>= 60 muestras).
      3. Construir las 10 features sin fuga de futuro.
      4. Split temporal 80/20 (sin barajar).
      5. Entrenar candidatos (Ridge, GradientBoosting, RandomForest) + baseline.
      6. Evaluar MAE, RMSE y R² en conjunto de prueba temporal.
      7. Publicar mejor modelo en `ml_model_versions` si supera el baseline (MAE < baseline_MAE).
    """
    client = db if db is not None else get_firestore_client()
    out_models_dir = models_dir if models_dir is not None else MODELS_DIR

    df = extract_training_data(client, item_id=item_id, branch_id=branch_id, save_cache=save_cache)

    if len(df) < MIN_TRAINING_SAMPLES:
        return {
            "status": "datos_insuficientes",
            "message": f"Solo {len(df)} muestras. Mínimo requerido: {MIN_TRAINING_SAMPLES}",
        }

    X, y, aligned_df = build_features(df)
    n = len(X)
    split_idx = int(n * SPLIT_RATIO)

    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]

    if len(X_test) < 10:
        return {"status": "datos_insuficientes", "message": "Conjunto de prueba muy pequeño (< 10 filas tras lags)"}

    # Baseline: media histórica del conjunto de entrenamiento
    baseline_pred = np.full(len(y_test), y_train.mean())
    baseline_mae = float(mean_absolute_error(y_test, baseline_pred))
    baseline_rmse = float(mean_squared_error(y_test, baseline_pred) ** 0.5)
    baseline_r2 = float(r2_score(y_test, baseline_pred))

    candidates = {
        "Ridge": Ridge(),
        "GradientBoosting": GradientBoostingRegressor(n_estimators=100, random_state=42),
        "RandomForest": RandomForestRegressor(n_estimators=100, random_state=42),
    }

    best_model = None
    best_mae = float("inf")
    best_rmse = float("inf")
    best_r2 = float("-inf")
    best_name = ""
    results: dict[str, dict[str, float]] = {}

    for name, model in candidates.items():
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
        mae = float(mean_absolute_error(y_test, preds))
        rmse = float(mean_squared_error(y_test, preds) ** 0.5)
        r2 = float(r2_score(y_test, preds))
        results[name] = {
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "r2": round(r2, 4),
        }
        logger.info("%s — MAE: %.4f | RMSE: %.4f | R²: %.4f", name, mae, rmse, r2)

        if mae < best_mae:
            best_mae = mae
            best_rmse = rmse
            best_r2 = r2
            best_model = model
            best_name = name

    # Solo publicar si el mejor modelo supera al baseline
    if best_mae >= baseline_mae:
        return {
            "status": "baseline_no_superado",
            "baseline_mae": round(baseline_mae, 4),
            "baseline_rmse": round(baseline_rmse, 4),
            "baseline_r2": round(baseline_r2, 4),
            "best_model": best_name,
            "best_mae": round(best_mae, 4),
            "best_rmse": round(best_rmse, 4),
            "best_r2": round(best_r2, 4),
            "results": results,
        }

    # Guardar artefacto .joblib
    out_models_dir.mkdir(parents=True, exist_ok=True)
    scope_slug = branch_id or "global"
    version_tag = f"item_{item_id}_b_{scope_slug}_{date.today().isoformat()}_{best_name.lower()}"
    artifact_path = str(out_models_dir / f"{version_tag}.joblib")
    joblib.dump(best_model, artifact_path)
    logger.info("Artefacto guardado: %s", artifact_path)

    # Desactivar versiones anteriores para este (item_id, branch_id) en Firestore
    prev_q = apply_filter(client.collection(ML_MODEL_VERSIONS), "item_id", "==", item_id)
    prev_q = apply_filter(prev_q, "is_active", "==", True)
    batch = client.batch()
    for doc in prev_q.stream():
        d = doc.to_dict() or {}
        if d.get("branch_id") == branch_id:
            batch.update(doc.reference, {"is_active": False})

    train_dates = aligned_df.iloc[:split_idx]["ds"]
    test_dates = aligned_df.iloc[split_idx:]["ds"]
    now = now_utc()

    model_doc = {
        "version_tag": version_tag,
        "item_id": item_id,
        "branch_id": branch_id,
        "algorithm": best_name,
        "artifact_path": artifact_path,
        "features": FEATURE_COLUMNS,
        "training_start_date": train_dates.min().date().isoformat(),
        "training_end_date": train_dates.max().date().isoformat(),
        "training_examples": int(len(X_train)),
        "mae": round(best_mae, 6),
        "rmse": round(best_rmse, 6),
        "r2": round(best_r2, 6),
        "baseline_mae": round(baseline_mae, 6),
        "baseline_rmse": round(baseline_rmse, 6),
        "baseline_r2": round(baseline_r2, 6),
        "is_active": True,
        "published_by_uid": published_by_uid,
        "published_at": now,
        "evaluations": [
            {
                "eval_period_start": test_dates.min().date().isoformat(),
                "eval_period_end": test_dates.max().date().isoformat(),
                "mae": round(best_mae, 6),
                "rmse": round(best_rmse, 6),
                "r2": round(best_r2, 6),
                "n_samples": int(len(X_test)),
                "candidates": results,
                "created_at": now.isoformat(),
            }
        ],
    }
    batch.set(client.collection(ML_MODEL_VERSIONS).document(version_tag), model_doc)
    batch.commit()

    return {
        "status": "publicado",
        "version_tag": version_tag,
        "algorithm": best_name,
        "mae": round(best_mae, 4),
        "rmse": round(best_rmse, 4),
        "r2": round(best_r2, 4),
        "baseline_mae": round(baseline_mae, 4),
        "baseline_rmse": round(baseline_rmse, 4),
        "baseline_r2": round(baseline_r2, 4),
        "features": FEATURE_COLUMNS,
        "training_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "results": results,
    }


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) < 2:
        print("Uso: python -m ml_pipeline.train <item_id> [branch_id]")
        sys.exit(1)
    arg_item = sys.argv[1]
    arg_branch = sys.argv[2] if len(sys.argv) > 2 else None
    result = train_and_evaluate(item_id=arg_item, branch_id=arg_branch)
    print(result)
