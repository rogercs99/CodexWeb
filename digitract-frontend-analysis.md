# Auditoria Exhaustiva Frontend DigiTract / Dixit
Fecha: 11 de marzo de 2026
Repositorio auditado: `/root/CodexWeb`

## Resumen ejecutivo
El frontend correcto para exportar y evolucionar es `DIXIT/client` (React + Vite). Es el frontend que `DIXIT/server.js` sirve primero en produccion (`express.static(client/dist)` + fallback SPA a `client/dist/index.html`).

El estado actual del frontend es funcional a nivel base, pero con deuda tecnica severa: arquitectura monolitica (un `App.jsx` de 2390 lineas), reglas de juego y UX inconsistentes, deuda de accesibilidad, dependencia de recursos externos en runtime, y una mezcla peligrosa de frontend moderno + frontend legacy en el mismo despliegue.

La app no esta lista para escalar como producto profesional sin una reestructuracion frontend profunda antes de tocar backend.

## Alcance y metodologia
Se audito:
- Estructura real del repo y frontends coexistentes.
- Contrato real frontend-backend (REST + WS) contra `DIXIT/server.js`.
- Pantallas, flujos y estado de `DIXIT/client/src/App.jsx`.
- Legacy `DIXIT/public` para detectar residuos y riesgos.
- Calidad tecnica via `npm run lint` y `npm run build`.

Limitacion de entorno:
- No fue posible levantar un nuevo servidor local en este sandbox para QA manual de navegador por bloqueo de puertos (`listen EPERM` en `0.0.0.0`).

## FASE 1 - Estructura real descubierta
### Frontends detectados
- `DIXIT/client`: React 19 + Vite 7, frontend moderno de Dixit.
- `DIXIT/public`: HTML + JS vanilla legacy de Dixit.
- `EclipseGame/src`: frontend de otro juego (`ECLIPSE CLUB`) con backend Socket.IO propio.
- `stitch_frontend/src`: frontend de CodexWeb (no Dixit).
- `frontend_zip/src`: variante/export de CodexWeb (no Dixit).

### Evidencia de frontend activo para Dixit
- `DIXIT/server.js:498-517` sirve `client/dist`, luego `public`, y fallback SPA a `client/dist/index.html`.
- `DIXIT/client/src/App.jsx:5` conecta al WS `/ws` del backend Dixit.
- `DIXIT/client/src/App.jsx:294-301, 1710, 1821, 1856` usa REST real `/api/auth/*`, `/api/profile`, `/api/rooms`.

### Evidencia operacional en servidor
- Proceso activo detectado: `/usr/bin/node /opt/dixit/server.js`.
- Proceso adicional activo (no objetivo Dixit): `EclipseGame ... tsx server/src/index.ts`.
- Conclusion: hay mas de un backend/juego vivo en el host; para DigiTract/Dixit, el objetivo es `DIXIT`.

### Frontend que debe exportarse a Google AI Studio
`DIXIT/client` + assets necesarios de runtime (`DIXIT/cards` y `DIXIT/client/public/audio`).

## FASE 2 - Auditoria exhaustiva del frontend correcto
## Cobertura auditada
Pantallas y flujos auditados:
- Auth: login/registro (`AuthGate`).
- Home/Landing.
- Salas activas y borrado de sala.
- Perfil y preferencias (+18/audio).
- Lobby.
- Fases de juego: clue, submit, vote, reveal/score.
- Overlays: progreso, errores, audio unlock, reconexion.

Componentes y bloques auditados:
- `useWs`, `Lobby`, `Clue`, `Submit`, `Vote`, `Score`, `ActiveRoomsView`, `ProfileView`, `Landing`, `GameActions`, `ProgressOverlay`.

## Problemas criticos
1. Arquitectura monolitica y acoplamiento extremo.
Evidencia: `DIXIT/client/src/App.jsx` tiene 2390 lineas y mezcla auth, matchmaking, gameplay, audio, perfil, reconexion y UI.
Impacto: alto riesgo de regresiones y bajo throughput de cambios.

2. Flujo de inicio de partida inconsistente con reglas de lobby.
Evidencia: en React `Lobby` el boton principal usa `start_with_bots` (`App.jsx:587-595`) y no usa `start`; `canStart` llega del server pero no se usa (`App.jsx:376`).
Impacto: el host puede forzar arranque sin respetar readiness esperado de humanos.

3. Cuenta regresiva visual no confiable.
Evidencia: `Clue/Submit/Vote` calculan tiempo con `Date.now()` en render (`App.jsx:623-624`, `683-684`, `730-731`), pero no hay estado/interval de UI para rerender temporal.
Impacto: el temporizador mostrado puede quedarse congelado hasta otro rerender.

