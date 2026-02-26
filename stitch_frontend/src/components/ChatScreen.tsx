import { ChevronLeft, Clipboard, Paperclip, RefreshCw, Send, Settings, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import BottomNav from './BottomNav';
import type { ChatOptions, Message, Screen } from '../lib/types';

const TITLE_MAX_LENGTH = 40;

function formatDate(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatElapsed(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function normalizeTitle(value: string) {
  const trimmed = String(value || '').trim();
  return trimmed || 'Nuevo chat';
}

function truncateTitle(value: string, maxLength = TITLE_MAX_LENGTH) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export default function ChatScreen({
  chatTitle,
  messages,
  liveReasoning,
  sending,
  sendElapsedSeconds,
  isRunning,
  selectedFiles,
  status,
  onBack,
  onSend,
  onStop,
  onAddFiles,
  onClearFiles,
  onRefresh,
  onNavigate,
  model,
  reasoningEffort,
  options,
  onModelChange,
  onReasoningChange
}: {
  chatTitle: string;
  messages: Message[];
  liveReasoning: string;
  sending: boolean;
  sendElapsedSeconds: number;
  isRunning: boolean;
  selectedFiles: File[];
  model: string;
  reasoningEffort: string;
  options: ChatOptions;
  status: string;
  onBack: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onAddFiles: (files: File[]) => void;
  onClearFiles: () => void;
  onRefresh: () => void;
  onNavigate: (screen: Screen) => void;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
}) {
  const [input, setInput] = useState('');
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const messagesRef = useRef<HTMLElement | null>(null);

  const grouped = useMemo(() => messages, [messages]);
  const fullTitle = normalizeTitle(chatTitle);
  const shortTitle = truncateTitle(fullTitle);
  const isLongTitle = fullTitle.length > TITLE_MAX_LENGTH;

  useEffect(() => {
    if (!showTitleModal) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowTitleModal(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showTitleModal]);

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

  const sendCurrent = () => {
    if (sending) return;
    if (!input.trim() && selectedFiles.length === 0) return;
    onSend(input);
    setInput('');
  };

  const canSend = input.trim().length > 0 || selectedFiles.length > 0;
  const headerStatus = sending ? `Generando · ${formatElapsed(sendElapsedSeconds)}` : status || 'Sesión activa';

  return (
    <div className="h-screen bg-black flex flex-col relative overflow-hidden overflow-x-hidden">
      <header className="fixed top-0 left-0 right-0 z-[70] bg-black/85 backdrop-blur-xl border-b border-zinc-900 px-3 py-3">
        <div className="flex items-center gap-1">
        <button onClick={onBack} className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors" type="button" aria-label="Volver al hub">
          <ChevronLeft size={24} />
        </button>
        <div className="min-w-0 flex-1 text-center px-1">
          <button
            type="button"
            onClick={() => {
              if (!isLongTitle) return;
              setShowTitleModal(true);
            }}
            className={`mx-auto max-w-full text-[16px] font-semibold tracking-tight flex items-center justify-center gap-2 ${
              isLongTitle ? 'cursor-help' : ''
            }`}
            title={isLongTitle ? fullTitle : undefined}
            aria-label={fullTitle}
          >
            {sending || isRunning ? (
              <span
                className="h-3.5 w-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0"
                aria-label="Chat en ejecución"
              />
            ) : null}
            <span className="truncate">{shortTitle}</span>
          </button>
          <p className="text-xs text-zinc-500">{headerStatus}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onRefresh}
            className="w-8 h-8 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500"
            type="button"
            aria-label="Refrescar chat"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => onNavigate('settings')}
            className="w-8 h-8 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500"
            type="button"
            aria-label="Abrir opciones"
          >
            <Settings size={15} />
          </button>
        </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200"
            aria-label="Modelo del chat"
          >
            <option value="">Automatico (default CLI)</option>
            {options.models.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select
            value={reasoningEffort}
            onChange={(event) => onReasoningChange(event.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200"
            aria-label="Nivel de razonamiento del chat"
          >
            {options.reasoningEfforts.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      </header>

      <main ref={messagesRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 pt-32 pb-64 space-y-4">
        {grouped.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-10">Escribe un mensaje para iniciar la conversación.</div>
        ) : null}
        {grouped.map((message) => {
          const rawContent = String(message.content || '');
          const hasVisibleContent = rawContent.trim().length > 0;
          const showThinking = sending && message.role === 'assistant' && !hasVisibleContent;
          const fallbackText =
            message.role === 'assistant'
              ? '(Sin respuesta visible del modelo. Revisa Terminal para el detalle del error.)'
              : '';
          const visibleContent = hasVisibleContent ? rawContent : fallbackText;

          return (
            <div key={message.id} className={`chat-enter flex min-w-0 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`min-w-0 max-w-[86%] rounded-3xl px-4 py-3 border ${message.role === 'user' ? 'bg-blue-600/20 border-blue-500/30 text-white rounded-br-sm' : 'bg-zinc-900/80 border-zinc-800 text-zinc-100 rounded-tl-sm'}`}>
                {showThinking ? (
                  <div className="inline-flex items-center gap-1.5 py-1" aria-label="Codex está pensando">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed">{visibleContent}</p>
                )}
                <p className="text-[10px] text-zinc-500 mt-2">{formatDate(message.created_at)}</p>
              </div>
            </div>
          );
        })}
      </main>

      <div className="fixed bottom-[74px] left-0 right-0 p-4 bg-gradient-to-t from-black via-black/90 to-transparent z-[60]">
        {selectedFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2 overflow-x-hidden">
            {selectedFiles.map((file) => (
              <span key={file.name + file.size} className="max-w-full truncate text-xs bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-lg text-zinc-300">
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
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed mt-2">
                {liveReasoning || 'Analizando...'}
              </p>
            ) : null}
          </div>
        ) : null}

        <form
          className="min-w-0 bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-2xl p-2 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            sendCurrent();
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
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                sendCurrent();
              }
            }}
            placeholder="Message Codex..."
            className="min-w-0 flex-1 bg-transparent border-none p-2 text-white placeholder:text-zinc-500 focus:outline-none resize-none max-h-28"
          />

          <button
            key={sending ? 'chat-stop' : 'chat-send'}
            onClick={sending ? onStop : undefined}
            type={sending ? 'button' : 'submit'}
            disabled={!sending && !canSend}
            className={`chat-send-btn w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center transition-colors ${
              sending
                ? 'bg-red-600 border-red-500 text-white'
                : canSend
                ? 'bg-blue-600 border-blue-500/30 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-500'
            }`}
            aria-label={sending ? 'Detener respuesta' : 'Enviar mensaje'}
          >
            {sending ? <Square size={16} /> : <Send size={18} />}
          </button>
        </form>
      </div>

      {showTitleModal ? (
        <div
          className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setShowTitleModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Título completo del chat"
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-zinc-200 mb-2">Título completo</h3>
            <p className="text-sm text-zinc-100 break-words">{fullTitle}</p>
          </div>
        </div>
      ) : null}

      <BottomNav active="chats" onNavigate={onNavigate} />
    </div>
  );
}
