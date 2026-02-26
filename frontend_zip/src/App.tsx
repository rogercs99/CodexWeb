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

const MODEL_KEY = 'codexweb_model';
const REASONING_KEY = 'codexweb_reasoning_effort';
const CAPS_KEY = 'codexweb_caps';
const TERMINAL_KEY = 'codexweb_terminal_entries_v1';

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

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [chatTitle, setChatTitle] = useState('Nuevo chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [liveReasoning, setLiveReasoning] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [options, setOptions] = useState<ChatOptions>({
    models: [],
    reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaults: { model: '', reasoningEffort: 'medium' }
  });
  const [model, setModel] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState('medium');
  const [caps, setCaps] = useState<Capabilities>({ web: true, code: true, memory: false });
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [offlineMessage, setOfflineMessage] = useState('No se pudo contactar al servidor.');
  const [restartState, setRestartState] = useState<RestartState | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);

  const streamAbortRef = useRef<AbortController | null>(null);
  const assistantDraftRef = useRef('');
  const reasoningByItemRef = useRef<Map<string, string>>(new Map());
  const previousScreenRef = useRef<Screen>('hub');

  const persistTerminal = useCallback((next: TerminalEntry[]) => {
    setTerminalEntries(next);
    try {
      localStorage.setItem(TERMINAL_KEY, JSON.stringify(next.slice(-120)));
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
          const merged = [...prev, created].slice(-120);
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
        const clipped = next.slice(-120);
        try {
          localStorage.setItem(TERMINAL_KEY, JSON.stringify(clipped));
        } catch (_error) {
          // ignore
        }
        return clipped;
      });
    },
    []
  );

  const appendTerminalNotice = useCallback((text: string) => {
    if (!text.trim()) return;
    persistTerminal(
      [...terminalEntries, {
        id: `note_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
        itemId: '',
        kind: 'notice',
        command: text,
        output: '',
        statusText: 'notice',
        timestamp: new Date().toISOString(),
        durationMs: 0
      }].slice(-120)
    );
  }, [persistTerminal, terminalEntries]);

  const loadConversationsAndPick = useCallback(
    async (preferredId?: number | null) => {
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
        setActiveConversationId(null);
        setChatTitle('Nuevo chat');
        setMessages([]);
        return;
      }

      const detail = await listMessages(chosenId);
      setActiveConversationId(chosenId);
      setChatTitle(detail.conversation.title || 'Chat');
      setMessages(detail.messages || []);
    },
    []
  );

  const hydrate = useCallback(async () => {
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
        const savedModel = localStorage.getItem(MODEL_KEY) || opts.defaults.model || '';
        const savedReasoning = localStorage.getItem(REASONING_KEY) || opts.defaults.reasoningEffort || 'medium';
        const rawCaps = localStorage.getItem(CAPS_KEY);
        setModel(savedModel);
        setReasoningEffort(savedReasoning);
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
          if (Array.isArray(parsed)) {
            setTerminalEntries(parsed.slice(-120));
          }
        }
      } catch (_error) {
        // ignore
      }

      await loadConversationsAndPick();
      setScreen('hub');
    } catch (error: any) {
      setOfflineMessage(error?.message || 'No se pudo cargar la sesión.');
      previousScreenRef.current = 'login';
      setScreen('offline');
    }
  }, [loadConversationsAndPick]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    try {
      localStorage.setItem(MODEL_KEY, model || '');
      localStorage.setItem(REASONING_KEY, reasoningEffort || 'medium');
      localStorage.setItem(CAPS_KEY, JSON.stringify(caps));
    } catch (_error) {
      // ignore
    }
  }, [caps, model, reasoningEffort]);

  const navigate = useCallback((next: Screen, data?: { chatId?: number }) => {
    if (next !== 'offline') {
      previousScreenRef.current = next;
    }

    if (next === 'chat' && data?.chatId) {
      void (async () => {
        try {
          const detail = await listMessages(data.chatId as number);
          setActiveConversationId(data.chatId as number);
          setChatTitle(detail.conversation.title || 'Chat');
          setMessages(detail.messages || []);
          setScreen('chat');
        } catch (error: any) {
          setStatus(error?.message || 'No se pudo abrir el chat.');
        }
      })();
      return;
    }

    setScreen(next);
  }, []);

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
  }, []);

  const handleCreateChat = useCallback(async () => {
    setActiveConversationId(null);
    setChatTitle('Nuevo chat');
    setMessages([]);
    setScreen('chat');
  }, []);

  const handleRefresh = useCallback(async () => {
    try {
      await loadConversationsAndPick(activeConversationId);
      setAttachments(await listAttachments(200));
    } catch (error: any) {
      setStatus(error?.message || 'No se pudo refrescar.');
    }
  }, [activeConversationId, loadConversationsAndPick]);

  const handleStop = useCallback(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
  }, []);

  const handleSend = useCallback(
    async (inputText: string) => {
      if (sending) return;
      const trimmed = inputText.trim();
      if (!trimmed && selectedFiles.length === 0) return;

      const userMessage: Message = {
        id: Date.now(),
        role: 'user',
        content: trimmed || '[Adjuntos enviados]',
        created_at: new Date().toISOString()
      };

      setMessages((prev) => [...prev, userMessage]);
      setLiveReasoning('');
      assistantDraftRef.current = '';
      reasoningByItemRef.current = new Map();

      setSending(true);
      setStatus('Enviando...');

      const controller = new AbortController();
      streamAbortRef.current = controller;

      try {
        const uploaded = [] as Array<{ uploadId: string }>;
        for (const file of selectedFiles) {
          const item = await uploadAttachment(file, activeConversationId, controller.signal);
          uploaded.push(item);
        }

        setSelectedFiles([]);

        const response = await startChatStream({
          message: trimmed,
          model,
          reasoningEffort,
          conversationId: activeConversationId,
          attachments: uploaded,
          signal: controller.signal
        });

        let conversationFromStream: number | null = activeConversationId;

        await consumeSse(response, {
          conversation: (payload) => {
            const nextId = Number(payload?.conversationId);
            if (Number.isInteger(nextId) && nextId > 0) {
              conversationFromStream = nextId;
              setActiveConversationId(nextId);
            }
          },
          assistant_delta: (payload) => {
            const delta = String(payload?.text || '');
            if (!delta) return;
            assistantDraftRef.current = `${assistantDraftRef.current}${delta}`;
          },
          reasoning_delta: (payload) => {
            const delta = String(payload?.text || '');
            const itemId = String(payload?.itemId || 'default');
            if (!delta) return;
            const map = new Map<string, string>(reasoningByItemRef.current);
            map.set(itemId, `${map.get(itemId) || ''}${delta}`);
            reasoningByItemRef.current = map;
            setLiveReasoning(
              Array.from(map.values())
                .map((entry: string) => entry.trim())
                .filter(Boolean)
                .join('\n\n')
            );
          },
          reasoning_step: (payload) => {
            const text = String(payload?.text || '').trim();
            const itemId = String(payload?.itemId || 'default');
            if (!text) return;
            const map = new Map<string, string>(reasoningByItemRef.current);
            map.set(itemId, text);
            reasoningByItemRef.current = map;
            setLiveReasoning(
              Array.from(map.values())
                .map((entry: string) => entry.trim())
                .filter(Boolean)
                .join('\n\n')
            );
          },
          system_notice: (payload) => {
            const text = String(payload?.text || '').trim();
            if (text) {
              appendTerminalNotice(text);
            }
          },
          command_started: (payload) => {
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
            const itemId = String(payload?.itemId || '');
            const delta = String(payload?.text || '');
            if (!itemId || !delta) return;
            const existing = terminalEntries.find((entry) => entry.itemId === itemId);
            upsertTerminal(itemId, {
              output: `${existing?.output || ''}${delta}`.slice(-12000)
            });
          },
          command_completed: (payload) => {
            const itemId = String(payload?.itemId || `cmd_${Date.now()}`);
            const statusText = String(payload?.status || 'completed');
            const exitCode = Number.isFinite(Number(payload?.exitCode)) ? Number(payload?.exitCode) : null;
            const started = terminalEntries.find((entry) => entry.itemId === itemId)?.timestamp;
            const startedAt = started ? Date.parse(started) : NaN;
            upsertTerminal(itemId, {
              itemId,
              command: String(payload?.command || '(comando)'),
              statusText,
              kind: classifyTerminalStatus(statusText, exitCode),
              output: String(payload?.output || ''),
              durationMs: Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0
            });
          },
          done: (payload) => {
            if (!payload?.ok) {
              appendTerminalNotice(`Solicitud finalizó con error (${payload?.exitCode ?? 'n/a'})`);
            }
          }
        });

        await loadConversationsAndPick(conversationFromStream);
        setAttachments(await listAttachments(200));
        setStatus('Enviado.');
      } catch (error: any) {
        const aborted = error?.name === 'AbortError';
        setStatus(aborted ? 'Solicitud detenida.' : error?.message || 'Error en el envío.');
      } finally {
        streamAbortRef.current = null;
        setSending(false);
        setLiveReasoning('');
        assistantDraftRef.current = '';
        reasoningByItemRef.current = new Map();
      }
    },
    [
      activeConversationId,
      appendTerminalNotice,
      loadConversationsAndPick,
      model,
      reasoningEffort,
      selectedFiles,
      sending,
      terminalEntries,
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
          onOpenChat={(id) => navigate('chat', { chatId: id })}
          onCreateChat={handleCreateChat}
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
          sending={sending}
          selectedFiles={selectedFiles}
          model={model}
          reasoningEffort={reasoningEffort}
          status={status}
          onBack={() => navigate('hub')}
          onSend={handleSend}
          onStop={handleStop}
          onAddFiles={(files) => {
            const merged = [...selectedFiles, ...files].slice(0, 5);
            setSelectedFiles(merged);
          }}
          onClearFiles={() => setSelectedFiles([])}
          onNavigate={navigate}
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
          model={model}
          reasoningEffort={reasoningEffort}
          caps={caps}
          onModelChange={setModel}
          onReasoningChange={setReasoningEffort}
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
