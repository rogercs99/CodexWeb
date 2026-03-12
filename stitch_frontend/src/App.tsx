import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoginScreen from './components/LoginScreen';
import ChatHubScreen from './components/ChatHubScreen';
import ChatScreen from './components/ChatScreen';
import SearchScreen from './components/SearchScreen';
import TerminalLogScreen from './components/TerminalLogScreen';
import AttachmentsScreen from './components/AttachmentsScreen';
import SettingsScreen from './components/SettingsScreen';
import SystemRebootScreen from './components/SystemRebootScreen';
import OfflineErrorScreen from './components/OfflineErrorScreen';
import {
  createProject,
  deleteAttachment,
  deleteProject,
  deleteConversation,
  getChatOptions,
  getCodexRuns,
  getMe,
  getRestartStatus,
  getStorageHealth,
  getToolsStorageJobs,
  killConversationSession,
  listAttachments,
  listConversations,
  listProjects,
  listMessages,
  login,
  logout,
  moveConversationToProject,
  regenerateProjectContext,
  restartServer,
  startChatStream,
  updateProject,
  updateConversationSettings,
  updateConversationTitle,
  preflightAttachmentUpload,
  uploadAttachment
} from './lib/api';
import { consumeSse } from './lib/sse';
import type {
  AttachmentItem,
  Capabilities,
  ChatProject,
  ChatOptions,
  CodexBackgroundRun,
  Conversation,
  ConversationProjectContext,
  MessageAttachment,
  Message,
  RestartState,
  Screen,
  TaskRecovery,
  ToolsStorageJob,
  StorageHealthSnapshot,
  TerminalEntry,
  User
} from './lib/types';

const DEFAULT_MODEL_KEY = 'codexweb_model';
const DEFAULT_REASONING_KEY = 'codexweb_reasoning_effort';
const TERMINAL_KEY = 'codexweb_terminal_entries_v1';
const LIVE_DRAFT_PREFIX = 'codexweb_live_draft_v1';
const DRAFT_PERSIST_THROTTLE_MS = 150;
const DEFAULT_MODEL = 'gpt-5.3-codex';
const DEFAULT_REASONING_EFFORT = 'xhigh';
const DRAFT_CONVERSATION = 'draft';
const MESSAGES_PAGE_SIZE = 60;
const UPLOAD_PROGRESS_SETTLE_MS = 650;

function byDateDesc<T extends { last_message_at?: string; created_at?: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const ta = Date.parse(a.last_message_at || a.created_at || '');
    const tb = Date.parse(b.last_message_at || b.created_at || '');
    if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
    return 0;
  });
}

