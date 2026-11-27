"""
Integración con Firebase Admin SDK (Authentication + inicialización compartida para Firestore).
FastAPI NUNCA almacena contraseñas; gestiona cuentas vía Admin SDK y verifica ID tokens.
"""
import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class _EmulatorCredential(credentials.Base):
    """Credencial anónima para Auth y Firestore Emulators (no requiere ADC ni proyecto real)."""

    def get_credential(self):
        from google.auth.credentials import AnonymousCredentials
        return AnonymousCredentials()


def _has_emulator_env(settings) -> bool:
    """Detecta si los emuladores de Firebase Auth o Firestore están configurados."""
    if settings.firebase_auth_emulator_host and not os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
        os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = settings.firebase_auth_emulator_host
    if settings.firestore_emulator_host and not os.environ.get("FIRESTORE_EMULATOR_HOST"):
        os.environ["FIRESTORE_EMULATOR_HOST"] = settings.firestore_emulator_host
    return bool(
        os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
        or os.environ.get("FIRESTORE_EMULATOR_HOST")
    )


@lru_cache
def _initialize_firebase() -> firebase_admin.App:
    """
    Inicializa Firebase Admin SDK exactamente una vez.
    Orden de prioridad de credenciales:
      1. Emuladores locales (FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST)
      2. Variable de entorno FIREBASE_CREDENTIALS_JSON (recomendada en Render)
      3. Archivo FIREBASE_CREDENTIALS_PATH (desarrollo local o Render Secret File)
      4. Application Default Credentials (GCP/CI)
    """
    if firebase_admin._apps:
        return firebase_admin.get_app()

    settings = get_settings()
    project_id = settings.firebase_project_id or os.environ.get("GCLOUD_PROJECT") or "demo-pollos-al-vuelo"
    options = {"projectId": project_id}

    if _has_emulator_env(settings):
        logger.info("Firebase Admin inicializado en modo Emulador (projectId=%s).", project_id)
        return firebase_admin.initialize_app(_EmulatorCredential(), options=options)

    raw_json = settings.firebase_credentials_json.strip() or os.environ.get("FIREBASE_CREDENTIALS_JSON", "").strip()
    if raw_json:
        cred_info = json.loads(raw_json)
        if not settings.firebase_project_id and cred_info.get("project_id"):
            options["projectId"] = cred_info["project_id"]
        cred = credentials.Certificate(cred_info)
        logger.info("Firebase Admin inicializado desde variable FIREBASE_CREDENTIALS_JSON.")
        return firebase_admin.initialize_app(cred, options)

    cred_path = Path(settings.firebase_credentials_path)
    if cred_path.exists():
        cred = credentials.Certificate(str(cred_path))
        logger.info("Firebase Admin inicializado con archivo de credenciales: %s", cred_path)
        return firebase_admin.initialize_app(cred, options)

    cred = credentials.ApplicationDefault()
    logger.info("Firebase Admin inicializado con Application Default Credentials.")
    return firebase_admin.initialize_app(cred, options)


def get_firebase_app() -> firebase_admin.App:
    return _initialize_firebase()


def verify_firebase_token(id_token: str) -> dict:
    """
    Verifica un ID token de Firebase con detección de tokens revocados (check_revoked=True).
    Lanza ValueError si el token es inválido, expirado o revocado.
    """
    get_firebase_app()
    try:
        decoded = firebase_auth.verify_id_token(
            id_token,
            check_revoked=True,
        )
        return decoded
    except firebase_auth.RevokedIdTokenError as exc:
        logger.warning("Token revocado: %s", exc)
        raise ValueError("Token revocado") from exc
    except firebase_auth.ExpiredIdTokenError as exc:
        logger.warning("Token expirado: %s", exc)
        raise ValueError("Token expirado") from exc
    except firebase_auth.InvalidIdTokenError as exc:
        logger.warning("Token inválido: %s", exc)
        raise ValueError("Token inválido") from exc
    except Exception as exc:
        logger.error("Error inesperado verificando token: %s", exc)
        raise ValueError("Error verificando token") from exc


def create_firebase_user(email: str, password: str, display_name: str) -> str:
    """Crea una cuenta en Firebase Authentication mediante Admin SDK y retorna el UID."""
    get_firebase_app()
    try:
        user_record = firebase_auth.create_user(
            email=email.lower().strip(),
            password=password,
            display_name=display_name.strip(),
            disabled=False,
        )
        return user_record.uid
    except firebase_auth.EmailAlreadyExistsError as exc:
        raise ValueError("El correo electrónico ya está registrado en Firebase Authentication.") from exc
    except Exception as exc:
        logger.error("Error creando usuario en Firebase Auth: %s", exc)
        raise RuntimeError(f"Error al crear usuario en Firebase Auth: {exc}") from exc


def delete_firebase_user(uid: str) -> None:
    """
    Elimina una cuenta de Firebase Auth (usado como compensación si falla
    la escritura del perfil en Cloud Firestore).
    """
    get_firebase_app()
    try:
        firebase_auth.delete_user(uid)
        logger.info("Compensación ejecutada: usuario Firebase %s eliminado.", uid)
    except Exception as exc:
        logger.error("No se pudo eliminar usuario Firebase %s en compensación: %s", uid, exc)


def set_user_role_claim(uid: str, role: str) -> None:
    """
    Sincroniza el custom claim `role` en el token de Firebase para UX rápida en frontend.
    Cloud Firestore sigue siendo la única fuente de verdad en el backend.
    """
    get_firebase_app()
    try:
        firebase_auth.set_custom_user_claims(uid, {"role": role})
    except Exception as exc:
        logger.warning("No se pudo asignar custom claim de rol a %s: %s", uid, exc)


def revoke_user_sessions(uid: str, disabled: Optional[bool] = None) -> None:
    """
    Revoca todos los refresh tokens del usuario en Firebase Auth y,
    opcionalmente, habilita o deshabilita su cuenta.
    """
    get_firebase_app()
    if disabled is not None:
        firebase_auth.update_user(uid, disabled=disabled)
    if disabled is True or disabled is None:
        firebase_auth.revoke_refresh_tokens(uid)
        logger.info("Refresh tokens revocados para usuario Firebase %s.", uid)
