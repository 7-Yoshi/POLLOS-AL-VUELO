# 🍗 Pollos al Vuelo — Sistema de Gestión Operativa

> **Proyecto de Grado** · Implementación de un modelo predictivo basado en Machine Learning (metodología **CRISP-DM**) sobre **Cloud Firestore (NoSQL)**, **Firebase Authentication** y **FastAPI** para la estimación del consumo de materia prima en 3 sucursales.

Sistema web de gestión operativa para la empresa **Pollos al Vuelo**, con autenticación en **Firebase Authentication**, persistencia documental en **Cloud Firestore (NoSQL)**, trazabilidad y auditoría por usuario, análisis exploratorio de datos (**EDA**) en Python (`pandas`) y predicción de consumo mediante regresión supervisada (`scikit-learn`).

---

## 🏗️ Arquitectura (Plan Spark + Render Free)

```
pollos-al-vuelo/
├── firebase.json            ← Configuración de Hosting, Firestore (reglas/índices) y Emuladores
├── firestore.rules          ← Bloqueo total al cliente web (acceso exclusivo vía FastAPI Admin SDK)
├── firestore.indexes.json   ← Índices compuestos de Cloud Firestore
├── backend/                 ← API FastAPI + ML Pipeline (CRISP-DM) + Módulo EDA + Scripts
├── frontend/                ← SPA React + TypeScript + Tailwind CSS + Recharts
├── docs/                    ← Registro formal de casos de prueba para la tesis
└── scripts/                 ← Verificación del entorno local (check_environment.ps1)
```

| Capa | Tecnología | Rol |
|------|-----------|-----|
| Frontend SPA | React 19 + TypeScript 5 + Vite 6 + Tailwind CSS 3.4 | Interfaz responsive desplegada en **Firebase Hosting (Spark)** |
| Gráficas | Recharts 2 | Tendencias diarias, comparativo de 3 sucursales y madurez ML |
| Autenticación | Firebase Authentication (`browserLocalPersistence`) | Gestión de identidades, tokens JWT, recuperación y cambio de clave |
| Base de Datos | **Cloud Firestore (NoSQL)** | Persistencia documental accedida únicamente vía **Firebase Admin SDK** |
| Backend API | Python 3.13 + FastAPI 0.115 + Firebase Admin SDK 6.6 | RBAC, aislamiento por sucursal, transacciones atómicas y auditoría |
| Analítica & ML | `pandas` + `NumPy` + `scikit-learn` + `joblib` | Reportes consolidados, EDA y modelos predictivos (MAE, RMSE, R²) |
| Despliegue API | Render Free | Web Service con credenciales vía `FIREBASE_CREDENTIALS_JSON` |

> **Regla de arquitectura:** No se utilizan Cloud Functions (requieren plan Blaze). Toda lógica transaccional, control de acceso, actualización de saldos y cálculo analítico reside en FastAPI usando Firebase Admin SDK, manteniendo `firestore.rules` en `allow read, write: if false;` para clientes externos.

---

## 🗄️ Modelo de Datos NoSQL (Cloud Firestore)

