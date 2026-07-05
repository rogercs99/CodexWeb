# AI_CONTEXT_COMPACT.md

## Actualizacion 2026-07-05

- **Auto-continuación robusta de agentes**
  - Claude Code y Codex CLI ahora auto-continúan hasta obtener respuesta final visible
  - Nuevo sistema de análisis de completitud: `analyzeAgentCompletionState()`
  - Contrato de respuesta final en prompts con marcadores `CODEXWEB_FINAL_RESPONSE_BEGIN/END`
  - Configuración: `CHAT_AUTO_CONTINUATIONS` default 6, cap 12; `CHAT_CONTINUATION_TAIL_CHARS` default 10000, cap 50000
  - Prompts de continuación incluyen: tail de output, reasoning, comandos ejecutados, stderr, notices
  - Marcadores internos se eliminan antes de mostrar/persistir con `stripFinalResponseSentinels()`
  - Tests: fake CLIs en `tests/fixtures/`, suite E2E en `tests/e2e/chat-agent-completion.mjs`
  - Documentación completa: `docs/CONTEXT_AGENT_COMPLETION.md`
  - Validado: sintaxis OK, tests fake CLI pasando, pendiente validación con agentes reales en DEV

## Actualizacion 2026-06-25E

- **Servicios reales**
  - Prod: `codexweb.service` -> `http://127.0.0.1:3050` -> `STATIC_ASSETS_DIR=/root/CodexWeb/public`
  - Dev: `codexwebdev.service` -> `http://127.0.0.1:3060` -> `STATIC_ASSETS_DIR=/root/CodexWeb/.runtime/dev/public`
  - Tunnel: `cloudflared-codexweb.service` -> `/etc/cloudflared/config.yml`
  - Script operativo/notificaciones: `/usr/local/bin/codex_ask.sh`
- **Build/start correctos**
  - Build frontend: `cd /root/CodexWeb/stitch_frontend && npm run build`
  - Deploy prod local: copiar `stitch_frontend/dist/.` a `public/` + extras `boot-monitor.js`, `diag.html`, `diag.js`, `legacy-bootstrap.js` desde `stitch_frontend/public/`
  - Deploy dev local: copiar `stitch_frontend/dist/.` a `.runtime/dev/public/` + mismos extras
  - Restart selectivo: `systemctl restart codexweb.service codexwebdev.service`
- **Estructura frontend/backend**
  - Backend: `/root/CodexWeb/server.js`
  - Frontend source: `/root/CodexWeb/stitch_frontend/src`
  - Frontend public source: `/root/CodexWeb/stitch_frontend/public`
  - Build output actual valido: `dist/assets/index-CCKC3Xma.js` + `dist/assets/index-CmLdUeI1.css`
- **BOOT_TIMEOUT**
  - Causa real encontrada el `2026-06-25`: `public/` y `.runtime/dev/public/` servian un bundle equivocado (`index-Be24ctB6.js`) ajeno a CodexWeb, con referencias a `__stremioBoot` y montaje en `#app`
  - Resultado: el HTML de CodexWeb exponia `#root`, pero el JS servido no montaba React ahi y el monitor entraba en `BOOT_TIMEOUT`
  - Fix real: rebuild desde `stitch_frontend/src`, desplegar bundle correcto y emitir `markBooted()` desde la app montada
  - Version monitor actual: `20260625-boot-fix-1`
- **Terminal Live**
  - Ya no debe montarse por defecto al entrar en chats
  - Apertura correcta: boton explicito desde `ChatScreen`
  - Cierre correcto: control visible en el propio panel, tambien en movil
- **Token Saver**
  - Debe permanecer cerrado por defecto
  - Persistencia valida: `localStorage` por usuario con schema `{ version: 1, open: boolean }`
  - Storage corrupto o legado invalido => fallback cerrado, sin bloquear bootstrap
- **Accesos rapidos a proyectos**
  - Desde la vista de chat debe existir acceso rapido al proyecto activo
  - La navegacion inferior sigue siendo `Chats / Files / Tools / Settings`; el acceso a proyectos no debe romperla
- **Validaciones prod/dev**
  - `curl -vkL --max-time 15 http://127.0.0.1:3050/`
  - `curl -vkL --max-time 15 http://127.0.0.1:3060/`
  - `curl -vkL --max-time 20 https://codexweb.gamemodai.pro/`
  - `curl -vkL --max-time 20 https://codexwebdev.gamemodai.pro/`
  - `curl http://127.0.0.1:3050/boot-monitor.js | grep 20260625-boot-fix-1`
  - `curl http://127.0.0.1:3060/boot-monitor.js | grep 20260625-boot-fix-1`
  - `curl http://127.0.0.1:3050/health` y `curl http://127.0.0.1:3060/health`
  - `curl http://127.0.0.1:3050/api/me` y `curl http://127.0.0.1:3060/api/me`

