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
  deleteAttachment,
  deleteConversation,
  getChatOptions,
  getMe,
  getRestartStatus,
  listAttachments,
  listConversations,
  listMessages,
  login,
  logout,
  restartServer,
  startChatStream,
  updateConversationSettings,
  uploadAttachment
} from './lib/api';
import { consumeSse } from './lib/sse';
import type {
  AttachmentItem,
  Capabilities,
  ChatOptions,
  Conversation,
  Message,
  RestartState,
  Screen,
  TerminalEntry,
  User
} from './lib/types';

const DEFAULT_MODEL_KEY = 'codexweb_model';
const DEFAULT_REASONING_KEY = 'codexweb_reasoning_effort';
const CAPS_KEY = 'codexweb_caps';
const TERMINAL_KEY = 'codexweb_terminal_entries_v1';
const LIVE_DRAFT_PREFIX = 'codexweb_live_draft_v1';
const DRAFT_PERSIST_THROTTLE_MS = 150;
const DEFAULT_MODEL = 'gpt-5.3-codex';
const DEFAULT_REASONING_EFFORT = 'xhigh';
const DRAFT_CONVERSATION = 'draft';

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

function mergeMessagesWithDraft(serverMessages: Message[], draft: LiveChatDraft | null): Message[] {
  if (!draft || draft.completed) return serverMessages;
  const next = [...serverMessages];
  const draftAssistant = String(draft.assistantMessage?.content || '');
  if (!draftAssistant) return next;

  const lastAssistantIndex = next.reduce((acc, item, index) => (item.role === 'assistant' ? index : acc), -1);
  if (lastAssistantIndex >= 0) {
    const current = String(next[lastAssistantIndex].content || '');
    if (current === draftAssistant || current.startsWith(draftAssistant)) {
      return next;
    }
    if (draftAssistant.startsWith(current)) {
      next[lastAssistantIndex] = {
        ...next[lastAssistantIndex],
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
    .map((entry: any) => ({
      id: String(entry.id || ''),
      itemId: String(entry.itemId || ''),
      kind:
        entry.kind === 'running' || entry.kind === 'success' || entry.kind === 'error' || entry.kind === 'notice'
          ? entry.kind
          : 'notice',
      command: String(entry.command || ''),
      output: String(entry.output || ''),
      statusText: String(entry.statusText || ''),
      timestamp: String(entry.timestamp || ''),
      durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : 0
    }))
    .filter((entry) => entry.id);
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [runningConversationIds, setRunningConversationIds] = useState<number[]>([]);
  const [chatTitle, setChatTitle] = useState('Nuevo chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [sendStartedAtMs, setSendStartedAtMs] = useState<number | null>(null);
  const [sendElapsedSeconds, setSendElapsedSeconds] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [options, setOptions] = useState<ChatOptions>({
    models: [],
    reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaults: { model: DEFAULT_MODEL, reasoningEffort: DEFAULT_REASONING_EFFORT }
  });
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL);
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState(DEFAULT_REASONING_EFFORT);
  const [chatModel, setChatModel] = useState(DEFAULT_MODEL);
  const [chatReasoningEffort, setChatReasoningEffort] = useState(DEFAULT_REASONING_EFFORT);
  const [caps, setCaps] = useState<Capabilities>({ web: true, code: true, memory: false });
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [offlineMessage, setOfflineMessage] = useState('No se pudo contactar al servidor.');
  const [restartState, setRestartState] = useState<RestartState | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [liveReasoning, setLiveReasoning] = useState('');

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
  const previousScreenRef = useRef<Screen>('hub');
  const hydrateInFlightRef = useRef<Promise<void> | null>(null);

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

  const persistTerminal = useCallback((next: TerminalEntry[]) => {
    setTerminalEntries(next);
    try {
      localStorage.setItem(TERMINAL_KEY, JSON.stringify(next));
    } catch (_error) {
      // ignore
    }
  }, []);

  const upsertTerminal = useCallback(
    (itemId: string, patch: Partial<TerminalEntry>) => {
      setTerminalEntries((prev) => {
        const idx = prev.findIndex((item) => item.itemId && item.itemId === itemId);
        if (idx === -1) {
          const created: TerminalEntry = {
            id: itemId || `cmd_${Date.now()}`,
            itemId,
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
      const next = [
        ...prev,
        {
          id: `note_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
          itemId: '',
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

  const loadConversationsAndPick = useCallback(
    async (preferredId?: number | null, usernameOverride?: string | null) => {
      const rows = await listConversations();
      const sorted = byDateDesc(rows);
      setConversations(sorted);

      const chosenId =
        preferredId && sorted.some((item) => item.id === preferredId)
          ? preferredId
          : sorted.length > 0
            ? sorted[0].id
            : null;

      if (!chosenId) {
        const draftOnly = getLiveDraftForConversation(null, usernameOverride);
        setActiveConversationId(null);
        setChatTitle('Nuevo chat');
        setMessages(draftOnly ? mergeMessagesWithDraft([], draftOnly.draft) : []);
        setLiveReasoning(
          draftOnly ? serializeReasoning(new Map(Object.entries(draftOnly.draft.reasoningByItem || {}))) : ''
        );
        setChatModel(defaultModel);
        setChatReasoningEffort(defaultReasoningEffort);
        return;
      }

      const detail = await listMessages(chosenId);
      const localDraft = getLiveDraftForConversation(chosenId, usernameOverride);
      const serverDraft =
        detail.liveDraft && typeof detail.liveDraft === 'object' ? (detail.liveDraft as LiveChatDraft) : null;
      const liveDraft =
        serverDraft && !serverDraft.completed
          ? { storageKey: '', draft: serverDraft }
          : localDraft;
      setActiveConversationId(chosenId);
      setChatTitle(detail.conversation.title || 'Chat');
      setMessages(mergeMessagesWithDraft(detail.messages || [], liveDraft ? liveDraft.draft : null));
      setLiveReasoning(
        liveDraft ? serializeReasoning(new Map(Object.entries(liveDraft.draft.reasoningByItem || {}))) : ''
      );
      setChatModel(detail.conversation.model || DEFAULT_MODEL);
      setChatReasoningEffort(detail.conversation.reasoningEffort || DEFAULT_REASONING_EFFORT);
    },
    [defaultModel, defaultReasoningEffort, getLiveDraftForConversation]
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
          const rawCaps = localStorage.getItem(CAPS_KEY);
          setDefaultModel(savedModel);
          setDefaultReasoningEffort(savedReasoning);
          setChatModel(savedModel);
          setChatReasoningEffort(savedReasoning);
          if (rawCaps) {
            const parsed = JSON.parse(rawCaps);
            setCaps({ web: Boolean(parsed.web), code: Boolean(parsed.code), memory: Boolean(parsed.memory) });
          }
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
      localStorage.setItem(CAPS_KEY, JSON.stringify(caps));
    } catch (_error) {
      // ignore
    }
  }, [caps, defaultModel, defaultReasoningEffort]);

  useEffect(() => {
    if (activeConversationId !== null) return;
    setChatModel(defaultModel);
    setChatReasoningEffort(defaultReasoningEffort);
  }, [activeConversationId, defaultModel, defaultReasoningEffort]);

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

  const navigate = useCallback(
    (next: Screen, data?: { chatId?: number }) => {
      if (next !== 'offline') {
        previousScreenRef.current = next;
      }

      const targetChatId =
        next === 'chat' && Number.isInteger(data?.chatId) ? Number(data?.chatId) : null;
      if (
        sending &&
        (next !== 'chat' || !targetChatId || targetChatId !== activeConversationId)
      ) {
        cancelActiveStream('Stream detenido por cambio de chat.');
      }

      if (next === 'chat' && targetChatId) {
        void (async () => {
          try {
            const detail = await listMessages(targetChatId);
            const localDraft = getLiveDraftForConversation(targetChatId);
            const serverDraft =
              detail.liveDraft && typeof detail.liveDraft === 'object' ? (detail.liveDraft as LiveChatDraft) : null;
            const liveDraft =
              serverDraft && !serverDraft.completed
                ? { storageKey: '', draft: serverDraft }
                : localDraft;
            setActiveConversationId(targetChatId);
            setChatTitle(detail.conversation.title || 'Chat');
            setMessages(mergeMessagesWithDraft(detail.messages || [], liveDraft ? liveDraft.draft : null));
            setLiveReasoning(
              liveDraft ? serializeReasoning(new Map(Object.entries(liveDraft.draft.reasoningByItem || {}))) : ''
            );
            setChatModel(detail.conversation.model || DEFAULT_MODEL);
            setChatReasoningEffort(
              detail.conversation.reasoningEffort || DEFAULT_REASONING_EFFORT
            );
            setScreen('chat');
          } catch (error: any) {
            setStatus(error?.message || 'No se pudo abrir el chat.');
          }
        })();
        return;
      }

      setScreen(next);
    },
    [activeConversationId, cancelActiveStream, getLiveDraftForConversation, sending]
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
    setConversations([]);
    setActiveConversationId(null);
    setScreen('login');
  }, [cancelActiveStream]);

  const handleCreateChat = useCallback(async () => {
    if (sending) {
      cancelActiveStream('Stream detenido para crear un chat nuevo.');
    }
    setActiveConversationId(null);
    setChatTitle('Nuevo chat');
    setMessages([]);
    setChatModel(defaultModel);
    setChatReasoningEffort(defaultReasoningEffort);
    setScreen('chat');
  }, [cancelActiveStream, defaultModel, defaultReasoningEffort, sending]);

  const handleRefresh = useCallback(async () => {
    try {
      await loadConversationsAndPick(activeConversationId);
      setAttachments(await listAttachments(200));
    } catch (error: any) {
      setStatus(error?.message || 'No se pudo refrescar.');
    }
  }, [activeConversationId, loadConversationsAndPick]);

  const handleDeleteConversation = useCallback(
    async (conversationId: number) => {
      try {
        if (sending && activeConversationId === conversationId) {
          cancelActiveStream('Stream detenido porque el chat fue eliminado.');
        }
        await deleteConversation(conversationId);
        setRunningConversationIds((prev) => prev.filter((id) => id !== conversationId));
        const preferredId = activeConversationId === conversationId ? null : activeConversationId;
        await loadConversationsAndPick(preferredId);
        setAttachments(await listAttachments(200));
        if (activeConversationId === conversationId && screen === 'chat') {
          setScreen('hub');
        }
        setStatus('Chat eliminado.');
      } catch (error: any) {
        setStatus(error?.message || 'No se pudo eliminar el chat.');
      }
    },
    [activeConversationId, cancelActiveStream, loadConversationsAndPick, screen, sending]
  );

  const handleDeleteAttachment = useCallback(async (attachmentId: string) => {
    try {
      await deleteAttachment(attachmentId);
      setAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
      setStatus('Adjunto eliminado.');
    } catch (error: any) {
      setStatus(error?.message || 'No se pudo eliminar el adjunto.');
    }
  }, []);

  const handleChatModelChange = useCallback(
    async (value: string) => {
      setChatModel(value);
      if (!activeConversationId || activeConversationId <= 0) return;
      try {
        const updated = await updateConversationSettings(activeConversationId, { model: value });
        setConversations((prev) =>
          prev.map((item) =>
            item.id === activeConversationId ? { ...item, model: updated.model } : item
          )
        );
      } catch (error: any) {
        setStatus(error?.message || 'No se pudo actualizar el modelo del chat.');
      }
    },
    [activeConversationId]
  );

  const handleChatReasoningChange = useCallback(
    async (value: string) => {
      setChatReasoningEffort(value);
      if (!activeConversationId || activeConversationId <= 0) return;
      try {
        const updated = await updateConversationSettings(activeConversationId, { reasoningEffort: value });
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
    [activeConversationId]
  );

  const handleStop = useCallback(() => {
    cancelActiveStream('Solicitud detenida.');
  }, [cancelActiveStream]);

  const handleSend = useCallback(
    async (inputText: string) => {
      if (sending) return;
      const trimmed = inputText.trim();
      if (!trimmed && selectedFiles.length === 0) return;

      const now = Date.now();
      const startedAtIso = new Date(now).toISOString();
      const tempUserMessageId = -now;
      const tempAssistantMessageId = -(now + 1);
      const userMessage: Message = {
        id: tempUserMessageId,
        role: 'user',
        content: trimmed || '[Adjuntos enviados]',
        created_at: startedAtIso
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

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
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
      setStatus('Generando...');

      const controller = new AbortController();
      streamAbortRef.current = controller;
      activeStreamConversationRef.current = activeConversationId;
      let trackedRunningConversationId: number | null = activeConversationId;
      let conversationFromStream: number | null = activeConversationId;
      let streamCompleted = false;
      let streamRequestStarted = false;

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
        for (const file of selectedFiles) {
          const item = await uploadAttachment(file, activeConversationId, controller.signal);
          if (!isCurrentSession()) return;
          uploaded.push(item);
        }

        setSelectedFiles([]);

        const response = await startChatStream({
          message: trimmed,
          model: chatModel,
          reasoningEffort: chatReasoningEffort,
          conversationId: activeConversationId,
          attachments: uploaded,
          signal: controller.signal
        });
        if (!isCurrentSession()) return;
        streamRequestStarted = true;

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
          assistant_delta: (payload) => {
            if (!isCurrentSession()) return;
            const delta = String(payload?.text || '');
            if (!delta) return;
            assistantDraftRef.current = `${assistantDraftRef.current}${delta}`;
            scheduleDraftPersist(false);
            const draftId = liveAssistantMessageIdRef.current;
            if (draftId === null) return;
            const nextContent = assistantDraftRef.current;
            setMessages((prev) => {
              const idx = prev.findIndex((entry) => entry.id === draftId);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = {
                ...next[idx],
                content: nextContent
              };
              return next;
            });
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
              appendTerminalNotice(text);
            }
          },
          command_started: (payload) => {
            if (!isCurrentSession()) return;
            const itemId = String(payload?.itemId || `cmd_${Date.now()}`);
            const statusText = String(payload?.status || 'running');
            upsertTerminal(itemId, {
              itemId,
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
            setTerminalEntries((prev) => {
              const idx = prev.findIndex((entry) => entry.itemId === itemId);
              if (idx === -1) {
                const next = [
                  ...prev,
                  {
                    id: itemId,
                    itemId,
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
              next[idx] = {
                ...next[idx],
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
            setTerminalEntries((prev) => {
              const started = prev.find((entry) => entry.itemId === itemId)?.timestamp;
              const startedAt = started ? Date.parse(started) : NaN;
              const idx = prev.findIndex((entry) => entry.itemId === itemId);
              const entry: TerminalEntry = {
                id: itemId,
                itemId,
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
              appendTerminalNotice(`Solicitud finalizó con error (${payload?.exitCode ?? 'n/a'})`);
            }
          }
        });
        if (!isCurrentSession()) return;

        if (!streamCompleted) {
          persistActiveDraftNow(false);
          if (conversationFromStream && conversationFromStream > 0) {
            void loadConversationsAndPick(conversationFromStream).catch(() => {
              // ignore refresh errors in detached mode
            });
          }
          setStatus('La conexión se cerró, pero la ejecución sigue en segundo plano.');
          return;
        }

        await loadConversationsAndPick(conversationFromStream);
        setAttachments(await listAttachments(200));
        setStatus('Respuesta completa.');
      } catch (error: any) {
        if (!isCurrentSession()) return;
        const aborted = error?.name === 'AbortError';
        if (aborted && streamRequestStarted) {
          persistActiveDraftNow(false);
          if (conversationFromStream && conversationFromStream > 0) {
            void loadConversationsAndPick(conversationFromStream).catch(() => {
              // ignore refresh errors in detached mode
            });
          }
          setStatus('Conexión cerrada. La ejecución seguirá en segundo plano.');
        } else {
          setStatus(aborted ? 'Solicitud detenida.' : error?.message || 'Error en el envío.');
        }
      } finally {
        if (trackedRunningConversationId && trackedRunningConversationId > 0) {
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
      persistActiveDraftNow,
      resetTransientStreamState,
      resolveActiveUsername,
      saveDraftSnapshot,
      scheduleDraftPersist,
      selectedFiles,
      sending,
      updateActiveDraft,
      upsertTerminal
    ]
  );

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
          activeConversationId={activeConversationId}
          runningConversationIds={runningConversationIds}
          onOpenChat={(id) => navigate('chat', { chatId: id })}
          onCreateChat={handleCreateChat}
          onDeleteChat={handleDeleteConversation}
          onLogout={handleLogout}
          onRefresh={handleRefresh}
          onRestart={handleRequestRestart}
          onNavigate={navigate}
        />
      )}

      {screen === 'chat' && (
        <ChatScreen
          chatTitle={chatTitle}
          messages={messages}
          liveReasoning={liveReasoning}
          terminalEntries={terminalEntries}
          sending={sending}
          sendElapsedSeconds={sendElapsedSeconds}
          isRunning={
            activeConversationId !== null &&
            activeConversationId > 0 &&
            runningConversationIds.includes(activeConversationId)
          }
          selectedFiles={selectedFiles}
          model={chatModel}
          reasoningEffort={chatReasoningEffort}
          options={options}
          status={status}
          onBack={() => navigate('hub')}
          onSend={handleSend}
          onStop={handleStop}
          onAddFiles={(files) => {
            const merged = [...selectedFiles, ...files].slice(0, 5);
            setSelectedFiles(merged);
          }}
          onClearFiles={() => setSelectedFiles([])}
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
          onClear={() => persistTerminal([])}
          onNavigate={navigate}
        />
      )}

      {screen === 'attachments' && (
        <AttachmentsScreen
          selectedFiles={selectedFiles}
          attachments={attachments}
          onPickFiles={(files) => {
            const merged = [...selectedFiles, ...files].slice(0, 5);
            setSelectedFiles(merged);
          }}
          onRemoveSelected={(name) => {
            setSelectedFiles((prev) => prev.filter((item) => item.name !== name));
          }}
          onDeleteAttachment={handleDeleteAttachment}
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
          onCapsChange={setCaps}
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
