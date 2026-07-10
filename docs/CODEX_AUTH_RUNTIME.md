# CODEX_AUTH_RUNTIME

## Causa raíz
- `server.js` usa un `CODEX_HOME` aislado por usuario bajo `CODEX_HOME_ROOT`.
- El `auth.json` de cada usuario se copiaba desde `CODEX_AUTH_TEMPLATE_DIR` solo si no existía.
- Cuando `/root/.codex/auth.json` se renovó, PROD siguió usando una copia antigua en `/var/lib/codexweb/codex_users/user_1/auth.json`, ya revocada.

## Rutas efectivas
- Root global: `/root/.codex/auth.json`
- PROD user 1: `/var/lib/codexweb/codex_users/user_1/auth.json`
- DEV user 1: `/root/CodexWeb/.runtime/dev/codex_users/user_1/auth.json`

## PROD vs DEV
- PROD:
  - `codexweb.service`
  - `CODEX_HOME_ROOT=/var/lib/codexweb/codex_users`
  - `EnvironmentFile=/root/CodexWeb/.env`
- DEV:
  - `codexwebdev.service`
  - `CODEX_HOME_ROOT=/root/CodexWeb/.runtime/dev/codex_users`
  - `CODEX_AUTH_TEMPLATE_DIR=/root/.codex`
  - `EnvironmentFile=/root/CodexWeb/deploy/codexwebdev.env`

## Variables relevantes
- `HOME`
- `CODEX_HOME`
- `CODEX_HOME_ROOT`
- `CODEX_AUTH_TEMPLATE_DIR`
- `XDG_CACHE_HOME`
- `TMPDIR`
- `CODEX_CMD`

## Flujo seguro de renovación
1. Renovar login global con `codex login`.
2. Verificar root con `HOME=/root CODEX_HOME=/root/.codex codex login status`.
3. El backend sincroniza `auth.json` al home por usuario solo si la plantilla es mas nueva.
4. La copia al home por usuario se hace de forma atomica, con directorio `700` y `auth.json` `600`.
5. Si el runtime aun detecta revocacion, la UI debe reautenticar desde `Settings > Codex CLI`.

## Pruebas rápidas
- Root:
  - `HOME=/root CODEX_HOME=/root/.codex codex exec 'Responde únicamente: ROOT_CODEX_OK'`
- PROD:
  - `HOME=/var/lib/codexweb/codex_users/user_1 CODEX_HOME=/var/lib/codexweb/codex_users/user_1 codex exec 'Responde únicamente: PROD_CODEX_OK'`
- DEV:
  - `HOME=/root/CodexWeb/.runtime/dev/codex_users/user_1 CODEX_HOME=/root/CodexWeb/.runtime/dev/codex_users/user_1 codex exec 'Responde únicamente: DEV_CODEX_OK'`

## Prevención
- No reutilizar `auth.json` sembrados hace tiempo si la plantilla es mas nueva.
- No sobrescribir credenciales mas nuevas del usuario con una plantilla mas vieja.
- Revisar `journalctl -u codexweb.service -u codexwebdev.service` y buscar `[CodexAuthSync]` y `[CodexRuntime]`.
- En futuras intervenciones, referenciar este archivo en lugar de reconstruir el contexto.
