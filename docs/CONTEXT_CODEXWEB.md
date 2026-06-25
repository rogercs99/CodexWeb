# CONTEXT_CODEXWEB.md

Lee primero `PROJECT_CONTEXT.md` y `docs/AI_CONTEXT_COMPACT.md`. Este archivo solo resume deltas de trabajo recientes para ahorrar tokens en prompts enfocados a CodexWeb.

## Estado util

- Frontend principal: `stitch_frontend/` con React + Vite.
- Backend principal: `server.js`.
- Entorno de trabajo por defecto: dev en `127.0.0.1:3060`.
- Tools ahora incluye `Terminal Live` como panel movil dentro de `stitch_frontend/src/components/TerminalLogScreen.tsx`.

## Delta reciente

- Nuevo endpoint SSE: `POST /api/tools/terminal-live/stream`.
- Nuevo panel movil: `stitch_frontend/src/components/TerminalLivePanel.tsx`.
- Nuevo parser/export de terminal: `stitch_frontend/src/lib/terminalLive.ts`.
- Documentacion especifica: `docs/CONTEXT_TERMINAL_CHAT.md`.

## Riesgos actuales

- `npm run build` del frontend pasa.
- `node --check server.js` pasa.
- `npm run lint` del frontend sigue roto por un problema previo en `TokenSaverPanel.tsx`, no por este cambio.
