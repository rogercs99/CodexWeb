# fix-prod-dev-boot-timeout-project-chats

## Fecha

- 2026-06-25

## Hallazgo raiz

- Prod y dev estaban sirviendo el mismo bundle equivocado en `public/` y `.runtime/dev/public/`: `assets/index-Be24ctB6.js`
- Ese JS no era de CodexWeb; contenia referencias a `__stremioBoot`, buscaba `#app` y no montaba la SPA de CodexWeb en `#root`
- El HTML si era de CodexWeb, por eso `/` devolvia `200` pero el frontend real no arrancaba

## Que rompia BOOT_TIMEOUT

- El monitor esperaba que React montara contenido util y marcara la app como lista
- Como el bundle servido no correspondia al source actual, nunca habia montaje valido en `#root`
- Ademas `stitch_frontend/src/main.tsx` no notificaba explicitamente al monitor cuando el frontend quedaba listo

## Cambios aplicados

- Rebuild limpio desde `stitch_frontend/src` -> `dist/assets/index-CCKC3Xma.js`
- Despliegue del build correcto a:
  - `/root/CodexWeb/public`
  - `/root/CodexWeb/.runtime/dev/public`
- Actualizacion del boot monitor a `20260625-boot-fix-1`
- `main.tsx` ahora reporta bootstrap start/fatal y `App.tsx` marca `markBooted()` al montar
- `Terminal Live` deja de abrirse siempre en chats y pasa a abrirse solo por boton explicito
- `ChatScreen` recupera acceso rapido al proyecto activo y navega al listado/chat del proyecto sin romper `Chats / Files / Tools / Settings`

## Servicios tocados

- Reiniciados:
  - `codexweb.service`
  - `codexwebdev.service`
- Verificado sin cambios:
  - `cloudflared-codexweb.service`
  - `/etc/cloudflared/config.yml`

## Validacion corta

- Local prod/dev: `200 OK` con `index-CCKC3Xma.js` y `index-CmLdUeI1.css`
- Remoto prod/dev por dominio: `200 OK` con el mismo HTML y assets
- `/boot-monitor.js` en ambos entornos devuelve `20260625-boot-fix-1`
- `/health` responde `{"ok":true,"service":"codexweb"}`
- `/api/me` responde `{"authenticated":false,"user":null}` sin destruir estado
- No se pudo correr Playwright porque el modulo `playwright` no esta instalado en este workspace
