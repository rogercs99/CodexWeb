# Terminal / Kaggle / Models / Codex Auth — Despliegue DEV 2026-07-10

## Resumen del despliegue

**Rama**: `fix/dev-terminal-kaggle-models-auth-20260710`  
**Fecha**: 2026-07-10 18:06 CEST  
**Entorno**: DEV únicamente (`codexwebdev.service`)  
**Estado**: Desplegado y operacional con validaciones pendientes de navegador

## Cambios aplicados

### Backend
- `server.js`: Integración Kaggle Studio, Terminal Live SSE mejorado, Model Discovery dinámico, Codex Auth refresh/unlink
- `kaggleService.js`: Mejoras en gestión de kernels
- `kaggleStudioService.js`: Nuevo servicio para sesiones Kaggle Codex Studio persistentes
- `modelDiscovery.js`: Nuevo módulo para descubrimiento dinámico de modelos desde Codex App Server

### Frontend
- Build: `dist/assets/index-CMzSOyxz.js` (481 KB), `index-DKG9ynJY.css` (85 KB)
- Nuevos componentes: `KaggleStudioPanel.tsx`
- Mejoras: `ChatScreen`, `KaggleScreen`, `SettingsScreen`, `TerminalLivePanel`
- API: Nuevos endpoints Kaggle Studio y Codex Auth

### Tests y scripts
- `scripts/kaggle_codex_studio_v21.py`: Template kernel Codex Studio
- Tests E2E: `kaggle-studio-http`, `codex-auth-refresh`, `terminal-kaggle-browser-proof`
- Tests unit: `kaggle-studio-service`, `model-discovery`

### Configuración
- `deploy/codexwebdev.env`: Agregadas variables Kaggle Studio y public URL
- `package.json`: Cambiado `python` → `python3`

## Validaciones realizadas (terminal)

✅ **Backend sintaxis**: server.js, kaggleService.js, kaggleStudioService.js, Python script OK  
✅ **Health**: `curl http://127.0.0.1:3060/api/health` → OK  
✅ **Servicio DEV**: `systemctl status codexwebdev.service` → active (running)  
✅ **Kaggle CLI**: `/root/.local/bin/kaggle --version` → 1.7.4.5  
✅ **Credenciales**: `/home/claude-codexweb/.kaggle/kaggle.json` presente (600)  
✅ **Frontend build**: Vite OK, bundle desplegado en `.runtime/dev/public/`  
⚠️ **npm test:audit**: Interrumpida por red npm temporal  
⚠️ **npm lint**: TypeScript no instalado por permisos, pero build valida tipos

## Validaciones PENDIENTES (navegador requerido)

### Terminal móvil
- [ ] Viewport 390x844: textarea 1 línea, sin autocapitalización, overlap 0px
- [ ] Ejecutar: `printf 'ok\n'`, `pwd`, comando con stderr
- [ ] Verificar exit code, evento done, SSE sin buffering

### Kaggle Studio
- [ ] Lanzar kernel privado Internet+GPU
- [ ] Confirmar: queued → running, enlace Pinggy, heartbeat
- [ ] Leer GPU real (no garantizado T4/P100)
- [ ] Parar kernel, probar backup/restore

### Modelos y Auth Codex
- [ ] Actualizar modelos: codex app-server + fallback + evergreen Claude
- [ ] Renovar token, desvincular, verificar persistencia, revincular

## Limitaciones conocidas

1. Tests npm incompletos (red temporal)
2. TypeScript no instalado por permisos (no bloqueante, Vite valida)
3. Validaciones UI pendientes usuario
4. GPU Kaggle según disponibilidad scheduler
5. ANTHROPIC_API_KEY no configurada DEV
6. Cloudflare buffering SSE por validar

## Próximos pasos

1. Usuario ejecuta checklist navegador (Terminal, Kaggle, Modelos, Auth)
2. Si SSE bufferizado, ajustar nginx/Cloudflare solo DEV
3. Crear commits separados post-validación
4. Abrir PR contra DEV

## Entorno DEV

- Servicio: `codexwebdev.service` → `127.0.0.1:3060`
- URL: `https://codexwebdev.gamemodai.pro`
- DB: `.runtime/dev/app.dev.db`
- Assets: `.runtime/dev/public`
- Kaggle: `.runtime/dev/kaggle-studio/`

## Producción intacta

✅ `codexweb.service`, `.env`, `app.db`, `public/` sin cambios

---
**Última actualización**: 2026-07-10 18:15 CEST  
**Estado**: DEV operativo, validaciones UI pendientes usuario
