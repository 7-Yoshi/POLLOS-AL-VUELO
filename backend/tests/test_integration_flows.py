"""
Pruebas de integración end-to-end sobre Cloud Firestore (FakeFirestore):
- Aislamiento por sucursal en endpoints protegidos.
- Transacciones atómicas de compras + movimientos + vista materializada `inventory_balances` + auditoría.
- Importación CSV histórica (deduplicación SHA-256) e indicador `días acumulados / 60`.
- Predicciones: acceso solo lectura del Encargado + rango `± RMSE` + métricas `MAE/RMSE/R²`.
- Vista consolidada comparativa de las 3 sucursales.
- Módulo de análisis exploratorio (EDA) desde Firestore.
"""
from datetime import date, timedelta

from analytics.eda_firestore import run_eda_analysis
from app.db.collections import AUDIT_LOGS, CONSUMPTION_DAILY, INVENTORY_BALANCES, consumption_doc_id
from ml_pipeline.train import train_and_evaluate
from tests.conftest import auth_headers


def test_branch_isolation_across_protected_endpoints(client):
    """Encargado de suc_central puede operar en suc_central pero recibe 403 en suc_norte."""
    ok_res = client.get(
        "/api/v1/consumption/",
        params={"branch_id": "suc_central"},
        headers=auth_headers("uid_encargado"),
    )
    assert ok_res.status_code == 200

    forbidden_cons = client.get(
        "/api/v1/consumption/",
        params={"branch_id": "suc_norte"},
        headers=auth_headers("uid_encargado"),
    )
    assert forbidden_cons.status_code == 403

    forbidden_purch = client.post(
        "/api/v1/purchases/",
        headers=auth_headers("uid_encargado"),
        json={
            "branch_id": "suc_norte",
            "purchase_date": "2026-11-20",
            "lines": [{"item_id": "item_pollo", "quantity_base": 10, "unit": "kg"}],
        },
    )
    assert forbidden_purch.status_code == 403


def test_atomic_purchase_updates_materialized_balance_and_audit(client, fake_db):
    """Una compra actualiza atómicamente compras, movimientos, inventory_balances y audit_logs."""
    res = client.post(
        "/api/v1/purchases/",
        headers=auth_headers("uid_encargado"),
        json={
            "branch_id": "suc_central",
            "purchase_date": "2026-11-20",
            "supplier": "Avícola Sofía",
            "lines": [
                {"item_id": "item_pollo", "quantity_base": 35.5, "unit": "kg", "unit_cost": 18.0},
                {"item_id": "item_pollo", "quantity_base": 14.5, "unit": "kg", "unit_cost": 18.0},
            ],
        },
    )
    assert res.status_code == 201
    purchase_id = res.json()["id"]

    # Verificar saldo materializado = 35.5 + 14.5 = 50.0
    bal_res = client.get(
        "/api/v1/inventory/balance",
        params={"branch_id": "suc_central"},
        headers=auth_headers("uid_encargado"),
    )
    assert bal_res.status_code == 200
    assert bal_res.json()[0]["balance"] == 50.0

    # Registrar merma de 5.0 kg -> saldo queda en 45.0
    mv_res = client.post(
        "/api/v1/inventory/movements",
        headers=auth_headers("uid_encargado"),
        json={
            "branch_id": "suc_central",
            "item_id": "item_pollo",
            "movement_type": "merma",
            "quantity_base": 5.0,
            "unit": "kg",
            "effective_date": "2026-11-21",
            "notes": "Merma operativa",
        },
    )
    assert mv_res.status_code == 201

    bal_doc = fake_db.collection(INVENTORY_BALANCES).document("suc_central__item_pollo").get().to_dict()
    assert bal_doc["balance"] == 45.0

    # Trazabilidad: detalle de compra incluye created_by_uid y audit_logs contiene ambos eventos
    det = client.get(f"/api/v1/purchases/{purchase_id}", headers=auth_headers("uid_encargado")).json()
    assert det["created_by_uid"] == "uid_encargado"
    assert det["created_at"] is not None

    audit_res = client.get(
        "/api/v1/audit/",
        params={"branch_id": "suc_central"},
        headers=auth_headers("uid_admin"),
    )
    assert audit_res.status_code == 200
    entities = {log["entity_type"] for log in audit_res.json()}
    assert {"purchase", "inventory_movement"}.issubset(entities)

    # Encargado no puede consultar auditoría
    audit_forbidden = client.get("/api/v1/audit/", headers=auth_headers("uid_encargado"))
    assert audit_forbidden.status_code == 403


