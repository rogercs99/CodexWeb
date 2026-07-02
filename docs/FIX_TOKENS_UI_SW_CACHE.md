# Fix: Tokens no aparecen en UI de DEV — Service Worker cache-first

**Fecha**: 2026-06-29 13:30
**Commit**: 4525dc9
**Entorno**: DEV (codexwebdev.gamemodai.pro)
**Severidad**: Alta — feature completa bloqueada por caché frontend

---

## Síntoma reportado
Usuario reporta que los tokens (input/output/cost) **NO aparecen** en la UI de DEV, a pesar de múltiples reinicios del servicio, rebuilds del frontend y verificaciones de código.

---

## Diagnóstico técnico (protocolo completo)

### 1. Verificación de datos (DB)
```bash
sqlite3 .runtime/dev/app.dev.db \
  "SELECT id, role, input_tokens, output_tokens, total_cost 
   FROM messages WHERE conversation_id=70 ORDER BY id DESC LIMIT 3;"
```
**Resultado**: ✅ Los tokens **SÍ están guardados** en DB
```
537|assistant|1|30|0.000453
536|user|1|0|0.0
535|assistant|1|15|0.000228
```

### 2. Verificación de API (backend)
```bash
# SELECT statement en server.js:12801-12806
SELECT id, role, content, created_at, 
       tokens_before, tokens_after, tokens_saved, savings_percent, 
       input_tokens, output_tokens, total_cost
FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC
```
**Resultado**: ✅ El SELECT **incluye las columnas** de tokens

### 3. Verificación de código de renderizado (frontend)
```tsx
// ChatScreen.tsx:949-963
{message.input_tokens != null && message.input_tokens > 0 ? (
  <span className="ml-2 text-blue-400">
    • {message.input_tokens.toLocaleString('es-ES')} in
  </span>
) : null}
{message.output_tokens != null && message.output_tokens > 0 ? (
  <span className="ml-2 text-purple-400">
    • {message.output_tokens.toLocaleString('es-ES')} out
  </span>
) : null}
{message.total_cost != null && message.total_cost > 0 ? (
  <span className="ml-2 text-yellow-400">
    • ${message.total_cost.toFixed(4)}
  </span>
) : null}
```
**Resultado**: ✅ El código de renderizado **está correcto** desde 27/jun

### 4. Verificación de bundle servido
```bash
ls -lh .runtime/dev/public/assets/index-*.js
-rw-rw-r--+ 1 claude-codexweb claude-codexweb 778K Jun 29 13:23 index-LSiXPXz4.js

grep -o "input_tokens\|output_tokens\|total_cost" .runtime/dev/public/assets/index-LSiXPXz4.js | wc -l
9  # 3 campos × 3 referencias → código presente
```
**Resultado**: ✅ El bundle **SÍ contiene** el código de tokens

### 5. Verificación de cache headers (Express)
```js
// server.js:13724-13741
express.static(staticAssetsDir, {
  setHeaders: (res, filePath) => {
    if (!isDevDeployment) return;
    if (/\/assets\/.+\.(?:js|css|map)$/i.test(safePath)) {
      setFrontendNoStore(res);  // Cache-Control: no-store
    }
  }
})
```
**Resultado**: ✅ Express **NO cachea** los assets en DEV

---

## Causa raíz: Service Worker cache-first

```js
// .runtime/dev/public/sw.js:2
const CACHE = 'codexweb-v2-20260625';  // ← 25 de junio, ANTES del fix de tokens

// sw.js:37-48
if (/\/assets\/index-[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname)) {
  e.respondWith(
    caches.match(e.request).then(
      (cached) => cached || fetch(e.request).then(...)  // ← CACHE-FIRST
    )
  );
}
```

**El Service Worker**:
1. **Cachea** todos los assets (`/assets/index-*.js`)
2. Usa estrategia **cache-first**: devuelve versión cacheada si existe
3. Ignora los headers `Cache-Control: no-store` del servidor
4. La versión cacheada es del **25 de junio** (antes del código de tokens)
5. El navegador **nunca pedía** el bundle actualizado al servidor

---

## Solución aplicada

```diff
- const CACHE = 'codexweb-v2-20260625';
+ const CACHE = 'codexweb-v3-20260629';
```

