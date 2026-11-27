"""
Tests del pipeline ML sobre Cloud Firestore:
- Cero filtración de futuro en lags y medias móviles usando la implementación real.
- Integración de variables del Calendario M07 (`es_feriado`, `es_dia_especial`, `es_cierre`).
- Split temporal 80/20 sin barajar, guarda de 60 días mínimos y métricas MAE, RMSE y R².
"""
from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.db.collections import CONSUMPTION_DAILY, ML_MODEL_VERSIONS, OPERATION_EVENTS, consumption_doc_id
from app.ml.features import (
    FEATURE_COLUMNS,
    attach_calendar_features,
    build_features_for_prediction,
)
from ml_pipeline.train import MIN_TRAINING_SAMPLES, build_features, train_and_evaluate
from tests.fake_firestore import FakeFirestoreClient


def _build_patterned_df(n_days: int = 90, branch_id: str = "suc_central") -> pd.DataFrame:
    """Genera serie temporal determinística con estacionalidad semanal y tendencia."""
    start = date(2026, 1, 1)
    rows = []
    for i in range(n_days):
        d = start + timedelta(days=i)
        # Patrón semanal claro (picos viernes-domingo) + tendencia suave
        weekend_boost = 20.0 if d.weekday() >= 4 else 0.0
        y = 50.0 + weekend_boost + (i * 0.25)
        rows.append({"ds": pd.Timestamp(d), "y": float(y), "branch_id": branch_id})
    return pd.DataFrame(rows)


def test_no_future_leakage_in_real_build_features():
    """Verifica que `ml_pipeline.train.build_features` calcula lags estrictamente con pasado."""
    df = _build_patterned_df(90)
    X, y, aligned = build_features(df)

    assert X.shape[1] == len(FEATURE_COLUMNS) == 10
    assert len(X) == len(y) == len(aligned)
    # Comprobar que lag_1 en cada fila corresponde exactamente al consumo del día anterior
    y_by_date = dict(zip(df["ds"], df["y"]))
    for _, row in aligned.iterrows():
        prev_day = row["ds"] - pd.Timedelta(days=1)
        assert row["lag_1"] == y_by_date[prev_day], "Filtración de futuro detectada en lag_1"


def test_temporal_split_no_shuffle():
    """El split temporal 80/20 debe conservar orden cronológico estricto."""
    df = _build_patterned_df(90)
    _, _, aligned = build_features(df)
    split_idx = int(len(aligned) * 0.8)
    assert aligned.iloc[:split_idx]["ds"].max() < aligned.iloc[split_idx:]["ds"].min()


def test_calendar_m07_features_attached_per_branch():
    """Obj. 2: Eventos del calendario M07 se activan solo en la fecha y sucursal correctas."""
    df_a = _build_patterned_df(10, branch_id="suc_central")
    df_b = _build_patterned_df(10, branch_id="suc_norte")
    df = pd.concat([df_a, df_b], ignore_index=True)

    events = [
        {
            "branch_id": "suc_central",
            "event_type": "feriado",
            "start_date": "2026-01-03",
            "end_date": "2026-01-03",
            "active_dates": ["2026-01-03"],
        },
        {
            "branch_id": "suc_central",
            "event_type": "dia_especial",
            "start_date": "2026-01-05",
            "end_date": "2026-01-06",
            "active_dates": ["2026-01-05", "2026-01-06"],
        },
        {
            "branch_id": "suc_norte",
            "event_type": "cierre",
            "start_date": "2026-01-07",
            "end_date": "2026-01-07",
            "active_dates": ["2026-01-07"],
        },
    ]

    enriched = attach_calendar_features(df, events)
    # Feriado solo en suc_central el 2026-01-03
    row_fer = enriched[(enriched["branch_id"] == "suc_central") & (enriched["ds"] == "2026-01-03")].iloc[0]
    row_other = enriched[(enriched["branch_id"] == "suc_norte") & (enriched["ds"] == "2026-01-03")].iloc[0]
    assert row_fer["es_feriado"] == 1
    assert row_other["es_feriado"] == 0

    # Día especial en suc_central 2026-01-05 y 2026-01-06
    esp_rows = enriched[(enriched["branch_id"] == "suc_central") & (enriched["es_dia_especial"] == 1)]
    assert len(esp_rows) == 2

    # Cierre solo en suc_norte 2026-01-07
    row_cierre = enriched[(enriched["branch_id"] == "suc_norte") & (enriched["ds"] == "2026-01-07")].iloc[0]
    assert row_cierre["es_cierre"] == 1


