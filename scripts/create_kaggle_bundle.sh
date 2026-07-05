#!/bin/bash
# create_kaggle_bundle.sh — Genera bundle limpio de CodexWeb para Kaggle
# Sin secretos, DBs prod, node_modules, backups, etc.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${ROOT_DIR}/artifacts/kaggle-bundle"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BUNDLE_NAME="codexweb-kaggle-${TIMESTAMP}.tar.gz"
BUNDLE_PATH="${OUTPUT_DIR}/${BUNDLE_NAME}"
MANIFEST_PATH="${OUTPUT_DIR}/manifest.json"
SHA256_PATH="${OUTPUT_DIR}/sha256.txt"
LATEST_LINK="${OUTPUT_DIR}/codexweb-kaggle-latest.tar.gz"

echo "=== CodexWeb Kaggle Bundle Generator ==="
echo "Root dir: $ROOT_DIR"
echo "Output dir: $OUTPUT_DIR"
echo ""

# Crear directorio de salida
mkdir -p "$OUTPUT_DIR"

# Crear directorio temporal para staging
STAGING_DIR=$(mktemp -d)
trap "rm -rf $STAGING_DIR" EXIT

echo "[1/6] Staging files to $STAGING_DIR..."

# Copiar archivos esenciales (excluyendo secretos y basura)
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.runtime' \
  --exclude='artifacts' \
  --exclude='backups' \
  --exclude='audit-output' \
  --exclude='app.db' \
  --exclude='app.db-shm' \
  --exclude='app.db-wal' \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='deploy/*.env' \
  --exclude='deploy/codexwebdev.env' \
  --exclude='deploy/codexweb.env' \
  --exclude='*.bak' \
  --exclude='*.tmp' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  --exclude='torrent-reconnect-system' \
  --exclude='public/downloads' \
  --exclude='DIXIT' \
  --exclude='data' \
  --exclude='*.test.js' \
  "$ROOT_DIR/" "$STAGING_DIR/codexweb-app/"

echo "[2/6] Creating sanitized .env.kaggle..."

# Crear .env.kaggle sin secretos
cat > "$STAGING_DIR/codexweb-app/.env.kaggle" <<EOF
# CodexWeb Kaggle Configuration
# Este archivo NO contiene secretos — deben configurarse en Kaggle

NODE_ENV=kaggle
PORT=3000
HOST=0.0.0.0

# Rutas configuradas automáticamente por kaggle-adapter
# DB_PATH=/kaggle/working/codexweb-runtime/app.kaggle.db
# UPLOADS_DIR=/kaggle/working/codexweb-runtime/uploads
# STATIC_ASSETS_DIR=/kaggle/working/codexweb-app/public

# Claude Code (configurar en Kaggle Secrets)
CLAUDE_CODE_ENABLED=true
CLAUDE_CODE_BIN=claude
# ANTHROPIC_API_KEY=<configurar en Kaggle>

# Codex CLI (configurar en Kaggle Secrets)
# OPENROUTER_API_KEY=<configurar en Kaggle>

# Session
SESSION_SECRET=change-this-in-kaggle

# Admin user (cambiar en primera ejecución)
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=\$2a\$10\$rGFakeHashForKaggleOnly
EOF

echo "[3/6] Creating README.kaggle.md..."

cat > "$STAGING_DIR/codexweb-app/README.kaggle.md" <<'EOF'
# CodexWeb para Kaggle

Este bundle contiene CodexWeb adaptado para ejecutarse en Kaggle Kernels.

## Requisitos

- Kaggle Kernel con Python 3
- Secrets configurados: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`
- ngrok token (opcional, para túnel público)

## Instalación rápida

1. Descarga el bundle desde tu VPS
2. Extrae en `/kaggle/working/codexweb-app`
3. Ejecuta `python kaggle_bootstrap_cell.py`

## Estructura

- `/kaggle/working/codexweb-app` — Código de CodexWeb
- `/kaggle/working/codexweb-runtime` — DB, uploads, logs
- `/kaggle/working/workspace` — Tu workspace de desarrollo

## Verificación

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/runtime/kaggle/status
```

## Túnel público

El bootstrap automáticamente crea un túnel con ngrok (si hay token) o pinggy.

## Documentación completa

Ver `CLAUDE.md` y `PROJECT_CONTEXT.md` en el bundle.
EOF

echo "[4/6] Creating tarball..."

cd "$STAGING_DIR"
tar -czf "$BUNDLE_PATH" codexweb-app/

BUNDLE_SIZE=$(du -h "$BUNDLE_PATH" | cut -f1)
echo "Bundle created: $BUNDLE_PATH ($BUNDLE_SIZE)"

echo "[5/6] Generating SHA256 checksum..."

cd "$OUTPUT_DIR"
SHA256SUM=$(sha256sum "$BUNDLE_NAME" | cut -d' ' -f1)
echo "$SHA256SUM  $BUNDLE_NAME" > "$SHA256_PATH"
echo "SHA256: $SHA256SUM"

echo "[6/6] Creating manifest.json..."

cat > "$MANIFEST_PATH" <<EOF
{
  "version": "1.0.0",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "bundle": {
    "filename": "$BUNDLE_NAME",
    "size_bytes": $(stat -c%s "$BUNDLE_PATH"),
    "size_human": "$BUNDLE_SIZE",
    "sha256": "$SHA256SUM"
  },
  "environment": "kaggle",
  "requirements": {
    "node_version": ">=18.0.0",
    "python_version": ">=3.8",
    "secrets": [
      "ANTHROPIC_API_KEY",
      "OPENROUTER_API_KEY"
    ],
    "optional_secrets": [
      "NGROK_AUTHTOKEN"
    ]
  },
  "paths": {
    "app": "/kaggle/working/codexweb-app",
    "runtime": "/kaggle/working/codexweb-runtime",
    "workspace": "/kaggle/working/workspace"
  },
  "endpoints": [
    "/api/health",
    "/api/runtime/kaggle/status",
    "/api/runtime/claude/preflight",
    "/api/runtime/codex/preflight"
  ]
}
EOF

# Crear symlink latest
ln -sf "$BUNDLE_NAME" "$LATEST_LINK"

echo ""
echo "=== Bundle Generation Complete ==="
echo ""
echo "Bundle: $BUNDLE_PATH"
echo "SHA256: $SHA256_PATH"
echo "Manifest: $MANIFEST_PATH"
echo "Latest: $LATEST_LINK"
echo ""
echo "To serve via endpoint, enable KAGGLE_BUNDLE_ENDPOINT=true in server.js"
echo ""