function classifyTerminalStatus(rawStatus: string, exitCode: number | null): TerminalEntry['kind'] {
  const status = String(rawStatus || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (status === 'running' || status === 'in_progress') return 'running';
  if (status === 'failed' || status === 'error' || status === 'declined') return 'error';
  if (status === 'completed' || status === 'ok' || status === 'success') {
    return exitCode && exitCode !== 0 ? 'error' : 'success';
  }
  return 'notice';
}

function listRunningConversationIds(runs: CodexBackgroundRun[]): number[] {
  return Array.from(
    new Set(
      (runs || [])
        .map((run) => Number(run && run.conversationId))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  )
    .sort((a, b) => a - b) as number[];
}

function sameIdList(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function prependUniqueMessages(olderMessages: Message[], currentMessages: Message[]): Message[] {
  if (!Array.isArray(olderMessages) || olderMessages.length === 0) return currentMessages;
  if (!Array.isArray(currentMessages) || currentMessages.length === 0) return olderMessages;

  const currentIds = new Set(
    currentMessages
      .map((entry) => Number(entry && entry.id))
      .filter((id) => Number.isInteger(id))
  );
  const uniqueOlder = olderMessages.filter((entry) => !currentIds.has(Number(entry && entry.id)));
  if (uniqueOlder.length === 0) return currentMessages;
  return [...uniqueOlder, ...currentMessages];
}

function normalizeModelForOptions(value: string, opts: ChatOptions): string {
  const normalized = String(value || '').trim();
  const models = Array.isArray(opts.models) ? opts.models : [];
  if (normalized && models.includes(normalized)) return normalized;
  const defaultModel = String(opts.defaults?.model || '').trim();
  if (defaultModel && (models.length === 0 || models.includes(defaultModel))) {
    return defaultModel;
  }
  return models.length > 0 ? String(models[0] || '').trim() : '';
}

function normalizeReasoningForOptions(value: string, opts: ChatOptions): string {
  const normalized = String(value || '').trim().toLowerCase();
  const efforts = Array.isArray(opts.reasoningEfforts) ? opts.reasoningEfforts : [];
  if (normalized && efforts.includes(normalized)) return normalized;
  const defaultEffort = String(opts.defaults?.reasoningEffort || '').trim().toLowerCase();
  if (defaultEffort && (efforts.length === 0 || efforts.includes(defaultEffort))) {
    return defaultEffort;
  }
  return efforts.length > 0 ? String(efforts[0] || '').trim().toLowerCase() : DEFAULT_REASONING_EFFORT;
}

function formatEtaShort(seconds: number | null): string {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return '--';
  const total = Math.max(1, Math.round(Number(seconds)));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const remain = total % 60;
  return `${mins}m ${String(remain).padStart(2, '0')}s`;
}

interface HubBackgroundNotice {
  jobId: string;
  text: string;
  details?: string;
  tone: 'info' | 'success' | 'error';
  loading: boolean;
  canDismiss: boolean;
  updatedAtMs: number;
}

const HUB_NOTICE_LOOKBACK_MS = 1000 * 60 * 45;
const HUB_NOTICE_MAX_ITEMS = 5;

function parseIsoMs(value: string): number {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncateHubNoticeText(value: string, maxLen = 260): string {
  const text = String(value || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function formatBytesShort(value: number | null | undefined): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function buildHubJobProgressDetails(job: ToolsStorageJob): string {
  const stageLabel = String(job.progress?.stageLabel || job.progress?.stage || '').trim();
  const percentRaw = Number(job.progress?.percent);
  const percent = Number.isFinite(percentRaw) ? Math.max(0, Math.min(100, Math.round(percentRaw))) : null;
  const etaRaw = Number(job.progress?.etaSeconds);
  const eta = Number.isFinite(etaRaw) && etaRaw > 0 ? formatEtaShort(Math.round(etaRaw)) : '';
  const chunks: string[] = [];
  if (stageLabel) chunks.push(`Etapa: ${stageLabel}`);
  if (percent !== null) chunks.push(`Progreso: ${percent}%`);
  if (eta) chunks.push(`ETA aprox: ${eta}`);
  return chunks.join(' · ');
}

function buildHubNoticeFromStorageJob(job: ToolsStorageJob): HubBackgroundNotice | null {
  if (!job || !job.id) return null;
  const updatedAtMs = parseIsoMs(String(job.updatedAt || job.finishedAt || job.createdAt || ''));
  const status = String(job.status || '').trim().toLowerCase();
  const isRunning = status === 'running' || status === 'pending';
  const isError = status === 'error';
  const isCompleted = status === 'completed';
  let text = '';
  let details = '';
  let tone: HubBackgroundNotice['tone'] = isRunning ? 'info' : isError ? 'error' : 'success';

  if (job.type === 'cleanup_residual_analyze') {
    if (isRunning) {
      text = 'Analizando residuos con IA';
      details = buildHubJobProgressDetails(job) || 'Escaneando y clasificando residuales.';
    } else if (isCompleted) {
      const candidateCount = Array.isArray(job.result?.candidates) ? job.result.candidates.length : 0;
      const aiUsed = Boolean(job.result?.ai?.used);
      const providerName = String(job.result?.ai?.providerName || job.result?.ai?.providerId || '').trim();
      const fallbackReason = String(job.result?.ai?.fallbackReason || '').trim();
      text = aiUsed ? 'Limpieza IA completada' : 'Limpieza completada con fallback heurístico';
      details = [
        `${candidateCount} candidato(s)`,
        aiUsed ? `Proveedor: ${providerName || 'IA'}` : `Motivo fallback: ${fallbackReason || 'IA no disponible'}`
      ]
        .filter(Boolean)
        .join(' · ');
      tone = aiUsed ? 'success' : 'error';
    } else if (isError) {
      text = 'Limpieza IA falló';
      details = truncateHubNoticeText(String(job.error || 'error no especificado'));
      tone = 'error';
    }
  } else if (job.type === 'git_merge_branches') {
    const source = String(job.payload?.sourceBranch || job.result?.merge?.sourceBranch || '').trim();
    const target = String(job.payload?.targetBranch || job.result?.merge?.targetBranch || '').trim();
    const pair = source && target ? `${source} -> ${target}` : 'ramas';
    if (isRunning) {
      text = `Mergeando ${pair}`;
      details = buildHubJobProgressDetails(job) || 'Merge en segundo plano en curso.';
    } else if (isCompleted) {
      const mergeStatus = String(job.result?.merge?.status || '').trim().toLowerCase();
      if (mergeStatus === 'conflict') {
        const conflictCount = Array.isArray(job.result?.merge?.conflictFiles)
          ? job.result.merge.conflictFiles.length
          : 0;
        text = `Merge con conflictos: ${pair}`;
        details = conflictCount > 0 ? `${conflictCount} archivo(s) en conflicto.` : 'Requiere resolución manual.';
        tone = 'error';
      } else {
        text = `Merge completado: ${pair}`;
        details = truncateHubNoticeText(String(job.result?.merge?.output || job.log || ''), 240) || 'Sin conflictos.';
        tone = 'success';
      }
    } else if (isError) {
      text = `Merge falló: ${pair}`;
      details = truncateHubNoticeText(String(job.error || 'error no especificado'));
      tone = 'error';
    }
  } else if (job.type === 'local_delete_paths') {
    if (isRunning) {
      text = 'Borrando rutas locales';
      details = buildHubJobProgressDetails(job) || 'Borrado local en curso.';
    } else if (isCompleted) {
      text = 'Borrado local completado';
      details = truncateHubNoticeText(String(job.result?.summary || job.log || 'Operación finalizada.'));
      tone = 'success';
    } else if (isError) {
      text = 'Borrado local falló';
      details = truncateHubNoticeText(String(job.error || 'error no especificado'));
      tone = 'error';
    }
  } else if (job.type === 'drive_upload_files') {
    if (isRunning) {
      text = 'Subiendo archivos a Google Drive';
      details = buildHubJobProgressDetails(job) || 'Subida en curso.';
    } else if (isCompleted) {
      text = 'Subida a Google Drive completada';
      details = truncateHubNoticeText(String(job.log || 'Operación finalizada.'));
      tone = 'success';
    } else if (isError) {
      text = 'Subida a Google Drive falló';
      details = truncateHubNoticeText(String(job.error || 'error no especificado'));
      tone = 'error';
    }
  } else if (job.type === 'deployed_backup_create' || job.type === 'deployed_backup_restore') {
    const isRestore = job.type === 'deployed_backup_restore';
    if (isRunning) {
      text = isRestore ? 'Restaurando backup de app' : 'Creando backup de app';
      details = buildHubJobProgressDetails(job) || (isRestore ? 'Restauración en curso.' : 'Backup en curso.');
    } else if (isCompleted) {
      text = isRestore ? 'Restauración completada' : 'Backup completado';
      details = truncateHubNoticeText(String(job.log || 'Operación finalizada.'));
      tone = 'success';
    } else if (isError) {
      text = isRestore ? 'Restauración falló' : 'Backup falló';
      details = truncateHubNoticeText(String(job.error || 'error no especificado'));
      tone = 'error';
    }
  } else if (job.type === 'project_context_refresh') {
    const projectName = String(job.payload?.projectName || job.progress?.projectName || job.result?.project?.name || 'proyecto').trim();
    if (isRunning) {
      text = `Actualizando contexto de ${projectName}`;
      details = buildHubJobProgressDetails(job) || 'Sintetizando memoria automática del proyecto.';
    } else if (isCompleted) {
      const aiUsed = Boolean(job.result?.ai?.used);
      const providerName = String(job.result?.ai?.providerName || job.result?.ai?.providerId || '').trim();
      const fallbackReason = String(job.result?.ai?.fallbackReason || '').trim();
      text = aiUsed ? `Contexto de ${projectName} actualizado` : `Contexto de ${projectName} (fallback heurístico)`;
      details = aiUsed
        ? `Proveedor: ${providerName || 'IA'}`
        : `Fallback: ${fallbackReason || 'IA no disponible'}`;
      tone = aiUsed ? 'success' : 'error';
    } else if (isError) {
      text = `Falló actualización de ${projectName}`;
      details = truncateHubNoticeText(String(job.error || 'error no especificado'));
      tone = 'error';
    }
  }

  if (!text) return null;
  return {
    jobId: job.id,
    text,
    details,
    tone,
    loading: isRunning,
    canDismiss: !isRunning,
    updatedAtMs
  };
}

function buildHubNoticeFromStorageHealth(health: StorageHealthSnapshot | null): HubBackgroundNotice | null {
  if (!health) return null;
  if (health.status !== 'warning' && health.status !== 'critical') return null;
  const available = formatBytesShort(health.availableBytes);
  const threshold =
    health.status === 'critical'
      ? formatBytesShort(health.thresholds?.criticalFreeBytes ?? null)
      : formatBytesShort(health.thresholds?.warningFreeBytes ?? null);
  const usedPercent =
    Number.isFinite(Number(health.usedPercent)) && Number(health.usedPercent) >= 0
      ? `${Math.round(Number(health.usedPercent))}%`
      : 'n/d';
  return {
    jobId: `storage_health_${health.status}`,
    text:
      health.status === 'critical'
        ? 'Falta espacio en disco para que CodexWeb funcione correctamente'
        : 'Espacio en disco bajo: conviene liberar almacenamiento',
    details: `Libre: ${available} · Umbral ${health.status}: ${threshold} · Uso: ${usedPercent} · Revisa Tools > Observabilidad / Storage.`,
    tone: health.status === 'critical' ? 'error' : 'info',
    loading: false,
    canDismiss: false,
    updatedAtMs: Date.now()
  };
}

interface LiveChatDraft {
  username: string;
  conversationId: number | null;
  messageId: number;
  requestId: string;
  userMessage: Message;
  assistantMessage: Message;
  reasoningByItem: Record<string, string>;
  completed: boolean;
  updatedAt: string;
}

interface NavigateData {
  chatId?: number;
  draftMessage?: string;
  autoSend?: boolean;
}

interface UploadProgressState {
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  fileName: string;
  fileIndex: number;
  totalFiles: number;
}

interface AttachmentPipelineState {
  phase: 'idle' | 'pending' | 'uploading' | 'processing' | 'ready' | 'error';
  fileIndex: number;
  totalFiles: number;
  fileName: string;
  error: string;
}

function getSafeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch (_error) {
    return null;
  }
}

function normalizeUsername(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function draftStorageKey(username: string, conversationId: number | null, messageId: number): string {
  const convPart =
    Number.isInteger(conversationId) && conversationId && conversationId > 0
      ? String(conversationId)
      : DRAFT_CONVERSATION;
  return `${LIVE_DRAFT_PREFIX}:${normalizeUsername(username)}:${convPart}:${messageId}`;
}

function parseDraftStorageKey(key: string): { username: string; conversationPart: string; messageId: string } | null {
  const prefix = `${LIVE_DRAFT_PREFIX}:`;
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const parts = rest.split(':');
  if (parts.length !== 3) return null;
  return { username: parts[0], conversationPart: parts[1], messageId: parts[2] };
}

function readAllDrafts(username: string): Array<{ storageKey: string; draft: LiveChatDraft }> {
  const storage = getSafeLocalStorage();
  if (!storage) return [];
  const normalized = normalizeUsername(username);
  if (!normalized) return [];
  const result: Array<{ storageKey: string; draft: LiveChatDraft }> = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    const parsedKey = parseDraftStorageKey(key);
    if (!parsedKey || parsedKey.username !== normalized) continue;
    try {
      const parsed = JSON.parse(storage.getItem(key) || '{}') as LiveChatDraft;
      if (!parsed || typeof parsed !== 'object') continue;
      result.push({ storageKey: key, draft: parsed });
    } catch (_error) {
      // ignore malformed storage
    }
  }
  return result;
}

function mergeMessagesWithDraft(
  serverMessages: Message[],
  draft: LiveChatDraft | null,
  options?: { hideAssistantContentWhileRunning?: boolean }
): Message[] {
  const next = [...serverMessages];
  if (!draft || draft.completed) return next;

  const hideAssistantContentWhileRunning = Boolean(options?.hideAssistantContentWhileRunning);
  const draftAssistantIdRaw = Number.isInteger(draft.assistantMessage?.id)
    ? Number(draft.assistantMessage.id)
    : Number(draft.messageId);
  const draftAssistantId = Number.isInteger(draftAssistantIdRaw) ? draftAssistantIdRaw : null;

  const findAssistantIndex = () => {
    if (draftAssistantId !== null) {
      const byIdIndex = next.findIndex(
        (item) => item.role === 'assistant' && Number(item.id) === draftAssistantId
      );
      if (byIdIndex >= 0) return byIdIndex;
    }
    return next.reduce((acc, item, index) => (item.role === 'assistant' ? index : acc), -1);
  };

  const targetAssistantIndex = findAssistantIndex();

  if (hideAssistantContentWhileRunning) {
    if (targetAssistantIndex >= 0) {
      next[targetAssistantIndex] = {
        ...next[targetAssistantIndex],
        content: ''
      };
      return next;
    }
    next.push({
      id: draftAssistantId !== null ? draftAssistantId : draft.messageId,
      role: 'assistant',
      content: '',
      created_at:
        String(draft.assistantMessage?.created_at || '') ||
        String(draft.userMessage?.created_at || '') ||
        new Date().toISOString()
    });
    return next;
  }

  const draftAssistant = String(draft.assistantMessage?.content || '');
  if (!draftAssistant) return next;

  if (targetAssistantIndex >= 0) {
    const current = String(next[targetAssistantIndex].content || '');
    if (current === draftAssistant || current.startsWith(draftAssistant)) {
      return next;
    }
    if (draftAssistant.startsWith(current)) {
      next[targetAssistantIndex] = {
        ...next[targetAssistantIndex],
        content: draftAssistant
      };
      return next;
    }
  }

  next.push({
    ...draft.assistantMessage,
    id: draft.assistantMessage.id || draft.messageId
  });
  return next;
}

function serializeReasoning(map: Map<string, string>): string {
  return Array.from(map.values())
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join('\n\n');
}

function sanitizeTerminalEntries(raw: unknown): TerminalEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry: any) => {
      const parsedConversationId = Number(entry.conversationId);
      const conversationId =
        Number.isInteger(parsedConversationId) && parsedConversationId > 0 ? parsedConversationId : null;
      return {
        id: String(entry.id || ''),
        itemId: String(entry.itemId || ''),
        conversationId,
        kind:
          entry.kind === 'running' || entry.kind === 'success' || entry.kind === 'error' || entry.kind === 'notice'
            ? entry.kind
            : 'notice',
        command: String(entry.command || ''),
        output: String(entry.output || ''),
        statusText: String(entry.statusText || ''),
        timestamp: String(entry.timestamp || ''),
        durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : 0
      };
    })
    .filter((entry) => entry.id);
}

function normalizeTerminalConversationId(value: unknown): number | null {
  const parsedConversationId = Number(value);
  if (!Number.isInteger(parsedConversationId) || parsedConversationId <= 0) {
    return null;
  }
  return parsedConversationId;
}

function buildTerminalEntriesFromTaskRecovery(
  conversationId: number,
  taskRecovery: TaskRecovery | null | undefined
): TerminalEntry[] {
  if (!taskRecovery || !Array.isArray(taskRecovery.commands)) return [];
  return taskRecovery.commands
    .map((command, index) => {
      const itemId = String(command.itemId || command.id || `recovered_${index + 1}`);
      const statusText = String(command.status || 'notice');
      return {
        id: `taskrec_${taskRecovery.taskId}_${itemId}`,
        itemId,
        conversationId,
        kind: classifyTerminalStatus(statusText, command.exitCode),
        command: String(command.command || '(comando)'),
        output: String(command.output || ''),
        statusText,
        timestamp: String(command.startedAt || command.finishedAt || new Date().toISOString()),
        durationMs: Number.isFinite(Number(command.durationMs)) ? Number(command.durationMs) : 0
      } as TerminalEntry;
    })
    .sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''));
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [unassignedConversationCount, setUnassignedConversationCount] = useState(0);
  const [draftProjectId, setDraftProjectId] = useState<number | null>(null);
  const [activeConversationProjectContext, setActiveConversationProjectContext] =
    useState<ConversationProjectContext | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [runningConversationIds, setRunningConversationIds] = useState<number[]>([]);
  const [chatTitle, setChatTitle] = useState('Nuevo chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [messagesLoadingMore, setMessagesLoadingMore] = useState(false);
  const [messagesNextBeforeId, setMessagesNextBeforeId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sendStartedAtMs, setSendStartedAtMs] = useState<number | null>(null);
  const [sendElapsedSeconds, setSendElapsedSeconds] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [attachmentPipeline, setAttachmentPipeline] = useState<AttachmentPipelineState>({
    phase: 'idle',
    fileIndex: 0,
    totalFiles: 0,
    fileName: '',
    error: ''
  });
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [options, setOptions] = useState<ChatOptions>({
    models: [],
    reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaults: { model: DEFAULT_MODEL, reasoningEffort: DEFAULT_REASONING_EFFORT },
    activeAgentId: 'codex-cli',
    activeAgentName: 'Codex CLI',
    runtimeProvider: 'codex'
  });
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL);
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState(DEFAULT_REASONING_EFFORT);
  const [chatModel, setChatModel] = useState(DEFAULT_MODEL);
  const [chatReasoningEffort, setChatReasoningEffort] = useState(DEFAULT_REASONING_EFFORT);
  const [caps, setCaps] = useState<Capabilities>({ web: true, code: true, memory: true });
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [offlineMessage, setOfflineMessage] = useState('No se pudo contactar al servidor.');
  const [hubBackgroundNotices, setHubBackgroundNotices] = useState<HubBackgroundNotice[]>([]);
  const [restartState, setRestartState] = useState<RestartState | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [liveReasoning, setLiveReasoning] = useState('');
  const [pendingChatDraft, setPendingChatDraft] = useState<{
    chatId: number;
    message: string;
    autoSend: boolean;
  } | null>(null);

  const streamAbortRef = useRef<AbortController | null>(null);
  const assistantDraftRef = useRef('');
  const liveUserMessageRef = useRef<Message | null>(null);
  const liveAssistantMessageIdRef = useRef<number | null>(null);
  const streamSessionRef = useRef(0);
  const activeStreamConversationRef = useRef<number | null>(null);
  const reasoningByItemRef = useRef<Map<string, string>>(new Map());
  const activeDraftStorageKeyRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string>('');
  const draftPersistTimerRef = useRef<number | null>(null);
  const dismissedHubNoticeIdsRef = useRef<Record<string, true>>({});
  const previousScreenRef = useRef<Screen>('hub');
  const hydrateInFlightRef = useRef<Promise<void> | null>(null);
  const activeConversationIdRef = useRef<number | null>(null);
  const runningConversationIdsRef = useRef<number[]>([]);
  const previousRunningConversationIdsRef = useRef<number[]>([]);
  const sendingRef = useRef(false);
  const messagesHasMoreRef = useRef(false);
  const messagesLoadingMoreRef = useRef(false);
  const messagesNextBeforeIdRef = useRef<number | null>(null);
  const messagesPaginationRequestSeqRef = useRef(0);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    runningConversationIdsRef.current = runningConversationIds;
  }, [runningConversationIds]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    messagesHasMoreRef.current = messagesHasMore;
  }, [messagesHasMore]);

  useEffect(() => {
    messagesLoadingMoreRef.current = messagesLoadingMore;
  }, [messagesLoadingMore]);

  useEffect(() => {
    messagesNextBeforeIdRef.current = messagesNextBeforeId;
  }, [messagesNextBeforeId]);

  useEffect(() => {
    if (!user || screen === 'login' || screen === 'offline' || screen === 'reboot') {
      setHubBackgroundNotices((prev) => prev.filter((entry) => !entry.loading));
      return;
    }
    let cancelled = false;
    const pollBackgroundJobs = async () => {
      try {
        const [jobs, storageHealth] = await Promise.all([
          getToolsStorageJobs(90),
          getStorageHealth().catch(() => null)
        ]);
        if (cancelled) return;
        const allowedTypes = new Set([
          'cleanup_residual_analyze',
          'git_merge_branches',
          'local_delete_paths',
          'drive_upload_files',
          'deployed_backup_create',
          'deployed_backup_restore',
          'project_context_refresh'
        ]);
        const nowMs = Date.now();
        const nextNotices = (Array.isArray(jobs) ? jobs : [])
          .filter((entry) => allowedTypes.has(String(entry.type || '')))
          .sort((a, b) => {
            const aTs = parseIsoMs(String(a.updatedAt || a.finishedAt || a.createdAt || ''));
            const bTs = parseIsoMs(String(b.updatedAt || b.finishedAt || b.createdAt || ''));
            return bTs - aTs;
          })
          .map((entry) => buildHubNoticeFromStorageJob(entry))
          .filter((entry): entry is HubBackgroundNotice => Boolean(entry))
          .filter((entry) => {
            if (entry.loading) return true;
            if (dismissedHubNoticeIdsRef.current[entry.jobId]) return false;
            return entry.updatedAtMs >= nowMs - HUB_NOTICE_LOOKBACK_MS;
          })
          .slice(0, HUB_NOTICE_MAX_ITEMS);
        const storageNotice = buildHubNoticeFromStorageHealth(storageHealth);
        setHubBackgroundNotices(storageNotice ? [storageNotice, ...nextNotices] : nextNotices);
      } catch (_error) {
        // polling best-effort only.
      }
    };
    void pollBackgroundJobs();
    const timer = window.setInterval(() => {
      void pollBackgroundJobs();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [screen, user]);

  const handleDismissHubBackgroundNotice = useCallback((jobId: string) => {
    const safeJobId = String(jobId || '').trim();
    if (!safeJobId) return;
    dismissedHubNoticeIdsRef.current[safeJobId] = true;
    setHubBackgroundNotices((prev) => prev.filter((entry) => entry.loading || entry.jobId !== safeJobId));
  }, []);

  const resetTransientStreamState = useCallback(() => {
    if (draftPersistTimerRef.current !== null) {
      window.clearTimeout(draftPersistTimerRef.current);
      draftPersistTimerRef.current = null;
    }
    streamAbortRef.current = null;
    activeStreamConversationRef.current = null;
    assistantDraftRef.current = '';
    liveUserMessageRef.current = null;
    liveAssistantMessageIdRef.current = null;
    reasoningByItemRef.current = new Map();
    activeDraftStorageKeyRef.current = null;
    activeRequestIdRef.current = '';
    setLiveReasoning('');
    setSending(false);
    setSendStartedAtMs(null);
    setSendElapsedSeconds(0);
    setUploadProgress(null);
  }, []);

  const resolveActiveUsername = useCallback(
    (usernameOverride?: string | null) => normalizeUsername(usernameOverride || user?.username || ''),
    [user]
  );

  const saveDraftSnapshot = useCallback(
    (draft: LiveChatDraft, storageKeyOverride?: string | null): string | null => {
      const normalizedUser = resolveActiveUsername(draft.username);
      if (!normalizedUser) return null;
      const normalizedDraft: LiveChatDraft = {
        ...draft,
        username: normalizedUser,
        updatedAt: new Date().toISOString()
      };
      const key =
        storageKeyOverride ||
        draftStorageKey(normalizedUser, normalizedDraft.conversationId, normalizedDraft.messageId);
      const storage = getSafeLocalStorage();
      if (!storage) return null;
      try {
        storage.setItem(key, JSON.stringify(normalizedDraft));
        return key;
      } catch (_error) {
        return null;
      }
    },
    [resolveActiveUsername]
  );

  const deleteDraftSnapshot = useCallback((storageKey: string | null | undefined) => {
    if (!storageKey) return;
    const storage = getSafeLocalStorage();
    if (!storage) return;
    try {
      storage.removeItem(storageKey);
    } catch (_error) {
      // ignore
    }
  }, []);

  const getLiveDraftForConversation = useCallback(
    (conversationId: number | null, usernameOverride?: string | null): { storageKey: string; draft: LiveChatDraft } | null => {
      const normalizedUser = resolveActiveUsername(usernameOverride);
      if (!normalizedUser) return null;
      const drafts = readAllDrafts(normalizedUser)
        .filter(({ draft }) => !draft.completed)
        .filter(({ draft }) => {
          if (conversationId === null) return draft.conversationId === null;
          return draft.conversationId === conversationId;
        })
        .sort((a, b) => Date.parse(b.draft.updatedAt || '') - Date.parse(a.draft.updatedAt || ''));
      return drafts.length > 0 ? drafts[0] : null;
    },
    [resolveActiveUsername]
  );

  const updateActiveDraft = useCallback(
    (mutator: (draft: LiveChatDraft) => LiveChatDraft, options?: { rekey?: boolean }) => {
      const storageKey = activeDraftStorageKeyRef.current;
      if (!storageKey) return;
      const storage = getSafeLocalStorage();
      if (!storage) return;
      try {
        const raw = storage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as LiveChatDraft;
        if (!parsed || typeof parsed !== 'object') return;
        const nextDraft = mutator(parsed);
        const previousKey = storageKey;
        const nextKey = saveDraftSnapshot(nextDraft, options?.rekey ? null : previousKey);
        if (!nextKey) return;
        if (nextKey !== previousKey) {
          deleteDraftSnapshot(previousKey);
        }
        activeDraftStorageKeyRef.current = nextKey;
      } catch (_error) {
        // ignore
      }
    },
    [deleteDraftSnapshot, saveDraftSnapshot]
  );

  const persistActiveDraftNow = useCallback(
    (completed: boolean) => {
      const normalizedUser = resolveActiveUsername();
      const userMessage = liveUserMessageRef.current;
      const assistantMessageId = liveAssistantMessageIdRef.current;
      if (!normalizedUser || !userMessage || assistantMessageId === null) return;

      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: assistantDraftRef.current,
        created_at: userMessage.created_at
      };
      const draftPayload: LiveChatDraft = {
        username: normalizedUser,
        conversationId: activeStreamConversationRef.current,
        messageId: assistantMessageId,
        requestId: activeRequestIdRef.current || `req_${Date.now()}`,
        userMessage,
        assistantMessage,
        reasoningByItem: Object.fromEntries(reasoningByItemRef.current),
        completed,
        updatedAt: new Date().toISOString()
      };

      if (!activeDraftStorageKeyRef.current) {
        activeDraftStorageKeyRef.current = saveDraftSnapshot(draftPayload, null);
        return;
      }

      updateActiveDraft(
        () => draftPayload,
        {
          rekey:
            draftPayload.conversationId !== null &&
            activeDraftStorageKeyRef.current.includes(`:${DRAFT_CONVERSATION}:`)
        }
      );
    },
    [resolveActiveUsername, saveDraftSnapshot, updateActiveDraft]
  );

  const scheduleDraftPersist = useCallback(
    (completed: boolean) => {
      if (completed) {
        if (draftPersistTimerRef.current !== null) {
          window.clearTimeout(draftPersistTimerRef.current);
          draftPersistTimerRef.current = null;
        }
        persistActiveDraftNow(true);
        return;
      }
      if (draftPersistTimerRef.current !== null) return;
      draftPersistTimerRef.current = window.setTimeout(() => {
        draftPersistTimerRef.current = null;
        persistActiveDraftNow(false);
      }, DRAFT_PERSIST_THROTTLE_MS);
    },
    [persistActiveDraftNow]
  );

  const cancelActiveStream = useCallback(
    (statusMessage?: string) => {
      const draftId = liveAssistantMessageIdRef.current;
      const hasDraftContent = assistantDraftRef.current.trim().length > 0;
      if (draftId !== null) {
        persistActiveDraftNow(false);
      }
      streamSessionRef.current += 1;
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
      if (draftId !== null && !hasDraftContent) {
        setMessages((prev) => prev.filter((entry) => entry.id !== draftId));
      }
      resetTransientStreamState();
      if (statusMessage) {
        setStatus(statusMessage);
      }
    },
    [persistActiveDraftNow, resetTransientStreamState]
  );

  const detachActiveStream = useCallback(
    (statusMessage?: string) => {
      if (liveAssistantMessageIdRef.current !== null) {
        persistActiveDraftNow(false);
      }
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
      if (statusMessage) {
        setStatus(statusMessage);
      }
    },
    [persistActiveDraftNow]
  );

  const forceFinalizeStaleStream = useCallback(
    (statusMessage: string) => {
      const draftId = liveAssistantMessageIdRef.current;
      const hasDraftContent = assistantDraftRef.current.trim().length > 0;

      streamSessionRef.current += 1;
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }

      if (draftId !== null) {
        persistActiveDraftNow(hasDraftContent);
      }

      if (draftId !== null && !hasDraftContent) {
        setMessages((prev) => prev.filter((entry) => entry.id !== draftId));
        deleteDraftSnapshot(activeDraftStorageKeyRef.current);
      }

      resetTransientStreamState();
      setStatus(statusMessage);
    },
    [deleteDraftSnapshot, persistActiveDraftNow, resetTransientStreamState]
  );

  const persistTerminal = useCallback((next: TerminalEntry[]) => {
    setTerminalEntries(next);
    try {
      localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
    } catch (_error) {
      // ignore
    }
  }, []);

  const clearTerminalForConversation = useCallback((conversationId: number | null) => {
    setTerminalEntries((prev) => {
      const next = prev.filter((entry) => {
        const normalizedConversationId = normalizeTerminalConversationId(entry.conversationId);
        if (conversationId === null) return normalizedConversationId !== null;
        return normalizedConversationId !== conversationId;
      });
      if (next.length === prev.length) return prev;
      try {
        localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
      } catch (_error) {
        // ignore
      }
      return next;
    });
  }, []);

  const clearTerminalForMissingChats = useCallback((conversationIds: number[]) => {
    const knownConversationIds = new Set(
      (conversationIds || []).filter((id) => Number.isInteger(id) && id > 0)
    );
    setTerminalEntries((prev) => {
      const next = prev.filter((entry) => {
        const conversationId = normalizeTerminalConversationId(entry.conversationId);
        if (conversationId === null) return true;
        return knownConversationIds.has(conversationId);
      });
      if (next.length === prev.length) return prev;
      try {
        localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
      } catch (_error) {
        // ignore
      }
      return next;
    });
  }, []);

  const applyTaskRecoveryToTerminal = useCallback(
    (conversationId: number | null, taskRecovery: TaskRecovery | null | undefined) => {
      if (!conversationId || conversationId <= 0) return;
      const recovered = buildTerminalEntriesFromTaskRecovery(conversationId, taskRecovery);
      setTerminalEntries((prev) => {
        const base = prev.filter((entry) => {
          const entryConversationId = normalizeTerminalConversationId(entry.conversationId);
          if (entryConversationId !== conversationId) return true;
          return !String(entry.id || '').startsWith('taskrec_');
        });
        const next = recovered.length > 0 ? [...base, ...recovered] : base;
        try {
          localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
        } catch (_error) {
          // ignore
        }
        return next;
      });
    },
    []
  );

  const upsertTerminal = useCallback(
    (itemId: string, patch: Partial<TerminalEntry>) => {
      setTerminalEntries((prev) => {
        const idx = prev.findIndex((item) => item.itemId && item.itemId === itemId);
        if (idx === -1) {
          const created: TerminalEntry = {
            id: itemId || `cmd_${Date.now()}`,
            itemId,
            conversationId:
              Number.isInteger(Number(patch.conversationId)) && Number(patch.conversationId) > 0
                ? Number(patch.conversationId)
                : null,
            kind: patch.kind || 'notice',
            command: patch.command || '(comando)',
            output: patch.output || '',
            statusText: patch.statusText || 'notice',
            timestamp: patch.timestamp || new Date().toISOString(),
            durationMs: patch.durationMs || 0
          };
          const merged = [...prev, created];
          try {
            localStorage.setItem(TERMINAL_KEY, JSON.stringify(merged));
          } catch (_error) {
            // ignore
          }
          return merged;
        }

        const next = [...prev];
        const current = next[idx];
        next[idx] = {
          ...current,
          ...patch,
          output: patch.output !== undefined ? patch.output : current.output
        };
        try {
          localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
        } catch (_error) {
          // ignore
        }
        return next;
      });
    },
    []
  );

  const appendTerminalNotice = useCallback((text: string) => {
    if (!text.trim()) return;
    setTerminalEntries((prev) => {
      const parsedConversationId = Number(activeStreamConversationRef.current);
      const conversationId =
        Number.isInteger(parsedConversationId) && parsedConversationId > 0 ? parsedConversationId : null;
      const next = [
        ...prev,
        {
          id: `note_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
          itemId: '',
          conversationId,
          kind: 'notice',
          command: text,
          output: '',
          statusText: 'notice',
          timestamp: new Date().toISOString(),
          durationMs: 0
        } as TerminalEntry
      ];
      try {
        localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
      } catch (_error) {
        // ignore
      }
      return next;
    });
  }, []);

  const refreshRunningConversationIds = useCallback(async (): Promise<number[]> => {
    try {
      const runs = await getCodexRuns();
      const nextIds = listRunningConversationIds(runs);
      setRunningConversationIds((prev) => (sameIdList(prev, nextIds) ? prev : nextIds));
      return nextIds;
    } catch (_error) {
      return runningConversationIdsRef.current;
    }
  }, []);

  const applyLoadedMessagesPagination = useCallback(
    (pagination: { hasMore?: boolean; nextBeforeId?: number | null } | null | undefined) => {
      const rawNextBeforeId = Number(pagination && pagination.nextBeforeId);
      const nextBeforeId =
        Number.isInteger(rawNextBeforeId) && rawNextBeforeId > 0 ? rawNextBeforeId : null;
      const hasMore = Boolean(pagination && pagination.hasMore) && nextBeforeId !== null;
      setMessagesHasMore(hasMore);
      setMessagesNextBeforeId(hasMore ? nextBeforeId : null);
      setMessagesLoadingMore(false);
    },
    []
  );

  const loadConversationsAndPick = useCallback(
    async (preferredId?: number | null, usernameOverride?: string | null) => {
      messagesPaginationRequestSeqRef.current += 1;
      setMessagesLoadingMore(false);
      const [rows, runningIds, projectsPayload]: [
        Conversation[],
        number[],
        { projects: ChatProject[]; unassignedCount: number }
      ] = await Promise.all([
        listConversations(),
        refreshRunningConversationIds(),
        listProjects().catch(() => ({ projects: [], unassignedCount: 0 }))
      ]);
      const sorted = byDateDesc(rows);
      setConversations(sorted);
      setProjects(projectsPayload.projects);
      setUnassignedConversationCount(projectsPayload.unassignedCount);
      setSelectedProjectId((current) => {
        if (current === null) return null;
        return projectsPayload.projects.some((project) => project.id === current) ? current : null;
      });
      clearTerminalForMissingChats(sorted.map((item) => item.id));

      const chosenId =
        preferredId && sorted.some((item) => item.id === preferredId)
          ? preferredId
          : sorted.length > 0
            ? sorted[0].id
            : null;

      if (!chosenId) {
        const draftOnly = getLiveDraftForConversation(null, usernameOverride);
        setActiveConversationId(null);
        setActiveConversationProjectContext(null);
        setChatTitle('Nuevo chat');
        setMessages(
          draftOnly
            ? mergeMessagesWithDraft([], draftOnly.draft, {
                hideAssistantContentWhileRunning: false
              })
            : []
        );
        setLiveReasoning(
          draftOnly ? serializeReasoning(new Map(Object.entries(draftOnly.draft.reasoningByItem || {}))) : ''
        );
        setMessagesHasMore(false);
        setMessagesNextBeforeId(null);
        setChatModel(normalizeModelForOptions(defaultModel, options));
        setChatReasoningEffort(normalizeReasoningForOptions(defaultReasoningEffort, options));
        setDraftProjectId(null);
        return;
      }

      const detail = await listMessages(chosenId, { limit: MESSAGES_PAGE_SIZE });
      const localDraft = getLiveDraftForConversation(chosenId, usernameOverride);
      const serverDraft =
        detail.liveDraft && typeof detail.liveDraft === 'object' ? (detail.liveDraft as LiveChatDraft) : null;
      const runningSet = new Set(runningIds);
      const streamStillActive = runningSet.has(chosenId);
      const liveDraft = streamStillActive
        ? serverDraft && !serverDraft.completed
          ? { storageKey: '', draft: serverDraft }
          : localDraft
        : null;
      const hideAssistantWhileRunning = streamStillActive;
      const recoveryPlanText =
        detail.taskRecovery && typeof detail.taskRecovery.planText === 'string'
          ? detail.taskRecovery.planText
          : '';
      setActiveConversationId(chosenId);
      setChatTitle(detail.conversation.title || 'Chat');
      setDraftProjectId(
        Number.isInteger(Number(detail.conversation.projectId)) && Number(detail.conversation.projectId) > 0
          ? Number(detail.conversation.projectId)
          : null
      );
      setActiveConversationProjectContext(detail.projectContext || null);
      setMessages(
        mergeMessagesWithDraft(detail.messages || [], liveDraft ? liveDraft.draft : null, {
          hideAssistantContentWhileRunning: hideAssistantWhileRunning
        })
      );
      setLiveReasoning(
        liveDraft
          ? serializeReasoning(new Map(Object.entries(liveDraft.draft.reasoningByItem || {})))
          : recoveryPlanText
      );
      setChatModel(
        normalizeModelForOptions(
          String(detail.conversation.model || defaultModel || DEFAULT_MODEL),
          options
        )
      );
      setChatReasoningEffort(
        normalizeReasoningForOptions(
          String(detail.conversation.reasoningEffort || defaultReasoningEffort || DEFAULT_REASONING_EFFORT),
          options
        )
      );
      applyLoadedMessagesPagination(detail.pagination);
      applyTaskRecoveryToTerminal(chosenId, detail.taskRecovery || null);
    },
    [
      applyLoadedMessagesPagination,
      applyTaskRecoveryToTerminal,
      clearTerminalForMissingChats,
      defaultModel,
      defaultReasoningEffort,
      getLiveDraftForConversation,
      options,
      refreshRunningConversationIds
    ]
  );

  const hydrate = useCallback(async () => {
    if (hydrateInFlightRef.current) {
      return hydrateInFlightRef.current;
    }

    const job = (async () => {
      try {
        const me = await getMe();
        if (!me.authenticated || !me.user) {
          setUser(null);
          setScreen('login');
          return;
        }

        setUser(me.user);

        const [opts, storedAttachments] = await Promise.all([getChatOptions(), listAttachments(200)]);
        setOptions(opts);
        setAttachments(storedAttachments);

        try {
          const savedModel =
            localStorage.getItem(DEFAULT_MODEL_KEY) || opts.defaults.model || DEFAULT_MODEL;
          const savedReasoning =
            localStorage.getItem(DEFAULT_REASONING_KEY) ||
            opts.defaults.reasoningEffort ||
            DEFAULT_REASONING_EFFORT;
          const normalizedModel = normalizeModelForOptions(savedModel, opts);
          const normalizedReasoning = normalizeReasoningForOptions(savedReasoning, opts);
          setDefaultModel(normalizedModel);
          setDefaultReasoningEffort(normalizedReasoning);
          setChatModel(normalizedModel);
          setChatReasoningEffort(normalizedReasoning);
          setCaps({
            web: Boolean(opts.permissions?.allowNetwork),
            code: Boolean(opts.permissions?.allowShell),
            memory: true
          });
        } catch (_error) {
          // ignore storage parsing
        }

        try {
          const rawTerminal = localStorage.getItem(TERMINAL_KEY);
          if (rawTerminal) {
            const parsed = JSON.parse(rawTerminal);
            const safeEntries = sanitizeTerminalEntries(parsed);
            if (safeEntries.length > 0) {
              setTerminalEntries(safeEntries);
            }
          }
        } catch (_error) {
          // ignore
        }

        await loadConversationsAndPick(undefined, me.user.username);
        setScreen('hub');
      } catch (error: any) {
        setOfflineMessage(error?.message || 'No se pudo cargar la sesión.');
        previousScreenRef.current = 'login';
        setScreen('offline');
      }
    })();

    hydrateInFlightRef.current = job;
    try {
      await job;
    } finally {
      if (hydrateInFlightRef.current === job) {
        hydrateInFlightRef.current = null;
      }
    }
  }, [loadConversationsAndPick]);

  useEffect(() => {
    void hydrate();
    // Intentionally run once on mount. Re-running here with unstable callback identities
    // (derived from `user`) causes an infinite hydrate loop that blocks UI interactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DEFAULT_MODEL_KEY, defaultModel || DEFAULT_MODEL);
      localStorage.setItem(
        DEFAULT_REASONING_KEY,
        defaultReasoningEffort || DEFAULT_REASONING_EFFORT
      );
    } catch (_error) {
      // ignore
    }
  }, [defaultModel, defaultReasoningEffort]);

  useEffect(() => {
    if (screen !== 'chat') return;
    let cancelled = false;
    void (async () => {
      try {
        const latestOptions = await getChatOptions();
        if (cancelled) return;
        setOptions(latestOptions);
        setDefaultModel((prev) => normalizeModelForOptions(prev || latestOptions.defaults.model, latestOptions));
        setDefaultReasoningEffort((prev) =>
          normalizeReasoningForOptions(prev || latestOptions.defaults.reasoningEffort, latestOptions)
        );
        setChatModel((prev) => normalizeModelForOptions(prev, latestOptions));
        setChatReasoningEffort((prev) => normalizeReasoningForOptions(prev, latestOptions));
        setCaps({
          web: Boolean(latestOptions.permissions?.allowNetwork),
          code: Boolean(latestOptions.permissions?.allowShell),
          memory: true
        });
      } catch (_error) {
        // ignore refresh errors when opening chat
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen]);

  useEffect(() => {
    if (activeConversationId !== null) return;
    setChatModel(normalizeModelForOptions(defaultModel, options));
    setChatReasoningEffort(normalizeReasoningForOptions(defaultReasoningEffort, options));
  }, [activeConversationId, defaultModel, defaultReasoningEffort, options]);

  useEffect(() => {
    if (!sending || !sendStartedAtMs) {
      setSendElapsedSeconds(0);
      return;
    }

    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - sendStartedAtMs) / 1000));
      setSendElapsedSeconds(elapsed);
    };

    tick();
    const timerId = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [sending, sendStartedAtMs]);

  useEffect(() => {
    if (!user || sending || runningConversationIds.length === 0) return undefined;
    const timerId = window.setInterval(() => {
      void refreshRunningConversationIds();
    }, 3000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [user, sending, runningConversationIds.length, refreshRunningConversationIds]);

  useEffect(() => {
    if (!user || !sending || !sendStartedAtMs) return undefined;
    let cancelled = false;

    const syncStuckStreamingState = async () => {
      if (Date.now() - sendStartedAtMs < 12000) return;

      const currentSession = streamSessionRef.current;
      const parsedConversationId = Number(
        activeStreamConversationRef.current ?? activeConversationIdRef.current
      );
      if (!Number.isInteger(parsedConversationId) || parsedConversationId <= 0) return;

      const runningIds = await refreshRunningConversationIds();
      if (cancelled) return;
      if (!sendingRef.current) return;
      if (streamSessionRef.current !== currentSession) return;
      if (runningIds.includes(parsedConversationId)) return;

      forceFinalizeStaleStream('Sincronizado: la ejecución anterior ya terminó.');
      void loadConversationsAndPick(parsedConversationId).catch(() => {
        // ignore sync refresh errors
      });
      void listAttachments(200)
        .then((items) => {
          if (!cancelled) {
            setAttachments(items);
          }
        })
        .catch(() => {
          // ignore attachments refresh errors
        });
    };

    void syncStuckStreamingState();
    const timerId = window.setInterval(() => {
      void syncStuckStreamingState();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [
    forceFinalizeStaleStream,
    loadConversationsAndPick,
    refreshRunningConversationIds,
    sendStartedAtMs,
    sending,
    user
  ]);

  useEffect(() => {
    const previous = previousRunningConversationIdsRef.current;
    previousRunningConversationIdsRef.current = runningConversationIds;

    const activeId = activeConversationIdRef.current;
    if (sending || !activeId || activeId <= 0) return;
    const hadActiveRun = previous.includes(activeId);
    const hasActiveRun = runningConversationIds.includes(activeId);
    if (!hadActiveRun || hasActiveRun) return;

    setLiveReasoning('');
    void loadConversationsAndPick(activeId).catch(() => {
      // ignore refresh errors in run-sync fallback
    });
  }, [runningConversationIds, sending, loadConversationsAndPick]);

  const navigate = useCallback(
    (next: Screen, data?: NavigateData) => {
      if (next !== 'offline') {
        previousScreenRef.current = next;
      }

      const targetChatId =
        next === 'chat' && Number.isInteger(data?.chatId) ? Number(data?.chatId) : null;
      const incomingDraft = String(data?.draftMessage || '').trim();
      const shouldAutoSendDraft = Boolean(data?.autoSend);
      const shouldKeepStreamingInTools = next === 'terminal';
      if (
        sending &&
        !shouldKeepStreamingInTools &&
        (next !== 'chat' || !targetChatId || targetChatId !== activeConversationId)
      ) {
        detachActiveStream('Ejecución en segundo plano para el chat anterior.');
      }

      if (next === 'chat' && targetChatId) {
        void (async () => {
          try {
            messagesPaginationRequestSeqRef.current += 1;
            setMessagesLoadingMore(false);
            const [detail, latestRunningIds] = await Promise.all([
              listMessages(targetChatId, { limit: MESSAGES_PAGE_SIZE }),
              refreshRunningConversationIds()
            ]);
            const localDraft = getLiveDraftForConversation(targetChatId);
            const serverDraft =
              detail.liveDraft && typeof detail.liveDraft === 'object' ? (detail.liveDraft as LiveChatDraft) : null;
            const runningSet = new Set(latestRunningIds);
            const streamStillActive = runningSet.has(targetChatId);
            const liveDraft = streamStillActive
              ? serverDraft && !serverDraft.completed
                ? { storageKey: '', draft: serverDraft }
                : localDraft
              : null;
            const hideAssistantWhileRunning = streamStillActive;
            const recoveryPlanText =
              detail.taskRecovery && typeof detail.taskRecovery.planText === 'string'
                ? detail.taskRecovery.planText
                : '';
            setActiveConversationId(targetChatId);
            setChatTitle(detail.conversation.title || 'Chat');
            setActiveConversationProjectContext(detail.projectContext || null);
            setDraftProjectId(
              Number.isInteger(Number(detail.conversation.projectId)) && Number(detail.conversation.projectId) > 0
                ? Number(detail.conversation.projectId)
                : null
            );
            setMessages(
              mergeMessagesWithDraft(detail.messages || [], liveDraft ? liveDraft.draft : null, {
                hideAssistantContentWhileRunning: hideAssistantWhileRunning
              })
            );
            setLiveReasoning(
              liveDraft
                ? serializeReasoning(new Map(Object.entries(liveDraft.draft.reasoningByItem || {})))
                : recoveryPlanText
            );
            setChatModel(
              normalizeModelForOptions(
                String(detail.conversation.model || defaultModel || DEFAULT_MODEL),
                options
              )
            );
            setChatReasoningEffort(
              normalizeReasoningForOptions(
                String(detail.conversation.reasoningEffort || defaultReasoningEffort || DEFAULT_REASONING_EFFORT),
                options
              )
            );
            applyLoadedMessagesPagination(detail.pagination);
            applyTaskRecoveryToTerminal(targetChatId, detail.taskRecovery || null);
            setPendingChatDraft(
              incomingDraft
                ? {
                    chatId: targetChatId,
                    message: incomingDraft,
                    autoSend: shouldAutoSendDraft
                  }
                : null
            );
            setScreen('chat');
          } catch (error: any) {
            setPendingChatDraft(null);
            setStatus(error?.message || 'No se pudo abrir el chat.');
          }
        })();
        return;
      }

      if (next !== 'chat') {
        setPendingChatDraft(null);
      }
      if (next !== 'chat') {
        setActiveConversationProjectContext(null);
      }
      setScreen(next);
    },
    [
      activeConversationId,
      applyLoadedMessagesPagination,
      applyTaskRecoveryToTerminal,
      defaultModel,
      defaultReasoningEffort,
      detachActiveStream,
      getLiveDraftForConversation,
      options,
      refreshRunningConversationIds,
      sending
    ]
  );

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      setStatus('');
      try {
        await login(username, password);
        await hydrate();
      } catch (error: any) {
        setStatus(error?.message || 'No se pudo iniciar sesión.');
      }
    },
    [hydrate]
  );

  const handleLogout = useCallback(async () => {
    cancelActiveStream();
    try {
      await logout();
    } catch (_error) {
      // noop
    }
    setUser(null);
    setMessages([]);
    setMessagesHasMore(false);
    setMessagesNextBeforeId(null);
    setMessagesLoadingMore(false);
    setConversations([]);
    setProjects([]);
    setSelectedProjectId(null);
    setUnassignedConversationCount(0);
    setDraftProjectId(null);
    setActiveConversationProjectContext(null);
    setRunningConversationIds([]);
    setActiveConversationId(null);
    setScreen('login');
  }, [cancelActiveStream]);

  const handleCreateChat = useCallback(async (projectId?: number | null) => {
    if (sending) {
      detachActiveStream('Ejecución en segundo plano para el chat anterior.');
    }
    let effectiveOptions = options;
    try {
      const latestOptions = await getChatOptions();
      effectiveOptions = latestOptions;
      setOptions(latestOptions);
    } catch (_error) {
      // keep current options if refresh fails
    }
    setActiveConversationId(null);
    setChatTitle('Nuevo chat');
    setMessages([]);
    setMessagesHasMore(false);
    setMessagesNextBeforeId(null);
    setMessagesLoadingMore(false);
    setActiveConversationProjectContext(null);
    setDraftProjectId(
      Number.isInteger(Number(projectId)) && Number(projectId) > 0 ? Number(projectId) : null
    );
    setChatModel(normalizeModelForOptions(defaultModel, effectiveOptions));
    setChatReasoningEffort(normalizeReasoningForOptions(defaultReasoningEffort, effectiveOptions));
    setScreen('chat');
  }, [defaultModel, defaultReasoningEffort, detachActiveStream, options, sending]);

  const handleRefresh = useCallback(async () => {
    try {
      const [latestOptions, latestAttachments] = await Promise.all([
        getChatOptions().catch(() => options),
        listAttachments(200)
      ]);
      setOptions(latestOptions);
      await loadConversationsAndPick(activeConversationId);
      setAttachments(latestAttachments);
    } catch (error: any) {
      setStatus(error?.message || 'No se pudo refrescar.');
    }
  }, [activeConversationId, loadConversationsAndPick, options]);

  const handleLoadOlderMessages = useCallback(async () => {
    const targetConversationId = activeConversationIdRef.current;
    const beforeId = messagesNextBeforeIdRef.current;
    if (!Number.isInteger(targetConversationId) || targetConversationId <= 0) return;
    if (!messagesHasMoreRef.current || messagesLoadingMoreRef.current) return;
    if (!Number.isInteger(beforeId) || beforeId <= 0) return;

    const requestSeq = messagesPaginationRequestSeqRef.current + 1;
    messagesPaginationRequestSeqRef.current = requestSeq;
    setMessagesLoadingMore(true);

    try {
      const detail = await listMessages(targetConversationId, {
        limit: MESSAGES_PAGE_SIZE,
        beforeId,
        includeMeta: false
      });
      if (messagesPaginationRequestSeqRef.current !== requestSeq) return;
      if (activeConversationIdRef.current !== targetConversationId) return;

      setMessages((prev) => prependUniqueMessages(detail.messages || [], prev));
      applyLoadedMessagesPagination(detail.pagination);
    } catch (error: any) {
      if (messagesPaginationRequestSeqRef.current !== requestSeq) return;
      if (activeConversationIdRef.current !== targetConversationId) return;
      setStatus(error?.message || 'No se pudieron cargar mensajes anteriores.');
    } finally {
      if (messagesPaginationRequestSeqRef.current !== requestSeq) return;
      if (activeConversationIdRef.current !== targetConversationId) return;
      setMessagesLoadingMore(false);
    }
  }, [applyLoadedMessagesPagination]);

  const handleDeleteConversations = useCallback(
    async (conversationIds: number[]) => {
      const uniqueIds = Array.from(
        new Set(
          (conversationIds || []).filter((id) => Number.isInteger(id) && id > 0)
        )
      );
      if (uniqueIds.length === 0) return;
      try {
        const deletingActiveConversation =
          activeConversationId !== null && uniqueIds.includes(activeConversationId);
        if (sending && deletingActiveConversation) {
          cancelActiveStream('Stream detenido porque el chat fue eliminado.');
        }

        const failedIds: number[] = [];
        for (const conversationId of uniqueIds) {
          try {
            await deleteConversation(conversationId);
          } catch (_error) {
            failedIds.push(conversationId);
          }
        }

        const deletedIds = uniqueIds.filter((id) => !failedIds.includes(id));
        if (deletedIds.length > 0) {
          setRunningConversationIds((prev) => prev.filter((id) => !deletedIds.includes(id)));
          for (const deletedId of deletedIds) {
            clearTerminalForConversation(deletedId);
          }
        }

        const preferredId = deletingActiveConversation ? null : activeConversationId;
        await loadConversationsAndPick(preferredId);
        setAttachments(await listAttachments(200));
        if (deletingActiveConversation && screen === 'chat') {
          setScreen('hub');
        }

        if (failedIds.length === 0) {
          setStatus(deletedIds.length === 1 ? 'Chat eliminado.' : `${deletedIds.length} chats eliminados.`);
        } else if (deletedIds.length > 0) {
          setStatus(
            `${deletedIds.length} eliminados, ${failedIds.length} no se pudieron eliminar.`
          );
        } else {
          setStatus('No se pudo eliminar ninguno de los chats seleccionados.');
        }
      } catch (error: any) {
        setStatus(error?.message || 'No se pudieron eliminar los chats seleccionados.');
      }
    },
    [activeConversationId, cancelActiveStream, clearTerminalForConversation, loadConversationsAndPick, screen, sending]
  );

  const handleDeleteConversation = useCallback(
    async (conversationId: number) => {
      await handleDeleteConversations([conversationId]);
    },
    [handleDeleteConversations]
  );

  const handleRenameConversation = useCallback(
    async (conversationId: number, title: string) => {
      if (!Number.isInteger(conversationId) || conversationId <= 0) return;
      try {
        const updated = await updateConversationTitle(conversationId, title);
        setConversations((prev) =>
          prev.map((item) =>
            item.id === conversationId ? { ...item, title: updated.title } : item
          )
        );
        if (activeConversationId === conversationId) {
          setChatTitle(updated.title || 'Nuevo chat');
        }
        setStatus('Titulo actualizado.');
      } catch (error: any) {
        setStatus(error?.message || 'No se pudo actualizar el titulo del chat.');
      }
    },
    [activeConversationId]
  );

  const handleCreateProject = useCallback(
    async (payload: {
      name: string;
      contextMode: 'manual' | 'automatic' | 'mixed';
      autoContextEnabled?: boolean;
      manualContext?: string;
    }) => {
      const created = await createProject(payload);
      setProjects((prev) =>
        [...prev, created].sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''))
      );
      setSelectedProjectId(created.id);
      setStatus(`Proyecto creado: ${created.name}`);
      return created;
    },
    []
  );

  const handleUpdateProject = useCallback(
    async (
      projectId: number,
      payload: {
        name?: string;
        contextMode?: 'manual' | 'automatic' | 'mixed';
        autoContextEnabled?: boolean;
        manualContext?: string;
      }
    ) => {
      const updated = await updateProject(projectId, payload);
      setProjects((prev) => prev.map((item) => (item.id === projectId ? updated : item)));
      if (
        activeConversationProjectContext &&
        Number(activeConversationProjectContext.projectId) === Number(projectId)
      ) {
        setActiveConversationProjectContext((prev) =>
          prev
            ? {
                ...prev,
                projectName: updated.name,
                mode: updated.contextMode,
                autoEnabled: updated.autoContextEnabled,
                manualContext: String(updated.manualContext || ''),
                autoContext: String(updated.autoContext || ''),
                autoUpdatedAt: updated.autoUpdatedAt
              }
            : prev
        );
      }
      setStatus(`Proyecto actualizado: ${updated.name}`);
      return updated;
    },
    [activeConversationProjectContext]
  );

  const handleDeleteProjectById = useCallback(
    async (projectId: number) => {
      const deleted = await deleteProject(projectId);
      setProjects((prev) => prev.filter((item) => item.id !== projectId));
      setConversations((prev) =>
        prev.map((item) =>
          Number(item.projectId) === Number(projectId)
            ? { ...item, projectId: null, project: null }
            : item
        )
      );
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
      }
      if (
        activeConversationProjectContext &&
        Number(activeConversationProjectContext.projectId) === Number(projectId)
      ) {
        setActiveConversationProjectContext(null);
      }
      setUnassignedConversationCount((prev) => Math.max(0, prev + Math.max(0, deleted.detachedChats)));
      setStatus(`Proyecto eliminado. Chats desvinculados: ${deleted.detachedChats}`);
      await loadConversationsAndPick(activeConversationIdRef.current);
    },
    [activeConversationProjectContext, loadConversationsAndPick, selectedProjectId]
  );

  const handleRegenerateProjectContextById = useCallback(async (projectId: number) => {
    const result = await regenerateProjectContext(projectId);
    setProjects((prev) => prev.map((item) => (item.id === projectId ? result.project : item)));
    if (
      activeConversationProjectContext &&
      Number(activeConversationProjectContext.projectId) === Number(projectId)
    ) {
      setActiveConversationProjectContext((prev) =>
        prev
          ? {
              ...prev,
              autoContext: String(result.project.autoContext || ''),
              autoUpdatedAt: result.project.autoUpdatedAt
            }
          : prev
      );
    }
    setStatus(
      result.jobId
        ? 'Regeneración de contexto en segundo plano iniciada.'
        : 'Regeneración de contexto solicitada.'
    );
  }, [activeConversationProjectContext]);

  const handleMoveConversationProject = useCallback(
    async (conversationId: number, projectId: number | null) => {
      const moved = await moveConversationToProject(conversationId, projectId);
      setConversations((prev) =>
        prev.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                projectId: moved.projectId,
                project: moved.project
              }
            : item
        )
      );
      if (activeConversationIdRef.current === conversationId) {
        if (!moved.projectId) {
          setActiveConversationProjectContext(null);
        } else {
          const nextProject = projects.find((project) => project.id === moved.projectId) || null;
          if (nextProject) {
            setActiveConversationProjectContext((prev) =>
              prev
                ? { ...prev, projectId: nextProject.id, projectName: nextProject.name }
                : {
                    projectId: nextProject.id,
                    projectName: nextProject.name,
                    mode: nextProject.contextMode,
                    autoEnabled: nextProject.autoContextEnabled,
                    manualContext: String(nextProject.manualContext || ''),
                    autoContext: String(nextProject.autoContext || ''),
                    effectiveContext: '',
                    manualUsed: false,
                    autoUsed: false,
                    autoUpdatedAt: nextProject.autoUpdatedAt,
                    autoMeta: nextProject.autoMeta || {}
                  }
            );
          }
        }
      }
      await loadConversationsAndPick(activeConversationIdRef.current);
      setStatus(moved.projectId ? 'Chat movido al proyecto.' : 'Chat movido fuera del proyecto.');
      return moved;
    },
    [loadConversationsAndPick, projects]
  );

  const handleDeleteAttachments = useCallback(async (attachmentIds: string[]) => {
    const uniqueIds = Array.from(
      new Set(
        (attachmentIds || [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );

    if (uniqueIds.length === 0) {
      return { deletedIds: [], failedIds: [] };
    }

    const results = await Promise.allSettled(uniqueIds.map((id) => deleteAttachment(id)));
    const deletedIds: string[] = [];
    const failedIds: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        deletedIds.push(uniqueIds[index]);
      } else {
        failedIds.push(uniqueIds[index]);
      }
    });

    if (deletedIds.length > 0) {
      const deletedSet = new Set(deletedIds);
      setAttachments((prev) => prev.filter((item) => !deletedSet.has(item.id)));
    }

    if (failedIds.length === 0) {
      setStatus(deletedIds.length === 1 ? 'Adjunto eliminado.' : `${deletedIds.length} adjuntos eliminados.`);
    } else if (deletedIds.length > 0) {
      setStatus(`${deletedIds.length} adjuntos eliminados, ${failedIds.length} no se pudieron eliminar.`);
    } else {
      setStatus('No se pudieron eliminar los adjuntos seleccionados.');
    }

    return { deletedIds, failedIds };
  }, []);

  const handleChatModelChange = useCallback(
    async (value: string) => {
      const normalizedValue = normalizeModelForOptions(value, options);
      setChatModel(normalizedValue);
      if (!activeConversationId || activeConversationId <= 0) return;
      try {
        const updated = await updateConversationSettings(activeConversationId, { model: normalizedValue });
        setConversations((prev) =>
          prev.map((item) =>
            item.id === activeConversationId ? { ...item, model: updated.model } : item
          )
        );
      } catch (error: any) {
        setStatus(error?.message || 'No se pudo actualizar el modelo del chat.');
      }
    },
    [activeConversationId, options]
  );

  const handleChatReasoningChange = useCallback(
    async (value: string) => {
      const normalizedValue = normalizeReasoningForOptions(value, options);
      setChatReasoningEffort(normalizedValue);
      if (!activeConversationId || activeConversationId <= 0) return;
      try {
        const updated = await updateConversationSettings(activeConversationId, {
          reasoningEffort: normalizedValue
        });
        setConversations((prev) =>
          prev.map((item) =>
            item.id === activeConversationId
              ? { ...item, reasoningEffort: updated.reasoningEffort }
              : item
          )
        );
      } catch (error: any) {
        setStatus(error?.message || 'No se pudo actualizar el razonamiento del chat.');
      }
    },
    [activeConversationId, options]
  );

  const handleStop = useCallback(async () => {
    if (!activeConversationId || activeConversationId <= 0) {
      cancelActiveStream('Solicitud detenida.');
      return;
    }
    setStatus('Deteniendo sesión activa...');
    try {
      const result = await killConversationSession(activeConversationId);
      cancelActiveStream();
      if (result?.killed) {
        setRunningConversationIds((prev) => prev.filter((id) => id !== activeConversationId));
      }
      await loadConversationsAndPick(activeConversationId);
      setStatus(result?.killed ? 'Sesión detenida.' : 'No había una sesión activa en este chat.');
    } catch (error: any) {
      setStatus(error?.message || 'No se pudo detener la sesión activa.');
    }
  }, [activeConversationId, cancelActiveStream, loadConversationsAndPick]);

  const clearComposerFiles = useCallback(() => {
    setSelectedFiles([]);
    setAttachmentPipeline({
      phase: 'idle',
      fileIndex: 0,
      totalFiles: 0,
      fileName: '',
      error: ''
    });
  }, []);

  const appendComposerFiles = useCallback((files: File[]) => {
    const incoming = Array.isArray(files) ? files.filter(Boolean) : [];
    if (incoming.length === 0) return;
    setSelectedFiles((prev) => {
      const merged = [...prev, ...incoming].slice(0, 5);
      setAttachmentPipeline({
        phase: merged.length > 0 ? 'pending' : 'idle',
        fileIndex: 0,
        totalFiles: merged.length,
        fileName: merged.length > 0 ? String(merged[0]?.name || '') : '',
        error: ''
      });
      return merged;
    });
  }, []);

  const handleSend = useCallback(
    async (inputText: string) => {
      if (sending) return;
      const trimmed = inputText.trim();
      if (!trimmed && selectedFiles.length === 0) return;

      let effectiveOptions = options;
      try {
        const latestOptions = await getChatOptions();
        effectiveOptions = latestOptions;
        setOptions(latestOptions);
      } catch (_error) {
        // keep current options when refresh fails
      }
      const requestModel = normalizeModelForOptions(chatModel, effectiveOptions);
      const requestReasoning = normalizeReasoningForOptions(
        chatReasoningEffort,
        effectiveOptions
      );
      if (requestModel !== chatModel) {
        setChatModel(requestModel);
      }
      if (requestReasoning !== chatReasoningEffort) {
        setChatReasoningEffort(requestReasoning);
      }

      if (selectedFiles.length > 0) {
        setAttachmentPipeline({
          phase: 'processing',
          fileIndex: 0,
          totalFiles: selectedFiles.length,
          fileName: String(selectedFiles[0]?.name || ''),
          error: ''
        });
        try {
          await preflightAttachmentUpload(selectedFiles, activeConversationId);
        } catch (error: any) {
          setAttachmentPipeline({
            phase: 'error',
            fileIndex: 0,
            totalFiles: selectedFiles.length,
            fileName: String(selectedFiles[0]?.name || ''),
            error: String(error?.message || 'No se pudo validar espacio para subir adjuntos.')
          });
          setStatus(error?.message || 'No se pudo validar espacio para subir adjuntos.');
          return;
        }
      }

      const now = Date.now();
      const startedAtIso = new Date(now).toISOString();
      const pendingMessageAttachments: MessageAttachment[] = selectedFiles.map((file, index) => ({
        id: `pending_${now}_${index + 1}_${file.name}`,
        conversationId: activeConversationId && activeConversationId > 0 ? activeConversationId : 0,
        name: String(file.name || `archivo_${index + 1}`),
        size: Math.max(0, Number(file.size) || 0),
        mimeType: String(file.type || 'application/octet-stream'),
        uploadedAt: startedAtIso
      }));
      const tempUserMessageId = -now;
      const tempAssistantMessageId = -(now + 1);
      const userMessage: Message = {
        id: tempUserMessageId,
        role: 'user',
        content: trimmed || 'Adjuntos enviados.',
        created_at: startedAtIso,
        attachments: pendingMessageAttachments
      };
      const assistantMessage: Message = {
        id: tempAssistantMessageId,
        role: 'assistant',
        content: '',
        created_at: startedAtIso
      };
      const streamSessionId = streamSessionRef.current + 1;
      streamSessionRef.current = streamSessionId;
      const isCurrentSession = () => streamSessionRef.current === streamSessionId;

      clearTerminalForConversation(activeConversationId);
      setMessages((prev) => {
        const next = [...prev];
        while (
          next.length > 0 &&
          next[next.length - 1].role === 'assistant' &&
          !String(next[next.length - 1].content || '').trim()
        ) {
          next.pop();
        }
        return [...next, userMessage, assistantMessage];
      });
      setLiveReasoning('');
      assistantDraftRef.current = '';
      liveUserMessageRef.current = userMessage;
      liveAssistantMessageIdRef.current = tempAssistantMessageId;
      reasoningByItemRef.current = new Map();
      activeRequestIdRef.current = `req_${streamSessionId}_${Date.now()}`;

      const initialDraft: LiveChatDraft = {
        username: resolveActiveUsername(),
        conversationId: activeConversationId,
        messageId: tempAssistantMessageId,
        requestId: activeRequestIdRef.current,
        userMessage,
        assistantMessage,
        reasoningByItem: {},
        completed: false,
        updatedAt: startedAtIso
      };
      activeDraftStorageKeyRef.current = saveDraftSnapshot(initialDraft, null);

      setSending(true);
      setSendStartedAtMs(now);
      setSendElapsedSeconds(0);
      setStatus(selectedFiles.length > 0 ? 'Subiendo adjuntos...' : 'Generando...');

      const controller = new AbortController();
      streamAbortRef.current = controller;
      activeStreamConversationRef.current = activeConversationId;
      let trackedRunningConversationId: number | null = activeConversationId;
      let conversationFromStream: number | null = activeConversationId;
      let streamCompleted = false;
      let streamRequestStarted = false;
      let keepRunningIndicator = false;
      let attachmentsReadyForContext = selectedFiles.length === 0;

      const patchReasoningCache = (itemId: string, value: string, mode: 'append' | 'replace') => {
        if (!value) return;
        const byItem = new Map<string, string>(reasoningByItemRef.current);
        const safeItemId = itemId || 'default';
        const previous = byItem.get(safeItemId) || '';
        byItem.set(safeItemId, mode === 'append' ? `${previous}${value}` : value);
        reasoningByItemRef.current = byItem;
        setLiveReasoning(serializeReasoning(byItem));
        scheduleDraftPersist(false);
      };

      const resolveStreamConversationId = (): number | null => {
        const fromStream = Number(conversationFromStream);
        if (Number.isInteger(fromStream) && fromStream > 0) return fromStream;
        const fromTracked = Number(trackedRunningConversationId);
        if (Number.isInteger(fromTracked) && fromTracked > 0) return fromTracked;
        const fromActive = Number(activeConversationIdRef.current);
        if (Number.isInteger(fromActive) && fromActive > 0) return fromActive;
        return null;
      };

      const trackRunningConversation = (nextId: number) => {
        if (!isCurrentSession()) return;
        if (!Number.isInteger(nextId) || nextId <= 0) return;
        if (trackedRunningConversationId && trackedRunningConversationId !== nextId) {
          setRunningConversationIds((prev) => prev.filter((id) => id !== trackedRunningConversationId));
        }
        trackedRunningConversationId = nextId;
        conversationFromStream = nextId;
        activeStreamConversationRef.current = nextId;
        updateActiveDraft(
          (draft) => ({
            ...draft,
            conversationId: nextId
          }),
          { rekey: true }
        );
        setRunningConversationIds((prev) => (prev.includes(nextId) ? prev : [...prev, nextId]));
        setActiveConversationId(nextId);
      };

      try {
        if (trackedRunningConversationId && trackedRunningConversationId > 0) {
          setRunningConversationIds((prev) =>
            prev.includes(trackedRunningConversationId) ? prev : [...prev, trackedRunningConversationId]
          );
        }

        const uploaded = [] as Array<{ uploadId: string }>;
        const totalUploadBytes = selectedFiles.reduce((sum, file) => {
          return sum + Math.max(0, Number(file?.size) || 0);
        }, 0);
        let uploadedBytesCompleted = 0;

        for (let index = 0; index < selectedFiles.length; index += 1) {
          const file = selectedFiles[index];
          const fileSize = Math.max(0, Number(file?.size) || 0);
          let latestLoaded = 0;
          let latestTotal = fileSize;
          setAttachmentPipeline({
            phase: 'uploading',
            fileIndex: index + 1,
            totalFiles: selectedFiles.length,
            fileName: String(file?.name || `archivo_${index + 1}`),
            error: ''
          });

          setUploadProgress({
            percent:
              totalUploadBytes > 0
                ? Math.min(100, Math.round((uploadedBytesCompleted / totalUploadBytes) * 100))
                : 0,
            uploadedBytes: Math.round(uploadedBytesCompleted),
            totalBytes: Math.round(totalUploadBytes),
            fileName: String(file?.name || `archivo_${index + 1}`),
            fileIndex: index + 1,
            totalFiles: selectedFiles.length
          });

          const item = await uploadAttachment(
            file,
            activeConversationId,
            controller.signal,
            ({ loaded, total }) => {
              if (!isCurrentSession()) return;
              const safeLoaded = Math.max(0, Number(loaded) || 0);
              const safeTotalCandidate = Math.max(0, Number(total) || 0);
              latestTotal = Math.max(fileSize, safeTotalCandidate, safeLoaded);
              latestLoaded = Math.min(safeLoaded, latestTotal);
              const totalBytes = totalUploadBytes > 0 ? totalUploadBytes : uploadedBytesCompleted + latestTotal;
              const uploadedBytes = Math.min(totalBytes, uploadedBytesCompleted + latestLoaded);
              const percent =
                totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;

              setUploadProgress({
                percent,
                uploadedBytes: Math.round(uploadedBytes),
                totalBytes: Math.round(totalBytes),
                fileName: String(file?.name || `archivo_${index + 1}`),
                fileIndex: index + 1,
                totalFiles: selectedFiles.length
              });
            }
          );

          if (!isCurrentSession()) return;

          const completedForFile = Math.max(fileSize, latestTotal, latestLoaded);
          uploadedBytesCompleted += completedForFile;
          const totalBytes = totalUploadBytes > 0 ? totalUploadBytes : uploadedBytesCompleted;
          const uploadedBytes = Math.min(totalBytes, uploadedBytesCompleted);
          const percent =
            totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 100;

          setUploadProgress({
            percent,
            uploadedBytes: Math.round(uploadedBytes),
            totalBytes: Math.round(totalBytes),
            fileName: String(file?.name || `archivo_${index + 1}`),
            fileIndex: index + 1,
            totalFiles: selectedFiles.length
          });

          uploaded.push(item);
        }

        if (selectedFiles.length > 0) {
          setAttachmentPipeline({
            phase: 'processing',
            fileIndex: selectedFiles.length,
            totalFiles: selectedFiles.length,
            fileName: String(selectedFiles[selectedFiles.length - 1]?.name || ''),
            error: ''
          });
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, UPLOAD_PROGRESS_SETTLE_MS);
          });
          if (!isCurrentSession()) return;
        }
        setUploadProgress(null);

        const response = await startChatStream({
          message: trimmed,
          model: requestModel,
          reasoningEffort: requestReasoning,
          conversationId: activeConversationId,
          projectId:
            activeConversationId && activeConversationId > 0
              ? null
              : Number.isInteger(Number(draftProjectId)) && Number(draftProjectId) > 0
                ? Number(draftProjectId)
                : null,
          attachments: uploaded,
          signal: controller.signal
        });
        if (!isCurrentSession()) return;
        streamRequestStarted = true;
        attachmentsReadyForContext = true;
        if (selectedFiles.length > 0) {
          setAttachmentPipeline({
            phase: 'ready',
            fileIndex: selectedFiles.length,
            totalFiles: selectedFiles.length,
            fileName: String(selectedFiles[selectedFiles.length - 1]?.name || ''),
            error: ''
          });
          window.setTimeout(() => {
            if (!isCurrentSession()) return;
            clearComposerFiles();
          }, 800);
        }

        const responseConversationId = Number(response.headers.get('X-Conversation-Id'));
        if (Number.isInteger(responseConversationId) && responseConversationId > 0) {
          trackRunningConversation(responseConversationId);
        }

        await consumeSse(response, {
          conversation: (payload) => {
            if (!isCurrentSession()) return;
            const nextId = Number(payload?.conversationId);
            trackRunningConversation(nextId);
          },
          chat_agent: (payload) => {
            if (!isCurrentSession()) return;
            const nextAgentId = String(payload?.id || '').trim();
            const nextAgentName = String(payload?.name || '').trim();
            const nextRuntime = String(payload?.provider || '').trim();
            setOptions((prev) => ({
              ...prev,
              activeAgentId: nextAgentId || prev.activeAgentId,
              activeAgentName: nextAgentName || prev.activeAgentName,
              runtimeProvider: nextRuntime || prev.runtimeProvider
            }));
          },
          assistant_delta: (payload) => {
            if (!isCurrentSession()) return;
            const delta = String(payload?.text || '');
            if (!delta) return;
            assistantDraftRef.current = `${assistantDraftRef.current}${delta}`;
            scheduleDraftPersist(false);
          },
          reasoning_delta: (payload) => {
            if (!isCurrentSession()) return;
            const delta = String(payload?.text || '');
            const itemId = String(payload?.itemId || '');
            if (!delta) return;
            patchReasoningCache(itemId, delta, 'append');
          },
          raw_stdout_delta: (payload) => {
            if (!isCurrentSession()) return;
            const delta = String(payload?.text || '');
            const itemId = String(payload?.itemId || 'stdout_raw');
            if (!delta) return;
            patchReasoningCache(itemId, delta, 'append');
          },
          reasoning_step: (payload) => {
            if (!isCurrentSession()) return;
            const text = String(payload?.text || '').trim();
            const itemId = String(payload?.itemId || '');
            if (!text) return;
            patchReasoningCache(itemId, text, 'replace');
          },
          system_notice: (payload) => {
            if (!isCurrentSession()) return;
            const text = String(payload?.text || '').trim();
            if (text) {
              const streamConversationId = resolveStreamConversationId();
              if (Number.isInteger(streamConversationId) && streamConversationId > 0) {
                activeStreamConversationRef.current = streamConversationId;
              }
              appendTerminalNotice(text);
            }
          },
          command_started: (payload) => {
            if (!isCurrentSession()) return;
            const itemId = String(payload?.itemId || `cmd_${Date.now()}`);
            const statusText = String(payload?.status || 'running');
            const streamConversationId = resolveStreamConversationId();
            upsertTerminal(itemId, {
              itemId,
              conversationId: streamConversationId,
              command: String(payload?.command || '(comando)'),
              statusText,
              kind: classifyTerminalStatus(statusText, null),
              timestamp: new Date().toISOString()
            });
          },
          command_output_delta: (payload) => {
            if (!isCurrentSession()) return;
            const itemId = String(payload?.itemId || '');
            const delta = String(payload?.text || '');
            if (!itemId || !delta) return;
            const streamConversationId = resolveStreamConversationId();
            setTerminalEntries((prev) => {
              const idx = prev.findIndex((entry) => entry.itemId === itemId);
              if (idx === -1) {
                const next = [
                  ...prev,
                  {
                    id: itemId,
                    itemId,
                    conversationId: streamConversationId,
                    kind: 'running',
                    command: '(comando)',
                    output: delta,
                    statusText: 'running',
                    timestamp: new Date().toISOString(),
                    durationMs: 0
                  } as TerminalEntry
                ];
                try {
                  localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
                } catch (_error) {
                  // ignore
                }
                return next;
              }
              const next = [...prev];
              const existingConversationId = Number(next[idx].conversationId);
              const resolvedConversationId =
                Number.isInteger(existingConversationId) && existingConversationId > 0
                  ? existingConversationId
                  : streamConversationId;
              next[idx] = {
                ...next[idx],
                conversationId: resolvedConversationId,
                output: `${next[idx].output || ''}${delta}`
              };
              try {
                localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
              } catch (_error) {
                // ignore
              }
              return next;
            });
          },
          command_completed: (payload) => {
            if (!isCurrentSession()) return;
            const itemId = String(payload?.itemId || `cmd_${Date.now()}`);
            const statusText = String(payload?.status || 'completed');
            const exitCode = Number.isFinite(Number(payload?.exitCode)) ? Number(payload?.exitCode) : null;
            const streamConversationId = resolveStreamConversationId();
            setTerminalEntries((prev) => {
              const started = prev.find((entry) => entry.itemId === itemId)?.timestamp;
              const startedAt = started ? Date.parse(started) : NaN;
              const idx = prev.findIndex((entry) => entry.itemId === itemId);
              const existingConversationId = idx >= 0 ? Number(prev[idx].conversationId) : NaN;
              const resolvedConversationId =
                Number.isInteger(existingConversationId) && existingConversationId > 0
                  ? existingConversationId
                  : streamConversationId;
              const entry: TerminalEntry = {
                id: itemId,
                itemId,
                conversationId: resolvedConversationId,
                kind: classifyTerminalStatus(statusText, exitCode),
                command: String(payload?.command || '(comando)'),
                output: String(payload?.output || ''),
                statusText,
                timestamp: started || new Date().toISOString(),
                durationMs: Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0
              };
              const next = [...prev];
              if (idx === -1) {
                next.push(entry);
              } else {
                next[idx] = { ...next[idx], ...entry };
              }
              try {
                localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
              } catch (_error) {
                // ignore
              }
              return next;
            });
          },
          done: (payload) => {
            if (!isCurrentSession()) return;
            streamCompleted = true;
            scheduleDraftPersist(true);
            if (!payload?.ok) {
              const streamConversationId = resolveStreamConversationId();
              if (Number.isInteger(streamConversationId) && streamConversationId > 0) {
                activeStreamConversationRef.current = streamConversationId;
              }
              appendTerminalNotice(`Solicitud finalizó con error (${payload?.exitCode ?? 'n/a'})`);
            }
          }
        });
        if (!isCurrentSession()) return;

        if (!streamCompleted) {
          const streamConversationId = resolveStreamConversationId();
          let hasActiveRun = false;
          if (Number.isInteger(streamConversationId) && streamConversationId > 0) {
            try {
              const latestRuns = await getCodexRuns();
              const latestRunningIds = listRunningConversationIds(latestRuns);
              setRunningConversationIds(latestRunningIds);
              hasActiveRun = latestRunningIds.includes(streamConversationId);
            } catch (_error) {
              hasActiveRun = true;
            }
          }

          if (hasActiveRun) {
            keepRunningIndicator = true;
            persistActiveDraftNow(false);
            if (
              conversationFromStream &&
              conversationFromStream > 0 &&
              activeConversationIdRef.current === conversationFromStream
            ) {
              void loadConversationsAndPick(conversationFromStream).catch(() => {
                // ignore refresh errors in detached mode
              });
            }
            setStatus('La conexión se cerró, pero la ejecución sigue en segundo plano.');
            return;
          }

          streamCompleted = true;
        }

        await loadConversationsAndPick(conversationFromStream);
        setAttachments(await listAttachments(200));
        setStatus('Respuesta completa.');
      } catch (error: any) {
        if (!isCurrentSession()) return;
        const aborted = error?.name === 'AbortError';
        if (aborted && streamRequestStarted) {
          keepRunningIndicator = true;
          persistActiveDraftNow(false);
          if (
            conversationFromStream &&
            conversationFromStream > 0 &&
            activeConversationIdRef.current === conversationFromStream
          ) {
            void loadConversationsAndPick(conversationFromStream).catch(() => {
              // ignore refresh errors in detached mode
            });
          }
          setStatus('Conexión cerrada. La ejecución seguirá en segundo plano.');
        } else {
          setStatus(aborted ? 'Solicitud detenida.' : error?.message || 'Error en el envío.');
          if (!attachmentsReadyForContext && selectedFiles.length > 0) {
            setAttachmentPipeline({
              phase: aborted ? 'pending' : 'error',
              fileIndex: uploadProgress?.fileIndex || 0,
              totalFiles: selectedFiles.length,
              fileName: String(uploadProgress?.fileName || selectedFiles[0]?.name || ''),
              error: aborted ? '' : String(error?.message || 'No se pudo completar la subida de adjuntos.')
            });
          }
        }
      } finally {
        if (
          trackedRunningConversationId &&
          trackedRunningConversationId > 0 &&
          !keepRunningIndicator
        ) {
          setRunningConversationIds((prev) => prev.filter((id) => id !== trackedRunningConversationId));
        }
        if (!isCurrentSession()) return;
        if (streamCompleted) {
          persistActiveDraftNow(true);
        } else if (liveAssistantMessageIdRef.current !== null) {
          persistActiveDraftNow(false);
        }
        const draftId = liveAssistantMessageIdRef.current;
        if (draftId !== null && !assistantDraftRef.current.trim()) {
          setMessages((prev) => prev.filter((entry) => entry.id !== draftId));
          deleteDraftSnapshot(activeDraftStorageKeyRef.current);
        }
        resetTransientStreamState();
      }
    },
    [
      activeConversationId,
      appendTerminalNotice,
      chatModel,
      chatReasoningEffort,
      deleteDraftSnapshot,
      loadConversationsAndPick,
      options,
      persistActiveDraftNow,
      resetTransientStreamState,
      resolveActiveUsername,
      saveDraftSnapshot,
      scheduleDraftPersist,
      selectedFiles,
      sending,
      uploadProgress,
      draftProjectId,
      clearComposerFiles,
      clearTerminalForConversation,
      updateActiveDraft,
      upsertTerminal
    ]
  );

  useEffect(() => {
    if (!pendingChatDraft) return;
    if (!pendingChatDraft.autoSend) return;
    if (screen !== 'chat') return;
    if (activeConversationId !== pendingChatDraft.chatId) return;
    if (sending) return;
    const message = String(pendingChatDraft.message || '').trim();
    setPendingChatDraft(null);
    if (!message) return;
    void handleSend(message);
  }, [activeConversationId, handleSend, pendingChatDraft, screen, sending]);

  const handleRequestRestart = useCallback(async () => {
    setRestartBusy(true);
    try {
      await restartServer();
      setScreen('reboot');
    } catch (error: any) {
      setStatus(error?.message || 'No se pudo reiniciar.');
    } finally {
      setRestartBusy(false);
    }
  }, []);

  useEffect(() => {
    if (screen !== 'reboot') return;
    let active = true;

    const tick = async () => {
      try {
        const next = await getRestartStatus();
        if (!active) return;
        setRestartState(next);

        if (!next.active && (next.phase === 'completed' || next.phase === 'failed')) {
          const me = await getMe();
          if (!active) return;
          if (me.authenticated) {
            await loadConversationsAndPick(activeConversationId);
            setScreen('hub');
          }
        }
      } catch (error: any) {
        if (!active) return;
        setOfflineMessage(error?.message || 'No se pudo verificar el reinicio.');
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 1200);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [activeConversationId, loadConversationsAndPick, screen]);

  const filteredConversations = useMemo(() => byDateDesc(conversations), [conversations]);
  const activeChatTerminalEntries = useMemo(() => {
    if (!activeConversationId || activeConversationId <= 0) return [];
    return terminalEntries.filter((entry) => Number(entry.conversationId) === activeConversationId);
  }, [activeConversationId, terminalEntries]);

  if (screen === 'login') {
    return <LoginScreen onLogin={handleLogin} status={status} />;
  }

  if (screen === 'offline') {
    return (
      <OfflineErrorScreen
        message={offlineMessage}
        onRetry={() => {
          setScreen(previousScreenRef.current);
          void hydrate();
        }}
        onNavigate={navigate}
      />
    );
  }

  return (
    <div className="bg-black text-white min-h-screen font-sans selection:bg-blue-500/30">
      {screen === 'hub' && (
        <ChatHubScreen
          user={user}
          conversations={filteredConversations}
          projects={projects}
          selectedProjectId={selectedProjectId}
          unassignedCount={unassignedConversationCount}
          activeConversationId={activeConversationId}
          runningConversationIds={runningConversationIds}
          backgroundNotices={hubBackgroundNotices}
          onDismissBackgroundNotice={handleDismissHubBackgroundNotice}
          onOpenChat={(id) => navigate('chat', { chatId: id })}
          onCreateChat={handleCreateChat}
          onSelectProject={setSelectedProjectId}
          onCreateProject={handleCreateProject}
          onUpdateProject={handleUpdateProject}
          onDeleteProject={handleDeleteProjectById}
          onRegenerateProjectContext={handleRegenerateProjectContextById}
          onMoveChatToProject={handleMoveConversationProject}
          onDeleteChat={handleDeleteConversation}
          onRenameChat={handleRenameConversation}
          onDeleteChats={handleDeleteConversations}
          onLogout={handleLogout}
          onRefresh={handleRefresh}
          onRestart={handleRequestRestart}
          onNavigate={navigate}
        />
      )}

      {screen === 'chat' && (
        <ChatScreen
          chatTitle={chatTitle}
          conversationId={activeConversationId}
          projectContext={activeConversationProjectContext}
          draftProject={
            Number.isInteger(Number(draftProjectId)) && Number(draftProjectId) > 0
              ? projects.find((project) => project.id === Number(draftProjectId)) || null
              : null
          }
          messages={messages}
          hasMoreMessages={messagesHasMore}
          loadingMoreMessages={messagesLoadingMore}
          onLoadMoreMessages={handleLoadOlderMessages}
          liveReasoning={liveReasoning}
          terminalEntries={activeChatTerminalEntries}
          sending={sending}
          sendElapsedSeconds={sendElapsedSeconds}
          isRunning={
            activeConversationId !== null &&
            activeConversationId > 0 &&
            runningConversationIds.includes(activeConversationId)
          }
          selectedFiles={selectedFiles}
          uploadProgress={uploadProgress}
          attachmentPipeline={attachmentPipeline}
          activeAgentName={String(options.activeAgentName || 'Codex CLI')}
          model={chatModel}
          reasoningEffort={chatReasoningEffort}
          options={options}
          status={status}
          onBack={() => navigate('hub')}
          onSend={handleSend}
          onStop={handleStop}
          onAddFiles={appendComposerFiles}
          onClearFiles={clearComposerFiles}
          onRefresh={handleRefresh}
          onNavigate={navigate}
          onModelChange={handleChatModelChange}
          onReasoningChange={handleChatReasoningChange}
        />
      )}

      {screen === 'search' && (
        <SearchScreen
          conversations={filteredConversations}
          onOpenChat={(id) => navigate('chat', { chatId: id })}
          onNavigate={navigate}
        />
      )}

      {screen === 'terminal' && (
        <TerminalLogScreen
          entries={terminalEntries}
          conversations={filteredConversations}
          onClear={() => persistTerminal([])}
          onClearConversation={clearTerminalForConversation}
          onRunsChanged={() => {
            void handleRefresh();
          }}
          onNavigate={navigate}
        />
      )}

      {screen === 'attachments' && (
        <AttachmentsScreen
          selectedFiles={selectedFiles}
          attachments={attachments}
          onPickFiles={appendComposerFiles}
          onRemoveSelected={(name) => {
            setSelectedFiles((prev) => {
              const next = prev.filter((item) => item.name !== name);
              setAttachmentPipeline({
                phase: next.length > 0 ? 'pending' : 'idle',
                fileIndex: 0,
                totalFiles: next.length,
                fileName: next.length > 0 ? String(next[0]?.name || '') : '',
                error: ''
              });
              return next;
            });
          }}
          onDeleteAttachments={handleDeleteAttachments}
          onRefresh={() => {
            void (async () => {
              try {
                setAttachments(await listAttachments(200));
              } catch (error: any) {
                setStatus(error?.message || 'No se pudieron cargar adjuntos.');
              }
            })();
          }}
          onNavigate={navigate}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen
          options={options}
          model={defaultModel}
          reasoningEffort={defaultReasoningEffort}
          caps={caps}
          onModelChange={setDefaultModel}
          onReasoningChange={setDefaultReasoningEffort}
          onNavigate={navigate}
        />
      )}

      {screen === 'reboot' && (
        <SystemRebootScreen
          restart={restartState}
          busy={restartBusy}
          onBack={() => navigate('hub')}
        />
      )}
    </div>
  );
}