**Efecto**:
- El evento `activate` del SW elimina cachés viejas: `keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))`
- El navegador descarga **automáticamente** el nuevo SW al detectar cambio en `/sw.js`
- Los assets cacheados se invalidan
- El próximo `fetch` descarga el bundle actualizado

**Archivos modificados**:
- `stitch_frontend/public/sw.js` (source)
- `.runtime/dev/public/sw.js` (servido, se regenera en build)

---

## Verificación post-fix

### Paso 1: Usuario debe hacer hard refresh
```
Chrome/Edge: Ctrl+Shift+R o Cmd+Shift+R
Firefox: Ctrl+F5
Safari: Cmd+Option+E → Cmd+R
```

### Paso 2: Verificar que el SW se actualizó
1. Abrir DevTools → Application → Service Workers
2. Ver versión: `codexweb-v3-20260629` (nueva)
3. Cache Storage debe mostrar solo `codexweb-v3-20260629`

### Paso 3: Verificar tokens en UI
Enviar un mensaje nuevo → el asistente debe mostrar:
```
13:30
• 234 in • 1,456 out • $0.0234
```

### Paso 4: Verificar Network (opcional)
1. DevTools → Network → recargar
2. `index-LSiXPXz4.js` debe venir del servidor (no de SW cache)
3. Response headers **no deben tener** `X-Cache: HIT`

---

## Estado final del sistema

| Componente | Estado | Evidencia |
|------------|--------|-----------|
| **DB** | ✅ Guarda tokens | `SELECT` muestra input/output/cost |
| **Backend** | ✅ Devuelve tokens | SELECT statement incluye columnas |
| **Frontend (código)** | ✅ Renderiza tokens | Código presente desde 27/jun |
| **Frontend (bundle)** | ✅ Compilado | index-LSiXPXz4.js contiene código |
| **Service Worker** | ✅ Invalidado | Cache v3-20260629 |
| **Servicio DEV** | ✅ Activo | Reiniciado 13:30, sirviendo SW nuevo |

---

## Mensajes de prueba verificables

```sql
-- Conversación 70 ("Hola")
SELECT id, role, substr(content,1,40), input_tokens, output_tokens, total_cost 
FROM messages WHERE conversation_id = 70 ORDER BY id DESC LIMIT 3;

537|assistant|¡Hola! 😊 Parece que estamos en un bucle|1|30|0.000453
536|user|Hola|1|0|0.0
535|assistant|¡Hola de nuevo! 👋 ¿En qué te puedo ayud|1|15|0.000228
```

**Estos mensajes DEBEN mostrar tokens en la UI tras el hard refresh.**

---

## Lecciones aprendidas

1. **Service Workers ignoran headers HTTP de cache** → verificar siempre la estrategia de fetch del SW
2. **Content-hash no garantiza actualizaciones** si el código no cambia → el bundle `index-LSiXPXz4.js` tenía el mismo hash desde el 27/jun
3. **Reinicios del backend NO invalidan cache frontend** → el problema no era del servidor
4. **DevTools Application tab es crítico** para debug de PWA/SW
5. **Hard refresh del usuario es mandatorio** tras cambios de SW

---

## Comandos de emergencia

```bash
# Forzar invalidación total de SW (desarrollo)
rm -f .runtime/dev/public/sw.js
systemctl restart codexwebdev.service

# Ver estado del servicio
journalctl -u codexwebdev.service --since "13:30" --no-pager | tail -50

# Ver tokens en DB
sqlite3 .runtime/dev/app.dev.db \
  "SELECT id, role, input_tokens, output_tokens FROM messages 
   WHERE conversation_id = (SELECT id FROM conversations ORDER BY id DESC LIMIT 1) 
   ORDER BY id DESC LIMIT 5;"

# Grep código de tokens en bundle
grep -o 'input_tokens.*output_tokens' .runtime/dev/public/assets/index-*.js | head -1
```

---

## Commit final
```
4525dc9 fix(frontend): invalidate Service Worker cache para mostrar tokens
```

**Cambios persistentes**: Solo `stitch_frontend/public/sw.js` (1 línea)
**Despliegue**: Reinicio de `codexwebdev.service` completado 13:30
**Rollback**: `git revert 4525dc9` + restart (no recomendado, el fix es correcto)

---

**Fin del diagnóstico técnico.**
