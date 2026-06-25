# PROJECT_CONTEXT.md — CodexWeb

## Cómo usar este contexto en futuros prompts
Lee este fichero primero. No repitas análisis ya documentado salvo que haya cambiado. Actualiza PROJECT_CONTEXT.md si descubres información nueva relevante y no efímera.

---

## Proyecto
**CodexWeb** — Chat UI para agentes IA (Codex CLI, Claude Code, proveedores externos). Node.js + React (TypeScript). Backend monolítico en `server.js`. Frontend en `stitch_frontend/`.

## Entornos y puertos

| Entorno | Dominio | Puerto local | Servicio systemd |
|---------|---------|-------------|-----------------|
| **Producción** | codexweb.gamemodai.pro | 127.0.0.1:3050 | `codexweb.service` |
| **Dev** | codexwebdev.gamemodai.pro | 127.0.0.1:3060 | `codexwebdev.service` |
| Cloudflare Tunnel | — | — | `cloudflared-codexweb.service` |

**Regla**: No tocar producción salvo necesidad explícita y justificada.

## Stack técnico
- **Backend**: Node.js, Express, SQLite (`better-sqlite3`), session auth, `server.js` (~22k líneas)
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS (`stitch_frontend/`)
- **Agentes IA**: Codex CLI, Claude Code (`claude`), proveedores externos (OpenAI, etc.)
- **DB dev**: `.runtime/dev/app.dev.db`
- **Binario Claude Code**: wrapper no-root `/usr/local/bin/claude-codexweb-max`; si el servicio corre como `root`, `server.js` redirige automáticamente `claude`/`claude-fast` al wrapper cuando existe
- **Perfil rápido Claude dev**: `CLAUDE_CODE_DEFAULT_MODEL=claude-haiku-4-5` y `CLAUDE_CODE_DEFAULT_REASONING_EFFORT=low`; `server.js` ya reenvía `--model` y `--effort` reales a la CLI

## Estructura principal
```
/root/CodexWeb/
  server.js              # Backend monolítico
  tokenSaver.js          # Motor de ahorro de tokens (presets Off/Balanced/Aggressive)
  package.json
  app.db                 # DB producción
  stitch_frontend/       # Frontend React+Vite
    src/
      components/        # Pantallas: ChatScreen, SettingsScreen, TokenSaverPanel, etc.
      lib/api.ts         # Funciones fetch al backend
      lib/types.ts       # Interfaces TypeScript
    dist/                # Build compilado
  .runtime/dev/          # Datos runtime dev (DB, uploads, public compilado)
    public/              # Frontend compilado servido por dev
  deploy/
    codexwebdev.env      # Variables de entorno dev
    codexwebdev.env.example
    deploy-dev-frontend.sh  # Script: build → copiar a .runtime/dev/public
  docs/                  # Documentación interna
  backups/               # Backups manuales de ficheros
  DIXIT/                 # Proyectos/servicios auxiliares
```

## Servicios systemd relevantes
```
systemctl status codexwebdev.service    # Dev
systemctl restart codexwebdev.service   # Reiniciar dev
systemctl status codexweb.service       # Prod (no tocar)
```

## Flujo de deploy dev (frontend)

**⚠️ CRÍTICO**: Siempre commitear cambios ANTES de recompilar para evitar regresiones.

**Flujo seguro** (un comando):
```bash
/root/CodexWeb/deploy/full-deploy-dev.sh
```

**Flujo manual** (paso a paso):
1. Commitear cambios: `git add -A && git commit -m "..."`
2. Build: `cd /root/CodexWeb/stitch_frontend && npm run build`
3. Deploy: `/root/CodexWeb/deploy/deploy-dev-frontend.sh`
4. Restart: `sudo systemctl restart codexwebdev.service`
5. Verificar: https://codexwebdev.gamemodai.pro

**Documentación completa**: `docs/DEPLOY_WORKFLOW.md`

**Scripts disponibles**:
- `deploy/full-deploy-dev.sh` — Build + deploy + restart (todo en uno)
- `deploy/deploy-dev-frontend.sh` — Solo deploy (requiere build previo)
- `deploy/verify-before-deploy.sh` — Verifica git state antes de deploy

## Endpoints principales del backend
- `GET  /api/health` — healthcheck
- `POST /api/tools/terminal-live/stream` — shell SSE directo para `Tools > Terminal Live`
- `GET  /api/claude-code/auth/status` — estado autenticación Claude Code
- `POST /api/claude-code/auth/start` — iniciar `claude auth login`
- `POST /api/claude-code/auth/send-code` — enviar código/token al proceso de auth *(añadido 2026-06-19)*
- `POST /api/claude-code/auth/cancel` — cancelar proceso de auth
- `POST /api/claude-code/auth/logout` — cerrar sesión Claude Code
- `GET  /api/codex/auth/status` — estado auth Codex CLI
- `POST /api/codex/auth/device/start` — device auth Codex CLI
- `GET  /api/codex/quota` — cuota Codex
- `POST /api/token-saver/*` — configuración Token Saver

