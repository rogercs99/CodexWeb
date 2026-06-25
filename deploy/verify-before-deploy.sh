#!/usr/bin/env bash
# Verifica que el código esté limpio y commiteado antes de desplegar

set -euo pipefail

REPO_ROOT="/root/CodexWeb"
cd "$REPO_ROOT"

echo "🔍 Verificando estado del repositorio..."

# Verificar si hay cambios sin commitear
if [[ -n $(git status --short --untracked-files=no) ]]; then
  echo "❌ ERROR: Hay cambios sin commitear en archivos rastreados:"
  git status --short --untracked-files=no
  echo ""
  echo "Commitea los cambios primero con:"
  echo "  git add -A"
  echo "  git commit -m 'descripción'"
  exit 1
fi

# Verificar si hay cambios críticos sin stagear
CRITICAL_CHANGES=$(git status --short | grep -E '^(\?\?|M) (server\.js|stitch_frontend/src/)' || true)
if [[ -n "$CRITICAL_CHANGES" ]]; then
  echo "⚠️  ADVERTENCIA: Hay cambios críticos sin commitear:"
  echo "$CRITICAL_CHANGES"
  echo ""
  read -p "¿Continuar de todos modos? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "✅ Repositorio limpio, listo para build"
