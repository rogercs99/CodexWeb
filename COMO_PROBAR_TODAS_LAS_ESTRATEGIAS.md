# Guía: Cómo Probar las 6 Estrategias de Token Saver

**Versión**: 1.0.0  
**Fecha**: 2026-06-27  
**Entorno**: codexwebdev.gamemodai.pro

---

## 📋 Resumen

Esta guía explica cómo activar y verificar cada una de las 6 estrategias de ahorro de tokens implementadas.

---

## 🧪 Test 1: Listen-Only Mode (71-81% ahorro)

### Objetivo
Verificar que respuestas de confirmación simple ("ok", "sigue") activan el modo ultra-mínimo.

### Pasos

1. **Abrir chat en dev**
   ```
   https://codexwebdev.gamemodai.pro
   ```

2. **Crear conversación nueva**
   - Click en "Nueva Conversación"
   - Seleccionar agente (Claude o Codex)

3. **Enviar pregunta compleja**
   ```
   Explícame la arquitectura completa de CodexWeb: backend, frontend, 
   base de datos, servicios, estructura de archivos, stack técnico y 
   cómo funciona el sistema de autenticación paso a paso.
   ```

4. **Esperar respuesta larga del asistente**
   - La respuesta debe ser detallada (>500 palabras)

5. **Responder con confirmación simple**
   Prueba cada uno:
   - `ok`
   - `sigue`
   - `adelante`
   - `👍`
   - `hazlo`

6. **Verificar activación**
   ```bash
   node /root/CodexWeb/test-token-live.js | grep "listen-only"
   ```

### ✅ Resultado esperado
- Tipo detectado: `listen-only`
- Ahorro: 71-81%
- Mensajes enviados: 1 (solo último mensaje del asistente truncado)

---

## 🧪 Test 2: Command Context Freeze (39-44% ahorro)

### Objetivo
Verificar que comandos largos (npm install, build) congelan el contexto.

### Pasos

1. **Abrir chat en dev**

2. **Pedir instalación de paquetes**
   ```
   Ejecuta npm install en el proyecto CodexWeb
   ```

3. **Observar ejecución del comando**
   - El asistente debe ejecutar el comando
   - Debe mostrar output de instalación

4. **Verificar activación**
   ```bash
   node /root/CodexWeb/test-token-live.js | grep "command-freeze"
   ```

### Comandos adicionales a probar
- `npm run build`
- `git clone https://github.com/example/repo.git`
- `docker build -t myimage .`

### ✅ Resultado esperado
- Tipo detectado: `command-freeze`
- Ahorro: 39-44%
- Mensajes enviados: 2 (usuario + primeras líneas del comando)

---

## 🧪 Test 3: Reasoning Chain Transfer (69% ahorro)

### Objetivo
Verificar que bloques de razonamiento largos se comprimen.

### Pasos

1. **Abrir chat en dev**

2. **Pedir análisis complejo**
   ```
   Analiza en profundidad las ventajas y desventajas de usar SQLite vs 
   PostgreSQL para CodexWeb. Considera: escalabilidad, rendimiento, 
   facilidad de deployment, backup, concurrencia, features específicas, 
   casos de uso ideales y trade-offs. Dame tu recomendación final con 
   justificación detallada.
   ```

3. **Esperar respuesta con razonamiento**
   - El asistente debe generar análisis largo
   - Puede incluir bloques `<think>` o razonamiento extenso

4. **Verificar compresión**
   - La estrategia se aplica automáticamente en el siguiente mensaje
   - No hay flag específico, pero el ahorro debe ser visible

5. **Enviar prompt de continuación**
   ```
   ¿Y qué pasa con el performance en producción?
   ```

6. **Verificar ahorro**
   ```bash
   node /root/CodexWeb/test-token-live.js | tail -20
   ```

### ✅ Resultado esperado
- Tipo detectado: `optimized` (la compresión se aplica internamente)
- Ahorro: >60% si había razonamiento largo
- Bloques `<think>` comprimidos a conclusiones clave

---

## 🧪 Test 4: Diff-Based Compression (8-50% ahorro)

### Objetivo
Verificar que salidas de `git diff` se comprimen.

### Pasos

