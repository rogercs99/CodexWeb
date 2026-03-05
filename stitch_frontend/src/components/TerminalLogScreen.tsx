import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  LayoutDashboard,
  RefreshCw,
  Search as SearchIcon,
  Square,
  Terminal as TerminalIcon,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCodexRuns,
  getTaskDashboard,
  getToolsGitRepos,
  getToolsObservability,
  getUnifiedToolsSearch,
  killAllCodexRuns,
  killConversationSession,
  pushToolsGitRepo,
  resolveToolsGitConflicts,
  rollbackTaskRun
} from '../lib/api';
import BottomNav from './BottomNav';
import type {
  CodexBackgroundRun,
  Conversation,
  ObservabilitySnapshot,
  Screen,
  TaskRunDashboardItem,
  TerminalEntry,
  ToolsGitRepoSummary,
  UnifiedSearchPayload
} from '../lib/types';

type ToolsView = 'menu' | 'processes' | 'dashboard' | 'terminal' | 'search' | 'observability' | 'git';

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

function formatElapsed(startedAt: string) {
  const timestamp = Date.parse(String(startedAt || ''));
  if (!Number.isFinite(timestamp)) return '--';
  const totalSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDurationMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '--';
  return `${Math.round(value)} ms`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  const decimals = current >= 100 || unitIndex === 0 ? 0 : 1;
  return `${current.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatPercent(value: number, decimals = 1) {
  if (!Number.isFinite(value)) return '--';
  return `${Number(value).toFixed(decimals)}%`;
}

function formatUptime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
  }
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeConversationId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const raw = (error as { status?: unknown }).status;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

interface TerminalGroup {
  key: string;
  conversationId: number | null;
  title: string;
  entries: TerminalEntry[];
  latestAt: number;
}

interface RunGroup {
  key: string;
  conversationId: number | null;
  title: string;
  runs: CodexBackgroundRun[];
  latestAt: number;
}

interface TaskGroup {
  key: string;
  conversationId: number | null;
  title: string;
  tasks: TaskRunDashboardItem[];
  latestAt: number;
}

interface UnifiedSearchGroup {
  key: string;
  conversationId: number | null;
  title: string;
  chats: UnifiedSearchPayload['results']['chats'];
  commands: UnifiedSearchPayload['results']['commands'];
  errors: UnifiedSearchPayload['results']['errors'];
  files: UnifiedSearchPayload['results']['files'];
  latestAt: number;
}

export default function TerminalLogScreen({
  entries,
  conversations,
  onClear,
  onClearConversation,
  onNavigate,
  onRunsChanged
}: {
  entries: TerminalEntry[];
  conversations: Conversation[];
  onClear: () => void;
  onClearConversation: (conversationId: number | null) => void;
  onNavigate: (screen: Screen, data?: { chatId?: number; draftMessage?: string; autoSend?: boolean }) => void;
  onRunsChanged?: () => void;
}) {
  const [activeView, setActiveView] = useState<ToolsView>('menu');
  const [filter, setFilter] = useState<'all' | 'running' | 'success' | 'error' | 'notice'>('all');
  const [runs, setRuns] = useState<CodexBackgroundRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState('');
  const [stoppingConversationId, setStoppingConversationId] = useState<number | null>(null);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [tasks, setTasks] = useState<TaskRunDashboardItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState('');
  const [rollbackingTaskId, setRollbackingTaskId] = useState<number | null>(null);
  const [expandedRunGroups, setExpandedRunGroups] = useState<Record<string, boolean>>({});
  const [expandedTaskGroups, setExpandedTaskGroups] = useState<Record<string, boolean>>({});
  const [expandedTerminalGroups, setExpandedTerminalGroups] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchData, setSearchData] = useState<UnifiedSearchPayload | null>(null);
  const [expandedSearchGroups, setExpandedSearchGroups] = useState<Record<string, boolean>>({});
  const [observability, setObservability] = useState<ObservabilitySnapshot | null>(null);
  const [observabilityLoading, setObservabilityLoading] = useState(true);
  const [observabilityError, setObservabilityError] = useState('');
  const [gitRepos, setGitRepos] = useState<ToolsGitRepoSummary[]>([]);
  const [gitReposScannedAt, setGitReposScannedAt] = useState('');
  const [gitReposLoading, setGitReposLoading] = useState(true);
  const [gitReposError, setGitReposError] = useState('');
  const [expandedGitRepos, setExpandedGitRepos] = useState<Record<string, boolean>>({});
  const [pushingGitRepoId, setPushingGitRepoId] = useState<string | null>(null);
  const [resolvingGitRepoId, setResolvingGitRepoId] = useState<string | null>(null);
  const [gitNotice, setGitNotice] = useState('');

  const loadRuns = useCallback(async (silent = false) => {
    if (!silent) {
      setRunsLoading(true);
    }
    setRunsError('');
    try {
      const nextRuns = await getCodexRuns();
      setRuns(nextRuns);
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : 'No se pudieron cargar los procesos activos');
    } finally {
      if (!silent) {
        setRunsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      void loadRuns(true);
    }, 4000);
    return () => {
      window.clearInterval(pollId);
    };
  }, [loadRuns]);

  const loadTasks = useCallback(async (silent = false) => {
    if (!silent) {
      setTasksLoading(true);
    }
    setTasksError('');
    try {
      const nextTasks = await getTaskDashboard(35);
      setTasks(nextTasks);
    } catch (error) {
      if (getErrorStatus(error) === 404) {
        setTasksError('Dashboard no disponible (404). Reinicia CodexWeb para cargar esta mejora.');
      } else {
        setTasksError(error instanceof Error ? error.message : 'No se pudo cargar dashboard de tareas');
      }
    } finally {
      if (!silent) {
        setTasksLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      void loadTasks(true);
    }, 6500);
    return () => {
      window.clearInterval(pollId);
    };
  }, [loadTasks]);

  const loadUnifiedSearch = useCallback(async (query: string, silent = false) => {
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) {
      setSearchError('');
      setSearchData({
        query: trimmed,
        minQueryLength: 2,
        limit: 12,
        counts: { chats: 0, commands: 0, errors: 0, files: 0 },
        results: { chats: [], commands: [], errors: [], files: [] }
      });
      if (!silent) {
        setSearchLoading(false);
      }
      return;
    }
    if (!silent) {
      setSearchLoading(true);
    }
    setSearchError('');
    try {
      const result = await getUnifiedToolsSearch(trimmed, 12);
      setSearchData(result);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'No se pudo ejecutar la busqueda unificada');
    } finally {
      if (!silent) {
        setSearchLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (activeView !== 'search') return;
    const handle = window.setTimeout(() => {
      void loadUnifiedSearch(searchQuery);
    }, 220);
    return () => {
      window.clearTimeout(handle);
    };
  }, [activeView, loadUnifiedSearch, searchQuery]);

  const loadObservability = useCallback(async (silent = false) => {
    if (!silent) {
      setObservabilityLoading(true);
    }
    setObservabilityError('');
    try {
      const snapshot = await getToolsObservability();
      setObservability(snapshot);
    } catch (error) {
      setObservabilityError(error instanceof Error ? error.message : 'No se pudo cargar observabilidad');
    } finally {
      if (!silent) {
        setObservabilityLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (activeView !== 'observability') return;
    void loadObservability();
    const pollId = window.setInterval(() => {
      void loadObservability(true);
    }, 5000);
    return () => {
      window.clearInterval(pollId);
    };
  }, [activeView, loadObservability]);

  const loadGitRepoView = useCallback(async (silent = false, forceRefresh = false) => {
    if (!silent) {
      setGitReposLoading(true);
    }
    setGitReposError('');
    try {
      const payload = await getToolsGitRepos(forceRefresh);
      setGitRepos(Array.isArray(payload.repos) ? payload.repos : []);
      setGitReposScannedAt(String(payload.scannedAt || ''));
    } catch (error) {
      setGitReposError(error instanceof Error ? error.message : 'No se pudo cargar estado Git');
    } finally {
      if (!silent) {
        setGitReposLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadGitRepoView(true, false);
  }, [loadGitRepoView]);

  useEffect(() => {
    if (activeView !== 'git') return;
    void loadGitRepoView(false, true);
    const pollId = window.setInterval(() => {
      void loadGitRepoView(true, false);
    }, 7000);
    return () => {
      window.clearInterval(pollId);
    };
  }, [activeView, loadGitRepoView]);

  const filtered = useMemo(
    () => entries.filter((entry) => (filter === 'all' ? true : entry.kind === filter)),
    [entries, filter]
  );

  const conversationById = useMemo(() => {
    const next = new Map<number, Conversation>();
    for (const conversation of conversations) {
      next.set(conversation.id, conversation);
    }
    return next;
  }, [conversations]);

  const groupedByChat = useMemo(() => {
    const groups = new Map<string, TerminalGroup>();
    for (const entry of filtered) {
      const conversationId = normalizeConversationId(entry.conversationId);
      const key = conversationId === null ? 'draft' : `chat_${conversationId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.entries.push(entry);
        existing.latestAt = Math.max(existing.latestAt, toTimestamp(entry.timestamp));
        continue;
      }
      const conversation = conversationId === null ? null : conversationById.get(conversationId) || null;
      groups.set(key, {
        key,
        conversationId,
        title: conversation?.title || (conversationId === null ? 'Sin chat asignado' : `Chat ${conversationId}`),
        entries: [entry],
        latestAt: toTimestamp(entry.timestamp)
      });
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        entries: group.entries.slice().sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp))
      }))
      .sort((a, b) => b.latestAt - a.latestAt);
  }, [conversationById, filtered]);

  const runGroups = useMemo(() => {
    const groups = new Map<string, RunGroup>();
    for (const run of runs) {
      const conversationId = normalizeConversationId(run.conversationId);
      const key = conversationId === null ? 'draft' : `chat_${conversationId}`;
      const conversation = conversationId === null ? null : conversationById.get(conversationId) || null;
      const title =
        run.title?.trim() ||
        conversation?.title ||
        (conversationId === null ? 'Sin chat asignado' : `Chat ${conversationId}`);
      const existing = groups.get(key);
      if (existing) {
        existing.runs.push(run);
        existing.latestAt = Math.max(existing.latestAt, toTimestamp(run.startedAt));
      } else {
        groups.set(key, {
          key,
          conversationId,
          title,
          runs: [run],
          latestAt: toTimestamp(run.startedAt)
        });
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        runs: group.runs.slice().sort((a, b) => toTimestamp(b.startedAt) - toTimestamp(a.startedAt))
      }))
      .sort((a, b) => b.latestAt - a.latestAt);
  }, [conversationById, runs]);

  const taskGroups = useMemo(() => {
    const groups = new Map<string, TaskGroup>();
    for (const task of tasks) {
      const conversationId = normalizeConversationId(task.conversationId);
      const key = conversationId === null ? 'draft' : `chat_${conversationId}`;
      const conversation = conversationId === null ? null : conversationById.get(conversationId) || null;
      const title =
        task.conversationTitle?.trim() ||
        conversation?.title ||
        (conversationId === null ? 'Sin chat asignado' : `Chat ${conversationId}`);
      const existing = groups.get(key);
      if (existing) {
        existing.tasks.push(task);
        existing.latestAt = Math.max(existing.latestAt, toTimestamp(task.updatedAt || task.finishedAt || task.startedAt));
      } else {
        groups.set(key, {
          key,
          conversationId,
          title,
          tasks: [task],
          latestAt: toTimestamp(task.updatedAt || task.finishedAt || task.startedAt)
        });
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        tasks: group.tasks.slice().sort((a, b) => {
          const aTime = toTimestamp(a.updatedAt || a.finishedAt || a.startedAt);
          const bTime = toTimestamp(b.updatedAt || b.finishedAt || b.startedAt);
          return bTime - aTime;
        })
      }))
      .sort((a, b) => b.latestAt - a.latestAt);
  }, [conversationById, tasks]);

  const searchGroups = useMemo(() => {
    const groups = new Map<string, UnifiedSearchGroup>();
    const payload = searchData?.results;
    if (!payload) return [];

    const upsertGroup = (conversationId: number | null, titleHint: string, timestampRaw: string) => {
      const key = conversationId === null ? 'draft' : `chat_${conversationId}`;
      const existing = groups.get(key);
      const latestAt = toTimestamp(timestampRaw);
      const title =
        titleHint?.trim() ||
        (conversationId === null ? 'Sin chat asignado' : conversationById.get(conversationId)?.title || `Chat ${conversationId}`);
      if (existing) {
        existing.latestAt = Math.max(existing.latestAt, latestAt);
        if (!existing.title.trim() && title) {
          existing.title = title;
        }
        return existing;
      }
      const next: UnifiedSearchGroup = {
        key,
        conversationId,
        title,
        chats: [],
        commands: [],
        errors: [],
        files: [],
        latestAt
      };
      groups.set(key, next);
      return next;
    };

    for (const hit of payload.chats) {
      const convId = normalizeConversationId(hit.conversationId);
      const group = upsertGroup(convId, hit.title, hit.lastMessageAt);
      group.chats.push(hit);
    }
    for (const hit of payload.commands) {
      const convId = normalizeConversationId(hit.conversationId);
      const group = upsertGroup(convId, hit.conversationTitle, hit.at);
      group.commands.push(hit);
    }
    for (const hit of payload.errors) {
      const convId = normalizeConversationId(hit.conversationId);
      const group = upsertGroup(convId, hit.conversationTitle, hit.at);
      group.errors.push(hit);
    }
    for (const hit of payload.files) {
      const convId = normalizeConversationId(hit.conversationId);
      const group = upsertGroup(convId, hit.conversationTitle, hit.at);
      group.files.push(hit);
    }

    return Array.from(groups.values())
      .sort((a, b) => b.latestAt - a.latestAt)
      .map((group) => ({
        ...group,
        chats: group.chats.slice().sort((a, b) => toTimestamp(b.lastMessageAt) - toTimestamp(a.lastMessageAt)),
        commands: group.commands.slice().sort((a, b) => toTimestamp(b.at) - toTimestamp(a.at)),
        errors: group.errors.slice().sort((a, b) => toTimestamp(b.at) - toTimestamp(a.at)),
        files: group.files.slice().sort((a, b) => toTimestamp(b.at) - toTimestamp(a.at))
      }));
  }, [conversationById, searchData]);

  const stopOneRun = async (conversationId: number) => {
    setStoppingConversationId(conversationId);
    setRunsError('');
    try {
      await killConversationSession(conversationId);
      await loadRuns(true);
      onRunsChanged?.();
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : 'No se pudo detener el proceso seleccionado');
    } finally {
      setStoppingConversationId(null);
    }
  };

  const stopAllRuns = async () => {
    setStoppingAll(true);
    setRunsError('');
    try {
      await killAllCodexRuns();
      await loadRuns(true);
      onRunsChanged?.();
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : 'No se pudieron detener los procesos activos');
    } finally {
      setStoppingAll(false);
    }
  };

  const rollbackTask = async (taskId: number) => {
    setRollbackingTaskId(taskId);
    setTasksError('');
    try {
      await rollbackTaskRun(taskId);
      await loadTasks(true);
      onRunsChanged?.();
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : 'No se pudo aplicar rollback');
    } finally {
      setRollbackingTaskId(null);
    }
  };

  const formatTaskStatus = (status: string) => {
    const normalized = String(status || '')
      .trim()
      .toLowerCase();
    if (normalized === 'success') return 'success';
    if (normalized === 'failed') return 'failed';
    if (normalized === 'rolled_back') return 'rolled_back';
    if (normalized === 'running') return 'running';
    return normalized || 'unknown';
  };

  const formatRisk = (risk: string) => {
    const normalized = String(risk || '')
      .trim()
      .toLowerCase();
    if (normalized === 'high') return 'alto';
    if (normalized === 'medium') return 'medio';
    return 'bajo';
  };

  const openRunGroup = (key: string) => {
    setExpandedRunGroups((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  const openTaskGroup = (key: string) => {
    setExpandedTaskGroups((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  const openTerminalGroup = (key: string) => {
    setExpandedTerminalGroups((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  const openSearchGroup = (key: string) => {
    setExpandedSearchGroups((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  const openGitRepo = (repoId: string) => {
    setExpandedGitRepos((prev) => (prev[repoId] ? prev : { ...prev, [repoId]: true }));
  };

  const pushGitRepo = async (repoId: string) => {
    setGitReposError('');
    setGitNotice('');
    setPushingGitRepoId(repoId);
    try {
      const response = await pushToolsGitRepo(repoId);
      const hash = String(response.push?.commitHash || '').trim();
      const commitNote = response.push?.commitCreated ? (hash ? `commit ${hash}` : 'commit nuevo') : 'sin commit nuevo';
      setGitNotice(`Push completado (${commitNote}).`);
      await loadGitRepoView(true, true);
      onRunsChanged?.();
    } catch (error) {
      setGitReposError(error instanceof Error ? error.message : 'No se pudo subir cambios del repositorio');
    } finally {
      setPushingGitRepoId(null);
    }
  };

  const resolveGitConflicts = async (repoId: string) => {
    setGitReposError('');
    setGitNotice('');
    setResolvingGitRepoId(repoId);
    try {
      const response = await resolveToolsGitConflicts(repoId);
      const chatId = Number(response?.resolver?.conversationId);
      const prompt = String(response?.resolver?.prompt || '').trim();
      const autoSend = Boolean(response?.resolver?.autoSend);
      if (!Number.isInteger(chatId) || chatId <= 0 || !prompt) {
        throw new Error('No se pudo preparar el chat de resolución de conflictos.');
      }
      setGitNotice('Chat de resolución creado. Lanzando ejecución automática...');
      onNavigate('chat', {
        chatId,
        draftMessage: prompt,
        autoSend
      });
    } catch (error) {
      setGitReposError(error instanceof Error ? error.message : 'No se pudo iniciar resolución de conflictos');
    } finally {
      setResolvingGitRepoId(null);
    }
  };

  const viewTitle =
    activeView === 'menu'
      ? 'Tools'
      : activeView === 'processes'
        ? 'Tools · Procesos'
      : activeView === 'dashboard'
          ? 'Tools · Dashboard'
          : activeView === 'terminal'
            ? 'Tools · Terminal'
            : activeView === 'search'
              ? 'Tools · Busqueda'
              : activeView === 'observability'
                ? 'Tools · Observabilidad'
                : 'Tools · Git';

  const handleBack = () => {
    if (activeView === 'menu') {
      onNavigate('hub');
      return;
    }
    setActiveView('menu');
  };

  const refreshCurrentView = () => {
    if (activeView === 'processes') {
      void loadRuns();
      return;
    }
    if (activeView === 'dashboard') {
      void loadTasks();
      return;
    }
    if (activeView === 'terminal') {
      void loadRuns(true);
      void loadTasks(true);
      return;
    }
    if (activeView === 'search') {
      void loadUnifiedSearch(searchQuery);
      return;
    }
    if (activeView === 'observability') {
      void loadObservability();
      return;
    }
    if (activeView === 'git') {
      void loadGitRepoView(false, true);
      return;
    }
    void loadRuns();
    void loadTasks();
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <button onClick={handleBack} className="p-2 -ml-2 text-zinc-400 hover:text-white" type="button">
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-base font-semibold tracking-tight">{viewTitle}</h1>
        <button
          onClick={refreshCurrentView}
          className="p-2 -mr-2 text-zinc-400 hover:text-white"
          type="button"
          aria-label="Refrescar herramientas"
        >
          <RefreshCw size={18} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-6">
        {activeView === 'menu' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Menu de aplicaciones</h2>
              <p className="text-xs text-zinc-500">Abre cada vista de Tools por separado.</p>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setActiveView('processes')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Activity size={18} className="text-blue-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">Procesos</p>
                      <p className="text-xs text-zinc-500 truncate">{runGroups.length} chat(s) · {runs.length} proceso(s)</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('dashboard')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <LayoutDashboard size={18} className="text-emerald-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">Dashboard de calidad</p>
                      <p className="text-xs text-zinc-500 truncate">{taskGroups.length} chat(s) · {tasks.length} tarea(s)</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('terminal')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <TerminalIcon size={18} className="text-amber-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">Terminal por chat</p>
                      <p className="text-xs text-zinc-500 truncate">{groupedByChat.length} chat(s) · {filtered.length} evento(s)</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('search')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <SearchIcon size={18} className="text-cyan-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">Busqueda unificada</p>
                      <p className="text-xs text-zinc-500 truncate">Chats, comandos, errores y archivos en una sola caja.</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('observability')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <BarChart3 size={18} className="text-fuchsia-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">Observabilidad tecnica</p>
                      <p className="text-xs text-zinc-500 truncate">Latencia API, CPU/RAM, uptime y errores por endpoint.</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('git')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <GitBranch size={18} className="text-lime-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">Repos Git</p>
                      <p className="text-xs text-zinc-500 truncate">
                        {gitRepos.length} repo(s) · conflictos {gitRepos.filter((repo) => repo.hasConflicts).length}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>
            </div>
          </section>
        ) : null}

        {activeView === 'processes' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Procesos Codex en background</h2>
                <p className="text-xs text-zinc-500">Todo queda contraido por chat y se expande al tocar encima.</p>
              </div>
              <button
                type="button"
                onClick={stopAllRuns}
                disabled={stoppingAll || runs.length === 0}
                className={`text-xs px-3 py-1.5 rounded-lg border ${
                  runs.length > 0
                    ? 'border-red-500/40 bg-red-600/20 text-red-200'
                    : 'border-zinc-700 text-zinc-500'
                } disabled:opacity-50`}
              >
                {stoppingAll ? 'Deteniendo...' : `Detener todos (${runs.length})`}
              </button>
            </div>

            {runsError ? <p className="text-xs text-red-300">{runsError}</p> : null}

            {runsLoading && runGroups.length === 0 ? (
              <p className="text-sm text-zinc-500">Cargando procesos activos...</p>
            ) : null}

            {!runsLoading && runGroups.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay procesos de Codex ejecutandose en background.</p>
            ) : null}

            <div className="space-y-2">
              {runGroups.map((group) => {
                const isOpen = Boolean(expandedRunGroups[group.key]);
                const runningCount = group.runs.filter((run) => run.status === 'running').length;
                const stoppingCount = group.runs.length - runningCount;
                return (
                  <article key={group.key} className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedRunGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }));
                      }}
                      onMouseEnter={() => openRunGroup(group.key)}
                      onFocus={() => openRunGroup(group.key)}
                      className="w-full text-left flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-100 truncate" title={group.title}>{group.title}</p>
                        <p className="text-xs text-zinc-500 mt-1 truncate">
                          {group.conversationId === null ? 'sin chat' : `chat #${group.conversationId}`} · {group.runs.length}{' '}
                          proceso{group.runs.length === 1 ? '' : 's'} · {runningCount} ejecutando
                          {stoppingCount > 0 ? ` · ${stoppingCount} deteniendo` : ''}
                        </p>
                      </div>
                      {isOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                    </button>

                    {isOpen ? (
                      <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
                        {group.runs.map((run) => (
                          <div
                            key={`${group.key}:${run.pid ?? 'pid'}:${run.startedAt}`}
                            className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs text-zinc-400">
                                  pid {run.pid ?? 'n/a'} · {run.status === 'stopping' ? 'deteniendo' : 'ejecutando'} ·{' '}
                                  {formatElapsed(run.startedAt)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  void stopOneRun(run.conversationId);
                                }}
                                disabled={stoppingConversationId === run.conversationId || run.status === 'stopping'}
                                className="shrink-0 px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                                aria-label={`Detener chat ${run.conversationId}`}
                              >
                                {stoppingConversationId === run.conversationId ? (
                                  <span className="inline-flex items-center gap-1 text-xs">
                                    <Square size={12} /> Deteniendo...
                                  </span>
                                ) : (
                                  <span className="text-xs">Detener</span>
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeView === 'dashboard' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Dashboard de calidad por tarea</h2>
              <p className="text-xs text-zinc-500">Contraido por chat: toca el encabezado para ver detalle.</p>
            </div>

            {tasksError ? <p className="text-xs text-red-300">{tasksError}</p> : null}

            {tasksLoading && taskGroups.length === 0 ? <p className="text-sm text-zinc-500">Cargando tareas...</p> : null}

            {!tasksLoading && taskGroups.length === 0 ? (
              <p className="text-sm text-zinc-500">Todavía no hay tareas ejecutadas.</p>
            ) : null}

            <div className="space-y-2">
              {taskGroups.map((group) => {
                const isOpen = Boolean(expandedTaskGroups[group.key]);
                const successCount = group.tasks.filter((task) => formatTaskStatus(task.status) === 'success').length;
                const failedCount = group.tasks.filter((task) => formatTaskStatus(task.status) === 'failed').length;
                const runningCount = group.tasks.filter((task) => formatTaskStatus(task.status) === 'running').length;
                return (
                  <article key={group.key} className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedTaskGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }));
                      }}
                      onMouseEnter={() => openTaskGroup(group.key)}
                      onFocus={() => openTaskGroup(group.key)}
                      className="w-full text-left flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-100 truncate" title={group.title}>{group.title}</p>
                        <p className="text-xs text-zinc-500 mt-1 truncate">
                          {group.conversationId === null ? 'sin chat' : `chat #${group.conversationId}`} · {group.tasks.length}{' '}
                          tarea{group.tasks.length === 1 ? '' : 's'} · ok {successCount} · fallidas {failedCount}
                          {runningCount > 0 ? ` · activas ${runningCount}` : ''}
                        </p>
                      </div>
                      {isOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                    </button>

                    {isOpen ? (
                      <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
                        {group.tasks.map((task) => {
                          const status = formatTaskStatus(task.status);
                          const statusClass =
                            status === 'success'
                              ? 'text-emerald-300'
                              : status === 'running'
                                ? 'text-blue-300'
                                : status === 'rolled_back'
                                  ? 'text-amber-300'
                                  : 'text-red-300';
                          const canRollback = Boolean(task.rollbackAvailable && task.rollbackStatus !== 'done');
                          return (
                            <article key={task.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className={`text-xs ${statusClass}`}>
                                  {status} · riesgo {formatRisk(task.riskLevel)}
                                </p>
                                <div className="text-right">
                                  <p className="text-xs text-zinc-500">{formatDurationMs(task.durationMs)}</p>
                                  <p className="text-[10px] text-zinc-600">tarea #{task.id}</p>
                                </div>
                              </div>
                              <div className="text-xs text-zinc-400">
                                archivos {task.filesTouched.length} · tests {task.testsExecuted.length} · comandos{' '}
                                {task.commandTotal} · fallidos {task.commandFailed}
                              </div>
                              {task.result ? (
                                <p className="text-xs text-zinc-300 whitespace-pre-wrap break-words line-clamp-3">{task.result}</p>
                              ) : null}
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (task.conversationId) {
                                      onNavigate('chat', { chatId: task.conversationId });
                                    }
                                  }}
                                  disabled={!task.conversationId}
                                  className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                                >
                                  Abrir chat
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void rollbackTask(task.id);
                                  }}
                                  disabled={!canRollback || rollbackingTaskId === task.id}
                                  className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                                    canRollback
                                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                                      : 'border-zinc-700 text-zinc-500'
                                  } disabled:opacity-50`}
                                >
                                  {rollbackingTaskId === task.id
                                    ? 'Revirtiendo...'
                                    : task.rollbackStatus === 'done'
                                      ? 'Rollback aplicado'
                                      : 'Rollback 1 clic'}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeView === 'terminal' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Historial de terminal por chat</h2>
                <p className="text-xs text-zinc-500">Listado contraido por chat, con detalle al abrir cada bloque.</p>
              </div>
              <button onClick={onClear} className="p-2 text-zinc-400 hover:text-white" type="button" aria-label="Limpiar historial terminal">
                <Trash2 size={18} />
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {(['all', 'running', 'success', 'error', 'notice'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={`px-4 py-1.5 rounded-full border text-xs uppercase ${
                    filter === item ? 'bg-zinc-800 text-white border-zinc-700' : 'text-zinc-500 border-zinc-800'
                  }`}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {groupedByChat.length === 0 ? <div className="text-sm text-zinc-500">Sin eventos para este filtro.</div> : null}
              {groupedByChat.map((group) => {
                const isOpen = Boolean(expandedTerminalGroups[group.key]);
                const latestTimestamp = group.entries[0]?.timestamp || '';
                return (
                  <article key={group.key} className="rounded-xl border border-zinc-800 bg-black/30 p-3">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedTerminalGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }));
                      }}
                      onMouseEnter={() => openTerminalGroup(group.key)}
                      onFocus={() => openTerminalGroup(group.key)}
                      className="w-full text-left flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-100 truncate" title={group.title}>{group.title}</p>
                        <p className="text-xs text-zinc-500 mt-1 truncate">
                          {group.conversationId === null ? 'sin chat' : `chat #${group.conversationId}`} · {group.entries.length}{' '}
                          evento{group.entries.length === 1 ? '' : 's'} · ultimo {formatTime(latestTimestamp)}
                        </p>
                      </div>
                      {isOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                    </button>

                    {isOpen ? (
                      <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          {group.conversationId !== null ? (
                            <button
                              type="button"
                              onClick={() => onNavigate('chat', { chatId: group.conversationId as number })}
                              className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
                            >
                              Abrir chat
                            </button>
                          ) : (
                            <span />
                          )}
                          <button
                            type="button"
                            onClick={() => onClearConversation(group.conversationId)}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
                          >
                            Limpiar
                          </button>
                        </div>
                        <div className="space-y-2">
                          {group.entries.map((entry) => (
                            <div
                              key={`${group.key}:${entry.id}:${entry.timestamp}`}
                              className={`rounded-xl border p-3 ${
                                entry.kind === 'error'
                                  ? 'border-red-500/30 bg-red-500/5'
                                  : entry.kind === 'success'
                                    ? 'border-emerald-500/30 bg-emerald-500/5'
                                    : entry.kind === 'running'
                                      ? 'border-blue-500/30 bg-blue-500/5'
                                      : 'border-zinc-800 bg-zinc-900/30'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2 text-xs">
                                <span className="uppercase text-zinc-400">{entry.statusText || entry.kind}</span>
                                <span className="text-zinc-600">{formatTime(entry.timestamp)}</span>
                              </div>
                              <pre className="text-xs text-zinc-200 whitespace-pre-wrap break-all">{entry.command}</pre>
                              {entry.output ? (
                                <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all mt-2">{entry.output}</pre>
                              ) : null}
                              {entry.durationMs > 0 ? <p className="text-[10px] text-zinc-600 mt-2">{formatDurationMs(entry.durationMs)}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeView === 'search' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Busqueda unificada</h2>
              <p className="text-xs text-zinc-500">Una sola caja para chat, comandos, errores y archivos tocados.</p>
            </div>

            <div className="relative">
              <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Ej: rollback, server.js, test, timeout..."
                className="w-full rounded-xl border border-zinc-800 bg-black/50 pl-9 pr-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
              />
            </div>

            {searchError ? <p className="text-xs text-red-300">{searchError}</p> : null}

            {searchQuery.trim().length < 2 ? (
              <p className="text-xs text-zinc-500">Escribe al menos 2 caracteres para buscar.</p>
            ) : null}

            {searchLoading ? <p className="text-sm text-zinc-500">Buscando...</p> : null}

            {searchData ? (
              <p className="text-xs text-zinc-500">
                chats {searchData.counts.chats} · comandos {searchData.counts.commands} · errores {searchData.counts.errors} ·
                archivos {searchData.counts.files}
              </p>
            ) : null}

            <div className="space-y-2">
              {!searchLoading && searchQuery.trim().length >= 2 && searchGroups.length === 0 ? (
                <p className="text-sm text-zinc-500">No hay resultados para esta busqueda.</p>
              ) : null}

              {searchGroups.map((group) => {
                const isOpen = Boolean(expandedSearchGroups[group.key]);
                const total =
                  group.chats.length + group.commands.length + group.errors.length + group.files.length;
                return (
                  <article key={group.key} className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedSearchGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }));
                      }}
                      onMouseEnter={() => openSearchGroup(group.key)}
                      onFocus={() => openSearchGroup(group.key)}
                      className="w-full text-left flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-100 truncate" title={group.title}>{group.title}</p>
                        <p className="text-xs text-zinc-500 mt-1 truncate">
                          {group.conversationId === null ? 'sin chat' : `chat #${group.conversationId}`} · {total} resultado
                          {total === 1 ? '' : 's'}
                        </p>
                      </div>
                      {isOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                    </button>

                    {isOpen ? (
                      <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
                        {group.conversationId ? (
                          <button
                            type="button"
                            onClick={() => onNavigate('chat', { chatId: group.conversationId as number })}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
                          >
                            Abrir chat
                          </button>
                        ) : null}

                        {group.chats.map((hit) => (
                          <article key={`chat_hit_${hit.conversationId}`} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                            <p className="text-[11px] uppercase text-cyan-300">
                              chat · {hit.matchField === 'title' ? 'titulo' : 'mensajes'}
                            </p>
                            <p className="text-xs text-zinc-300 mt-1 whitespace-pre-wrap break-words">{hit.snippet}</p>
                            <p className="text-[10px] text-zinc-600 mt-2">{formatTime(hit.lastMessageAt)}</p>
                          </article>
                        ))}

                        {group.commands.map((hit) => (
                          <article key={`cmd_hit_${hit.id}`} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                            <p className="text-[11px] uppercase text-amber-300">
                              comando · {hit.status}
                              {hit.exitCode !== null ? ` · exit ${hit.exitCode}` : ''}
                            </p>
                            <p className="text-xs text-zinc-200 mt-1 whitespace-pre-wrap break-words">{hit.command}</p>
                            {hit.outputSnippet ? (
                              <p className="text-xs text-zinc-400 mt-2 whitespace-pre-wrap break-words">{hit.outputSnippet}</p>
                            ) : null}
                            <p className="text-[10px] text-zinc-600 mt-2">
                              tarea #{hit.taskId} · {formatTime(hit.at)}
                            </p>
                          </article>
                        ))}

                        {group.errors.map((hit) => (
                          <article key={`error_hit_${hit.taskId}_${hit.at}`} className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                            <p className="text-[11px] uppercase text-red-300">
                              error · {hit.status} · fallos de comandos {hit.commandFailed}
                            </p>
                            <p className="text-xs text-zinc-300 mt-1 whitespace-pre-wrap break-words">{hit.summary}</p>
                            <p className="text-[10px] text-zinc-600 mt-2">tarea #{hit.taskId} · {formatTime(hit.at)}</p>
                          </article>
                        ))}

                        {group.files.map((hit) => (
                          <article key={`file_hit_${hit.taskId}_${hit.at}`} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                            <p className="text-[11px] uppercase text-emerald-300">
                              archivos · {hit.filesCount} coincidencia{hit.filesCount === 1 ? '' : 's'}
                            </p>
                            <div className="mt-2 space-y-1">
                              {hit.files.map((filePath) => (
                                <p key={`${hit.taskId}_${filePath}`} className="text-xs text-zinc-300 font-mono break-all">
                                  {filePath}
                                </p>
                              ))}
                            </div>
                            <p className="text-[10px] text-zinc-600 mt-2">tarea #{hit.taskId} · {formatTime(hit.at)}</p>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeView === 'git' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Repositorios Git</h2>
              <p className="text-xs text-zinc-500">Detecta cambios, sube commits y abre chat para resolver conflictos.</p>
            </div>

            {gitNotice ? <p className="text-xs text-emerald-300">{gitNotice}</p> : null}
            {gitReposError ? <p className="text-xs text-red-300">{gitReposError}</p> : null}
            {gitReposScannedAt ? (
              <p className="text-[10px] text-zinc-600">ultimo escaneo {formatTime(gitReposScannedAt)}</p>
            ) : null}

            {gitReposLoading && gitRepos.length === 0 ? (
              <p className="text-sm text-zinc-500">Buscando repositorios Git...</p>
            ) : null}

            {!gitReposLoading && gitRepos.length === 0 ? (
              <p className="text-sm text-zinc-500">No se detectaron repositorios Git en este entorno.</p>
            ) : null}

            <div className="space-y-2">
              {gitRepos.map((repo) => {
                const isOpen = Boolean(expandedGitRepos[repo.id]);
                const canPush = !repo.hasConflicts && (repo.status.total > 0 || repo.ahead > 0);
                const pushBusy = pushingGitRepoId === repo.id;
                const resolveBusy = resolvingGitRepoId === repo.id;
                return (
                  <article key={repo.id} className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedGitRepos((prev) => ({ ...prev, [repo.id]: !prev[repo.id] }));
                      }}
                      onMouseEnter={() => openGitRepo(repo.id)}
                      onFocus={() => openGitRepo(repo.id)}
                      className="w-full text-left flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-100 truncate" title={repo.absolutePath}>{repo.name}</p>
                        <p className="text-xs text-zinc-500 mt-1 truncate">
                          {repo.relativePath} · rama {repo.branch}
                          {repo.ahead > 0 ? ` · ahead ${repo.ahead}` : ''}
                          {repo.behind > 0 ? ` · behind ${repo.behind}` : ''} · cambios {repo.status.total}
                          {repo.hasConflicts ? ` · conflictos ${repo.status.conflicted}` : ''}
                        </p>
                      </div>
                      {isOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                    </button>

                    {isOpen ? (
                      <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                            <p className="text-[10px] uppercase text-zinc-500">staged / mod</p>
                            <p className="text-xs text-zinc-200 mt-1">{repo.status.staged} / {repo.status.modified}</p>
                          </article>
                          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                            <p className="text-[10px] uppercase text-zinc-500">untracked / conflicts</p>
                            <p className="text-xs text-zinc-200 mt-1">{repo.status.untracked} / {repo.status.conflicted}</p>
                          </article>
                        </div>

                        {repo.conflictFiles.length > 0 ? (
                          <article className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5">
                            <p className="text-[11px] uppercase text-red-300">archivos en conflicto</p>
                            <div className="mt-1.5 space-y-1">
                              {repo.conflictFiles.slice(0, 10).map((filePath) => (
                                <p key={`${repo.id}:conflict:${filePath}`} className="text-xs text-zinc-300 font-mono break-all">
                                  {filePath}
                                </p>
                              ))}
                            </div>
                          </article>
                        ) : null}

                        {repo.changedFiles.length > 0 ? (
                          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                            <p className="text-[11px] uppercase text-zinc-500">cambios detectados</p>
                            <div className="mt-1.5 space-y-1">
                              {repo.changedFiles.slice(0, 10).map((filePath) => (
                                <p key={`${repo.id}:changed:${filePath}`} className="text-xs text-zinc-300 font-mono break-all">
                                  {filePath}
                                </p>
                              ))}
                            </div>
                          </article>
                        ) : null}

                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              void pushGitRepo(repo.id);
                            }}
                            disabled={!canPush || pushBusy || resolveBusy}
                            className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                              canPush ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 text-zinc-500'
                            } disabled:opacity-50`}
                          >
                            {pushBusy ? 'Subiendo...' : canPush ? 'Subir cambios' : 'Sin cambios para push'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              void resolveGitConflicts(repo.id);
                            }}
                            disabled={!repo.hasConflicts || resolveBusy || pushBusy}
                            className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                              repo.hasConflicts ? 'border-amber-500/50 bg-amber-500/10 text-amber-200' : 'border-zinc-700 text-zinc-500'
                            } disabled:opacity-50`}
                          >
                            {resolveBusy ? 'Abriendo chat...' : repo.hasConflicts ? 'Resolver conflictos' : 'Sin conflictos'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeView === 'observability' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Observabilidad tecnica</h2>
              <p className="text-xs text-zinc-500">Latencia API, errores por endpoint, CPU/RAM y uptime.</p>
            </div>

            {observabilityError ? <p className="text-xs text-red-300">{observabilityError}</p> : null}
            {observabilityLoading && !observability ? <p className="text-sm text-zinc-500">Cargando metricas...</p> : null}

            {observability ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <article className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                    <p className="text-[11px] uppercase text-zinc-500">uptime</p>
                    <p className="text-sm text-zinc-100 mt-1">{formatUptime(observability.uptimeSeconds)}</p>
                    <p className="text-[10px] text-zinc-600 mt-1">pid {observability.process.pid}</p>
                  </article>
                  <article className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                    <p className="text-[11px] uppercase text-zinc-500">cpu proceso</p>
                    <p className="text-sm text-zinc-100 mt-1">{formatPercent(observability.process.cpuPercent)}</p>
                    <p className="text-[10px] text-zinc-600 mt-1">por nucleo {formatPercent(observability.process.cpuPerCorePercent)}</p>
                  </article>
                  <article className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                    <p className="text-[11px] uppercase text-zinc-500">ram proceso</p>
                    <p className="text-sm text-zinc-100 mt-1">{formatBytes(observability.process.memory.rssBytes)}</p>
                    <p className="text-[10px] text-zinc-600 mt-1">heap {formatBytes(observability.process.memory.heapUsedBytes)}</p>
                  </article>
                  <article className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                    <p className="text-[11px] uppercase text-zinc-500">ram sistema</p>
                    <p className="text-sm text-zinc-100 mt-1">{formatPercent(observability.system.usedMemPercent)}</p>
                    <p className="text-[10px] text-zinc-600 mt-1">
                      {formatBytes(observability.system.usedMemBytes)} / {formatBytes(observability.system.totalMemBytes)}
                    </p>
                  </article>
                </div>

                <article className="rounded-xl border border-zinc-800 bg-black/40 p-3">
                  <p className="text-[11px] uppercase text-zinc-500">latencia api</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    avg {formatDurationMs(observability.api.latency.avgMs)} · p50 {formatDurationMs(observability.api.latency.p50Ms)} ·
                    p95 {formatDurationMs(observability.api.latency.p95Ms)} · p99 {formatDurationMs(observability.api.latency.p99Ms)}
                  </p>
                  <p className="text-[10px] text-zinc-600 mt-2">
                    req {observability.api.totalRequests} · errores {observability.api.totalErrors} · tasa {formatPercent(observability.api.errorRate)}
                  </p>
                </article>

                <article className="rounded-xl border border-zinc-800 bg-black/40 p-3 space-y-2">
                  <p className="text-[11px] uppercase text-zinc-500">errores por endpoint</p>
                  {observability.api.endpoints.length === 0 ? (
                    <p className="text-xs text-zinc-500">Aun no hay trafico API suficiente para mostrar endpoints.</p>
                  ) : (
                    <div className="space-y-2">
                      {observability.api.endpoints.slice(0, 14).map((endpoint) => (
                        <div key={`${endpoint.method}:${endpoint.path}`} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                          <p className="text-xs text-zinc-300 break-all">
                            <span className="text-zinc-500">{endpoint.method}</span> {endpoint.path}
                          </p>
                          <p className="text-[10px] text-zinc-600 mt-1">
                            req {endpoint.requests} · err {endpoint.errors} ({formatPercent(endpoint.errorRate)}) · avg {formatDurationMs(endpoint.avgMs)}
                            {' '}· p95 {formatDurationMs(endpoint.p95Ms)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </article>

                <article className="rounded-xl border border-zinc-800 bg-black/40 p-3 space-y-2">
                  <p className="text-[11px] uppercase text-zinc-500">errores recientes api</p>
                  {observability.api.recentErrors.length === 0 ? (
                    <p className="text-xs text-zinc-500">Sin errores recientes.</p>
                  ) : (
                    <div className="space-y-2">
                      {observability.api.recentErrors.slice(0, 12).map((item, idx) => (
                        <div key={`${item.at}:${item.path}:${idx}`} className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5">
                          <p className="text-xs text-zinc-300 break-all">
                            {item.method} {item.path}
                          </p>
                          <p className="text-[10px] text-zinc-600 mt-1">
                            status {item.status} · {formatDurationMs(item.durationMs)} · {formatTime(item.at)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      <BottomNav active="tools" onNavigate={onNavigate} />
    </div>
  );
}
