import { useEffect, useState } from 'react';
import { Plus, Search, RotateCcw, LogOut, Power } from 'lucide-react';
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
  onOpenChat,
  onCreateChat,
  onLogout,
  onRefresh,
  onRestart,
  onNavigate
}: {
  user: User | null;
  conversations: Conversation[];
  activeConversationId: number | null;
  onOpenChat: (id: number) => void;
  onCreateChat: () => void;
  onLogout: () => void;
  onRefresh: () => void;
  onRestart: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  const [hoveredConversationId, setHoveredConversationId] = useState<number | null>(null);
  const [modalTitle, setModalTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!modalTitle) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModalTitle(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [modalTitle]);

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
              const fullTitle = normalizeTitle(conversation.title);
              const shortTitle = truncateTitle(fullTitle);
              const isLongTitle = fullTitle.length > TITLE_MAX_LENGTH;
              const isHoverOpen = isLongTitle && hoveredConversationId === conversation.id;
              return (
                <button
                  key={conversation.id}
                  onClick={() => onOpenChat(conversation.id)}
                  className={`w-full text-left p-4 rounded-2xl border transition-colors ${
                    activeConversationId === conversation.id
                      ? 'bg-blue-500/10 border-blue-500/50'
                      : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                  }`}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div
                      className="relative min-w-0"
                      onMouseEnter={() => {
                        if (isLongTitle) setHoveredConversationId(conversation.id);
                      }}
                      onMouseLeave={() => {
                        if (hoveredConversationId === conversation.id) setHoveredConversationId(null);
                      }}
                    >
                      <h4 className="font-medium truncate">
                        <span
                          className={isLongTitle ? 'cursor-help' : undefined}
                          title={isLongTitle ? fullTitle : undefined}
                          aria-label={fullTitle}
                          onClick={(event) => {
                            if (!isLongTitle) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setHoveredConversationId(null);
                            setModalTitle(fullTitle);
                          }}
                        >
                          {shortTitle}
                        </span>
                      </h4>
                      {isHoverOpen ? (
                        <div
                          role="tooltip"
                          className="pointer-events-none absolute left-0 top-full mt-2 z-20 max-w-xs rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 shadow-xl"
                        >
                          {fullTitle}
                        </div>
                      ) : null}
                    </div>
                    <span className="text-xs text-zinc-500">{formatDate(conversation.last_message_at || conversation.created_at)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </main>

      {modalTitle ? (
        <div
          className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setModalTitle(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Título completo del chat"
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-zinc-200 mb-2">Título completo</h3>
            <p className="text-sm text-zinc-100 break-words">{modalTitle}</p>
          </div>
        </div>
      ) : null}

      <BottomNav active="chats" onNavigate={onNavigate} />
    </div>
  );
}
