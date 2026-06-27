#!/usr/bin/env node
'use strict';

/**
 * Test completo de las 6 estrategias de ahorro de tokens
 * Compara tokens antes vs después para cada estrategia
 */

const tokenSaver = require('./tokenSaver.js');

// ─── Datos de prueba ──────────────────────────────────────────────────────────

const projectContextMessage = {
  role: 'system',
  content: `# PROJECT_CONTEXT.md — CodexWeb

## Proyecto
CodexWeb — Chat UI para agentes IA (Codex CLI, Claude Code).

## Stack técnico
- Backend: Node.js, Express, SQLite
- Frontend: React 18, TypeScript, Vite
- Agentes IA: Codex CLI, Claude Code

## Estructura principal
/root/CodexWeb/
  server.js
  tokenSaver.js
  stitch_frontend/
    src/components/
    dist/`
};

const reasoningMessage = {
  role: 'assistant',
  content: `Analizando la petición del usuario:

<think>
Primero debo considerar las siguientes opciones:
1. Implementar la estrategia directamente en el código existente
2. Crear un módulo separado para mayor modularidad
3. Integrar gradualmente con tests intermedios

Evaluando pros y contras:
- Opción 1: Más rápido pero menos mantenible
- Opción 2: Más limpio pero requiere refactor
- Opción 3: Balance entre velocidad y calidad

Considerando el contexto del proyecto y las restricciones de tiempo,
la opción 3 parece la más razonable. El código actual ya tiene buena
estructura modular en tokenSaver.js, así que podemos extenderlo.

Decisión final: Implementar en tokenSaver.js con tests incrementales.
Plan de acción:
1. Añadir funciones de detección
2. Añadir funciones de compresión
3. Integrar en buildOptimizedContext
4. Crear tests de validación
</think>

Voy a implementar las estrategias en tokenSaver.js siguiendo un enfoque incremental.`
};

const diffMessage = {
  role: 'assistant',
  content: `Aquí está el diff de los cambios:

diff --git a/tokenSaver.js b/tokenSaver.js
index a1b2c3d..e4f5g6h 100644
--- a/tokenSaver.js
+++ b/tokenSaver.js
@@ -10,6 +10,8 @@
 const TOKEN_SAVER_VERSION = '1.0.0';

 // ─── Presets ─────────────────────────────────────────────────────────────────
+// New comment explaining presets
+// This section defines the optimization levels

 const PRESETS = {
   off: {
@@ -50,7 +52,10 @@
     enabled: true,
     mode: 'aggressive',
-    recentMessagesCount: 12,
+    recentMessagesCount: 15,
     recentMessagesMaxChars: 12000,
+    // Added new compression settings
+    diffCompressionEnabled: true,
+    maxDiffLines: 50,
     maxContextTokens: 6000,

Los cambios principales son:
- Incremento de recentMessagesCount de 12 a 15
- Añadida configuración de compresión de diffs
- Nuevos comentarios explicativos`
};

const longCommandMessage = {
  role: 'assistant',
  content: `Ejecutando npm install en el proyecto:

\`\`\`bash
npm install
\`\`\`

Downloading packages...
Installing dependencies...
Building native extensions...
[========================================] 100%`
};

// ─── Tests de cada estrategia ────────────────────────────────────────────────

function testStrategy(name, messages, currentPrompt, expectedType) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 Test: ${name}`);
  console.log('='.repeat(80));

  const settings = { ...tokenSaver.PRESETS.aggressive };
  const result = tokenSaver.buildOptimizedContext(messages, settings, currentPrompt);

  const tokensBefore = result.estimatedTokensBefore;
  const tokensAfter = result.estimatedTokensAfter;
  const savings = result.estimatedSavings;
  const savingsPercent = result.savingsPercent;

  console.log(`📊 Resultados:`);
  console.log(`   Tokens antes:     ${tokensBefore}`);
  console.log(`   Tokens después:   ${tokensAfter}`);
  console.log(`   Ahorro:           ${savings} tokens (${savingsPercent}%)`);
  console.log(`   Tipo:             ${result.sections.type}`);
  console.log(`   Mensajes:         ${result.sections.totalMessages} → ${result.sections.messageCount}`);

  const matched = result.sections.type === expectedType;
  console.log(`   ✅ Tipo esperado: ${matched ? 'SÍ' : 'NO (esperaba ' + expectedType + ')'}`);

  return {
    name,
    tokensBefore,
    tokensAfter,
    savings,
    savingsPercent,
    type: result.sections.type,
    matched
  };
}

// ─── Ejecución de tests ──────────────────────────────────────────────────────

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║        TEST COMPLETO DE ESTRATEGIAS DE AHORRO DE TOKENS                   ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

const results = [];

// Test 1: Listen-Only Mode
const listenOnlyMessages = [
  { role: 'user', content: 'Implementa las nuevas estrategias en tokenSaver.js' },
  { role: 'assistant', content: 'Voy a implementar las 4 estrategias restantes en tokenSaver.js. Primero leeré el archivo actual...' },
  { role: 'assistant', content: 'He implementado las estrategias. ¿Quieres que continúe con los tests?' }
];
results.push(testStrategy(
  'Listen-Only Mode',
  listenOnlyMessages,
  'sigue',
  'listen-only'
));

// Test 2: Command Context Freeze
const commandMessages = [
  { role: 'user', content: 'Instala las dependencias del proyecto' },
  { role: 'assistant', content: longCommandMessage.content }
];
results.push(testStrategy(
  'Command Context Freeze',
  commandMessages,
  'esperando...',
  'command-freeze'
));

// Test 3: Reasoning Chain Transfer
const reasoningMessages = [
  { role: 'user', content: '¿Cuál es la mejor forma de implementar esto?' },
  reasoningMessage
];
results.push(testStrategy(
  'Reasoning Chain Transfer',
  reasoningMessages,
  'Implementa el plan',
  'optimized'
));

// Test 4: Diff-Based Compression
const diffMessages = [
  { role: 'user', content: 'Muéstrame los cambios' },
  diffMessage
];
results.push(testStrategy(
  'Diff-Based Compression',
  diffMessages,
  '¿Hay algo más?',
  'optimized'
));

// Test 5: Immutable Project Cache
const projectCacheMessages = [
  projectContextMessage,
  { role: 'user', content: '¿Cuál es el stack del proyecto?' },
  { role: 'assistant', content: 'El proyecto usa Node.js, Express y React.' }
];
const cacheKey = tokenSaver.getCachedProjectContext(projectCacheMessages, '/root/CodexWeb');
console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 Test: Immutable Project Cache`);
console.log('='.repeat(80));
console.log(`📊 Resultados:`);
console.log(`   Contexto cacheado: ${cacheKey ? 'SÍ' : 'NO'}`);
console.log(`   Tamaño caché:      ${cacheKey ? cacheKey.length : 0} chars`);
console.log(`   ✅ Cache funciona: ${cacheKey ? 'SÍ' : 'NO'}`);

