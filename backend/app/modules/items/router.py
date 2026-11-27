"""
Módulo Items — catálogo de materias primas e insumos en Cloud Firestore.
Garantiza unicidad de `code` mediante transacción atómica sobre `item_codes/{CODE}`.
"""
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import AuthUser, DbClient
from app.core.audit import record_audit
from app.core.permissions import require_permission
from app.db.collections import ITEM_CODES, ITEMS, apply_filter, item_code_doc_id
from app.db.firestore_client import run_transaction
from app.db.models import ItemType, now_utc, to_iso

router = APIRouter()


class ItemCreateSchema(BaseModel):
    code: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    item_type: ItemType
    category: Optional[str] = None
    base_unit: str = Field(..., min_length=1)
    min_stock: Optional[Decimal] = None
    eligible_for_ml: bool = False
    notes: Optional[str] = None


class ItemUpdateSchema(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    base_unit: Optional[str] = None
    min_stock: Optional[Decimal] = None
    eligible_for_ml: Optional[bool] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


def _serialize_item(doc_id: str, d: dict, include_notes: bool = False) -> dict:
    payload = {
        "id": doc_id,
        "code": d.get("code", ""),
        "name": d.get("name", ""),
        "item_type": d.get("item_type", "materia_prima"),
        "category": d.get("category"),
        "base_unit": d.get("base_unit", ""),
        "min_stock": float(d["min_stock"]) if d.get("min_stock") is not None else None,
        "eligible_for_ml": bool(d.get("eligible_for_ml", False)),
        "is_active": bool(d.get("is_active", True)),
        "created_at": to_iso(d.get("created_at")),
    }
    if include_notes:
        payload["notes"] = d.get("notes")
    return payload


@router.get("/")
async def list_items(
    current_user: AuthUser,
    db: DbClient,
    item_type: Optional[ItemType] = None,
    skip: int = 0,
    limit: int = 200,
):
    require_permission(current_user.role, "items_read")
    query = apply_filter(db.collection(ITEMS), "is_active", "==", True)
    if item_type:
        query = apply_filter(query, "item_type", "==", item_type.value)

    docs = list(query.stream())
    items = [_serialize_item(doc.id, doc.to_dict() or {}, include_notes=True) for doc in docs]
    items.sort(key=lambda x: x["name"].lower())
    return items[skip : skip + limit]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_item(data: ItemCreateSchema, current_user: AuthUser, db: DbClient):
    require_permission(current_user.role, "items_write")

    code_norm = data.code.strip().upper()
    code_ref = db.collection(ITEM_CODES).document(item_code_doc_id(code_norm))
    item_ref = db.collection(ITEMS).document()
    now = now_utc()

    def _create_txn(transaction):
        # 1. Lectura previa obligatoria
        code_snap = code_ref.get(transaction=transaction)
        if code_snap.exists:
            raise HTTPException(status_code=409, detail="Código de ítem ya existe")

        # 2. Escrituras atómicas
        transaction.create(code_ref, {"item_id": item_ref.id, "code": code_norm, "created_at": now})
        transaction.create(item_ref, {
            "code": code_norm,
            "name": data.name.strip(),
            "item_type": data.item_type.value,
            "category": data.category.strip() if data.category else None,
            "base_unit": data.base_unit.strip(),
            "min_stock": float(data.min_stock) if data.min_stock is not None else None,
            "eligible_for_ml": data.eligible_for_ml,
            "is_active": True,
            "notes": data.notes,
            "created_by_uid": current_user.firebase_uid,
            "created_at": now,
            "updated_at": now,
        })
        record_audit(
            db=db,
            current_user=current_user,
            action="CREATE",
            entity_type="item",
            entity_id=item_ref.id,
            details={"code": code_norm, "name": data.name.strip(), "item_type": data.item_type.value},
            transaction=transaction,
        )

    run_transaction(db, _create_txn)
    return {"id": item_ref.id, "code": code_norm, "name": data.name.strip()}


@router.get("/{item_id}")
async def get_item(item_id: str, current_user: AuthUser, db: DbClient):
    require_permission(current_user.role, "items_read")
    snap = db.collection(ITEMS).document(item_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    return _serialize_item(snap.id, snap.to_dict() or {}, include_notes=True)


@router.patch("/{item_id}")
async def update_item(item_id: str, data: ItemUpdateSchema, current_user: AuthUser, db: DbClient):
    require_permission(current_user.role, "items_write")
    ref = db.collection(ITEMS).document(item_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")

    updates = {"updated_at": now_utc()}
    for field, value in data.model_dump(exclude_none=True).items():
        updates[field] = float(value) if isinstance(value, Decimal) else value

    ref.update(updates)
    record_audit(
        db=db,
        current_user=current_user,
        action="UPDATE",
        entity_type="item",
        entity_id=item_id,
        details={k: v for k, v in updates.items() if k != "updated_at"},
    )
    return {"message": "Ítem actualizado"}


@router.delete("/{item_id}")
async def deactivate_item(item_id: str, current_user: AuthUser, db: DbClient):
    """Desactivar sin borrar historial (soft delete)."""
    require_permission(current_user.role, "items_write")
    ref = db.collection(ITEMS).document(item_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    ref.update({"is_active": False, "updated_at": now_utc()})
    record_audit(
        db=db,
        current_user=current_user,
        action="SOFT_DELETE",
        entity_type="item",
        entity_id=item_id,
    )
    return {"message": "Ítem desactivado (historial conservado)"}
