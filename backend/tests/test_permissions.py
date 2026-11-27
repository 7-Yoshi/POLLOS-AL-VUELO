"""
Tests unitarios de RBAC y aislamiento por sucursal (IDs string de Firestore).
Incluye validación de acceso de solo lectura del Encargado a Predicciones (Problema 3).
"""
from app.core.permissions import can_access_branch, has_permission


def test_encargado_cannot_access_other_branch():
    assert can_access_branch("encargado", ["suc_central"], target_branch_id="suc_norte") is False
    assert can_access_branch("encargado", ["suc_central"], target_branch_id="suc_central") is True


def test_gerente_can_access_authorized_branches():
    assert can_access_branch("gerente", ["suc_central", "suc_sur"], target_branch_id="suc_central") is True
    assert can_access_branch("gerente", ["suc_central", "suc_sur"], target_branch_id="suc_norte") is False


def test_admin_can_access_any_branch():
    assert can_access_branch("admin", [], target_branch_id="suc_cualquiera") is True


def test_encargado_cannot_manage_users():
    assert has_permission("encargado", "users") is False


def test_gerente_cannot_manage_users():
    assert has_permission("gerente", "users") is False


def test_admin_can_manage_users():
    assert has_permission("admin", "users") is True


def test_encargado_predictions_read_only():
    """Problema 3: Encargado puede consultar predicciones de su sucursal pero no generarlas."""
    assert has_permission("encargado", "predictions_read") is True
    assert has_permission("encargado", "predictions_write") is False


def test_gerente_can_read_and_request_predictions():
    assert has_permission("gerente", "predictions_read") is True
    assert has_permission("gerente", "predictions_write") is True


def test_gerente_can_view_reports_and_audit():
    assert has_permission("gerente", "reports") is True
    assert has_permission("gerente", "audit_read") is True


def test_encargado_cannot_view_reports_or_audit():
    assert has_permission("encargado", "reports") is False
    assert has_permission("encargado", "audit_read") is False


def test_only_admin_can_publish_ml():
    assert has_permission("gerente", "ml_publish") is False
    assert has_permission("admin", "ml_publish") is True
