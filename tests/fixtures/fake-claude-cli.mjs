#!/usr/bin/env node
// Fake Claude Code CLI para tests de completitud de agentes
// Simula escenarios de respuestas incompletas y completas con formato stream-json

const args = process.argv.slice(2);
const promptArg = args[args.length - 1] || '';

// Detectar scenario del prompt
const scenario = (function() {
  if (promptArg.includes('SCENARIO_THINKING_NO_FINAL')) return 'thinking_no_final';
  if (promptArg.includes('SCENARIO_TOOL_USE_NO_FINAL')) return 'tool_use_no_final';
  if (promptArg.includes('SCENARIO_RESULT_STRING')) return 'result_string';
  if (promptArg.includes('SCENARIO_FINAL_WITH_SENTINELS')) return 'final_with_sentinels';
  if (promptArg.includes('SCENARIO_CONTINUATION')) return 'continuation';
  if (promptArg.includes('SCENARIO_IS_ERROR_TRUE')) return 'is_error_true';
  return 'default';
})();

function emit(obj) {
  console.log(JSON.stringify(obj));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  emit({ type: 'system', subtype: 'init', version: '1.0.0-test' });
  emit({ type: 'system', subtype: 'status', status: 'processing' });

  if (scenario === 'thinking_no_final') {
    // Thinking + tool_use pero sin respuesta final
    emit({
      type: 'assistant',
      message: {
        id: 'msg_test_1',
        content: [
          { type: 'thinking', text: 'Analizando la solicitud del usuario...' },
          { type: 'tool_use', id: 'tool_1', name: 'bash', input: { command: 'pwd' } }
        ]
      }
    });
    await sleep(50);
    emit({
      type: 'tool_result',
      tool_use_id: 'tool_1',
      result: '/tmp/test\n',
      exit_code: 0
    });
    // NO emite respuesta final visible
  } else if (scenario === 'tool_use_no_final') {
    // Tool use completo pero sin mensaje final de texto
    emit({
      type: 'assistant',
      message: {
        id: 'msg_test_1',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'bash', input: { command: 'ls' } }]
      }
    });
    await sleep(50);
    emit({
      type: 'tool_result',
      tool_use_id: 'tool_1',
      result: 'file1.txt\nfile2.txt\n',
      exit_code: 0
    });
  } else if (scenario === 'result_string') {
    // Final en result.result como string
    emit({
      type: 'assistant',
      message: {
        id: 'msg_test_1',
        content: [{ type: 'text', text: 'Analizando' }]
      }
    });
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Análisis completo: todo OK.'
    });
  } else if (scenario === 'final_with_sentinels') {
    // Final con marcadores CODEXWEB_FINAL_RESPONSE_*
    emit({
      type: 'assistant',
      message: {
        id: 'msg_test_1',
        content: [
          {
            type: 'text',
            text: 'CODEXWEB_FINAL_RESPONSE_BEGIN\nTarea completa según lo solicitado.\nCODEXWEB_FINAL_RESPONSE_END'
          }
        ]
      }
    });
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'CODEXWEB_FINAL_RESPONSE_BEGIN\nTarea completa según lo solicitado.\nCODEXWEB_FINAL_RESPONSE_END'
    });
  } else if (scenario === 'continuation') {
    // Simula que detecta continuación y ahora sí emite final
    if (promptArg.includes('CONTINUA LA EJECUCION ANTERIOR')) {
      emit({
        type: 'assistant',
        message: {
          id: 'msg_test_2',
          content: [
            {
              type: 'text',
              text: 'CODEXWEB_FINAL_RESPONSE_BEGIN\nAhora sí, respuesta final completa.\nCODEXWEB_FINAL_RESPONSE_END'
            }
          ]
        }
      });
      emit({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'CODEXWEB_FINAL_RESPONSE_BEGIN\nAhora sí, respuesta final completa.\nCODEXWEB_FINAL_RESPONSE_END'
      });
    } else {
      // Primera ejecución con solo thinking
      emit({
        type: 'assistant',
        message: {
          id: 'msg_test_1',
          content: [{ type: 'thinking', text: 'Procesando...' }]
        }
      });
    }
  } else if (scenario === 'is_error_true') {
    // result con is_error=true debe fallar aunque exit code sea 0
    emit({
      type: 'assistant',
      message: {
        id: 'msg_test_1',
        content: [{ type: 'text', text: 'Not logged in' }]
      },
      error: 'authentication_failed'
    });
    emit({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login'
    });
  } else {
    // Default: respuesta simple completa
    emit({
      type: 'assistant',
      message: {
        id: 'msg_test_1',
        content: [{ type: 'text', text: 'Hola, respuesta de prueba desde Claude Code.' }]
      }
    });
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Hola, respuesta de prueba desde Claude Code.'
    });
  }
}

run().catch((err) => {
  console.error('Error in fake-claude-cli:', err);
  process.exit(1);
});
