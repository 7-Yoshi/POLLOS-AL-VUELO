"""
Feature engineering compartido (entrenamiento e inferencia) sobre Cloud Firestore.
Garantiza CERO filtración de futuro e integra variables del Calendario de Operaciones (M07).
"""
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from app.db.collections import CONSUMPTION_DAILY, OPERATION_EVENTS, apply_filter
from app.db.models import ConsumptionStatus, EventType

MIN_HISTORY_DAYS = 30  # Mínimo de días reales de consumo requeridos para inferencia

# Orden canónico de las 10 variables del modelo (Obj. 2 — incluye Calendario M07)
FEATURE_COLUMNS: list[str] = [
    "dow",
    "month",
    "lag_1",
    "lag_7",
    "lag_14",
    "rolling_7",
    "rolling_30",
    "es_feriado",
    "es_dia_especial",
    "es_cierre",
]

VALIDATED_STATUSES = [ConsumptionStatus.medido.value, ConsumptionStatus.calculado_validado.value]


def get_calendar_flags_for_date(
    db: Any,
    branch_id: str,
    target_date: date,
) -> tuple[int, int, int]:
    """
    Consulta `operation_events` (M07) en Firestore para `branch_id` en `target_date`.
    Retorna `(es_feriado, es_dia_especial, es_cierre)` como banderas binarias (0/1).
    Los eventos del calendario son variables exógenas conocidas para la fecha objetivo.
    """
    target_str = target_date.isoformat()
    docs = list(apply_filter(db.collection(OPERATION_EVENTS), "branch_id", "==", branch_id).stream())

    es_feriado = 0
    es_dia_especial = 0
    es_cierre = 0

    for doc in docs:
        d = doc.to_dict() or {}
        active_dates = d.get("active_dates")
        matches = False
        if isinstance(active_dates, list) and active_dates:
            matches = target_str in active_dates
        else:
            sdate = d.get("start_date") or ""
            edate = d.get("end_date") or ""
            matches = bool(sdate and edate and sdate <= target_str <= edate)

        if not matches:
            continue

        ev_type = d.get("event_type")
        if ev_type == EventType.feriado.value:
            es_feriado = 1
        elif ev_type == EventType.dia_especial.value:
            es_dia_especial = 1
        elif ev_type in (EventType.cierre.value, EventType.bloqueo.value):
            es_cierre = 1

    return es_feriado, es_dia_especial, es_cierre


def attach_calendar_features(df: pd.DataFrame, events: list[dict[str, Any]]) -> pd.DataFrame:
    """
    Enriquece un DataFrame histórico (con columnas `ds` y opcionalmente `branch_id`)
    con las banderas del calendario M07: `es_feriado`, `es_dia_especial`, `es_cierre`.
    """
    out = df.copy()
    out["es_feriado"] = 0
    out["es_dia_especial"] = 0
    out["es_cierre"] = 0

    if out.empty or not events:
        return out

    date_strs = pd.to_datetime(out["ds"]).dt.strftime("%Y-%m-%d")
    has_branch = "branch_id" in out.columns

    # Construir conjuntos rápidos de (branch_id, fecha) por tipo de evento
    feriados: set[tuple[str, str]] = set()
    especiales: set[tuple[str, str]] = set()
    cierres: set[tuple[str, str]] = set()

    for ev in events:
        bid = str(ev.get("branch_id", ""))
        ev_type = ev.get("event_type")
        active = ev.get("active_dates")
        if isinstance(active, list) and active:
            dates_list = [str(x) for x in active]
        else:
            try:
                sd = date.fromisoformat(str(ev.get("start_date")))
                ed = date.fromisoformat(str(ev.get("end_date")))
                days = max(0, (ed - sd).days + 1)
                dates_list = [(sd + timedelta(days=i)).isoformat() for i in range(days)]
            except Exception:
                dates_list = []

        for d_str in dates_list:
            key = (bid, d_str)
            if ev_type == EventType.feriado.value:
                feriados.add(key)
            elif ev_type == EventType.dia_especial.value:
                especiales.add(key)
            elif ev_type in (EventType.cierre.value, EventType.bloqueo.value):
                cierres.add(key)

    if has_branch:
        keys = list(zip(out["branch_id"].astype(str), date_strs))
        out["es_feriado"] = [1 if k in feriados else 0 for k in keys]
        out["es_dia_especial"] = [1 if k in especiales else 0 for k in keys]
        out["es_cierre"] = [1 if k in cierres else 0 for k in keys]
    else:
        fer_dates = {d for _, d in feriados}
        esp_dates = {d for _, d in especiales}
        cie_dates = {d for _, d in cierres}
        out["es_feriado"] = [1 if d in fer_dates else 0 for d in date_strs]
        out["es_dia_especial"] = [1 if d in esp_dates else 0 for d in date_strs]
        out["es_cierre"] = [1 if d in cie_dates else 0 for d in date_strs]

    return out


def build_features_for_prediction(
    db: Any,
    branch_id: str,
    item_id: str,
    prediction_for_date: date,
) -> tuple[np.ndarray, date]:
    """
    Construye el vector de 10 características para predecir el consumo de `item_id`
    en `branch_id` el día `prediction_for_date`.

    Solo utiliza consumos estrictamente ANTERIORES a `prediction_for_date` (sin fuga de futuro)
    e incorpora las banderas del calendario M07 de `prediction_for_date`.
    """
    cutoff_str = (prediction_for_date - timedelta(days=1)).isoformat()

    q = apply_filter(db.collection(CONSUMPTION_DAILY), "branch_id", "==", branch_id)
    q = apply_filter(q, "item_id", "==", item_id)
    docs = list(q.stream())

    records = []
    for doc in docs:
        d = doc.to_dict() or {}
        cdate = d.get("consumption_date") or ""
        if not cdate or cdate > cutoff_str:
            continue
        if d.get("status") not in VALIDATED_STATUSES:
            continue
        qty = d.get("quantity_base")
        if qty is None:
            continue
        records.append({"ds": cdate, "y": float(qty)})

    if len(records) < MIN_HISTORY_DAYS:
        raise ValueError(
            f"Datos insuficientes: se necesitan al menos {MIN_HISTORY_DAYS} días de consumo real "
            f"validado. Disponibles: {len(records)}."
        )

    df = pd.DataFrame(records)
    df["ds"] = pd.to_datetime(df["ds"])
    df = df.sort_values("ds").reset_index(drop=True)

    pred_dt = pd.Timestamp(prediction_for_date)
    dow = int(pred_dt.dayofweek)
    month = int(pred_dt.month)

    lag_1 = float(df["y"].iloc[-1])
    lag_7 = float(df["y"].iloc[-7]) if len(df) >= 7 else lag_1
    lag_14 = float(df["y"].iloc[-14]) if len(df) >= 14 else lag_7
    rolling_7 = float(df["y"].tail(7).mean())
    rolling_30 = float(df["y"].tail(30).mean())

    es_feriado, es_dia_especial, es_cierre = get_calendar_flags_for_date(
        db=db,
        branch_id=branch_id,
        target_date=prediction_for_date,
    )

    features = np.array([[
        dow,
        month,
        lag_1,
        lag_7,
        lag_14,
        rolling_7,
        rolling_30,
        es_feriado,
        es_dia_especial,
        es_cierre,
    ]], dtype=float)

    known_at = df["ds"].iloc[-1].date()
    return features, known_at
