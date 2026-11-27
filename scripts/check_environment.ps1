# Verificación del entorno de desarrollo — Pollos al Vuelo (Firebase Auth + Cloud Firestore)
# Ejecutar desde la raíz del proyecto: .\scripts\check_environment.ps1

Write-Host "=== Verificación del entorno Pollos al Vuelo (Cloud Firestore) ===" -ForegroundColor Cyan
Write-Host ""

$errores = 0

# Node.js
try {
    $nodeV = node --version 2>&1
    Write-Host "OK  Node.js: $nodeV" -ForegroundColor Green
} catch {
    Write-Host "ERROR  Node.js no encontrado. Instalar desde https://nodejs.org/en/download" -ForegroundColor Red
    $errores++
}

# npm
try {
    $npmV = npm --version 2>&1
    Write-Host "OK  npm: $npmV" -ForegroundColor Green
} catch {
    Write-Host "ERROR  npm no encontrado." -ForegroundColor Red
    $errores++
}

# Python
try {
    $pyV = python --version 2>&1
    Write-Host "OK  Python: $pyV" -ForegroundColor Green
} catch {
    Write-Host "ERROR  Python no encontrado." -ForegroundColor Red
    $errores++
}

# Virtual env backend
if (Test-Path "backend\.venv\Scripts\python.exe") {
    Write-Host "OK  Virtual env backend: backend\.venv\" -ForegroundColor Green
} else {
    Write-Host "WARN  Virtual env no creado. Ejecutar: python -m venv backend\.venv" -ForegroundColor Yellow
}

# Credenciales de Firebase (archivo o .env)
if ((Test-Path "backend\firebase-service-account.json") -or (Test-Path "backend\.env")) {
    Write-Host "OK  Configuración de Firebase detectada en backend\" -ForegroundColor Green
} else {
    Write-Host "WARN  Configura backend\.env con FIREBASE_PROJECT_ID y FIREBASE_CREDENTIALS_JSON o FIREBASE_CREDENTIALS_PATH" -ForegroundColor Yellow
}

# Firebase CLI (Hosting + Firestore indexes/rules + Emulators)
try {
    $fbV = firebase --version 2>&1
    Write-Host "OK  Firebase CLI: $fbV" -ForegroundColor Green
} catch {
    Write-Host "WARN  Firebase CLI no instalado. Ejecutar: npm install -g firebase-tools" -ForegroundColor Yellow
}

Write-Host ""
if ($errores -eq 0) {
    Write-Host "Todo listo para desarrollo sobre Firebase Auth + Cloud Firestore." -ForegroundColor Green
} else {
    Write-Host "$errores error(es) crítico(s) detectado(s). Instalar herramientas faltantes." -ForegroundColor Red
}
