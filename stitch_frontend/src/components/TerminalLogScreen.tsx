import {
  Activity,
  BarChart3,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  FolderOpen,
  GitBranch,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  Search as SearchIcon,
  Server,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Upload
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  actionToolsDeployedApp,
  completeToolsDriveOauth,
  createToolsDeployedAppBackup,
  createToolsDriveAccount,
  deleteToolsDriveFile,
  describeToolsDeployedApps,
  getCodexRuns,
  getToolsStorageHeavy,
  getToolsStorageJob,
  getToolsStorageLocalList,
  getToolsDeployedAppDescribeJob,
  getToolsDeployedAppLogs,
  getToolsDeployedApps,
  listToolsDeployedAppBackups,
  listToolsDriveAccounts,
  listToolsDriveFiles,
  getTaskDashboard,
  getToolsGitRepos,
  getToolsObservability,
  getUnifiedToolsSearch,
  killAllCodexRuns,
  killConversationSession,
  restoreToolsDeployedAppBackup,
  checkoutToolsGitBranch,
  mergeToolsGitBranches,
  pushToolsGitRepo,
  resolveToolsGitConflicts,
  rollbackTaskRun,
  startToolsDriveOauth,
  uploadToolsDriveFiles,
  validateToolsDriveAccount,
  deleteToolsDriveAccount
} from '../lib/api';
import BottomNav from './BottomNav';
import type {
  CodexBackgroundRun,
  Conversation,
  ObservabilitySnapshot,
  Screen,
  ToolsDeployedAppBackupItem,
  ToolsDeployedApp,
  ToolsDriveAccount,
  ToolsDriveFileItem,
  TaskRunDashboardItem,
  TerminalEntry,
  ToolsGitRepoSummary,
  ToolsStorageHeavyPayload,
  ToolsStorageJob,
  ToolsStorageLocalListPayload,
  UnifiedSearchPayload
} from '../lib/types';

type ToolsView =
  | 'menu'
  | 'processes'
  | 'dashboard'
  | 'terminal'
  | 'search'
  | 'observability'
  | 'git'
  | 'storage'
  | 'deployments';

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

