#!/usr/bin/env bash
# Script completo para build + deploy seguro a dev

set -euo pipefail

REPO_ROOT="/root/CodexWeb"
FRONTEND_DIR="$REPO_ROOT/stitch_frontend"

echo "🚀 Despliegue completo a DEV"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Paso 1: Verificar git state
echo "📋 Paso 1/5: Verificando estado del repositorio..."
"$REPO_ROOT/deploy/verify-before-deploy.sh" || exit 1
echo ""

# Paso 2: Build frontend
echo "🔨 Paso 2/5: Compilando frontend..."
cd "$FRONTEND_DIR"
npm run build
echo "✅ Build completado"
echo ""

# Paso 3: Verificar contenido del build (opcional)
echo "🔍 Paso 3/5: Verificando contenido del build..."
MAIN_BUNDLE=$(find dist/assets -name "index-*.js" -type f | head -1)
if [[ -n "$MAIN_BUNDLE" ]]; then
  BUNDLE_SIZE=$(du -h "$MAIN_BUNDLE" | cut -f1)
  echo "   Bundle: $(basename "$MAIN_BUNDLE") ($BUNDLE_SIZE)"

  # Verificar presencia de funcionalidades clave
  AUDIO_COUNT=$(grep -o 'SpeechRecognition' "$MAIN_BUNDLE" 2>/dev/null | wc -l || echo "0")
  TERMINAL_COUNT=$(grep -o 'Terminal live' "$MAIN_BUNDLE" 2>/dev/null | wc -l || echo "0")

  echo "   Audio API: $AUDIO_COUNT refs"
  echo "   Terminal Live: $TERMINAL_COUNT refs"

  if [[ $AUDIO_COUNT -eq 0 ]] && [[ $TERMINAL_COUNT -eq 0 ]]; then
    echo ""
    echo "⚠️  ADVERTENCIA: No se detectaron algunas funcionalidades esperadas"
    read -p "¿Continuar de todos modos? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Abortado por el usuario"
      exit 1
    fi
  fi
fi
echo "✅ Build verificado"
echo ""

# Paso 4: Desplegar
echo "📦 Paso 4/5: Desplegando a .runtime/dev/public..."
cd "$REPO_ROOT"
"$REPO_ROOT/deploy/deploy-dev-frontend.sh"
echo ""

# Paso 5: Reiniciar servicio
echo "🔄 Paso 5/5: Reiniciando servicio..."
if command -v sudo &>/dev/null; then
  sudo systemctl restart codexwebdev.service
  sleep 2
  sudo systemctl status codexwebdev.service --no-pager -l | head -20
else
  echo "⚠️  No se pudo reiniciar automáticamente (requiere sudo)"
  echo "Ejecuta manualmente: sudo systemctl restart codexwebdev.service"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Despliegue completado"
echo ""
echo "🌐 Prueba en: https://codexwebdev.gamemodai.pro"
echo ""