def test_train_and_evaluate_saves_r2_and_calendar_features_in_firestore(tmp_path):
    """Obj. 2 y Obj. 5: Entrena sobre Firestore, evalúa MAE/RMSE/R² y publica en ml_model_versions."""
    db = FakeFirestoreClient()
    start = date(2026, 1, 1)

    # Registrar un feriado recurrente con pico de consumo + 100 días de consumo real
    holiday_dates = []
    for i in range(100):
        d = start + timedelta(days=i)
        is_hol = (i % 15 == 0)
        if is_hol:
            holiday_dates.append(d.isoformat())
            db.collection(OPERATION_EVENTS).document(f"ev_{i}").set({
                "branch_id": "suc_central",
                "event_type": "feriado",
                "name": f"Feriado {i}",
                "start_date": d.isoformat(),
                "end_date": d.isoformat(),
                "active_dates": [d.isoformat()],
            })
        weekend_boost = 25.0 if d.weekday() >= 4 else 0.0
        holiday_boost = 18.0 if is_hol else 0.0
        qty = 45.0 + weekend_boost + holiday_boost + (i * 0.1)
        doc_id = consumption_doc_id("suc_central", "item_pollo", d)
        db.collection(CONSUMPTION_DAILY).document(doc_id).set({
            "branch_id": "suc_central",
            "item_id": "item_pollo",
            "consumption_date": d.isoformat(),
            "quantity_base": round(qty, 3),
            "unit": "kg",
            "status": "medido",
        })

    result = train_and_evaluate(
        item_id="item_pollo",
        branch_id="suc_central",
        published_by_uid="uid_admin",
        db=db,
        models_dir=tmp_path,
        save_cache=False,
    )
    assert result["status"] == "publicado"
    assert "r2" in result and isinstance(result["r2"], float)
    assert result["mae"] < result["baseline_mae"]
    assert result["features"] == FEATURE_COLUMNS

    # Verificar documento guardado en Cloud Firestore (`ml_model_versions`)
    mv_doc = db.collection(ML_MODEL_VERSIONS).document(result["version_tag"]).get().to_dict()
    assert mv_doc["is_active"] is True
    assert mv_doc["r2"] is not None
    assert mv_doc["mae"] > 0
    assert mv_doc["rmse"] > 0
    assert len(mv_doc["evaluations"]) == 1
    assert mv_doc["evaluations"][0]["r2"] is not None

    # Verificar que inferencia genera exactamente 10 features y lee calendario M07 para la fecha objetivo
    target_date = start + timedelta(days=100)
    db.collection(OPERATION_EVENTS).document("ev_target").set({
        "branch_id": "suc_central",
        "event_type": "dia_especial",
        "name": "Aniversario",
        "start_date": target_date.isoformat(),
        "end_date": target_date.isoformat(),
        "active_dates": [target_date.isoformat()],
    })
    features, known_at = build_features_for_prediction(
        db=db,
        branch_id="suc_central",
        item_id="item_pollo",
        prediction_for_date=target_date,
    )
    assert features.shape == (1, 10)
    assert known_at == start + timedelta(days=99)
    assert features[0, 8] == 1.0  # es_dia_especial == 1


def test_minimum_samples_guard_rejects_short_history():
    """Debe rechazar entrenamiento con menos de 60 días de consumo real."""
    db = FakeFirestoreClient()
    start = date(2026, 1, 1)
    for i in range(30):
        d = start + timedelta(days=i)
        db.collection(CONSUMPTION_DAILY).document(consumption_doc_id("suc_central", "item_pollo", d)).set({
            "branch_id": "suc_central",
            "item_id": "item_pollo",
            "consumption_date": d.isoformat(),
            "quantity_base": 50.0,
            "unit": "kg",
            "status": "medido",
        })

    result = train_and_evaluate(item_id="item_pollo", branch_id="suc_central", db=db, save_cache=False)
    assert result["status"] == "datos_insuficientes"
    assert str(MIN_TRAINING_SAMPLES) in result["message"]
