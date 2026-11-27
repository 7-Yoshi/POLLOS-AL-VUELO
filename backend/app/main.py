"""
Punto de entrada principal de la API FastAPI — Pollos al Vuelo.
Arquitectura: Firebase Authentication + Cloud Firestore (NoSQL) + scikit-learn.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.core.exceptions import AppError
from app.api.router import api_router

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Ciclo de vida: inicializa Firebase Admin SDK y verifica conectividad con Cloud Firestore."""
    settings = get_settings()
    logger.info("Iniciando Pollos al Vuelo API (Firestore NoSQL) — env: %s", settings.app_env)

    try:
        from app.core.firebase_auth import get_firebase_app
        get_firebase_app()
        logger.info("Firebase Admin SDK inicializado.")
    except Exception as exc:
        logger.warning("Firebase Admin no inicializado al arrancar: %s", exc)

    from app.db.firestore_client import check_firestore_connection
    if check_firestore_connection():
        logger.info("Conexión a Cloud Firestore verificada.")
    else:
        logger.warning("No se pudo verificar Cloud Firestore. Revisar credenciales de Firebase.")

    yield
    logger.info("API detenida.")


settings = get_settings()

app = FastAPI(
    title="Pollos al Vuelo — API",
    description="Sistema de gestión operativa sobre Cloud Firestore con predicción de consumo por ML (CRISP-DM).",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
)

# ─── CORS ───────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Manejadores de error globales ──────────────────────────
@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message},
    )


@app.exception_handler(PermissionError)
async def permission_error_handler(request: Request, exc: PermissionError) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": str(exc)})


# ─── Rutas ──────────────────────────────────────────────────
app.include_router(api_router)


@app.get("/health", tags=["Sistema"])
async def health_check():
    """Endpoint de salud para Render y monitoreo."""
    from app.db.firestore_client import check_firestore_connection
    fs_ok = check_firestore_connection()
    return {
        "status": "ok" if fs_ok else "degradado",
        "database": "firestore conectado" if fs_ok else "firestore sin conexión",
        "engine": "Cloud Firestore (NoSQL)",
        "app": "Pollos al Vuelo",
        "version": "2.0.0",
    }