1. **Modificar un archivo del proyecto**
   ```bash
   echo "// Test comment" >> /root/CodexWeb/server.js
   ```

2. **Abrir chat en dev**

3. **Pedir mostrar diff**
   ```
   Muéstrame el git diff actual del proyecto
   ```

4. **Observar salida comprimida**
   - Debe mostrar headers (`diff --git`, `index`, `@@`)
   - Debe mostrar líneas +/-
   - Debe omitir líneas de contexto sin cambios con `[X líneas omitidas]`

5. **Verificar compresión**
   ```bash
   node /root/CodexWeb/test-token-live.js | tail -20
   ```

### ✅ Resultado esperado
- Tipo detectado: `optimized`
- Ahorro: 8-50% dependiendo del tamaño del diff
- Líneas de contexto sin cambios omitidas

---

## 🧪 Test 5: Immutable Project Cache (15-25% ahorro)

### Objetivo
Verificar que contexto de proyecto se cachea entre conversaciones.

### Pasos

1. **Crear primera conversación**
   - Abrir chat en dev
   - Preguntar sobre el proyecto:
   ```
   ¿Cuál es el stack técnico de CodexWeb?
   ```

2. **Verificar caché creado**
   ```bash
   node -e "
   const tokenSaver = require('./tokenSaver.js');
   const msgs = [{ role: 'system', content: 'PROJECT_CONTEXT.md stack Node.js' }];
   const cached = tokenSaver.getCachedProjectContext(msgs, '/root/CodexWeb');
   console.log('Cache:', cached ? 'SÍ (' + cached.length + ' chars)' : 'NO');
   "
   ```

3. **Crear segunda conversación (mismo proyecto)**
   - Click "Nueva Conversación"
   - Preguntar algo diferente:
   ```
   ¿Cómo funciona la autenticación?
   ```

4. **Verificar reutilización de caché**
   - El contexto de proyecto no se reenvía
   - Ahorro de tokens automático

### ✅ Resultado esperado
- Caché creado: SÍ
- Tamaño: ~300-500 chars
- Reutilizado entre conversaciones: SÍ
- TTL: 1 hora

---

## 🧪 Test 6: Context-Free Streaming (94% ahorro)

### Objetivo
Verificar que modo streaming envía contexto mínimo.

### Pasos

**Nota**: Esta estrategia requiere habilitar `streamingEnabled` en settings. Actualmente está implementada pero requiere configuración adicional en el backend.

1. **Habilitar streaming en settings (temporal)**
   ```javascript
   // En tokenSaver.js PRESETS, añadir temporalmente:
   aggressive: {
     ...
     streamingEnabled: true  // <-- añadir esta línea
   }
   ```

2. **Reiniciar servicio**
   ```bash
   sudo systemctl restart codexwebdev
   ```

3. **Abrir chat en dev**

4. **Enviar cualquier prompt**
   ```
   Explícame cómo funciona el token saver
   ```

5. **Verificar activación**
   ```bash
   node /root/CodexWeb/test-token-live.js | grep "streaming"
   ```

6. **Deshacer cambio temporal**
   ```javascript
   // Quitar streamingEnabled: true de los presets
   ```

### ✅ Resultado esperado
- Tipo detectado: `streaming`
- Ahorro: 94%
- Contexto enviado: solo prompt actual

---

## 📊 Verificación Global de Métricas

### Ver métricas generales
```bash
node /root/CodexWeb/test-token-live.js
```

### Ver solo activaciones de nuevas estrategias
```bash
node /root/CodexWeb/test-token-live.js | grep -E "(listen-only|command-freeze|streaming)"
```

### Ver ahorro por tipo
```bash
sqlite3 /root/CodexWeb/.runtime/dev/app.dev.db "
SELECT 
  json_extract(sections_json, '$.type') as tipo,
  COUNT(*) as activaciones,
  ROUND(AVG(estimated_savings), 0) as ahorro_promedio,
  ROUND(AVG(estimated_savings * 100.0 / NULLIF(estimated_tokens_before, 0)), 0) as ahorro_percent
FROM token_saver_metrics
GROUP BY tipo
ORDER BY activaciones DESC;
"
```

