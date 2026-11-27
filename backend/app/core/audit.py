"""
Registro de auditoría en Cloud Firestore (colección `audit_logs`).
Garantiza trazabilidad de quién realizó cada acción (firebase_uid + email + timestamp).
"""
import json
from typing import Any, Optional

from app.db.collections import AUDIT_LOGS
from app.db.models import now_utc


def record_audit(
    db: Any,
    current_user: Any,
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
    transaction: Any = None,
    batch: Any = None,
) -> str:
    """
    Registra un evento inmutable en `audit_logs`.
    Si se proporciona `transaction` o `batch`, la escritura participa en la operación atómica.
    """
    doc_ref = db.collection(AUDIT_LOGS).document()
    payload = {
        "firebase_uid": getattr(current_user, "firebase_uid", "system"),
        "user_email": getattr(current_user, "email", "system"),
        "user_role": getattr(current_user, "role", "system"),
        "action": action,
        "entity_type": entity_type,
        "entity_id": str(entity_id) if entity_id is not None else None,
        "branch_id": branch_id,
        "details": json.dumps(details, ensure_ascii=False, default=str) if details is not None else None,
        "created_at": now_utc(),
    }
    if transaction is not None:
        transaction.set(doc_ref, payload)
    elif batch is not None:
        batch.set(doc_ref, payload)
    else:
        doc_ref.set(payload)
    return doc_ref.id
