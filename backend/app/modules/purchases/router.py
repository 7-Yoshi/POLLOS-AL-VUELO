"""
Módulo Purchases — compras transaccionales atómicas en Cloud Firestore.
En una sola transacción: crea `purchases/{id}` (con `lines` embebidas), genera los
`inventory_movements` de entrada, actualiza la vista materializada `inventory_balances`
y registra la trazabilidad en `audit_logs`. Nunca genera consumo automático.
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
    BRANCHES,
    INVENTORY_BALANCES,
    INVENTORY_MOVEMENTS,
    ITEMS,
    PURCHASES,
    apply_filter,
    balance_doc_id,
)
from app.db.firestore_client import run_transaction
from app.db.models import MovementType, now_utc, to_iso

router = APIRouter()


class PurchaseLineInput(BaseModel):
    item_id: str
    quantity_base: Decimal
    unit: str
    unit_cost: Optional[Decimal] = None
    notes: Optional[str] = None


class PurchaseCreateSchema(BaseModel):
    branch_id: str
    purchase_date: date
    supplier: Optional[str] = None
    notes: Optional[str] = None
    lines: list[PurchaseLineInput]


@router.get("/")
async def list_purchases(
    current_user: AuthUser,
    db: DbClient,
    branch_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
):
    require_permission(current_user.role, "purchases_read")

    docs = []
    if branch_id:
        require_branch_access(current_user.role, current_user.branch_ids, branch_id)
        docs = list(apply_filter(db.collection(PURCHASES), "branch_id", "==", branch_id).stream())
    elif current_user.role == "admin":
        docs = list(db.collection(PURCHASES).stream())
    else:
        for bid in current_user.branch_ids:
            docs.extend(apply_filter(db.collection(PURCHASES), "branch_id", "==", bid).stream())

    purchases = []
    for doc in docs:
        d = doc.to_dict() or {}
        purchases.append({
            "id": doc.id,
            "branch_id": d.get("branch_id"),
            "branch_name": d.get("branch_name"),
            "purchase_date": d.get("purchase_date"),
            "supplier": d.get("supplier"),
            "lines_count": int(d.get("lines_count", len(d.get("lines", [])))),
            "created_by_uid": d.get("created_by_uid"),
            "created_at": to_iso(d.get("created_at")),
        })
    purchases.sort(key=lambda p: (p.get("purchase_date") or "", p.get("created_at") or ""), reverse=True)
    return purchases[skip : skip + limit]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_purchase(data: PurchaseCreateSchema, current_user: AuthUser, db: DbClient):
    """
    Registra compra de forma ATÓMICA en Cloud Firestore:
    purchases/{id} + inventory_movements + inventory_balances + audit_logs.
    """
    require_permission(current_user.role, "purchases_write")
    require_branch_access(current_user.role, current_user.branch_ids, data.branch_id)

    if not data.lines:
        raise HTTPException(status_code=422, detail="La compra debe tener al menos una línea")

    for line in data.lines:
        if line.quantity_base <= 0:
            raise HTTPException(
                status_code=422,
                detail=f"Cantidad debe ser positiva para ítem {line.item_id}",
            )

    purchase_ref = db.collection(PURCHASES).document()
    branch_ref = db.collection(BRANCHES).document(data.branch_id)
    unique_item_ids = list(dict.fromkeys(line.item_id for line in data.lines))
    now = now_utc()
    date_str = data.purchase_date.isoformat()

    def _purchase_txn(transaction):
        # ── FASE 1: Todas las lecturas antes de cualquier escritura (regla Firestore) ──
        branch_snap = branch_ref.get(transaction=transaction)
        if not branch_snap.exists:
            raise HTTPException(status_code=404, detail=f"Sucursal '{data.branch_id}' no encontrada")
        branch_name = (branch_snap.to_dict() or {}).get("name", data.branch_id)

        item_docs: dict[str, dict] = {}
        balance_snaps: dict[str, dict] = {}
        for iid in unique_item_ids:
            item_snap = db.collection(ITEMS).document(iid).get(transaction=transaction)
            if not item_snap.exists or not (item_snap.to_dict() or {}).get("is_active", False):
                raise HTTPException(status_code=404, detail=f"Ítem '{iid}' no encontrado o inactivo")
            item_docs[iid] = item_snap.to_dict() or {}

            bal_ref = db.collection(INVENTORY_BALANCES).document(balance_doc_id(data.branch_id, iid))
            bal_snap = bal_ref.get(transaction=transaction)
            balance_snaps[iid] = bal_snap.to_dict() if bal_snap.exists else {}

        # ── FASE 2: Preparar líneas embebidas y deltas acumulados por ítem ──
        embedded_lines = []
        deltas_by_item: dict[str, float] = {}
        units_by_item: dict[str, str] = {}

        for idx, line_data in enumerate(data.lines):
            qty = float(line_data.quantity_base)
            item_meta = item_docs[line_data.item_id]
            embedded_lines.append({
                "line_index": idx + 1,
                "item_id": line_data.item_id,
                "item_name": item_meta.get("name"),
                "quantity_base": qty,
                "unit": line_data.unit,
                "unit_cost": float(line_data.unit_cost) if line_data.unit_cost is not None else None,
                "notes": line_data.notes,
            })
            deltas_by_item[line_data.item_id] = deltas_by_item.get(line_data.item_id, 0.0) + qty
            units_by_item[line_data.item_id] = item_meta.get("base_unit", line_data.unit)

        # ── FASE 3: Todas las escrituras atómicas ──
        transaction.create(purchase_ref, {
            "branch_id": data.branch_id,
            "branch_name": branch_name,
            "purchase_date": date_str,
            "supplier": data.supplier,
            "notes": data.notes,
            "lines": embedded_lines,
            "lines_count": len(embedded_lines),
            "created_by_uid": current_user.firebase_uid,
            "created_at": now,
            "updated_at": now,
        })

        for line_item in embedded_lines:
            mov_ref = db.collection(INVENTORY_MOVEMENTS).document()
            transaction.create(mov_ref, {
                "branch_id": data.branch_id,
                "item_id": line_item["item_id"],
                "movement_type": MovementType.compra.value,
                "quantity_base": line_item["quantity_base"],
                "signed_quantity": line_item["quantity_base"],
                "unit": line_item["unit"],
                "effective_date": date_str,
                "reference_purchase_id": purchase_ref.id,
                "notes": line_item["notes"] or f"Compra #{purchase_ref.id}",
                "created_by_uid": current_user.firebase_uid,
                "created_at": now,
            })

        for iid, delta in deltas_by_item.items():
            bal_ref = db.collection(INVENTORY_BALANCES).document(balance_doc_id(data.branch_id, iid))
            current_bal = float(balance_snaps[iid].get("balance", 0.0))
            new_bal = round(current_bal + delta, 4)
            transaction.set(bal_ref, {
                "branch_id": data.branch_id,
                "item_id": iid,
                "balance": new_bal,
                "unit": units_by_item[iid],
                "updated_at": now,
            })

        record_audit(
            db=db,
            current_user=current_user,
            action="CREATE",
            entity_type="purchase",
            entity_id=purchase_ref.id,
            branch_id=data.branch_id,
            details={
                "purchase_date": date_str,
                "supplier": data.supplier,
                "lines_count": len(embedded_lines),
            },
            transaction=transaction,
        )

    run_transaction(db, _purchase_txn)
    return {"id": purchase_ref.id, "message": "Compra registrada correctamente"}


@router.get("/{purchase_id}")
async def get_purchase(purchase_id: str, current_user: AuthUser, db: DbClient):
    require_permission(current_user.role, "purchases_read")
    snap = db.collection(PURCHASES).document(purchase_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Compra no encontrada")

    d = snap.to_dict() or {}
    require_branch_access(current_user.role, current_user.branch_ids, d.get("branch_id"))
    return {
        "id": snap.id,
        "branch_id": d.get("branch_id"),
        "branch_name": d.get("branch_name"),
        "purchase_date": d.get("purchase_date"),
        "supplier": d.get("supplier"),
        "notes": d.get("notes"),
        "created_by_uid": d.get("created_by_uid"),
        "created_at": to_iso(d.get("created_at")),
        "lines": d.get("lines", []),
    }
