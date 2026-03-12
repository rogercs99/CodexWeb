# Despliegue aislado de `codexwebdev.gamemodai.pro` (sin tocar `codexweb.gamemodai.pro`)

## Objetivo

Levantar la versión nueva en un entorno `dev` separado manteniendo producción intacta.

## Cambios de backend aplicados

`server.js` ahora permite aislar rutas por entorno con variables:

- `DB_PATH`
- `UPLOADS_DIR`
- `TASK_SNAPSHOTS_DIR`
- `STORAGE_JOBS_DIR`
- `RESTART_STATE_PATH`
- `STATIC_ASSETS_DIR`
- `CODEX_HOME_ROOT` (ya existente)

Además, los endpoints cloud públicos quedaron expuestos como `drive` (rclone):

- `/api/tools/storage/drive/accounts`
- `/api/tools/storage/drive/files`
- `/api/tools/storage/drive/upload`
- validación/delete para cuentas Google Drive (rclone)
- limpieza IA: `/api/tools/storage/cleanup/analyze` y `/api/tools/storage/cleanup/delete`

## Archivos de despliegue añadidos

- `deploy/codexwebdev.env.example`
- `deploy/systemd/codexwebdev.service`
- `deploy/nginx/codexwebdev.gamemodai.pro.conf`

## Pasos de despliegue (servidor)

1. Crear env real de dev:
   - `cp /root/CodexWeb/deploy/codexwebdev.env.example /root/CodexWeb/deploy/codexwebdev.env`
   - editar secretos (`SESSION_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`).
2. Instalar unidad systemd de dev:
   - copiar `deploy/systemd/codexwebdev.service` a `/etc/systemd/system/`.
   - `systemctl daemon-reload`
   - `systemctl enable --now codexwebdev.service`
3. Instalar sitio Nginx de dev:
   - copiar `deploy/nginx/codexwebdev.gamemodai.pro.conf` a `/etc/nginx/sites-available/`.
   - enlazar en `sites-enabled/`.
   - `nginx -t && systemctl reload nginx`
4. Verificar:
   - `curl -I https://codexwebdev.gamemodai.pro/health`
   - comprobar que producción (`codexweb.gamemodai.pro`) no fue recargada ni modificada.

## Garantía de no impacto a producción

El aislamiento se basa en:

- proceso distinto (`codexwebdev.service`);
- puerto distinto (`3060`);
- dominio distinto (`codexwebdev.gamemodai.pro`);
- datos/estado separados (`.runtime/dev/*` y `CODEX_HOME_ROOT` separado);
- configuración Nginx separada.
