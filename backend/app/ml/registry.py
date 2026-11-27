"""
ML Registry — busca la versión de modelo aprobada en Cloud Firestore (`ml_model_versions`).
Prioriza el modelo específico de sucursal sobre el modelo general (`branch_id=None`).
"""
from typing import Any, Optional

from app.db.collections import ML_MODEL_VERSIONS, apply_filter


def get_active_model_version(
    db: Any,
    item_id: str,
    branch_id: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """
    Busca la versión activa del modelo para un ítem y sucursal en `ml_model_versions`.
    """
    q = apply_filter(db.collection(ML_MODEL_VERSIONS), "item_id", "==", item_id)
    q = apply_filter(q, "is_active", "==", True)
    docs = list(q.stream())

    branch_match: Optional[dict[str, Any]] = None
    global_match: Optional[dict[str, Any]] = None

    for doc in docs:
        d = doc.to_dict() or {}
        d.setdefault("version_tag", doc.id)
        d["id"] = doc.id
        doc_branch = d.get("branch_id")
        if branch_id and doc_branch == branch_id:
            branch_match = d
            break
        if doc_branch is None and global_match is None:
            global_match = d

    return branch_match or global_match
