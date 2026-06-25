# CONTEXT_TERMINAL_CHAT.md

## Objetivo

`Terminal Live` da una vista movil tipo chat para ejecutar comandos reales del servidor sin depender del flujo del chat IA normal.

## Rutas y ficheros

- Backend SSE: `server.js`
  - `POST /api/tools/terminal-live/stream`
- Frontend:
  - `stitch_frontend/src/components/TerminalLivePanel.tsx`
  - `stitch_frontend/src/components/TerminalLogScreen.tsx`
  - `stitch_frontend/src/lib/api.ts`
  - `stitch_frontend/src/lib/terminalLive.ts`

## Flujo

1. El usuario pega un comando o bloque multilinea.
2. Frontend llama `startTerminalLiveStream(...)`.
3. Backend ejecuta `bash -lc` en `/root/CodexWeb`.
4. El stream SSE emite `session`, `state`, `stdout`, `stderr`, `done`.
5. Frontend construye burbujas tipo chat y parsea salida estructurada.

## Parsing soportado

- `docker ps`
- `df -h`
- `free -h`
- `systemctl status ...`
- `journalctl ...` o salida log-like
- Bloques con separadores `== nombre ==`
- URLs detectadas y copiables
- JSON simple pretty-printed

## UX y estados

- Acceso actual: `Terminal Live` se abre desde la pestana `Terminal` de la barra inferior; no hay boton ni panel embebido dentro de `ChatScreen`.
- Estados expuestos: `idle`, `typing`, `blocked`, `waiting_confirmation`, `executing`, `streaming`, `success`, `error`, `canceled`, `timeout`, `exporting`, `copied`.
- Composer movil con `Enter` para ejecutar y `Shift+Enter` para nueva linea.
- Quick commands para validacion.
- Acciones por respuesta: copiar salida, reintentar, ver raw, exportar diagnostico Markdown.
- Historial IA por chat anterior sigue debajo, separado del nuevo flujo directo de terminal.

## Seguridad

- Timeout por defecto: 3 minutos.
- Heartbeat SSE para Safari/proxies.
- Confirmacion obligatoria si detecta patrones peligrosos:
  - `rm -rf /...`
  - particiones/discos (`fdisk`, `mkfs`, `dd`, etc.)
  - SSH/firewall critico
  - reinicio/apagado del servidor
  - `systemctl stop|disable|mask` sobre servicios criticos
- El export Markdown mascara secretos comunes con `sanitizeSecrets(...)`.

## Verificacion hecha

- `node --check server.js`
- `cd stitch_frontend && npm run build`
- `cd stitch_frontend && npm run lint`
  - sigue fallando por errores previos de `TokenSaverPanel.tsx`

## Siguientes pasos recomendados

- Probar manualmente en dev autenticado:
  - `echo ok`
  - `pwd`
  - `df -h`
  - `free -h`
  - `docker ps`
  - `systemctl status codexweb --no-pager || true`
  - `journalctl -u codexweb -n 50 --no-pager || true`
- Si se quiere persistencia cross-device, mover sesiones de `localStorage` a backend/SQLite.
- Si se quiere mejor parser, anadir `ps aux`, `ss -lntp`, `uptime`, `top -b -n1`, `docker compose ps`.
