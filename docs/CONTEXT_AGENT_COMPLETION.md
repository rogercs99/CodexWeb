# CONTEXT_AGENT_COMPLETION.md — CodexWeb Agent Completion System

## Propósito
Documentación técnica del sistema de auto-continuación y completitud de respuestas para agentes Claude Code y Codex CLI en CodexWeb.

## Problema Original
Los usuarios reportaban que las ejecuciones de agentes se quedaban a medias:
- El agente razonaba o ejecutaba comandos pero no emitía mensaje final visible
- El usuario tenía que escribir "sigue" para que el agente terminara
- CodexWeb marcaba la ejecución como completada aunque faltara la respuesta final

## Solución Implementada

### 1. Contrato de Respuesta Final
Se añadió al prompt de Claude y Codex un contrato explícito:
```
[CONTRATO DE RESPUESTA FINAL]
IMPORTANTE: Debes completar la tarea de principio a fin.
- NO termines solo con razonamiento, comandos o pasos parciales.
- Si necesitas seguir trabajando, continúa automáticamente.
- Al final, emite una respuesta final visible y completa para el usuario.
- Marca tu respuesta final con:
  CODEXWEB_FINAL_RESPONSE_BEGIN
  [tu respuesta final aquí]
  CODEXWEB_FINAL_RESPONSE_END
- Los marcadores son internos y no se mostrarán al usuario.
```

**Archivos modificados:**
- `server.js` líneas ~23680-23695 (Claude Code prompt)
- `server.js` líneas ~25060-25075 (Codex CLI prompt)

### 2. Funciones Helper Comunes

#### `extractAgentVisibleText(payload)`
Extrae texto visible de respuestas de agentes soportando múltiples formatos:
- Strings directos
- Arrays de bloques
- Objetos con campos: `text`, `output`, `output_text`, `response`, `result`, `completion`, `final_answer`, `answer`, `summary`
- Campo `content` como string/array/objeto
- Campo `message` como string/objeto
- Bloques tipados: `{type: 'text', text}`, `{type: 'output_text', text}`, etc.
- Deltas parciales: `{delta}`, `{partial}`

**Ubicación:** `server.js` líneas ~609-657

#### `analyzeAgentCompletionState(state)`
Analiza si una respuesta de agente está completa:

**Parámetros:**
```javascript
{
  assistantOutput: string,
  reasoning: string,
  commandsExecuted: array,
  stderr: string,
  notices: array,
  closeReason: string,
  hasOpenCommands: boolean
}
```

**Retorna:**
```javascript
{
  hasVisibleFinal: boolean,
  looksIncomplete: boolean,
  reason: string,  // 'empty_output', 'only_reasoning_no_final', 'open_commands',
                   // 'final_sentinels_present', 'open_code_fence',
                   // 'unfinished_tail_punctuation', 'truncated_ellipsis',
                   // 'self_reported_incomplete', 'appears_complete', etc.
  shouldContinue: boolean
}
```

