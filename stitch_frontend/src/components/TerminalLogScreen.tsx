import { ChevronLeft, RefreshCw, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCodexRuns, killAllCodexRuns, killConversationSession } from '../lib/api';
import BottomNav from './BottomNav';
import type { CodexBackgroundRun, Screen, TerminalEntry } from '../lib/types';

function formatTime(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function formatElapsed(startedAt: string) {
  const timestamp = Date.parse(String(startedAt || ''));
  if (!Number.isFinite(timestamp)) return '--';
  const totalSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TerminalLogScreen({
  entries,
  onClear,
  onNavigate,
  onRunsChanged
}: {
  entries: TerminalEntry[];
  onClear: () => void;
  onNavigate: (screen: Screen) => void;
  onRunsChanged?: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'running' | 'success' | 'error' | 'notice'>('all');
  const [runs, setRuns] = useState<CodexBackgroundRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState('');
  const [stoppingConversationId, setStoppingConversationId] = useState<number | null>(null);
  const [stoppingAll, setStoppingAll] = useState(false);

  const loadRuns = useCallback(async (silent = false) => {
    if (!silent) {
      setRunsLoading(true);
    }
    setRunsError('');
    try {
      const nextRuns = await getCodexRuns();
      setRuns(nextRuns);
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : 'No se pudieron cargar los procesos activos');
    } finally {
      if (!silent) {
        setRunsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      void loadRuns(true);
    }, 4000);
    return () => {
      window.clearInterval(pollId);
    };
  }, [loadRuns]);

  const filtered = useMemo(
    () => entries.filter((entry) => (filter === 'all' ? true : entry.kind === filter)).slice().reverse(),
    [entries, filter]
  );

  const stopOneRun = async (conversationId: number) => {
    setStoppingConversationId(conversationId);
    setRunsError('');
    try {
      await killConversationSession(conversationId);
      await loadRuns(true);
      onRunsChanged?.();
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : 'No se pudo detener el proceso seleccionado');
    } finally {
      setStoppingConversationId(null);
    }
  };

  const stopAllRuns = async () => {
    setStoppingAll(true);
    setRunsError('');
    try {
      await killAllCodexRuns();
      await loadRuns(true);
      onRunsChanged?.();
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : 'No se pudieron detener los procesos activos');
    } finally {
      setStoppingAll(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <button onClick={() => onNavigate('hub')} className="p-2 -ml-2 text-zinc-400 hover:text-white" type="button">
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-base font-semibold tracking-tight">Tools</h1>
        <button
          onClick={() => {
            void loadRuns();
          }}
          className="p-2 -mr-2 text-zinc-400 hover:text-white"
          type="button"
          aria-label="Refrescar herramientas"
        >
          <RefreshCw size={18} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Procesos Codex en background</h2>
              <p className="text-xs text-zinc-500">Lista en tiempo real de ejecuciones activas de tu usuario.</p>
            </div>
            <button
              type="button"
              onClick={stopAllRuns}
              disabled={stoppingAll || runs.length === 0}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                runs.length > 0
                  ? 'border-red-500/40 bg-red-600/20 text-red-200'
                  : 'border-zinc-700 text-zinc-500'
              } disabled:opacity-50`}
            >
              {stoppingAll ? 'Deteniendo...' : `Detener todos (${runs.length})`}
            </button>
          </div>

          {runsError ? <p className="text-xs text-red-300">{runsError}</p> : null}

          {runsLoading && runs.length === 0 ? (
            <p className="text-sm text-zinc-500">Cargando procesos activos...</p>
          ) : null}

          {!runsLoading && runs.length === 0 ? (
            <p className="text-sm text-zinc-500">No hay procesos de Codex ejecutandose en background.</p>
          ) : null}

          <div className="space-y-2">
            {runs.map((run) => (
              <article key={run.conversationId} className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100 truncate" title={run.title}>{run.title || `Chat ${run.conversationId}`}</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      chat #{run.conversationId} · pid {run.pid ?? 'n/a'} · {run.status === 'stopping' ? 'deteniendo' : 'ejecutando'} · {formatElapsed(run.startedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void stopOneRun(run.conversationId);
                    }}
                    disabled={stoppingConversationId === run.conversationId || run.status === 'stopping'}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                    aria-label={`Detener chat ${run.conversationId}`}
                  >
                    {stoppingConversationId === run.conversationId ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Square size={12} /> Deteniendo...
                      </span>
                    ) : (
                      <span className="text-xs">Detener</span>
                    )}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Historial de terminal</h2>
              <p className="text-xs text-zinc-500">Eventos y salida de comandos de tus chats.</p>
            </div>
            <button onClick={onClear} className="p-2 text-zinc-400 hover:text-white" type="button" aria-label="Limpiar historial terminal">
              <Trash2 size={18} />
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {(['all', 'running', 'success', 'error', 'notice'] as const).map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`px-4 py-1.5 rounded-full border text-xs uppercase ${
                  filter === item ? 'bg-zinc-800 text-white border-zinc-700' : 'text-zinc-500 border-zinc-800'
                }`}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filtered.length === 0 ? <div className="text-sm text-zinc-500">Sin eventos para este filtro.</div> : null}
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-xl border p-3 ${
                  entry.kind === 'error'
                    ? 'border-red-500/30 bg-red-500/5'
                    : entry.kind === 'success'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : entry.kind === 'running'
                    ? 'border-blue-500/30 bg-blue-500/5'
                    : 'border-zinc-800 bg-zinc-900/30'
                }`}
              >
                <div className="flex items-center justify-between mb-2 text-xs">
                  <span className="uppercase text-zinc-400">{entry.statusText || entry.kind}</span>
                  <span className="text-zinc-600">{formatTime(entry.timestamp)}</span>
                </div>
                <pre className="text-xs text-zinc-200 whitespace-pre-wrap break-all">{entry.command}</pre>
                {entry.output ? (
                  <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all mt-2">{entry.output}</pre>
                ) : null}
                {entry.durationMs > 0 ? (
                  <p className="text-[10px] text-zinc-600 mt-2">{Math.round(entry.durationMs)} ms</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </main>

      <BottomNav active="tools" onNavigate={onNavigate} />
    </div>
  );
}
