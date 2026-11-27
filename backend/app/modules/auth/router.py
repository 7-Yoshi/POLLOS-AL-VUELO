"""
Módulo Auth — verificación de identidad, perfil desde Cloud Firestore y cambio obligatorio de contraseña.
"""
from fastapi import APIRouter

from app.api.deps import AuthUser, DbClient
from app.core.audit import record_audit
from app.db.collections import USERS
from app.db.models import now_utc

router = APIRouter()


@router.get("/me")
async def get_me(current_user: AuthUser):
    """
    Retorna el perfil del usuario autenticado (fuente de verdad: Cloud Firestore).
    Incluye `must_change_password` para forzar cambio de clave en el primer ingreso.
    """
    return {
        "id": current_user.id,
        "firebase_uid": current_user.firebase_uid,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "branch_ids": current_user.branch_ids,
        "is_active": current_user.is_active,
        "must_change_password": current_user.must_change_password,
    }


@router.post("/password-changed")
async def confirm_password_changed(current_user: AuthUser, db: DbClient):
    """
    Limpia el flag `must_change_password` después de que el usuario actualizó su contraseña
    directamente en Firebase Authentication desde el frontend.
    """
    user_ref = db.collection(USERS).document(current_user.firebase_uid)
    user_ref.update({
        "must_change_password": False,
        "updated_at": now_utc(),
    })
    record_audit(
        db=db,
        current_user=current_user,
        action="PASSWORD_CHANGE",
        entity_type="user",
        entity_id=current_user.firebase_uid,
        details={"email": current_user.email},
    )
    return {"message": "Contraseña confirmada correctamente", "must_change_password": False}
