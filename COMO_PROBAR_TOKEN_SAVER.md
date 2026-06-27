# Cómo Probar las Nuevas Estrategias de Token Saver

## 🎯 Objetivo

Verificar el ahorro real de las dos nuevas estrategias implementadas:
1. **Command Context Freeze** - Ahorro durante comandos largos
2. **Listen-Only Mode** - Ahorro en confirmaciones simples

---

## ✅ Estado Actual

- ✅ **Implementadas** en `tokenSaver.js`
- ✅ **Activas** en `codexwebdev` (reiniciado 2026-06-27 02:48)
- ✅ **Tests sintéticos** pasando con ~81% de ahorro en Listen-Only
- ⏳ **Activaciones reales** pendientes (0 hasta ahora)

---

## 🧪 Método 1: Tests Sintéticos (Ya completado)

```bash
cd /root/CodexWeb
node test-token-strategies.js
```

**Resultado esperado**: Ver comparativas de ahorro para ambas estrategias.

**Estado**: ✅ Completado, resultados en `TOKEN_SAVER_NUEVAS_ESTRATEGIAS.md`

---

## 🧪 Método 2: Prueba en Chat Real

### Paso 1: Abrir chat en dev

Ir a: https://codexwebdev.gamemodai.pro

### Paso 2: Activar Command Context Freeze

**Escenario A - npm install:**

```
Usuario: "Ejecuta npm install en el proyecto"
[Esperar respuesta del asistente con output largo]
Usuario: "ok"  ← Esto activará AMBAS estrategias en secuencia
```

**Escenario B - git clone:**

```
Usuario: "Clona este repositorio: https://github.com/nodejs/node"
[Esperar respuesta con output del git clone]
Usuario: "sigue"  ← Listen-Only Mode
```

**Escenario C - build largo:**

```
Usuario: "Ejecuta npm run build"
[Esperar respuesta]
Usuario: "👍"  ← Listen-Only Mode (emoji)
```

### Paso 3: Activar Listen-Only Mode

Después de cualquier respuesta larga del asistente, responder con:

- `ok`
- `sigue`
- `continúa` (con o sin tilde)
- `adelante`
- `hazlo`
- `aplícalo`
- `impleméntalo`
- `👍` (emoji thumbs up)
- `✓` (checkmark)

### Paso 4: Verificar activación

```bash
cd /root/CodexWeb
node test-token-live.js
```

Buscar la sección:

```
🎯 ESTRATEGIAS NUEVAS (Command Freeze + Listen-Only)
────────────────────────────────────────────────────
Command Context Freeze: X activaciones
Listen-Only Mode:       Y activaciones
```

Si X > 0 o Y > 0, **¡la estrategia se activó!**

---

## 🧪 Método 3: Análisis de Métricas Reales

### Ver estadísticas globales

```bash
node test-token-live.js
```

**Output esperado**:

- Total de peticiones
- Tokens ahorrados globalmente
- Distribución por tipo de optimización
- Top 10 peticiones con mayor ahorro

### Ver métricas en tiempo real

```bash
# Ejecutar ANTES de hacer el chat de prueba
node test-token-live.js > antes.txt

# Hacer el chat de prueba (Método 2)

# Ejecutar DESPUÉS
node test-token-live.js > despues.txt

# Comparar
diff antes.txt despues.txt
```

---

## 📊 Qué Esperar

### Command Context Freeze

**Indicador de éxito**: Ver en métricas

```
Command Context Freeze: 1 activaciones
  → Ahorro promedio: ~2000 tokens (70-90%)
```

**Se activará cuando** el último mensaje del asistente contenga:
- `npm install` / `npm run build`
- `git clone`
- `docker build`
- `yarn install` / `yarn build`
- `downloading`
- `installing packages`

### Listen-Only Mode

**Indicador de éxito**: Ver en métricas

```
Listen-Only Mode: 1 activaciones
  → Ahorro promedio: ~150 tokens (80-90%)
```

**Se activará cuando** el usuario responda exactamente:
- `ok`, `vale`, `bien`, `entendido`, `claro`
- `sí`, `yes`, `y`
- `adelante`, `continúa`, `sigue`, `procede`
- `hazlo`, `aplícalo`, `impleméntalo`, `ejecuta`
- `👍`, `✓`, `✔️`, `👌`

---

## 🐛 Troubleshooting

### "Las estrategias no se activan"

**Causa 1**: Prompt no matchea exactamente los patrones

❌ `Ok, perfecto` → No matchea (tiene más de una palabra)  
✅ `ok` → Matchea

❌ `continua por favor` → No matchea  
✅ `continúa` → Matchea

**Causa 2**: TokenSaver deshabilitado en el chat

- Verificar en Settings → Token Saver que el preset no sea `off`
- Preset recomendado: `aggressive`

**Causa 3**: El asistente no ejecutó un comando largo

- Command Freeze solo se activa si el **último mensaje del asistente** contiene patrones de comando
- No se activa por mensajes antiguos del historial

### "test-token-live.js da error"

**Error**: `SQLITE_CANTOPEN`

**Solución**: Verificar que existe la BD dev

```bash
ls -lh /root/CodexWeb/.runtime/dev/app.dev.db
```

**Error**: `token_saver_metrics no existe`

**Solución**: Hacer al menos 1 chat con TokenSaver habilitado para crear la tabla

---

## 📈 Métricas de Éxito

### Benchmark actual (sin nuevas estrategias activas)

```
Total de peticiones:    71
Tokens ahorrados:       152,799 (74%)
Ahorro promedio:        2,152 tokens/request
```

### Meta después de activar las nuevas estrategias

**Escenario conservador** (10% de prompts matchean):
- Ahorro total: **+10,500 tokens**
- % de ahorro global: **79%** (+5%)

**Escenario optimista** (30% de prompts matchean):
- Ahorro total: **+42,000 tokens**
- % de ahorro global: **94%** (+20%)

---

## 📝 Registro de Pruebas

Cuando hagas pruebas, documenta aquí:

### Prueba 1: [Fecha]

- **Escenario**: [Descripción]
- **Prompt gatillo**: [El prompt exacto usado]
- **Estrategia activada**: [ ] Command Freeze [ ] Listen-Only [ ] Ninguna
- **Ahorro observado**: [X tokens, Y%]
- **Notas**: [Observaciones]

### Prueba 2: [Fecha]

...

---

## 🚀 Próximos Pasos

1. ✅ Implementar estrategias
2. ✅ Crear tests sintéticos
3. ✅ Crear script de análisis de métricas
4. ✅ Documentar cómo probar
5. ⏳ **Ejecutar pruebas reales en dev** ← ESTÁS AQUÍ
6. ⏳ Documentar resultados reales
7. ⏳ Ajustar patrones si es necesario
8. ⏳ Replicar en producción

---

## 📚 Referencias

- Implementación: `tokenSaver.js` líneas 499-616
- Test sintético: `test-token-strategies.js`
- Análisis de métricas: `test-token-live.js`
- Documentación completa: `TOKEN_SAVER_NUEVAS_ESTRATEGIAS.md`

---

**Última actualización**: 2026-06-27 02:50 CEST  
**Estado del servicio dev**: ✅ Running (reiniciado con cambios aplicados)