| Colección | ID del documento | Propósito y patrón NoSQL |
|-----------|------------------|--------------------------|
| `branches` | Auto-ID / slug (`suc_central`, `suc_norte`, `suc_sur`) | Catálogo de las 3 sucursales |
| `users` | **`{firebase_uid}`** | Perfil interno con `role`, `branch_ids[]`, `is_active` y `must_change_password` (**1 lectura O(1)** por request) |
| `items` | Auto-ID | Materias primas e insumos (`eligible_for_ml`, `min_stock`, soft delete) |
| `item_codes` | `{CODE_UPPER}` | Índice auxiliar transaccional para garantizar unicidad del código |
| `purchases` | Auto-ID | Compras con `lines[]` embebidas, `created_by_uid` y `created_at` |
| `inventory_movements` | Auto-ID | Historial de entradas/salidas con `signed_quantity`, `created_by_uid` y `created_at` |
| `inventory_balances` | **`{branch_id}__{item_id}`** | **Vista materializada** actualizada atómicamente en cada transacción (evita escanear todo el historial y protege la cuota Spark) |
| `consumption_daily` | **`{branch_id}__{item_id}__{YYYY-MM-DD}`** | Consumo real (`medido` / `calculado_validado` / `desconocido`); el ID compuesto garantiza unicidad atómica sin ceros artificiales |
| `import_batches` | **`{branch_id}__{sha256}`** | Control de lotes CSV históricos con deduplicación criptográfica SHA-256 |
| `operation_events` | Auto-ID | Calendario operativo M07 (`feriado`, `dia_especial`, `cierre`, `bloqueo`) con `active_dates[]` |
| `ml_model_versions` | **`{version_tag}`** | Metadatos de modelos publicados: `algorithm`, `features`, `mae`, `rmse`, `r2`, `baseline_mae`, `baseline_r2`, `evaluations[]` |
| `predictions` | **`{branch_id}__{item_id}__{date}__{version}`** | Estimaciones almacenadas con `mae`, `rmse`, `r2` y rango `± RMSE` (nunca sobrescribe consumo real) |
| `audit_logs` | Auto-ID | Bitácora inmutable de trazabilidad (`firebase_uid`, `user_email`, `action`, `entity_type`, `entity_id`, `branch_id`, `details`, `created_at`) |

### Optimización de cuotas del Plan Spark (gratuito)
- **Saldos en O(N_ítems):** `GET /api/v1/inventory/balance` lee la vista materializada `inventory_balances` (~15 lecturas por sucursal) en lugar de sumar todo el historial de movimientos.
- **Aggregation Queries (`count()`):** `GET /api/v1/consumption/readiness` usa consultas de agregación de Firestore (1 lectura por cada 1,000 documentos contados).
- **Caché local para ML:** `ml_pipeline/train.py` exporta snapshots CSV en `backend/storage/cache/` para repetir experimentos sin releer Firestore.
- **Lotes seguros:** la importación CSV escribe en bloques de máximo 400 operaciones (por debajo del límite de 500 por batch de Firestore).

---

## 🔐 Autenticación, Seguridad y Matriz de Permisos (RBAC)

- **Fuente de verdad:** Cloud Firestore (`users/{firebase_uid}`). Los **custom claims** de `role` en Firebase se sincronizan automáticamente al crear/editar usuarios para UX rápida en frontend, pero el backend valida siempre contra Firestore.
- **Verificación estricta:** `verify_id_token(check_revoked=True)` en todos los endpoints protegidos.
- **Revocación inmediata:** Al desactivar un usuario en `PATCH /api/v1/users/{uid}`, el backend ejecuta `revoke_refresh_tokens(uid)` y deshabilita la cuenta en Firebase Auth.
- **Alta unificada con compensación:** `POST /api/v1/users/` crea la cuenta en Firebase Auth (`auth.create_user`), asigna custom claim `role` y guarda `users/{uid}` + auditoría en Firestore en una sola operación; si Firestore falla, elimina la cuenta de Firebase automáticamente (cero usuarios huérfanos).
- **Primer ingreso y manejo de sesión:**
  - Flag `must_change_password` con pantalla obligatoria (`/change-password`, `updatePassword` + reautenticación si Firebase la requiere + `POST /api/v1/auth/password-changed`).
  - Recuperación de contraseña integrada (`sendPasswordResetEmail`) en `LoginPage.tsx`.
  - Persistencia explícita `browserLocalPersistence`.
  - Interceptor Axios (`frontend/src/lib/api.ts`) que ante un `401` llama a `getIdToken(true)` y reintenta exactamente una vez, con timeout de 45 s y aviso amigable de arranque en frío (*cold start*) para Render Free.