4. Dos frontends de Dixit conviviendo en produccion (moderno + legacy).
Evidencia: `DIXIT/server.js:509-517` sirve primero React build y luego static legacy `public`.
Impacto: superficie duplicada, colisiones de assets y confusion de soporte/mantenimiento.

5. Dependencia fuerte de recursos externos en runtime.
Evidencia: `DIXIT/client/index.html:8` carga Tailwind CDN en cliente; `index.css:1-2` usa Google Fonts; `index.css:29-33` usa imagen remota Unsplash.
Impacto: latencia, riesgo por CSP/offline, y comportamiento no determinista.

6. Baseline de calidad roto en lint.
Evidencia: `npm run lint` falla con 15 errores y 1 warning (hooks purity, set-state-in-effect, unused vars).
Impacto: deuda visible y friccion para evolucion segura.

7. Accesibilidad por debajo de minimo aceptable.
Evidencia: elementos clicables no semanticos (`App.jsx:663` usa `div` clickable), imagenes sin `alt` (`App.jsx:650, 719, 766, 852, 1345`), multiples icon buttons sin label explicito.
Impacto: mala experiencia teclado/lector de pantalla y deuda WCAG.

8. Feedback UX inconsistente en acciones criticas.
Evidencia: borrado de sala cierra modal sin confirmar exito (`App.jsx:911-918`), copiado de codigo no da feedback en React (`App.jsx:530, 553`), se usa `alert` bloqueante en evento `ended` (`App.jsx:144`).
Impacto: incertidumbre operativa y UX erratica.

9. Estado global y eventos ad-hoc sin contrato claro de frontend.
Evidencia: uso de `window.dispatchEvent('dixit:progress')` para flujo interno (`App.jsx:601, 798, 2023-2026`).
Impacto: arquitectura fragil y dificil de testear.

10. Riesgo de carreras y side effects opacos.
Evidencia: supresion manual de dependencias en effect (`App.jsx:1739`), `handleResume` no memorizado y warning de deps (`lint`), cola WS reenviada sin dedupe semantico (`App.jsx:116-125`, `178-188`).
Impacto: bugs intermitentes de sincronizacion/reconexion.

## Problemas medios
1. Props y variables sin uso en componentes clave.
Evidencia: `onSolo`, `toggleMusic`, `musicOn`, `canStart`, `hostId`, `you`, `storytellerSubmission`, `roundsLeft` sin uso (segun lint).

2. Deuda legacy y residuos de plantilla.
Evidencia: `DIXIT/client/src/App.css` y `src/assets/react.svg` sin uso real; `DIXIT/client/README.md` sigue plantilla Vite.

3. Navegacion local sin router formal.
Evidencia: flujo de pantallas por `landingView` y `state.phase` en un solo componente.

4. Borrado de salas visible para cualquiera en listado.
Evidencia: `ActiveRoomsView` muestra `Eliminar` en todas las salas (`App.jsx:1003-1012`), backend luego rechaza si no host.

5. Campo `avatarSeed` expuesto pero no consumido en UI.
Evidencia: perfil permite editar seed (`App.jsx:1121-1127`), avatar visual sigue inicial de nombre (`App.jsx:1308`).

6. Endpoint de historial de sala sin integracion frontend.
Evidencia: existe `GET /api/rooms/:code/history` en backend (`server.js:2957`) y no se usa en React.

7. Manejo de errores parcial.
Evidencia: `fetchActiveRooms` hace `console.error` y no feedback de UI (`App.jsx:1823-1825`).

8. Modal/drawer sin cierre por ESC ni focus-trap.
Evidencia: drawer de menu y modal de borrar no gestionan accesibilidad de foco/teclado.

9. Inputs duplican handlers innecesariamente.
Evidencia: room input usa `onInput`, `onChange` y `onBlur` al mismo handler (`App.jsx:1381-1383`).

10. Mensajeria de producto con texto interno/placeholder.
Evidencia: copia visible "Estado limpio: Home, Salas y Perfil estan separados." (`App.jsx:1353`).

## Problemas menores
1. `alert` y `console.error` en flujo principal en lugar de sistema de notificaciones consistente.
2. Iconografia/material symbols sin fallback accesible.
3. Dependencia de localStorage sin envoltura robusta en todos los puntos.
4. Duplicacion de CTA para entrar/continuar en landing, potencial confusion.

## Integracion frontend-backend
## Hechos
- Contrato WS real: `join`, `start_solo`, `set_mode`, `start_with_bots`, `submit_clue`, `submit_card`, `vote`, `continue`, `leave`, etc.
- Contrato REST real: `/api/auth/*`, `/api/profile`, `/api/rooms`, `/api/rooms/:code/history`.

