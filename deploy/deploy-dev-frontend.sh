#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/root/CodexWeb"
FRONTEND_DIR="$REPO_ROOT/stitch_frontend"
DIST_DIR="$FRONTEND_DIR/dist"
TARGET_DIR="${1:-$REPO_ROOT/.runtime/dev/public}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${TARGET_DIR}.bak.${TIMESTAMP}"

# Verificación automática de git state (opcional, descomenta para forzar)
# "$REPO_ROOT/deploy/verify-before-deploy.sh"

if [[ ! -d "$DIST_DIR" ]]; then
  echo "❌ Build no encontrado en $DIST_DIR" >&2
  echo "Ejecuta primero: cd $FRONTEND_DIR && npm run build" >&2
  exit 1
fi

# Verificar que el build sea reciente (menos de 10 minutos)
DIST_AGE_SECONDS=$(($(date +%s) - $(stat -c %Y "$DIST_DIR")))
if [[ $DIST_AGE_SECONDS -gt 600 ]]; then
  echo "⚠️  ADVERTENCIA: El build tiene más de 10 minutos"
  echo "Última modificación: $(stat -c %y "$DIST_DIR")"
  read -p "¿Continuar de todos modos? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Abortado. Recompila primero: cd $FRONTEND_DIR && npm run build"
    exit 1
  fi
fi

mkdir -p "$(dirname "$TARGET_DIR")"

if [[ -d "$TARGET_DIR" ]]; then
  cp -a "$TARGET_DIR" "$BACKUP_DIR"
fi

rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -a "$DIST_DIR/." "$TARGET_DIR/"

for extra_file in boot-monitor.js diag.html diag.js legacy-bootstrap.js; do
  if [[ -f "$FRONTEND_DIR/public/$extra_file" ]]; then
    cp -a "$FRONTEND_DIR/public/$extra_file" "$TARGET_DIR/$extra_file"
  fi
done

echo "✅ Frontend DEV desplegado en $TARGET_DIR"
if [[ -d "$BACKUP_DIR" ]]; then
  echo "📦 Backup: $BACKUP_DIR"
fi

# Mostrar hash del bundle principal para verificación
MAIN_BUNDLE=$(find "$TARGET_DIR/assets" -name "index-*.js" -type f | head -1)
if [[ -n "$MAIN_BUNDLE" ]]; then
  BUNDLE_NAME=$(basename "$MAIN_BUNDLE")
  BUNDLE_SIZE=$(du -h "$MAIN_BUNDLE" | cut -f1)
  echo "📄 Bundle: $BUNDLE_NAME ($BUNDLE_SIZE)"
fi

echo ""
echo "🔄 Reinicia el servicio con:"
echo "   sudo systemctl restart codexwebdev.service"