results.push({
  name: 'Immutable Project Cache',
  tokensBefore: 0,
  tokensAfter: 0,
  savings: 0,
  savingsPercent: 0,
  type: 'cache',
  matched: !!cacheKey
});

// Test 6: Context-Free Streaming
const streamingSettings = { ...tokenSaver.PRESETS.aggressive, streamingEnabled: true };
const streamingMessages = [
  { role: 'user', content: 'Genera una respuesta larga con muchos detalles técnicos sobre la arquitectura del sistema...' },
  { role: 'assistant', content: 'La arquitectura consta de...' }
];
console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 Test: Context-Free Streaming`);
console.log('='.repeat(80));
const streamResult = tokenSaver.buildOptimizedContext(streamingMessages, streamingSettings, 'Continúa');
console.log(`📊 Resultados:`);
console.log(`   Tokens antes:     ${streamResult.estimatedTokensBefore}`);
console.log(`   Tokens después:   ${streamResult.estimatedTokensAfter}`);
console.log(`   Ahorro:           ${streamResult.estimatedSavings} tokens (${streamResult.savingsPercent}%)`);
console.log(`   Tipo:             ${streamResult.sections.type}`);
console.log(`   ✅ Tipo esperado: ${streamResult.sections.type === 'streaming' ? 'SÍ' : 'NO'}`);

results.push({
  name: 'Context-Free Streaming',
  tokensBefore: streamResult.estimatedTokensBefore,
  tokensAfter: streamResult.estimatedTokensAfter,
  savings: streamResult.estimatedSavings,
  savingsPercent: streamResult.savingsPercent,
  type: streamResult.sections.type,
  matched: streamResult.sections.type === 'streaming'
});

// ─── Resumen final ────────────────────────────────────────────────────────────

console.log('\n\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║                           RESUMEN DE TESTS                                ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const totalTests = results.length;
const passedTests = results.filter(r => r.matched).length;
const totalSavings = results.reduce((sum, r) => sum + r.savings, 0);
const avgSavings = totalTests > 0 ? Math.round(totalSavings / totalTests) : 0;

console.log('┌───────────────────────────────────────────────────────────────────────────┐');
console.log('│ Estrategia                      │ Ahorro  │ %    │ Match │ Estado       │');
console.log('├───────────────────────────────────────────────────────────────────────────┤');

results.forEach(r => {
  const name = r.name.padEnd(31);
  const savings = String(r.savings).padStart(6);
  const percent = String(r.savingsPercent).padStart(3);
  const match = r.matched ? '  ✅  ' : '  ❌  ';
  const status = r.matched ? '✅ PASS     ' : '❌ FAIL     ';
  console.log(`│ ${name} │ ${savings} │ ${percent}% │ ${match} │ ${status} │`);
});

console.log('└───────────────────────────────────────────────────────────────────────────┘');

console.log(`\n📊 Estadísticas Globales:`);
console.log(`   Tests ejecutados:      ${totalTests}`);
console.log(`   Tests exitosos:        ${passedTests}/${totalTests} (${Math.round(passedTests/totalTests*100)}%)`);
console.log(`   Ahorro total:          ${totalSavings} tokens`);
console.log(`   Ahorro promedio:       ${avgSavings} tokens/estrategia`);

if (passedTests === totalTests) {
  console.log(`\n✅ TODOS LOS TESTS PASARON - Sistema listo para pruebas reales\n`);
} else {
  console.log(`\n⚠️  ${totalTests - passedTests} test(s) fallaron - Revisar implementación\n`);
}