| Módulo | Admin | Gerente | Encargado |
|--------|:-----:|:-------:|:---------:|
| Dashboard + Indicador madurez ML (`días / 60`) | ✓ | ✓ | ✓ |
| Materias primas / Insumos (ver) | ✓ | ✓ | ✓ |
| Materias primas / Insumos (crear/editar/desactivar) | ✓ | — | — |
| Compras (ver) | ✓ | ✓ | ✓ |
| Compras (registrar atómicamente) | ✓ | — | ✓ |
| Inventario (saldos y movimientos ver) | ✓ | ✓ | ✓ |
| Inventario (registrar movimientos) | ✓ | — | ✓ |
| Consumo diario (ver) | ✓ | ✓ | ✓ |
| Consumo diario (registrar / importar CSV histórico) | ✓ | — | ✓ |
| Calendario de operaciones (M07) | ✓ | ✓ | — |
| **Predicciones ML (consultar con rango ± RMSE)** | ✓ | ✓ | **✓ (solo lectura, su sucursal)** |
| Predicciones ML (solicitar nueva predicción) | ✓ | ✓ | — |
| Reportes individuales y **Consolidado 3 sucursales** | ✓ | ✓ | — |
| Auditoría (`GET /api/v1/audit/` + `/audit`) | ✓ (solo lectura; inmutable) | ✓ (sus sucursales; inmutable) | — |
| Usuarios (crear, editar rol/sucursales, desactivar + revocar) | ✓ | — | — |
| Sucursales (ver / gestionar) | ✓ | ver | — |

**Reglas de alcance y personal no autorizado:**
- **Administrador:** acceso automático a las 3 sucursales; **no puede modificar ni eliminar registros de auditoría** (`PUT`/`PATCH`/`DELETE /api/v1/audit/{id}` retornan HTTP 403).
- **Gerente:** al menos 1 sucursal asignada; consulta operativa en solo lectura, gestiona calendario/predicciones, reportes y auditoría restringida a sus sucursales.
- **Encargado de sucursal:** exactamente **1 sucursal asignada** (validado en backend con HTTP 422 y selector único en UI); opera compras, inventario, consumo diario, CSV y consulta predicciones de su sucursal.
- **Demás trabajadores** (cocineros, cajeros, meseros y personal de limpieza): **no tienen acceso al sistema** (lista blanca estricta en `deps.py`, sin auto-registro), salvo autorización explícita del Administrador asignándoles el rol `encargado`.

### Checklist de seguridad en consola (Firebase / Google Cloud / Render)

1. **Desactivar auto-registro público:** Firebase Console → `Authentication → Settings → User actions` → desmarcar *Enable create (sign-up)*.
2. **Dominios autorizados:** Firebase Console → `Authentication → Settings → Authorized domains` → agregar el dominio de Firebase Hosting (`<proyecto>.web.app` y `<proyecto>.firebaseapp.com`).
3. **Restringir API Key Web:** Google Cloud Console → `APIs & Services → Credentials` → restringir por HTTP referrers al dominio de Firebase Hosting (y `http://localhost:5173/*` en desarrollo).
4. **Credenciales en Render:** Configurar la variable de entorno `FIREBASE_CREDENTIALS_JSON` (o un *Secret File* en `/etc/secrets/firebase-service-account.json`). **Nunca** subir `.env` ni `firebase-service-account.json` al repositorio.
5. **Desplegar reglas e índices de Firestore:** `firebase deploy --only firestore:rules,firestore:indexes`.
6. *(Opcional futuro)*: Activar Firebase App Check con reCAPTCHA v3 para mitigar tráfico automatizado.

---

## 📊 Metodología CRISP-DM y Machine Learning

El proyecto implementa formalmente las **6 fases de CRISP-DM**, mapeadas directamente a archivos del repositorio:

| Fase CRISP-DM | Descripción aplicada a Pollos al Vuelo | Archivos del proyecto |
|---|---|---|
| **1. Comprensión del negocio** | Reducir quiebres de stock y merma en 3 sucursales eliminando la dependencia exclusiva de la experiencia del personal; definir roles, sucursales y eventos operativos | `README.md`, `backend/app/core/permissions.py`, `backend/app/modules/branches/router.py`, `backend/app/modules/operations/router.py` |
| **2. Comprensión de los datos** | Validar cobertura real (`medido` / `calculado_validado` vs `desconocido`), medir madurez histórica (`días / 60`), detectar outliers (IQR), estacionalidad semanal e impacto de feriados | `backend/analytics/eda_firestore.py`, `backend/app/modules/consumption/router.py` (`/readiness`), `backend/app/modules/reports/router.py` (`/consolidated`) |
| **3. Preparación de los datos** | Carga histórica CSV con deduplicación SHA-256, extracción desde Cloud Firestore con caché local reproducible, cálculo de lags/rolling **sin fuga de futuro** e integración del Calendario M07 | `backend/app/modules/consumption/router.py` (`/import-csv`), `backend/app/ml/features.py`, `backend/ml_pipeline/train.py` (`extract_training_data`, `build_features`) |
| **4. Modelado** | Split temporal estricto 80/20 (sin barajar) y entrenamiento comparativo de 3 algoritmos de regresión supervisada (`Ridge`, `GradientBoostingRegressor`, `RandomForestRegressor`) frente a baseline histórico | `backend/ml_pipeline/train.py` (`train_and_evaluate`) |
| **5. Evaluación** | Evaluación cuantitativa con **MAE, RMSE y R²** (`r2_score`), criterio de publicación (`MAE_modelo < MAE_baseline`), almacenamiento de resultados en `ml_model_versions` y pruebas anti-fuga | `backend/ml_pipeline/train.py`, `backend/tests/test_ml_no_leakage.py` |
| **6. Despliegue** | Registro de versión activa en Firestore, carga de artefacto `.joblib`, inferencia vía API con margen de error visible (`± RMSE` y `MAE / RMSE / R²`) para Admin, Gerente y Encargado (solo lectura) | `backend/app/ml/registry.py`, `backend/app/ml/predictor.py`, `backend/app/modules/predictions/router.py`, `frontend/src/features/predictions/PredictionsPage.tsx` |

### Variables del modelo (10 features sin filtración de futuro)

| Feature | Origen | Descripción |
|---|---|---|
| `dow` | Calendario | Día de la semana (0 = lunes, 6 = domingo) |
| `month` | Calendario | Mes del año (1–12) |
| `lag_1`, `lag_7`, `lag_14` | `consumption_daily` | Consumo real validado hace 1, 7 y 14 días (estrictamente `< fecha objetivo`, agrupado por sucursal) |
| `rolling_7`, `rolling_30` | `consumption_daily` | Medias móviles de 7 y 30 días usando únicamente datos pasados |
| `es_feriado` | **Calendario M07** | `1` si la fecha objetivo es feriado en la sucursal, `0` en caso contrario |
| `es_dia_especial` | **Calendario M07** | `1` si existe evento `dia_especial` programado en la sucursal |
| `es_cierre` | **Calendario M07** | `1` si existe `cierre` o `bloqueo` operativo en la sucursal |

### Guardas de calidad del pipeline ML
- Mínimo **60 días** de consumo real validado para entrenamiento (`ml_pipeline/train.py`).
- Mínimo **30 días** de historial validado para inferencia en API (`app/ml/features.py`).
- **Sin fuga de futuro ni entre sucursales:** lags calculados por sucursal sobre fechas estrictamente anteriores a la fecha objetivo; split temporal 80/20 sin barajar.
- El modelo solo se publica si **supera el baseline** (`MAE_modelo < MAE_baseline`).
- Verificación de dimensión (`n_features_in_`) al cargar el artefacto `.joblib` en `app/ml/predictor.py`.
- En la interfaz, cada predicción muestra el valor puntual, el rango **± RMSE** (`max(0, pred - rmse)` a `pred + rmse`) y las métricas **MAE, RMSE y R²**.

