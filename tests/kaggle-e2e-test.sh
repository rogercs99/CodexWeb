#!/bin/bash
# Kaggle E2E Test Script
# Prueba el flujo completo: submit -> poll status -> get output

set -euo pipefail

BASE_URL="http://127.0.0.1:3060"
COOKIE_FILE="/tmp/kaggle-test-cookies.txt"

echo "=========================================="
echo "  Kaggle Integration E2E Test"
echo "=========================================="

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Función para imprimir status
print_status() {
    if [ "$1" == "ok" ]; then
        echo -e "${GREEN}✓${NC} $2"
    elif [ "$1" == "fail" ]; then
        echo -e "${RED}✗${NC} $2"
    else
        echo -e "${YELLOW}→${NC} $2"
    fi
}

# Test 1: Verificar que el servidor está corriendo
echo ""
print_status "info" "Verificando servidor dev..."
if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" | grep -q "200"; then
    print_status "ok" "Servidor dev corriendo en $BASE_URL"
else
    print_status "fail" "Servidor dev no responde"
    exit 1
fi

# Test 2: Obtener sesión autenticada
echo ""
print_status "info" "Autenticando..."

# Si TEST_USER/TEST_PASS no están definidos, crear un usuario temporal en dev.
LOGIN_USER="${TEST_USER:-}"
LOGIN_PASS="${TEST_PASS:-}"

if [ -n "$LOGIN_USER" ] || [ -n "$LOGIN_PASS" ]; then
    if [ -z "$LOGIN_USER" ] || [ -z "$LOGIN_PASS" ]; then
        print_status "fail" "Debes definir ambos TEST_USER y TEST_PASS"
        exit 1
    fi

    LOGIN_RESPONSE=$(curl -s -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
        -X POST "$BASE_URL/api/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$LOGIN_USER\",\"password\":\"$LOGIN_PASS\"}")

    if echo "$LOGIN_RESPONSE" | jq -e '.ok == true' >/dev/null 2>&1; then
        print_status "ok" "Login exitoso con usuario existente"
    else
        print_status "fail" "Login falló: $LOGIN_RESPONSE"
        exit 1
    fi
else
    LOGIN_USER="kagglee2e$(date +%s)"
    LOGIN_PASS="KaggleE2E!123"
    REGISTER_RESPONSE=$(curl -s -c "$COOKIE_FILE" -b "$COOKIE_FILE" \
        -X POST "$BASE_URL/api/register" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$LOGIN_USER\",\"password\":\"$LOGIN_PASS\"}")

    if echo "$REGISTER_RESPONSE" | jq -e '.ok == true' >/dev/null 2>&1; then
        print_status "ok" "Usuario temporal creado: $LOGIN_USER"
    else
        print_status "fail" "Registro temporal falló: $REGISTER_RESPONSE"
        exit 1
    fi
fi

# Test 3: Submit job a Kaggle
echo ""
print_status "info" "Enviando job a Kaggle..."

PYTHON_CODE='print("="*50)
print("  CodexWeb Kaggle E2E Test")
print("="*50)
print()
print("Hello from Kaggle!")
print("2 + 2 =", 2 + 2)

import sys
print("Python version:", sys.version.split()[0])

import pandas as pd
data = {"item": ["test1", "test2"], "value": [100, 200]}
df = pd.DataFrame(data)
print()
print("DataFrame test:")
print(df)
print()
print("Sum of values:", df["value"].sum())

artifact_name = "codexweb-artifact.txt"
with open(artifact_name, "w", encoding="utf-8") as fh:
    fh.write("artifact=ok\n")
    fh.write("sum=300\n")
    fh.write("rows=2\n")
print("Artifact written:", artifact_name)
print()
print("="*50)
print("  Test completed successfully!")
print("="*50)'

SUBMIT_RESPONSE=$(curl -s -b "$COOKIE_FILE" \
    -X POST "$BASE_URL/api/kaggle/submit" \
    -H "Content-Type: application/json" \
    -d "{\"code\": $(echo "$PYTHON_CODE" | jq -Rs .), \"title\": \"e2e-test-$(date +%s)\", \"enableGpu\": false}")

echo "Submit response: $SUBMIT_RESPONSE"

