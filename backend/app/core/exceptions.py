"""
Excepciones controladas del dominio.
No filtrar información interna en mensajes de error al cliente.
"""
from fastapi import HTTPException, status


class AppError(Exception):
    """Base de errores del dominio."""
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class NotFoundError(AppError):
    def __init__(self, resource: str = "Recurso"):
        super().__init__(f"{resource} no encontrado", status_code=404)


class DuplicateError(AppError):
    def __init__(self, resource: str = "Recurso"):
        super().__init__(f"{resource} ya existe o hay un conflicto", status_code=409)


class PermissionDeniedError(AppError):
    def __init__(self, detail: str = "Acceso denegado"):
        super().__init__(detail, status_code=403)


class AuthenticationError(AppError):
    def __init__(self, detail: str = "No autenticado"):
        super().__init__(detail, status_code=401)


class ValidationError(AppError):
    def __init__(self, detail: str):
        super().__init__(detail, status_code=422)


class ConflictError(AppError):
    def __init__(self, detail: str):
        super().__init__(detail, status_code=409)


def to_http_exception(error: AppError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.message)
