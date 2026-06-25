# Flujo de despliegue CodexWeb

## ⚠️ IMPORTANTE: Prevención de regresiones

**Problema común**: Recompilar frontend sin las mejoras más recientes porque:
- Los cambios están en working tree sin commitear
- Se ejecutó `npm run build` desde código antiguo
- El script `deploy-dev-frontend.sh` copia ciegamente `dist/` sin verificar origen

**Solución**: Seguir siempre este orden.

---

## 📋 Checklist antes de desplegar

### 1. Verificar cambios en git
```bash
cd /root/CodexWeb
git status --short
```

Si hay cambios sin commitear (`M` o `??`):
- ✅ **Commitear primero** si son mejoras que quieres desplegar
- ❌ **NO recompilar** hasta después del commit

### 2. Commitear mejoras
```bash
git add -A
git commit -m "feat: descripción del cambio

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### 3. Compilar frontend
```bash
cd /root/CodexWeb/stitch_frontend
npm run build
```

**Verificar que el build incluya las mejoras**:
```bash
# Ejemplo: si añadiste audio, verifica que esté presente
grep -o 'SpeechRecognition' dist/assets/index-*.js | wc -l
# Debe ser > 0 si audio está implementado
```

### 4. Desplegar a dev
```bash
/root/CodexWeb/deploy/deploy-dev-frontend.sh
```

Esto crea backup automático en `.runtime/dev/public.bak.TIMESTAMP`

### 5. Reiniciar servicio
```bash
sudo systemctl restart codexwebdev.service
sudo systemctl status codexwebdev.service --no-pager -l
```

### 6. Verificar en navegador
```
https://codexwebdev.gamemodai.pro
```

Prueba las nuevas funcionalidades directamente.

---

## 🔄 Rollback rápido

Si el despliegue falló:

```bash
# Listar backups disponibles
ls -lt /root/CodexWeb/.runtime/dev/public.bak.*

# Restaurar último backup
LAST_BACKUP=$(ls -t /root/CodexWeb/.runtime/dev/public.bak.* | head -1)
rm -rf /root/CodexWeb/.runtime/dev/public
mv "$LAST_BACKUP" /root/CodexWeb/.runtime/dev/public

# Reiniciar servicio
sudo systemctl restart codexwebdev.service
```

---

## 📁 Estructura de builds

| Ubicación | Descripción | Cuándo se actualiza |
|-----------|-------------|---------------------|
| `stitch_frontend/dist/` | Build compilado | `npm run build` |
| `.runtime/dev/public/` | Frontend servido por dev | Script deploy |
| `public/` | Frontend servido por producción | Deploy manual a pro |

---

## 🚫 NO hacer

❌ **NO** ejecutar `npm run build` antes de commitear cambios importantes
❌ **NO** copiar `public/` (producción) a dev sin verificar contenido
❌ **NO** asumir que el hash del bundle indica contenido correcto — verificar siempre con `grep`
❌ **NO** desplegar a producción sin verificar primero en dev

---

## ✅ Hacer siempre

✅ **Commitear** → **Build** → **Verificar** → **Desplegar** → **Reiniciar** → **Probar**
✅ Verificar contenido del build con `grep` antes de desplegar
✅ Mantener backups automáticos (el script ya los hace)
✅ Documentar cambios significativos en commit message
✅ Probar en dev antes que en producción

---

## 🔍 Diagnóstico rápido

**Dev sirve versión antigua**:
```bash
# Verificar qué bundle está desplegado
ls -lh /root/CodexWeb/.runtime/dev/public/assets/index-*.js

# Comparar con producción
ls -lh /root/CodexWeb/public/assets/index-*.js

# Verificar contenido (ejemplo con audio)
grep -o 'SpeechRecognition' /root/CodexWeb/.runtime/dev/public/assets/index-*.js | wc -l
```

**Servicio no arranca**:
```bash
sudo systemctl status codexwebdev.service --no-pager -l
sudo journalctl -u codexwebdev.service -n 50 --no-pager
```

---

## 📝 Historial de despliegues

Mantener registro manual aquí de despliegues importantes:

### 2026-06-25 — Audio + Parseo mejorado + Terminal Live
- Commit: 60467ab
- Bundle: `index-SPWzApU-.js` (772K)
- Mejoras: Web Speech API, separación razonamiento/comandos/respuesta, panel Terminal Live
- Deploy: ✅ Dev operativo
