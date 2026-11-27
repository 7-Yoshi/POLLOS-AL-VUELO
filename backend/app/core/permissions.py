"""
Reglas de autorización RBAC + aislamiento por sucursal (IDs string de Firestore).
Verifica rol y pertenencia a sucursal en cada operación del backend.
"""
from enum import StrEnum
from typing import Optional


class UserRole(StrEnum):
    ADMIN = "admin"
    GERENTE = "gerente"
    ENCARGADO = "encargado"


# Permisos por módulo (qué roles tienen acceso)
MODULE_PERMISSIONS: dict[str, list[UserRole]] = {
    "dashboard": [UserRole.ADMIN, UserRole.GERENTE, UserRole.ENCARGADO],
    "users": [UserRole.ADMIN],
    "branches": [UserRole.ADMIN, UserRole.GERENTE],
    "branches_write": [UserRole.ADMIN],
    "items_read": [UserRole.ADMIN, UserRole.GERENTE, UserRole.ENCARGADO],
    "items_write": [UserRole.ADMIN],
    "purchases_read": [UserRole.ADMIN, UserRole.GERENTE, UserRole.ENCARGADO],
    "purchases_write": [UserRole.ADMIN, UserRole.ENCARGADO],
    "inventory_read": [UserRole.ADMIN, UserRole.GERENTE, UserRole.ENCARGADO],
    "inventory_write": [UserRole.ADMIN, UserRole.ENCARGADO],
    "consumption_read": [UserRole.ADMIN, UserRole.GERENTE, UserRole.ENCARGADO],
    "consumption_write": [UserRole.ADMIN, UserRole.ENCARGADO],
    "operations": [UserRole.ADMIN, UserRole.GERENTE],
    # Problema 3: Encargado puede consultar predicciones de su sucursal (solo lectura)
    "predictions_read": [UserRole.ADMIN, UserRole.GERENTE, UserRole.ENCARGADO],
    "predictions_write": [UserRole.ADMIN, UserRole.GERENTE],
    # Alias retrocompatible para generar/solicitar predicciones
    "predictions": [UserRole.ADMIN, UserRole.GERENTE],
    "reports": [UserRole.ADMIN, UserRole.GERENTE],
    # Auditoría estrictamente inmutable: solo lectura para Admin y Gerente; ningún rol puede editar ni borrar
    "audit_read": [UserRole.ADMIN, UserRole.GERENTE],
    "ml_publish": [UserRole.ADMIN],
}


def has_permission(role: str, permission_key: str) -> bool:
    """¿Tiene el rol el permiso indicado?"""
    allowed = MODULE_PERMISSIONS.get(permission_key, [])
    return UserRole(role) in allowed


def can_access_branch(
    user_role: str,
    user_branch_ids: list[str],
    target_branch_id: Optional[str],
) -> bool:
    """
    Admin puede acceder a cualquier sucursal.
    Gerente puede acceder a todas sus sucursales autorizadas.
    Encargado solo a las asignadas.
    target_branch_id=None significa 'todas las autorizadas' (filtradas luego en el endpoint).
    """
    role = UserRole(user_role)
    if role == UserRole.ADMIN:
        return True
    if target_branch_id is None:
        return True
    return str(target_branch_id) in {str(b) for b in user_branch_ids}


def require_permission(role: str, permission_key: str) -> None:
    """Lanza PermissionError si el rol no tiene el permiso."""
    if not has_permission(role, permission_key):
        raise PermissionError(f"Rol '{role}' no tiene permiso '{permission_key}'")


def require_branch_access(
    user_role: str,
    user_branch_ids: list[str],
    target_branch_id: Optional[str],
) -> None:
    """Lanza PermissionError si el usuario no puede acceder a la sucursal."""
    if not can_access_branch(user_role, user_branch_ids, target_branch_id):
        raise PermissionError(f"Acceso denegado a sucursal '{target_branch_id}'")
