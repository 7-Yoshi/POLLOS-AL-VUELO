"""
Módulo Predicciones (M08) — API de inferencia ML de regresión sobre Cloud Firestore.
- Encargado tiene acceso de SOLO LECTURA (GET /) restringido estrictamente a su sucursal.
- Admin y Gerente pueden consultar y solicitar nuevas predicciones (POST /predict).
- Incluye métricas de error del modelo (MAE, RMSE, R²) y rango de incertidumbre (± RMSE).
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.deps import AuthUser, DbClient
from app.core.audit import record_audit
from app.core.permissions import require_branch_access, require_permission
from app.db.collections import ITEMS, PREDICTIONS, apply_filter, prediction_doc_id
from app.db.models import now_utc, to_iso
from app.ml.features import build_features_for_prediction
from app.ml.predictor import load_and_predict
from app.ml.registry import get_active_model_version

router = APIRouter()


class PredictionRequestSchema(BaseModel):
    branch_id: str
    item_id: str
    prediction_for_date: date


@router.post("/predict")
async def predict_consumption(
    data: PredictionRequestSchema,
    current_user: AuthUser,
    db: DbClient,
):
    """
    Estima consumo para una fecha futura (solo Admin y Gerente).
    Retorna la estimación puntual, el rango de confianza (± RMSE) y métricas (MAE, RMSE, R²).
    """
    require_permission(current_user.role, "predictions_write")
    require_branch_access(current_user.role, current_user.branch_ids, data.branch_id)

    item_snap = db.collection(ITEMS).document(data.item_id).get()
    if not item_snap.exists:
        raise HTTPException(status_code=404, detail="Materia prima no encontrada")
    item_data = item_snap.to_dict() or {}
    unit = item_data.get("base_unit", "kg")

    # 1. Obtener modelo activo en Firestore
    model_version = get_active_model_version(db, item_id=data.item_id, branch_id=data.branch_id)
    if not model_version:
        return {
            "status": "sin_modelo",
            "message": "No hay modelo de predicción aprobado para esta materia prima.",
            "predicted_quantity": None,
        }

    # 2. Construir características (lags + rolling + calendario M07, sin fuga de futuro)
    try:
        features, known_at = build_features_for_prediction(
            db=db,
            branch_id=data.branch_id,
            item_id=data.item_id,
            prediction_for_date=data.prediction_for_date,
        )
    except ValueError as exc:
        return {
            "status": "datos_insuficientes",
            "message": str(exc),
            "predicted_quantity": None,
        }

    # 3. Inferencia
    predicted_qty = float(load_and_predict(model_version["artifact_path"], features))
    mae = float(model_version.get("mae", 0.0))
    rmse = float(model_version.get("rmse", 0.0))
    r2_raw = model_version.get("r2")
    r2 = float(r2_raw) if r2_raw is not None else None
    range_min = round(max(0.0, predicted_qty - rmse), 4)
    range_max = round(predicted_qty + rmse, 4)

    # 4. Guardar predicción en Firestore (ID determinístico = upsert seguro sin sobrescribir consumo real)
    version_tag = model_version["version_tag"]
    pred_id = prediction_doc_id(data.branch_id, data.item_id, data.prediction_for_date, version_tag)
    now = now_utc()
    payload = {
        "branch_id": data.branch_id,
        "item_id": data.item_id,
        "model_version_tag": version_tag,
        "algorithm": model_version.get("algorithm"),
        "prediction_for_date": data.prediction_for_date.isoformat(),
        "predicted_quantity": round(predicted_qty, 4),
        "unit": unit,
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "r2": round(r2, 4) if r2 is not None else None,
        "range_min": range_min,
        "range_max": range_max,
        "known_at": known_at.isoformat(),
        "calculated_at": now,
        "requested_by_uid": current_user.firebase_uid,
    }
    db.collection(PREDICTIONS).document(pred_id).set(payload)
    record_audit(
        db=db,
        current_user=current_user,
        action="PREDICT",
        entity_type="prediction",
        entity_id=pred_id,
        branch_id=data.branch_id,
        details={
            "item_id": data.item_id,
            "prediction_for_date": data.prediction_for_date.isoformat(),
            "predicted_quantity": round(predicted_qty, 4),
            "model_version": version_tag,
        },
    )

    return {
        "status": "ok",
        "id": pred_id,
        "branch_id": data.branch_id,
        "item_id": data.item_id,
        "prediction_for_date": data.prediction_for_date.isoformat(),
        "predicted_quantity": round(predicted_qty, 4),
        "unit": unit,
        "model_version": version_tag,
        "algorithm": model_version.get("algorithm"),
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "r2": round(r2, 4) if r2 is not None else None,
        "range_min": range_min,
        "range_max": range_max,
        "known_at": known_at.isoformat(),
    }


@router.get("/")
async def list_predictions(
    current_user: AuthUser,
    db: DbClient,
    branch_id: Optional[str] = None,
    item_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
):
    """
    Lista predicciones almacenadas (incluye acceso de SOLO LECTURA para Encargado en su sucursal).
    Aplica aislamiento estricto incluso cuando `branch_id` es omitido.
    """
    require_permission(current_user.role, "predictions_read")

    docs = []
    if branch_id:
        require_branch_access(current_user.role, current_user.branch_ids, branch_id)
        docs = list(apply_filter(db.collection(PREDICTIONS), "branch_id", "==", branch_id).stream())
    elif current_user.role == "admin":
        docs = list(db.collection(PREDICTIONS).stream())
    else:
        for bid in current_user.branch_ids:
            docs.extend(apply_filter(db.collection(PREDICTIONS), "branch_id", "==", bid).stream())

    preds = []
    for doc in docs:
        d = doc.to_dict() or {}
        if item_id and d.get("item_id") != item_id:
            continue
        pred_qty = float(d.get("predicted_quantity", 0.0))
        rmse = float(d["rmse"]) if d.get("rmse") is not None else None
        mae = float(d["mae"]) if d.get("mae") is not None else None
        r2 = float(d["r2"]) if d.get("r2") is not None else None
        range_min = d.get("range_min")
        range_max = d.get("range_max")
        if range_min is None and rmse is not None:
            range_min = round(max(0.0, pred_qty - rmse), 4)
        if range_max is None and rmse is not None:
            range_max = round(pred_qty + rmse, 4)

        preds.append({
            "id": doc.id,
            "branch_id": d.get("branch_id"),
            "item_id": d.get("item_id"),
            "prediction_for_date": d.get("prediction_for_date"),
            "predicted_quantity": round(pred_qty, 4),
            "unit": d.get("unit", "kg"),
            "model_version": d.get("model_version_tag"),
            "algorithm": d.get("algorithm"),
            "mae": round(mae, 4) if mae is not None else None,
            "rmse": round(rmse, 4) if rmse is not None else None,
            "r2": round(r2, 4) if r2 is not None else None,
            "range_min": round(float(range_min), 4) if range_min is not None else None,
            "range_max": round(float(range_max), 4) if range_max is not None else None,
            "known_at": d.get("known_at"),
            "calculated_at": to_iso(d.get("calculated_at")),
        })

    preds.sort(key=lambda p: (p.get("prediction_for_date") or "", p.get("calculated_at") or ""), reverse=True)
    return preds[skip : skip + limit]
