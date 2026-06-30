# CodexWebDev runtime compacto

- Arquitectura runtime: `stitch_frontend` compila a assets estáticos servidos por `server.js` (Express + SQLite + SSE chat stream + CLIs locales).
- Repo real: `/root/CodexWeb`
- Servicio systemd real DEV: `codexwebdev.service`
- Puerto real DEV: `127.0.0.1:3060`
- Flujo Codex: UI selector agente -> `stitch_frontend/src/lib/api.ts` -> backend `server.js` (`/api/ai/agent`, `/api/chat/options`, `/api/chat/stream`) -> resolución `resolveCodexPath()` + spawn/exec de `codex`.
- Endpoints/config agentes: `/api/ai/agent-settings`, `/api/ai/agent-settings/active`, `/api/chat/options`, `/api/chat/stream`, `/health`
- Env vars relevantes DEV: `HOST`, `PORT`, `DB_PATH`, `STATIC_ASSETS_DIR`, `CODEX_CMD`, `CODEX_HOME_ROOT`, `CODEX_AUTH_TEMPLATE_DIR`, `HOME`, `PATH`, `CLAUDE_CODE_*`
- Systemd DEV: `User=root`, `WorkingDirectory=/root/CodexWeb`, `EnvironmentFile=/root/CodexWeb/deploy/codexwebdev.env`, `ExecStart=/usr/bin/node /root/CodexWeb/server.js`
- Codex runtime esperado: bin `codex` desde `CODEX_CMD`, auth template `/root/.codex`, homes por usuario bajo `/root/CodexWeb/.runtime/dev/codex_users`
- Verificación rápida:
  - `systemctl cat codexwebdev.service`
  - `journalctl -u codexwebdev.service -n 200 --no-pager`
  - `curl -i http://127.0.0.1:3060/health`
  - `cd /root/CodexWeb/stitch_frontend && npm run lint && npm run build`
