import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  Square,
  TerminalSquare
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { startTerminalLiveStream } from '../lib/api';
import { consumeSse } from '../lib/sse';
import {
  buildChatGPTDiagnosticExport,
  buildTerminalLiveParsedOutput,
  extractUrls,
  parseCommandBlock,
  type DockerPsEntry,
  type DfEntry,
  type FreeEntry,
  type SystemdSummary,
  type TerminalLiveParsedOutput,
  type TerminalLiveSessionState,
  type TerminalLiveWarning
} from '../lib/terminalLive';

const TERMINAL_LIVE_KEY = 'codexweb_terminal_live_sessions_v1';
const TERMINAL_LIVE_LIMIT = 18;
const TERMINAL_LIVE_TIMEOUT_MS = 1000 * 60 * 3;
const URL_PATTERN = /(https?:\/\/[^\s<>"')]+)/g;

type TerminalLiveApiError = Error & {
  status?: number;
  data?: {
    dangerousDetected?: boolean;
    warnings?: Array<{ id?: string; label?: string; detail?: string }>;
    error?: string;
  };
};

interface TerminalLiveSession {
  id: string;
  command: string;
  preview: string;
  startedAt: string;
  finishedAt: string;
  state: TerminalLiveSessionState;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  warnings: TerminalLiveWarning[];
  parsed: TerminalLiveParsedOutput | null;
  urls: string[];
  cwd: string;
  runAsUser: string;
  timeoutMs: number;
  outputTruncated: boolean;
}

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

function formatDurationMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  const mins = Math.floor(seconds / 60);
  const remain = Math.round(seconds % 60);
  return `${mins}m ${String(remain).padStart(2, '0')}s`;
}

function formatTimeoutMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '--';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${mins}m ${String(remain).padStart(2, '0')}s`;
}

function buildSessionId() {
  return `terminal_live_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function mergeWarnings(...groups: Array<TerminalLiveWarning[] | null | undefined>): TerminalLiveWarning[] {
  const next = new Map<string, TerminalLiveWarning>();
  groups.forEach((group) => {
    (group || []).forEach((warning) => {
      const normalized: TerminalLiveWarning = {
        id: String(warning?.id || 'warning').trim() || 'warning',
        label: String(warning?.label || warning?.detail || 'Advertencia').trim() || 'Advertencia',
        detail: String(warning?.detail || '').trim()
      };
      next.set(`${normalized.id}:${normalized.label}`, normalized);
    });
  });
  return Array.from(next.values());
}

function normalizeWarningList(rawWarnings: unknown): TerminalLiveWarning[] {
  if (!Array.isArray(rawWarnings)) return [];
  return rawWarnings
    .map((warning) => ({
      id: String((warning as any)?.id || 'warning').trim() || 'warning',
      label: String((warning as any)?.label || (warning as any)?.detail || 'Advertencia').trim() || 'Advertencia',
      detail: String((warning as any)?.detail || '').trim()
    }))
    .filter((warning) => warning.label);
}

function deriveSession(session: TerminalLiveSession): TerminalLiveSession {
  const parsed = buildTerminalLiveParsedOutput(session.command, session.stdout, session.stderr, session.exitCode);
  return {
    ...session,
    parsed,
    warnings: mergeWarnings(session.warnings, parsed.warnings),
    urls: Array.from(new Set([...(session.urls || []), ...extractUrls(`${session.stdout}\n${session.stderr}`), ...parsed.urls]))
  };
}

function hydrateSession(rawValue: any): TerminalLiveSession | null {
  const command = String(rawValue?.command || '').trim();
  if (!command) return null;
  const parsedCommand = parseCommandBlock(command);
  const session: TerminalLiveSession = {
    id: String(rawValue?.id || buildSessionId()),
    command,
    preview: parsedCommand.preview || 'Comando',
    startedAt: String(rawValue?.startedAt || new Date().toISOString()),
    finishedAt: String(rawValue?.finishedAt || ''),
    state:
      rawValue?.state === 'typing' ||
      rawValue?.state === 'blocked' ||
      rawValue?.state === 'waiting_confirmation' ||
      rawValue?.state === 'executing' ||
      rawValue?.state === 'streaming' ||
      rawValue?.state === 'success' ||
      rawValue?.state === 'error' ||
      rawValue?.state === 'canceled' ||
      rawValue?.state === 'timeout' ||
      rawValue?.state === 'exporting' ||
      rawValue?.state === 'copied'
        ? rawValue.state
        : 'idle',
    exitCode: Number.isFinite(Number(rawValue?.exitCode)) ? Number(rawValue.exitCode) : null,
    durationMs: Number.isFinite(Number(rawValue?.durationMs)) ? Number(rawValue.durationMs) : 0,
    stdout: String(rawValue?.stdout || ''),
    stderr: String(rawValue?.stderr || ''),
    warnings: normalizeWarningList(rawValue?.warnings),
    parsed: null,
    urls: Array.isArray(rawValue?.urls)
      ? rawValue.urls.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
      : [],
    cwd: String(rawValue?.cwd || '/root/CodexWeb'),
    runAsUser: String(rawValue?.runAsUser || ''),
    timeoutMs: Number.isFinite(Number(rawValue?.timeoutMs)) ? Number(rawValue.timeoutMs) : TERMINAL_LIVE_TIMEOUT_MS,
    outputTruncated: Boolean(rawValue?.outputTruncated)
  };
  return deriveSession(session);
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

function renderInlineText(text: string) {
  const value = String(text || '');
  const parts = value.split(URL_PATTERN);
  return parts.map((part, index) => {
    if (!part) return null;
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={`link_${index}_${part}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-sky-300 underline underline-offset-2 break-all"
        >
          {part}
        </a>
      );
    }
    return <span key={`text_${index}`}>{part}</span>;
  });
}

function LogBlock({ text, tone = 'plain' }: { text: string; tone?: 'plain' | 'warning' | 'error' }) {
  const lines = String(text || '').split('\n');
  return (
    <pre
      className={`max-h-72 overflow-auto rounded-2xl border px-3 py-3 text-xs whitespace-pre-wrap break-words ${
        tone === 'error'
          ? 'border-red-500/30 bg-red-500/5 text-red-100'
          : tone === 'warning'
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-100'
            : 'border-zinc-800 bg-black/40 text-zinc-200'
      }`}
    >
      {lines.map((line, index) => {
        const lower = line.toLowerCase();
        const lineTone =
          /(\berror\b|\bfailed\b|\bdenied\b|\bfatal\b)/.test(lower)
            ? 'text-red-300'
            : /(\bwarn(ing)?\b|\btimeout\b)/.test(lower)
              ? 'text-amber-300'
              : /(\bactive:\b|\bok\b|\brunning\b|\bhealthy\b)/.test(lower)
                ? 'text-emerald-300'
                : 'text-inherit';
        return (
          <div key={`log_${index}`} className={lineTone}>
            {renderInlineText(line)}
          </div>
        );
      })}
    </pre>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">{title}</p>;
}

function StateBadge({ state }: { state: TerminalLiveSessionState }) {
  const tone =
    state === 'success'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
      : state === 'error' || state === 'timeout'
        ? 'border-red-500/40 bg-red-500/10 text-red-200'
        : state === 'waiting_confirmation' || state === 'blocked'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          : state === 'canceled'
            ? 'border-zinc-700 bg-zinc-800/80 text-zinc-300'
            : 'border-sky-500/40 bg-sky-500/10 text-sky-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide ${tone}`}>
      {(state === 'executing' || state === 'streaming' || state === 'exporting') ? (
        <LoaderCircle size={11} className="animate-spin" />
      ) : null}
      {state.replace(/_/g, ' ')}
    </span>
  );
}

function DockerSection({ entries }: { entries: DockerPsEntry[] }) {
  return (
    <div className="grid gap-2">
      {entries.map((entry) => (
        <article key={`${entry.containerId}:${entry.names}`} className="rounded-2xl border border-zinc-800 bg-black/35 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100 break-words">{entry.names}</p>
              <p className="text-xs text-zinc-400 break-words">{entry.image}</p>
            </div>
            <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[10px] uppercase text-zinc-300">
              {entry.status || 'unknown'}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
              <p className="text-[10px] uppercase text-zinc-500">Container ID</p>
              <p className="mt-1 break-all">{entry.containerId}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
              <p className="text-[10px] uppercase text-zinc-500">Ports</p>
              <p className="mt-1 break-all">{entry.ports || '-'}</p>
            </div>
          </div>
          {entry.command ? (
            <p className="mt-2 text-[11px] text-zinc-500 break-words">{entry.command}</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function DiskSection({ entries }: { entries: DfEntry[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map((entry) => (
        <article key={`${entry.filesystem}:${entry.mountedOn}`} className="rounded-2xl border border-zinc-800 bg-black/35 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100 break-words">{entry.mountedOn}</p>
              <p className="text-xs text-zinc-400 break-words">{entry.filesystem}</p>
            </div>
            <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[10px] uppercase text-zinc-300">
              {entry.use}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-zinc-300">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
              <p className="text-[10px] uppercase text-zinc-500">Size</p>
              <p className="mt-1">{entry.size}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
              <p className="text-[10px] uppercase text-zinc-500">Used</p>
              <p className="mt-1">{entry.used}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
              <p className="text-[10px] uppercase text-zinc-500">Avail</p>
              <p className="mt-1">{entry.avail}</p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function MemorySection({ rows }: { rows: FreeEntry[] }) {
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <article key={row.label} className="rounded-2xl border border-zinc-800 bg-black/35 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-100">{row.label}</p>
            <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[10px] uppercase text-zinc-300">
              total {row.total}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300 sm:grid-cols-3">
            {[
              ['Used', row.used],
              ['Free', row.free],
              ['Shared', row.shared || '-'],
              ['Buff/Cache', row.buffCache || '-'],
              ['Available', row.available || '-']
            ].map(([label, value]) => (
              <div key={`${row.label}_${label}`} className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
                <p className="text-[10px] uppercase text-zinc-500">{label}</p>
                <p className="mt-1">{value}</p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function SystemdSection({ summary, logs }: { summary: SystemdSummary; logs: string[] }) {
  return (
    <div className="space-y-3">
      <article className="rounded-2xl border border-zinc-800 bg-black/35 p-3">
        <p className="text-sm font-medium text-zinc-100 break-words">{summary.headline}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300">
          {[
            ['Loaded', summary.loaded || '-'],
            ['Active', summary.active || '-'],
            ['Main PID', summary.mainPid || '-'],
            ['Tasks', summary.tasks || '-'],
            ['Memory', summary.memory || '-'],
            ['CPU', summary.cpu || '-']
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
              <p className="text-[10px] uppercase text-zinc-500">{label}</p>
              <p className="mt-1 break-words">{value}</p>
            </div>
          ))}
        </div>
      </article>
      {logs.length > 0 ? <LogBlock text={logs.join('\n')} tone="plain" /> : null}
    </div>
  );
}

export default function TerminalLivePanel({ onClose }: { onClose?: () => void }) {
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<TerminalLiveSession[]>([]);
  const [screenState, setScreenState] = useState<TerminalLiveSessionState>('idle');
  const [statusText, setStatusText] = useState('Pega un comando o bloque bash para ejecutarlo en /root/CodexWeb.');
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    sessionId: string;
    command: string;
    warnings: TerminalLiveWarning[];
  } | null>(null);
  const [expandedRawBySession, setExpandedRawBySession] = useState<Record<string, boolean>>({});
  const [copiedSessionId, setCopiedSessionId] = useState('');
  const [exportedSessionId, setExportedSessionId] = useState('');
  const [copiedUrl, setCopiedUrl] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const activeRunRef = useRef<{
    sessionId: string;
    controller: AbortController;
    expectedCancel: boolean;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TERMINAL_LIVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const hydrated = parsed
        .map((entry) => hydrateSession(entry))
        .filter((entry): entry is TerminalLiveSession => Boolean(entry));
      if (hydrated.length > 0) {
        setSessions(hydrated.slice(-TERMINAL_LIVE_LIMIT));
      }
    } catch (_error) {
      // ignore local persistence errors
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_LIVE_KEY, JSON.stringify(sessions.slice(-TERMINAL_LIVE_LIMIT)));
    } catch (_error) {
      // ignore local persistence errors
    }
  }, [sessions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [sessions.length, sessions[sessions.length - 1]?.stdout.length, sessions[sessions.length - 1]?.stderr.length]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      if (activeRunRef.current) {
        activeRunRef.current.expectedCancel = true;
        activeRunRef.current.controller.abort();
      }
    };
  }, []);

  const running = useMemo(() => {
    return sessions.some((session) => session.state === 'executing' || session.state === 'streaming');
  }, [sessions]);

  const quickCommands = useMemo(
    () => [
      'echo ok',
      'pwd',
      'df -h',
      'free -h',
      'docker ps',
      'systemctl status codexweb --no-pager || true',
      'journalctl -u codexweb -n 50 --no-pager || true'
    ],
    []
  );

  const updateSession = (sessionId: string, updater: (session: TerminalLiveSession) => TerminalLiveSession) => {
    setSessions((prev) =>
      prev.map((session) => (session.id === sessionId ? deriveSession(updater(session)) : session))
    );
  };

  const appendSession = (session: TerminalLiveSession) => {
    setSessions((prev) => [...prev.slice(-(TERMINAL_LIVE_LIMIT - 1)), deriveSession(session)]);
  };

  const finishTransientState = (nextState: TerminalLiveSessionState, message: string, sessionId?: string, kind?: 'copy' | 'export' | 'url') => {
    setScreenState(nextState);
    setStatusText(message);
    if (kind === 'copy' && sessionId) setCopiedSessionId(sessionId);
    if (kind === 'export' && sessionId) setExportedSessionId(sessionId);
    if (kind === 'url' && sessionId) setCopiedUrl(sessionId);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedSessionId('');
      setExportedSessionId('');
      setCopiedUrl('');
      if (!activeRunRef.current && !pendingConfirmation) {
        if (input.trim()) {
          setScreenState('typing');
          setStatusText('Listo para ejecutar el siguiente bloque.');
        } else {
          setScreenState('idle');
          setStatusText('Pega un comando o bloque bash para ejecutarlo en /root/CodexWeb.');
        }
      }
      copyTimerRef.current = null;
    }, 1600);
  };

  const stopRun = () => {
    if (!activeRunRef.current) return;
    activeRunRef.current.expectedCancel = true;
    activeRunRef.current.controller.abort();
    setScreenState('canceled');
    setStatusText('Cancelando ejecucion...');
  };

  const clearLiveHistory = () => {
    if (running) return;
    setSessions([]);
    setExpandedRawBySession({});
    setPendingConfirmation(null);
    setScreenState(input.trim() ? 'typing' : 'idle');
    setStatusText(input.trim() ? 'Listo para ejecutar el siguiente bloque.' : 'Historial local limpiado.');
    try {
      localStorage.removeItem(TERMINAL_LIVE_KEY);
    } catch (_error) {
      // ignore local persistence errors
    }
  };

  const executeCommand = async (
    rawCommand: string,
    options?: { confirmDangerous?: boolean; reuseSessionId?: string }
  ) => {
    if (activeRunRef.current) {
      setScreenState('blocked');
      setStatusText('Ya hay un comando en ejecucion.');
      return;
    }

    const parsedCommand = parseCommandBlock(rawCommand);
    if (!parsedCommand.command) {
      setScreenState('blocked');
      setStatusText('Escribe un comando o pega un bloque bash.');
      return;
    }

    const sessionId = options?.reuseSessionId || buildSessionId();
    const startedAt = new Date().toISOString();
    const baseSession: TerminalLiveSession = deriveSession({
      id: sessionId,
      command: parsedCommand.command,
      preview: parsedCommand.preview,
      startedAt,
      finishedAt: '',
      state: 'executing',
      exitCode: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      warnings: [],
      parsed: null,
      urls: [],
      cwd: '/root/CodexWeb',
      runAsUser: '',
      timeoutMs: TERMINAL_LIVE_TIMEOUT_MS,
      outputTruncated: false
    });

    if (options?.reuseSessionId) {
      updateSession(sessionId, () => baseSession);
    } else {
      appendSession(baseSession);
    }

    setPendingConfirmation(null);
    setScreenState('executing');
    setStatusText(`Ejecutando: ${parsedCommand.preview}`);
    if (!options?.reuseSessionId) {
      setInput('');
    }

    const controller = new AbortController();
    activeRunRef.current = {
      sessionId,
      controller,
      expectedCancel: false
    };

    try {
      const response = await startTerminalLiveStream({
        command: parsedCommand.command,
        timeoutMs: TERMINAL_LIVE_TIMEOUT_MS,
        confirmDangerous: options?.confirmDangerous === true,
        signal: controller.signal
      });

      await consumeSse(response, {
        session: (payload) => {
          updateSession(sessionId, (session) => ({
            ...session,
            runAsUser: String(payload?.runAsUser || session.runAsUser || ''),
            cwd: String(payload?.cwd || session.cwd || '/root/CodexWeb'),
            timeoutMs: Number.isFinite(Number(payload?.timeoutMs)) ? Number(payload.timeoutMs) : session.timeoutMs,
            warnings: mergeWarnings(session.warnings, normalizeWarningList(payload?.warnings))
          }));
        },
        state: (payload) => {
          const nextState =
            payload?.state === 'streaming' ||
            payload?.state === 'executing' ||
            payload?.state === 'timeout' ||
            payload?.state === 'error'
              ? payload.state
              : 'executing';
          updateSession(sessionId, (session) => ({
            ...session,
            state: nextState
          }));
          setScreenState(nextState);
          setStatusText(nextState === 'streaming' ? 'Recibiendo salida...' : `Estado: ${nextState.replace(/_/g, ' ')}`);
        },
        stdout: (payload) => {
          const chunk = String(payload?.text || '');
          if (!chunk) return;
          updateSession(sessionId, (session) => ({
            ...session,
            state: 'streaming',
            stdout: `${session.stdout}${chunk}`
          }));
          setScreenState('streaming');
          setStatusText('Streaming de stdout...');
        },
        stderr: (payload) => {
          const chunk = String(payload?.text || '');
          if (!chunk) return;
          updateSession(sessionId, (session) => ({
            ...session,
            state: 'streaming',
            stderr: `${session.stderr}${chunk}`
          }));
          setScreenState('streaming');
          setStatusText('Streaming de stderr...');
        },
        done: (payload) => {
          const timedOut = Boolean(payload?.timedOut);
          const ok = Boolean(payload?.ok);
          const finalState: TerminalLiveSessionState = timedOut ? 'timeout' : ok ? 'success' : 'error';
          updateSession(sessionId, (session) => ({
            ...session,
            state: finalState,
            exitCode: Number.isFinite(Number(payload?.exitCode)) ? Number(payload.exitCode) : session.exitCode,
            durationMs: Number.isFinite(Number(payload?.durationMs)) ? Number(payload.durationMs) : session.durationMs,
            stdout: String(payload?.stdout || session.stdout || ''),
            stderr: String(payload?.stderr || session.stderr || ''),
            finishedAt: String(payload?.finishedAt || new Date().toISOString()),
            warnings: mergeWarnings(session.warnings, normalizeWarningList(payload?.warnings)),
            outputTruncated: Boolean(payload?.outputTruncated)
          }));
          setScreenState(finalState);
          setStatusText(
            timedOut
              ? 'El comando alcanzo el timeout.'
              : ok
                ? 'Comando completado.'
                : 'El comando termino con error.'
          );
        }
      });
    } catch (error) {
      const typedError = error as TerminalLiveApiError;
      const wasCanceled = Boolean(activeRunRef.current?.expectedCancel) || String(typedError?.name || '') === 'AbortError';
      if (wasCanceled) {
        updateSession(sessionId, (session) => ({
          ...session,
          state: 'canceled',
          finishedAt: new Date().toISOString()
        }));
        setScreenState('canceled');
        setStatusText('Ejecucion cancelada.');
      } else if (typedError?.status === 409 && typedError?.data?.dangerousDetected) {
        const warnings = normalizeWarningList(typedError.data.warnings);
        updateSession(sessionId, (session) => ({
          ...session,
          state: 'waiting_confirmation',
          warnings: mergeWarnings(session.warnings, warnings),
          stderr: String(typedError?.message || 'Confirmacion requerida.')
        }));
        setPendingConfirmation({
          sessionId,
          command: parsedCommand.command,
          warnings
        });
        setScreenState('waiting_confirmation');
        setStatusText('Bloque detectado: confirma antes de ejecutar.');
      } else {
        updateSession(sessionId, (session) => ({
          ...session,
          state: 'error',
          stderr: `${session.stderr}${session.stderr ? '\n' : ''}${String(typedError?.message || 'No se pudo ejecutar el comando.')}`,
          finishedAt: new Date().toISOString()
        }));
        setScreenState('error');
        setStatusText(String(typedError?.message || 'No se pudo ejecutar el comando.'));
      }
    } finally {
      if (activeRunRef.current?.sessionId === sessionId) {
        activeRunRef.current = null;
      }
    }
  };

  const handleCopyOutput = async (session: TerminalLiveSession) => {
    const text = [session.stdout, session.stderr].filter(Boolean).join('\n');
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    finishTransientState('copied', 'Salida copiada al portapapeles.', session.id, 'copy');
  };

  const handleCopyUrl = async (url: string) => {
    const ok = await copyTextToClipboard(url);
    if (!ok) return;
    finishTransientState('copied', 'URL copiada.', url, 'url');
  };

  const handleExport = async (session: TerminalLiveSession) => {
    setScreenState('exporting');
    setStatusText('Exportando diagnostico Markdown...');
    const markdown = buildChatGPTDiagnosticExport({
      command: session.command,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      state: session.state,
      exitCode: session.exitCode,
      durationMs: session.durationMs,
      stdout: session.stdout,
      stderr: session.stderr,
      warnings: session.warnings,
      parsed: session.parsed
    });
    const ok = await copyTextToClipboard(markdown);
    if (!ok) {
      setScreenState('error');
      setStatusText('No se pudo copiar el diagnostico.');
      return;
    }
    finishTransientState('copied', 'Diagnostico Markdown copiado.', session.id, 'export');
  };

  useEffect(() => {
    if (activeRunRef.current || pendingConfirmation) return;
    if (input.trim()) {
      setScreenState((prev) => (prev === 'copied' || prev === 'exporting' ? prev : 'typing'));
      setStatusText('Listo para ejecutar el siguiente bloque.');
      return;
    }
    setScreenState((prev) => (prev === 'copied' || prev === 'exporting' ? prev : 'idle'));
    setStatusText((prev) =>
      prev === 'Historial local limpiado.' ? prev : 'Pega un comando o bloque bash para ejecutarlo en /root/CodexWeb.'
    );
  }, [input, pendingConfirmation]);

  return (
    <section className="fixed inset-x-2 bottom-[88px] top-[max(72px,env(safe-area-inset-top)+56px)] z-[190] overflow-y-auto rounded-[28px] border border-zinc-800 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_38%),linear-gradient(180deg,rgba(24,24,27,0.96),rgba(9,9,11,0.99))] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.4)] space-y-4 sm:left-auto sm:right-4 sm:top-24 sm:bottom-4 sm:w-[min(560px,calc(100vw-2rem))]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TerminalSquare size={18} className="text-sky-300 shrink-0" />
            <h2 className="text-sm font-semibold text-zinc-100">Terminal Live</h2>
            <StateBadge state={screenState} />
          </div>
          <p className="mt-1 text-xs text-zinc-400">{statusText}</p>
          <p className="mt-2 text-[11px] text-zinc-500">
            Ejecuta bloques completos con streaming real, parser visual y export listo para ChatGPT.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={clearLiveHistory}
            disabled={running || sessions.length === 0}
            className="rounded-full border border-zinc-700 bg-zinc-950/70 px-3 py-1.5 text-[11px] text-zinc-300 disabled:opacity-40"
          >
            Limpiar
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/70 text-zinc-300"
              aria-label="Cerrar Terminal Live"
            >
              <ChevronDown size={18} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-black/35 p-3">
        <div className="flex flex-wrap gap-2">
          {quickCommands.map((command) => (
            <button
              key={command}
              type="button"
              onClick={() => {
                setInput(command);
                setScreenState('typing');
                setStatusText('Atajo cargado en el composer.');
              }}
              className="rounded-full border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
            >
              {command}
            </button>
          ))}
        </div>
      </div>

      {pendingConfirmation ? (
        <article className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-100">Comando bloqueado hasta confirmar</p>
              <p className="mt-1 text-xs text-amber-200/80 break-words">{parseCommandBlock(pendingConfirmation.command).preview}</p>
              <div className="mt-3 space-y-2">
                {pendingConfirmation.warnings.map((warning) => (
                  <div key={`${warning.id}:${warning.label}`} className="rounded-xl border border-amber-500/30 bg-black/20 px-3 py-2 text-xs text-amber-100">
                    <p className="font-medium">{warning.label}</p>
                    {warning.detail ? <p className="mt-1 text-amber-100/80 break-words">{warning.detail}</p> : null}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void executeCommand(pendingConfirmation.command, {
                      confirmDangerous: true,
                      reuseSessionId: pendingConfirmation.sessionId
                    });
                  }}
                  className="rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-100"
                >
                  Ejecutar igualmente
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateSession(pendingConfirmation.sessionId, (session) => ({
                      ...session,
                      state: 'canceled',
                      finishedAt: new Date().toISOString(),
                      stderr: `${session.stderr}${session.stderr ? '\n' : ''}Cancelado antes de confirmar.`
                    }));
                    setPendingConfirmation(null);
                    setScreenState('canceled');
                    setStatusText('Comando cancelado antes de ejecutar.');
                  }}
                  className="rounded-xl border border-zinc-700 bg-black/35 px-3 py-2 text-xs text-zinc-300"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </article>
      ) : null}

      <form
        className="rounded-[24px] border border-zinc-800 bg-black/45 p-3 shadow-inner shadow-black/20"
        onSubmit={(event) => {
          event.preventDefault();
          void executeCommand(input);
        }}
      >
        <div className="flex items-start gap-2">
          <textarea
            rows={4}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void executeCommand(input);
              }
            }}
            placeholder={'set -e\necho "== sistema =="\nhostname'}
            className="min-h-[112px] flex-1 resize-y rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          <div className="flex shrink-0 flex-col gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (!text) return;
                  setInput((prev) => (prev.trim() ? `${prev}\n${text}` : text));
                  setScreenState('typing');
                  setStatusText('Bloque pegado desde el portapapeles.');
                } catch (_error) {
                  setScreenState('error');
                  setStatusText('No se pudo leer el portapapeles.');
                }
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-950/70 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
              aria-label="Pegar desde portapapeles"
              title="Pegar"
            >
              <Clipboard size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setInput('');
                setScreenState('idle');
                setStatusText('Composer vaciado.');
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-950/70 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
              aria-label="Vaciar composer"
              title="Vaciar"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type={running ? 'button' : 'submit'}
              onClick={running ? stopRun : undefined}
              disabled={!running && !input.trim()}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border text-white transition-colors ${
                running
                  ? 'border-red-500/50 bg-red-600'
                  : input.trim()
                    ? 'border-sky-400/40 bg-sky-500'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-500'
              } disabled:opacity-50`}
              aria-label={running ? 'Cancelar ejecucion' : 'Ejecutar bloque'}
              title={running ? 'Cancelar' : 'Ejecutar'}
            >
              {running ? <Square size={16} /> : <Play size={16} />}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          `Enter` ejecuta. `Shift+Enter` inserta nueva linea. Los bloques multi-linea se ejecutan como una sola unidad.
        </p>
      </form>

      <div className="space-y-5">
        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-black/20 px-4 py-8 text-center text-sm text-zinc-500">
            Aun no hay sesiones. Ejecuta `echo ok` o pega el bloque de diagnostico para empezar.
          </div>
        ) : null}

        {sessions.map((session) => {
          const rawText = [session.stdout, session.stderr].filter(Boolean).join('\n');
          const parsed = session.parsed;
          const expandedRaw = Boolean(expandedRawBySession[session.id]);
          return (
            <article key={session.id} className="space-y-3">
              <div className="flex justify-end">
                <div className="max-w-[92%] rounded-[28px] rounded-br-md border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-50 shadow-[0_14px_38px_rgba(14,165,233,0.12)]">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200/80">Comando</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-6">{session.command}</pre>
                  <p className="mt-2 text-[10px] text-sky-100/60">{formatTime(session.startedAt)}</p>
                </div>
              </div>

              <div className="flex justify-start">
                <div className="max-w-[96%] rounded-[28px] rounded-tl-md border border-zinc-800 bg-zinc-950/90 px-4 py-4 shadow-[0_20px_44px_rgba(0,0,0,0.24)] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StateBadge state={session.state} />
                      {session.exitCode !== null ? (
                        <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[10px] uppercase text-zinc-300">
                          exit {session.exitCode}
                        </span>
                      ) : null}
                      {session.durationMs > 0 ? (
                        <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[10px] uppercase text-zinc-300">
                          {formatDurationMs(session.durationMs)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void handleCopyOutput(session);
                        }}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border ${
                          copiedSessionId === session.id
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                            : 'border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                        }`}
                        aria-label="Copiar salida"
                        title="Copiar salida"
                      >
                        {copiedSessionId === session.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleExport(session);
                        }}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border ${
                          exportedSessionId === session.id
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                            : 'border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100'
                        }`}
                        aria-label="Exportar diagnostico"
                        title="Exportar diagnostico"
                      >
                        {exportedSessionId === session.id ? <Check size={14} /> : <FileText size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void executeCommand(session.command);
                        }}
                        disabled={running}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40"
                        aria-label="Reintentar comando"
                        title="Reintentar"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedRawBySession((prev) => ({ ...prev, [session.id]: !prev[session.id] }));
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                        aria-label={expandedRaw ? 'Ocultar salida raw' : 'Ver salida raw'}
                        title={expandedRaw ? 'Ocultar raw' : 'Ver raw'}
                      >
                        {expandedRaw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
                    <span>cwd: {session.cwd || '/root/CodexWeb'}</span>
                    {session.runAsUser ? <span>usuario: {session.runAsUser}</span> : null}
                    <span>timeout: {formatTimeoutMs(session.timeoutMs)}</span>
                    {session.outputTruncated ? <span>salida truncada al maximo configurado</span> : null}
                  </div>

                  {session.warnings.length > 0 ? (
                    <div className="space-y-2">
                      <SectionHeader title="Warnings" />
                      {session.warnings.map((warning) => (
                        <div key={`${warning.id}:${warning.label}`} className="rounded-2xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-100">
                          <div className="flex items-start gap-2">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
                            <div className="min-w-0">
                              <p className="font-medium">{warning.label}</p>
                              {warning.detail ? <p className="mt-1 text-amber-100/80 break-words">{warning.detail}</p> : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {parsed && parsed.urls.length > 0 ? (
                    <div className="space-y-2">
                      <SectionHeader title="URLs detectadas" />
                      <div className="flex flex-wrap gap-2">
                        {parsed.urls.map((url) => (
                          <div key={url} className="flex max-w-full items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-[11px] text-zinc-200">
                            <a href={url} target="_blank" rel="noreferrer" className="truncate text-sky-300 underline underline-offset-2">
                              {url}
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                void handleCopyUrl(url);
                              }}
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
                                copiedUrl === url ? 'bg-emerald-500/10 text-emerald-200' : 'text-zinc-400 hover:text-zinc-100'
                              }`}
                              aria-label="Copiar URL"
                            >
                              {copiedUrl === url ? <Check size={12} /> : <ExternalLink size={12} />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {parsed ? (
                    <div className="space-y-3">
                      {parsed.sections.map((section, index) => (
                        <div key={`${session.id}_${section.kind}_${index}`} className="space-y-2">
                          <SectionHeader title={section.title} />
                          {section.kind === 'docker_ps' ? <DockerSection entries={section.containers} /> : null}
                          {section.kind === 'df_h' ? <DiskSection entries={section.mounts} /> : null}
                          {section.kind === 'free_h' ? <MemorySection rows={section.rows} /> : null}
                          {section.kind === 'systemd' ? <SystemdSection summary={section.summary} logs={section.logs} /> : null}
                          {section.kind === 'journal' ? <LogBlock text={section.lines.join('\n')} tone="plain" /> : null}
                          {section.kind === 'json' ? <LogBlock text={section.text} tone="plain" /> : null}
                          {section.kind === 'raw' ? (
                            <LogBlock
                              text={section.text}
                              tone={
                                section.tone === 'stderr'
                                  ? 'warning'
                                  : session.state === 'error' || session.state === 'timeout'
                                    ? 'error'
                                    : 'plain'
                              }
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {expandedRaw && rawText ? (
                    <div className="space-y-2">
                      <SectionHeader title="Raw output" />
                      <LogBlock
                        text={rawText}
                        tone={session.state === 'error' || session.state === 'timeout' ? 'error' : 'plain'}
                      />
                    </div>
                  ) : null}

                  {!rawText && session.state !== 'waiting_confirmation' ? (
                    <div className="rounded-2xl border border-zinc-800 bg-black/20 px-3 py-4 text-sm text-zinc-500">
                      {session.state === 'executing' || session.state === 'streaming'
                        ? 'Esperando salida del proceso...'
                        : 'La sesion termino sin salida visible.'}
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
        <div ref={endRef} />
      </div>
    </section>
  );
}
