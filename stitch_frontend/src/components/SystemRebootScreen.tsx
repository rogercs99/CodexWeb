import { RefreshCw } from 'lucide-react';
import type { RestartState } from '../lib/types';

function summarize(phase: string) {
  if (phase === 'waiting_shutdown') return 'Esperando apagado del proceso actual';
  if (phase === 'relaunch_pending') return 'Preparando relanzamiento';
  if (phase === 'relaunch_spawned') return 'Nuevo proceso lanzado';
  if (phase === 'completed') return 'Reinicio completado';
  if (phase === 'failed') return 'Reinicio fallido';
  return phase || 'Procesando';
}

export default function SystemRebootScreen({
  restart,
  busy,
  onBack
}: {
  restart: RestartState | null;
  busy: boolean;
  onBack: () => void;
}) {
  const logs = restart?.logs || [];
  return (
    <div className="min-h-screen bg-black text-white p-6 flex flex-col">
      <div className="max-w-xl w-full mx-auto my-auto border border-zinc-800 bg-zinc-900/40 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <RefreshCw size={20} className="animate-spin" />
          <h2 className="text-lg font-semibold">CodexWeb se está reiniciando</h2>
        </div>

        <p className="text-sm text-zinc-400 mb-3">{busy ? 'Solicitando reinicio...' : summarize(restart?.phase || '')}</p>

        <div className="bg-black border border-zinc-800 rounded-xl p-3 h-52 overflow-auto">
          {logs.length === 0 ? (
            <p className="text-xs text-zinc-500">Esperando logs...</p>
          ) : (
            logs.map((line) => (
              <p key={`${line.at}_${line.message}`} className="text-xs text-zinc-300 mb-1 break-words">
                <span className="text-zinc-500 mr-2">{new Date(line.at).toLocaleTimeString('es-ES')}</span>
                {line.message}
              </p>
            ))
          )}
        </div>

        <button onClick={onBack} type="button" className="mt-4 w-full border border-zinc-700 rounded-xl py-2.5 text-zinc-300 hover:text-white hover:border-zinc-500">
          Volver al hub
        </button>
      </div>
    </div>
  );
}