JOB_ID=$(echo "$SUBMIT_RESPONSE" | jq -r '.jobId // empty')

if [ -z "$JOB_ID" ]; then
    print_status "fail" "No se recibió jobId"
    exit 1
fi

print_status "ok" "Job enviado: $JOB_ID"

# Test 4: Poll status hasta completar
echo ""
print_status "info" "Esperando a que el job complete..."

MAX_ATTEMPTS=60
ATTEMPT=0
STATUS="queued"

while [ "$STATUS" != "complete" ] && [ "$STATUS" != "error" ] && [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))

    STATUS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/kaggle/status/$JOB_ID")
    STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status // "unknown"')

    echo -ne "\r  Intento $ATTEMPT/$MAX_ATTEMPTS - Estado: $STATUS          "

    if [ "$STATUS" == "complete" ] || [ "$STATUS" == "error" ]; then
        break
    fi

    sleep 10
done

echo ""

if [ "$STATUS" == "complete" ]; then
    print_status "ok" "Job completado exitosamente"
elif [ "$STATUS" == "error" ]; then
    print_status "fail" "Job terminó con error"
else
    print_status "fail" "Timeout esperando el job (intentos: $MAX_ATTEMPTS)"
    exit 1
fi

# Test 5: Obtener output
echo ""
print_status "info" "Obteniendo output..."

OUTPUT_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/kaggle/output/$JOB_ID")
OUTPUT=$(echo "$OUTPUT_RESPONSE" | jq -r '.output // empty')
BUNDLE_DOWNLOAD_URL=$(echo "$OUTPUT_RESPONSE" | jq -r '.downloadUrl // empty')
ARTIFACT_DOWNLOAD_URL=$(echo "$OUTPUT_RESPONSE" | jq -r '.outputs["codexweb-artifact.txt"].downloadUrl // empty')

if [ -n "$OUTPUT" ]; then
    print_status "ok" "Output recibido:"
    echo ""
    echo "--- OUTPUT START ---"
    echo "$OUTPUT"
    echo "--- OUTPUT END ---"
else
    print_status "fail" "No se pudo obtener output"
    echo "Response: $OUTPUT_RESPONSE"
fi

echo ""
print_status "info" "Descargando artifact del job..."

if [ -z "$ARTIFACT_DOWNLOAD_URL" ]; then
    print_status "fail" "La respuesta no incluye downloadUrl para codexweb-artifact.txt"
    echo "Response: $OUTPUT_RESPONSE"
    exit 1
fi

ARTIFACT_PATH="/tmp/${JOB_ID}-codexweb-artifact.txt"
if curl -sSf -b "$COOKIE_FILE" "$BASE_URL$ARTIFACT_DOWNLOAD_URL" -o "$ARTIFACT_PATH" && grep -q "sum=300" "$ARTIFACT_PATH"; then
    print_status "ok" "Artifact descargado y verificado"
else
    print_status "fail" "No se pudo descargar o validar el artifact"
    exit 1
fi

echo ""
print_status "info" "Descargando bundle zip de outputs..."

if [ -z "$BUNDLE_DOWNLOAD_URL" ]; then
    print_status "fail" "La respuesta no incluye downloadUrl del bundle"
    echo "Response: $OUTPUT_RESPONSE"
    exit 1
fi

BUNDLE_PATH="/tmp/${JOB_ID}-outputs.zip"
if curl -sSf -b "$COOKIE_FILE" "$BASE_URL$BUNDLE_DOWNLOAD_URL" -o "$BUNDLE_PATH" && [ -s "$BUNDLE_PATH" ]; then
    print_status "ok" "Bundle zip descargado"
else
    print_status "fail" "No se pudo descargar el bundle zip"
    exit 1
fi

# Test 6: Listar jobs
echo ""
print_status "info" "Listando jobs..."

JOBS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/kaggle/jobs?limit=5")
JOBS_COUNT=$(echo "$JOBS_RESPONSE" | jq '.jobs | length // 0')

print_status "ok" "Jobs listados: $JOBS_COUNT"

# Cleanup
rm -f "$COOKIE_FILE"
rm -f "$ARTIFACT_PATH" "$BUNDLE_PATH"

echo ""
echo "=========================================="
echo "  E2E Test Complete!"
echo "=========================================="