function formatDateTime(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
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

interface DeployLogsState {
  visible: boolean;
  loading: boolean;
  error: string;
  logs: string;
  fetchedAt: string;
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
  const [checkingOutGitRepoId, setCheckingOutGitRepoId] = useState<string | null>(null);
  const [mergingGitRepoId, setMergingGitRepoId] = useState<string | null>(null);
  const [resolvingGitRepoId, setResolvingGitRepoId] = useState<string | null>(null);
  const [gitNotice, setGitNotice] = useState('');
  const [gitBranchTargetByRepo, setGitBranchTargetByRepo] = useState<Record<string, string>>({});
  const [gitCreateBranchByRepo, setGitCreateBranchByRepo] = useState<Record<string, boolean>>({});
  const [gitMergeSourceByRepo, setGitMergeSourceByRepo] = useState<Record<string, string>>({});
  const [gitMergeTargetByRepo, setGitMergeTargetByRepo] = useState<Record<string, string>>({});
  const [deployedApps, setDeployedApps] = useState<ToolsDeployedApp[]>([]);
  const [deployedAppsScannedAt, setDeployedAppsScannedAt] = useState('');
  const [deployedAppsLoading, setDeployedAppsLoading] = useState(true);
  const [deployedAppsError, setDeployedAppsError] = useState('');
  const [expandedDeployedApps, setExpandedDeployedApps] = useState<Record<string, boolean>>({});
  const [deployNotice, setDeployNotice] = useState('');
  const [deployActionBusy, setDeployActionBusy] = useState<{ appId: string; action: 'start' | 'stop' | 'restart' } | null>(
    null
  );
  const [deployLogsByApp, setDeployLogsByApp] = useState<Record<string, DeployLogsState>>({});
  const [selectingDeployedApps, setSelectingDeployedApps] = useState(false);
  const [selectedDeployedApps, setSelectedDeployedApps] = useState<Record<string, true>>({});
  const [deployedSearchQuery, setDeployedSearchQuery] = useState('');
  const [deployedStatusFilter, setDeployedStatusFilter] = useState<'all' | 'running' | 'stopped' | 'failing'>('all');
  const [deployedTypeFilter, setDeployedTypeFilter] = useState<'all' | 'system' | 'non-system'>('all');
  const [generatedDeployedDescriptions, setGeneratedDeployedDescriptions] = useState<
    Record<string, { description: string; generatedAt: string }>
  >({});
  const [describingDeployedAppId, setDescribingDeployedAppId] = useState<string | null>(null);
  const [describingSelectedApps, setDescribingSelectedApps] = useState(false);
  const [storageLocalPath, setStorageLocalPath] = useState('/root');
  const [storageSortBy, setStorageSortBy] = useState<'name' | 'size' | 'mtime'>('size');
  const [storageSortOrder, setStorageSortOrder] = useState<'asc' | 'desc'>('desc');
  const [storageLocalData, setStorageLocalData] = useState<ToolsStorageLocalListPayload | null>(null);
  const [storageLocalLoading, setStorageLocalLoading] = useState(false);
  const [storageLocalError, setStorageLocalError] = useState('');
  const [storageHeavyData, setStorageHeavyData] = useState<ToolsStorageHeavyPayload | null>(null);
  const [storageHeavyLoading, setStorageHeavyLoading] = useState(false);
  const [storageHeavyError, setStorageHeavyError] = useState('');
  const [storageSelectedLocalPaths, setStorageSelectedLocalPaths] = useState<Record<string, true>>({});
  const [driveAccounts, setDriveAccounts] = useState<ToolsDriveAccount[]>([]);
  const [driveAccountsLoading, setDriveAccountsLoading] = useState(false);
  const [driveAccountsError, setDriveAccountsError] = useState('');
  const [driveNotice, setDriveNotice] = useState('');
  const [activeDriveAccountId, setActiveDriveAccountId] = useState('');
  const [driveFiles, setDriveFiles] = useState<ToolsDriveFileItem[]>([]);
  const [driveFilesLoading, setDriveFilesLoading] = useState(false);
  const [driveFilesError, setDriveFilesError] = useState('');
  const [driveUploadJob, setDriveUploadJob] = useState<ToolsStorageJob | null>(null);
  const [driveCredentialAlias, setDriveCredentialAlias] = useState('');
  const [driveCredentialText, setDriveCredentialText] = useState('');
  const [driveOauthCode, setDriveOauthCode] = useState('');
  const [driveOauthUrl, setDriveOauthUrl] = useState('');
  const [creatingDriveAccount, setCreatingDriveAccount] = useState(false);
  const [validatingDriveAccountId, setValidatingDriveAccountId] = useState<string | null>(null);
  const [startingOauthAccountId, setStartingOauthAccountId] = useState<string | null>(null);
  const [completingOauthAccountId, setCompletingOauthAccountId] = useState<string | null>(null);
  const [deletingDriveAccountId, setDeletingDriveAccountId] = useState<string | null>(null);
  const [backupsByAppId, setBackupsByAppId] = useState<Record<string, ToolsDeployedAppBackupItem[]>>({});
  const [loadingBackupsAppId, setLoadingBackupsAppId] = useState<string | null>(null);
  const [selectedBackupFileIdByAppId, setSelectedBackupFileIdByAppId] = useState<Record<string, string>>({});
  const [backupAccountByAppId, setBackupAccountByAppId] = useState<Record<string, string>>({});
  const [creatingBackupAppId, setCreatingBackupAppId] = useState<string | null>(null);
  const [restoringBackupAppId, setRestoringBackupAppId] = useState<string | null>(null);
  const [restoreJobByAppId, setRestoreJobByAppId] = useState<Record<string, ToolsStorageJob>>({});

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
      const repos = Array.isArray(payload.repos) ? payload.repos : [];
      setGitRepos(repos);
      setGitReposScannedAt(String(payload.scannedAt || ''));
      setGitBranchTargetByRepo((prev) => {
        const next: Record<string, string> = { ...prev };
        repos.forEach((repo) => {
          const current = String(next[repo.id] || '').trim();
          if (!current) {
            next[repo.id] = repo.branch || '';
          }
        });
        return next;
      });
      setGitMergeSourceByRepo((prev) => {
        const next: Record<string, string> = { ...prev };
        repos.forEach((repo) => {
          const current = String(next[repo.id] || '').trim();
          if (!current) {
            const candidate = Array.isArray(repo.branches)
              ? repo.branches.find((entry) => entry && entry !== repo.branch) || ''
              : '';
            next[repo.id] = candidate || '';
          }
        });
        return next;
      });
      setGitMergeTargetByRepo((prev) => {
        const next: Record<string, string> = { ...prev };
        repos.forEach((repo) => {
          const current = String(next[repo.id] || '').trim();
          if (!current) {
            next[repo.id] = repo.branch || '';
          }
        });
        return next;
      });
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

  const loadDeployedAppsView = useCallback(async (silent = false, forceRefresh = false) => {
    if (!silent) {
      setDeployedAppsLoading(true);
    }
    setDeployedAppsError('');
    try {
      const payload = await getToolsDeployedApps(forceRefresh);
      setDeployedApps(Array.isArray(payload.apps) ? payload.apps : []);
      setDeployedAppsScannedAt(String(payload.scannedAt || ''));
    } catch (error) {
      setDeployedAppsError(error instanceof Error ? error.message : 'No se pudo cargar apps desplegadas');
    } finally {
      if (!silent) {
        setDeployedAppsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadDeployedAppsView(true, false);
  }, [loadDeployedAppsView]);

  useEffect(() => {
    if (activeView !== 'deployments') return;
    void loadDeployedAppsView(false, true);
    const pollId = window.setInterval(() => {
      void loadDeployedAppsView(true, false);
    }, 7000);
    return () => {
      window.clearInterval(pollId);
    };
  }, [activeView, loadDeployedAppsView]);

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

  const filteredDeployedApps = useMemo(() => {
    const query = deployedSearchQuery.trim().toLowerCase();
    return deployedApps.filter((app) => {
      const detail = String(app.detailStatus || '').toLowerCase();
      const sourceStatus = String(app.status || '').toLowerCase();
      const normalizedStatus = String(app.normalizedStatus || sourceStatus || '').toLowerCase();
      const isFailing =
        app.status === 'error' ||
        app.normalizedStatus === 'error' ||
        /(error|failed|inactive|exited|dead|unhealthy)/.test(detail);

      if (deployedStatusFilter === 'running' && !app.isRunning && normalizedStatus !== 'running') {
        return false;
      }
      if (deployedStatusFilter === 'stopped' && !(app.isStopped || normalizedStatus === 'stopped')) {
        return false;
      }
      if (deployedStatusFilter === 'failing' && !isFailing) {
        return false;
      }

      if (deployedTypeFilter === 'system' && !app.isSystem) {
        return false;
      }
      if (deployedTypeFilter === 'non-system' && app.isSystem) {
        return false;
      }

      if (!query) return true;
      const searchable = String(app.searchableText || '').toLowerCase();
      if (searchable.includes(query)) return true;
      return (
        String(app.name || '').toLowerCase().includes(query) ||
        String(app.source || '').toLowerCase().includes(query) ||
        detail.includes(query) ||
        sourceStatus.includes(query)
      );
    });
  }, [deployedApps, deployedSearchQuery, deployedStatusFilter, deployedTypeFilter]);

  const deployedAppIds = useMemo(() => filteredDeployedApps.map((app) => app.id), [filteredDeployedApps]);
  const selectedDeployedAppIds = useMemo(
    () => deployedAppIds.filter((appId) => Boolean(selectedDeployedApps[appId])),
    [deployedAppIds, selectedDeployedApps]
  );
  const selectedDeployedCount = selectedDeployedAppIds.length;
  const allDeployedAppsSelected = deployedAppIds.length > 0 && selectedDeployedCount === deployedAppIds.length;
  const selectedLocalPaths = useMemo(
    () => Object.keys(storageSelectedLocalPaths).filter(Boolean),
    [storageSelectedLocalPaths]
  );
  const selectedLocalTotalBytes = useMemo(() => {
    const byPath = new Map(
      (storageLocalData?.entries || []).map((entry) => [entry.path, Number.isFinite(Number(entry.sizeBytes)) ? Number(entry.sizeBytes) : 0])
    );
    return selectedLocalPaths.reduce((sum, entryPath) => sum + Number(byPath.get(entryPath) || 0), 0);
  }, [selectedLocalPaths, storageLocalData]);

  useEffect(() => {
    const validIds = new Set(deployedApps.map((app) => app.id));
    setSelectedDeployedApps((prev) => {
      const nextEntries = Object.entries(prev).filter(([appId]) => validIds.has(appId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries) as Record<string, true>;
    });
    setGeneratedDeployedDescriptions((prev) => {
      const nextEntries = Object.entries(prev).filter(([appId]) => validIds.has(appId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries) as Record<string, { description: string; generatedAt: string }>;
    });
    setBackupsByAppId((prev) => {
      const nextEntries = Object.entries(prev).filter(([appId]) => validIds.has(appId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries) as Record<string, ToolsDeployedAppBackupItem[]>;
    });
    setSelectedBackupFileIdByAppId((prev) => {
      const nextEntries = Object.entries(prev).filter(([appId]) => validIds.has(appId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries) as Record<string, string>;
    });
    setBackupAccountByAppId((prev) => {
      const nextEntries = Object.entries(prev).filter(([appId]) => validIds.has(appId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries) as Record<string, string>;
    });
    setRestoreJobByAppId((prev) => {
      const nextEntries = Object.entries(prev).filter(([appId]) => validIds.has(appId));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries) as Record<string, ToolsStorageJob>;
    });
  }, [deployedApps]);

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

  const formatDeployedStatus = (status: string) => {
    const normalized = String(status || '')
      .trim()
      .toLowerCase();
    if (normalized === 'running') return 'ejecutando';
    if (normalized === 'stopped') return 'detenida';
    if (normalized === 'error') return 'error';
    return 'desconocido';
  };

  const formatDeployedSource = (source: string) => {
    const normalized = String(source || '')
      .trim()
      .toLowerCase();
    if (normalized === 'systemd') return 'systemd';
    if (normalized === 'docker') return 'docker';
    if (normalized === 'pm2') return 'pm2';
    return normalized || 'source';
  };

  const formatDeployedCategory = (category: string) => {
    const normalized = String(category || '')
      .trim()
      .toLowerCase();
    if (normalized === 'system') return 'system';
    if (normalized === 'user') return 'user';
    if (normalized === 'docker') return 'docker';
    return 'custom';
  };

  const formatDescriptionJobStatus = (status: string) => {
    const normalized = String(status || '')
      .trim()
      .toLowerCase();
    if (normalized === 'pending') return 'pendiente';
    if (normalized === 'running') return 'en progreso';
    if (normalized === 'completed') return 'completado';
    if (normalized === 'error') return 'error';
    return 'sin job';
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

  const openDeployedApp = (appId: string) => {
    setExpandedDeployedApps((prev) => (prev[appId] ? prev : { ...prev, [appId]: true }));
  };

  const loadDeployedLogs = async (appId: string, forceReload = false) => {
    setDeployedAppsError('');
    setDeployLogsByApp((prev) => {
      const current = prev[appId] || {
        visible: true,
        loading: false,
        error: '',
        logs: '',
        fetchedAt: ''
      };
      return {
        ...prev,
        [appId]: {
          ...current,
          visible: true,
          loading: true,
          error: '',
          logs: forceReload ? '' : current.logs
        }
      };
    });
    try {
      const payload = await getToolsDeployedAppLogs(appId, 220);
      setDeployLogsByApp((prev) => {
        const current = prev[appId] || {
          visible: true,
          loading: false,
          error: '',
          logs: '',
          fetchedAt: ''
        };
        return {
          ...prev,
          [appId]: {
            ...current,
            visible: true,
            loading: false,
            error: '',
            logs: String(payload.logs || ''),
            fetchedAt: String(payload.fetchedAt || '')
          }
        };
      });
    } catch (error) {
      setDeployLogsByApp((prev) => {
        const current = prev[appId] || {
          visible: true,
          loading: false,
          error: '',
          logs: '',
          fetchedAt: ''
        };
        return {
          ...prev,
          [appId]: {
            ...current,
            visible: true,
            loading: false,
            error: error instanceof Error ? error.message : 'No se pudieron cargar logs',
            logs: '',
            fetchedAt: ''
          }
        };
      });
    }
  };

  const toggleDeployedLogs = (appId: string) => {
    const current = deployLogsByApp[appId];
    const nextVisible = !current?.visible;
    setDeployLogsByApp((prev) => {
      const base = prev[appId] || {
        visible: false,
        loading: false,
        error: '',
        logs: '',
        fetchedAt: ''
      };
      return {
        ...prev,
        [appId]: {
          ...base,
          visible: nextVisible
        }
      };
    });
    if (nextVisible && (!current || !current.logs)) {
      void loadDeployedLogs(appId, false);
    }
  };

  const actionDeployedApp = async (appId: string, action: 'start' | 'stop' | 'restart') => {
    setDeployedAppsError('');
    setDeployNotice('');
    setDeployActionBusy({ appId, action });
    try {
      const payload = await actionToolsDeployedApp(appId, action);
      const output = String(payload.output || '').trim();
      const suffix = output ? ` · ${output.slice(0, 120)}` : '';
      setDeployNotice(`Accion ${action} aplicada sobre ${payload.app.name}.${suffix}`);
      await loadDeployedAppsView(true, true);
      if (deployLogsByApp[appId]?.visible) {
        await loadDeployedLogs(appId, true);
      }
      onRunsChanged?.();
    } catch (error) {
      setDeployedAppsError(error instanceof Error ? error.message : 'No se pudo ejecutar accion de app');
    } finally {
      setDeployActionBusy(null);
    }
  };

  const toggleSelectDeployedApp = (appId: string) => {
    setSelectedDeployedApps((prev) => {
      if (prev[appId]) {
        const next = { ...prev };
        delete next[appId];
        return next;
      }
      return { ...prev, [appId]: true };
    });
  };

  const waitForDeployedDescribeJob = async (jobId: string) => {
    const safeJobId = String(jobId || '').trim();
    if (!safeJobId) {
      throw new Error('No se recibió jobId para la generación de descripción.');
    }
    let latest = await getToolsDeployedAppDescribeJob(safeJobId);
    if (latest.status === 'completed' || latest.status === 'error') {
      return latest;
    }
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 1300);
      });
      latest = await getToolsDeployedAppDescribeJob(safeJobId);
      if (latest.status === 'completed' || latest.status === 'error') {
        return latest;
      }
    }
    return latest;
  };

  const runDescribeDeployedApps = async (appIds: string[], mode: 'single' | 'bulk') => {
    const normalizedIds = Array.isArray(appIds)
      ? appIds
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
      : [];
    if (normalizedIds.length === 0) return;
    setDeployNotice('');
    setDeployedAppsError('');
    if (mode === 'single') {
      setDescribingDeployedAppId(normalizedIds[0] || null);
    } else {
      setDescribingSelectedApps(true);
    }
    try {
      const payload = await describeToolsDeployedApps(normalizedIds);
      const jobId = String(payload?.job?.id || '').trim();
      if (!jobId) {
        throw new Error('No se pudo crear el job de descripción.');
      }
      setDeployNotice(`Job de descripción ${jobId} creado. Procesando en segundo plano...`);
      await loadDeployedAppsView(true, true);

      const job = await waitForDeployedDescribeJob(jobId);
      if (job.status === 'error') {
        throw new Error(job.error || 'El job de descripción terminó con error.');
      }
      const items = Array.isArray(job.result?.descriptions) ? job.result.descriptions : [];
      if (items.length === 0) {
        throw new Error('El job terminó sin descripciones para las apps seleccionadas.');
      }
      setGeneratedDeployedDescriptions((prev) => {
        const next = { ...prev };
        items.forEach((item) => {
          const appId = String(item.appId || '').trim();
          const description = String(item.description || '').trim();
          if (!appId || !description) return;
          next[appId] = {
            description,
            generatedAt: String(item.generatedAt || '') || new Date().toISOString()
          };
        });
        return next;
      });
      setDeployNotice(
        `Descripción completada para ${items.length} app(s) con ${String(job.provider || 'IA configurada')}.`
      );
      await loadDeployedAppsView(true, true);
    } catch (error) {
      setDeployedAppsError(error instanceof Error ? error.message : 'No se pudieron generar descripciones');
    } finally {
      if (mode === 'single') {
        setDescribingDeployedAppId(null);
      } else {
        setDescribingSelectedApps(false);
      }
    }
  };

  const loadStorageLocal = useCallback(async () => {
    setStorageLocalLoading(true);
    setStorageLocalError('');
    try {
      const payload = await getToolsStorageLocalList({
        path: storageLocalPath,
        sortBy: storageSortBy,
        sortOrder: storageSortOrder,
        limit: 260
      });
      setStorageLocalData(payload);
      setStorageSelectedLocalPaths((prev) => {
        const valid = new Set(payload.entries.map((entry) => entry.path));
        const nextEntries = Object.keys(prev).filter((entry) => valid.has(entry));
        if (nextEntries.length === Object.keys(prev).length) return prev;
        const next: Record<string, true> = {};
        nextEntries.forEach((entry) => {
          next[entry] = true;
        });
        return next;
      });
      if (payload.path && payload.path !== storageLocalPath) {
        setStorageLocalPath(payload.path);
      }
    } catch (error) {
      setStorageLocalError(error instanceof Error ? error.message : 'No se pudo listar almacenamiento local');
    } finally {
      setStorageLocalLoading(false);
    }
  }, [storageLocalPath, storageSortBy, storageSortOrder]);

  const loadStorageHeavy = useCallback(async () => {
    setStorageHeavyLoading(true);
    setStorageHeavyError('');
    try {
      const payload = await getToolsStorageHeavy({
        path: storageLocalPath,
        limit: 30,
        maxDepth: 3
      });
      setStorageHeavyData(payload);
    } catch (error) {
      setStorageHeavyError(error instanceof Error ? error.message : 'No se pudo analizar uso de disco');
    } finally {
      setStorageHeavyLoading(false);
    }
  }, [storageLocalPath]);

  const loadDriveAccounts = useCallback(async (silent = false) => {
    if (!silent) {
      setDriveAccountsLoading(true);
    }
    setDriveAccountsError('');
    try {
      const accounts = await listToolsDriveAccounts();
      setDriveAccounts(accounts);
      setActiveDriveAccountId((prev) => {
        const safePrev = String(prev || '').trim();
        if (safePrev && accounts.some((entry) => entry.id === safePrev)) return safePrev;
        return accounts[0]?.id || '';
      });
    } catch (error) {
      setDriveAccountsError(error instanceof Error ? error.message : 'No se pudieron cargar cuentas de Drive');
    } finally {
      if (!silent) {
        setDriveAccountsLoading(false);
      }
    }
  }, []);

  const loadDriveFiles = useCallback(async () => {
    const accountId = String(activeDriveAccountId || '').trim();
    if (!accountId) {
      setDriveFiles([]);
      return;
    }
    setDriveFilesLoading(true);
    setDriveFilesError('');
    try {
      const payload = await listToolsDriveFiles({
        accountId
      });
      setDriveFiles(payload.files);
    } catch (error) {
      setDriveFilesError(error instanceof Error ? error.message : 'No se pudieron listar archivos de Drive');
    } finally {
      setDriveFilesLoading(false);
    }
  }, [activeDriveAccountId]);

  const waitForStorageJob = async (
    jobId: string,
    onUpdate?: (job: ToolsStorageJob) => void
  ): Promise<ToolsStorageJob> => {
    const safeJobId = String(jobId || '').trim();
    if (!safeJobId) {
      throw new Error('jobId inválido');
    }
    let latest = await getToolsStorageJob(safeJobId);
    onUpdate?.(latest);
    if (latest.status === 'completed' || latest.status === 'error') {
      return latest;
    }
    for (let index = 0; index < 120; index += 1) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 1500);
      });
      latest = await getToolsStorageJob(safeJobId);
      onUpdate?.(latest);
      if (latest.status === 'completed' || latest.status === 'error') {
        return latest;
      }
    }
    return latest;
  };

  const toggleStorageLocalSelection = (absolutePath: string) => {
    const safePath = String(absolutePath || '').trim();
    if (!safePath) return;
    setStorageSelectedLocalPaths((prev) => {
      if (prev[safePath]) {
        const next = { ...prev };
        delete next[safePath];
        return next;
      }
      return {
        ...prev,
        [safePath]: true
      };
    });
  };

  const handleDriveCredentialsFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setDriveCredentialText(text);
    if (!driveCredentialAlias.trim()) {
      const rawName = String(file.name || '').replace(/\.[^.]+$/, '');
      setDriveCredentialAlias(rawName.slice(0, 60));
    }
  };

  const createDriveAccountFromCredentialText = async () => {
    const alias = driveCredentialAlias.trim();
    const rawText = driveCredentialText.trim();
    if (!rawText) {
      setDriveAccountsError('Pega o sube el JSON de credenciales antes de guardar la cuenta.');
      return;
    }
    setCreatingDriveAccount(true);
    setDriveNotice('');
    setDriveAccountsError('');
    try {
      const credentialsJson = JSON.parse(rawText);
      const account = await createToolsDriveAccount({
        alias: alias || `Drive ${Date.now().toString().slice(-5)}`,
        credentialsJson
      });
      setDriveNotice(`Cuenta ${account.alias} guardada.`);
      setDriveCredentialText('');
      setDriveOauthCode('');
      setDriveOauthUrl('');
      await loadDriveAccounts(true);
      if (account.id) {
        setActiveDriveAccountId(account.id);
      }
    } catch (error) {
      setDriveAccountsError(error instanceof Error ? error.message : 'No se pudo guardar cuenta de Drive');
    } finally {
      setCreatingDriveAccount(false);
    }
  };

  const validateDriveAccount = async (accountId: string) => {
    setValidatingDriveAccountId(accountId);
    setDriveNotice('');
    setDriveAccountsError('');
    try {
      const response = await validateToolsDriveAccount(accountId);
      const email = response.about?.email ? ` (${response.about.email})` : '';
      setDriveNotice(`Cuenta validada${email}`);
      await loadDriveAccounts(true);
      await loadDriveFiles();
    } catch (error) {
      setDriveAccountsError(error instanceof Error ? error.message : 'No se pudo validar cuenta de Drive');
    } finally {
      setValidatingDriveAccountId(null);
    }
  };

  const beginDriveOauth = async (accountId: string) => {
    setStartingOauthAccountId(accountId);
    setDriveNotice('');
    setDriveAccountsError('');
    try {
      const payload = await startToolsDriveOauth(accountId);
      setDriveOauthUrl(payload.oauth.authUrl);
      setDriveNotice('URL OAuth generada. Ábrela, autoriza y pega el code en la caja inferior.');
    } catch (error) {
      setDriveAccountsError(error instanceof Error ? error.message : 'No se pudo iniciar OAuth');
    } finally {
      setStartingOauthAccountId(null);
    }
  };

  const completeDriveOauth = async (accountId: string) => {
    const code = driveOauthCode.trim();
    if (!code) {
      setDriveAccountsError('Pega el code OAuth antes de completar.');
      return;
    }
    setCompletingOauthAccountId(accountId);
    setDriveNotice('');
    setDriveAccountsError('');
    try {
      await completeToolsDriveOauth({
        accountId,
        code
      });
      setDriveNotice('OAuth completado. Cuenta lista para operar.');
      setDriveOauthCode('');
      await loadDriveAccounts(true);
      await loadDriveFiles();
    } catch (error) {
      setDriveAccountsError(error instanceof Error ? error.message : 'No se pudo completar OAuth');
    } finally {
      setCompletingOauthAccountId(null);
    }
  };

  const removeDriveAccount = async (accountId: string) => {
    if (!window.confirm('Se eliminará la cuenta de Drive de CodexWeb. ¿Continuar?')) {
      return;
    }
    setDeletingDriveAccountId(accountId);
    setDriveNotice('');
    setDriveAccountsError('');
    try {
      await deleteToolsDriveAccount(accountId);
      setDriveNotice('Cuenta eliminada.');
      await loadDriveAccounts(true);
      await loadDriveFiles();
    } catch (error) {
      setDriveAccountsError(error instanceof Error ? error.message : 'No se pudo eliminar cuenta de Drive');
    } finally {
      setDeletingDriveAccountId(null);
    }
  };

  const uploadSelectedLocalPathsToDrive = async () => {
    const accountId = String(activeDriveAccountId || '').trim();
    const paths = Object.keys(storageSelectedLocalPaths);
    if (!accountId) {
      setDriveAccountsError('Selecciona una cuenta de Drive para subir archivos.');
      return;
    }
    if (paths.length === 0) {
      setDriveAccountsError('Selecciona al menos un archivo local para subir.');
      return;
    }
    setDriveNotice('');
    setDriveFilesError('');
    try {
      const payload = await uploadToolsDriveFiles({
        accountId,
        paths
      });
      setDriveUploadJob(payload.job);
      setDriveNotice(`Job de subida ${payload.job.id} iniciado.`);
      const job = await waitForStorageJob(payload.job.id, (jobUpdate) => {
        setDriveUploadJob(jobUpdate);
      });
      setDriveUploadJob(job);
      if (job.status === 'error') {
        throw new Error(job.error || 'La subida a Drive terminó con error.');
      }
      setStorageSelectedLocalPaths({});
      setDriveNotice('Subida completada.');
      await loadDriveFiles();
    } catch (error) {
      setDriveFilesError(error instanceof Error ? error.message : 'No se pudo completar la subida a Drive');
    }
  };

  const removeDriveFile = async (fileId: string) => {
    const accountId = String(activeDriveAccountId || '').trim();
    const safeFileId = String(fileId || '').trim();
    if (!accountId || !safeFileId) return;
    const confirmed = window.confirm('Se eliminará el archivo seleccionado de Google Drive. ¿Continuar?');
    if (!confirmed) return;
    setDriveFilesError('');
    setDriveNotice('');
    try {
      await deleteToolsDriveFile({
        accountId,
        fileId: safeFileId
      });
      setDriveNotice('Archivo borrado en Drive.');
      await loadDriveFiles();
    } catch (error) {
      setDriveFilesError(error instanceof Error ? error.message : 'No se pudo borrar archivo de Drive');
    }
  };

  const loadBackupsForApp = async (appId: string, accountId = '') => {
    const safeAppId = String(appId || '').trim();
    if (!safeAppId) return;
    setLoadingBackupsAppId(safeAppId);
    setDeployedAppsError('');
    try {
      const payload = await listToolsDeployedAppBackups(safeAppId, accountId);
      setBackupsByAppId((prev) => ({
        ...prev,
        [safeAppId]: payload.backups
      }));
      if (payload.backups.length > 0) {
        setSelectedBackupFileIdByAppId((prev) => ({
          ...prev,
          [safeAppId]: prev[safeAppId] || payload.backups[0].driveFileId
        }));
      }
      if (payload.warning) {
        setDeployNotice(payload.warning);
      }
    } catch (error) {
      setDeployedAppsError(error instanceof Error ? error.message : 'No se pudieron listar backups de la app');
    } finally {
      setLoadingBackupsAppId(null);
    }
  };

  const createBackupForApp = async (appId: string) => {
    const safeAppId = String(appId || '').trim();
    const accountId =
      String(backupAccountByAppId[safeAppId] || '').trim() ||
      String(activeDriveAccountId || '').trim();
    if (!safeAppId || !accountId) {
      setDeployedAppsError('Selecciona cuenta de Drive para crear backup.');
      return;
    }
    setCreatingBackupAppId(safeAppId);
    setDeployNotice('');
    setDeployedAppsError('');
    try {
      const payload = await createToolsDeployedAppBackup({
        appId: safeAppId,
        accountId
      });
      const job = await waitForStorageJob(payload.job.id, (jobUpdate) => {
        setRestoreJobByAppId((prev) => ({
          ...prev,
          [safeAppId]: jobUpdate
        }));
      });
      setRestoreJobByAppId((prev) => ({
        ...prev,
        [safeAppId]: job
      }));
      if (job.status === 'error') {
        throw new Error(job.error || 'Backup en nube fallido.');
      }
      setDeployNotice('Backup en nube completado. Retención de 4 días aplicada automáticamente.');
      await loadBackupsForApp(safeAppId, accountId);
    } catch (error) {
      setDeployedAppsError(error instanceof Error ? error.message : 'No se pudo crear backup de la app');
    } finally {
      setCreatingBackupAppId(null);
    }
  };

  const restoreBackupForApp = async (appId: string) => {
    const safeAppId = String(appId || '').trim();
    const accountId =
      String(backupAccountByAppId[safeAppId] || '').trim() ||
      String(activeDriveAccountId || '').trim();
    const fileId = String(selectedBackupFileIdByAppId[safeAppId] || '').trim();
    if (!safeAppId || !accountId || !fileId) {
      setDeployedAppsError('Selecciona cuenta y backup antes de restaurar.');
      return;
    }
    const confirmed = window.confirm(
      'Esta acción restaurará archivos de la app desde el backup seleccionado. ¿Confirmar restauración?'
    );
    if (!confirmed) return;
    setRestoringBackupAppId(safeAppId);
    setDeployNotice('');
    setDeployedAppsError('');
    try {
      const payload = await restoreToolsDeployedAppBackup({
        appId: safeAppId,
        accountId,
        fileId
      });
      const job = await waitForStorageJob(payload.job.id, (jobUpdate) => {
        setRestoreJobByAppId((prev) => ({
          ...prev,
          [safeAppId]: jobUpdate
        }));
      });
      setRestoreJobByAppId((prev) => ({
        ...prev,
        [safeAppId]: job
      }));
      if (job.status === 'error') {
        throw new Error(job.error || 'Restauración fallida.');
      }
      setDeployNotice('Restauración completada. Refrescando estado de apps...');
      await loadDeployedAppsView(true, true);
    } catch (error) {
      setDeployedAppsError(error instanceof Error ? error.message : 'No se pudo restaurar backup de la app');
    } finally {
      setRestoringBackupAppId(null);
    }
  };

  useEffect(() => {
    void loadDriveAccounts(true);
  }, [loadDriveAccounts]);

  useEffect(() => {
    if (activeView !== 'storage') return;
    void loadStorageLocal();
    void loadStorageHeavy();
    void loadDriveAccounts(true);
  }, [activeView, loadStorageLocal, loadStorageHeavy, loadDriveAccounts]);

  useEffect(() => {
    if (activeView !== 'storage') return;
    void loadDriveFiles();
  }, [activeView, activeDriveAccountId, loadDriveFiles]);

  useEffect(() => {
    const runningRestoreJobIds: string[] = [];
    Object.keys(restoreJobByAppId).forEach((appId) => {
      const job = restoreJobByAppId[appId];
      if (!job) return;
      if (job.status === 'running' || job.status === 'pending') {
        runningRestoreJobIds.push(job.id);
      }
    });
    const runningIds = [
      driveUploadJob && (driveUploadJob.status === 'running' || driveUploadJob.status === 'pending')
        ? driveUploadJob.id
        : '',
      ...runningRestoreJobIds
    ]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    if (runningIds.length === 0) return;
    const pollId = window.setInterval(() => {
      runningIds.forEach((jobId) => {
        void getToolsStorageJob(jobId)
          .then((job) => {
            if (driveUploadJob && driveUploadJob.id === job.id) {
              setDriveUploadJob(job);
            }
            setRestoreJobByAppId((prev) => {
              const next = { ...prev };
              Object.keys(next).forEach((appId) => {
                if (next[appId] && next[appId].id === job.id) {
                  next[appId] = job;
                }
              });
              return next;
            });
          })
          .catch(() => {
            // ignore polling errors and retry on next cycle.
          });
      });
    }, 2400);
    return () => {
      window.clearInterval(pollId);
    };
  }, [driveUploadJob, restoreJobByAppId]);

  const pushGitRepo = async (repoId: string) => {
    setGitReposError('');
    setGitNotice('');
    setPushingGitRepoId(repoId);
    try {
      const branch = String(gitBranchTargetByRepo[repoId] || '').trim();
      const createBranch = Boolean(gitCreateBranchByRepo[repoId]);
      const response = await pushToolsGitRepo(repoId, {
        commitMessage: '',
        branch,
        createBranch
      });
      const hash = String(response.push?.commitHash || '').trim();
      const commitNote = response.push?.commitCreated ? (hash ? `commit ${hash}` : 'commit nuevo') : 'sin commit nuevo';
      const branchNote = String(response.push?.targetBranch || branch || '').trim();
      const branchMsg = branchNote ? ` · rama ${branchNote}` : '';
      setGitNotice(`Push completado (${commitNote})${branchMsg}.`);
      await loadGitRepoView(true, true);
      onRunsChanged?.();
    } catch (error) {
      setGitReposError(error instanceof Error ? error.message : 'No se pudo subir cambios del repositorio');
    } finally {
      setPushingGitRepoId(null);
    }
  };

  const checkoutGitBranch = async (repoId: string) => {
    const branch = String(gitBranchTargetByRepo[repoId] || '').trim();
    if (!branch) {
      setGitReposError('Indica la rama para hacer checkout.');
      return;
    }
    setGitReposError('');
    setGitNotice('');
    setCheckingOutGitRepoId(repoId);
    try {
      const payload = await checkoutToolsGitBranch(repoId, {
        branch,
        create: Boolean(gitCreateBranchByRepo[repoId])
      });
      setGitNotice(
        payload.created
          ? `Rama ${payload.branch} creada y seleccionada.`
          : `Rama ${payload.branch} seleccionada.`
      );
      await loadGitRepoView(true, true);
    } catch (error) {
      setGitReposError(error instanceof Error ? error.message : 'No se pudo hacer checkout de la rama');
    } finally {
      setCheckingOutGitRepoId(null);
    }
  };

  const mergeGitBranches = async (repoId: string) => {
    const sourceBranch = String(gitMergeSourceByRepo[repoId] || '').trim();
    const targetBranch = String(gitMergeTargetByRepo[repoId] || '').trim();
    if (!sourceBranch || !targetBranch) {
      setGitReposError('Selecciona rama origen y rama destino para merge.');
      return;
    }
    if (sourceBranch === targetBranch) {
      setGitReposError('La rama origen y destino deben ser distintas.');
      return;
    }
    const confirmed = window.confirm(
      `Se hará merge de ${sourceBranch} -> ${targetBranch}. ¿Confirmar?`
    );
    if (!confirmed) return;
    setGitReposError('');
    setGitNotice('');
    setMergingGitRepoId(repoId);
    try {
      const payload = await mergeToolsGitBranches(repoId, { sourceBranch, targetBranch });
      setGitNotice(`Merge completado: ${sourceBranch} -> ${targetBranch}.`);
      await loadGitRepoView(true, true);
      if (payload.repo?.hasConflicts) {
        setGitReposError('El merge terminó con conflictos. Revisa el repo y usa "Resolver conflictos".');
      }
    } catch (error) {
      setGitReposError(error instanceof Error ? error.message : 'No se pudo ejecutar merge de ramas');
      await loadGitRepoView(true, true);
    } finally {
      setMergingGitRepoId(null);
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
              : activeView === 'git'
                ? 'Tools · Git'
                : activeView === 'storage'
                  ? 'Tools · Storage local + nube'
                  : 'Tools · Apps desplegadas';

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
    if (activeView === 'deployments') {
      void loadDeployedAppsView(false, true);
      return;
    }
    if (activeView === 'storage') {
      void loadStorageLocal();
      void loadStorageHeavy();
      void loadDriveAccounts(true);
      void loadDriveFiles();
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

              <button
                type="button"
                onClick={() => setActiveView('storage')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <HardDrive size={18} className="text-orange-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">Storage local + nube</p>
                      <p className="text-xs text-zinc-500 truncate">
                        {storageLocalData?.entries?.length || 0} item(s) locales · {driveAccounts.length} cuenta(s) Drive
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('deployments')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Server size={18} className="text-sky-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-100">Apps desplegadas</p>
                      <p className="text-xs text-zinc-500 truncate">
                        {deployedApps.length} app(s) · activas {deployedApps.filter((app) => app.status === 'running').length}
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
                const checkoutBusy = checkingOutGitRepoId === repo.id;
                const mergeBusy = mergingGitRepoId === repo.id;
                const resolveBusy = resolvingGitRepoId === repo.id;
                const branches = Array.isArray(repo.branches) && repo.branches.length > 0
                  ? repo.branches
                  : [repo.branch].filter(Boolean);
                const pushBranch = String(gitBranchTargetByRepo[repo.id] || repo.branch || '').trim();
                const mergeSource = String(gitMergeSourceByRepo[repo.id] || '').trim();
                const mergeTarget = String(gitMergeTargetByRepo[repo.id] || repo.branch || '').trim();
                const canMerge =
                  !repo.detached &&
                  !repo.hasConflicts &&
                  Boolean(mergeSource) &&
                  Boolean(mergeTarget) &&
                  mergeSource !== mergeTarget;
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

                        <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5 space-y-2">
                          <p className="text-[11px] uppercase text-zinc-500">branch para push / checkout</p>
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <select
                              value={pushBranch}
                              onChange={(event) => {
                                const value = event.target.value;
                                setGitBranchTargetByRepo((prev) => ({ ...prev, [repo.id]: value }));
                                setGitMergeTargetByRepo((prev) => ({ ...prev, [repo.id]: value }));
                              }}
                              className="sm:col-span-2 rounded-lg border border-zinc-800 bg-black/60 px-2 py-1.5 text-xs text-zinc-200"
                            >
                              <option value="">Rama actual ({repo.branch})</option>
                              {branches.map((branch) => (
                                <option key={`${repo.id}:pushbranch:${branch}`} value={branch}>
                                  {branch}
                                </option>
                              ))}
                            </select>
                            <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                              <input
                                type="checkbox"
                                checked={Boolean(gitCreateBranchByRepo[repo.id])}
                                onChange={(event) => {
                                  const checked = Boolean(event.target.checked);
                                  setGitCreateBranchByRepo((prev) => ({ ...prev, [repo.id]: checked }));
                                }}
                              />
                              crear rama si no existe
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                void checkoutGitBranch(repo.id);
                              }}
                              disabled={checkoutBusy || pushBusy || mergeBusy || resolveBusy || !pushBranch}
                              className="text-xs px-2.5 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 disabled:opacity-50"
                            >
                              {checkoutBusy ? 'Cambiando...' : 'Checkout'}
                            </button>
                          </div>
                        </article>

                        <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5 space-y-2">
                          <p className="text-[11px] uppercase text-zinc-500">merge ramas</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <select
                              value={mergeSource}
                              onChange={(event) => {
                                const value = event.target.value;
                                setGitMergeSourceByRepo((prev) => ({ ...prev, [repo.id]: value }));
                              }}
                              className="rounded-lg border border-zinc-800 bg-black/60 px-2 py-1.5 text-xs text-zinc-200"
                            >
                              <option value="">Rama origen</option>
                              {branches.map((branch) => (
                                <option key={`${repo.id}:merge-source:${branch}`} value={branch}>
                                  {branch}
                                </option>
                              ))}
                            </select>
                            <select
                              value={mergeTarget}
                              onChange={(event) => {
                                const value = event.target.value;
                                setGitMergeTargetByRepo((prev) => ({ ...prev, [repo.id]: value }));
                              }}
                              className="rounded-lg border border-zinc-800 bg-black/60 px-2 py-1.5 text-xs text-zinc-200"
                            >
                              <option value="">Rama destino</option>
                              {branches.map((branch) => (
                                <option key={`${repo.id}:merge-target:${branch}`} value={branch}>
                                  {branch}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                void mergeGitBranches(repo.id);
                              }}
                              disabled={!canMerge || mergeBusy || pushBusy || checkoutBusy || resolveBusy}
                              className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                                canMerge
                                  ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
                                  : 'border-zinc-700 text-zinc-500'
                              } disabled:opacity-50`}
                            >
                              {mergeBusy ? 'Merge...' : 'Merge'}
                            </button>
                          </div>
                        </article>

                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              void pushGitRepo(repo.id);
                            }}
                            disabled={!canPush || pushBusy || resolveBusy || checkoutBusy || mergeBusy}
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
                            disabled={!repo.hasConflicts || resolveBusy || pushBusy || mergeBusy || checkoutBusy}
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

        {activeView === 'storage' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Storage local + Google Drive</h2>
              <p className="text-xs text-zinc-500">
                Explora rutas del servidor, detecta peso, sube a nube y gestiona cuentas de Drive.
              </p>
            </div>

            <article className="rounded-xl border border-zinc-800 bg-black/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-zinc-300 uppercase">Explorador local</p>
                <button
                  type="button"
                  onClick={() => {
                    void loadStorageLocal();
                    void loadStorageHeavy();
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500"
                >
                  Refrescar
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  value={storageLocalPath}
                  onChange={(event) => setStorageLocalPath(event.target.value)}
                  placeholder="/var, /opt, /root, /home..."
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    void loadStorageLocal();
                    void loadStorageHeavy();
                  }}
                  className="text-xs px-3 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500"
                >
                  Abrir
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300">
                  <span className="block text-[10px] uppercase text-zinc-500 mb-1">Ordenar</span>
                  <select
                    value={storageSortBy}
                    onChange={(event) =>
                      setStorageSortBy(
                        event.target.value === 'name' || event.target.value === 'mtime'
                          ? event.target.value
                          : 'size'
                      )
                    }
                    className="w-full bg-transparent text-xs text-zinc-100 outline-none"
                  >
                    <option value="size">Tamano</option>
                    <option value="mtime">Fecha</option>
                    <option value="name">Nombre</option>
                  </select>
                </label>
                <label className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300">
                  <span className="block text-[10px] uppercase text-zinc-500 mb-1">Direccion</span>
                  <select
                    value={storageSortOrder}
                    onChange={(event) =>
                      setStorageSortOrder(event.target.value === 'asc' ? 'asc' : 'desc')
                    }
                    className="w-full bg-transparent text-xs text-zinc-100 outline-none"
                  >
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                </label>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300">
                  <p className="text-[10px] uppercase text-zinc-500">Seleccion</p>
                  <p className="mt-1 text-zinc-100">
                    {selectedLocalPaths.length} item(s) · {formatBytes(selectedLocalTotalBytes)}
                  </p>
                </div>
              </div>

              {storageLocalError ? <p className="text-xs text-red-300">{storageLocalError}</p> : null}
              {storageHeavyError ? <p className="text-xs text-red-300">{storageHeavyError}</p> : null}

              {storageLocalLoading ? <p className="text-xs text-zinc-500">Cargando ruta local...</p> : null}
              {!storageLocalLoading && storageLocalData ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {storageLocalData.parentPath ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStorageLocalPath(storageLocalData.parentPath);
                        }}
                        className="text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300"
                      >
                        Subir nivel
                      </button>
                    ) : null}
                    <p className="text-[11px] text-zinc-500 break-all">
                      {storageLocalData.path} · {storageLocalData.totalEntries} item(s)
                    </p>
                  </div>

                  <div className="max-h-80 overflow-auto space-y-1">
                    {storageLocalData.entries.map((entry) => {
                      const isSelected = Boolean(storageSelectedLocalPaths[entry.path]);
                      return (
                        <article
                          key={entry.path}
                          className={`rounded-lg border p-2 ${
                            isSelected ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-zinc-800 bg-zinc-950/70'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                toggleStorageLocalSelection(entry.path);
                              }}
                              className="h-4 w-4 accent-cyan-400"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-zinc-100 truncate" title={entry.path}>
                                {entry.name}
                              </p>
                              <p className="text-[10px] text-zinc-500 truncate">
                                {entry.type} · {entry.sizeBytes !== null ? formatBytes(entry.sizeBytes) : 'n/a'} ·{' '}
                                {formatDateTime(entry.modifiedAt)}
                              </p>
                            </div>
                            {entry.type === 'directory' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setStorageLocalPath(entry.path);
                                }}
                                className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300"
                              >
                                <span className="inline-flex items-center gap-1">
                                  <FolderOpen size={12} />
                                  Abrir
                                </span>
                              </button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    void uploadSelectedLocalPathsToDrive();
                  }}
                  disabled={selectedLocalPaths.length === 0 || !activeDriveAccountId}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                    selectedLocalPaths.length > 0 && activeDriveAccountId
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                      : 'border-zinc-700 text-zinc-500'
                  } disabled:opacity-50`}
                >
                  <span className="inline-flex items-center gap-1">
                    <Upload size={12} />
                    Subir seleccion a Drive
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void loadStorageHeavy();
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-300"
                >
                  Analizar peso
                </button>
              </div>

              {driveUploadJob ? (
                <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                  <p className="text-[11px] text-zinc-400 uppercase">
                    job subida · {driveUploadJob.status}
                  </p>
                  <p className="text-xs text-zinc-300 mt-1 break-all">{driveUploadJob.log || driveUploadJob.error || '-'}</p>
                </article>
              ) : null}

              {storageHeavyLoading ? <p className="text-xs text-zinc-500">Escaneando peso...</p> : null}
              {storageHeavyData ? (
                <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5 space-y-1">
                  <p className="text-[11px] uppercase text-zinc-500">
                    Top pesado · {storageHeavyData.path} · total {formatBytes(storageHeavyData.totalBytes)}
                  </p>
                  <div className="space-y-1 max-h-44 overflow-auto">
                    {storageHeavyData.entries.map((entry) => (
                      <div key={entry.path} className="text-xs text-zinc-300 flex items-center justify-between gap-2">
                        <span className="truncate" title={entry.path}>{entry.path}</span>
                        <span className="shrink-0 text-zinc-500">{formatBytes(entry.sizeBytes)}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ) : null}
            </article>

            <article className="rounded-xl border border-zinc-800 bg-black/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-zinc-300 uppercase">Google Drive</p>
                <button
                  type="button"
                  onClick={() => {
                    void loadDriveAccounts();
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-200"
                >
                  Refrescar cuentas
                </button>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
                <p className="text-[11px] uppercase text-zinc-500">Subir credenciales JSON</p>
                <p className="text-[11px] text-zinc-500">
                  Soporta `service_account` y `oauth_client`. Las credenciales se guardan cifradas en servidor y no se exponen al cliente.
                </p>
                <p className="text-[11px] text-zinc-500">
                  Pasos: crea proyecto en Google Cloud → habilita Drive API → crea credencial (service account u OAuth client) → descarga JSON → súbelo aquí.
                </p>
                <input
                  value={driveCredentialAlias}
                  onChange={(event) => setDriveCredentialAlias(event.target.value)}
                  placeholder="Alias de cuenta (ej. Drive Produccion)"
                  className="w-full rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-xs text-zinc-100"
                />
                <textarea
                  value={driveCredentialText}
                  onChange={(event) => setDriveCredentialText(event.target.value)}
                  placeholder="Pega el JSON de credenciales..."
                  className="w-full min-h-24 rounded-lg border border-zinc-800 bg-black/50 px-3 py-2 text-xs text-zinc-100 font-mono"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-200 cursor-pointer">
                    <span className="inline-flex items-center gap-1">
                      <KeyRound size={12} />
                      Seleccionar JSON
                    </span>
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
                        void handleDriveCredentialsFile(file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      void createDriveAccountFromCredentialText();
                    }}
                    disabled={creatingDriveAccount}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-200 disabled:opacity-50"
                  >
                    {creatingDriveAccount ? 'Guardando...' : 'Guardar cuenta'}
                  </button>
                </div>
              </div>

              {driveNotice ? <p className="text-xs text-emerald-300">{driveNotice}</p> : null}
              {driveAccountsError ? <p className="text-xs text-red-300">{driveAccountsError}</p> : null}
              {driveFilesError ? <p className="text-xs text-red-300">{driveFilesError}</p> : null}

              {driveAccountsLoading ? <p className="text-xs text-zinc-500">Cargando cuentas...</p> : null}
              {!driveAccountsLoading && driveAccounts.length === 0 ? (
                <p className="text-xs text-zinc-500">No hay cuentas de Drive configuradas todavía.</p>
              ) : null}

              <div className="space-y-2">
                {driveAccounts.map((account) => {
                  const isActive = activeDriveAccountId === account.id;
                  const oauthBusy = startingOauthAccountId === account.id || completingOauthAccountId === account.id;
                  return (
                    <article
                      key={account.id}
                      className={`rounded-lg border p-2.5 ${
                        isActive ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-zinc-800 bg-zinc-950/70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-100 truncate">{account.alias}</p>
                          <p className="text-[10px] text-zinc-500 truncate">
                            {account.authMode} · {account.status}
                            {account.lastError ? ` · ${account.lastError}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveDriveAccountId(account.id)}
                          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-200"
                        >
                          {isActive ? 'Activa' : 'Usar'}
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            void validateDriveAccount(account.id);
                          }}
                          disabled={validatingDriveAccountId === account.id}
                          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 disabled:opacity-50"
                        >
                          {validatingDriveAccountId === account.id ? 'Validando...' : 'Validar'}
                        </button>
                        {account.authMode === 'oauth_client' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                void beginDriveOauth(account.id);
                              }}
                              disabled={oauthBusy}
                              className="text-xs px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 disabled:opacity-50"
                            >
                              {startingOauthAccountId === account.id ? 'Generando...' : 'Iniciar OAuth'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void completeDriveOauth(account.id);
                              }}
                              disabled={oauthBusy}
                              className="text-xs px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 disabled:opacity-50"
                            >
                              {completingOauthAccountId === account.id ? 'Completando...' : 'Completar OAuth'}
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            void removeDriveAccount(account.id);
                          }}
                          disabled={deletingDriveAccountId === account.id}
                          className="text-xs px-2 py-1 rounded border border-red-500/40 bg-red-500/10 text-red-200 disabled:opacity-50"
                        >
                          {deletingDriveAccountId === account.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {driveOauthUrl ? (
                <article className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2">
                  <p className="text-[11px] uppercase text-amber-300">OAuth URL</p>
                  <a href={driveOauthUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 break-all">
                    {driveOauthUrl}
                  </a>
                  <input
                    value={driveOauthCode}
                    onChange={(event) => setDriveOauthCode(event.target.value)}
                    placeholder="Pega aquí el code de Google"
                    className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-100"
                  />
                </article>
              ) : null}

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5 space-y-2">
                <p className="text-[11px] uppercase text-zinc-500">
                  Archivos en Drive {activeDriveAccountId ? `· cuenta ${activeDriveAccountId}` : ''}
                </p>
                {driveFilesLoading ? <p className="text-xs text-zinc-500">Cargando archivos...</p> : null}
                {!driveFilesLoading && driveFiles.length === 0 ? (
                  <p className="text-xs text-zinc-500">Sin archivos visibles en la carpeta seleccionada.</p>
                ) : null}
                <div className="max-h-72 overflow-auto space-y-1">
                  {driveFiles.map((file) => (
                    <div key={file.id} className="rounded border border-zinc-800 bg-black/30 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-100 truncate" title={file.name}>{file.name}</p>
                          <p className="text-[10px] text-zinc-500 truncate">
                            {file.mimeType} · {file.sizeBytes !== null ? formatBytes(file.sizeBytes) : 'n/a'} ·{' '}
                            {formatDateTime(file.createdAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void removeDriveFile(file.id);
                          }}
                          className="text-xs px-2 py-1 rounded border border-red-500/40 bg-red-500/10 text-red-200"
                        >
                          Borrar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </section>
        ) : null}

        {activeView === 'deployments' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Apps desplegadas</h2>
              <p className="text-xs text-zinc-500">Listado del sistema con acciones de inicio/parada/reinicio y logs.</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setSelectingDeployedApps((prev) => {
                    const next = !prev;
                    if (!next) {
                      setSelectedDeployedApps({});
                    }
                    return next;
                  });
                }}
                className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                  selectingDeployedApps
                    ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                    : 'border-zinc-700 text-zinc-200'
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <CheckSquare size={12} />
                  {selectingDeployedApps ? 'Cancelar seleccion' : 'Seleccionar aplicaciones'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  void runDescribeDeployedApps(selectedDeployedAppIds, 'bulk');
                }}
                disabled={!selectingDeployedApps || selectedDeployedCount === 0 || describingSelectedApps}
                className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                  selectingDeployedApps && selectedDeployedCount > 0
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                    : 'border-zinc-700 text-zinc-500'
                } disabled:opacity-50`}
              >
                {describingSelectedApps
                  ? 'Generando descripcion...'
                  : `Generar descripcion seleccionadas (${selectedDeployedCount})`}
              </button>

              {selectingDeployedApps ? (
                <button
                  type="button"
                  onClick={() => {
                    if (allDeployedAppsSelected) {
                      setSelectedDeployedApps({});
                      return;
                    }
                    const allNext: Record<string, true> = {};
                    deployedAppIds.forEach((appId) => {
                      allNext[appId] = true;
                    });
                    setSelectedDeployedApps(allNext);
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
                >
                  {allDeployedAppsSelected ? 'Quitar seleccion total' : 'Seleccionar todas'}
                </button>
              ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-300">
                <span className="block text-[10px] uppercase text-zinc-500 mb-1">Buscar</span>
                <input
                  value={deployedSearchQuery}
                  onChange={(event) => setDeployedSearchQuery(event.target.value)}
                  placeholder="Nombre, source, detalle, estado..."
                  className="w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 outline-none"
                />
              </label>

              <label className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-300">
                <span className="block text-[10px] uppercase text-zinc-500 mb-1">Estado</span>
                <select
                  value={deployedStatusFilter}
                  onChange={(event) =>
                    setDeployedStatusFilter(
                      event.target.value === 'running' ||
                      event.target.value === 'stopped' ||
                      event.target.value === 'failing'
                        ? event.target.value
                        : 'all'
                    )
                  }
                  className="w-full bg-transparent text-xs text-zinc-100 outline-none"
                >
                  <option value="all">Todas</option>
                  <option value="running">Ejecutando</option>
                  <option value="stopped">Paradas</option>
                  <option value="failing">Fallando / inactive / exited</option>
                </select>
              </label>

              <label className="rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-300">
                <span className="block text-[10px] uppercase text-zinc-500 mb-1">Tipo</span>
                <select
                  value={deployedTypeFilter}
                  onChange={(event) =>
                    setDeployedTypeFilter(
                      event.target.value === 'system' || event.target.value === 'non-system'
                        ? event.target.value
                        : 'all'
                    )
                  }
                  className="w-full bg-transparent text-xs text-zinc-100 outline-none"
                >
                  <option value="all">Todas</option>
                  <option value="system">Solo sistema</option>
                  <option value="non-system">No sistema</option>
                </select>
              </label>
            </div>

            {deployNotice ? <p className="text-xs text-emerald-300">{deployNotice}</p> : null}
            {deployedAppsError ? <p className="text-xs text-red-300">{deployedAppsError}</p> : null}
            {deployedAppsScannedAt ? (
              <p className="text-[10px] text-zinc-600">ultimo escaneo {formatTime(deployedAppsScannedAt)}</p>
            ) : null}
            <p className="text-[10px] text-zinc-600">
              mostrando {filteredDeployedApps.length} de {deployedApps.length} app(s)
            </p>

            {deployedAppsLoading && deployedApps.length === 0 ? (
              <p className="text-sm text-zinc-500">Buscando apps desplegadas...</p>
            ) : null}

            {!deployedAppsLoading && deployedApps.length === 0 ? (
              <p className="text-sm text-zinc-500">No se detectaron apps desplegadas gestionables en este entorno.</p>
            ) : null}

            {!deployedAppsLoading && deployedApps.length > 0 && filteredDeployedApps.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay apps que coincidan con los filtros actuales.</p>
            ) : null}

            <div className="space-y-2">
              {filteredDeployedApps.map((app) => {
                const isOpen = Boolean(expandedDeployedApps[app.id]);
                const statusText = formatDeployedStatus(app.status);
                const isFailing =
                  app.status === 'error' ||
                  app.normalizedStatus === 'error' ||
                  app.isStopped ||
                  /(inactive|exited|failed|dead|error|unhealthy)/i.test(String(app.detailStatus || ''));
                const statusClass =
                  app.isRunning || app.status === 'running'
                    ? 'text-emerald-300'
                    : isFailing
                      ? 'text-red-300'
                      : app.status === 'stopped'
                        ? 'text-red-300'
                        : 'text-amber-300';
                const busyForApp = deployActionBusy?.appId === app.id;
                const logsState = deployLogsByApp[app.id];
                const isSelected = Boolean(selectedDeployedApps[app.id]);
                const generatedDescription =
                  generatedDeployedDescriptions[app.id] ||
                  (app.aiDescription
                    ? { description: app.aiDescription, generatedAt: app.aiDescriptionGeneratedAt || '' }
                    : undefined);
                const describeBusy =
                  describingDeployedAppId === app.id ||
                  app.descriptionJobStatus === 'pending' ||
                  app.descriptionJobStatus === 'running';
                const backupAccountId =
                  String(backupAccountByAppId[app.id] || '').trim() ||
                  String(activeDriveAccountId || '').trim() ||
                  String(driveAccounts[0]?.id || '').trim();
                const appBackups = backupsByAppId[app.id] || [];
                const selectedBackupFileId = String(selectedBackupFileIdByAppId[app.id] || '').trim();
                const backupJob = restoreJobByAppId[app.id];
                const cardClass = isFailing
                  ? 'rounded-xl border border-red-500/40 bg-red-500/5 p-3'
                  : 'rounded-xl border border-zinc-800 bg-black/40 p-3';
                return (
                  <article key={app.id} className={cardClass}>
                    <div className="flex items-center gap-2">
                      {selectingDeployedApps ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            toggleSelectDeployedApp(app.id);
                          }}
                          className="h-4 w-4 accent-cyan-400"
                          aria-label={isSelected ? `${app.name} seleccionada` : `Seleccionar ${app.name}`}
                        />
                      ) : null}

                      <button
                        type="button"
                        onClick={() => {
                          setExpandedDeployedApps((prev) => ({ ...prev, [app.id]: !prev[app.id] }));
                        }}
                        onMouseEnter={() => openDeployedApp(app.id)}
                        onFocus={() => openDeployedApp(app.id)}
                        className="w-full text-left flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-zinc-100 truncate">{app.name}</p>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide border ${
                                isFailing
                                  ? 'border-red-400/60 bg-red-500/20 text-red-200'
                                  : app.isRunning
                                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                                    : 'border-zinc-600 bg-zinc-700/20 text-zinc-300'
                              }`}
                            >
                              {statusText}
                            </span>
                          </div>
                          <p className={`text-xs mt-1 truncate ${isFailing ? 'text-red-300' : 'text-zinc-500'}`}>
                            {formatDeployedSource(app.source)} · {formatDeployedCategory(app.category)}
                            {app.pid ? ` · pid ${app.pid}` : ''} {app.uptime ? ` · uptime ${app.uptime}` : ''}
                          </p>
                        </div>
                        {isOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
                      </button>
                    </div>

                    {isOpen ? (
                      <div className="mt-3 pt-3 border-t border-zinc-800 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                            <p className="text-[10px] uppercase text-zinc-500">source / status / tipo</p>
                            <p className={`text-xs mt-1 ${statusClass}`}>
                              {formatDeployedSource(app.source)} / {statusText} / {formatDeployedCategory(app.category)}
                            </p>
                          </article>
                          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                            <p className="text-[10px] uppercase text-zinc-500">pid / uptime / system</p>
                            <p className="text-xs text-zinc-200 mt-1">
                              {app.pid ? app.pid : 'n/a'} / {app.uptime || 'n/a'} / {app.isSystem ? 'si' : 'no'}
                            </p>
                          </article>
                        </div>

                        {generatedDescription ? (
                          <article className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2.5">
                            <p className="text-[11px] uppercase text-cyan-300">
                              descripcion ia
                              {app.aiDescriptionProvider ? ` · ${app.aiDescriptionProvider}` : ''}
                              {generatedDescription.generatedAt ? ` · ${formatTime(generatedDescription.generatedAt)}` : ''}
                            </p>
                            <p className="text-xs text-zinc-200 mt-1 whitespace-pre-wrap break-words">
                              {generatedDescription.description}
                            </p>
                          </article>
                        ) : null}

                        {app.description ? (
                          <p className="text-xs text-zinc-300 break-all">detalle del sistema: {app.description}</p>
                        ) : null}
                        {app.location ? (
                          <p className="text-xs text-zinc-500 break-all">ubicacion: {app.location}</p>
                        ) : null}
                        {app.detailStatus ? (
                          <p className="text-[11px] text-zinc-500 break-all">estado raw: {app.detailStatus}</p>
                        ) : null}
                        <p className="text-[11px] text-zinc-500 break-all">
                          job descripcion: {formatDescriptionJobStatus(app.descriptionJobStatus)}
                        </p>

                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              void actionDeployedApp(app.id, 'start');
                            }}
                            disabled={!app.canStart || busyForApp}
                            className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                              app.canStart ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 text-zinc-500'
                            } disabled:opacity-50`}
                          >
                            {busyForApp && deployActionBusy?.action === 'start' ? 'Iniciando...' : app.canStart ? 'Iniciar' : 'Ya iniciada'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              void actionDeployedApp(app.id, 'stop');
                            }}
                            disabled={!app.canStop || busyForApp}
                            className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                              app.canStop ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-zinc-700 text-zinc-500'
                            } disabled:opacity-50`}
                          >
                            {busyForApp && deployActionBusy?.action === 'stop' ? 'Parando...' : app.canStop ? 'Parar' : 'Ya parada'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              void actionDeployedApp(app.id, 'restart');
                            }}
                            disabled={!app.canRestart || busyForApp}
                            className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                              app.canRestart ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-zinc-700 text-zinc-500'
                            } disabled:opacity-50`}
                          >
                            {busyForApp && deployActionBusy?.action === 'restart' ? 'Reiniciando...' : 'Reiniciar'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              void runDescribeDeployedApps([app.id], 'single');
                            }}
                            disabled={busyForApp || describeBusy || describingSelectedApps}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 disabled:opacity-50"
                          >
                            {describeBusy ? 'Generando descripcion...' : 'Generar descripcion'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              toggleDeployedLogs(app.id);
                            }}
                            disabled={!app.hasLogs}
                            className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                              app.hasLogs ? 'border-zinc-600 text-zinc-200' : 'border-zinc-700 text-zinc-500'
                            } disabled:opacity-50`}
                          >
                            {logsState?.visible ? 'Ocultar logs' : 'Ver logs'}
                          </button>

                          {logsState?.visible ? (
                            <button
                              type="button"
                              onClick={() => {
                                void loadDeployedLogs(app.id, true);
                              }}
                              disabled={logsState.loading}
                              className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                            >
                              {logsState.loading ? 'Actualizando logs...' : 'Actualizar logs'}
                            </button>
                          ) : null}
                        </div>

                        <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5 space-y-2">
                          <p className="text-[11px] uppercase text-zinc-500">backup nube / restauracion</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <label className="rounded-lg border border-zinc-800 bg-black/30 px-2.5 py-2 text-xs text-zinc-300">
                              <span className="block text-[10px] uppercase text-zinc-500 mb-1">Cuenta Drive</span>
                              <select
                                value={backupAccountId}
                                onChange={(event) =>
                                  setBackupAccountByAppId((prev) => ({
                                    ...prev,
                                    [app.id]: event.target.value
                                  }))
                                }
                                className="w-full bg-transparent text-xs text-zinc-100 outline-none"
                              >
                                <option value="">Seleccionar</option>
                                {driveAccounts.map((account) => (
                                  <option key={`${app.id}:acc:${account.id}`} value={account.id}>
                                    {account.alias} ({account.status})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                void loadBackupsForApp(app.id, backupAccountId);
                              }}
                              disabled={!backupAccountId || loadingBackupsAppId === app.id}
                              className={`text-xs px-2.5 py-2 rounded-lg border ${
                                backupAccountId
                                  ? 'border-zinc-700 text-zinc-200'
                                  : 'border-zinc-700 text-zinc-500'
                              } disabled:opacity-50`}
                            >
                              {loadingBackupsAppId === app.id ? 'Cargando backups...' : 'Listar backups'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void createBackupForApp(app.id);
                              }}
                              disabled={!backupAccountId || creatingBackupAppId === app.id}
                              className={`text-xs px-2.5 py-2 rounded-lg border ${
                                backupAccountId
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                                  : 'border-zinc-700 text-zinc-500'
                              } disabled:opacity-50`}
                            >
                              {creatingBackupAppId === app.id ? 'Creando backup...' : 'Crear backup en nube'}
                            </button>
                          </div>

                          <label className="rounded-lg border border-zinc-800 bg-black/30 px-2.5 py-2 text-xs text-zinc-300 block">
                            <span className="block text-[10px] uppercase text-zinc-500 mb-1">Backup disponible</span>
                            <select
                              value={selectedBackupFileId}
                              onChange={(event) =>
                                setSelectedBackupFileIdByAppId((prev) => ({
                                  ...prev,
                                  [app.id]: event.target.value
                                }))
                              }
                              className="w-full bg-transparent text-xs text-zinc-100 outline-none"
                            >
                              <option value="">Seleccionar backup</option>
                              {appBackups.map((backup) => (
                                <option key={`${app.id}:backup:${backup.id}`} value={backup.driveFileId}>
                                  {backup.name} · {backup.sizeBytes !== null ? formatBytes(backup.sizeBytes) : 'n/a'} ·{' '}
                                  {formatDateTime(backup.createdAt)} · {backup.accountAlias || backup.accountId}
                                </option>
                              ))}
                            </select>
                          </label>

                          <button
                            type="button"
                            onClick={() => {
                              void restoreBackupForApp(app.id);
                            }}
                            disabled={!backupAccountId || !selectedBackupFileId || restoringBackupAppId === app.id}
                            className={`text-xs px-2.5 py-1.5 rounded-lg border ${
                              backupAccountId && selectedBackupFileId
                                ? 'border-red-500/40 bg-red-500/10 text-red-200'
                                : 'border-zinc-700 text-zinc-500'
                            } disabled:opacity-50`}
                          >
                            <span className="inline-flex items-center gap-1">
                              <Download size={12} />
                              {restoringBackupAppId === app.id ? 'Restaurando...' : 'Restaurar desde backup'}
                            </span>
                          </button>

                          {backupJob ? (
                            <article className="rounded border border-zinc-800 bg-black/30 p-2">
                              <p className="text-[10px] uppercase text-zinc-500">
                                job {backupJob.type} · {backupJob.status}
                              </p>
                              <p className="text-xs text-zinc-300 mt-1 whitespace-pre-wrap break-all">
                                {backupJob.log || backupJob.error || '-'}
                              </p>
                            </article>
                          ) : null}
                        </article>

                        {logsState?.visible ? (
                          <article className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5 space-y-2">
                            <p className="text-[11px] uppercase text-zinc-500">
                              logs{logsState.fetchedAt ? ` · ${formatTime(logsState.fetchedAt)}` : ''}
                            </p>
                            {logsState.error ? <p className="text-xs text-red-300">{logsState.error}</p> : null}
                            {logsState.loading ? <p className="text-xs text-zinc-500">Cargando logs...</p> : null}
                            {!logsState.loading && !logsState.error ? (
                              <pre className="max-h-72 overflow-auto text-[11px] text-zinc-300 whitespace-pre-wrap break-all">
                                {logsState.logs || 'Sin logs recientes.'}
                              </pre>
                            ) : null}
                          </article>
                        ) : null}
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