## Actualizacion 2026-06-25D

- **Puertos reales**:
  - Prod: `codexweb.service` -> `127.0.0.1:3050` -> `staticAssetsDir=/root/CodexWeb/public`
  - Dev: `codexwebdev.service` -> `127.0.0.1:3060` -> `staticAssetsDir=/root/CodexWeb/.runtime/dev/public`
  - Tunnel activo esperado: `cloudflared-codexweb.service`
- **Procesos/servicios detectados**:
  - `codexweb.service`, `codexwebdev.service`, `cloudflared-codexweb.service`, `nginx.service`
  - Ambos Node arrancan el mismo backend: `/usr/bin/node /root/CodexWeb/server.js`
- **Build/start**:
  - Frontend build: `cd /root/CodexWeb/stitch_frontend && npm run build`
  - Prod sirve `public/`
  - Dev sirve `.runtime/dev/public/`
  - Ambos se reinician con `systemctl restart codexweb.service codexwebdev.service`
- **Estructura relevante**:
  - Backend monolito: `/root/CodexWeb/server.js`
  - Frontend React/Vite: `/root/CodexWeb/stitch_frontend/src`
  - PWA/static source: `/root/CodexWeb/stitch_frontend/public`
  - Build output: `/root/CodexWeb/stitch_frontend/dist`
- **Validacion prod/dev**:
  - Local: `curl -fsS http://127.0.0.1:3050/api/version` y `curl -fsS http://127.0.0.1:3060/api/version`
  - Publico: `curl -vkL https://codexweb.gamemodai.pro/` y `curl -vkL https://codexwebdev.gamemodai.pro/`
  - Verificacion esperada actual: ambos devuelven el mismo `gitCommit=273b3f562747` y el mismo bundle `index-Be24ctB6.js`
- **Token Saver**:
  - Causa raiz del auto-open: `App.tsx` montaba `TokenSaverPanel` siempre al abrir chat y no pasaba `onClose`
  - Fix aplicado: panel cerrado por defecto, solo abre desde boton explicito o preferencia persistida valida
  - Persistencia UI: `localStorage` por usuario con schema minimo `{ version: 1, open: boolean }`
  - Preferencia corrupta o legacy invalida => fallback cerrado y limpieza segura
- **Cache/service worker**:
  - `sw.js` ahora sale del source del frontend (`stitch_frontend/public/sw.js`) y versiona cache con `codexweb-v2-20260625`
  - Objetivo: invalidar caches viejas sin tocar datos de usuario
- **Build info visible**:
  - `GET /api/version` expone `environment`, `gitCommit`, `staticAssetsDir` y entrypoints JS/CSS reales


## Actualizacion 2026-06-25C

- **Parseo Claude/Codex**: Ya está implementado y operativo tanto en backend como frontend. No se requiere agregar nada nuevo.
  - Backend (`server.js`): Claude Code parsea JSON estructurado con tipos `assistant`, `tool_use`, `tool_result`, `system`; Codex CLI parsea eventos estructurados `item_started`, `item_updated`, `item_completed`, `turn_completed`.
  - Backend emite SSE: `assistant_delta` (respuesta final), `reasoning_delta` (razonamiento), `command_started`, `command_output_delta`, `command_completed` (comandos ejecutados).
  - Frontend (`App.tsx`): `consumeSse` maneja todos estos eventos y separa comandos (panel Terminal live) del contenido principal (chat).
- **Audio a texto**: Implementado con Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`) en `ChatScreen.tsx`.
  - Funciona con todos los proveedores (Claude, Codex, etc.) porque transcribe a texto antes de enviarlo.
  - No existe backend `/api/transcribe` ni transcripción automática de archivos de audio subidos; es grabación de micrófono navegador → texto input.
  - Icono de micrófono visible en el compositor de chat; al pulsar inicia grabación, vuelve a pulsar para detener y el texto transcrito se añade al input.
- **Estado dev actualizado**: `codexwebdev` ahora sirve `index-SPWzApU-.js` con audio integrado.
- Validado en esta iteración:
  - Parseo estructurado verificado en `server.js` líneas 22729-23128 (Claude Code) y 24444-24532 (Codex CLI)
  - Frontend verificado en `App.tsx` líneas 2376-2547 (manejo SSE con separación de comandos/razonamiento/respuesta)
  - Audio verificado en `ChatScreen.tsx` líneas 31-68 (Web Speech API)
  - Compilación: `cd stitch_frontend && npm run build` OK → `dist/assets/index-SPWzApU-.js` (789.84 KB)
  - Despliegue: `bash deploy/deploy-dev-frontend.sh` OK
  - Servicio: `sudo systemctl restart codexwebdev.service` OK
  - Health: `curl http://127.0.0.1:3060/api/health` → `{"ok":true,"service":"codexweb"}`
  - Público: `curl -sI https://codexwebdev.gamemodai.pro/` → HTTP/2 200
  - Bundle contiene audio: `grep -c "SpeechRecognition" .runtime/dev/public/assets/index-SPWzApU-.js` → 1

