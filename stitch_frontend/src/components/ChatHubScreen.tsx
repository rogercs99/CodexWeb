import { Plus, Search, RotateCcw, LogOut, Power, Trash2 } from 'lucide-react';
import BottomNav from './BottomNav';
import type { Conversation, Screen, User } from '../lib/types';

const TITLE_MAX_LENGTH = 40;

function formatDate(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function normalizeTitle(value: string | null | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed || 'Nuevo chat';
}

function truncateTitle(value: string, maxLength = TITLE_MAX_LENGTH) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export default function ChatHubScreen({
  user,
  conversations,
  activeConversationId,
  runningConversationIds,
  onOpenChat,
  onCreateChat,
  onDeleteChat,
  onLogout,
  onRefresh,
  onRestart,
  onNavigate
}: {
  user: User | null;
  conversations: Conversation[];
  activeConversationId: number | null;
  runningConversationIds: number[];
  onOpenChat: (id: number) => void;
  onCreateChat: () => void;
  onDeleteChat: (id: number) => void;
  onLogout: () => void;
  onRefresh: () => void;
  onRestart: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">CodexWeb</h1>
          <p className="text-xs text-zinc-500">{user?.username || 'usuario'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500" type="button">
            <RotateCcw size={16} />
          </button>
          <button onClick={onRestart} className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500" type="button">
            <Power size={16} />
          </button>
          <button onClick={onLogout} className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500" type="button">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-28">
        <div className="px-4 py-4 sticky top-0 z-40 bg-black/80 backdrop-blur-xl space-y-2">
          <button onClick={onCreateChat} className="w-full bg-white text-black py-3 rounded-xl font-medium flex items-center justify-center gap-2" type="button">
            <Plus size={18} /> Nuevo chat
          </button>
          <button onClick={() => onNavigate('search')} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-zinc-400 text-left flex items-center gap-2" type="button">
            <Search size={18} /> Search chats...
          </button>
        </div>

        <div className="px-4 py-2 space-y-2">
          {conversations.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-400">No hay conversaciones aún.</div>
          ) : (
            conversations.map((conversation) => {
              const isRunning = runningConversationIds.includes(conversation.id);
              const fullTitle = normalizeTitle(conversation.title);
              const shortTitle = truncateTitle(fullTitle);
              return (
                <div
                  key={conversation.id}
                  className={`w-full p-4 rounded-2xl border transition-colors ${
                    activeConversationId === conversation.id
                      ? 'bg-blue-500/10 border-blue-500/50'
                      : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => onOpenChat(conversation.id)} className="min-w-0 flex items-center gap-2 text-left flex-1" type="button">
                      {isRunning ? (
                        <span
                          className="h-3.5 w-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0"
                          aria-label="Chat en ejecución"
                        />
                      ) : null}
                      <h4 className="font-medium truncate" title={fullTitle} aria-label={fullTitle}>
                        {shortTitle}
                      </h4>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500 whitespace-nowrap">{formatDate(conversation.last_message_at || conversation.created_at)}</span>
                      <button
                        onClick={() => {
                          if (window.confirm('¿Eliminar este chat definitivamente?')) {
                            onDeleteChat(conversation.id);
                          }
                        }}
                        className="w-8 h-8 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-red-300 hover:border-red-400/60"
                        type="button"
                        aria-label="Eliminar chat"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      <BottomNav active="chats" onNavigate={onNavigate} />
    </div>
  );
}
