#!/usr/bin/env node
'use strict';

/**
 * test-token-live.js
 * Prueba en vivo del ahorro de tokens consultando métricas reales desde la BD
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '.runtime/dev/app.dev.db');

function main() {
  console.log('\n🔍 CodexWeb Token Saver - Análisis de Métricas Reales');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let db;
  try {
    db = new Database(dbPath, { readonly: true });

    // Verificar que existe la tabla de métricas
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='token_saver_metrics'
    `).get();

    if (!tableExists) {
      console.log('❌ Tabla token_saver_metrics no existe en la BD');
      console.log('   Necesitas ejecutar chats con TokenSaver habilitado primero.\n');
      process.exit(1);
    }

    // Obtener estadísticas generales
    const globalStats = db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        SUM(estimated_tokens_before) as total_tokens_before,
        SUM(estimated_tokens_after) as total_tokens_after,
        SUM(estimated_savings) as total_savings,
        AVG(estimated_savings) as avg_savings_per_request,
        MAX(created_at) as last_request_at
      FROM token_saver_metrics
    `).get();

    if (!globalStats || globalStats.total_requests === 0) {
      console.log('❌ No hay métricas registradas aún');
      console.log('   Ejecuta algunos chats con TokenSaver habilitado.\n');
      process.exit(0);
    }

    const savingsPercent = globalStats.total_tokens_before > 0
      ? Math.round((globalStats.total_savings / globalStats.total_tokens_before) * 100)
      : 0;

    console.log('📊 ESTADÍSTICAS GLOBALES');
    console.log('─'.repeat(60));
    console.log(`Total de peticiones: ${globalStats.total_requests}`);
    console.log(`Tokens antes:        ${globalStats.total_tokens_before.toLocaleString()}`);
    console.log(`Tokens después:      ${globalStats.total_tokens_after.toLocaleString()}`);
    console.log(`Tokens ahorrados:    ${globalStats.total_savings.toLocaleString()} (${savingsPercent}%)`);
    console.log(`Ahorro promedio:     ${Math.round(globalStats.avg_savings_per_request)} tokens/request`);
    console.log(`Última petición:     ${globalStats.last_request_at}`);

    // Obtener distribución por tipo de optimización
    console.log('\n\n📈 DISTRIBUCIÓN POR TIPO DE OPTIMIZACIÓN');
    console.log('─'.repeat(60));

    const typeStats = db.prepare(`
      SELECT
        json_extract(sections_json, '$.type') as optimization_type,
        COUNT(*) as count,
        SUM(estimated_tokens_before) as tokens_before,
        SUM(estimated_tokens_after) as tokens_after,
        SUM(estimated_savings) as savings,
        AVG(estimated_savings) as avg_savings
      FROM token_saver_metrics
      WHERE json_extract(sections_json, '$.type') IS NOT NULL
      GROUP BY optimization_type
      ORDER BY count DESC
    `).all();

    if (typeStats.length === 0) {
      console.log('(Sin datos de tipo de optimización)\n');
    } else {
      typeStats.forEach(stat => {
        const savingsPct = stat.tokens_before > 0
          ? Math.round((stat.savings / stat.tokens_before) * 100)
          : 0;
        console.log(`\n${stat.optimization_type || 'unknown'}:`);
        console.log(`  Peticiones:  ${stat.count}`);
        console.log(`  Tokens ahorrados: ${stat.savings.toLocaleString()} (${savingsPct}%)`);
        console.log(`  Ahorro promedio:  ${Math.round(stat.avg_savings)} tokens/request`);
      });
    }

    // Buscar específicamente Command Freeze y Listen-Only
    console.log('\n\n🎯 ESTRATEGIAS NUEVAS (Command Freeze + Listen-Only)');
    console.log('─'.repeat(60));

    const commandFreezeCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM token_saver_metrics
      WHERE json_extract(sections_json, '$.type') = 'command-freeze'
    `).get();

    const listenOnlyCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM token_saver_metrics
      WHERE json_extract(sections_json, '$.type') = 'listen-only'
    `).get();

    console.log(`Command Context Freeze: ${commandFreezeCount.count} activaciones`);
    console.log(`Listen-Only Mode:       ${listenOnlyCount.count} activaciones`);

    if (commandFreezeCount.count > 0) {
      const cfStats = db.prepare(`
        SELECT
          AVG(estimated_savings) as avg_savings,
          AVG(CAST(estimated_savings AS REAL) / NULLIF(estimated_tokens_before, 0) * 100) as avg_savings_pct,
          MAX(estimated_savings) as max_savings
        FROM token_saver_metrics
        WHERE json_extract(sections_json, '$.type') = 'command-freeze'
      `).get();
      console.log(`  → Ahorro promedio: ${Math.round(cfStats.avg_savings)} tokens (${Math.round(cfStats.avg_savings_pct)}%)`);
      console.log(`  → Ahorro máximo:   ${cfStats.max_savings} tokens`);
    }

    if (listenOnlyCount.count > 0) {
      const loStats = db.prepare(`
        SELECT
          AVG(estimated_savings) as avg_savings,
          AVG(CAST(estimated_savings AS REAL) / NULLIF(estimated_tokens_before, 0) * 100) as avg_savings_pct,
          MAX(estimated_savings) as max_savings
        FROM token_saver_metrics
        WHERE json_extract(sections_json, '$.type') = 'listen-only'
      `).get();
      console.log(`  → Ahorro promedio: ${Math.round(loStats.avg_savings)} tokens (${Math.round(loStats.avg_savings_pct)}%)`);
      console.log(`  → Ahorro máximo:   ${loStats.max_savings} tokens`);
    }

    // Top 10 peticiones con mayor ahorro
    console.log('\n\n🏆 TOP 10 PETICIONES CON MAYOR AHORRO');
    console.log('─'.repeat(60));

    const topSavings = db.prepare(`
      SELECT
        id,
        conversation_id,
        estimated_savings,
        estimated_tokens_before,
        json_extract(sections_json, '$.type') as type,
        created_at
      FROM token_saver_metrics
      ORDER BY estimated_savings DESC
      LIMIT 10
    `).all();

    topSavings.forEach((record, idx) => {
      const pct = record.estimated_tokens_before > 0
        ? Math.round((record.estimated_savings / record.estimated_tokens_before) * 100)
        : 0;
      console.log(`\n${idx + 1}. Conversación #${record.conversation_id || 'N/A'}`);
      console.log(`   Tipo: ${record.type || 'unknown'}`);
      console.log(`   Ahorro: ${record.estimated_savings} tokens (${pct}%)`);
      console.log(`   Fecha: ${record.created_at}`);
    });

    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Análisis completado\n');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  } finally {
    if (db) db.close();
  }
}

main();
