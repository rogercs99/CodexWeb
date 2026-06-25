# AI_CONTEXT.md — CodexWeb chat parsing + voz

## Propósito
Resumen técnico persistente para futuras tareas sobre parseo de Claude/Codex y entrada por voz en CodexWeb. Prioriza hechos verificados en el repo y con ejecuciones reales del CLI.

## Estado actual verificado
- Backend principal: `server.js`
- Frontend chat: `stitch_frontend/src/App.tsx` y `stitch_frontend/src/components/ChatScreen.tsx`
- Dev activo: `127.0.0.1:3060`, servicio `codexwebdev.service`
- `docs/AI_CONTEXT_COMPACT.md` sigue siendo la referencia corta prioritaria; este archivo guarda el detalle.

## Flujo real de Codex CLI
- Sí existe un flujo dedicado en `POST /api/chat` para `chatRuntime.activeAgentId === 'codex-cli'`.
- Codex se ejecuta con `exec --json --color never` y parseo de JSONL estructurado.
- Eventos SSE que el frontend ya consume:
  - `assistant_delta`
  - `reasoning_delta`
  - `reasoning_step`
  - `command_started`
  - `command_output_delta`
  - `command_completed`
  - `done`

### Formatos reales observados con `codex exec --json`
Ejemplo mínimo verificado:

```json
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hola"}}
{"type":"turn.completed","usage":{"input_tokens":7749,"cached_input_tokens":6528,"output_tokens":16}}
```

Ejemplo con comando:

```json
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/bash -lc pwd","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/bash -lc pwd","aggregated_output":"/root/CodexWeb\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"`/root/CodexWeb`"}}
```

### Implicación
- El parser actual de Codex ya está alineado con el CLI real: separa mensaje final, reasoning y comandos.
- El contexto viejo que decía que no existía flujo dedicado de Codex quedó obsoleto.

## Flujo real de Claude Code
- Rama dedicada en `POST /api/chat` para `chatRuntime.activeAgentId === 'claude-code'`.
- Claude se lanza con:
  - `-p`
  - `--output-format stream-json`
  - `--verbose`
  - `--include-partial-messages`

### Formato real observado con `claude -p --output-format stream-json --verbose --include-partial-messages "Di hola"`
Sin sesión activa, Claude devolvió:

```json
{"type":"system","subtype":"init", ...}
{"type":"system","subtype":"status","status":"requesting", ...}
{"type":"assistant","message":{"content":[{"type":"text","text":"Not logged in · Please run /login"}]}, "error":"authentication_failed"}
{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login", ...}
```

### Fixes aplicados en el parser de Claude
- `result.is_error === true` ya marca la ejecución como fallida aunque el proceso terminara con exit code `0`.
- El texto final de `result` ya no pisa ciegamente la respuesta parcial:
  - si `result` es una extensión del texto ya emitido, solo se envía el delta faltante;
  - si solo sirve como fallback, se persiste sin romper el streaming.
- Los bloques de `thinking` se deduplican por snapshot para no repetir reasoning cuando llegan mensajes parciales acumulativos.
- `assistant.error` y `result.is_error` se conservan como error reportado por Claude para mejorar el cierre.
- `tool_use` / `tool_result` de herramientas tipo Bash/Shell/Terminal se traducen a:
  - `command_started`
  - `command_output_delta`
  - `command_completed`
  De ese modo el panel `Terminal live` del frontend puede mostrar acciones de Claude separadas de la respuesta final.
- Herramientas no-shell siguen yendo al panel de reasoning como pasos de trabajo.

### Límite actual de validación
- No había sesión activa de Claude durante esta tarea (`claude auth status` devolvió `loggedIn: false`).
- Se verificó el formato real de `stream-json` en error de auth, pero no un flujo completo autenticado con herramientas reales.

## Entrada por voz implementada
- Archivo: `stitch_frontend/src/components/ChatScreen.tsx`
- Botón nuevo de micrófono en el composer.
- Implementación: `SpeechRecognition` / `webkitSpeechRecognition` nativo del navegador.
- Comportamiento:
  - inicia dictado;
  - agrega la transcripción al `textarea`;
  - funciona igual para Claude, Codex o cualquier proveedor porque la salida final es texto normal.

### Alcance real
- Esto es voz a texto en frontend, no transcripción backend de archivos de audio.
- No se añadió `POST /api/transcribe`.
- Los adjuntos de audio siguen pudiéndose subir como archivos normales, pero no se transcriben automáticamente.

### Limitaciones
- Depende del soporte del navegador y permisos del micrófono.
- El feedback de voz es de tipo MVP:
  - `Escuchando...`
  - error por permisos/micrófono/red
  - transcripción insertada en el input
- No hay envío automático del mensaje al terminar el dictado.
- No hay almacenamiento del audio grabado.

## Frontend relacionado
- `App.tsx` ya separa:
  - respuesta final en burbuja Markdown
  - reasoning en panel plegable
  - comandos en `Terminal live`
- Con los cambios actuales, Claude puede reutilizar la misma separación de comandos que Codex cuando emite herramientas shell.

## Validaciones útiles
```bash
curl -sS http://127.0.0.1:3060/api/health
systemctl is-active codexwebdev.service
claude auth status
codex --version
codex exec --json --color never "Responde solo hola"
codex exec --json --color never "Ejecuta el comando pwd y responde con la ruta exacta."
cd /root/CodexWeb/stitch_frontend && npm run lint
cd /root/CodexWeb/stitch_frontend && npm run build
bash /root/CodexWeb/deploy/deploy-dev-frontend.sh
```

## Pendientes abiertos
- Verificar Claude autenticado end-to-end desde CodexWeb para confirmar:
  - streaming parcial real;
  - eventos de herramientas reales;
  - que no haya mezcla residual entre reasoning y respuesta final.
- Si se quiere transcripción de archivos de audio reales, valorar un endpoint backend dedicado. No afirmar modelos de OpenAI sin comprobación oficial externa antes de implementarlo.

## Archivos tocados en esta iteración
- `server.js`
- `stitch_frontend/src/components/ChatScreen.tsx`
- `docs/AI_CONTEXT.md`
