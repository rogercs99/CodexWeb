import { ChevronLeft, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Conversation, Screen } from '../lib/types';

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function formatDate(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function SearchScreen({
  conversations,
  onOpenChat,
  onNavigate
}: {
  conversations: Conversation[];
  onOpenChat: (id: number) => void;
  onNavigate: (screen: Screen) => void;
}) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return conversations;
    return conversations.filter((item) => {
      const title = normalize(item.title || '');
      const when = normalize(formatDate(item.last_message_at || item.created_at));
      return title.includes(q) || when.includes(q);
    });
  }, [conversations, query]);

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="bg-black border-b border-zinc-900 px-4 py-3 sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => onNavigate('hub')} className="p-2 -ml-2 text-zinc-400 hover:text-white" type="button">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-semibold flex-1 text-center mr-8 tracking-tight">Search</h1>
          <button onClick={() => onNavigate('hub')} className="text-blue-500 font-medium text-sm" type="button">Cancel</button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar chats..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-10 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
          />
          {query ? (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white" type="button">
              <X size={14} />
            </button>
          ) : null}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-28 space-y-3">
        {results.length === 0 ? <div className="text-sm text-zinc-500">No hay resultados.</div> : null}
        {results.map((item) => (
          <button
            key={item.id}
            onClick={() => onOpenChat(item.id)}
            className="w-full text-left bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 hover:border-zinc-700"
            type="button"
          >
            <h4 className="font-semibold text-white mb-1 truncate">{item.title || 'Nuevo chat'}</h4>
            <p className="text-xs text-zinc-500">{formatDate(item.last_message_at || item.created_at)}</p>
          </button>
        ))}
      </main>
    </div>
  );
}
