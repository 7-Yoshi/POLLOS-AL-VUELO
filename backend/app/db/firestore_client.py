"""
Cliente de Cloud Firestore — Pollos al Vuelo.
Provee get_db() para FastAPI, transacciones atómicas portables y Aggregation Queries.
"""
import logging
from typing import Any, Callable, TypeVar

from firebase_admin import firestore as fb_firestore

from app.core.firebase_auth import get_firebase_app
from app.db.collections import BRANCHES

logger = logging.getLogger(__name__)

_client: Any = None
T = TypeVar("T")


class DuplicateDocumentError(Exception):
    """Error portable cuando un documento con ID determinístico ya existe."""
    pass


def get_firestore_client() -> Any:
    """Retorna el cliente singleton de Cloud Firestore usando la app de Firebase Admin."""
    global _client
    if _client is None:
        app = get_firebase_app()
        _client = fb_firestore.client(app=app)
    return _client


def get_db() -> Any:
    """Dependencia de FastAPI — inyecta el cliente de Cloud Firestore."""
    return get_firestore_client()


def check_firestore_connection(db: Any = None) -> bool:
    """Verifica conectividad con Cloud Firestore ejecutando una lectura mínima (limit 1)."""
    try:
        client = db if db is not None else get_firestore_client()
        list(client.collection(BRANCHES).limit(1).stream())
        return True
    except Exception as exc:
        logger.error("Error de conexión a Cloud Firestore: %s", exc)
        return False


def run_transaction(db: Any, callback: Callable[[Any], T]) -> T:
    """
    Ejecuta `callback(transaction)` de forma atómica en Firestore.
    Regla de Firestore: dentro de `callback`, todas las lecturas `.get(transaction=txn)`
    deben ocurrir ANTES de cualquier escritura `.create()/.set()/.update()/.delete()`.
    """
    if hasattr(db, "run_transaction"):
        return db.run_transaction(callback)

    @fb_firestore.transactional
    def _wrapped(transaction):
        return callback(transaction)

    return _wrapped(db.transaction())


def count_query(query: Any) -> int:
    """
    Ejecuta una Aggregation Query `count()` en Firestore (cobra solo 1 lectura por cada
    1,000 documentos contados) con fallback seguro.
    """
    if hasattr(query, "count"):
        try:
            agg = query.count().get()
            # google-cloud-firestore retorna [[AggregationResult(value=N)]]
            if agg and len(agg) > 0:
                first = agg[0]
                if isinstance(first, (list, tuple)) and len(first) > 0:
                    return int(first[0].value)
                if hasattr(first, "value"):
                    return int(first.value)
        except Exception as exc:
            logger.debug("Fallback en count_query: %s", exc)
    return sum(1 for _ in query.stream())


def is_already_exists_error(exc: Exception) -> bool:
    """Detecta si una excepción corresponde a documento duplicado en Firestore."""
    if isinstance(exc, DuplicateDocumentError):
        return True
    try:
        from google.api_core.exceptions import AlreadyExists
        if isinstance(exc, AlreadyExists):
            return True
    except Exception:
        pass
    return exc.__class__.__name__ == "AlreadyExists"