## Brechas detectadas
- Flujo React no usa `start` multijugador clasico aunque backend lo soporta.
- Historial de sala backend existe y no se aprovecha en frontend.
- Parte de controles/estados de lobby no reflejan fielmente la semantica de servidor (`canStart` no usado en UI).

## Calidad y validaciones ejecutadas
- `cd DIXIT/client && npm run lint` => FAIL (15 errores, 1 warning).
- `cd DIXIT/client && npm run build` => OK.
- `cd DIXIT && npm test` => FAIL (entorno sandbox, runtime red restringido).
- `cd DIXIT && npm run test:e2e` => FAIL por `listen EPERM`.

## Riesgos tecnicos
- Alta probabilidad de regresion por acoplamiento en `App.jsx`.
- UX de partida sensible a estados de red por cola WS y side effects no modelados.
- Doble frontend coexistente dificulta soporte y debugging en produccion.
- Dependencia de CDN/scripts remotos compromete estabilidad operativa.

## Priorizacion de mejoras por impacto
1. P0: separar `App.jsx` en arquitectura por dominio (`auth`, `landing`, `rooms`, `profile`, `gameplay`, `audio`, `ws`).
2. P0: corregir flujo de inicio de partida para distinguir `start` clasico y `start_with_bots` con reglas explicitas.
3. P0: implementar reloj UI reactivo estable y sincronizado con `deadlineAt`.
4. P0: retirar dependencias runtime externas (Tailwind CDN, fondos remotos) y empaquetar assets locales.
5. P0: limpiar errores de lint y reactivar reglas como puerta de calidad.
6. P1: resolver accesibilidad base (semantica botones, alt, focus, labels, teclado).
7. P1: unificar sistema de feedback/toasts y eliminar `alert`.
8. P1: eliminar/aislar legacy `DIXIT/public` del path principal de produccion.
9. P1: integrar historial de sala y estados vacios/carga/error consistentes.
10. P2: pruebas frontend (unitarias + e2e) y contrato WS tipado.

## Que deberia hacer Google AI Studio exactamente
1. Reescribir frontend de Dixit con arquitectura modular y mantenible.
2. Mantener contrato exacto con backend actual (REST + WS) sin inventar eventos incompatibles.
3. Implementar todos los flujos pendientes/inconsistentes de lobby, partida, reconexion y feedback.
4. Corregir accesibilidad y responsive para movil/escritorio.
5. Establecer sistema de estados robusto (idle/loading/error/success) por pantalla.
6. Sustituir dependencias runtime remotas por build local reproducible.
7. Entregar codigo limpio con tipado fuerte (migracion a TypeScript recomendada).
8. Aportar plan de migracion de legacy y estrategia de compatibilidad por fases.

## Que NO debe tocar Google AI Studio
1. No romper payloads ni nombres de eventos WS existentes en `DIXIT/server.js`.
2. No cambiar rutas REST existentes ni semantica de auth/cookies sin documentar migracion.
3. No alterar reglas de puntuacion/turnos en backend desde frontend.
4. No introducir APIs nuevas sin contrato escrito y fallback de compatibilidad.
5. No eliminar assets/cartas requeridas por backend sin alternativa equivalente.

## Frontends/partes legacy detectadas
- `DIXIT/public` (legacy functional, no objetivo de evolucion principal).
- `frontend_zip` y `stitch_frontend` (frontends de CodexWeb, no Dixit).
- `EclipseGame` (otro juego/proyecto, no objetivo de esta exportacion).

## Top 10 problemas (resumen rapido)
1. `App.jsx` monolitico y altamente acoplado.
2. Inicio de partida React no respeta flujo clasico (`start` no usado).
3. Temporizador visual no confiable.
4. Convivencia moderno+legacy en mismo serving path.
5. Dependencias runtime externas (CDN/fonts/imagen remota).
6. Lint roto con 15 errores.
7. Accesibilidad deficiente.
8. Feedback de acciones criticas inconsistente.
9. Eventos globales ad-hoc (`dixit:progress`).
10. Side effects/riesgo de sincronizacion en reconexion.

## Hechos vs inferencias
Hechos:
- Todo lo citado arriba con evidencia de archivos/lineas y comandos ejecutados.

Inferencias:
- El proceso `/opt/dixit/server.js` sugiere despliegue externo al working tree actual.
- Aunque no se pudo abrir un navegador local en sandbox, la combinacion de contrato backend + codigo frontend permite afirmar los gaps de arquitectura y UX con alta confianza.