def test_csv_import_deduplication_and_readiness_indicator(client):
    """Problema 2: Importar CSV histórico, rechazar archivo duplicado (SHA-256) y consultar días/60."""
    csv_lines = [
        "fecha,codigo_item,cantidad_base,unidad,estado,notas",
        "2026-10-01,MP-POLLO,48.5,kg,medido,Turno completo",
        "2026-10-02,MP-POLLO,51.0,kg,calculado_validado,Balance",
        "2026-10-03,MP-POLLO,,kg,desconocido,Sin dato",
        "2026-10-04,CODIGO-INVALIDO,10,kg,medido,Debe rechazarse",
    ]
    csv_bytes = ("\n".join(csv_lines)).encode("utf-8")

    res = client.post(
        "/api/v1/consumption/import-csv",
        headers=auth_headers("uid_encargado"),
        data={"branch_id": "suc_central"},
        files={"file": ("historico.csv", csv_bytes, "text/csv")},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["rows_total"] == 4
    assert body["rows_ok"] == 3
    assert body["rows_rejected"] == 1

    # Reintento del mismo archivo CSV -> HTTP 409 (hash SHA-256 duplicado)
    dup_res = client.post(
        "/api/v1/consumption/import-csv",
        headers=auth_headers("uid_encargado"),
        data={"branch_id": "suc_central"},
        files={"file": ("historico.csv", csv_bytes, "text/csv")},
    )
    assert dup_res.status_code == 409

    # Indicador días acumulados / 60 (solo cuenta medido y calculado_validado -> 2 días)
    ready_res = client.get(
        "/api/v1/consumption/readiness",
        params={"branch_id": "suc_central"},
        headers=auth_headers("uid_encargado"),
    )
    assert ready_res.status_code == 200
    ready_data = ready_res.json()
    assert ready_data["min_training_days"] == 60
    pollo_row = next(x for x in ready_data["items"] if x["item_id"] == "item_pollo")
    assert pollo_row["accumulated_days"] == 2
    assert pollo_row["target_days"] == 60
    assert pollo_row["ready_for_training"] is False


def test_predictions_encargado_readonly_and_error_margin(client, fake_db, tmp_path):
    """Problema 3 y 5: Encargado lee predicciones de su sucursal con rango ±RMSE, pero no genera nuevas."""
    start = date(2026, 1, 1)
    for i in range(85):
        d = start + timedelta(days=i)
        qty = 40.0 + (22.0 if d.weekday() >= 4 else 0.0) + i * 0.15
        fake_db.collection(CONSUMPTION_DAILY).document(consumption_doc_id("suc_central", "item_pollo", d)).set({
            "branch_id": "suc_central",
            "item_id": "item_pollo",
            "consumption_date": d.isoformat(),
            "quantity_base": round(qty, 3),
            "unit": "kg",
            "status": "medido",
        })

    train_res = train_and_evaluate(
        item_id="item_pollo",
        branch_id="suc_central",
        published_by_uid="uid_admin",
        db=fake_db,
        models_dir=tmp_path,
        save_cache=False,
    )
    assert train_res["status"] == "publicado"

    target = (start + timedelta(days=85)).isoformat()

    # Encargado NO puede invocar POST /predict
    enc_post = client.post(
        "/api/v1/predictions/predict",
        headers=auth_headers("uid_encargado"),
        json={"branch_id": "suc_central", "item_id": "item_pollo", "prediction_for_date": target},
    )
    assert enc_post.status_code == 403

    # Gerente SÍ genera predicción y recibe MAE, RMSE, R² y rango ± RMSE
    ger_post = client.post(
        "/api/v1/predictions/predict",
        headers=auth_headers("uid_gerente"),
        json={"branch_id": "suc_central", "item_id": "item_pollo", "prediction_for_date": target},
    )
    assert ger_post.status_code == 200
    pred = ger_post.json()
    assert pred["status"] == "ok"
    assert pred["mae"] is not None
    assert pred["rmse"] is not None
    assert pred["r2"] is not None
    assert pred["range_min"] <= pred["predicted_quantity"] <= pred["range_max"]
    assert pred["unit"] == "kg"

    # Encargado SÍ puede leer predicciones de su sucursal (`suc_central`)
    enc_get = client.get(
        "/api/v1/predictions/",
        params={"branch_id": "suc_central"},
        headers=auth_headers("uid_encargado"),
    )
    assert enc_get.status_code == 200
    preds_list = enc_get.json()
    assert len(preds_list) == 1
    assert preds_list[0]["range_min"] is not None
    assert preds_list[0]["rmse"] is not None

    # Encargado NO puede leer predicciones de otra sucursal (`suc_norte`)
    enc_other = client.get(
        "/api/v1/predictions/",
        params={"branch_id": "suc_norte"},
        headers=auth_headers("uid_encargado"),
    )
    assert enc_other.status_code == 403


def test_consolidated_three_branches_report_and_eda(client, fake_db, tmp_path):
    """Problema 4 + EDA: Reporte consolidado compara 3 sucursales y EDA genera resumen y CSV."""
    for bid, base_qty in [("suc_central", 60.0), ("suc_norte", 45.0), ("suc_sur", 30.0)]:
        for day_offset in range(5):
            d = date(2026, 11, 1) + timedelta(days=day_offset)
            fake_db.collection(CONSUMPTION_DAILY).document(consumption_doc_id(bid, "item_pollo", d)).set({
                "branch_id": bid,
                "item_id": "item_pollo",
                "consumption_date": d.isoformat(),
                "quantity_base": base_qty + day_offset,
                "unit": "kg",
                "status": "medido",
            })

    # Admin ve las 3 sucursales comparadas
    res_admin = client.get(
        "/api/v1/reports/consolidated",
        params={"from_date": "2026-11-01", "to_date": "2026-11-10"},
        headers=auth_headers("uid_admin"),
    )
    assert res_admin.status_code == 200
    cons = res_admin.json()
    assert len(cons["by_branch"]) == 3
    assert len(cons["daily_comparison"]) == 5
    assert cons["totals"]["validated_records"] == 15

    # Gerente solo ve sus 2 sucursales autorizadas (`suc_central`, `suc_norte`)
    res_gerente = client.get(
        "/api/v1/reports/consolidated",
        params={"from_date": "2026-11-01", "to_date": "2026-11-10"},
        headers=auth_headers("uid_gerente"),
    )
    assert res_gerente.status_code == 200
    assert {b["branch_id"] for b in res_gerente.json()["by_branch"]} == {"suc_central", "suc_norte"}

    # Encargado no tiene permiso a reportes consolidados
    res_enc = client.get(
        "/api/v1/reports/consolidated",
        params={"from_date": "2026-11-01", "to_date": "2026-11-10"},
        headers=auth_headers("uid_encargado"),
    )
    assert res_enc.status_code == 403

    # Exportación CSV consolidada
    csv_res = client.get(
        "/api/v1/reports/consumption-export",
        params={"from_date": "2026-11-01", "to_date": "2026-11-10"},
        headers=auth_headers("uid_admin"),
    )
    assert csv_res.status_code == 200
    assert "sucursal_nombre" in csv_res.text

    # Análisis exploratorio de datos (EDA) desde Cloud Firestore
    eda_report = run_eda_analysis(db=fake_db, output_dir=tmp_path, export_files=True)
    assert eda_report["source"] == "Cloud Firestore (NoSQL)"
    assert eda_report["data_quality"]["validated_records"] == 15
    assert len(eda_report["branch_comparison"]) == 3
    assert (tmp_path / "resumen_eda.json").exists()
    assert (tmp_path / "eda_comparativa_sucursales.csv").exists()
