#!/bin/bash
#
# verify-token-optimizations.sh
# Verifica que las optimizaciones Listen-Only y Command Freeze estén activas en codexwebdev
#

set -euo pipefail

echo "🔍 Verificando optimizaciones de Token Saver en CodexWeb..."
echo ""

# 1. Verificar que tokenSaver.js contiene las nuevas funciones
echo "1️⃣ Verificando que tokenSaver.js tiene las funciones nuevas..."
if grep -q "detectListenOnlyMode" /root/CodexWeb/tokenSaver.js && \
   grep -q "detectCommandContextFreeze" /root/CodexWeb/tokenSaver.js && \
   grep -q "buildListenOnlyContext" /root/CodexWeb/tokenSaver.js && \
   grep -q "buildCommandFreezeContext" /root/CodexWeb/tokenSaver.js; then
  echo "   ✅ Funciones detectadas en tokenSaver.js"
else
  echo "   ❌ ERROR: Funciones faltantes en tokenSaver.js"
  exit 1
fi

# 2. Verificar que server.js envía los nuevos campos en ts_stats
echo ""
echo "2️⃣ Verificando que server.js envía campos extendidos en ts_stats..."
if grep -q "type: tsType" /root/CodexWeb/server.js && \
   grep -q "messagesBefore:" /root/CodexWeb/server.js && \
   grep -q "messagesAfter:" /root/CodexWeb/server.js; then
  echo "   ✅ server.js envía campos extendidos"
else
  echo "   ❌ ERROR: server.js no envía campos completos"
  exit 1
fi

# 3. Verificar que el servicio codexwebdev está corriendo
echo ""
echo "3️⃣ Verificando que codexwebdev está activo..."
if sudo systemctl is-active --quiet codexwebdev; then
  echo "   ✅ codexwebdev está corriendo"
  PID=$(sudo systemctl show -p MainPID codexwebdev | cut -d= -f2)
  echo "      PID: $PID"
else
  echo "   ❌ ERROR: codexwebdev no está corriendo"
  exit 1
fi

# 4. Ejecutar benchmarks
echo ""
echo "4️⃣ Ejecutando benchmarks automatizados..."
if node /root/CodexWeb/test-token-savings.js > /tmp/token-bench.log 2>&1; then
  echo "   ✅ Benchmarks ejecutados correctamente"
  echo ""
  echo "   📊 Resultados clave:"
  grep "Listen-Only Mode activado →" /tmp/token-bench.log || true
  grep "Command Context Freeze activado →" /tmp/token-bench.log || true
else
  echo "   ❌ ERROR: Benchmarks fallaron"
  cat /tmp/token-bench.log
  exit 1
fi

# 5. Verificar métricas en DB dev
echo ""
echo "5️⃣ Verificando métricas recientes en DB dev..."
RECENT_METRICS=$(sqlite3 /root/CodexWeb/.runtime/dev/app.dev.db \
  "SELECT COUNT(*) FROM token_saver_metrics WHERE created_at >= datetime('now', '-1 hour');" 2>/dev/null || echo "0")
echo "   📈 Métricas en última hora: $RECENT_METRICS"

if [ "$RECENT_METRICS" -gt 0 ]; then
  echo ""
  echo "   📋 Últimas 3 métricas guardadas:"
  sqlite3 /root/CodexWeb/.runtime/dev/app.dev.db \
    "SELECT
       datetime(created_at) as fecha,
       estimated_tokens_before as antes,
       estimated_tokens_after as despues,
       estimated_savings as ahorro,
       CAST((estimated_savings * 100.0 / estimated_tokens_before) AS INTEGER) as pct
     FROM token_saver_metrics
     ORDER BY created_at DESC
     LIMIT 3;" \
    -header -column 2>/dev/null || echo "   (sin datos recientes)"
fi

# 6. Verificar logs del servicio para ver si las optimizaciones se activaron
echo ""
echo "6️⃣ Buscando activaciones de optimizaciones en logs recientes..."
LISTEN_ONLY_HITS=$(sudo journalctl -u codexwebdev --since "1 hour ago" --no-pager 2>/dev/null | grep -c "listen-only activado" || echo "0")
COMMAND_FREEZE_HITS=$(sudo journalctl -u codexwebdev --since "1 hour ago" --no-pager 2>/dev/null | grep -c "command-freeze activado" || echo "0")

echo "   🎯 Listen-Only activado: $LISTEN_ONLY_HITS veces (última hora)"
echo "   🧊 Command Freeze activado: $COMMAND_FREEZE_HITS veces (última hora)"

# Resumen final
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ VERIFICACIÓN COMPLETA"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "✨ Las optimizaciones están implementadas y funcionando."
echo ""
echo "📝 Para probar manualmente:"
echo "   1. Abre https://codexwebdev.gamemodai.pro"
echo "   2. Inicia un chat y haz una pregunta técnica"
echo "   3. Responde solo 'ok' para activar Listen-Only Mode"
echo "   4. O pide ejecutar 'npm install' y responde 'continúa'"
echo ""
echo "🔍 Para ver logs en tiempo real:"
echo "   sudo journalctl -u codexwebdev -f | grep token-saver"
echo ""
echo "📊 Para ejecutar benchmarks de nuevo:"
echo "   node /root/CodexWeb/test-token-savings.js"
echo ""
