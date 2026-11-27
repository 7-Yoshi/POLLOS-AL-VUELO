"""Módulo Branches — gestión de sucursales en Cloud Firestore."""
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import AuthUser, DbClient
from app.core.audit import record_audit
from app.core.permissions import require_permission
from app.db.collections import BRANCHES, apply_filter
from app.db.models import now_utc, to_iso

router = APIRouter()


class BranchCreateSchema(BaseModel):
    name: str = Field(..., min_length=2)
    address: Optional[str] = None
    phone: Optional[str] = None


class BranchUpdateSchema(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/")
async def list_branches(current_user: AuthUser, db: DbClient, include_inactive: bool = False):
    query = db.collection(BRANCHES)
    if not include_inactive:
        query = apply_filter(query, "is_active", "==", True)
    docs = list(query.stream())

    branches = []
    for doc in docs:
        d = doc.to_dict() or {}
        if current_user.role != "admin" and doc.id not in current_user.branch_ids:
            continue
        branches.append({
            "id": doc.id,
            "name": d.get("name", ""),
            "address": d.get("address"),
            "phone": d.get("phone"),
            "is_active": bool(d.get("is_active", True)),
            "created_at": to_iso(d.get("created_at")),
        })
    branches.sort(key=lambda b: b["name"].lower())
    return branches


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_branch(data: BranchCreateSchema, current_user: AuthUser, db: DbClient):
    require_permission(current_user.role, "branches_write")
    now = now_utc()
    ref = db.collection(BRANCHES).document()
    ref.set({
        "name": data.name.strip(),
        "address": data.address.strip() if data.address else None,
        "phone": data.phone.strip() if data.phone else None,
        "is_active": True,
        "created_by_uid": current_user.firebase_uid,
        "created_at": now,
        "updated_at": now,
    })
    record_audit(
        db=db,
        current_user=current_user,
        action="CREATE",
        entity_type="branch",
        entity_id=ref.id,
        branch_id=ref.id,
        details={"name": data.name.strip()},
    )
    return {"id": ref.id, "name": data.name.strip()}


@router.patch("/{branch_id}")
async def update_branch(branch_id: str, data: BranchUpdateSchema, current_user: AuthUser, db: DbClient):
    require_permission(current_user.role, "branches_write")
    ref = db.collection(BRANCHES).document(branch_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")

    updates: dict = {"updated_at": now_utc()}
    if data.name is not None:
        updates["name"] = data.name.strip()
    if data.address is not None:
        updates["address"] = data.address.strip() or None
    if data.phone is not None:
        updates["phone"] = data.phone.strip() or None
    if data.is_active is not None:
        updates["is_active"] = data.is_active

    ref.update(updates)
    record_audit(
        db=db,
        current_user=current_user,
        action="UPDATE",
        entity_type="branch",
        entity_id=branch_id,
        branch_id=branch_id,
        details={k: v for k, v in updates.items() if k != "updated_at"},
    )
    return {"message": "Sucursal actualizada"}
