import { Check, ChevronLeft, Clipboard, Cloud, Copy, FolderOpen, Mic, Paperclip, RefreshCw, Send, Settings, Square, X, Zap, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import BottomNav from './BottomNav';
import type { AiAgentSettingsItem, ChatOptions, ChatProject, ConversationProjectContext, Message, Screen, KaggleJobOutput } from '../lib/types';
import { kaggleSubmit, kaggleListJobs } from '../lib/api';
import KaggleJobInline from './KaggleJobInline';

interface InlineKaggleJob {
  jobId: string;
  code: string;
  messageIndex: number;
  completed: boolean;
  output?: KaggleJobOutput;
}

function isKaggleTerminalStatus(status: string | null | undefined) {
  return status === 'complete' || status === 'error' || status === 'cancelled';
}

const TITLE_MAX_LENGTH = 40;
const TOP_LOAD_THRESHOLD_PX = 72;
const STICKY_BOTTOM_THRESHOLD_PX = 140;
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

type BrowserSpeechRecognitionCtor = new () => any;

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionCtor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
  };
  const ctor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  return typeof ctor === 'function' ? ctor : null;
}

function describeVoiceError(rawCode: string) {
  const code = String(rawCode || '').trim().toLowerCase();
  if (!code) return 'No se pudo completar el dictado de voz.';
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'El navegador bloqueó el micrófono. Revisa los permisos y vuelve a intentarlo.';
  }
  if (code === 'no-speech') {
    return 'No se detectó voz. Inténtalo otra vez.';
  }
  if (code === 'audio-capture') {
    return 'No se encontró un micrófono disponible.';
  }
  if (code === 'network') {
    return 'El reconocimiento de voz falló por red o servicio no disponible.';
  }
  return `Error de voz: ${code}`;
}

function appendTranscriptToInput(previousValue: string, nextChunk: string) {
  const previous = String(previousValue || '');
  const chunk = String(nextChunk || '').trim();
  if (!chunk) return previous;
  if (!previous) return chunk;
  const separator = /[\s\n]$/.test(previous) ? '' : ' ';
  return `${previous}${separator}${chunk}`;
}

function normalizeTitle(value: string) {
  const trimmed = String(value || '').trim();
  return trimmed || 'Nuevo chat';
}

function stripOptionalFilePositionSuffix(rawPath: string) {
  const source = String(rawPath || '').trim();
  if (!source) return '';
  const noFragment = source.split('#')[0];
  const match = /^(.*):(\d+)(?::(\d+))?$/.exec(noFragment);
  if (!match) return noFragment;
  const basePath = String(match[1] || '').trim();
  if (!basePath || !basePath.startsWith('/')) return noFragment;
  return basePath;
}