---

## 📈 Análisis de Datos (EDA) desde Cloud Firestore

Para realizar análisis exploratorio y generar tablas estadísticas para la tesis (o abrir los datos en Excel, Power BI o Google Colab sin pagar BigQuery/Blaze), ejecuta el módulo `analytics.eda_firestore`:

```powershell
cd backend
# Exportar snapshots CSV + reporte JSON completo (calidad, outliers IQR, estacionalidad, impacto M07 y comparativa 3 sucursales)
.\.venv\Scripts\python.exe -m analytics.eda_firestore --output storage/exports

# Filtrar por una sucursal o período específico
.\.venv\Scripts\python.exe -m analytics.eda_firestore --branch suc_central --from-date 2026-09-01 --to-date 2026-11-30
```

Archivos generados en `backend/storage/exports/`:
- `resumen_eda.json` — Resumen estructurado completo (calidad de datos, estadística descriptiva, outliers IQR, estacionalidad, impacto de feriados/días especiales, comparativa entre sucursales y tabla de modelos ML).
- `eda_estadistica_items.csv`, `eda_estacionalidad_semanal.csv`, `eda_comparativa_sucursales.csv`.
- Snapshots limpios de colecciones (`consumption.csv`, `purchases.csv`, `balances.csv`, `events.csv`, `models.csv`).

---

## 📂 Estructura de carpetas

```
pollos-al-vuelo/
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── docs/
│   └── REGISTRO_CASOS_DE_PRUEBA.md   ← Matriz formal de casos de prueba (CP-01 a CP-26)
├── scripts/
│   └── check_environment.ps1         ← Verificación de Python, Node, Firebase CLI
├── backend/
│   ├── app/
│   │   ├── main.py                   ← Entrada FastAPI + /health (Cloud Firestore)
│   │   ├── api/                      ← router.py + deps.py (AuthUser, DbClient)
│   │   ├── core/                     ← config, permissions, firebase_auth, audit, exceptions, logging
│   │   ├── db/                       ← firestore_client.py, collections.py, models.py
│   │   ├── ml/                       ← features.py (10 features + M07), predictor.py, registry.py
│   │   └── modules/                  ← auth, users, branches, items, purchases, inventory,
│   │                                    consumption, operations, predictions, reports, audit
│   ├── analytics/                    ← eda_firestore.py (Análisis exploratorio sobre Firestore)
│   ├── ml_pipeline/                  ← train.py (Entrenamiento offline CRISP-DM + MAE/RMSE/R²)
│   ├── scripts/                      ← seed_firestore.py (3 sucursales + Admin inicial)
│   ├── tests/                        ← fake_firestore.py, conftest.py, test_auth.py,
│   │                                    test_permissions.py, test_ml_no_leakage.py,
│   │                                    test_integration_flows.py, test_rbac_roles_matrix.py
│   ├── storage/                      ← models/ (.joblib), cache/ (CSV train), exports/ (EDA)
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── contexts/                 ← AuthContext (custom claims + cold start), BranchContext
    │   ├── features/                 ← audit (AuditPage inmutable), auth (LoginPage, PrivateRoute, ChangePasswordPage),
    │   │                                branches, consumption (+ importación CSV),
    │   │                                dashboard (+ madurez días/60), inventory, items,
    │   │                                operations, predictions (+ ±RMSE y solo lectura Encargado),
    │   │                                purchases, reports (+ consolidado 3 sucursales), users
    │   ├── layouts/                  ← AppLayout (sidebar + selector de sucursal)
    │   ├── lib/                      ← api.ts (Axios + retry 401 + 45s timeout),
    │   │                                firebase.ts (browserLocalPersistence + emulador)
    │   ├── test/                     ← permissions.test.ts, setup.ts
    │   └── types/                    ← index.ts (IDs string nativos de Firestore)
    ├── vite.config.ts
    ├── vitest.config.ts
    └── .env.example
```

