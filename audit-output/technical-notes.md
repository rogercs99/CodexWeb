# Notas tecnicas de auditoria

## Hechos verificados
- `DIXIT/server.js` sirve primero `DIXIT/client/dist` y despues `DIXIT/public`.
- El fallback SPA siempre apunta a `DIXIT/client/dist/index.html`.
- `DIXIT/client/src/App.jsx` concentra auth, lobby, perfil, audio, game loop, rooms y reconexion en un unico archivo.
- El frontend React (`DIXIT/client`) no usa `react-router`; navega por estado local.
- Existen dos frontends para Dixit dentro del mismo proyecto:
  - moderno: `DIXIT/client` (React + Vite)
  - legacy: `DIXIT/public` (HTML + JS vanilla)
- `npm run lint` del frontend moderno falla con 15 errores.
- `npm run build` del frontend moderno compila correctamente.
- Hay frontends adicionales no-Dixit (`stitch_frontend`, `frontend_zip`) y un juego aparte (`EclipseGame`).

## Inferencias justificadas
- El backend de proceso activo `/opt/dixit/server.js` sugiere que la app desplegada de Dixit en este servidor no corre desde este working tree directamente, sino de otra ruta de despliegue.
- El frontend a exportar para evolucionar Dixit debe ser `DIXIT/client` porque es el que el backend de Dixit prioriza en static serving y fallback SPA.

## Limitaciones de verificacion
- El sandbox impide abrir puertos (`listen EPERM`), por lo que no fue posible hacer QA manual de pantallas corriendo un entorno local nuevo de prueba dentro de esta sesion.
