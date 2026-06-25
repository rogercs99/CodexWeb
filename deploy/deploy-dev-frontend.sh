#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/root/CodexWeb"
FRONTEND_DIR="$REPO_ROOT/stitch_frontend"
DIST_DIR="$FRONTEND_DIR/dist"
TARGET_DIR="${1:-$REPO_ROOT/.runtime/dev/public}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${TARGET_DIR}.bak.${TIMESTAMP}"

if [[ ! -d "$DIST_DIR" ]]; then
  echo "Build no encontrado en $DIST_DIR" >&2
  exit 1
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

echo "Frontend DEV desplegado en $TARGET_DIR"
if [[ -d "$BACKUP_DIR" ]]; then
  echo "Backup: $BACKUP_DIR"
fi
