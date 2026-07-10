#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/root/CodexWeb}"
LOG_DIR="${REPO_ROOT}/.runtime/dev/logs"
LOG_FILE="${LOG_DIR}/deferred-restart.log"
mkdir -p "$LOG_DIR"

if command -v systemd-run >/dev/null 2>&1; then
  UNIT="codexwebdev-deferred-restart-$(date +%s)"
  systemd-run --unit="$UNIT" --collect \
    --property=WorkingDirectory="$REPO_ROOT" \
    /usr/bin/python3 "$REPO_ROOT/scripts/deferred-dev-restart.py" >/dev/null
  echo "Reinicio DEV encolado de forma segura ($UNIT). Se ejecutará al terminar los chats activos."
else
  nohup /usr/bin/python3 "$REPO_ROOT/scripts/deferred-dev-restart.py" >>"$LOG_FILE" 2>&1 </dev/null &
  echo "Reinicio DEV encolado de forma segura (PID $!). Se ejecutará al terminar los chats activos."
fi
