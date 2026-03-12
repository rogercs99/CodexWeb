# Google Drive con rclone en CodexWebDEV

Fecha: 2026-03-11

Esta guía deja CodexWebDEV (`codexwebdev.gamemodai.pro`) operando Google Drive usando rclone como capa única de almacenamiento remoto.

## 1) Flujo real que usa el sistema

1. rclone gestiona OAuth 2.0 con Google Drive.
2. El backend de CodexWeb no guarda `client_secret` ni tokens de Google directamente en endpoints de la app.
3. CodexWeb solo guarda la referencia al remote (`remoteName`), `configPath` opcional y `rootPath`.
4. rclone guarda/renueva tokens en `rclone.conf` (incluido refresh token cuando aplica).
5. Las operaciones de archivos/backups/restauración se ejecutan con comandos rclone controlados desde backend.

## 2) Crear app OAuth en Google Cloud (recomendado)

Si usas credenciales propias (recomendado para cuota y control):

1. Google Cloud Console: https://console.cloud.google.com/
2. Crea o selecciona proyecto.
3. Activa Google Drive API.
4. Configura pantalla OAuth consent.
5. Crea credenciales OAuth Client ID (Desktop app para flujo local de rclone, o Web si lo necesitas).
6. Guarda `client_id` y `client_secret`.

Referencia oficial de scopes:
- https://developers.google.com/drive/api/guides/api-specific-auth

Scope recomendado para CodexWeb (listado/subida/borrado/backup/restore):
- `drive`

## 3) Configurar rclone remote en el servidor DEV

Variables usadas por CodexWebDEV:

- `RCLONE_BIN=rclone`
- `RCLONE_CONFIG_PATH=/root/.config/rclone/rclone.conf`
- `RCLONE_DRIVE_DEFAULT_REMOTE=codexwebdev-gdrive`
- `RCLONE_DRIVE_DEFAULT_ROOT=CodexWebDEV`

Pasos:

```bash
mkdir -p /root/.config/rclone
rclone config
```

Dentro de `rclone config`:
1. `n` (new remote)
2. Nombre: `codexwebdev-gdrive` (o el que vayas a usar en CodexWeb)
3. Tipo: `drive`
4. `client_id` / `client_secret` (recomendado usar los tuyos; vacío para default de rclone)
5. Scope: `drive`
6. Completa OAuth y guarda.

Validación mínima del remote:

```bash
rclone listremotes
rclone about codexwebdev-gdrive:
rclone lsjson codexwebdev-gdrive: --max-depth 1
```

Documentación oficial:
- https://rclone.org/drive/
- https://rclone.org/commands/rclone_config/

## 4) Alta de cuenta en CodexWebDEV

En `Tools > Storage > Google Drive`:

1. `Alias`: nombre visible de la cuenta.
2. `remoteName`: nombre exacto del remote en rclone (ej: `codexwebdev-gdrive`).
3. `configPath` (opcional): ruta a `rclone.conf` si no usas la ruta por defecto.
4. `Ruta raíz` (opcional): carpeta base remota (ej: `CodexWebDEV`).
5. `Guardar cuenta`.
6. `Validar`.

Si la validación es correcta, la cuenta queda en estado `active`.

## 5) Operaciones disponibles en la app

Desde `Tools > Storage`:

- Vista `Google Drive`:
  - listar remoto
  - subir archivos locales
  - descargar archivos remotos
  - borrar archivos remotos (con confirmación)
- Vista `Backups`:
  - crear backup por app
  - listar backups por app
  - restaurar backup (job backend real)
  - retención automática de 4 días
- Vista `Limpieza IA`:
  - analiza candidatos residuales en raíces permitidas
  - borrado controlado por selección + confirmación fuerte

## 6) Errores comunes y solución

1. `remote "...\" no existe`:
   - el `remoteName` no coincide con `rclone listremotes`.
2. `configPath inválido`:
   - revisa ruta y permisos del archivo `rclone.conf`.
3. `unauthorized_client` / `invalid_grant`:
   - OAuth inválido o revocado; reautoriza en `rclone config reconnect`.
4. `insufficient scopes`:
   - recrea/reconecta el remote con scope `drive`.
5. `failed to refresh token`:
   - token de refresh no válido; reconectar remote.

## 7) Seguridad

1. No expongas `rclone.conf` al frontend.
2. Permisos recomendados:

```bash
chmod 700 /root/.config/rclone
chmod 600 /root/.config/rclone/rclone.conf
```

3. Mantén `codexwebdev` aislado de producción (DB, uploads, snapshots y estáticos separados).
