# CodexWeb local context for ChatGPT

## Purpose
Compact runbook for future local analysis and verification. Read this file first; do not rescan the whole repository unless the target changed.

## Layout
- Backend: `server.js` (Express + SQLite + SSE + provider CLI orchestration).
- Frontend source: `stitch_frontend/src` (React/Vite/Tailwind).
- Frontend build: `stitch_frontend/dist`.
- DEV deployment: `deploy/full-deploy-dev.sh` -> build -> `.runtime/dev/public` -> deferred restart.
- DEV environment: `deploy/codexwebdev.env`; default DB: `.runtime/dev/app.dev.db`.
- Systemd unit: `deploy/systemd/codexwebdev.service`.

## Local setup
Frontend-only verification does not need backend dependencies:
```bash
cd stitch_frontend
npm ci
npm run lint
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```
Open `http://127.0.0.1:4173` or verify with curl.

Full backend:
```bash
cd /path/to/CodexWeb
npm ci
cp .env.example .env
# Set DB_PATH to an isolated local file and provider binaries/credentials as required.
PORT=3051 DB_PATH=.runtime/local/app.local.db node server.js
```
Do not reuse production databases, OAuth homes, webhooks, or ports. `better-sqlite3` may require a compatible Node ABI/build toolchain or network access for its prebuilt binary.

## Tests used for this patch
```bash
node --check server.js
python3 -m py_compile scripts/deferred-dev-restart.py
bash -n deploy/request-dev-restart.sh deploy/full-deploy-dev.sh
cd stitch_frontend && npm run lint && npm run build
```
Preview smoke:
```bash
cd stitch_frontend
npm run preview -- --host 127.0.0.1 --port 4173
curl -f http://127.0.0.1:4173/
```
Deferred-restart integration: create a temporary SQLite `task_runs` table, insert one `running` row, start `scripts/deferred-dev-restart.py` with `DEFERRED_RESTART_DRY_RUN=1`, assert it waits, mark the row completed, and assert it proceeds.

## Patch behavior
- Terminal autoscroll waits two animation frames, reruns after composer resize, reacts to iOS `visualViewport` changes, and scrolls the document to its real maximum bottom so the content padding reserved for the fixed composer is honored. Do not use `endRef.scrollIntoView()` here because it aligns the sentinel under the fixed composer.
- Terminal and chat composers use at least 16 px (`text-base`) to prevent Safari focus zoom.
- Claude automatic continuation remains active after an SSE/browser disconnect and accepts `client_closed` as resumable.
- DEV deployment no longer restarts systemd inline. `deploy/request-dev-restart.sh` launches a detached helper that waits until no `task_runs.status='running'` remain, then restarts DEV. This protects the chat performing its own deployment.

## Important limitation
The deferred restart protects deployments performed through `deploy/full-deploy-dev.sh`. A direct `systemctl restart codexwebdev.service` still kills the web process and its attached provider children. Agents must use the deployment script or `deploy/request-dev-restart.sh`, never direct systemctl restart during an active chat.
