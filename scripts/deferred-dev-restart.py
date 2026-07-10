#!/usr/bin/env python3
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = Path(os.environ.get('CODEXWEB_DEV_ENV_FILE', REPO_ROOT / 'deploy' / 'codexwebdev.env'))


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


load_env_file(ENV_FILE)
db_value = os.environ.get('DB_PATH', '.runtime/dev/app.dev.db')
DB_PATH = Path(db_value) if Path(db_value).is_absolute() else REPO_ROOT / db_value
SERVICE = os.environ.get('CODEXWEB_DEV_SERVICE', 'codexwebdev.service')
POLL_SECONDS = max(0.25, float(os.environ.get('DEFERRED_RESTART_POLL_MS', '1500')) / 1000)
GRACE_SECONDS = max(0.0, float(os.environ.get('DEFERRED_RESTART_GRACE_MS', '2500')) / 1000)
MAX_WAIT_SECONDS = max(5.0, float(os.environ.get('DEFERRED_RESTART_MAX_WAIT_MS', str(30 * 60 * 1000))) / 1000)
DRY_RUN = os.environ.get('DEFERRED_RESTART_DRY_RUN') == '1'


def running_count() -> int:
    if not DB_PATH.exists():
        return 0
    connection = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True, timeout=5)
    try:
        row = connection.execute("SELECT COUNT(*) FROM task_runs WHERE status = 'running'").fetchone()
        return int(row[0] if row else 0)
    finally:
        connection.close()


def main() -> int:
    started = time.monotonic()
    idle_since = None
    while time.monotonic() - started < MAX_WAIT_SECONDS:
        try:
            count = running_count()
        except Exception as exc:
            print(f'[deferred-restart] DB read failed: {exc}', file=sys.stderr, flush=True)
            idle_since = None
            time.sleep(POLL_SECONDS)
            continue

        now = time.monotonic()
        if count == 0:
            idle_since = idle_since or now
            if now - idle_since >= GRACE_SECONDS:
                break
        else:
            idle_since = None
            print(f'[deferred-restart] waiting for {count} active task(s)', flush=True)
        time.sleep(POLL_SECONDS)
    else:
        print('[deferred-restart] maximum wait reached; refusing to interrupt active chats', file=sys.stderr)
        return 2

    if DRY_RUN:
        print(f'[deferred-restart] dry-run: would restart {SERVICE}')
        return 0
    return subprocess.run(['systemctl', 'restart', SERVICE], check=False).returncode


if __name__ == '__main__':
    raise SystemExit(main())
