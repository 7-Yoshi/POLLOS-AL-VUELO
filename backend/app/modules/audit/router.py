"""
Módulo Auditoría — consulta inmutable de trazabilidad en `audit_logs` (Cloud Firestore).
- Administrador: consulta toda la auditoría de las 3 sucursales y eventos del sistema.
- Gerente: consulta únicamente los eventos de auditoría de sus sucursales asignadas.
- Encargado y demás trabajadores: sin acceso (HTTP 403).
- Inmutabilidad absoluta: ningún rol (incluido Administrador) puede modificar o eliminar registros.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, status

from app.api.deps import AuthUser, DbClient
from app.core.permissions import require_branch_access, require_permission
from app.db.collections import AUDIT_LOGS, apply_filter
from app.db.models import to_iso

router = APIRouter()

IMMUTABLE_AUDIT_DETAIL = "Los registros de auditoría son inmutables y no pueden modificarse ni eliminarse."


@router.get("/")
async def list_audit_logs(
    current_user: AuthUser,
    db: DbClient,
    branch_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    action: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 100,
):
    require_permission(current_user.role, "audit_read")

    query = db.collection(AUDIT_LOGS)
    if branch_id:
        require_branch_access(current_user.role, current_user.branch_ids, branch_id)
        query = apply_filter(query, "branch_id", "==", branch_id)
    elif entity_type:
        query = apply_filter(query, "entity_type", "==", entity_type)

    docs = list(query.stream())
    logs = []
    for doc in docs:
        d = doc.to_dict() or {}
        doc_branch = d.get("branch_id")
        # Gerente solo ve eventos pertenecientes a sus sucursales asignadas (nunca eventos globales de usuarios)
        if current_user.role != "admin":
            if doc_branch is None or doc_branch not in current_user.branch_ids:
                continue
        if entity_type and d.get("entity_type") != entity_type:
            continue
        if action and d.get("action") != action:
            continue
        created_iso = to_iso(d.get("created_at")) or ""
        created_day = created_iso[:10]
        if from_date and created_day and created_day < from_date.isoformat():
            continue
        if to_date and created_day and created_day > to_date.isoformat():
            continue
        logs.append({
            "id": doc.id,
            "firebase_uid": d.get("firebase_uid"),
            "user_email": d.get("user_email"),
            "user_role": d.get("user_role"),
            "action": d.get("action"),
            "entity_type": d.get("entity_type"),
            "entity_id": d.get("entity_id"),
            "branch_id": doc_branch,
            "details": d.get("details"),
            "created_at": created_iso,
        })

    logs.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return logs[skip : skip + limit]


@router.put("/{log_id}")
@router.patch("/{log_id}")
@router.delete("/{log_id}")
async def reject_audit_mutation(log_id: str, current_user: AuthUser):
    """Bloqueo explícito de modificación o eliminación de auditoría para todos los roles (incluido Admin)."""
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=IMMUTABLE_AUDIT_DETAIL,
    )
