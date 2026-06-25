# Fix: Interrupción de prompts en dev por timeout de Cloudflare Tunnel

**Fecha**: 2026-06-25  
**Entorno afectado**: Development (codexwebdev.gamemodai.pro)  
**Síntoma**: Los prompts de Claude Code se interrumpen cuando se ejecutan, especialmente los más largos  

## Diagnóstico

El problema era que **Claude Code no tenía heartbeat SSE**, mientras que otros agentes (Codex, Gemini) sí lo tienen.

### Causa raíz

1. **Cloudflare Tunnel** cierra conexiones HTTP sin actividad después de ~100 segundos
2. **Claude Code** usa Server-Sent Events (SSE) de larga duración
3. Durante la ejecución, si Claude Code no emite ningún output durante >100s, Cloudflare cierra la conexión
4. El cliente (navegador) pierde la conexión y el prompt se interrumpe

### Comparación con otros agentes

**Codex CLI** (línea ~23903):
```javascript
heartbeatTimer = setInterval(() => {
  sendSseCommentSafe('ping') &&
  sendSseSafe('heartbeat', {
    at: nowIso(),
    phase: runPhase || 'running'
  });
}, 11000);
```

**Claude Code** (antes del fix): ❌ No tenía heartbeat

## Solución implementada

Añadido heartbeat SSE cada 11 segundos para Claude Code, siguiendo el mismo patrón que Codex:

### Cambios en `server.js`

1. **Definición del heartbeat** (después de línea 22609):
```javascript
let claudeHeartbeatTimer = null;
const stopClaudeHeartbeat = () => {
  if (claudeHeartbeatTimer !== null) {
    clearInterval(claudeHeartbeatTimer);
    claudeHeartbeatTimer = null;
  }
};
claudeHeartbeatTimer = setInterval(() => {
  if (claudeClientDisconnected || res.writableEnded || res.destroyed) {
    stopClaudeHeartbeat();
    return;
  }
  try {
    res.write(': ping\n\n');
    sendSse(res, 'heartbeat', {
      at: nowIso(),
      phase: 'running'
    });
  } catch (_error) {
    stopClaudeHeartbeat();
  }
}, 11000);
```

2. **Limpieza en desconexión del cliente**:
```javascript
const handleClaudeClientDisconnect = (source) => {
  claudeClientDisconnected = true;
  stopClaudeHeartbeat();  // ← Añadido
  logChatStream('client_disconnect', { source });
};
```

3. **Limpieza en finalización**:
```javascript
const finalizeClaudeRequest = ({ ok, exitCode, closeReason, output }) => {
  if (claudeFinished) return;
  claudeFinished = true;
  stopClaudeHeartbeat();  // ← Añadido
  claudeWatchdog.clear();
  // ...
};
```

## Verificación

### Configuraciones relevantes

**Nginx** (`deploy/nginx/codexwebdev.gamemodai.pro.conf`):
- `proxy_read_timeout 3600s` (1 hora) ✅
- `proxy_send_timeout 3600s` (1 hora) ✅

**Node.js** (`deploy/codexwebdev.env`):
- `CLAUDE_CODE_TIMEOUT_MS=900000` (15 minutos) ✅

**Cloudflare Tunnel**:
- Timeout implícito: ~100 segundos sin actividad ⚠️
- **Mitigado**: Heartbeat cada 11s mantiene la conexión viva ✅

### Pruebas recomendadas

1. Ejecutar un prompt largo (>2 min) que requiera comandos lentos
2. Verificar en las DevTools del navegador que:
   - Llegan eventos `heartbeat` cada ~11 segundos
   - La conexión SSE permanece abierta durante toda la ejecución
   - No hay errores de red tipo `ERR_INCOMPLETE_CHUNKED_ENCODING`

## Estado del despliegue

- ✅ Cambios aplicados en `server.js`
- ✅ Servicio `codexwebdev.service` reiniciado
- ⏳ Pendiente: Commit y push a Git
- ⏳ Pendiente: Aplicar el mismo fix a producción si es necesario

## Notas técnicas

### ¿Por qué cada 11 segundos?

- Cloudflare timeout: ~100s
- Factor de seguridad: 9x (100/11 ≈ 9)
- Overhead mínimo: ~0.01 KB cada 11s ≈ 5.5 KB/min
- Compatible con límites de rate de Cloudflare

### Alternativas descartadas

1. **Aumentar timeout de Cloudflare**: No es posible en Cloudflare Tunnel (sin Enterprise)
2. **Deshabilitar buffering en nginx**: Ya está deshabilitado (`proxy_buffering off`)
3. **WebSockets en lugar de SSE**: Cambio arquitectónico muy grande

## Trabajo relacionado

Este fix se alinea con los objetivos del proyecto:
- Estabilizar dev antes de añadir mejoras
- Verificar el servicio real antes de asumir que un fix funciona
- Mantener coherencia entre dev y producción

## Referencias

- Issue similar en Codex CLI: Resuelto con heartbeat en línea 23903
- Cloudflare Tunnel timeout: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/configuration/configuration-file/ingress/#http-settings
- SSE spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
