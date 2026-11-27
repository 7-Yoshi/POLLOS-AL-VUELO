"""
Módulo Consumo — registro de consumo real diario en Cloud Firestore.
- ID determinístico `{branch_id}__{item_id}__{YYYY-MM-DD}` garantiza unicidad atómica.
- Incluye indicador de madurez histórica (`días acumulados / 60`) mediante Aggregation Queries.
- Incluye importación masiva de histórico vía CSV con deduplicación SHA-256 en `import_batches`.
"""
import csv
import hashlib
import io
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.deps import AuthUser, DbClient
from app.core.audit import record_audit
from app.core.permissions import require_branch_access, require_permission
from app.db.collections import (
    CONSUMPTION_DAILY,
    IMPORT_BATCHES,
    ITEMS,
    apply_filter,
    consumption_doc_id,
    import_batch_doc_id,
)
from app.db.firestore_client import count_query, is_already_exists_error
from app.db.models import ConsumptionStatus, ImportStatus, now_utc, to_iso

router = APIRouter()

MIN_TRAINING_DAYS = 60
MIN_INFERENCE_DAYS = 30
VALIDATED_STATUSES = [ConsumptionStatus.medido.value, ConsumptionStatus.calculado_validado.value]


class ConsumptionCreateSchema(BaseModel):
    branch_id: str
    item_id: str
    consumption_date: date
    quantity_base: Optional[Decimal] = None  # None → DESCONOCIDO
    unit: str
    status: ConsumptionStatus
    method_notes: Optional[str] = None


@router.get("/readiness")
async def get_ml_readiness(
    current_user: AuthUser,
    db: DbClient,
    branch_id: Optional[str] = None,
):
    """
    Indicador de madurez histórica para ML ('días acumulados / 60') por materia prima.
    Usa Firestore Aggregation Query (`count()`) para consumir mínimo de cuota Spark.
    """
    require_permission(current_user.role, "consumption_read")
    if branch_id:
        require_branch_access(current_user.role, current_user.branch_ids, branch_id)
        target_branches = [branch_id]
    elif current_user.role == "admin":
        target_branches = None  # todas las sucursales
    else:
        target_branches = list(current_user.branch_ids)

    item_query = apply_filter(db.collection(ITEMS), "is_active", "==", True)
    item_query = apply_filter(item_query, "item_type", "==", "materia_prima")
    raw_items = [
        {"id": doc.id, **(doc.to_dict() or {})}
        for doc in item_query.stream()
    ]
    ml_items = [it for it in raw_items if it.get("eligible_for_ml")]
    eval_items = ml_items if ml_items else raw_items

    readiness_items = []
    for it in eval_items:
        iid = it["id"]
        if target_branches is None:
            q = apply_filter(db.collection(CONSUMPTION_DAILY), "item_id", "==", iid)
            q = apply_filter(q, "status", "in", VALIDATED_STATUSES)
            # En vista global contamos fechas únicas o registros validados
            days_count = count_query(q)
        elif len(target_branches) == 1:
            q = apply_filter(db.collection(CONSUMPTION_DAILY), "branch_id", "==", target_branches[0])
            q = apply_filter(q, "item_id", "==", iid)
            q = apply_filter(q, "status", "in", VALIDATED_STATUSES)
            days_count = count_query(q)
        else:
            days_count = 0
            for bid in target_branches:
                q = apply_filter(db.collection(CONSUMPTION_DAILY), "branch_id", "==", bid)
                q = apply_filter(q, "item_id", "==", iid)
                q = apply_filter(q, "status", "in", VALIDATED_STATUSES)
                days_count += count_query(q)

        pct = min(100.0, round((days_count / MIN_TRAINING_DAYS) * 100.0, 1))
        readiness_items.append({
            "item_id": iid,
            "item_code": it.get("code", ""),
            "item_name": it.get("name", ""),
            "base_unit": it.get("base_unit", ""),
            "eligible_for_ml": bool(it.get("eligible_for_ml", False)),
            "accumulated_days": days_count,
            "target_days": MIN_TRAINING_DAYS,
            "min_inference_days": MIN_INFERENCE_DAYS,
            "progress_pct": pct,
            "ready_for_inference": days_count >= MIN_INFERENCE_DAYS,
            "ready_for_training": days_count >= MIN_TRAINING_DAYS,
        })

    readiness_items.sort(key=lambda x: (-x["accumulated_days"], x["item_name"].lower()))
    ready_train = sum(1 for x in readiness_items if x["ready_for_training"])
    ready_infer = sum(1 for x in readiness_items if x["ready_for_inference"])
    max_days = max((x["accumulated_days"] for x in readiness_items), default=0)
    avg_days = round(
        sum(x["accumulated_days"] for x in readiness_items) / len(readiness_items), 1
    ) if readiness_items else 0.0

    return {
        "branch_id": branch_id,
        "min_training_days": MIN_TRAINING_DAYS,
        "min_inference_days": MIN_INFERENCE_DAYS,
        "summary": {
            "total_items": len(readiness_items),
            "ready_for_training": ready_train,
            "ready_for_inference": ready_infer,
            "max_days": max_days,
            "avg_days": avg_days,
        },
        "items": readiness_items,
    }


