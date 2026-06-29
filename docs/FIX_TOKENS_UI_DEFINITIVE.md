# Fix Definitivo: Tokens no aparecían en UI de CodexWeb DEV

**Fecha**: 2026-06-29
**Commit**: (pendiente)

## Problema

Los mensajes del asistente en DEV no mostraban el contador de tokens (input/output/cost) aunque:
- La DB tenía los valores guardados correctamente
- El backend enviaba los campos en la API
- El frontend tenía código de renderizado

## Causa raíz

**Archivo**: `stitch_frontend/src/lib/api.ts`, líneas 660-669

El frontend normalizaba los mensajes recibidos de la API reconstruyendo el objeto manualmente, pero **omitía** los campos de tokens:

```typescript
// ANTES (bug)
return {
  id: Number(entry?.id) || 0,
  role: ...,
  content: String(entry?.content || ''),
  created_at: String(entry?.created_at || ''),
  attachments: attachments.filter(...)
} as Message;  // <-- FALTABAN: input_tokens, output_tokens, total_cost, etc.
```

## Solución

Agregar los campos de tokens a la normalización:

```typescript
// DESPUÉS (fix)
return {
  id: Number(entry?.id) || 0,
  role: ...,
  content: String(entry?.content || ''),
  created_at: String(entry?.created_at || ''),
  attachments: attachments.filter(...),
  tokens_before: entry?.tokens_before != null ? Number(entry.tokens_before) : null,
  tokens_after: entry?.tokens_after != null ? Number(entry.tokens_after) : null,
  tokens_saved: entry?.tokens_saved != null ? Number(entry.tokens_saved) : null,
  savings_percent: entry?.savings_percent != null ? Number(entry.savings_percent) : null,
  input_tokens: entry?.input_tokens != null ? Number(entry.input_tokens) : null,
  output_tokens: entry?.output_tokens != null ? Number(entry.output_tokens) : null,
  total_cost: entry?.total_cost != null ? Number(entry.total_cost) : null
} as Message;
```

## Verificación

1. **DB tiene datos**:
   ```sql
   SELECT id, input_tokens, output_tokens, total_cost FROM messages WHERE role='assistant' ORDER BY id DESC LIMIT 1;
   -- id=540, input_tokens=1, output_tokens=139, total_cost=0.0005568
   ```

2. **API devuelve datos** (verificado con endpoint debug temporal)

3. **Bundle compilado incluye campos** (verificado con grep en index-*.js)

4. **SW actualizado a v4** para forzar cache bust

## Estado final

- Servicio: `codexwebdev.service` activo
- Bundle: `index-Dl3YcFoI.js` (2026-06-29 17:55)
- SW: `codexweb-v4-20260629-fix`
- Código debug: eliminado

## Pasos para verificar en navegador

1. Abrir `https://codexwebdev.gamemodai.pro`
2. Hard refresh: `Ctrl+Shift+R`
3. DevTools → Application → Service Workers: debe decir `codexweb-v4-20260629-fix`
4. Enviar mensaje nuevo
5. El mensaje del asistente debe mostrar: `• X in • Y out • $Z.ZZZZ`

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `stitch_frontend/src/lib/api.ts` | Agregar campos de tokens a normalización |
| `.runtime/dev/public/assets/index-Dl3YcFoI.js` | Bundle compilado |
| `.runtime/dev/public/sw.js` | Versión v4 para cache bust |
