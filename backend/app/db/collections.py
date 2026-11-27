"""
Constantes de colecciones Cloud Firestore y generadores de IDs determinísticos.
Los IDs determinísticos garantizan unicidad atómica sin necesidad de índices UNIQUE SQL.
"""
from datetime import date, timedelta
from typing import Any

# Nombres de colecciones raíz en Cloud Firestore
BRANCHES = "branches"
USERS = "users"
ITEMS = "items"
ITEM_CODES = "item_codes"
PURCHASES = "purchases"
INVENTORY_MOVEMENTS = "inventory_movements"
INVENTORY_BALANCES = "inventory_balances"
CONSUMPTION_DAILY = "consumption_daily"
IMPORT_BATCHES = "import_batches"
OPERATION_EVENTS = "operation_events"
ML_MODEL_VERSIONS = "ml_model_versions"
PREDICTIONS = "predictions"
AUDIT_LOGS = "audit_logs"


def balance_doc_id(branch_id: str, item_id: str) -> str:
    return f"{branch_id}__{item_id}"


def consumption_doc_id(branch_id: str, item_id: str, consumption_date: date | str) -> str:
    d = consumption_date.isoformat() if isinstance(consumption_date, date) else str(consumption_date)
    return f"{branch_id}__{item_id}__{d}"


def import_batch_doc_id(branch_id: str, file_hash: str) -> str:
    return f"{branch_id}__{file_hash}"


def prediction_doc_id(
    branch_id: str,
    item_id: str,
    prediction_for_date: date | str,
    model_version_tag: str,
) -> str:
    d = prediction_for_date.isoformat() if isinstance(prediction_for_date, date) else str(prediction_for_date)
    return f"{branch_id}__{item_id}__{d}__{model_version_tag}"


def item_code_doc_id(code: str) -> str:
    return code.strip().upper().replace("/", "_")


def expand_date_range(start_date: date, end_date: date, max_days: int = 366) -> list[str]:
    """
    Expande un rango [start_date, end_date] a lista de cadenas YYYY-MM-DD
    para habilitar consultas eficientes ARRAY_CONTAINS en operation_events.
    """
    delta = (end_date - start_date).days
    if delta < 0:
        return []
    count = min(delta + 1, max_days)
    return [(start_date + timedelta(days=i)).isoformat() for i in range(count)]


def apply_filter(query: Any, field: str, op: str, value: Any) -> Any:
    """
    Aplica un filtro compatible tanto con google-cloud-firestore (FieldFilter)
    como con clientes simulados en pruebas unitarias.
    """
    if hasattr(query, "where_filter"):
        return query.where_filter(field, op, value)
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        return query.where(filter=FieldFilter(field, op, value))
    except Exception:
        return query.where(field, op, value)
