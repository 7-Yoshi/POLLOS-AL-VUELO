"""
Tests de autenticación, flujo de usuarios Firebase Admin + Firestore, compensación,
revocación de sesiones y soporte opcional de Firebase Auth Emulator.
"""
import os
from unittest.mock import patch

import httpx
import pytest

from app.db.collections import AUDIT_LOGS, USERS
from tests.conftest import auth_headers


def test_health_endpoint(client):
    """El endpoint /health debe responder 200 indicando motor Cloud Firestore."""
    with patch("app.db.firestore_client.check_firestore_connection", return_value=True):
        response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "Firestore" in data["engine"]


def test_me_without_token(client):
    """Sin token Bearer, /api/v1/auth/me debe rechazarse (401/403)."""
    response = client.get("/api/v1/auth/me")
    assert response.status_code in (401, 403)


def test_me_with_invalid_token(client):
    """Con token inválido, debe retornar 401."""
    response = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer token_invalido"})
    assert response.status_code == 401


def test_me_with_valid_token_returns_profile_and_flag(client):
    """Flujo login -> /auth/me devuelve perfil real de Firestore incluyendo must_change_password."""
    res = client.get("/api/v1/auth/me", headers=auth_headers("uid_nuevo"))
    assert res.status_code == 200
    body = res.json()
    assert body["firebase_uid"] == "uid_nuevo"
    assert body["role"] == "encargado"
    assert body["must_change_password"] is True
    assert body["branch_ids"] == ["suc_central"]


def test_me_with_inactive_user_returns_403(client):
    """Usuario desactivado en Firestore debe recibir HTTP 403."""
    res = client.get("/api/v1/auth/me", headers=auth_headers("uid_inactivo"))
    assert res.status_code == 403


def test_confirm_password_changed_clears_flag_and_audits(client, fake_db):
    """POST /auth/password-changed limpia must_change_password y registra auditoría."""
    res = client.post("/api/v1/auth/password-changed", headers=auth_headers("uid_nuevo"))
    assert res.status_code == 200
    assert res.json()["must_change_password"] is False

    updated = fake_db.collection(USERS).document("uid_nuevo").get().to_dict()
    assert updated["must_change_password"] is False

    logs = [d.to_dict() for d in fake_db.collection(AUDIT_LOGS).stream()]
    assert any(l["action"] == "PASSWORD_CHANGE" and l["entity_id"] == "uid_nuevo" for l in logs)


def test_create_user_unified_firebase_and_firestore(client, fake_db):
    """POST /users/ crea cuenta en Firebase Admin SDK, asigna custom claim y guarda en Firestore."""
    with patch("app.modules.users.router.create_firebase_user", return_value="uid_creado_01") as m_create, \
         patch("app.modules.users.router.set_user_role_claim") as m_claim:
        res = client.post(
            "/api/v1/users/",
            headers=auth_headers("uid_admin"),
            json={
                "email": "encargado.sur@pollosalvuelo.com",
                "password": "ClaveTemporal2026",
                "full_name": "Carlos Sur",
                "role": "encargado",
                "branch_ids": ["suc_sur"],
                "must_change_password": True,
            },
        )
    assert res.status_code == 201
    assert res.json()["firebase_uid"] == "uid_creado_01"
    m_create.assert_called_once()
    m_claim.assert_called_once_with("uid_creado_01", "encargado")

    saved = fake_db.collection(USERS).document("uid_creado_01").get().to_dict()
    assert saved["email"] == "encargado.sur@pollosalvuelo.com"
    assert saved["must_change_password"] is True
    assert saved["branch_ids"] == ["suc_sur"]


def test_create_user_compensation_deletes_firebase_user_on_db_failure(client, fake_db):
    """Si falla la escritura en Firestore, debe ejecutarse compensación eliminando el usuario de Firebase."""
    fake_db.fail_next_commit = True
    with patch("app.modules.users.router.create_firebase_user", return_value="uid_huerfano"), \
         patch("app.modules.users.router.set_user_role_claim"), \
         patch("app.modules.users.router.delete_firebase_user") as m_delete:
        res = client.post(
            "/api/v1/users/",
            headers=auth_headers("uid_admin"),
            json={
                "email": "fallo@pollosalvuelo.com",
                "password": "ClaveTemporal2026",
                "full_name": "Prueba Fallo",
                "role": "encargado",
                "branch_ids": ["suc_central"],
            },
        )
    assert res.status_code == 500
    m_delete.assert_called_once_with("uid_huerfano")
    assert not fake_db.collection(USERS).document("uid_huerfano").get().exists


def test_deactivate_user_revokes_firebase_refresh_tokens(client, fake_db):
    """Al desactivar un usuario, PATCH /users/{id} debe revocar sus refresh tokens en Firebase."""
    with patch("app.modules.users.router.revoke_user_sessions") as m_revoke:
        res = client.patch(
            "/api/v1/users/uid_encargado",
            headers=auth_headers("uid_admin"),
            json={"is_active": False},
        )
    assert res.status_code == 200
    m_revoke.assert_called_once_with("uid_encargado", disabled=True)
    assert fake_db.collection(USERS).document("uid_encargado").get().to_dict()["is_active"] is False


def test_purchase_requires_auth(client):
    """POST /api/v1/purchases/ sin auth debe rechazarse."""
    response = client.post("/api/v1/purchases/", json={
        "branch_id": "suc_central",
        "purchase_date": "2026-11-22",
        "lines": [],
    })
    assert response.status_code in (401, 403)


@pytest.mark.skipif(
    not os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"),
    reason="Requiere Firebase Auth Emulator activo (FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099)",
)
def test_firebase_auth_emulator_end_to_end():
    """
    Prueba real contra Firebase Auth Emulator sin proyecto de producción.
    Ejecutar con:
      $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
      firebase emulators:start --only auth
      pytest tests/test_auth.py -k emulator -v
    """
    from app.core.firebase_auth import create_firebase_user, delete_firebase_user, verify_firebase_token

    host = os.environ["FIREBASE_AUTH_EMULATOR_HOST"]
    email = "emulator_test@pollosalvuelo.com"
    password = "TestPassword2026!"
    uid = create_firebase_user(email=email, password=password, display_name="Emulator Tester")
    try:
        sign_in_url = f"http://{host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key"
        resp = httpx.post(sign_in_url, json={"email": email, "password": password, "returnSecureToken": True})
        assert resp.status_code == 200
        id_token = resp.json()["idToken"]
        decoded = verify_firebase_token(id_token)
        assert decoded["uid"] == uid
    finally:
        delete_firebase_user(uid)
