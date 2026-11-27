"""
Dependencias FastAPI reutilizables.
Verifica el ID token de Firebase y consulta el perfil interno en Cloud Firestore (1 lectura O(1)).
Aplica lista blanca estricta de roles autorizados: cocineros, cajeros, meseros y personal
de limpieza no tienen acceso al sistema salvo autorización explícita como encargado.
"""
import logging
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.firebase_auth import verify_firebase_token
from app.core.permissions import UserRole
from app.db.collections import USERS
from app.db.firestore_client import get_db

logger = logging.getLogger(__name__)

security = HTTPBearer()
AUTHORIZED_ROLES: frozenset[str] = frozenset(r.value for r in UserRole)


class CurrentUser:
    """Datos del usuario autenticado y autorizado (fuente de verdad: Cloud Firestore)."""

    def __init__(self, uid: str, data: dict[str, Any]):
        self.id: str = uid
        self.firebase_uid: str = uid
        self.email: str = data.get("email", "")
        self.full_name: str = data.get("full_name", "")
        self.username: str | None = data.get("username")
        self.role: str = str(data["role"])
        self.is_active: bool = bool(data.get("is_active", False))
        self.must_change_password: bool = bool(data.get("must_change_password", False))
        self.branch_ids: list[str] = [str(b) for b in data.get("branch_ids", [])]


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[Any, Depends(get_db)],
) -> CurrentUser:
    """
    Dependencia principal de autenticación:
      1. Extrae Bearer token del header Authorization.
      2. Verifica ID token con Firebase Admin SDK (incluye check_revoked=True).
      3. Lee el documento `users/{firebase_uid}` en Cloud Firestore (1 lectura directa).
      4. Valida estado activo y rol autorizado en lista blanca (`admin`, `gerente`, `encargado`).
      5. Retorna CurrentUser con rol, sucursales y flag must_change_password.
    """
    token = credentials.credentials

    try:
        payload = verify_firebase_token(token)
    except ValueError as exc:
        logger.warning("Token Firebase rechazado: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticación inválido, expirado o revocado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    firebase_uid = payload.get("uid")
    if not firebase_uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token sin identificador de usuario",
        )

    snap = db.collection(USERS).document(firebase_uid).get()
    if not snap.exists:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no registrado en el sistema",
        )

    user_data = snap.to_dict() or {}
    if not user_data.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta de usuario desactivada",
        )

    raw_role = user_data.get("role")
    if not isinstance(raw_role, str) or raw_role not in AUTHORIZED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Personal sin rol autorizado para acceder al sistema",
        )

    return CurrentUser(uid=firebase_uid, data=user_data)


AuthUser = Annotated[CurrentUser, Depends(get_current_user)]
DbClient = Annotated[Any, Depends(get_db)]
DbSession = DbClient  # Alias semántico
