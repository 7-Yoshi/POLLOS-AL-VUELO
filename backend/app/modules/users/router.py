"""
Módulo Users — gestión unificada de usuarios en Firebase Authentication + Cloud Firestore.
- POST /users/ crea la cuenta en Firebase Auth (Admin SDK), asigna custom claim `role`
  y guarda el perfil `users/{uid}` en Firestore con compensación si falla Firestore.
- Valida cardinalidad estricta Rol <-> Sucursales:
    * admin: acceso a todas las sucursales activas (auto-asignadas si se omiten).
    * gerente: al menos 1 sucursal asignada.
    * encargado: exactamente 1 sucursal asignada.
- PATCH /users/{uid} permite editar rol/sucursales y revoca refresh tokens al desactivar.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import AuthUser, DbClient
from app.core.audit import record_audit
from app.core.firebase_auth import (
    create_firebase_user,
    delete_firebase_user,
    revoke_user_sessions,
    set_user_role_claim,
)
from app.core.permissions import require_permission
from app.db.collections import BRANCHES, USERS, apply_filter
from app.db.firestore_client import is_already_exists_error
from app.db.models import RoleName, now_utc, to_iso

router = APIRouter()


class UserCreateSchema(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, description="Contraseña temporal inicial")
    full_name: str = Field(..., min_length=2)
    username: Optional[str] = None
    role: RoleName
    branch_ids: list[str] = []
    must_change_password: bool = True


class UserUpdateSchema(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    role: Optional[RoleName] = None
    branch_ids: Optional[list[str]] = None
    is_active: Optional[bool] = None
    must_change_password: Optional[bool] = None


def _validate_role_branches(db: DbClient, role: RoleName, branch_ids: list[str]) -> list[str]:
    """
    Valida existencia y cardinalidad de sucursales según el rol:
      - admin: si se envía vacío, asigna todas las sucursales activas.
      - gerente: exige >= 1 sucursal válida.
      - encargado: exige exactamente 1 sucursal válida.
    """
    unique_ids = list(dict.fromkeys(str(b).strip() for b in branch_ids if str(b).strip()))

    for bid in unique_ids:
        snap = db.collection(BRANCHES).document(bid).get()
        if not snap.exists:
            raise HTTPException(status_code=404, detail=f"Sucursal '{bid}' no encontrada")

    if role == RoleName.admin:
        if not unique_ids:
            active_branches = apply_filter(db.collection(BRANCHES), "is_active", "==", True).stream()
            unique_ids = [doc.id for doc in active_branches]
        return unique_ids

    if role == RoleName.gerente:
        if len(unique_ids) < 1:
            raise HTTPException(
                status_code=422,
                detail="Un Gerente debe tener al menos una sucursal asignada.",
            )
        return unique_ids

    # RoleName.encargado
    if len(unique_ids) != 1:
        raise HTTPException(
            status_code=422,
            detail="Un Encargado de sucursal debe tener exactamente una sucursal asignada.",
        )
    return unique_ids


@router.get("/")
async def list_users(
    current_user: AuthUser,
    db: DbClient,
    skip: int = 0,
    limit: int = 100,
):
    require_permission(current_user.role, "users")
    docs = list(db.collection(USERS).stream())
    items = []
    for doc in docs:
        d = doc.to_dict() or {}
        items.append({
            "id": doc.id,
            "firebase_uid": d.get("firebase_uid", doc.id),
            "email": d.get("email", ""),
            "full_name": d.get("full_name", ""),
            "username": d.get("username"),
            "role": d.get("role", "encargado"),
            "branch_ids": d.get("branch_ids", []),
            "is_active": bool(d.get("is_active", False)),
            "must_change_password": bool(d.get("must_change_password", False)),
            "created_at": to_iso(d.get("created_at")),
        })
    items.sort(key=lambda x: x.get("full_name", "").lower())
    return items[skip : skip + limit]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_user(
    data: UserCreateSchema,
    current_user: AuthUser,
    db: DbClient,
):
    """
    Alta automatizada de usuario (solo Administrador):
      1. Verifica correo único y cardinalidad válida Rol <-> Sucursales.
      2. Crea la cuenta en Firebase Auth (Admin SDK).
      3. Sincroniza custom claim `role`.
      4. Persiste el perfil en `users/{uid}` y el registro de auditoría en Firestore.
      5. Compensación: si falla Firestore, elimina la cuenta recién creada en Firebase Auth.
    """
    require_permission(current_user.role, "users")

    email_norm = data.email.lower().strip()
    existing_email = list(apply_filter(db.collection(USERS), "email", "==", email_norm).limit(1).stream())
    if existing_email:
        raise HTTPException(status_code=409, detail="Ya existe un usuario registrado con ese correo")

    valid_branch_ids = _validate_role_branches(db, data.role, data.branch_ids)

    # Paso 1: Crear cuenta en Firebase Auth
    try:
        uid = create_firebase_user(
            email=email_norm,
            password=data.password,
            display_name=data.full_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Error al crear cuenta en Firebase Authentication") from exc

    # Paso 2: Crear perfil en Cloud Firestore con compensación ante fallo
    try:
        set_user_role_claim(uid, data.role.value)
        now = now_utc()
        user_payload = {
            "firebase_uid": uid,
            "email": email_norm,
            "full_name": data.full_name.strip(),
            "username": data.username.strip() if data.username else None,
            "role": data.role.value,
            "branch_ids": valid_branch_ids,
            "is_active": True,
            "must_change_password": data.must_change_password,
            "created_by_uid": current_user.firebase_uid,
            "created_at": now,
            "updated_at": now,
        }
        batch = db.batch()
        user_ref = db.collection(USERS).document(uid)
        batch.create(user_ref, user_payload)
        record_audit(
            db=db,
            current_user=current_user,
            action="CREATE",
            entity_type="user",
            entity_id=uid,
            details={
                "email": email_norm,
                "role": data.role.value,
                "branch_ids": valid_branch_ids,
                "must_change_password": data.must_change_password,
            },
            batch=batch,
        )
        batch.commit()
    except Exception as exc:
        delete_firebase_user(uid)
        if is_already_exists_error(exc):
            raise HTTPException(status_code=409, detail="El usuario ya existe en Firestore") from exc
        raise HTTPException(
            status_code=500,
            detail="No se pudo guardar el perfil en Firestore; la cuenta en Firebase fue revertida.",
        ) from exc

    return {
        "id": uid,
        "firebase_uid": uid,
        "email": email_norm,
        "role": data.role.value,
        "branch_ids": valid_branch_ids,
        "must_change_password": data.must_change_password,
    }


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    data: UserUpdateSchema,
    current_user: AuthUser,
    db: DbClient,
):
    """
    Actualiza perfil de usuario en Firestore (solo Administrador).
    - Valida cardinalidad Rol <-> Sucursales cuando cambia rol o sucursales.
    - Al desactivar (`is_active=False`), revoca refresh tokens y deshabilita en Firebase Auth.
    - Al cambiar rol, sincroniza el custom claim `role` en Firebase.
    """
    require_permission(current_user.role, "users")

    user_ref = db.collection(USERS).document(user_id)
    snap = user_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    current_data = snap.to_dict() or {}
    updates: dict = {"updated_at": now_utc()}

    if data.full_name is not None:
        updates["full_name"] = data.full_name.strip()
    if data.username is not None:
        updates["username"] = data.username.strip() or None
    if data.is_active is not None:
        updates["is_active"] = data.is_active
    if data.must_change_password is not None:
        updates["must_change_password"] = data.must_change_password

    if data.role is not None or data.branch_ids is not None:
        target_role = data.role if data.role is not None else RoleName(current_data.get("role", "encargado"))
        target_branches = (
            data.branch_ids if data.branch_ids is not None else list(current_data.get("branch_ids", []))
        )
        # Si cambia a admin sin especificar sucursales nuevas, re-asignar todas las activas
        if data.role == RoleName.admin and data.branch_ids is None:
            target_branches = []
        valid_branches = _validate_role_branches(db, target_role, target_branches)
        updates["role"] = target_role.value
        updates["branch_ids"] = valid_branches

    user_ref.update(updates)

    if data.role is not None and data.role.value != current_data.get("role"):
        set_user_role_claim(user_id, data.role.value)

    audit_action = "UPDATE"
    if data.is_active is False and current_data.get("is_active", True) is True:
        revoke_user_sessions(user_id, disabled=True)
        audit_action = "DEACTIVATE_AND_REVOKE"
    elif data.is_active is True and current_data.get("is_active", False) is False:
        revoke_user_sessions(user_id, disabled=False)
        audit_action = "REACTIVATE"

    record_audit(
        db=db,
        current_user=current_user,
        action=audit_action,
        entity_type="user",
        entity_id=user_id,
        details={k: v for k, v in updates.items() if k != "updated_at"},
    )
    return {"message": "Usuario actualizado", "id": user_id}