---

## 📋 Módulos y Endpoints principales (`/api/v1`)

| # | Módulo | Endpoints clave | Descripción |
|---|---|---|---|
| M01 | Dashboard / Auth | `GET /auth/me`, `POST /auth/password-changed`, `GET /health` | Perfil Firestore, primer ingreso obligatorio, resumen operativo y madurez `días / 60` |
| M02 | Materias Primas | `GET/POST /items/`, `PATCH/DELETE /items/{id}` | Catálogo con código único transaccional, stock mínimo, `eligible_for_ml` y soft delete |
| M03 | Insumos | `GET/POST /items/?item_type=insumo` | Materiales auxiliares separados visualmente |
| M04 | Compras | `GET/POST /purchases/`, `GET /purchases/{id}` | Registro atómico (`purchases` + `inventory_movements` + `inventory_balances` + `audit_logs`) |
| M05 | Inventario | `GET /inventory/balance`, `GET/POST /inventory/movements` | Saldos materializados por sucursal, reconstrucción `as_of`, ajustes y mermas |
| M06 | Consumo Diario | `GET/POST /consumption/`, `GET /readiness`, `GET /csv-template`, `POST /import-csv` | Consumo real sin ceros artificiales, carga histórica CSV (SHA-256) e indicador `días / 60` |
| M07 | Calendario | `GET/POST /operations/events`, `DELETE /operations/events/{id}` | Feriados, cierres, bloqueos y días especiales integrados al modelo ML |
| M08 | Predicciones ML | `GET /predictions/`, `POST /predictions/predict` | Estimación con rango `± RMSE` y métricas `MAE/RMSE/R²`; Encargado en modo solo lectura |
| M09 | Reportes | `GET /reports/consumption-summary`, `/consumption-export`, `/consolidated` | Gráficas, exportación CSV y comparativo consolidado de las 3 sucursales |
| M10 | Auditoría y Usuarios | `GET /audit/`, `GET/POST /users/`, `PATCH /users/{uid}`, `GET/POST/PATCH /branches/` | Bitácora trazable por `firebase_uid`, alta unificada con compensación y revocación de tokens |

---

## ⚙️ Instalación y puesta en marcha en Local (Windows)

