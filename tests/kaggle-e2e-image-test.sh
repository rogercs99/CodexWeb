#!/bin/bash
# Test E2E: Generar imagen en Kaggle, pixelarla y descargar output
# Este test verifica el flujo completo: submit -> polling -> download

set -e

BASE_URL="http://127.0.0.1:3060"
COOKIE_FILE="/tmp/kaggle-e2e-cookie.txt"

echo "=== TEST E2E KAGGLE: Generar y pixelar imagen ==="
echo ""

# 1. Login para obtener cookie de sesión
echo "[1/6] Autenticando..."
LOGIN_RESPONSE=$(curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"roger","password":"test123"}')

if echo "$LOGIN_RESPONSE" | grep -q "error"; then
  echo "❌ Error de autenticación: $LOGIN_RESPONSE"
  exit 1
fi
echo "✅ Autenticado correctamente"

# 2. Crear un chat nuevo
echo ""
echo "[2/6] Creando chat de prueba..."
CHAT_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/conversations" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Kaggle E2E - Imagen Pixelada"}')

CHAT_ID=$(echo "$CHAT_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
if [ -z "$CHAT_ID" ]; then
  echo "❌ Error creando chat: $CHAT_RESPONSE"
  exit 1
fi
echo "✅ Chat creado: ID=$CHAT_ID"

# 3. Código Python para generar imagen, pixelarla y guardar
PYTHON_CODE='
import numpy as np
from PIL import Image
import os

# Crear directorio de output
os.makedirs("/kaggle/working", exist_ok=True)

# 1. Generar imagen con gradiente colorido (200x200)
print("Generando imagen original...")
width, height = 200, 200
img_array = np.zeros((height, width, 3), dtype=np.uint8)

for y in range(height):
    for x in range(width):
        img_array[y, x] = [
            int(255 * x / width),           # R: gradiente horizontal
            int(255 * y / height),          # G: gradiente vertical  
            int(255 * (x + y) / (width + height))  # B: diagonal
        ]

original = Image.fromarray(img_array)
original.save("/kaggle/working/original.png")
print("✅ Imagen original guardada: original.png")

# 2. Pixelar la imagen (reducir a 20x20 y escalar de vuelta)
print("Pixelando imagen...")
pixel_size = 10
small = original.resize((width // pixel_size, height // pixel_size), Image.NEAREST)
pixelated = small.resize((width, height), Image.NEAREST)
pixelated.save("/kaggle/working/pixelated.png")
print("✅ Imagen pixelada guardada: pixelated.png")

# 3. Crear comparación lado a lado
print("Creando comparación...")
comparison = Image.new("RGB", (width * 2 + 20, height + 40), (255, 255, 255))
comparison.paste(original, (0, 40))
comparison.paste(pixelated, (width + 20, 40))
comparison.save("/kaggle/working/comparison.png")
print("✅ Comparación guardada: comparison.png")

# Listar outputs
print("")
print("=== OUTPUTS GENERADOS ===")
for f in os.listdir("/kaggle/working"):
    size = os.path.getsize(f"/kaggle/working/{f}")
    print(f"  - {f} ({size} bytes)")

print("")
print("🎉 Test completado exitosamente!")
'

# 4. Enviar a Kaggle
echo ""
echo "[3/6] Enviando código a Kaggle..."
SUBMIT_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/kaggle/submit" \
  -H "Content-Type: application/json" \
  -d "{\"code\": $(echo "$PYTHON_CODE" | jq -Rs .), \"chatId\": $CHAT_ID}")

JOB_ID=$(echo "$SUBMIT_RESPONSE" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
if [ -z "$JOB_ID" ]; then
  echo "❌ Error enviando a Kaggle: $SUBMIT_RESPONSE"
  exit 1
fi
echo "✅ Job enviado: ID=$JOB_ID"

# 5. Polling del estado
echo ""
echo "[4/6] Esperando ejecución en Kaggle..."
MAX_ATTEMPTS=60
ATTEMPT=0
STATUS="queued"

while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  
  STATUS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/kaggle/status/$JOB_ID")
  STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  
  echo "   [$ATTEMPT/$MAX_ATTEMPTS] Estado: $STATUS"
  
  if [ "$STATUS" = "complete" ] || [ "$STATUS" = "completed" ]; then
    echo "✅ Ejecución completada!"
    break
  elif [ "$STATUS" = "error" ] || [ "$STATUS" = "failed" ]; then
    echo "❌ Error en ejecución"
    echo "$STATUS_RESPONSE" | jq .
    exit 1
  fi
  
  sleep 5
done

if [ "$STATUS" != "complete" ] && [ "$STATUS" != "completed" ]; then
  echo "❌ Timeout esperando ejecución"
  exit 1
fi

# 6. Obtener output
echo ""
echo "[5/6] Descargando output..."
OUTPUT_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/kaggle/output/$JOB_ID")
echo "Respuesta output:"
echo "$OUTPUT_RESPONSE" | jq .

# Verificar si hay archivos
FILES_COUNT=$(echo "$OUTPUT_RESPONSE" | grep -o '"files":\[' | wc -l)
if [ "$FILES_COUNT" -gt 0 ]; then
  echo ""
  echo "✅ Output disponible con archivos"
fi

# Resumen final
echo ""
echo "[6/6] === RESUMEN TEST E2E ==="
echo "  Chat ID: $CHAT_ID"
echo "  Job ID: $JOB_ID"
echo "  Estado final: $STATUS"
echo ""
echo "🎉 Test E2E completado!"
echo ""
echo "Para ver el job en la UI:"
echo "  https://codexwebdev.gamemodai.pro → Chat ID $CHAT_ID → Botón Kaggle"

# Cleanup
rm -f "$COOKIE_FILE"