@router.get("/csv-template")
async def download_csv_template(current_user: AuthUser):
    """Devuelve plantilla CSV estándar para carga histórica de consumos reales."""
    require_permission(current_user.role, "consumption_read")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["fecha", "codigo_item", "cantidad_base", "unidad", "estado", "notas"])
    writer.writerow(["2026-09-01", "MP-POLLO", "48.5", "kg", "medido", "Pesaje cierre de turno"])
    writer.writerow(["2026-09-02", "MP-POLLO", "52.0", "kg", "calculado_validado", "Balance inventario"])
    writer.writerow(["2026-09-03", "MP-POLLO", "", "kg", "desconocido", "Sin registro físico"])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=plantilla_consumo_historico.csv"},
    )


@router.post("/import-csv", status_code=status.HTTP_201_CREATED)
async def import_consumption_csv(
    current_user: AuthUser,
    db: DbClient,
    branch_id: str = Form(...),
    file: UploadFile = File(...),
):
    """
    Importación masiva de consumo histórico desde CSV.
    - Deduplicación por archivo mediante SHA-256 en `import_batches/{branch_id}__{sha256}`.
    - Respeta el límite de 500 operaciones por batch en Firestore (chunks de 400).
    - No sobrescribe registros ya existentes para `(branch_id, item_id, consumption_date)`.
    """
    require_permission(current_user.role, "consumption_write")
    require_branch_access(current_user.role, current_user.branch_ids, branch_id)

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="El archivo CSV está vacío")

    file_hash = hashlib.sha256(raw_bytes).hexdigest()
    batch_id = import_batch_doc_id(branch_id, file_hash)
    batch_doc_ref = db.collection(IMPORT_BATCHES).document(batch_id)
    existing_batch = batch_doc_ref.get()
    if existing_batch.exists and (existing_batch.to_dict() or {}).get("status") == ImportStatus.procesado.value:
        raise HTTPException(
            status_code=409,
            detail="Este archivo CSV ya fue importado previamente para esta sucursal.",
        )

    try:
        text_content = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text_content = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text_content))
    if not reader.fieldnames:
        raise HTTPException(status_code=422, detail="El CSV no contiene encabezados válidos")

    normalized_headers = {h.strip().lower() for h in reader.fieldnames if h}
    required_headers = {"fecha", "codigo_item", "estado"}
    if not required_headers.issubset(normalized_headers):
        raise HTTPException(
            status_code=422,
            detail="Encabezados requeridos: fecha, codigo_item, cantidad_base, unidad, estado, notas",
        )

    # Mapa de ítems activos por código en mayúsculas
    items_by_code: dict[str, dict] = {}
    for doc in apply_filter(db.collection(ITEMS), "is_active", "==", True).stream():
        d = doc.to_dict() or {}
        code_key = str(d.get("code", "")).strip().upper()
        if code_key:
            items_by_code[code_key] = {"id": doc.id, **d}

    valid_records: list[tuple[str, dict]] = []
    seen_doc_ids: set[str] = set()
    errors: list[str] = []
    rows_total = 0
    now = now_utc()

    for line_num, raw_row in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw_row.items()}
        if not any(row.values()):
            continue
        rows_total += 1

        # Fecha
        try:
            cons_date = date.fromisoformat(row.get("fecha", ""))
        except ValueError:
            errors.append(f"Fila {line_num}: fecha inválida '{row.get('fecha', '')}' (esperado YYYY-MM-DD)")
            continue

        # Ítem
        code = row.get("codigo_item", "").upper()
        item = items_by_code.get(code)
        if not item:
            errors.append(f"Fila {line_num}: código de ítem '{code}' no existe o está inactivo")
            continue

        # Estado
        raw_status = row.get("estado", "").lower()
        try:
            cons_status = ConsumptionStatus(raw_status)
        except ValueError:
            errors.append(
                f"Fila {line_num}: estado inválido '{raw_status}' "
                f"(válidos: medido, calculado_validado, desconocido)"
            )
            continue

        # Cantidad
        raw_qty = row.get("cantidad_base", "")
        qty_val: Optional[float] = None
        if cons_status == ConsumptionStatus.desconocido:
            qty_val = None if raw_qty == "" else float(raw_qty)
        else:
            if raw_qty == "":
                errors.append(f"Fila {line_num}: cantidad_base es obligatoria para estado '{cons_status.value}'")
                continue
            try:
                qty_val = float(raw_qty.replace(",", "."))
                if qty_val < 0:
                    raise ValueError("negativo")
            except ValueError:
                errors.append(f"Fila {line_num}: cantidad_base inválida '{raw_qty}'")
                continue

        doc_id = consumption_doc_id(branch_id, item["id"], cons_date)
        if doc_id in seen_doc_ids:
            errors.append(f"Fila {line_num}: registro duplicado dentro del CSV ({code}, {cons_date})")
            continue
        if db.collection(CONSUMPTION_DAILY).document(doc_id).get().exists:
            errors.append(f"Fila {line_num}: ya existe consumo registrado en BD ({code}, {cons_date})")
            continue

        seen_doc_ids.add(doc_id)
        unit = row.get("unidad") or item.get("base_unit", "kg")
        valid_records.append((doc_id, {
            "branch_id": branch_id,
            "item_id": item["id"],
            "consumption_date": cons_date.isoformat(),
            "quantity_base": qty_val,
            "unit": unit,
            "status": cons_status.value,
            "method_notes": row.get("notas") or f"Importado desde CSV ({file.filename})",
            "import_batch_id": batch_id,
            "created_by_uid": current_user.firebase_uid,
            "created_at": now,
            "updated_at": now,
        }))

    # Escritura en lotes de máximo 400 ops (límite Firestore: 500)
    chunk_size = 400
    for i in range(0, len(valid_records), chunk_size):
        chunk = valid_records[i : i + chunk_size]
        batch = db.batch()
        for doc_id, payload in chunk:
            batch.create(db.collection(CONSUMPTION_DAILY).document(doc_id), payload)
        batch.commit()

    batch_status = ImportStatus.procesado.value if valid_records else ImportStatus.rechazado.value
    batch_doc_ref.set({
        "branch_id": branch_id,
        "file_hash": file_hash,
        "original_filename": file.filename or "consumo.csv",
        "status": batch_status,
        "rows_total": rows_total,
        "rows_ok": len(valid_records),
        "rows_rejected": len(errors),
        "rejection_summary": "\n".join(errors[:50]) if errors else None,
        "created_by_uid": current_user.firebase_uid,
        "created_at": now,
    })

    record_audit(
        db=db,
        current_user=current_user,
        action="IMPORT_CSV",
        entity_type="consumption_daily",
        entity_id=batch_id,
        branch_id=branch_id,
        details={
            "filename": file.filename,
            "rows_total": rows_total,
            "rows_ok": len(valid_records),
            "rows_rejected": len(errors),
        },
    )

    return {
        "import_batch_id": batch_id,
        "status": batch_status,
        "rows_total": rows_total,
        "rows_ok": len(valid_records),
        "rows_rejected": len(errors),
        "errors": errors[:30],
    }


