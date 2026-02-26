import { ChevronLeft, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import BottomNav from './BottomNav';
import type { Screen, TerminalEntry } from '../lib/types';

function formatTime(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function TerminalLogScreen({
  entries,
  onClear,
  onNavigate
}: {
  entries: TerminalEntry[];
  onClear: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'running' | 'success' | 'error' | 'notice'>('all');

  const filtered = useMemo(
    () => entries.filter((entry) => (filter === 'all' ? true : entry.kind === filter)).slice().reverse(),
    [entries, filter]
  );

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <button onClick={() => onNavigate('hub')} className="p-2 -ml-2 text-zinc-400 hover:text-white" type="button">
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-base font-semibold tracking-tight">Terminal Log</h1>
        <button onClick={onClear} className="p-2 -mr-2 text-zinc-400 hover:text-white" type="button">
          <Trash2 size={18} />
        </button>
      </header>

      <div className="px-4 py-3 flex gap-2 overflow-x-auto">
        {(['all', 'running', 'success', 'error', 'notice'] as const).map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={`px-4 py-1.5 rounded-full border text-xs uppercase ${filter === item ? 'bg-zinc-800 text-white border-zinc-700' : 'text-zinc-500 border-zinc-800'}`}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-2 pb-28 space-y-3">
        {filtered.length === 0 ? <div className="text-sm text-zinc-500">Sin eventos para este filtro.</div> : null}
        {filtered.map((entry) => (
          <div key={entry.id} className={`rounded-xl border p-3 ${entry.kind === 'error' ? 'border-red-500/30 bg-red-500/5' : entry.kind === 'success' ? 'border-emerald-500/30 bg-emerald-500/5' : entry.kind === 'running' ? 'border-blue-500/30 bg-blue-500/5' : 'border-zinc-800 bg-zinc-900/30'}`}>
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="uppercase text-zinc-400">{entry.statusText || entry.kind}</span>
              <span className="text-zinc-600">{formatTime(entry.timestamp)}</span>
            </div>
            <pre className="text-xs text-zinc-200 whitespace-pre-wrap break-all">{entry.command}</pre>
            {entry.output ? <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all mt-2">{entry.output}</pre> : null}
            {entry.durationMs > 0 ? <p className="text-[10px] text-zinc-600 mt-2">{Math.round(entry.durationMs)} ms</p> : null}
          </div>
        ))}
      </main>

      <BottomNav active="tools" onNavigate={onNavigate} />
    </div>
  );
}