**Detecciones:**
- Output vacío o menor que `CHAT_MIN_FINAL_CHARS`
- Solo reasoning sin respuesta final
- Comandos abiertos (sin output)
- Code fence abierto (conteo impar de `````)
- Terminación incompleta: termina en `,`, `:`, `;`, `-`, `...`
- Frases de continuación: "continuo", "sigo", "pendiente", "falta", "remaining", "WIP", "next step", etc.
- Marcadores presentes: `CODEXWEB_FINAL_RESPONSE_BEGIN` y `CODEXWEB_FINAL_RESPONSE_END`
- Stderr/notices indicando interrupción: timeout, auth, quota, network error
- Trabajo extenso (reasoning largo o muchos comandos) con output final mínimo

**Ubicación:** `server.js` líneas ~659-780

#### `stripFinalResponseSentinels(text)`
Elimina los marcadores internos `CODEXWEB_FINAL_RESPONSE_BEGIN` y `CODEXWEB_FINAL_RESPONSE_END` del texto antes de persistir/mostrar.

**Ubicación:** `server.js` líneas ~782-788

### 3. Auto-Continuación de Codex

**Funciones clave:**
- `looksLikeIncompleteAssistantOutput(rawText)` — ahora usa `analyzeAgentCompletionState()`
- `buildContinuationPrompt(reason)` — mejorado con:
  - Tail de salida visible (hasta `CHAT_CONTINUATION_TAIL_CHARS`)
  - Últimos 5 pasos de reasoning
  - Últimos 3 comandos ejecutados con exit codes
  - Últimas 2 líneas de stderr
  - Últimas 2 notificaciones del sistema
  - Recordatorio del contrato final con marcadores
- `shouldAutoContinue(exitCode, closeReason)` — decide si auto-continuar

**Ubicación:** `server.js` líneas ~26060-26180

**Flujo:**
1. Codex termina con exit code 0
2. `shouldAutoContinue()` verifica:
   - ¿Hay comandos abiertos? → continuar
   - ¿Output parece incompleto según `analyzeAgentCompletionState()`? → continuar
3. Si continúa:
   - Incrementa `codexContinuationCount`
   - Emite `system_notice` indicando continuación
   - Construye prompt de continuación con contexto completo
   - Re-lanza Codex con nuevo prompt
4. Si agota `CHAT_AUTO_CONTINUATIONS` → emite error explícito

### 4. Auto-Continuación de Claude Code

**Funciones nuevas:**
- `hasOpenClaudeCommands()` — detecta herramientas sin output
- `buildClaudeContinuationPrompt(reason)` — similar a Codex, incluye:
  - Tail de salida visible
  - Últimos 5 pasos de reasoning
  - Últimas 3 herramientas ejecutadas
  - Últimas 2 líneas de stderr
  - Últimas 2 notificaciones
  - Recordatorio del contrato final
- `shouldClaudeAutoContinue(exitCode, closeReason)` — decide si auto-continuar

**Ubicación:** `server.js` líneas ~24010-24100

**Flujo:**
1. Claude termina (evento `close`)
2. `shouldClaudeAutoContinue()` verifica:
   - ¿Hay herramientas sin output? → continuar
   - ¿Output parece incompleto según `analyzeAgentCompletionState()`? → continuar
3. Si continúa:
   - Incrementa `claudeContinuationCount`
   - Emite `system_notice` indicando continuación
   - Construye prompt de continuación
   - Re-lanza Claude con nuevos args
   - Reutiliza listeners ya configurados
4. Si agota `CHAT_AUTO_CONTINUATIONS` → emite error explícito

**Variables de estado añadidas:**
```javascript
let claudeContinuationCount = 0;
let claudeAttempt = 0;
let claudeAttemptAssistantStartLength = 0;
const claudeReasoningLines = [];
const claudeStderrLines = [];
const claudeNotices = [];
```

### 5. Configuración Actualizada

| Variable | Default Anterior | Default Nuevo | Cap Máximo |
|----------|------------------|---------------|------------|
| `CHAT_AUTO_CONTINUATIONS` | 2 | 6 | 12 |
| `CHAT_CONTINUATION_TAIL_CHARS` | 6000 | 10000 | 50000 |
| `CHAT_MIN_FINAL_CHARS` | — | 10 | 1000 |
| `CHAT_AGENT_FINAL_SENTINEL_REQUIRED` | — | false | — |

**Ubicación:** `server.js` líneas ~527-558

**Uso:**
```bash
# Aumentar intentos de continuación
CHAT_AUTO_CONTINUATIONS=10

# Aumentar contexto en continuación
CHAT_CONTINUATION_TAIL_CHARS=20000

# Requerir marcadores explícitos de final
CHAT_AGENT_FINAL_SENTINEL_REQUIRED=true

# Mínimo de caracteres para considerar final válido
CHAT_MIN_FINAL_CHARS=50
```

### 6. Eventos SSE Nuevos

Se reutilizan `system_notice` para indicar continuaciones:
```javascript
{
  text: "Claude auto-continuando (2/6): empty_output"
}
{
  text: "Codex auto-continuando (1/6): open_commands"
}
```

El frontend ya maneja `system_notice` y lo muestra sin romper UI.

## Tests

### Fake CLIs
- `tests/fixtures/fake-codex-cli.mjs` — simula escenarios Codex
- `tests/fixtures/fake-claude-cli.mjs` — simula escenarios Claude

**Escenarios Codex:**
- `SCENARIO_REASONING_NO_FINAL` — reasoning + comando sin mensaje final
- `SCENARIO_COMMAND_NO_FINAL` — comando completo pero agent_message vacío
- `SCENARIO_FINAL_IN_CONTENT` — final en `item.content[]` en vez de `item.text`
- `SCENARIO_FINAL_WITH_SENTINELS` — final con marcadores CODEXWEB_FINAL_RESPONSE_*
- `SCENARIO_CONTINUATION` — simula primera ejecución incompleta, segunda completa
- `SCENARIO_EXHAUSTED` — respuestas incompletas para agotar continuaciones

**Escenarios Claude:**
- `SCENARIO_THINKING_NO_FINAL` — thinking + tool_use sin respuesta final
- `SCENARIO_TOOL_USE_NO_FINAL` — tool completo sin mensaje final de texto
- `SCENARIO_RESULT_STRING` — final en `result.result` como string
- `SCENARIO_FINAL_WITH_SENTINELS` — final con marcadores
- `SCENARIO_CONTINUATION` — simula auto-continuación
- `SCENARIO_IS_ERROR_TRUE` — `result.is_error=true` debe fallar aunque exit code=0

### Suite E2E
`tests/e2e/chat-agent-completion.mjs` — tests de integración

**Ejecutar:**
```bash
npm run test:e2e:agents
# O directamente:
node tests/e2e/chat-agent-completion.mjs
```

**Para tests con servidor real:**
```bash
NODE_ENV=test \
CODEX_CMD="node tests/fixtures/fake-codex-cli.mjs" \
CLAUDE_CODE_BIN="node tests/fixtures/fake-claude-cli.mjs" \
node server.js
```

### Incluido en Test Audit
```bash
npm run test:audit
```

Ahora incluye `test:e2e:agents`.

## Validación Manual en DEV

### Comandos de validación:
```bash
# Verificar sintaxis
node --check server.js

# Ejecutar tests
npm run test:e2e:agents

# Verificar servicio dev activo
systemctl status codexwebdev.service

# Verificar binarios configurados
grep -E "CODEX_CMD|CLAUDE_CODE_BIN" deploy/codexwebdev.env
```

### Casos de prueba reales:

**Prompt de varios pasos para Codex:**
```
Analiza el archivo server.js, encuentra las 3 funciones más largas, 
y genera un resumen final con sus nombres, ubicaciones y número de líneas.
```

**Prompt de varios pasos para Claude:**
```
Lee el archivo docs/AI_CONTEXT.md, extrae los puntos clave sobre parseo de agentes,
y genera un resumen final en formato markdown.
```

**Verificación esperada:**
- Agente razona, ejecuta comandos, y termina con respuesta final visible
- NO hace falta escribir "sigue"
- Si falta final, el sistema auto-continúa automáticamente
- Después de N intentos sin final, devuelve error explícito (no success falso)
- Los marcadores `CODEXWEB_FINAL_RESPONSE_BEGIN/END` NO aparecen en UI ni DB

## Flujo Completo: Agente → Backend → SSE → Frontend

```
Usuario envía prompt
     ↓
Backend construye executionPrompt + contrato final
     ↓
Lanza Claude/Codex con prompt enriquecido
     ↓
Agente razona, ejecuta comandos, emite deltas
     ↓
Backend parsea eventos, actualiza estado:
  - assistantOutput
  - reasoningLines
  - commandsExecuted
  - stderrLines
  - notices
     ↓
Agente termina (exit/close)
     ↓
Backend llama shouldAutoContinue() / shouldClaudeAutoContinue()
     ↓
analyzeAgentCompletionState({
  assistantOutput,
  reasoning,
  commandsExecuted,
  stderr,
  notices,
  closeReason,
  hasOpenCommands
})
     ↓
Si looksIncomplete=true y intentos < límite:
  - Incrementa continuationCount
  - Emite system_notice de continuación
  - buildContinuationPrompt() con contexto completo
  - Re-lanza agente con nuevo prompt
  - GOTO: Agente razona...
     ↓
Si looksIncomplete=false o intentos agotados:
  - stripFinalResponseSentinels(assistantOutput)
  - Persiste mensaje final en DB
  - Emite done { ok: true/false, result, error }
  - Frontend muestra respuesta final (sin marcadores)
```

## Archivos Modificados

### Backend (`server.js`)
- Líneas ~527-558: Configuración de auto-continuación actualizada
- Líneas ~609-788: Helper functions comunes (extractAgentVisibleText, analyzeAgentCompletionState, stripFinalResponseSentinels)
- Líneas ~23680-23695: Prompt Claude con contrato final
- Líneas ~24010-24100: Auto-continuación Claude (hasOpenClaudeCommands, buildClaudeContinuationPrompt, shouldClaudeAutoContinue)
- Líneas ~24400-24550: Claude close handler con auto-continuación
- Líneas ~25060-25075: Prompt Codex con contrato final
- Líneas ~26050-26070: Codex looksLikeIncompleteAssistantOutput usa analyzeAgentCompletionState
- Líneas ~26075-26120: Codex buildContinuationPrompt mejorado
- Líneas ~26015-26025: Codex finalizeResponse con stripFinalResponseSentinels

### Tests
- `tests/fixtures/fake-codex-cli.mjs` (nuevo)
- `tests/fixtures/fake-claude-cli.mjs` (nuevo)
- `tests/e2e/chat-agent-completion.mjs` (nuevo)

### Configuración
- `package.json`: script `test:e2e:agents` añadido, incluido en `test:audit`

### Documentación
- `docs/CONTEXT_AGENT_COMPLETION.md` (este archivo)
- `docs/AI_CONTEXT_COMPACT.md` (actualizado con referencia)

## Criterios de Aceptación Cumplidos

✅ Claude y Codex no dan `done ok=true` sin respuesta final visible  
✅ Si falta final, auto-continúan automáticamente  
✅ Si se agotan intentos o hay timeout/auth/error real, se devuelve error explícito y útil  
✅ Los marcadores internos no aparecen en UI ni DB final  
✅ El razonamiento no se guarda como mensaje final normal  
✅ Tests fake CLI cubren formatos alternativos y regresiones  
✅ Tests audit pasan  
✅ Commits separados y trazables  
✅ Documentación completa en `docs/CONTEXT_AGENT_COMPLETION.md`

## Próximos Pasos

1. Validar en DEV con agentes reales:
   - Claude Code autenticado
   - Codex CLI con prompts largos de varios pasos
2. Verificar que no hay regresiones en chats existentes
3. Monitorear logs para ver frecuencia real de auto-continuaciones
4. Ajustar límites si es necesario según uso real
5. Desplegar a producción después de validación exitosa en DEV

## Referencias
- Especificación original del usuario (ver prompt inicial de esta sesión)
- `PROJECT_CONTEXT.md` — contexto general del proyecto
- `docs/AI_CONTEXT.md` — parseo de Claude/Codex
- `docs/AI_CONTEXT_COMPACT.md` — referencia compacta
- `docs/CONTEXT_CODEXWEB_AUDIT.md` — auditoría previa