## Actualizacion 2026-06-25B

- `codexwebdev` no estaba sirviendo un build viejo distinto al repo: el dominio y `127.0.0.1:3060` devolvían el mismo `index.html` y hash. El problema real era un frontend parcialmente revertido en `stitch_frontend/src/`.
- Se restauró en frontend la integración de `Settings` con `Claude Code auth`, `Steam Deck SSH` y navegación a `Quetzal Relay`, reutilizando componentes y endpoints ya presentes en el repo.
- Se añadió soporte de frontend para `Claude Code auth/send-code` (`needsCode` + input/botón para enviar código).
- Se reexpusieron en `stitch_frontend/src/lib/api.ts` los helpers faltantes de `Steam Deck`, `Quetzal Relay`, `Token Saver` y `Terminal Live`, y `TokenSaverPanel.tsx` volvió a pasar `tsc`.
- Validado en esta iteración:
  - `cd stitch_frontend && npm run lint` OK
  - `cd stitch_frontend && npm run build` OK
  - `bash deploy/deploy-dev-frontend.sh` OK
  - `curl https://codexwebdev.gamemodai.pro/` sirviendo `index-CWInftNj.js`

## Actualizacion 2026-06-25

- Verificado con CLI real: `codex exec --json` sí usa el flujo dedicado de `server.js` y emite eventos `thread.started`, `turn.started`, `item.started/completed` y `turn.completed`; el contexto largo viejo que decía que no existía rama dedicada de Codex quedó obsoleto.
- Endurecido el parser de `Claude Code` en `server.js`:
  - `result.is_error` ahora fuerza fallo aunque el proceso termine con exit code `0`.
  - El `result` final ya no pisa ciegamente el texto parcial; solo completa el delta faltante cuando corresponde.
  - Bloques `thinking` se deduplican por snapshot para evitar repeticiones en reasoning.
  - `tool_use` / `tool_result` de tipo shell se traducen a eventos `command_*` para que el frontend separe acciones de la respuesta final.
- Añadido dictado por voz en `stitch_frontend/src/components/ChatScreen.tsx` con `SpeechRecognition` / `webkitSpeechRecognition`; inserta la transcripción en el input y funciona igual con Claude, Codex o cualquier provider porque entra como texto normal.
- Alcance de voz actual: no existe backend `POST /api/transcribe` ni transcripción automática de archivos de audio subidos; es un MVP de micrófono del navegador.
- Validado en esta iteración:
  - `node -c server.js` OK
  - `cd stitch_frontend && npm run build` OK
  - `bash deploy/deploy-dev-frontend.sh` OK
  - `systemctl restart codexwebdev.service` OK
  - `curl http://127.0.0.1:3060/api/health` OK
- Riesgo abierto conocido: `cd stitch_frontend && npm run lint` sigue fallando por errores previos ajenos en `QuetzalRelayScreen.tsx`, `SteamDeckSettingsPanel.tsx`, `TerminalLivePanel.tsx` y `TokenSaverPanel.tsx`; no fue introducido por este cambio.

## Actualizacion 2026-06-24D

- En `codexwebdev`, el Hub ya no muestra notificaciones globales de jobs `project_context_refresh`; la regeneración de contexto sigue ejecutándose en backend, pero deja de sacar el banner de "Actualizando contexto de ...".
- Se añadió `gpt-5.5` al fallback estático de modelos del agente `codex-cli` en `server.js`.
- Verificado en dev: `stitch_frontend` compila, el build quedó copiado a `.runtime/dev/public/` y `codexwebdev.service` arrancó correctamente tras reinicio.