## Flujo autenticación Claude Code
1. UI llama `POST /api/claude-code/auth/start` → backend spawnea `claude auth login` (stdin: pipe)
2. Backend captura stdout/stderr, extrae URL de autenticación
3. Frontend muestra URL. Usuario la abre en su navegador y se autentica
4. Si el proceso pide código (flag `needsCode: true` en la respuesta): usuario pega código en UI
5. UI llama `POST /api/claude-code/auth/send-code { code }` → backend escribe código a stdin del proceso
6. Proceso termina → `completed: true` → UI muestra éxito

## Token Saver
- Motor: `tokenSaver.js` — presets: Off, Balanced, Aggressive
- Panel UI: `stitch_frontend/src/components/TokenSaverPanel.tsx`
- Configurable desde Settings

## Terminal Live
- Vista móvil en `stitch_frontend/src/components/TerminalLivePanel.tsx`, integrada en `Tools > Terminal`
- Parser/export en `stitch_frontend/src/lib/terminalLive.ts`
- Ejecuta bloques `bash -lc` en `/root/CodexWeb` con timeout, streaming SSE y confirmación para comandos peligrosos

## QuetzalRelay
- Módulo interno: `quetzalRelay.js` — gestiona túnel SSH reverso para acceso desde Steam Deck u otros clientes
- Configura `sshd_config` automáticamente, puerto 57321, host público `quetzal.gamemodai.pro`
- Config persistida en `data/quetzal-relay.json`

## Sistema de contexto MD automático
- El backend inyecta automáticamente `PROJECT_CONTEXT.md` / `CLAUDE.md` / `CONTEXT.md` / `README.md` al inicio de cada chat (caché 60s, máx 2200 chars)
- Colocar un `PROJECT_CONTEXT.md` en subdirectorios clave (ej. `stitch_frontend/`) activa contexto específico para esa área

## Zonas que NO deben tocarse
- Firewall/UFW/SSH/claves del servidor
- Cloudflare Tunnel config
- Producción (`codexweb.service`, puerto 3050, `app.db`) salvo necesidad justificada
- Variables con secretos en `deploy/codexwebdev.env` (no hardcodear ni loggear)

## Convenciones
- Hacer backup antes de modificar: `cp archivo archivo.bak.$(date +%Y%m%d-%H%M%S)`
- Guardar backups en `backups/` o junto al fichero
- No exponer secretos/tokens en logs ni respuestas JSON
- Mantener compatibilidad móvil/iPhone Safari

## Verificación de salud
```bash
curl http://127.0.0.1:3060/api/health   # Dev
curl http://127.0.0.1:3050/api/health   # Prod
systemctl is-active codexwebdev.service
```

## Incidencias históricas relevantes
- **2026-06-19**: Auth Claude Code tenía `stdin: 'ignore'` → proceso no podía recibir código. Fix: cambiar a `stdin: 'pipe'` + endpoint `/api/claude-code/auth/send-code` + UI con input de código.
- **2026-06-24**: La UI de `Settings` para `Claude Code` seguía fallando al enviar el código porque `stitch_frontend/src/lib/api.ts` hacía `POST /api/claude-code/auth/send-code` con `JSON.stringify({ code })` pero sin `Content-Type: application/json`; `express.json()` dejaba `req.body.code` vacío y el backend respondía `El campo code es obligatorio.`. Fix aplicado en frontend y desplegado en dev.
- **2026-06-23/24**: Claude Code en `root` podía quedar lento o colgado por estado corrupto del perfil `~/.claude`/`~/.claude.json` tras reinstalar o reauth. Mitigación actual: rotar el perfil a backup, recrear un perfil mínimo, ejecutar Claude como usuario dedicado `claude-codexweb` mediante `/usr/local/bin/claude-codexweb-max`, aplicar ACLs sobre `/root/CodexWeb` y mantener `.claudeignore` para excluir artefactos pesados del repo.
- **2026-06-23**: Para reducir latencia en dev, `server.js` pasó a reenviar `--model`/`--effort` a Claude Code y el perfil por defecto quedó orientado a velocidad (`claude-haiku-4-5` + `low`). Cambiar a Sonnet/Opus si priorizas calidad sobre tiempo de respuesta.
- **2026-05-12**: Build de public movido a `.runtime/dev/public/` con backup automático.

## Prompt compacto recomendado para futuros cambios
```
Lee /root/CodexWeb/PROJECT_CONTEXT.md. Trabaja solo en dev salvo indicación contraria.
Haz backup antes de modificar. Prueba con curl /api/health y logs. Actualiza PROJECT_CONTEXT.md
si descubres contexto nuevo. Tarea: <describir tarea>.
```
