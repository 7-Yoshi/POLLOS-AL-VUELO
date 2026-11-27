"""
Configuración central de la aplicación — Pollos al Vuelo (Firebase Auth + Cloud Firestore).
Lee variables de entorno desde .env usando pydantic-settings.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Firebase (Authentication + Cloud Firestore)
    firebase_project_id: str = ""
    firebase_credentials_path: str = "./firebase-service-account.json"
    firebase_credentials_json: str = ""

    # Emuladores locales opcionales
    firebase_auth_emulator_host: str = ""
    firestore_emulator_host: str = ""

    # Entorno
    app_env: str = "development"

    # CORS — lista separada por comas
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Secreto interno (no para JWT de usuarios)
    secret_key: str = "desarrollo_inseguro_cambiar_en_produccion"

    # Logs
    log_level: str = "INFO"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str) -> str:
        return v

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() == "development"


@lru_cache
def get_settings() -> Settings:
    """Instancia única de configuración (cacheada)."""
    return Settings()