- Proyecto: `CodexWeb` en `/root/CodexWeb`. Backend Express + SQLite en `server.js`; frontend React/Vite en `stitch_frontend/`.
- Servicios: dev `codexwebdev.service` en `127.0.0.1:3060` con env `deploy/codexwebdev.env`; prod `codexweb.service` en `127.0.0.1:3050` con env `.env`. Regla habitual: trabajar en dev salvo instrucción explícita.
- Rutas/backend clave: `POST /api/chat`, `POST /api/tools/terminal-live/stream`, `GET /api/chat/options`, `GET/POST /api/claude-code/auth/*`, `GET /api/settings/ai-agents`, `PATCH /api/settings/ai-agents/active`, `POST /api/ai/providers/:providerId/permissions/grant-full`, `GET /api/health`.
- Lanzadores IA: Codex usa `CODEX_CMD`; Claude Code usa `CLAUDE_CODE_BIN`; Gemini usa `GEMINI_CMD`.
- Contexto de proyecto: antes de inyectar archivos grandes, el sistema busca `PROJECT_CONTEXT.md`, `CLAUDE.md`, `CONTEXT.md` o `README.md`.
- Validaciones rápidas:
  - `curl http://127.0.0.1:3060/api/health`
  - `systemctl status codexwebdev.service --no-pager`
  - `/usr/local/bin/claude-codexweb-max --version`
  - `runuser -u claude-codexweb -- bash -lc 'cd /root/CodexWeb && touch tmp/... && rm tmp/...'`

## Actualizacion 2026-06-24B

- Tools incorpora `Terminal Live` en `stitch_frontend/src/components/TerminalLivePanel.tsx`, con composer movil tipo chat, streaming SSE, stop/reintento, parser visual y export Markdown listo para ChatGPT.
- Utilidades de parseo/export en `stitch_frontend/src/lib/terminalLive.ts`: `parseCommandBlock`, `detectDockerPs`, `detectDfH`, `detectFreeH`, `detectSystemd`, `sanitizeSecrets`, `buildChatGPTDiagnosticExport`.
- El backend expone `POST /api/tools/terminal-live/stream` y ejecuta bloques `bash -lc` en `/root/CodexWeb` con timeout, heartbeat SSE y confirmacion obligatoria para comandos peligrosos.
- La vista `Tools > Terminal` ahora prioriza `Terminal Live` y deja debajo el historial IA por chat ya existente.
- Riesgo verificado pendiente: `npm run lint` del frontend sigue fallando por errores previos en `src/components/TokenSaverPanel.tsx` (`Cannot find namespace 'React'`), no introducidos por Terminal Live.

## Actualizacion 2026-06-24C

- Quedó verificado y corregido un bug real en la auth de `Claude Code` desde `Settings`: `sendClaudeCodeAuthCode()` en `stitch_frontend/src/lib/api.ts` enviaba `JSON.stringify({ code })` sin `Content-Type: application/json`.
- Consecuencia: en `POST /api/claude-code/auth/send-code`, `express.json()` no parseaba el body y el backend respondía `El campo code es obligatorio.` aunque el input tuviera valor.
- Fix aplicado y desplegado en dev: añadir `headers: { 'Content-Type': 'application/json' }` al helper frontend y copiar el build a `.runtime/dev/public/` sin reiniciar `codexwebdev.service`.

## Actualización 2026-06-24

- Se creó el usuario no-root `claude-codexweb` con home `/home/claude-codexweb` y shell `/bin/bash`.
- Se instalaron ACLs (`acl`, `setfacl`, `getfacl`) y se concedió a `claude-codexweb`:
  - `--x` sobre `/root` para atravesar la ruta.
  - `rwX` recursivo y ACL por defecto sobre `/root/CodexWeb`.
- Nuevo wrapper: `/usr/local/bin/claude-codexweb-max`.
  - Entra en `/root/CodexWeb`.
  - Ejecuta `claude` como `claude-codexweb` con `--permission-mode bypassPermissions`.
  - Mantiene `PATH` razonable y variables de pager limpias.
- `server.js` ahora prefiere el wrapper no-root cuando el servicio principal corre como `root` y el binario configurado es `claude` o `claude-fast`.
- Dev quedó explícito con `CLAUDE_CODE_BIN=/usr/local/bin/claude-codexweb-max`.
- Prod quedó preparado en `.env` con `CLAUDE_CODE_BIN=/usr/local/bin/claude-codexweb-max`, `CLAUDE_CODE_WRAPPER_BIN=/usr/local/bin/claude-codexweb-max` y `CLAUDE_CODE_RUN_AS_USER=claude-codexweb`.
- No había sesión activa de Claude en `root` (`claude auth status --json` devolvió `loggedIn=false`), así que no se migraron tokens para evitar copiar estado roto o inútil.
- Bloqueo operativo actual: este propio turno corre dentro del cgroup de `codexweb.service`, así que reiniciar producción desde aquí abortaría la sesión antes de poder verificarla; el reinicio pendiente debe hacerse en una ventana aparte.
