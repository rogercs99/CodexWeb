import { ChevronLeft, Clipboard, Paperclip, Send, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import BottomNav from './BottomNav';
import type { Message, Screen } from '../lib/types';

function formatDate(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatScreen({
  chatTitle,
  messages,
  liveReasoning,
  sending,
  selectedFiles,
  status,
  onBack,
  onSend,
  onStop,
  onAddFiles,
  onClearFiles,
  onNavigate
}: {
  chatTitle: string;
  messages: Message[];
  liveReasoning: string;
  sending: boolean;
  selectedFiles: File[];
  model: string;
  reasoningEffort: string;
  status: string;
  onBack: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onAddFiles: (files: File[]) => void;
  onClearFiles: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  const [input, setInput] = useState('');
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const messagesRef = useRef<HTMLElement | null>(null);

  const grouped = useMemo(() => messages, [messages]);

  useEffect(() => {
    if (!sending) {
      setReasoningExpanded(false);
    }
  }, [sending]);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'auto' });
  }, [chatTitle, grouped.length]);

  return (
    <div className="h-screen bg-black flex flex-col relative overflow-hidden">
      <header className="fixed top-0 left-0 right-0 z-[70] bg-black/85 backdrop-blur-xl border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <button onClick={onBack} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors" type="button">
          <ChevronLeft size={24} />
        </button>
        <div className="flex-1 text-center px-2">
          <h1 className="text-[16px] font-semibold tracking-tight truncate">{chatTitle || 'Nuevo chat'}</h1>
          <p className="text-xs text-zinc-500">{status || 'Sesión activa'}</p>
        </div>
        <button onClick={() => onNavigate('settings')} className="text-xs text-zinc-300 border border-zinc-700 px-2 py-1 rounded-lg" type="button">
          Opciones
        </button>
      </header>

      <main ref={messagesRef} className="flex-1 overflow-y-auto p-4 pt-20 pb-64 space-y-4">
        {grouped.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-10">Escribe un mensaje para iniciar la conversación.</div>
        ) : null}
        {grouped.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[86%] rounded-3xl px-4 py-3 border ${message.role === 'user' ? 'bg-blue-600/20 border-blue-500/30 text-white rounded-br-sm' : 'bg-zinc-900/80 border-zinc-800 text-zinc-100 rounded-tl-sm'}`}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content || (sending && message.role === 'assistant' ? '...' : '')}</p>
              <p className="text-[10px] text-zinc-500 mt-2">{formatDate(message.created_at)}</p>
            </div>
          </div>
        ))}
      </main>

      <div className="fixed bottom-[74px] left-0 right-0 p-4 bg-gradient-to-t from-black via-black/90 to-transparent z-[60]">
        {selectedFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {selectedFiles.map((file) => (
              <span key={file.name + file.size} className="text-xs bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-lg text-zinc-300">
                {file.name}
              </span>
            ))}
            <button onClick={onClearFiles} className="text-xs bg-zinc-900 border border-zinc-700 px-2 py-1 rounded-lg text-zinc-400" type="button">
              <X size={14} className="inline mr-1" /> limpiar
            </button>
          </div>
        ) : null}

        {sending ? (
          <div className="mb-2 rounded-2xl px-4 py-3 border bg-zinc-900/80 border-zinc-800 text-zinc-100">
            <button
              type="button"
              className="text-xs uppercase tracking-wide text-zinc-300"
              onClick={() => setReasoningExpanded((prev) => !prev)}
            >
              {reasoningExpanded ? '▾' : '▸'} Razonando
            </button>
            {reasoningExpanded ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed mt-2">
                {liveReasoning || 'Analizando...'}
              </p>
            ) : null}
          </div>
        ) : null}

        <form
          className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-2xl p-2 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSend(input);
            setInput('');
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = event.currentTarget.files ? (Array.from(event.currentTarget.files) as File[]) : [];
              if (files.length > 0) onAddFiles(files);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />

          <button
            onClick={() => fileRef.current?.click()}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800"
            type="button"
          >
            <Paperclip size={18} />
          </button>

          <button
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (!text) return;
                setInput((prev) => (prev ? `${prev}\n${text}` : text));
              } catch (_error) {
                // ignore clipboard errors
              }
            }}
            className="h-10 px-3 flex items-center justify-center gap-1 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs"
            type="button"
          >
            <Clipboard size={14} />
            Pegar
          </button>

          <textarea
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Message Codex..."
            className="flex-1 bg-transparent border-none p-2 text-white placeholder:text-zinc-500 focus:outline-none resize-none max-h-28"
          />

          {sending ? (
            <button onClick={onStop} type="button" className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-300">
              <Square size={16} />
            </button>
          ) : (
            <button type="submit" className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <Send size={18} />
            </button>
          )}
        </form>
      </div>

      <BottomNav active="chats" onNavigate={onNavigate} />
    </div>
  );
}
