# Kaggle Integration E2E Test Prompt

## Objetivo
Probar el flujo completo de la integración Kaggle en CodexWeb dev:
1. Submit de código Python a Kaggle
2. Polling de estado hasta completar
3. Recuperación de output
4. Descarga autenticada de artefactos y bundle de outputs

## Pre-requisitos
- Servicio dev corriendo en puerto 3060
- Credenciales Kaggle configuradas en ~/.kaggle/kaggle.json
- Usuario autenticado en la app (requiere session cookie)
- `jq` instalado para usar el script automatizado

## Autenticación para pruebas
- Si ya tienes un usuario en dev, exporta `TEST_USER` y `TEST_PASS` antes de ejecutar el script.
- Si no defines esas variables, `tests/kaggle-e2e-test.sh` crea automáticamente un usuario temporal vía `POST /api/register` y usa esa sesión para la prueba.

---

## Test Cases

### Test 1: Hello World básico
```python
print("Hello from Kaggle!")
print("2 + 2 =", 2 + 2)
import sys
print("Python version:", sys.version)

with open("codexweb-artifact.txt", "w", encoding="utf-8") as fh:
    fh.write("artifact=ok\n")
    fh.write("sum=300\n")
```

**Expected**: Output con "Hello from Kaggle!", "2 + 2 = 4", versión de Python, y un archivo `codexweb-artifact.txt` descargable.

### Test 2: Procesamiento de datos
```python
import pandas as pd
import numpy as np

# Crear dataset de prueba
data = {
    'name': ['Alice', 'Bob', 'Charlie'],
    'age': [25, 30, 35],
    'score': [85.5, 92.3, 78.9]
}
df = pd.DataFrame(data)

print("Dataset creado:")
print(df)
print("\nEstadísticas:")
print(df.describe())
print("\nPromedio de edad:", df['age'].mean())
```

**Expected**: DataFrame impreso, estadísticas, y promedio = 30.

### Test 3: GPU check (opcional)
```python
import torch
print("PyTorch version:", torch.__version__)
print("CUDA available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("GPU:", torch.cuda.get_device_name(0))
else:
    print("Running on CPU")
```

**Expected**: Info de PyTorch y disponibilidad de GPU.

---

## Comandos de prueba manual (curl)

### Obtener cookie de sesión primero
Necesitas autenticarte en `https://codexwebdev.gamemodai.pro` y extraer la cookie de sesión, o registrar un usuario temporal en dev con `POST /api/register`.

### Submit job
```bash
curl -X POST https://codexwebdev.gamemodai.pro/api/kaggle/submit \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=<TU_SESSION_COOKIE>" \
  -d '{
    "code": "print(\"Hello from Kaggle!\")\nprint(\"2 + 2 =\", 2 + 2)",
    "title": "E2E Test Hello World",
    "enableGpu": false
  }'
```

### Check status
```bash
curl https://codexwebdev.gamemodai.pro/api/kaggle/status/<JOB_ID> \
  -H "Cookie: connect.sid=<TU_SESSION_COOKIE>"
```

### Get output
```bash
curl https://codexwebdev.gamemodai.pro/api/kaggle/output/<JOB_ID> \
  -H "Cookie: connect.sid=<TU_SESSION_COOKIE>"
```

La respuesta actual incluye `output`, `stderr`, `files`, `outputs`, `downloadLog` y `downloadUrl`.
Cada entrada de `outputs` también incluye su propio `downloadUrl`.

### Descargar bundle de outputs
```bash
curl -L https://codexwebdev.gamemodai.pro/api/kaggle/output/<JOB_ID>/download \
  -H "Cookie: connect.sid=<TU_SESSION_COOKIE>" \
  -o <JOB_ID>-outputs.zip
```

### Descargar un archivo concreto
```bash
curl -L "https://codexwebdev.gamemodai.pro/api/kaggle/output/<JOB_ID>/files/codexweb-artifact.txt/download" \
  -H "Cookie: connect.sid=<TU_SESSION_COOKIE>" \
  -o codexweb-artifact.txt
```

### List jobs
```bash
curl https://codexwebdev.gamemodai.pro/api/kaggle/jobs \
  -H "Cookie: connect.sid=<TU_SESSION_COOKIE>"
```

---

## Script de prueba automatizado

Ver `/root/CodexWeb/tests/kaggle-e2e-test.sh`
