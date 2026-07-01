# CONTEXT_CODEXWEB_AUTH_RUNTIME

Fecha de inspeccion: 2026-07-02

## Repos reales
- PRO: `/root/CodexWeb`
- DEV/previews: `/root/CodexWeb`
- Ambos entornos ejecutan el mismo `server.js` y el mismo frontend, aislados por `EnvironmentFile`, puertos, assets y DB.

## Servicios reales
- PRO: `codexweb.service`
  - `WorkingDirectory=/root/CodexWeb`
  - `EnvironmentFile=/root/CodexWeb/.env`
  - `ExecStart=/usr/bin/node /root/CodexWeb/server.js`
- DEV/previews: `codexwebdev.service`
  - `WorkingDirectory=/root/CodexWeb`
  - `EnvironmentFile=/root/CodexWeb/deploy/codexwebdev.env`
  - `ExecStart=/usr/bin/node /root/CodexWeb/server.js`
- Reverse proxy: `nginx.service`

## Puertos reales
- PRO app: `127.0.0.1:3050`
- DEV app: `127.0.0.1:3060`
- Nginx publica `80/443`

## DBs reales
- PRO: `/root/CodexWeb/app.db`
  - origen: `.env` no define `DB_PATH`, `server.js` cae al default `app.db`
- DEV/previews: `/root/CodexWeb/.runtime/dev/app.dev.db`
  - origen: `deploy/codexwebdev.env` define `DB_PATH=.runtime/dev/app.dev.db`

## Otras rutas de estado relevantes
- PRO uploads: `/root/CodexWeb/uploads`
- DEV uploads: `/root/CodexWeb/.runtime/dev/uploads`
- PRO codex home por usuario: `/var/lib/codexweb/codex_users`
- DEV codex home por usuario: `/root/CodexWeb/.runtime/dev/codex_users`
- PRO restart state: `/root/CodexWeb/restart-state.json`
- DEV restart state: `/root/CodexWeb/.runtime/dev/restart-state.dev.json`

## Tablas auth/chat relevantes
- `users`
  - columnas base: `id`, `username`, `password_hash`, `active_ai_agent_id`, `created_at`
- `conversations`
  - cuelga de `users.id` por `user_id`
- `messages`
  - cuelga de `conversations.id` por `conversation_id`
- `chat_projects`
  - cuelga de `users.id`
- `chat_live_drafts`
  - cuelga de `users.id` y opcionalmente `conversation_id`
- `express-session`
  - store en memoria del proceso; no hay tabla `sessions`
  - tras restart se invalida la sesion, pero el login sigue funcionando si `users.password_hash` es valido

## Flujo real login -> session -> conversaciones
1. `POST /api/login`
2. `server.js` normaliza username a lowercase
3. consulta `users` por `LOWER(username) = ?`
4. valida `bcrypt.compareSync(password, password_hash)`
5. guarda `req.session.userId` y `req.session.username`
6. `GET /api/conversations` usa `req.session.userId`
7. `GET /api/conversations/:id/messages` valida ownership con ese `user_id`

## Diferencias DEV/previews vs PRO
- mismo repo y codigo
- distinto `EnvironmentFile`
- distinto puerto
- distinta DB
- distintos assets/static dir
- distinto `CODEX_HOME_ROOT`
- distinto arbol de uploads/tmp

## Comandos de verificacion utiles
- `systemctl status codexweb codexwebdev --no-pager`
- `curl -s http://127.0.0.1:3050/health`
- `curl -s http://127.0.0.1:3060/health`
- `sqlite3 /root/CodexWeb/app.db '.tables'`
- `sqlite3 /root/CodexWeb/.runtime/dev/app.dev.db '.tables'`
- login real PRO:
  - `curl -i -c /tmp/pro.cookies -H 'Content-Type: application/json' -d '{"username":"Roger","password":"hola123"}' http://127.0.0.1:3050/api/login`
- login real DEV:
  - `curl -i -c /tmp/dev.cookies -H 'Content-Type: application/json' -d '{"username":"Roger","password":"hola123"}' http://127.0.0.1:3060/api/login`
- listar conversaciones tras login:
  - `curl -s -b /tmp/pro.cookies http://127.0.0.1:3050/api/conversations`
  - `curl -s -b /tmp/dev.cookies http://127.0.0.1:3060/api/conversations`

## Puntos del codigo a reutilizar
- DB path: `server.js:1057-1063`
- schema/migrations auth-chat: `server.js:11113+`
- session middleware: `server.js:13425+`
- login: `server.js:14003+`
- listado de conversaciones: `server.js:18163+`