---

## 🎯 Checklist de Pruebas Completas

- [ ] **Listen-Only Mode**: Probado con "ok", "sigue", "👍"
- [ ] **Command Context Freeze**: Probado con npm install o build
- [ ] **Reasoning Chain Transfer**: Probado con análisis complejo
- [ ] **Diff-Based Compression**: Probado con git diff
- [ ] **Immutable Project Cache**: Verificado caché entre conversaciones
- [ ] **Context-Free Streaming**: Verificado con streamingEnabled
- [ ] **Métricas en BD**: Registros creados correctamente
- [ ] **Test sintético**: `test-all-token-strategies.js` pasando 6/6

---

## 📈 Interpretación de Resultados

### Ahorro esperado por estrategia

| Estrategia | Ahorro mínimo | Ahorro típico | Ahorro máximo |
|------------|---------------|---------------|---------------|
| Listen-Only Mode | 70% | 80% | 95% |
| Command Context Freeze | 35% | 45% | 90% |
| Reasoning Chain Transfer | 40% | 55% | 69% |
| Diff-Based Compression | 5% | 30% | 50% |
| Immutable Project Cache | 10% | 20% | 25% |
| Context-Free Streaming | 10% | 15% | 94% |

### Indicadores de éxito global

✅ **Bueno**: Ahorro promedio >70% con 2+ estrategias activadas  
✅ **Excelente**: Ahorro promedio >85% con 4+ estrategias activadas  
✅ **Óptimo**: Ahorro promedio >90% con 5+ estrategias activadas

### Señales de problema

❌ Tipo siempre `optimized` (ninguna estrategia específica se activa)  
❌ Ahorro <50% en prompts de confirmación (listen-only no funciona)  
❌ Ahorro <30% en comandos largos (command-freeze no funciona)  
❌ Cache no se crea o expira inmediatamente

---

## 🔧 Troubleshooting

### Problema: No se activa Listen-Only Mode

**Síntomas**: Responder "ok" no ahorra >70%

**Solución**:
```javascript
// Verificar patrones en tokenSaver.js línea ~505
// Debe incluir estos regex:
/^(ok|okay|vale|sigue|adelante)$/
```

### Problema: Command Freeze no detecta comandos

**Síntomas**: `npm install` no congela contexto

**Solución**:
```javascript
// Verificar patrones en tokenSaver.js línea ~553
// Debe incluir:
/npm\s+(install|i|ci|run\s+build)/
```

### Problema: Cache no persiste

**Síntomas**: Caché vacío entre conversaciones

**Solución**:
```javascript
// El caché es en memoria (Map), se pierde al reiniciar server
// TTL por defecto: 1 hora
// Verificar llamadas a getCachedProjectContext()
```

### Problema: Métricas no se registran

**Síntomas**: `test-token-live.js` muestra 0 peticiones

**Solución**:
```bash
# Verificar que la tabla existe
sqlite3 /root/CodexWeb/.runtime/dev/app.dev.db "
SELECT COUNT(*) FROM token_saver_metrics;
"

# Si retorna 0, enviar al menos 1 mensaje en un chat
```

---

## 📝 Notas Importantes

1. **Las estrategias son automáticas**: No requieren configuración manual en cada chat

2. **Prioridad de activación**: 
   - Streaming > Listen-Only > Command Freeze > Optimización estándar

3. **Cache en memoria**: Se pierde al reiniciar el servidor (por diseño)

4. **Métricas persistentes**: Se guardan en BD y persisten entre reinicios

5. **Tests sintéticos vs reales**: 
   - Sintéticos: Pruebas controladas con datos ficticios
   - Reales: Métricas de chats reales en BD

---

## 🚀 Siguiente Fase

Una vez probadas todas las estrategias en dev:

1. **Monitorizar 1 semana** de uso natural
2. **Ajustar patrones** si hay falsos positivos/negativos
3. **Validar ahorros** coinciden con proyecciones
4. **Replicar en producción** si resultados son satisfactorios

---

**Autor**: Claude Sonnet 4.5 (CodexWeb AI Assistant)  
**Actualizado**: 2026-06-27  
**Estado**: ✅ Listo para pruebas en dev
