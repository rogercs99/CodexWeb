# Fix prod/dev Token Saver

Fecha: `2026-06-25`

## Causa raiz

- Prod y dev no estaban cruzados: ambos servicios apuntaban bien y ambos servian el mismo frontend actual.
- El problema visible de Token Saver era de frontend:
  - `TokenSaverPanel` se montaba siempre en `App.tsx` al entrar a cualquier chat.
  - `App.tsx` no le pasaba `onClose`, asi que el panel quedaba abierto por diseno y con cierre roto.
- Habia ademas inconsistencia de assets PWA:
  - `public/` tenia `sw.js`, `manifest.json`, `icon.svg`
  - `.runtime/dev/public/` no siempre los tenia porque no salian del source del frontend
  - el service worker usaba cache fija `codexweb-v1`, mala base para invalidar clientes viejos

## Cambios aplicados

- `stitch_frontend/src/App.tsx`
  - estado UI para Token Saver persistido por usuario
  - schema minimo validado
  - fallback cerrado si storage corrupto
  - render condicional del panel
  - `onClose` conectado correctamente
- `stitch_frontend/src/components/ChatScreen.tsx`
  - boton explicito `Zap` para abrir Token Saver desde el chat
- `stitch_frontend/public/sw.js`
  - cache versionada `codexweb-v2-20260625`
- `stitch_frontend/public/manifest.json`
- `stitch_frontend/public/icon.svg`
- `server.js`
  - `GET /api/version` ahora incluye `gitCommit`

## Build y despliegue

- Build ejecutado:
  - `cd /root/CodexWeb/stitch_frontend && npm run build`
- Prod actualizado copiando `stitch_frontend/dist/` a `/root/CodexWeb/public`
- Dev actualizado copiando `stitch_frontend/dist/` a `/root/CodexWeb/.runtime/dev/public`
- Backups previos:
  - `/root/CodexWeb/backups/public-pre-fix-20260625-114002`
  - `/root/CodexWeb/backups/dev-public-pre-fix-20260625-114002`

## Reinicios

- `systemctl restart codexweb.service`
- `systemctl restart codexwebdev.service`

## Validacion

- `node -c server.js` OK
- `cd stitch_frontend && npm run lint` OK
- `cd stitch_frontend && npm run build` OK
- `curl http://127.0.0.1:3050/api/version` OK
- `curl http://127.0.0.1:3060/api/version` OK
- `curl https://codexweb.gamemodai.pro/` OK
- `curl https://codexwebdev.gamemodai.pro/` OK
- Ambos entornos publican:
  - `gitCommit=273b3f562747`
  - `entrypoint.js=/assets/index-Be24ctB6.js`
  - `entrypoint.css=/assets/index-DuhV9fUP.css`
- `sw.js` responde en prod y dev con `Cache-Control: no-store, max-age=0`

## Limites de validacion

- No se hizo automatizacion real de navegador autenticado contra chats de usuario.
- La comprobacion de "ya no se abre solo" queda validada por codigo compilado y wiring de UI:
  - panel no se monta si `isTokenSaverOpen === false`
  - el valor por defecto y fallback por storage corrupto es `false`
