# Testing Token Savings - Listen-Only Mode & Command Context Freeze

## 🎯 Objetivo

Verificar que las nuevas optimizaciones de ahorro de tokens funcionan correctamente en codexwebdev.

## 📊 Optimizaciones Implementadas

### 1. **Listen-Only Mode**
- **Ahorro esperado**: 85-95%
- **Trigger**: Prompts de confirmación simples
- **Patrones detectados**:
  - `ok`, `vale`, `sí`, `yes`, `adelante`, `continúa`, `procede`
  - `hazlo`, `aplícalo`, `impleméntalo`, `ejecuta`
  - Emojis: `👍`, `✓`, `👌`

### 2. **Command Context Freeze**
- **Ahorro esperado**: 70-90%
- **Trigger**: Comandos largos en ejecución
- **Patrones detectados**:
  - `npm install`, `npm run build`, `npm run test`
  - `git clone`
  - `yarn install`, `yarn build`
  - `docker build`
  - `mvn clean install`
  - Outputs con "executing command", "running build", "downloading"

## 🧪 Plan de Pruebas

### Test 1: Listen-Only Mode

**Pasos**:
1. Abrir chat en codexwebdev
2. Hacer una pregunta técnica larga (ej: "Explícame cómo funciona el sistema de Token Saver")
3. Cuando el asistente responda, escribir solo: **"ok"**
4. Verificar en la UI que aparece el indicador de Token Saver
5. **Resultado esperado**: 
   - `ts_stats.percent` debería ser ≥ 85%
   - `ts_stats.mode` debería ser `listen-only`
   - El asistente debería responder brevemente sin repetir contexto

**Variaciones para probar**:
- "vale"
- "sí"
- "continúa"
- "adelante"
- "hazlo"
- "👍"

### Test 2: Command Context Freeze

**Pasos**:
1. Abrir chat en codexwebdev
2. Tener una conversación larga previa (10+ mensajes)
3. Pedir al asistente: "Ejecuta npm install"
4. Cuando el asistente empiece a ejecutar, escribir: **"continúa"**
5. Verificar en la UI el indicador de Token Saver
6. **Resultado esperado**:
   - `ts_stats.percent` debería ser ≥ 70%
   - `ts_stats.mode` debería ser `command-freeze`
   - El contexto completo anterior debería estar congelado

**Comandos para probar**:
- `npm run build`
- `git clone https://github.com/...`
- `docker build .`
- Cualquier comando que genere mucho output

### Test 3: Verificar Baseline (sin optimizaciones)

**Pasos**:
1. Ir a Settings → Token Saver
2. Cambiar preset a **"Off"**
3. Hacer la misma pregunta técnica
4. Escribir "ok"
5. **Resultado esperado**:
   - NO debería aparecer indicador de ahorro
   - El contexto completo se envía sin optimizar

### Test 4: Comparativa de Tamaños

**Pasos**:
1. Abrir DevTools → Network
2. Activar preset "Aggressive"
3. Tener conversación de 20 mensajes
4. Escribir "ok" y capturar el tamaño del request a `/api/chat`
5. Repetir con preset "Off"
6. **Resultado esperado**:
   - Con "Aggressive" + Listen-Only: request ≤ 1KB
   - Con "Off": request ≥ 8KB
   - **Ahorro neto**: ~87-90%

## 📈 Métricas a Recopilar

Durante las pruebas, anotar:

```
Test: [nombre]
Preset: [off/balanced/aggressive/extreme]
Prompt: [texto del prompt]
Resultado:
  - Mode detectado: [off/optimized/listen-only/command-freeze]
  - Tokens before: [número]
  - Tokens after: [número]
  - Savings: [número]
  - Savings %: [número]
  - Mensajes before: [número]
  - Mensajes after: [número]
```

## 🔍 Debugging

Si las optimizaciones no se activan:

1. **Verificar logs del servidor**:
   ```bash
   sudo journalctl -u codexwebdev -f | grep -i "token\|listen\|freeze"
   ```

2. **Verificar que tokenSaver.js se cargó correctamente**:
   ```bash
   grep -n "detectListenOnlyMode\|detectCommandContextFreeze" /root/CodexWeb/tokenSaver.js
   ```

3. **Revisar eventos SSE en el navegador**:
   - Abrir DevTools → Network → EventStream
   - Buscar evento `ts_stats`
   - Ver payload completo

4. **Inspeccionar mensajes en DB**:
   ```bash
   sqlite3 /root/CodexWeb/.runtime/dev/app.dev.db "SELECT * FROM token_saver_metrics ORDER BY created_at DESC LIMIT 5;"
   ```

## ✅ Criterios de Éxito

- [ ] Listen-Only Mode se activa con prompts de confirmación
- [ ] Command Context Freeze se activa durante comandos largos
- [ ] Ahorro de tokens ≥ 85% en Listen-Only
- [ ] Ahorro de tokens ≥ 70% en Command Freeze
- [ ] No hay regresiones en funcionalidad normal
- [ ] El indicador de Token Saver en UI muestra datos correctos

## 🚀 Benchmarks Automatizados

Para ejecutar los benchmarks offline:

```bash
cd /root/CodexWeb
node test-token-savings.js
```

Este script compara:
- Sin optimización vs. con optimización
- Listen-Only vs. optimización tradicional
- Command Freeze vs. optimización tradicional
- Escenarios combinados

## 📝 Notas

- Las optimizaciones son **no-destructivas**: si fallan, caen back a optimización tradicional
- Los prompts ambiguos (ej: "ok, pero antes explícame X") NO deberían activar Listen-Only
- Los comandos cortos (ej: `ls`) NO deberían activar Command Freeze
- El modo "Off" debe deshabilitar TODAS las optimizaciones

---

**Fecha de implementación**: 2026-06-26  
**Autor**: rogercs99  
**Versión tokenSaver**: 1.0.0
