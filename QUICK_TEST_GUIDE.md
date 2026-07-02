# Guía Rápida de Pruebas - Token Saver Optimizations

## 🚀 Prueba Rápida (2 minutos)

### Test Listen-Only Mode

1. **Abre codexwebdev**: https://codexwebdev.gamemodai.pro
2. **Crea un nuevo chat**
3. **Pregunta algo técnico largo**, por ejemplo:
   ```
   Explícame en detalle cómo funciona el sistema de Token Saver
   en CodexWeb, incluyendo todas las fases implementadas
   ```
4. **Espera la respuesta del asistente** (será larga)
5. **Responde solo**: `ok`
6. **Verifica en DevTools** (F12 → Network → EventStream):
   - Busca evento `ts_stats`
   - Debe mostrar: `percent: ≥ 85%`
   - Debe mostrar: `mode: "listen-only"`

**Resultado esperado**: El asistente responde brevemente sin repetir todo el contexto anterior.

---

### Test Command Context Freeze

1. **En el mismo chat** (ahora ya tienes ~10 mensajes)
2. **Pide ejecutar un comando largo**:
   ```
   Ejecuta npm install en /tmp para probar
   ```
3. **Cuando el asistente empiece a ejecutar**, responde: `continúa`
4. **Verifica en DevTools**:
   - `ts_stats.percent`: ≥ 70%
   - `ts_stats.mode`: "command-freeze"

**Resultado esperado**: Solo se envían los últimos 2 mensajes, todo el contexto anterior queda congelado.

---

## 🔍 Verificación Avanzada

### Ver logs en tiempo real

```bash
sudo journalctl -u codexwebdev -f | grep token-saver
```

Deberías ver líneas como:
```
[token-saver] listen-only activado: 88% ahorro (1292 tokens)
[token-saver] command-freeze activado: 97% ahorro (1467 tokens)
```

---

### Ver métricas en DB

```bash
sqlite3 /root/CodexWeb/.runtime/dev/app.dev.db <<EOF
SELECT
  datetime(created_at) as fecha,
  estimated_tokens_before as antes,
  estimated_tokens_after as despues,
  estimated_savings as ahorro,
  CAST((estimated_savings * 100.0 / estimated_tokens_before) AS INTEGER) as pct
FROM token_saver_metrics
ORDER BY created_at DESC
LIMIT 5;
EOF
```

---

### Ejecutar benchmarks automatizados

```bash
cd /root/CodexWeb
node test-token-savings.js
```

---

## 📊 Palabras Clave que Activan Listen-Only

✅ **Funcionan**:
- `ok`, `vale`, `bien`, `entendido`, `claro`
- `sí`, `yes`, `y`
- `adelante`, `continúa`, `sigue`, `procede`
- `hazlo`, `aplícalo`, `impleméntalo`, `ejecuta`
- `👍`, `✓`, `👌`

❌ **NO funcionan** (correcto, son ambiguos):
- `ok, pero antes explícame X`
- `sí, y también quiero Y`
- `continúa, aunque primero Z`

El sistema detecta cuando el prompt es SOLO una confirmación.

---

## 🔧 Comandos que Activan Command Freeze

✅ **Detectados**:
- `npm install`, `npm run build`, `npm run test`
- `git clone <url>`
- `yarn install`, `yarn build`
- `docker build`
- `mvn clean install`
- `cargo build`
- Cualquier output con: "executing command", "running build", "downloading"

❌ **NO detectados** (correcto, son muy rápidos):
- `ls`, `pwd`, `echo`
- `cat archivo.txt`
- Comandos cortos sin output largo

---

## 🎯 Indicadores de Éxito

Cuando las optimizaciones están activas, verás:

1. **En EventStream** (`ts_stats`):
   ```json
   {
     "savings": 1292,
     "before": 1623,
     "after": 184,
     "percent": 88,
     "mode": "listen-only",
     "type": "listen-only",
     "messagesBefore": 11,
     "messagesAfter": 1,
     "skipped": 10
   }
   ```

2. **En logs del servidor**:
   ```
   [token-saver] listen-only activado: 88% ahorro (1292 tokens)
   ```

3. **En respuesta del asistente**:
   - Más rápida (menos latencia)
   - Más breve (no repite contexto)
   - Directa al punto

---

## ⚙️ Desactivar (para comparar)

Si quieres verificar la diferencia CON vs SIN optimizaciones:

1. Ve a **Settings → Token Saver**
2. Cambia preset a **"Off"**
3. Repite las pruebas
4. **Resultado esperado**:
   - `ts_stats.percent`: 0%
   - Respuestas más lentas
   - Contexto completo siempre enviado

No olvides **volver a "Aggressive"** después.

---

## 🐛 Troubleshooting

### "No veo el evento ts_stats"
- Verifica que estés en codexwebdev (no en prod)
- Abre DevTools ANTES de enviar el mensaje
- Filtra por "ts_stats" en la pestaña EventStream

### "El ahorro es 0%"
- Verifica que el preset NO sea "Off"
- Asegúrate de escribir SOLO "ok" (sin más texto)
- Para Command Freeze, necesitas una conversación larga previa (10+ mensajes)

### "No se activa Command Freeze"
- Verifica que el último mensaje del asistente contenga un comando largo
- Escribe "continúa" justo después de que empiece a ejecutar
- Si el comando es muy rápido (ej: `ls`), no se activará

---

## ✅ Checklist Final

- [ ] Listen-Only se activa con "ok"
- [ ] Ahorro ≥ 85% en Listen-Only
- [ ] Command Freeze se activa durante npm install
- [ ] Ahorro ≥ 70% en Command Freeze
- [ ] Logs muestran activaciones
- [ ] DB guarda métricas correctamente
- [ ] Preset "Off" deshabilita todo
- [ ] Sin regresiones en funcionalidad normal

---

**Última actualización**: 2026-06-26  
**Versión**: 1.0.0