@router.get("/")
async def list_consumption(
    current_user: AuthUser,
    db: DbClient,
    branch_id: Optional[str] = None,
    item_id: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 200,
):
    require_permission(current_user.role, "consumption_read")

    docs = []
    if branch_id:
        require_branch_access(current_user.role, current_user.branch_ids, branch_id)
        docs = list(apply_filter(db.collection(CONSUMPTION_DAILY), "branch_id", "==", branch_id).stream())
    elif current_user.role == "admin":
        docs = list(db.collection(CONSUMPTION_DAILY).stream())
    else:
        for bid in current_user.branch_ids:
            docs.extend(apply_filter(db.collection(CONSUMPTION_DAILY), "branch_id", "==", bid).stream())

    from_str = from_date.isoformat() if from_date else None
    to_str = to_date.isoformat() if to_date else None

    records = []
    for doc in docs:
        d = doc.to_dict() or {}
        if item_id and d.get("item_id") != item_id:
            continue
        cdate = d.get("consumption_date") or ""
        if from_str and cdate < from_str:
            continue
        if to_str and cdate > to_str:
            continue
        qty = d.get("quantity_base")
        records.append({
            "id": doc.id,
            "branch_id": d.get("branch_id"),
            "item_id": d.get("item_id"),
            "consumption_date": cdate,
            "quantity_base": float(qty) if qty is not None else None,
            "unit": d.get("unit", ""),
            "status": d.get("status", "desconocido"),
            "method_notes": d.get("method_notes"),
            "created_by_uid": d.get("created_by_uid"),
            "created_at": to_iso(d.get("created_at")),
        })

    records.sort(key=lambda r: (r["consumption_date"], r.get("created_at") or ""), reverse=True)
    return records[skip : skip + limit]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def register_consumption(data: ConsumptionCreateSchema, current_user: AuthUser, db: DbClient):
    """
    Registra consumo diario real usando ID determinístico `{branch_id}__{item_id}__{YYYY-MM-DD}`.
    - Si status=DESCONOCIDO: quantity_base puede ser None (nunca genera cero automático).
    - Unicidad atómica garantizada con `batch.create()`.
    """
    require_permission(current_user.role, "consumption_write")
    require_branch_access(current_user.role, current_user.branch_ids, data.branch_id)

    item_snap = db.collection(ITEMS).document(data.item_id).get()
    if not item_snap.exists or not (item_snap.to_dict() or {}).get("is_active", False):
        raise HTTPException(status_code=404, detail="Ítem no encontrado o inactivo")

    if data.status != ConsumptionStatus.desconocido and data.quantity_base is None:
        raise HTTPException(status_code=422, detail="quantity_base es requerido para status confirmado")
    if data.quantity_base is not None and data.quantity_base < 0:
        raise HTTPException(status_code=422, detail="quantity_base no puede ser negativo")

    doc_id = consumption_doc_id(data.branch_id, data.item_id, data.consumption_date)
    doc_ref = db.collection(CONSUMPTION_DAILY).document(doc_id)
    now = now_utc()
    qty_val = float(data.quantity_base) if data.quantity_base is not None else None

    try:
        batch = db.batch()
        batch.create(doc_ref, {
            "branch_id": data.branch_id,
            "item_id": data.item_id,
            "consumption_date": data.consumption_date.isoformat(),
            "quantity_base": qty_val,
            "unit": data.unit,
            "status": data.status.value,
            "method_notes": data.method_notes,
            "created_by_uid": current_user.firebase_uid,
            "created_at": now,
            "updated_at": now,
        })
        record_audit(
            db=db,
            current_user=current_user,
            action="CREATE",
            entity_type="consumption_daily",
            entity_id=doc_id,
            branch_id=data.branch_id,
            details={
                "item_id": data.item_id,
                "consumption_date": data.consumption_date.isoformat(),
                "quantity_base": qty_val,
                "status": data.status.value,
            },
            batch=batch,
        )
        batch.commit()
    except Exception as exc:
        if is_already_exists_error(exc):
            raise HTTPException(
                status_code=409,
                detail="Ya existe un registro de consumo para esta fecha, ítem y sucursal",
            ) from exc
        raise

    return {"id": doc_id, "message": "Consumo registrado"}