function isLikelyLocalFilesystemPath(rawPath: string) {
  const source = String(rawPath || '').trim();
  if (!source) return false;
  if (/^[a-zA-Z]:\//.test(source)) return true;
  return (
    source.startsWith('/root/') ||
    source.startsWith('/home/') ||
    source.startsWith('/Users/') ||
    source.startsWith('/mnt/') ||
    source.startsWith('/var/') ||
    source.startsWith('/opt/')
  );
}

function buildWorkspaceFileHref(rawPath: string) {
  const normalized = String(rawPath || '').replace(/\\/g, '/').trim();
  if (!normalized) return '';
  const cleanPath = stripOptionalFilePositionSuffix(normalized) || normalized;
  return `/api/workspace/file?path=${encodeURIComponent(cleanPath)}`;
}

function normalizeMessageLinkHref(href?: string) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return raw;
  if (raw.startsWith('#')) return raw;

  const normalizedPath = raw.replace(/\\/g, '/');
  const uploadsMarker = '/uploads/';
  const markerIndex = normalizedPath.toLowerCase().indexOf(uploadsMarker);
  if (markerIndex >= 0) {
    return normalizedPath.slice(markerIndex);
  }
  if (isLikelyLocalFilesystemPath(normalizedPath)) {
    return buildWorkspaceFileHref(normalizedPath);
  }
  return raw;
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

function CodeBlock({ text, language, onSendToKaggle, kaggleSending }: { text: string; language: string; onSendToKaggle?: (code: string) => void; kaggleSending?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const lines = String(text || '').split('\n');
  const isPython = /^py(thon)?$/i.test(language || '');

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
          {isPython && onSendToKaggle && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSendToKaggle(text);
              }}
              disabled={kaggleSending}
              className={`inline-flex h-7 items-center justify-center gap-1 px-2 rounded-full border transition-colors ${
                kaggleSending
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300 cursor-wait'
                  : 'border-cyan-700 text-cyan-300 hover:border-cyan-500 hover:bg-cyan-800/30 hover:text-cyan-100'
              }`}
              aria-label="Ejecutar en Kaggle"
              title="Ejecutar en Kaggle"
            >
              {kaggleSending ? <Loader2 size={12} className="animate-spin" /> : null}
              <span className="text-[10px] font-medium">Kaggle</span>
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void handleCopy();
            }}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
              copied
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800/90 hover:text-zinc-100'
            }`}
            aria-label={copied ? 'Codigo copiado' : 'Copiar codigo'}
            title={copied ? 'Copiado' : 'Copiar codigo'}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
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

function MarkdownMessage({ content, onSendToKaggle, kaggleSending }: { content: string; onSendToKaggle?: (code: string) => void; kaggleSending?: boolean }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none break-words [overflow-wrap:anywhere] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 whitespace-pre-wrap leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="my-0 leading-relaxed">{children}</li>,
          a: ({ href, children }) => {
            const normalizedHref = normalizeMessageLinkHref(href);
            if (!normalizedHref) {
              return <span className="text-blue-300 break-all">{children}</span>;
            }
            return (
              <a
                href={normalizedHref}
                target="_blank"
                rel="noreferrer"
                className="text-blue-300 underline underline-offset-2 break-all"
              >
                {children}
              </a>
            );
          },
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
            return <CodeBlock text={raw} language={langMatch ? langMatch[1] : ''} onSendToKaggle={onSendToKaggle} kaggleSending={kaggleSending} />;
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
  projectContext,
  draftProject,
  messages,
  hasMoreMessages,
  loadingMoreMessages,
  liveReasoning,
  sending,
  sendElapsedSeconds,
  isRunning,
  selectedFiles,
  uploadProgress,
  attachmentPipeline,
  status,
  onBack,
  onSend,
  onStop,
  onAddFiles,
  onClearFiles,
  onRefresh,
  onNavigate,
  activeAgentName,
  activeAgentId,
  availableAgents,
  model,
  reasoningEffort,
  options,
  onLoadMoreMessages,
  onModelChange,
  onReasoningChange,
  onAgentChange,
  tokenSaverOpen,
  onOpenTokenSaver,
  onOpenProjectChats,
  kaggleEnabled,
  onToggleKaggle,
  onOpenKaggleJobs
}: {
  chatTitle: string;
  conversationId: number | null;
  projectContext: ConversationProjectContext | null;
  draftProject: ChatProject | null;
  messages: Message[];
  hasMoreMessages: boolean;
  loadingMoreMessages: boolean;
  liveReasoning: string;
  sending: boolean;
  sendElapsedSeconds: number;
  isRunning: boolean;
  selectedFiles: File[];
  uploadProgress: {
    percent: number;
    uploadedBytes: number;
    totalBytes: number;
    fileName: string;
    fileIndex: number;
    totalFiles: number;
  } | null;
  attachmentPipeline: {
    phase: 'idle' | 'pending' | 'uploading' | 'processing' | 'ready' | 'error';
    fileIndex: number;
    totalFiles: number;
    fileName: string;
    error: string;
  };
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
  activeAgentName: string;
  activeAgentId: string;
  availableAgents: AiAgentSettingsItem[];
  onLoadMoreMessages: () => void;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onAgentChange: (agentId: string) => void;
  tokenSaverOpen: boolean;
  onOpenTokenSaver: () => void;
  onOpenProjectChats: () => void;
  kaggleEnabled: boolean;
  onToggleKaggle: () => void;
  onOpenKaggleJobs: () => void;
}) {
  const [input, setInput] = useState('');
  const [showReasoning, setShowReasoning] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'error'>('idle');
  const [voiceFeedback, setVoiceFeedback] = useState('');
  const [kaggleSending, setKaggleSending] = useState<number | null>(null);
  const [inlineKaggleJobs, setInlineKaggleJobs] = useState<InlineKaggleJob[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const messagesRef = useRef<HTMLElement | null>(null);
  const messageCopyTimerRef = useRef<number | null>(null);
  const [headerOffset, setHeaderOffset] = useState(136);
  const voiceSupported = typeof window !== 'undefined' && Boolean(getSpeechRecognitionConstructor());

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

  const firstMessageFingerprint =
    grouped.length > 0
      ? `${grouped[0].id}:${String(grouped[0].content || '').length}`
      : 'none';
  const lastMessageFingerprint = grouped.length > 0 ? `${grouped[grouped.length - 1].id}:${String(grouped[grouped.length - 1].content || '').length}` : 'none';
  const hasReasoningActivity = liveReasoning.trim().length > 0;
  const showReasoningPanel = hasReasoningActivity || sending || isRunning;
  const hadReasoningRef = useRef(liveReasoning.trim().length > 0);
  const wasSendingRef = useRef(sending);
  const stickToBottomRef = useRef(true);
  const prependScrollHeightRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);

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
    if (!conversationId) {
      setInlineKaggleJobs([]);
      return;
    }

    let cancelled = false;

    kaggleListJobs(50, conversationId)
      .then((jobs) => {
        if (cancelled) return;
        const rehydratedJobs = [...jobs]
          .sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            if (aTime !== bTime) {
              return aTime - bTime;
            }
            return a.jobId.localeCompare(b.jobId);
          })
          .map((job) => ({
            jobId: job.jobId,
            code: '',
            messageIndex: 0,
            completed: isKaggleTerminalStatus(job.status)
          }));

        setInlineKaggleJobs(rehydratedJobs);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load kaggle jobs:', err);
        setInlineKaggleJobs([]);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

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
    return () => {
      if (messageCopyTimerRef.current !== null) {
        window.clearTimeout(messageCopyTimerRef.current);
      }
      const recognition = speechRecognitionRef.current;
      speechRecognitionRef.current = null;
      if (recognition && typeof recognition.abort === 'function') {
        try {
          recognition.abort();
        } catch (_error) {
          // ignore cleanup failures
        }
      }
    };
  }, []);

  useEffect(() => {
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    if (recognition && typeof recognition.abort === 'function') {
      try {
        recognition.abort();
      } catch (_error) {
        // ignore reset failures
      }
    }
    setVoiceState('idle');
    setVoiceFeedback('');
  }, [conversationId]);

  useEffect(() => {
    if (!loadingMoreMessages) {
      loadingOlderRef.current = false;
    }
  }, [loadingMoreMessages]);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    stickToBottomRef.current = true;
    prependScrollHeightRef.current = null;
    loadingOlderRef.current = false;
    node.scrollTo({ top: node.scrollHeight, behavior: 'auto' });
  }, [conversationId]);

  useEffect(() => {
    const previousScrollHeight = prependScrollHeightRef.current;
    if (previousScrollHeight === null) return;
    const node = messagesRef.current;
    if (!node) return;
    const nextScrollHeight = node.scrollHeight;
    if (nextScrollHeight > previousScrollHeight) {
      node.scrollTop += nextScrollHeight - previousScrollHeight;
    }
    prependScrollHeightRef.current = null;
  }, [firstMessageFingerprint, grouped.length]);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    if (!stickToBottomRef.current) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'auto' });
  }, [lastMessageFingerprint, liveReasoning.length]);

  useEffect(() => {
    setShowReasoning(false);
    hadReasoningRef.current = liveReasoning.trim().length > 0;
    wasSendingRef.current = sending;
  }, [conversationId, liveReasoning, sending]);

  useEffect(() => {
    if (!wasSendingRef.current && sending) {
      setShowReasoning(true);
      hadReasoningRef.current = false;
    }
    wasSendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    const hasReasoning = liveReasoning.trim().length > 0;
    if (!hadReasoningRef.current && hasReasoning) {
      setShowReasoning(true);
    }
    hadReasoningRef.current = hasReasoning;
  }, [liveReasoning]);

  const handleMessagesScroll = () => {
    const node = messagesRef.current;
    if (!node) return;

    const distanceFromBottom = node.scrollHeight - (node.scrollTop + node.clientHeight);
    stickToBottomRef.current = distanceFromBottom <= STICKY_BOTTOM_THRESHOLD_PX;

    const shouldLoadOlder =
      conversationId !== null &&
      hasMoreMessages &&
      !loadingMoreMessages &&
      !loadingOlderRef.current &&
      node.scrollTop <= TOP_LOAD_THRESHOLD_PX;
    if (!shouldLoadOlder) return;

    loadingOlderRef.current = true;
    prependScrollHeightRef.current = node.scrollHeight;
    onLoadMoreMessages();
  };

  const stopVoiceInput = (mode: 'stop' | 'abort' = 'stop') => {
    const recognition = speechRecognitionRef.current;
    if (!recognition) return;
    try {
      if (mode === 'abort' && typeof recognition.abort === 'function') {
        recognition.abort();
      } else if (typeof recognition.stop === 'function') {
        recognition.stop();
      } else if (typeof recognition.abort === 'function') {
        recognition.abort();
      }
    } catch (_error) {
      speechRecognitionRef.current = null;
      setVoiceState('idle');
    }
  };

  const toggleVoiceInput = () => {
    if (voiceState === 'listening') {
      stopVoiceInput('stop');
      return;
    }
    const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionCtor) {
      setVoiceState('error');
      setVoiceFeedback('Reconocimiento de voz no disponible en este navegador.');
      return;
    }

    setVoiceFeedback('');
    const recognition = new SpeechRecognitionCtor();
    speechRecognitionRef.current = recognition;
    recognition.lang = navigator.language || 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceState('listening');
      setVoiceFeedback('Escuchando...');
    };

    recognition.onresult = (event: any) => {
      const startIndex = Math.max(0, Number(event?.resultIndex) || 0);
      const totalResults = Math.max(0, Number(event?.results?.length) || 0);
      let transcript = '';
      for (let index = startIndex; index < totalResults; index += 1) {
        const result = event?.results?.[index];
        const chunk = String(result?.[0]?.transcript || '').trim();
        if (!chunk) continue;
        transcript = transcript ? `${transcript} ${chunk}` : chunk;
      }
      if (!transcript) return;
      setInput((prev) => appendTranscriptToInput(prev, transcript));
      setVoiceFeedback('Transcripción añadida al input.');
    };

    recognition.onerror = (event: any) => {
      speechRecognitionRef.current = null;
      setVoiceState('error');
      setVoiceFeedback(describeVoiceError(String(event?.error || '')));
    };

    recognition.onend = () => {
      speechRecognitionRef.current = null;
      setVoiceState((prev) => (prev === 'error' ? 'error' : 'idle'));
      setVoiceFeedback((prev) => (prev === 'Escuchando...' ? 'Dictado detenido.' : prev));
    };

    try {
      recognition.start();
    } catch (_error) {
      speechRecognitionRef.current = null;
      setVoiceState('error');
      setVoiceFeedback('No se pudo iniciar el dictado. Revisa los permisos del micrófono.');
    }
  };

  const sendCurrent = () => {
    if (sending || isRunning) return;
    if (!input.trim() && selectedFiles.length === 0) return;
    stopVoiceInput('stop');
    onSend(input);
    setInput('');
    setVoiceFeedback('');
  };

  const handleCopyMessage = async (messageId: number, text: string) => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopiedMessageId(messageId);
    if (messageCopyTimerRef.current !== null) {
      window.clearTimeout(messageCopyTimerRef.current);
    }
    messageCopyTimerRef.current = window.setTimeout(() => {
      setCopiedMessageId(null);
      messageCopyTimerRef.current = null;
    }, 1600);
  };

  const handleSendToKaggle = async (code: string) => {
    if (kaggleSending !== null) return;
    const codeHash = code.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 100000;
    setKaggleSending(codeHash);
    try {
      const result = await kaggleSubmit(code, conversationId);
      if (result.ok && result.jobId) {
        setInlineKaggleJobs(prev => {
          if (prev.some(job => job.jobId === result.jobId)) {
            return prev;
          }
          return [...prev, {
            jobId: result.jobId,
            code,
            messageIndex: grouped.length,
            completed: false
          }];
        });
      } else {
        console.error('Kaggle submit error:', result.error);
      }
    } catch (err) {
      console.error('Kaggle submit failed:', err);
    } finally {
      setKaggleSending(null);
    }
  };

  const handleKaggleJobComplete = useCallback((jobId: string, output: KaggleJobOutput) => {
    setInlineKaggleJobs(prev => prev.map(job =>
      job.jobId === jobId ? { ...job, completed: true, output } : job
    ));
  }, []);

  const handleKaggleJobError = useCallback((jobId: string, error: string) => {
    console.error(`Kaggle job ${jobId} error:`, error);
  }, []);

  const attachmentPhase = attachmentPipeline?.phase || 'idle';
  const canSend = (input.trim().length > 0 || selectedFiles.length > 0) && attachmentPhase !== 'processing';
  const canStop = sending || isRunning;
  const pendingUploadBytes = selectedFiles.reduce((sum, file) => {
    return sum + Math.max(0, Number(file?.size) || 0);
  }, 0);
  const composerUploadProgress = uploadProgress
    ? { ...uploadProgress, pending: false, processing: false, ready: false, failed: false }
    : selectedFiles.length > 0
    ? {
        percent: attachmentPhase === 'ready' || attachmentPhase === 'processing' ? 100 : 0,
        uploadedBytes: 0,
        totalBytes: Math.max(0, Math.round(pendingUploadBytes)),
        fileName: String(attachmentPipeline.fileName || selectedFiles[0]?.name || ''),
        fileIndex: Math.max(0, Number(attachmentPipeline.fileIndex) || 0),
        totalFiles: selectedFiles.length,
        pending: attachmentPhase === 'pending' || attachmentPhase === 'idle',
        processing: attachmentPhase === 'processing',
        ready: attachmentPhase === 'ready',
        failed: attachmentPhase === 'error'
      }
    : null;
  const headerStatus = uploadProgress
    ? `Subiendo adjuntos · ${uploadProgress.percent}%`
    : attachmentPhase === 'processing' && selectedFiles.length > 0
    ? 'Procesando adjuntos para contexto...'
    : attachmentPhase === 'ready'
    ? 'Adjuntos listos para contexto'
    : attachmentPhase === 'error' && attachmentPipeline.error
    ? attachmentPipeline.error
    : sending
    ? `Generando · ${formatElapsed(sendElapsedSeconds)}`
    : status || 'Sesion activa';
  const projectLabel = projectContext
    ? `${projectContext.projectName} · ${projectContext.mode}`
    : draftProject
    ? `${draftProject.name} · ${draftProject.contextMode}`
    : '';

  const resolveSelectedFileState = (index: number): { label: string; className: string } => {
    if (attachmentPhase === 'uploading') {
      const activeIndex = Math.max(1, Number(attachmentPipeline.fileIndex) || 1);
      if (index + 1 < activeIndex) {
        return { label: 'listo', className: 'text-emerald-300 border-emerald-500/30' };
      }
      if (index + 1 === activeIndex) {
        return { label: 'subiendo', className: 'text-blue-300 border-blue-500/30' };
      }
      return { label: 'pendiente', className: 'text-zinc-400 border-zinc-700' };
    }
    if (attachmentPhase === 'processing') {
      return { label: 'procesando', className: 'text-cyan-300 border-cyan-500/30' };
    }
    if (attachmentPhase === 'ready') {
      return { label: 'listo', className: 'text-emerald-300 border-emerald-500/30' };
    }
    if (attachmentPhase === 'error') {
      return { label: 'error', className: 'text-red-300 border-red-500/30' };
    }
    return { label: 'pendiente', className: 'text-zinc-400 border-zinc-700' };
  };

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
              {uploadProgress ? (
                <div className="mt-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                    <span className="truncate">
                      {uploadProgress.fileIndex}/{uploadProgress.totalFiles} · {uploadProgress.fileName}
                    </span>
                    <span className="shrink-0">
                      {formatBytes(uploadProgress.uploadedBytes)} / {formatBytes(uploadProgress.totalBytes)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-[width] duration-150 ease-out"
                      style={{ width: `${uploadProgress.percent}%` }}
                    />
                  </div>
                </div>
              ) : null}
              {projectLabel ? (
                <button
                  type="button"
                  onClick={onOpenProjectChats}
                  className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200"
                >
                  <FolderOpen size={11} className="shrink-0" />
                  <span className="truncate">Proyecto: {projectLabel}</span>
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onOpenTokenSaver}
                className={`w-8 h-8 rounded-full border flex items-center justify-center ${
                  tokenSaverOpen
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500'
                }`}
                type="button"
                aria-label="Abrir Token Saver"
              >
                <Zap size={15} />
              </button>
              <button
                onClick={kaggleEnabled ? onOpenKaggleJobs : onToggleKaggle}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (kaggleEnabled) onToggleKaggle();
                }}
                className={`w-8 h-8 rounded-full border flex items-center justify-center ${
                  kaggleEnabled
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                    : 'border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500'
                }`}
                type="button"
                aria-label={kaggleEnabled ? 'Ver jobs de Kaggle (clic derecho para desactivar)' : 'Activar Kaggle en este chat'}
                title={kaggleEnabled ? 'Ver jobs de Kaggle (clic derecho para desactivar)' : 'Activar Kaggle en este chat'}
              >
                <Cloud size={15} />
              </button>
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
          <div className="mt-2 space-y-2">
            <select
              value={activeAgentId}
              onChange={(event) => onAgentChange(event.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200"
              aria-label="Agente activo"
              disabled={sending || isRunning}
            >
              {availableAgents.filter(agent => agent.integration.enabled).map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} {agent.isFree ? '(gratis)' : ''}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={model}
                onChange={(event) => onModelChange(event.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200"
                aria-label={`Modelo para ${activeAgentName || 'IA activa'}`}
              >
                <option value="">Automatico ({activeAgentName || 'IA activa'})</option>
                {options.models.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <select
                value={reasoningEffort}
                onChange={(event) => onReasoningChange(event.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200"
                aria-label={`Nivel de razonamiento para ${activeAgentName || 'IA activa'}`}
              >
                {options.reasoningEfforts.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      <main
        ref={messagesRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-72 space-y-4"
        style={{ paddingTop: headerOffset }}
      >
        {grouped.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-10">Escribe un mensaje para iniciar la conversacion.</div>
        ) : null}
        {loadingMoreMessages ? (
          <div className="text-center text-xs text-zinc-500">Cargando mensajes anteriores...</div>
        ) : null}
        {!loadingMoreMessages && hasMoreMessages ? (
          <div className="text-center text-[11px] text-zinc-600">Desliza hacia arriba para cargar mas</div>
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
                  <MarkdownMessage content={visibleContent} onSendToKaggle={handleSendToKaggle} kaggleSending={kaggleSending !== null} />
                )}
                {!showThinking && hasVisibleContent ? (
                  <div className="mt-1.5 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        void handleCopyMessage(message.id, rawContent);
                      }}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                        copiedMessageId === message.id
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200'
                      }`}
                      aria-label={copiedMessageId === message.id ? 'Mensaje copiado' : 'Copiar mensaje'}
                      title={copiedMessageId === message.id ? 'Copiado' : 'Copiar mensaje'}
                    >
                      {copiedMessageId === message.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                ) : null}
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
                <p className="text-[10px] text-zinc-500 mt-2">
                  {formatDate(message.created_at)}
                  {message.role === 'user' && message.tokens_before != null && message.tokens_after != null ? (
                    <span className="ml-2 text-zinc-400">
                      • {message.tokens_before.toLocaleString('es-ES')} → {message.tokens_after.toLocaleString('es-ES')} tokens
                      {message.savings_percent != null && message.savings_percent > 0 ? (
                        <span className="text-emerald-400"> (-{message.savings_percent}%)</span>
                      ) : null}
                      {message.strategy_name ? (
                        <span className="text-sky-400"> • {message.strategy_name}</span>
                      ) : null}
                    </span>
                  ) : null}
                  {message.input_tokens != null && message.input_tokens > 0 ? (
                    <span className="ml-2 text-blue-400">
                      • {message.input_tokens.toLocaleString('es-ES')} in
                    </span>
                  ) : null}
                  {message.output_tokens != null && message.output_tokens > 0 ? (
                    <span className="ml-2 text-purple-400">
                      • {message.output_tokens.toLocaleString('es-ES')} out
                    </span>
                  ) : null}
                  {message.total_cost != null && message.total_cost > 0 ? (
                    <span className="ml-2 text-yellow-400">
                      • ${message.total_cost.toFixed(4)}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          );
        })}

        {/* Inline Kaggle Jobs */}
        {inlineKaggleJobs.length > 0 && (
          <div className="space-y-2">
            {inlineKaggleJobs.map(job => (
              <KaggleJobInline
                key={job.jobId}
                jobId={job.jobId}
                initialCode={job.code}
                onComplete={(output) => handleKaggleJobComplete(job.jobId, output)}
                onError={(error) => handleKaggleJobError(job.jobId, error)}
              />
            ))}
          </div>
        )}

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

      </main>

      <div className="fixed bottom-[74px] left-0 right-0 p-4 bg-gradient-to-t from-black via-black/90 to-transparent z-[60] pointer-events-none">
        {selectedFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2 overflow-x-hidden pointer-events-auto">
            {selectedFiles.map((file, index) => {
              const fileState = resolveSelectedFileState(index);
              return (
                <span
                  key={file.name + file.size}
                  className={`max-w-full truncate text-xs bg-zinc-900 border px-2 py-1 rounded-lg ${fileState.className}`}
                >
                  {file.name} · {formatBytes(Number(file.size) || 0)} · {fileState.label}
                </span>
              );
            })}
            <button onClick={onClearFiles} className="text-xs bg-zinc-900 border border-zinc-700 px-2 py-1 rounded-lg text-zinc-400" type="button">
              <X size={14} className="inline mr-1" /> limpiar
            </button>
          </div>
        ) : null}
        {voiceState === 'listening' || voiceFeedback ? (
          <div
            className={`mb-2 rounded-xl border px-3 py-2 pointer-events-auto ${
              voiceState === 'listening'
                ? 'border-red-500/30 bg-red-500/10'
                : voiceState === 'error'
                ? 'border-amber-500/30 bg-amber-500/10'
                : 'border-zinc-800 bg-zinc-900/85'
            }`}
          >
            <p
              className={`text-[11px] ${
                voiceState === 'listening'
                  ? 'text-red-200'
                  : voiceState === 'error'
                  ? 'text-amber-200'
                  : 'text-zinc-300'
              }`}
            >
              {voiceState === 'listening'
                ? 'Micrófono activo. Habla y vuelve a tocar el icono para detener.'
                : voiceFeedback}
            </p>
          </div>
        ) : null}
        {composerUploadProgress ? (
          <div className="mb-2 rounded-xl border border-zinc-800 bg-zinc-900/85 px-3 py-2 pointer-events-auto">
            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
              <span className="truncate">
                {composerUploadProgress.failed
                  ? `Error al subir · ${attachmentPipeline.error || 'revisa espacio/red y reintenta'}`
                  : composerUploadProgress.ready
                  ? `Adjuntos listos · ${composerUploadProgress.totalFiles} archivo${
                      composerUploadProgress.totalFiles === 1 ? '' : 's'
                    }`
                  : composerUploadProgress.processing
                  ? `Procesando adjuntos · ${composerUploadProgress.totalFiles} archivo${
                      composerUploadProgress.totalFiles === 1 ? '' : 's'
                    }`
                  : composerUploadProgress.pending
                  ? `Listo para subir · ${composerUploadProgress.totalFiles} archivo${
                      composerUploadProgress.totalFiles === 1 ? '' : 's'
                    }`
                  : `${composerUploadProgress.fileIndex}/${composerUploadProgress.totalFiles} · ${composerUploadProgress.fileName}`}
              </span>
              <span className="shrink-0">
                {composerUploadProgress.failed
                  ? 'error'
                  : composerUploadProgress.pending
                  ? '0%'
                  : `${Math.max(0, Math.min(100, Math.round(composerUploadProgress.percent)))}%`}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-150 ease-out ${
                  composerUploadProgress.failed
                    ? 'bg-red-500'
                    : composerUploadProgress.pending
                    ? 'bg-zinc-600'
                    : composerUploadProgress.ready
                    ? 'bg-emerald-500'
                    : composerUploadProgress.processing
                    ? 'bg-cyan-500'
                    : 'bg-blue-500'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, Math.round(composerUploadProgress.percent)))}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-zinc-400">
              {composerUploadProgress.failed
                ? attachmentPipeline.error || 'No se pudo completar la subida de adjuntos.'
                : composerUploadProgress.ready
                ? 'El chat ya puede usar estos archivos como contexto.'
                : composerUploadProgress.processing
                ? 'Validando adjuntos y preparando contexto en backend...'
                : composerUploadProgress.pending
                ? `La subida empieza al enviar · ${formatBytes(composerUploadProgress.totalBytes)}`
                : `${formatBytes(composerUploadProgress.uploadedBytes)} / ${formatBytes(composerUploadProgress.totalBytes)}`}
            </p>
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

          <button
            onClick={toggleVoiceInput}
            className={`w-10 h-10 flex items-center justify-center rounded-xl border transition-colors ${
              voiceState === 'listening'
                ? 'border-red-500/40 bg-red-500/15 text-red-200'
                : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-800'
            } ${voiceSupported ? '' : 'hover:border-amber-500/30'}`}
            type="button"
            aria-label={voiceState === 'listening' ? 'Detener dictado por voz' : 'Dictar mensaje con voz'}
            title={
              voiceSupported
                ? voiceState === 'listening'
                  ? 'Detener dictado'
                  : 'Dictar mensaje'
                : 'Reconocimiento de voz no disponible en este navegador'
            }
          >
            <Mic size={18} />
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