### Requisitos previos
- **Python 3.13+** — [python.org](https://www.python.org/downloads/)
- **Node.js 20+** — [nodejs.org](https://nodejs.org/)
- **Java 21+** (solo para correr el Emulador local de Firestore) y **Firebase CLI** (`npm install -g firebase-tools`)

### 1. Instalar dependencias del Backend y Frontend

```powershell
# Backend
cd C:\Users\hp\Downloads\pollos-al-vuelo\pollos-al-vuelo\backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env

# Frontend
cd C:\Users\hp\Downloads\pollos-al-vuelo\pollos-al-vuelo\frontend
npm install
Copy-Item .env.example .env.local
```

### 2. Ejecutar en Modo Emulador Local (recomendado para desarrollo sin tocar producción)

1. Verifica que existan estas líneas activas en `backend\.env`:
   ```env
   FIREBASE_PROJECT_ID=pollos-la-vuelo
   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
   ```
   *(El backend detecta automáticamente los emuladores y usa `_EmulatorCredential` con `AnonymousCredentials`, sin requerir proyecto real ni Google ADC.)*

2. Verifica que existan estas líneas activas en `frontend\.env.local`:
   ```env
   VITE_USE_FIREBASE_EMULATOR=true
   VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
   ```

3. **Terminal 1 — Iniciar Firebase Emulators (Auth + Firestore + UI):**
   ```powershell
   cd C:\Users\hp\Downloads\pollos-al-vuelo\pollos-al-vuelo
   firebase emulators:start --only auth,firestore --project pollos-la-vuelo
   ```
   *(Tip: para conservar los datos entre reinicios del emulador, agrega `--import=./.emulator-data --export-on-exit=./.emulator-data`.)*
   - Panel visual de Firestore y Auth: **http://127.0.0.1:4000**

4. **Poblar las 3 sucursales y el usuario Administrador inicial:**
   ```powershell
   cd C:\Users\hp\Downloads\pollos-al-vuelo\pollos-al-vuelo\backend
   .\.venv\Scripts\python.exe -m scripts.seed_firestore --admin-email admin@pollosalvuelo.com --admin-password AdminPollos2026! --admin-name "Administrador General" --reset-password
   ```
   *(Si el correo ya existía en Firebase Auth, el script es idempotente y lo vincula automáticamente a `users/{uid}` en Firestore.)*

5. **Terminal 2 — Iniciar Backend FastAPI:**
   ```powershell
   cd C:\Users\hp\Downloads\pollos-al-vuelo\pollos-al-vuelo\backend
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
   ```
   - API: **http://localhost:8000** · Salud: **http://localhost:8000/health** · Swagger: **http://localhost:8000/docs**

6. **Terminal 3 — Iniciar Frontend React:**
   ```powershell
   cd C:\Users\hp\Downloads\pollos-al-vuelo\pollos-al-vuelo\frontend
   npm run dev
   ```
   - App web: **http://localhost:5173**

### 3. Entrenar un modelo ML desde Firestore

```powershell
cd backend
# Entrenar modelo general para un ítem (todas las sucursales)
.\.venv\Scripts\python.exe -m ml_pipeline.train <item_id>

# Entrenar modelo específico para un ítem y sucursal
.\.venv\Scripts\python.exe -m ml_pipeline.train <item_id> suc_central
```

---

## 🧪 Pruebas automatizadas

```powershell
# Backend (36 pruebas offline con FakeFirestore)
cd backend
.\.venv\Scripts\python.exe -m pytest tests\ -v

# Backend incluyendo prueba end-to-end contra Firebase Auth Emulator en vivo (37/37)
$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
.\.venv\Scripts\python.exe -m pytest tests\ -v

# Frontend (12 pruebas Vitest + verificación TypeScript + bundle Vite 6)
cd frontend
npm run test
npm run build
```

Consulta la matriz formal de los **26 casos de prueba (`CP-01` a `CP-26`)** trazados a los problemas y objetivos de la tesis en [`docs/REGISTRO_CASOS_DE_PRUEBA.md`](docs/REGISTRO_CASOS_DE_PRUEBA.md).

---

## 🌐 Paso a Producción (Render Free + Firebase Spark)

1. En Firebase Console, crear la base de datos **Cloud Firestore** en modo producción y habilitar **Authentication (Email/Password)**.
2. Comentar las líneas de `# MODO EMULADOR LOCAL` en `backend\.env` y `frontend\.env.local`.
3. **Desplegar reglas, índices y SPA en Firebase:**
   ```powershell
   cd frontend
   npm run build
   cd ..
   firebase deploy --only hosting,firestore:rules,firestore:indexes
   ```
4. **Desplegar API en Render (Free):**
   - Root directory: `backend`
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Variables de entorno: `APP_ENV=production`, `FIREBASE_PROJECT_ID`, `FIREBASE_CREDENTIALS_JSON` (contenido completo del service account en una línea), `CORS_ORIGINS=https://<tu-proyecto>.web.app`.
5. Ejecutar `seed_firestore.py` una vez apuntando al proyecto de producción para crear las 3 sucursales y el primer administrador.

---

## 📄 Licencia

Proyecto académico — Pollos al Vuelo © 2026. Todos los derechos reservados.
