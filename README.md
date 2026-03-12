# CodexWeb Mobile

Aplicación web **mobile-first** con chat en modo agente para ejecutar tareas sobre el sistema local.

## Requisitos

- Node.js 18+
- Codex CLI instalado (`codex`)
- Gemini CLI instalado (`gemini`) si quieres usar Gemini en modo agente

## Instalación

```bash
npm install
cp .env.example .env
npm start
```

Abrir `http://localhost:3000`.

## Integraciones agenticas soportadas

- `Codex CLI` (OpenAI): modo agente por terminal con login de ChatGPT.
- `Gemini CLI` (Google): modo agente por terminal (requiere API key + binario `gemini`).

El panel de Settings solo muestra estas integraciones porque son las que CodexWeb ejecuta realmente con control de sistema.

## Configurar Gemini en modo agente

1. Instala Gemini CLI en el servidor:
```bash
npm install -g @google/gemini-cli
```
2. Crea una API key en Google AI Studio.
3. En `.env`, define acceso de sistema completo:
```bash
GEMINI_INCLUDE_DIRECTORIES=/
```
4. En `Settings > Integraciones IA > Gemini CLI`, activa la integración, pega la API key y guarda.
5. En `Settings > Agente en uso`, selecciona `Gemini CLI`.
6. Inicia un chat nuevo y prueba una tarea de sistema.

## Variables de entorno

- `PORT`: puerto HTTP.
- `SESSION_SECRET`: secreto de sesión.
- `CODEX_CMD`: comando/ruta del CLI de Codex (por defecto `codex`).
- `GEMINI_CMD`: comando/ruta del CLI de Gemini (por defecto `gemini`).
- `GEMINI_INCLUDE_DIRECTORIES`: rutas extra disponibles para Gemini (usa `/` para acceso total).
- `NODE_ENV`: `development` o `production`.
- `DB_PATH`: ruta de DB SQLite (admite absoluta o relativa al repo).
- `UPLOADS_DIR`: ruta de adjuntos/subidas.
- `TASK_SNAPSHOTS_DIR`: ruta de snapshots de tareas.
- `STORAGE_JOBS_DIR`: ruta de jobs temporales de almacenamiento.
- `RESTART_STATE_PATH`: ruta del estado de reinicio.
- `STATIC_ASSETS_DIR`: ruta de estáticos servidos por Express.
- `RCLONE_BIN`: binario de rclone (por defecto `rclone`).
- `RCLONE_CONFIG_PATH`: ruta del `rclone.conf` usado por CodexWeb.
- `RCLONE_DRIVE_DEFAULT_REMOTE`: remote por defecto de Google Drive.
- `RCLONE_DRIVE_DEFAULT_ROOT`: carpeta raíz remota por defecto (ej. `CodexWebDEV`).
- `STORAGE_RESIDUAL_SCAN_ROOTS`: raíces permitidas para análisis/borrado de residuales.

## Despliegue aislado dev/prod

Para levantar `codexwebdev.gamemodai.pro` sin tocar `codexweb.gamemodai.pro`, revisa:

- `docs/deployment-codexwebdev-isolation-2026-03-11.md`

## Google Drive con rclone (DEV)

Guía de integración real (rclone + Google Drive) para CodexWebDEV:

- `docs/google-drive-rclone-codexwebdev-2026-03-11.md`
