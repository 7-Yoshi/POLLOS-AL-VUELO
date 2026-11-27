"""
Análisis Exploratorio de Datos (EDA) y exportación analítica desde Cloud Firestore.
Diseñado para la Fase 2 (Comprensión de los datos) y Capítulo de Resultados de la tesis,
respetando el plan gratuito Spark de Firebase mediante extracción única a snapshots CSV + JSON.

Uso desde línea de comandos:
    python -m analytics.eda_firestore
    python -m analytics.eda_firestore --branch suc_central --output storage/exports
"""
import argparse
import json
import logging
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd

from app.db.collections import (
    BRANCHES,
    CONSUMPTION_DAILY,
    INVENTORY_BALANCES,
    ITEMS,
    ML_MODEL_VERSIONS,
    OPERATION_EVENTS,
    PURCHASES,
    apply_filter,
)
from app.db.firestore_client import get_firestore_client
from app.ml.features import attach_calendar_features

logger = logging.getLogger(__name__)

DAY_NAMES_ES = {
    0: "Lunes",
    1: "Martes",
    2: "Miércoles",
    3: "Jueves",
    4: "Viernes",
    5: "Sábado",
    6: "Domingo",
}


def extract_collections_to_dataframes(
    db: Any,
    branch_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> dict[str, pd.DataFrame]:
    """Extrae colecciones clave de Cloud Firestore y las transforma en DataFrames de pandas."""

    def _stream_to_df(collection_name: str, filter_branch: bool = False) -> pd.DataFrame:
        q = db.collection(collection_name)
        if filter_branch and branch_id:
            q = apply_filter(q, "branch_id", "==", branch_id)
        rows = [{"id": doc.id, **(doc.to_dict() or {})} for doc in q.stream()]
        return pd.DataFrame(rows)

    dfs = {
        "branches": _stream_to_df(BRANCHES),
        "items": _stream_to_df(ITEMS),
        "consumption": _stream_to_df(CONSUMPTION_DAILY, filter_branch=True),
        "purchases": _stream_to_df(PURCHASES, filter_branch=True),
        "balances": _stream_to_df(INVENTORY_BALANCES, filter_branch=True),
        "events": _stream_to_df(OPERATION_EVENTS, filter_branch=True),
        "models": _stream_to_df(ML_MODEL_VERSIONS),
    }

    if not dfs["consumption"].empty and "consumption_date" in dfs["consumption"].columns:
        c = dfs["consumption"]
        if from_date:
            c = c[c["consumption_date"] >= from_date]
        if to_date:
            c = c[c["consumption_date"] <= to_date]
        dfs["consumption"] = c.reset_index(drop=True)

    if not dfs["purchases"].empty and "purchase_date" in dfs["purchases"].columns:
        p = dfs["purchases"]
        if from_date:
            p = p[p["purchase_date"] >= from_date]
        if to_date:
            p = p[p["purchase_date"] <= to_date]
        dfs["purchases"] = p.reset_index(drop=True)

    return dfs


def _detect_iqr_outliers(series: pd.Series) -> int:
    if len(series) < 4:
        return 0
    q1 = float(series.quantile(0.25))
    q3 = float(series.quantile(0.75))
    iqr = q3 - q1
    if iqr == 0:
        return 0
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    return int(((series < lower) | (series > upper)).sum())


def run_eda_analysis(
    db: Any = None,
    output_dir: str | Path = "storage/exports",
    branch_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    export_files: bool = True,
) -> dict[str, Any]:
    """
    Ejecuta el análisis exploratorio completo desde Cloud Firestore:
      1. Exportación de snapshots CSV (reproducibilidad + Power BI / Colab / Excel).
      2. Calidad y completitud de datos (`medido`, `calculado_validado`, `desconocido`, días / 60).
      3. Estadística descriptiva y detección de atípicos (IQR) por ítem.
      4. Estacionalidad por día de la semana y mes.
      5. Impacto cuantitativo del Calendario M07 (feriados, días especiales, cierres).
      6. Comparativa entre sucursales y tabla de desempeño de modelos ML (MAE, RMSE, R²).
    """
    client = db if db is not None else get_firestore_client()
    dfs = extract_collections_to_dataframes(client, branch_id=branch_id, from_date=from_date, to_date=to_date)

    out_path = Path(output_dir)
    if export_files:
        out_path.mkdir(parents=True, exist_ok=True)
        for name, frame in dfs.items():
            if not frame.empty:
                frame.to_csv(out_path / f"{name}.csv", index=False)

    branch_names = {}
    if not dfs["branches"].empty:
        branch_names = dict(zip(dfs["branches"]["id"], dfs["branches"]["name"]))

    item_names = {}
    if not dfs["items"].empty:
        item_names = dict(zip(dfs["items"]["id"], dfs["items"]["name"]))

    df_c = dfs["consumption"]
    data_quality: dict[str, Any] = {
        "total_records": int(len(df_c)),
        "by_status": {},
        "completeness_pct": 0.0,
    }
    descriptive_by_item: list[dict[str, Any]] = []
    seasonality_dow: list[dict[str, Any]] = []
    seasonality_month: list[dict[str, Any]] = []
    calendar_impact: dict[str, Any] = {}
    branch_comparison: list[dict[str, Any]] = []

    if not df_c.empty:
        status_counts = df_c["status"].value_counts().to_dict()
        validated_mask = df_c["status"].isin(["medido", "calculado_validado"]) & df_c["quantity_base"].notna()
        valid_df = df_c[validated_mask].copy()
        valid_df["quantity_base"] = valid_df["quantity_base"].astype(float)
        valid_df["ds"] = pd.to_datetime(valid_df["consumption_date"])

        data_quality = {
            "total_records": int(len(df_c)),
            "validated_records": int(len(valid_df)),
            "unknown_records": int((df_c["status"] == "desconocido").sum()),
            "by_status": {str(k): int(v) for k, v in status_counts.items()},
            "completeness_pct": round((len(valid_df) / len(df_c)) * 100.0, 2) if len(df_c) else 0.0,
        }

        if not valid_df.empty:
            # 1. Estadística descriptiva + outliers IQR por ítem
            for iid, grp in valid_df.groupby("item_id"):
                vals = grp["quantity_base"]
                distinct_days = int(grp["consumption_date"].nunique())
                descriptive_by_item.append({
                    "item_id": str(iid),
                    "item_name": item_names.get(str(iid), str(iid)),
                    "n_records": int(len(vals)),
                    "distinct_days": distinct_days,
                    "ready_for_training_60d": distinct_days >= 60,
                    "mean": round(float(vals.mean()), 4),
                    "median": round(float(vals.median()), 4),
                    "std": round(float(vals.std(ddof=1)), 4) if len(vals) > 1 else 0.0,
                    "min": round(float(vals.min()), 4),
                    "p25": round(float(vals.quantile(0.25)), 4),
                    "p75": round(float(vals.quantile(0.75)), 4),
                    "max": round(float(vals.max()), 4),
                    "iqr_outliers": _detect_iqr_outliers(vals),
                })

            # 2. Estacionalidad por día de la semana
            valid_df["dow"] = valid_df["ds"].dt.dayofweek
            valid_df["month"] = valid_df["ds"].dt.month
            for dow_idx, grp in valid_df.groupby("dow"):
                seasonality_dow.append({
                    "dow": int(dow_idx),
                    "day_name": DAY_NAMES_ES.get(int(dow_idx), str(dow_idx)),
                    "records": int(len(grp)),
                    "mean_consumption": round(float(grp["quantity_base"].mean()), 4),
                    "median_consumption": round(float(grp["quantity_base"].median()), 4),
                    "total_consumption": round(float(grp["quantity_base"].sum()), 4),
                })

            for m_idx, grp in valid_df.groupby("month"):
                seasonality_month.append({
                    "month": int(m_idx),
                    "records": int(len(grp)),
                    "mean_consumption": round(float(grp["quantity_base"].mean()), 4),
                    "total_consumption": round(float(grp["quantity_base"].sum()), 4),
                })

            # 3. Impacto del Calendario de Operaciones (M07)
            events_list = dfs["events"].to_dict(orient="records") if not dfs["events"].empty else []
            enriched = attach_calendar_features(valid_df, events_list)
            normal_mask = (
                (enriched["es_feriado"] == 0)
                & (enriched["es_dia_especial"] == 0)
                & (enriched["es_cierre"] == 0)
            )
            normal_mean = float(enriched.loc[normal_mask, "quantity_base"].mean()) if normal_mask.any() else 0.0

            def _segment_stats(mask: pd.Series) -> dict[str, Any]:
                sub = enriched.loc[mask, "quantity_base"]
                if sub.empty:
                    return {"count": 0, "mean": None, "lift_vs_normal_pct": None}
                mean_val = float(sub.mean())
                lift = round(((mean_val - normal_mean) / normal_mean) * 100.0, 2) if normal_mean > 0 else None
                return {"count": int(len(sub)), "mean": round(mean_val, 4), "lift_vs_normal_pct": lift}

            calendar_impact = {
                "normal_days": _segment_stats(normal_mask),
                "feriados": _segment_stats(enriched["es_feriado"] == 1),
                "dias_especiales": _segment_stats(enriched["es_dia_especial"] == 1),
                "cierres": _segment_stats(enriched["es_cierre"] == 1),
            }

            # 4. Comparativa entre sucursales
            for bid, grp in valid_df.groupby("branch_id"):
                daily = grp.groupby("consumption_date")["quantity_base"].sum()
                branch_comparison.append({
                    "branch_id": str(bid),
                    "branch_name": branch_names.get(str(bid), str(bid)),
                    "validated_records": int(len(grp)),
                    "active_days": int(len(daily)),
                    "total_consumption": round(float(grp["quantity_base"].sum()), 4),
                    "avg_daily_consumption": round(float(daily.mean()), 4),
                    "std_daily_consumption": round(float(daily.std(ddof=1)), 4) if len(daily) > 1 else 0.0,
                })

    # 5. Desempeño de modelos ML publicados en Firestore
    ml_models_summary: list[dict[str, Any]] = []
    if not dfs["models"].empty:
        for _, row in dfs["models"].iterrows():
            mae = float(row.get("mae", 0.0))
            base_mae = float(row.get("baseline_mae", 0.0))
            improv = round(((base_mae - mae) / base_mae) * 100.0, 2) if base_mae > 0 else None
            r2_val = row.get("r2")
            ml_models_summary.append({
                "version_tag": str(row.get("version_tag", row.get("id", ""))),
                "item_id": str(row.get("item_id", "")),
                "branch_id": None if pd.isna(row.get("branch_id")) else str(row.get("branch_id")),
                "algorithm": str(row.get("algorithm", "")),
                "is_active": bool(row.get("is_active", False)),
                "mae": round(mae, 4),
                "rmse": round(float(row.get("rmse", 0.0)), 4),
                "r2": round(float(r2_val), 4) if r2_val is not None and not pd.isna(r2_val) else None,
                "baseline_mae": round(base_mae, 4),
                "mae_improvement_vs_baseline_pct": improv,
            })

    report = {
        "source": "Cloud Firestore (NoSQL)",
        "filters": {"branch_id": branch_id, "from_date": from_date, "to_date": to_date},
        "data_quality": data_quality,
        "descriptive_by_item": descriptive_by_item,
        "seasonality_by_day_of_week": seasonality_dow,
        "seasonality_by_month": seasonality_month,
        "calendar_m07_impact": calendar_impact,
        "branch_comparison": branch_comparison,
        "ml_models_summary": ml_models_summary,
    }

    if export_files:
        summary_file = out_path / "resumen_eda.json"
        summary_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        if descriptive_by_item:
            pd.DataFrame(descriptive_by_item).to_csv(out_path / "eda_estadistica_items.csv", index=False)
        if seasonality_dow:
            pd.DataFrame(seasonality_dow).to_csv(out_path / "eda_estacionalidad_semanal.csv", index=False)
        if branch_comparison:
            pd.DataFrame(branch_comparison).to_csv(out_path / "eda_comparativa_sucursales.csv", index=False)
        logger.info("Reporte EDA exportado en %s", summary_file)

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Análisis Exploratorio de Datos (EDA) desde Cloud Firestore")
    parser.add_argument("--branch", default=None, help="Filtrar por branch_id específico (opcional)")
    parser.add_argument("--from-date", default=None, help="Fecha inicio YYYY-MM-DD")
    parser.add_argument("--to-date", default=None, help="Fecha fin YYYY-MM-DD")
    parser.add_argument("--output", default="storage/exports", help="Carpeta de salida CSV/JSON")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    report = run_eda_analysis(
        output_dir=args.output,
        branch_id=args.branch,
        from_date=args.from_date,
        to_date=args.to_date,
        export_files=True,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
