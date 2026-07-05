#!/usr/bin/env node
// Fake Codex CLI para tests de completitud de agentes
// Simula escenarios de respuestas incompletas y completas

const args = process.argv.slice(2);
const promptArg = args[args.length - 1] || '';

// Detectar scenario del prompt
const scenario = (function() {
  if (promptArg.includes('SCENARIO_REASONING_NO_FINAL')) return 'reasoning_no_final';
  if (promptArg.includes('SCENARIO_COMMAND_NO_FINAL')) return 'command_no_final';
  if (promptArg.includes('SCENARIO_FINAL_IN_CONTENT')) return 'final_in_content';
  if (promptArg.includes('SCENARIO_FINAL_WITH_SENTINELS')) return 'final_with_sentinels';
  if (promptArg.includes('SCENARIO_CONTINUATION')) return 'continuation';
  if (promptArg.includes('SCENARIO_EXHAUSTED')) return 'exhausted';
  return 'default';
})();

function emit(obj) {
  console.log(JSON.stringify(obj));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  emit({ type: 'thread.started', thread_id: 'test_thread_123' });
  emit({ type: 'turn.started' });

  if (scenario === 'reasoning_no_final') {
    // Razonamiento + comando pero sin mensaje final
    emit({
      type: 'item.started',
      item: { id: 'item_0', type: 'reasoning', text: 'Analizando el problema...' }
    });
    emit({
      type: 'item.completed',
      item: { id: 'item_0', type: 'reasoning', text: 'Analizando el problema... necesito ejecutar comando.' }
    });
    emit({
      type: 'item.started',
      item: { id: 'item_1', type: 'command_execution', command: '/bin/bash -lc pwd', status: 'in_progress' }
    });
    await sleep(50);
    emit({
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'command_execution',
        command: '/bin/bash -lc pwd',
        aggregated_output: '/tmp/test\n',
        exit_code: 0,
        status: 'completed'
      }
    });
    // NO emite agent_message final
  } else if (scenario === 'command_no_final') {
    // Comando pero agent_message vacío
    emit({
      type: 'item.started',
      item: { id: 'item_0', type: 'command_execution', command: '/bin/bash -lc ls', status: 'in_progress' }
    });
    await sleep(50);
    emit({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: '/bin/bash -lc ls',
        aggregated_output: 'file1.txt\nfile2.txt\n',
        exit_code: 0,
        status: 'completed'
      }
    });
    emit({
      type: 'item.completed',
      item: { id: 'item_1', type: 'agent_message', text: '' }
    });
  } else if (scenario === 'final_in_content') {
    // Final visible en item.content[] en vez de item.text
    emit({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'agent_message',
        content: [
          { type: 'text', text: 'Resultado del análisis:\n' },
          { type: 'text', text: 'Todo está correcto.' }
        ]
      }
    });
  } else if (scenario === 'final_with_sentinels') {
    // Final con marcadores CODEXWEB_FINAL_RESPONSE_*
    emit({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'agent_message',
        text: 'CODEXWEB_FINAL_RESPONSE_BEGIN\nLa tarea está completa.\nCODEXWEB_FINAL_RESPONSE_END'
      }
    });
  } else if (scenario === 'continuation') {
    // Simula que detecta continuación y ahora sí emite final
    if (promptArg.includes('CONTINUA LA EJECUCION ANTERIOR')) {
      emit({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'agent_message',
          text: 'CODEXWEB_FINAL_RESPONSE_BEGIN\nAhora sí, respuesta final completa.\nCODEXWEB_FINAL_RESPONSE_END'
        }
      });
    } else {
      // Primera ejecución sin final
      emit({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: 'Trabajando...' }
      });
    }
  } else if (scenario === 'exhausted') {
    // Simula muchos intentos sin final para agotar continuaciones
    emit({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'Sigo trabajando...' }
    });
  } else {
    // Default: respuesta simple completa
    emit({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'Hola, respuesta de prueba.' }
    });
  }

  emit({
    type: 'turn.completed',
    usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 50 }
  });
}

run().catch((err) => {
  console.error('Error in fake-codex-cli:', err);
  process.exit(1);
});
