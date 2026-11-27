"""
Módulo Inventario — vista materializada `inventory_balances` y movimientos atómicos en Firestore.
Consultar el saldo actual cuesta 1 lectura por ítem (en lugar de escanear todo el historial).
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import AuthUser, DbClient
from app.core.audit import record_audit
from app.core.permissions import require_branch_access, require_permission
from app.db.collections import (
    INVENTORY_BALANCES,
    INVENTORY_MOVEMENTS,
    ITEMS,
    apply_filter,
    balance_doc_id,
)
from app.db.firestore_client import run_transaction
from app.db.models import MovementType, now_utc, signed_movement_quantity, to_iso

router = APIRouter()


class MovementCreateSchema(BaseModel):
    branch_id: str
    item_id: str
    movement_type: MovementType
    quantity_base: Decimal
    unit: str
    effective_date: date
    notes: Optional[str] = None


@router.get("/balance")
async def get_balance(
    current_user: AuthUser,
    db: DbClient,
    branch_id: Optional[str] = None,
    item_id: Optional[str] = None,
    as_of: Optional[date] = None,
):
    """
    Obtiene el saldo de inventario por sucursal e ítem.
    - Sin `as_of`: lectura O(N_items) directa desde la vista materializada `inventory_balances`.
    - Con `as_of`: reconstruye el saldo histórico acumulando `signed_quantity` hasta `as_of`.
    """
    require_permission(current_user.role, "inventory_read")

    if branch_id:
        require_branch_access(current_user.role, current_user.branch_ids, branch_id)

    # Reconstrucción histórica puntual
    if as_of is not None:
        docs = []
        if branch_id:
            docs = list(apply_filter(db.collection(INVENTORY_MOVEMENTS), "branch_id", "==", branch_id).stream())
        elif current_user.role == "admin":
            docs = list(db.collection(INVENTORY_MOVEMENTS).stream())
        else:
            for bid in current_user.branch_ids:
                docs.extend(apply_filter(db.collection(INVENTORY_MOVEMENTS), "branch_id", "==", bid).stream())

        as_of_str = as_of.isoformat()
        totals: dict[tuple[str, str], float] = {}
        for doc in docs:
            d = doc.to_dict() or {}
            if item_id and d.get("item_id") != item_id:
                continue
            if (d.get("effective_date") or "") > as_of_str:
                continue
            key = (str(d.get("branch_id")), str(d.get("item_id")))
            delta = float(
                d.get(
                    "signed_quantity",
                    signed_movement_quantity(d.get("movement_type", "consumo"), d.get("quantity_base", 0)),
                )
            )
            totals[key] = round(totals.get(key, 0.0) + delta, 4)

        return [
            {"branch_id": b, "item_id": iid, "balance": bal}
            for (b, iid), bal in sorted(totals.items())
        ]

    # Lectura rápida desde vista materializada `inventory_balances`
    docs = []
    if branch_id:
        docs = list(apply_filter(db.collection(INVENTORY_BALANCES), "branch_id", "==", branch_id).stream())
    elif current_user.role == "admin":
        docs = list(db.collection(INVENTORY_BALANCES).stream())
    else:
        for bid in current_user.branch_ids:
            docs.extend(apply_filter(db.collection(INVENTORY_BALANCES), "branch_id", "==", bid).stream())

    results = []
    for doc in docs:
        d = doc.to_dict() or {}
        if item_id and d.get("item_id") != item_id:
            continue
        results.append({
            "branch_id": d.get("branch_id"),
            "item_id": d.get("item_id"),
            "balance": round(float(d.get("balance", 0.0)), 4),
            "unit": d.get("unit"),
            "updated_at": to_iso(d.get("updated_at")),
        })
    return results


@router.post("/movements", status_code=status.HTTP_201_CREATED)
async def add_movement(data: MovementCreateSchema, current_user: AuthUser, db: DbClient):
    """Registra un movimiento de inventario y actualiza `inventory_balances` atómicamente."""
    require_permission(current_user.role, "inventory_write")
    require_branch_access(current_user.role, current_user.branch_ids, data.branch_id)

    qty_abs = abs(float(data.quantity_base))
    if qty_abs <= 0:
        raise HTTPException(status_code=422, detail="La cantidad debe ser mayor a 0")

    signed_qty = signed_movement_quantity(data.movement_type, qty_abs)
    mov_ref = db.collection(INVENTORY_MOVEMENTS).document()
    item_ref = db.collection(ITEMS).document(data.item_id)
    bal_ref = db.collection(INVENTORY_BALANCES).document(balance_doc_id(data.branch_id, data.item_id))
    now = now_utc()
    date_str = data.effective_date.isoformat()

    def _movement_txn(transaction):
        # Lecturas previas
        item_snap = item_ref.get(transaction=transaction)
        if not item_snap.exists or not (item_snap.to_dict() or {}).get("is_active", False):
            raise HTTPException(status_code=404, detail="Ítem no encontrado o inactivo")

        bal_snap = bal_ref.get(transaction=transaction)
        current_bal = float((bal_snap.to_dict() or {}).get("balance", 0.0)) if bal_snap.exists else 0.0
        new_bal = round(current_bal + signed_qty, 4)

        # Escrituras atómicas
        transaction.create(mov_ref, {
            "branch_id": data.branch_id,
            "item_id": data.item_id,
            "movement_type": data.movement_type.value,
            "quantity_base": qty_abs,
            "signed_quantity": signed_qty,
            "unit": data.unit,
            "effective_date": date_str,
            "notes": data.notes,
            "created_by_uid": current_user.firebase_uid,
            "created_at": now,
        })
        transaction.set(bal_ref, {
            "branch_id": data.branch_id,
            "item_id": data.item_id,
            "balance": new_bal,
            "unit": (item_snap.to_dict() or {}).get("base_unit", data.unit),
            "updated_at": now,
        })
        record_audit(
            db=db,
            current_user=current_user,
            action="CREATE",
            entity_type="inventory_movement",
            entity_id=mov_ref.id,
            branch_id=data.branch_id,
            details={
                "item_id": data.item_id,
                "movement_type": data.movement_type.value,
                "quantity_base": qty_abs,
                "new_balance": new_bal,
            },
            transaction=transaction,
        )

    run_transaction(db, _movement_txn)
    return {"id": mov_ref.id, "message": "Movimiento registrado"}


@router.get("/movements")
async def list_movements(
    current_user: AuthUser,
    db: DbClient,
    branch_id: Optional[str] = None,
    item_id: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 100,
):
    require_permission(current_user.role, "inventory_read")

    docs = []
    if branch_id:
        require_branch_access(current_user.role, current_user.branch_ids, branch_id)
        docs = list(apply_filter(db.collection(INVENTORY_MOVEMENTS), "branch_id", "==", branch_id).stream())
    elif current_user.role == "admin":
        docs = list(db.collection(INVENTORY_MOVEMENTS).stream())
    else:
        for bid in current_user.branch_ids:
            docs.extend(apply_filter(db.collection(INVENTORY_MOVEMENTS), "branch_id", "==", bid).stream())

    from_str = from_date.isoformat() if from_date else None
    to_str = to_date.isoformat() if to_date else None

    movements = []
    for doc in docs:
        d = doc.to_dict() or {}
        if item_id and d.get("item_id") != item_id:
            continue
        eff = d.get("effective_date") or ""
        if from_str and eff < from_str:
            continue
        if to_str and eff > to_str:
            continue
        movements.append({
            "id": doc.id,
            "branch_id": d.get("branch_id"),
            "item_id": d.get("item_id"),
            "movement_type": d.get("movement_type"),
            "quantity_base": float(d.get("quantity_base", 0.0)),
            "unit": d.get("unit", ""),
            "effective_date": eff,
            "notes": d.get("notes"),
            "created_by_uid": d.get("created_by_uid"),
            "created_at": to_iso(d.get("created_at")),
        })

    movements.sort(key=lambda m: (m["effective_date"], m.get("created_at") or ""), reverse=True)
    return movements[skip : skip + limit]
