import { Check, ChevronLeft, Clipboard, Copy, Paperclip, RefreshCw, Send, Settings, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import BottomNav from './BottomNav';
import type { ChatOptions, Message, Screen, TerminalEntry } from '../lib/types';

const TITLE_MAX_LENGTH = 40;
function formatDate(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

async function copyTextToClipboard(text: string): Promise<boolean> {
  const source = String(text || '');
  if (!source) return false;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(source);
      return true;
    }
  } catch (_error) {
    // fallback below
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = source;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch (_error) {
    return false;
  }
}

function CodeBlock({ text, language }: { text: string; language: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const lines = String(text || '').split('\n');

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 1600);
  };

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-950/90 overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/70 cursor-pointer"
        role="button"
        tabIndex={0}
        onMouseEnter={() => {
          if (!expanded) setExpanded(true);
        }}
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
      >
        <span className="text-[11px] uppercase tracking-wide text-zinc-400">{language || 'code'}</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-blue-300">{expanded ? 'Ver menos' : `Abrir (${lines.length} lineas)`}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void handleCopy();
            }}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800/90"
            aria-label="Copiar codigo"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>
      {expanded ? (
        <pre className="text-xs text-zinc-200 p-3 overflow-x-auto whitespace-pre">
          <code>{lines.join('\n')}</code>
        </pre>
      ) : (
        <div
          role="button"
          tabIndex={0}
          className="px-3 py-2 text-xs text-zinc-500 cursor-pointer select-none"
          onClick={() => setExpanded(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setExpanded(true);
            }
          }}
        >
          Toca para abrir el bloque de codigo
        </div>
      )}
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none break-words [overflow-wrap:anywhere] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 whitespace-pre-wrap leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="my-0 leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-blue-300 underline underline-offset-2 break-all"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const raw = String(children || '').replace(/\n$/, '');
            const langMatch = /language-([a-zA-Z0-9_-]+)/.exec(String(className || ''));
            const isInlineCode = !langMatch && !raw.includes('\n');
            if (isInlineCode) {
              return (
                <code className="inline-block align-baseline px-1.5 py-0.5 rounded-md bg-zinc-800/90 text-zinc-100 text-[0.92em]">
                  {raw}
                </code>
              );
            }
            return <CodeBlock text={raw} language={langMatch ? langMatch[1] : ''} />;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatScreen({
  chatTitle,
  conversationId,
  messages,
  liveReasoning,
  terminalEntries,
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
  conversationId: number | null;
  messages: Message[];
  liveReasoning: string;
  terminalEntries: TerminalEntry[];
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
  const [showReasoning, setShowReasoning] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [hasTerminalActivity, setHasTerminalActivity] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const messagesRef = useRef<HTMLElement | null>(null);
  const [headerOffset, setHeaderOffset] = useState(136);

  const grouped = useMemo(() => messages, [messages]);
  const fullTitle = normalizeTitle(chatTitle);
  const shortTitle = truncateTitle(fullTitle);
  const isLongTitle = fullTitle.length > TITLE_MAX_LENGTH;
  const pendingAssistantMessageId = useMemo(() => {
    for (let i = grouped.length - 1; i >= 0; i -= 1) {
      const item = grouped[i];
      if (item.role !== 'assistant') continue;
      return String(item.content || '').trim() ? null : item.id;
    }
    return null;
  }, [grouped]);

  const lastMessageFingerprint = grouped.length > 0 ? `${grouped[grouped.length - 1].id}:${String(grouped[grouped.length - 1].content || '').length}` : 'none';
  const lastTerminalEntry = terminalEntries.length > 0 ? terminalEntries[terminalEntries.length - 1] : null;
  const terminalFingerprint =
    lastTerminalEntry && typeof lastTerminalEntry === 'object'
      ? `${terminalEntries.length}:${String(lastTerminalEntry.id || '')}:${String(lastTerminalEntry.output || '').length}`
      : '0';
  const hasReasoningActivity = liveReasoning.trim().length > 0;
  const showReasoningPanel = hasReasoningActivity || sending || isRunning;
  const hadReasoningRef = useRef(liveReasoning.trim().length > 0);
  const terminalFingerprintRef = useRef(terminalFingerprint);
  const wasSendingRef = useRef(sending);

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
    const node = headerRef.current;
    if (!node) return undefined;

    const syncHeaderOffset = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      setHeaderOffset((prev) => (prev === height ? prev : height));
    };

    syncHeaderOffset();
    window.addEventListener('resize', syncHeaderOffset);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncHeaderOffset);
      observer.observe(node);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', syncHeaderOffset);
      };
    }

    return () => {
      window.removeEventListener('resize', syncHeaderOffset);
    };
  }, []);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'auto' });
  }, [chatTitle, grouped.length, lastMessageFingerprint, liveReasoning.length, terminalFingerprint]);

  useEffect(() => {
    setShowReasoning(false);
    setShowTerminal(false);
    setHasTerminalActivity(Boolean((sending || isRunning) && terminalEntries.length > 0));
    hadReasoningRef.current = liveReasoning.trim().length > 0;
    terminalFingerprintRef.current = terminalFingerprint;
    wasSendingRef.current = sending;
  }, [conversationId, liveReasoning, terminalFingerprint, sending, isRunning, terminalEntries.length]);

  useEffect(() => {
    if (!wasSendingRef.current && sending) {
      setShowReasoning(true);
      setShowTerminal(false);
      setHasTerminalActivity(false);
      hadReasoningRef.current = false;
      terminalFingerprintRef.current = terminalFingerprint;
    }
    wasSendingRef.current = sending;
  }, [sending, terminalFingerprint]);

  useEffect(() => {
    const hasReasoning = liveReasoning.trim().length > 0;
    if (!hadReasoningRef.current && hasReasoning) {
      setShowReasoning(true);
    }
    hadReasoningRef.current = hasReasoning;
  }, [liveReasoning]);

  useEffect(() => {
    const changed = terminalFingerprintRef.current !== terminalFingerprint;
    terminalFingerprintRef.current = terminalFingerprint;
    if (changed && terminalEntries.length > 0 && (sending || isRunning)) {
      setHasTerminalActivity(true);
      setShowTerminal(true);
    }
  }, [terminalFingerprint, terminalEntries.length, sending, isRunning]);

  const sendCurrent = () => {
    if (sending || isRunning) return;
    if (!input.trim() && selectedFiles.length === 0) return;
    onSend(input);
    setInput('');
  };

  const canSend = input.trim().length > 0 || selectedFiles.length > 0;
  const canStop = sending || isRunning;
  const headerStatus = sending ? `Generando · ${formatElapsed(sendElapsedSeconds)}` : status || 'Sesion activa';

  return (
    <div className="h-screen bg-black flex flex-col relative overflow-hidden overflow-x-hidden">
      <header ref={headerRef} className="fixed top-0 left-0 right-0 z-[70] bg-black border-b border-zinc-900">
        <div className="h-[env(safe-area-inset-top)] bg-black" aria-hidden="true" />
        <div className="px-3 pb-3 pt-2">
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
                    aria-label="Chat en ejecucion"
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
        </div>
      </header>

      <main ref={messagesRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-72 space-y-4" style={{ paddingTop: headerOffset }}>
        {grouped.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-10">Escribe un mensaje para iniciar la conversacion.</div>
        ) : null}
        {grouped.map((message) => {
          const rawContent = String(message.content || '');
          const hasVisibleContent = rawContent.trim().length > 0;
          const messageAttachments = Array.isArray(message.attachments) ? message.attachments : [];
          const showThinking =
            (sending || isRunning) &&
            message.role === 'assistant' &&
            !hasVisibleContent &&
            pendingAssistantMessageId !== null &&
            message.id === pendingAssistantMessageId;
          const fallbackText =
            message.role === 'assistant'
              ? '(Sin respuesta visible del modelo. Revisa terminal para el detalle del error.)'
              : '';
          const visibleContent = hasVisibleContent ? rawContent : fallbackText;

          return (
            <div key={message.id} className={`chat-enter flex min-w-0 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`min-w-0 max-w-[92%] rounded-3xl px-4 py-3 border ${message.role === 'user' ? 'bg-blue-600/20 border-blue-500/30 text-white rounded-br-sm' : 'bg-zinc-900/80 border-zinc-800 text-zinc-100 rounded-tl-sm'}`}>
                {showThinking ? (
                  <div className="inline-flex items-center gap-1.5 py-1" aria-label="Codex esta pensando">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </div>
                ) : (
                  <MarkdownMessage content={visibleContent} />
                )}
                {messageAttachments.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-400">Adjuntos enviados</p>
                    {messageAttachments.map((file) => (
                      <div
                        key={file.id}
                        className="rounded-lg border border-zinc-700/80 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{file.name}</span>
                        <span className="shrink-0 text-zinc-400">
                          {formatBytes(file.size)} · {String(file.mimeType || '').split('/')[0] || 'archivo'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <p className="text-[10px] text-zinc-500 mt-2">{formatDate(message.created_at)}</p>
              </div>
            </div>
          );
        })}

        {showReasoningPanel ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50">
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs uppercase tracking-wide text-zinc-300"
              onClick={() => setShowReasoning((prev) => !prev)}
            >
              {showReasoning ? '▾' : '▸'} Reasoning live
            </button>
            {showReasoning ? (
              <pre className="max-h-72 overflow-auto border-t border-zinc-800 px-3 py-2 text-xs text-zinc-200 whitespace-pre-wrap break-words">
                {liveReasoning || 'Pensando...'}
              </pre>
            ) : null}
          </section>
        ) : null}

        {hasTerminalActivity ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50">
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs uppercase tracking-wide text-zinc-300"
              onClick={() => setShowTerminal((prev) => !prev)}
            >
              {showTerminal ? '▾' : '▸'} Terminal live ({terminalEntries.length})
            </button>
            {showTerminal ? (
              <div className="max-h-80 overflow-auto border-t border-zinc-800 px-3 py-2 space-y-2">
                {terminalEntries.map((entry) => (
                  <article key={entry.id} className="rounded-lg border border-zinc-800 bg-black/50 p-2">
                    <div className="text-[10px] text-zinc-400 uppercase">{entry.statusText || entry.kind}</div>
                    <pre className="text-xs text-zinc-200 whitespace-pre-wrap break-words mt-1">{entry.command}</pre>
                    {entry.output ? (
                      <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-words mt-1">{entry.output}</pre>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      <div className="fixed bottom-[74px] left-0 right-0 p-4 bg-gradient-to-t from-black via-black/90 to-transparent z-[60] pointer-events-none">
        {selectedFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2 overflow-x-hidden pointer-events-auto">
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

        <form
          className="min-w-0 bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 rounded-2xl p-2 flex items-end gap-2 pointer-events-auto"
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
            key={canStop ? 'chat-stop' : 'chat-send'}
            onClick={canStop ? onStop : undefined}
            type={canStop ? 'button' : 'submit'}
            disabled={!canStop && !canSend}
            className={`chat-send-btn w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center transition-colors ${
              canStop
                ? 'bg-red-600 border-red-500 text-white'
                : canSend
                ? 'bg-blue-600 border-blue-500/30 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-500'
            }`}
            aria-label={canStop ? 'Detener sesión activa' : 'Enviar mensaje'}
          >
            {canStop ? <Square size={16} /> : <Send size={18} />}
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
            aria-label="Titulo completo del chat"
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-zinc-200 mb-2">Titulo completo</h3>
            <p className="text-sm text-zinc-100 break-words">{fullTitle}</p>
          </div>
        </div>
      ) : null}

      <BottomNav active="chats" onNavigate={onNavigate} />
    </div>
  );
}
