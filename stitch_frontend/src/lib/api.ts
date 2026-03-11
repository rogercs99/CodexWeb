import type {
  AiProviderInfo,
  AiProviderPermissionProfile,
  AiProviderQuota,
  AiAgentSettingsItem,
  AiAgentSettingsPayload,
  AttachmentItem,
  CodexBackgroundRun,
  CodexAuthStatus,
  ChatOptions,
  CodexQuota,
  NotificationSettings,
  Conversation,
  MessagesPagination,
  MessageAttachment,
  Message,
  ToolsDeployedAppActionResponse,
  ToolsDeployedAppDescribeJob,
  ToolsDeployedAppDescribeResponse,
  ToolsDeployedAppLogsResponse,
  ToolsDeployedAppBackupItem,
  ToolsDeployedAppsPayload,
  ToolsDriveAccount,
  ToolsDriveFilesPayload,
  ToolsGitPushResult,
  ToolsGitBranchesPayload,
  ToolsGitMergePayload,
  ToolsGitRepoSummary,
  ToolsGitResolvePayload,
  ToolsGitReposPayload,
  ToolsStorageHeavyPayload,
  ToolsStorageJob,
  ToolsStorageLocalListPayload,
  ToolsStorageOverview,
  RestartState,
  TaskRecovery,
  TaskRunDashboardItem,
  UnifiedSearchPayload,
  ObservabilitySnapshot,
  User
} from './types';

interface ApiError extends Error {
  status?: number;
}

async function parseJsonSafe(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const err = new Error(data?.error || `Request failed (${response.status})`) as ApiError;
    err.status = response.status;
    throw err;
  }
  return data as T;
}

function normalizeAiProviderQuota(rawValue: any): AiProviderQuota {
  const unitRaw = String(rawValue?.unit || '').trim().toLowerCase();
  return {
    used: Number.isFinite(Number(rawValue?.used)) ? Number(rawValue.used) : null,
    limit: Number.isFinite(Number(rawValue?.limit)) ? Number(rawValue.limit) : null,
    remaining: Number.isFinite(Number(rawValue?.remaining)) ? Number(rawValue.remaining) : null,
    unit:
      unitRaw === 'requests' || unitRaw === 'tokens' || unitRaw === 'credits' || unitRaw === 'usd'
        ? (unitRaw as AiProviderQuota['unit'])
        : null,
    resetAt: String(rawValue?.resetAt || '').trim() || null,
    available: Boolean(rawValue?.available)
  };
}

function normalizeAiProviderPermissionProfile(rawValue: any): AiProviderPermissionProfile {
  return {
    agentId: String(rawValue?.agentId || ''),
    allowRoot: Boolean(rawValue?.allowRoot),
    runAsUser: String(rawValue?.runAsUser || ''),
    allowedPaths: Array.isArray(rawValue?.allowedPaths)
      ? rawValue.allowedPaths.map((entry: any) => String(entry || '')).filter(Boolean)
      : ['/'],
    deniedPaths: Array.isArray(rawValue?.deniedPaths)
      ? rawValue.deniedPaths.map((entry: any) => String(entry || '')).filter(Boolean)
      : [],
    readOnly: Boolean(rawValue?.readOnly),
    allowShell: Boolean(rawValue?.allowShell),
    allowSensitiveTools: Boolean(rawValue?.allowSensitiveTools),
    allowNetwork: Boolean(rawValue?.allowNetwork),
    allowGit: Boolean(rawValue?.allowGit),
    allowBackupRestore: Boolean(rawValue?.allowBackupRestore),
    allowedTools: Array.isArray(rawValue?.allowedTools)
      ? rawValue.allowedTools.map((entry: any) => String(entry || '').trim().toLowerCase()).filter(Boolean)
      : ['chat', 'git', 'storage', 'dropbox', 'backups', 'deployments', 'shell'],
    updatedAt: String(rawValue?.updatedAt || '')
  };
}

function normalizeAiProviderInfo(rawValue: any): AiProviderInfo {
  return {
    id: String(rawValue?.id || ''),
    name: String(rawValue?.name || ''),
    vendor: String(rawValue?.vendor || ''),
    description: String(rawValue?.description || ''),
    pricing:
      rawValue?.pricing === 'free' || rawValue?.pricing === 'freemium' || rawValue?.pricing === 'paid'
        ? rawValue.pricing
        : 'paid',
    integrationType:
      rawValue?.integrationType === 'api_key' ||
      rawValue?.integrationType === 'oauth' ||
      rawValue?.integrationType === 'local_cli'
        ? rawValue.integrationType
        : 'api_key',
    authModes: Array.isArray(rawValue?.authModes)
      ? rawValue.authModes.map((entry: any) => String(entry || '').trim()).filter(Boolean)
      : [],
    docsUrl: String(rawValue?.docsUrl || ''),
    integration: {
      enabled: Boolean(rawValue?.integration?.enabled),
      configured: Boolean(rawValue?.integration?.configured),
      hasApiKey: Boolean(rawValue?.integration?.hasApiKey),
      apiKeyMasked: String(rawValue?.integration?.apiKeyMasked || ''),
      baseUrl: String(rawValue?.integration?.baseUrl || ''),
      updatedAt: String(rawValue?.integration?.updatedAt || '')
    },
    capabilities: Array.isArray(rawValue?.capabilities)
      ? rawValue.capabilities.map((entry: any) => String(entry || '').trim()).filter(Boolean)
      : [],
    models: Array.isArray(rawValue?.models)
      ? rawValue.models.map((entry: any) => String(entry || '').trim()).filter(Boolean)
      : [],
    defaults: {
      model: String(rawValue?.defaults?.model || ''),
      reasoningEffort: String(rawValue?.defaults?.reasoningEffort || '').trim().toLowerCase()
    },
    quota: normalizeAiProviderQuota(rawValue?.quota),
    permissions: normalizeAiProviderPermissionProfile(rawValue?.permissions),
    availability: {
      chat: Boolean(rawValue?.availability?.chat),
      configured: Boolean(rawValue?.availability?.configured),
      enabled: Boolean(rawValue?.availability?.enabled)
    }
  };
}

export async function getMe(): Promise<{ authenticated: boolean; user: User | null }> {
  return api('/api/me');
}

export async function login(username: string, password: string): Promise<{ ok: true; username: string }> {
  return api('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

export async function logout(): Promise<void> {
  await api('/api/logout', { method: 'POST' });
}

export async function listConversations(): Promise<Conversation[]> {
  const data = await api<{ conversations: Conversation[] }>('/api/conversations');
  return Array.isArray(data.conversations) ? data.conversations : [];
}

export async function deleteConversation(conversationId: number): Promise<void> {
  await api(`/api/conversations/${conversationId}`, { method: 'DELETE' });
}

export async function updateConversationTitle(
  conversationId: number,
  title: string
): Promise<{ id: number; title: string }> {
  const data = await api<{ conversation: { id: number; title: string } }>(
    `/api/conversations/${conversationId}/title`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    }
  );
  return data.conversation;
}

export async function killConversationSession(
  conversationId: number
): Promise<{ ok: true; killed: boolean; reason?: string }> {
  return api(`/api/conversations/${conversationId}/kill`, { method: 'POST' });
}

interface ListMessagesOptions {
  limit?: number;
  beforeId?: number | null;
  includeMeta?: boolean;
}

export async function listMessages(conversationId: number, options?: ListMessagesOptions): Promise<{
  conversation: { id: number; title: string; model: string; reasoningEffort: string };
  messages: Message[];
  pagination: MessagesPagination;
  liveDraft?: any;
  taskRecovery?: TaskRecovery | null;
}> {
  const queryParams = new URLSearchParams();
  const requestedLimit = Number(options?.limit);
  if (Number.isInteger(requestedLimit) && requestedLimit > 0) {
    queryParams.set('limit', String(Math.floor(requestedLimit)));
  }
  const requestedBeforeId = Number(options?.beforeId);
  if (Number.isInteger(requestedBeforeId) && requestedBeforeId > 0) {
    queryParams.set('beforeId', String(Math.floor(requestedBeforeId)));
  }
  if (options && Object.prototype.hasOwnProperty.call(options, 'includeMeta')) {
    queryParams.set('includeMeta', options.includeMeta ? '1' : '0');
  }
  const querySuffix = queryParams.toString() ? `?${queryParams.toString()}` : '';

  const data = await api<{
    conversation: { id: number; title: string; model: string; reasoningEffort: string };
    messages: Message[];
    pagination?: Partial<MessagesPagination> | null;
    liveDraft?: any;
    taskRecovery?: TaskRecovery | null;
  }>(
    `/api/conversations/${conversationId}/messages${querySuffix}`
  );
  const rawPagination = data.pagination && typeof data.pagination === 'object' ? data.pagination : null;
  const pagination: MessagesPagination = {
    limit: Math.max(1, Number(rawPagination?.limit) || 1),
    hasMore: Boolean(rawPagination?.hasMore),
    nextBeforeId: Number.isInteger(Number(rawPagination?.nextBeforeId))
      ? Number(rawPagination?.nextBeforeId)
      : null,
    oldestLoadedId: Number.isInteger(Number(rawPagination?.oldestLoadedId))
      ? Number(rawPagination?.oldestLoadedId)
      : null,
    newestLoadedId: Number.isInteger(Number(rawPagination?.newestLoadedId))
      ? Number(rawPagination?.newestLoadedId)
      : null
  };

  return {
    conversation: data.conversation,
    messages: Array.isArray(data.messages)
      ? data.messages.map((entry: any) => {
          const attachments: MessageAttachment[] = Array.isArray(entry?.attachments)
            ? entry.attachments.map((file: any) => ({
                id: String(file?.id || ''),
                conversationId: Number(file?.conversationId) || 0,
                name: String(file?.name || ''),
                size: Math.max(0, Number(file?.size) || 0),
                mimeType: String(file?.mimeType || 'application/octet-stream'),
                uploadedAt: String(file?.uploadedAt || '')
              }))
            : [];
          return {
            id: Number(entry?.id) || 0,
            role:
              entry?.role === 'assistant' || entry?.role === 'system' || entry?.role === 'user'
                ? entry.role
              : 'assistant',
            content: String(entry?.content || ''),
            created_at: String(entry?.created_at || ''),
            attachments: attachments.filter((file) => Boolean(file.id) && Boolean(file.name))
          } as Message;
        })
      : [],
    pagination,
    liveDraft: data.liveDraft && typeof data.liveDraft === 'object' ? data.liveDraft : null,
    taskRecovery:
      data.taskRecovery && typeof data.taskRecovery === 'object'
        ? (data.taskRecovery as TaskRecovery)
        : null
  };
}

export async function updateConversationSettings(
  conversationId: number,
  payload: { model?: string; reasoningEffort?: string }
): Promise<{ id: number; model: string; reasoningEffort: string }> {
  const data = await api<{ conversation: { id: number; model: string; reasoningEffort: string } }>(
    `/api/conversations/${conversationId}/settings`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  return data.conversation;
}

export async function getChatOptions(): Promise<ChatOptions> {
  const data = await api<ChatOptions & {
    providerId?: string;
    activeAgentId?: string;
    activeAgentName?: string;
    runtimeProvider?: string;
    capabilities?: string[];
    quota?: AiProviderQuota | null;
    permissions?: AiProviderPermissionProfile | null;
  }>('/api/chat/options');
  return {
    models: Array.isArray(data.models) ? data.models.map((item) => String(item || '').trim()).filter(Boolean) : [],
    reasoningEfforts: Array.isArray(data.reasoningEfforts)
      ? data.reasoningEfforts.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaults: {
      model: String(data.defaults?.model || '').trim(),
      reasoningEffort: String(data.defaults?.reasoningEffort || '').trim().toLowerCase()
    },
    providerId: String(data.providerId || '').trim(),
    activeAgentId: String(data.activeAgentId || '').trim(),
    activeAgentName: String(data.activeAgentName || '').trim(),
    runtimeProvider: String(data.runtimeProvider || '').trim(),
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
    quota: data.quota ? normalizeAiProviderQuota(data.quota) : null,
    permissions: data.permissions ? normalizeAiProviderPermissionProfile(data.permissions) : null
  };
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const data = await api<{ notifications: NotificationSettings }>('/api/settings/notifications');
  return data.notifications;
}

export async function updateNotificationSettings(
  payload: Partial<NotificationSettings>
): Promise<NotificationSettings> {
  const data = await api<{ notifications: NotificationSettings }>('/api/settings/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return data.notifications;
}

export async function getAiAgentSettings(): Promise<AiAgentSettingsPayload> {
  const data = await api<{ agents: AiAgentSettingsItem[]; activeAgentId?: string }>('/api/settings/ai-agents');
  return {
    agents: Array.isArray(data.agents) ? data.agents : [],
    activeAgentId: String(data.activeAgentId || '')
  };
}

export async function updateAiAgentSetting(
  agentId: string,
  payload: { enabled?: boolean; apiKey?: string; baseUrl?: string }
): Promise<{ agent: AiAgentSettingsItem; activeAgentId: string }> {
  const data = await api<{ agent: AiAgentSettingsItem; activeAgentId?: string }>(
    `/api/settings/ai-agents/${encodeURIComponent(String(agentId || ''))}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  return {
    agent: data.agent,
    activeAgentId: String(data.activeAgentId || '')
  };
}

export async function updateActiveAiAgentSetting(agentId: string): Promise<{ activeAgentId: string }> {
  const data = await api<{ activeAgentId?: string }>('/api/settings/ai-agents/active', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId })
  });
  return {
    activeAgentId: String(data.activeAgentId || '')
  };
}

export async function listAiProviders(): Promise<{ activeProviderId: string; providers: AiProviderInfo[] }> {
  const data = await api<{ activeProviderId?: string; providers?: any[] }>('/api/ai/providers');
  return {
    activeProviderId: String(data?.activeProviderId || ''),
    providers: Array.isArray(data?.providers) ? data.providers.map((entry) => normalizeAiProviderInfo(entry)) : []
  };
}

export async function getAiProviderQuota(providerId: string): Promise<AiProviderQuota> {
  const data = await api<{ quota: any }>(`/api/ai/providers/${encodeURIComponent(String(providerId || '').trim())}/quota`);
  return normalizeAiProviderQuota(data?.quota);
}

export async function getAiProviderPermissions(providerId: string): Promise<AiProviderPermissionProfile> {
  const data = await api<{ permissions: any }>(
    `/api/ai/providers/${encodeURIComponent(String(providerId || '').trim())}/permissions`
  );
  return normalizeAiProviderPermissionProfile(data?.permissions);
}

export async function updateAiProviderPermissions(
  providerId: string,
  payload: Partial<AiProviderPermissionProfile>
): Promise<AiProviderPermissionProfile> {
  const data = await api<{ permissions: any }>(
    `/api/ai/providers/${encodeURIComponent(String(providerId || '').trim())}/permissions`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  return normalizeAiProviderPermissionProfile(data?.permissions);
}

export async function grantAiProviderFullPermissions(
  providerId: string
): Promise<AiProviderPermissionProfile> {
  const data = await api<{ permissions: any }>(
    `/api/ai/providers/${encodeURIComponent(String(providerId || '').trim())}/permissions/grant-full`,
    {
      method: 'POST'
    }
  );
  return normalizeAiProviderPermissionProfile(data?.permissions);
}

export async function getCodexQuota(): Promise<CodexQuota | null> {
  const data = await api<{ quota: CodexQuota | null }>('/api/codex/quota');
  return data.quota ?? null;
}

export async function getCodexRuns(): Promise<CodexBackgroundRun[]> {
  const data = await api<{ runs: CodexBackgroundRun[] }>('/api/codex/runs');
  return Array.isArray(data.runs) ? data.runs : [];
}

export async function killAllCodexRuns(): Promise<{ active: number; stopped: number }> {
  return api('/api/codex/runs/kill-all', { method: 'POST' });
}

export async function getTaskDashboard(limit = 30): Promise<TaskRunDashboardItem[]> {
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 30;
  const data = await api<{ tasks: TaskRunDashboardItem[] }>(`/api/tasks?limit=${safeLimit}`);
  return Array.isArray(data.tasks) ? data.tasks : [];
}

export async function rollbackTaskRun(
  taskRunId: number
): Promise<{ task: TaskRunDashboardItem; rollback: { restored: number; removed: number; failed: number } }> {
  return api(`/api/tasks/${taskRunId}/rollback`, { method: 'POST' });
}

export async function getUnifiedToolsSearch(query: string, limit = 12): Promise<UnifiedSearchPayload> {
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 40) : 12;
  const encodedQuery = encodeURIComponent(String(query || ''));
  const data = await api<UnifiedSearchPayload>(
    `/api/tools/search?q=${encodedQuery}&limit=${safeLimit}`
  );
  return {
    query: String(data.query || ''),
    minQueryLength: Number(data.minQueryLength) || 2,
    limit: Number(data.limit) || safeLimit,
    counts: {
      chats: Number(data.counts?.chats) || 0,
      commands: Number(data.counts?.commands) || 0,
      errors: Number(data.counts?.errors) || 0,
      files: Number(data.counts?.files) || 0
    },
    results: {
      chats: Array.isArray(data.results?.chats) ? data.results.chats : [],
      commands: Array.isArray(data.results?.commands) ? data.results.commands : [],
      errors: Array.isArray(data.results?.errors) ? data.results.errors : [],
      files: Array.isArray(data.results?.files) ? data.results.files : []
    }
  };
}

export async function getToolsObservability(): Promise<ObservabilitySnapshot> {
  const data = await api<{ observability: ObservabilitySnapshot }>('/api/tools/observability');
  return data.observability;
}

function normalizeToolsDeployedAppDescribeJob(rawValue: any): ToolsDeployedAppDescribeJob {
  const rawResult = rawValue?.result && typeof rawValue.result === 'object' ? rawValue.result : {};
  const descriptions = Array.isArray(rawResult.descriptions)
    ? rawResult.descriptions
        .map((entry: any) => ({
          appId: String(entry?.appId || ''),
          name: String(entry?.name || ''),
          description: String(entry?.description || ''),
          generatedAt: String(entry?.generatedAt || '')
        }))
        .filter((entry) => Boolean(entry.appId) && Boolean(entry.description))
    : [];
  return {
    id: String(rawValue?.id || ''),
    status:
      rawValue?.status === 'running' ||
      rawValue?.status === 'completed' ||
      rawValue?.status === 'error'
        ? rawValue.status
        : 'pending',
    provider: String(rawValue?.provider || ''),
    activeAgentId: String(rawValue?.activeAgentId || ''),
    appIds: Array.isArray(rawValue?.appIds)
      ? rawValue.appIds.map((entry: any) => String(entry || '').trim()).filter(Boolean)
      : [],
    error: String(rawValue?.error || ''),
    createdAt: String(rawValue?.createdAt || ''),
    updatedAt: String(rawValue?.updatedAt || ''),
    startedAt: String(rawValue?.startedAt || ''),
    finishedAt: String(rawValue?.finishedAt || ''),
    result: {
      scannedAt: String(rawResult?.scannedAt || ''),
      generatedAt: String(rawResult?.generatedAt || ''),
      missingAppIds: Array.isArray(rawResult?.missingAppIds)
        ? rawResult.missingAppIds.map((entry: any) => String(entry || '').trim()).filter(Boolean)
        : [],
      descriptions
    }
  };
}

export async function getToolsDeployedApps(forceRefresh = false): Promise<ToolsDeployedAppsPayload> {
  const suffix = forceRefresh ? '?refresh=1' : '';
  const data = await api<{ scannedAt: string; apps: ToolsDeployedAppsPayload['apps'] }>(
    `/api/tools/deployed-apps${suffix}`
  );
  return {
    scannedAt: String(data.scannedAt || ''),
    apps: Array.isArray(data.apps)
      ? data.apps.map((entry: any) => ({
          id: String(entry?.id || ''),
          source:
            entry?.source === 'docker' || entry?.source === 'systemd' || entry?.source === 'pm2'
              ? entry.source
              : 'pm2',
          name: String(entry?.name || ''),
          status:
            entry?.status === 'running' ||
            entry?.status === 'stopped' ||
            entry?.status === 'error'
              ? entry.status
              : 'unknown',
          normalizedStatus:
            entry?.normalizedStatus === 'running' ||
            entry?.normalizedStatus === 'stopped' ||
            entry?.normalizedStatus === 'error'
              ? entry.normalizedStatus
              : 'unknown',
          isRunning: Boolean(entry?.isRunning),
          isStopped: Boolean(entry?.isStopped),
          isSystem: Boolean(entry?.isSystem),
          category:
            entry?.category === 'system' ||
            entry?.category === 'user' ||
            entry?.category === 'docker'
              ? entry.category
              : 'custom',
          searchableText: String(entry?.searchableText || ''),
          descriptionJobStatus:
            entry?.descriptionJobStatus === 'pending' ||
            entry?.descriptionJobStatus === 'running' ||
            entry?.descriptionJobStatus === 'completed' ||
            entry?.descriptionJobStatus === 'error'
              ? entry.descriptionJobStatus
              : 'idle',
          aiDescription: String(entry?.aiDescription || ''),
          aiDescriptionGeneratedAt: String(entry?.aiDescriptionGeneratedAt || ''),
          aiDescriptionProvider: String(entry?.aiDescriptionProvider || ''),
          detailStatus: String(entry?.detailStatus || ''),
          description: String(entry?.description || ''),
          pid: Number.isInteger(Number(entry?.pid)) ? Number(entry.pid) : null,
          location: String(entry?.location || ''),
          uptime: String(entry?.uptime || ''),
          canStart: Boolean(entry?.canStart),
          canStop: Boolean(entry?.canStop),
          canRestart: Boolean(entry?.canRestart),
          hasLogs: Boolean(entry?.hasLogs),
          scannedAt: String(entry?.scannedAt || '')
        }))
      : []
  };
}

export async function actionToolsDeployedApp(
  appId: string,
  action: 'start' | 'stop' | 'restart'
): Promise<ToolsDeployedAppActionResponse> {
  return api(`/api/tools/deployed-apps/${encodeURIComponent(String(appId || ''))}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });
}

export async function getToolsDeployedAppLogs(
  appId: string,
  lines = 180
): Promise<ToolsDeployedAppLogsResponse> {
  const safeLines = Number.isInteger(lines) ? Math.min(Math.max(lines, 20), 1000) : 180;
  return api(`/api/tools/deployed-apps/${encodeURIComponent(String(appId || ''))}/logs?lines=${safeLines}`);
}

export async function describeToolsDeployedApps(
  appIds: string[]
): Promise<ToolsDeployedAppDescribeResponse> {
  const normalized = Array.isArray(appIds)
    ? appIds
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    : [];
  const data = await api<ToolsDeployedAppDescribeResponse>('/api/tools/deployed-apps/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appIds: normalized })
  });
  return {
    scannedAt: String(data?.scannedAt || ''),
    job: normalizeToolsDeployedAppDescribeJob(data?.job)
  };
}

export async function getToolsDeployedAppDescribeJob(jobId: string): Promise<ToolsDeployedAppDescribeJob> {
  const data = await api<{ job: ToolsDeployedAppDescribeJob }>(
    `/api/tools/deployed-apps/describe/${encodeURIComponent(String(jobId || '').trim())}`
  );
  return normalizeToolsDeployedAppDescribeJob(data?.job);
}

function normalizeToolsStorageJob(rawValue: any): ToolsStorageJob {
  return {
    id: String(rawValue?.id || ''),
    type:
      rawValue?.type === 'drive_upload_files' ||
      rawValue?.type === 'dropbox_upload_files' ||
      rawValue?.type === 'deployed_backup_create' ||
      rawValue?.type === 'deployed_backup_restore'
        ? rawValue.type
        : 'dropbox_upload_files',
    status:
      rawValue?.status === 'running' ||
      rawValue?.status === 'completed' ||
      rawValue?.status === 'error'
        ? rawValue.status
        : 'pending',
    payload: rawValue?.payload && typeof rawValue.payload === 'object' ? rawValue.payload : {},
    progress: rawValue?.progress && typeof rawValue.progress === 'object' ? rawValue.progress : {},
    result: rawValue?.result && typeof rawValue.result === 'object' ? rawValue.result : {},
    error: String(rawValue?.error || ''),
    log: String(rawValue?.log || ''),
    createdAt: String(rawValue?.createdAt || ''),
    updatedAt: String(rawValue?.updatedAt || ''),
    startedAt: String(rawValue?.startedAt || ''),
    finishedAt: String(rawValue?.finishedAt || '')
  };
}

function normalizeToolsDriveAccount(rawValue: any): ToolsDriveAccount {
  return {
    id: String(rawValue?.id || ''),
    alias: String(rawValue?.alias || ''),
    authMode: rawValue?.authMode === 'oauth_app' ? 'oauth_app' : 'token',
    rootFolderId: String(rawValue?.rootFolderId || 'root'),
    status:
      rawValue?.status === 'active' ||
      rawValue?.status === 'needs_oauth' ||
      rawValue?.status === 'error'
        ? rawValue.status
        : 'pending',
    lastError: String(rawValue?.lastError || ''),
    details: {
      credentialType: String(rawValue?.details?.credentialType || ''),
      projectId: String(rawValue?.details?.projectId || ''),
      clientEmail: String(rawValue?.details?.clientEmail || ''),
      clientId: String(rawValue?.details?.clientId || ''),
      redirectUris: Array.isArray(rawValue?.details?.redirectUris)
        ? rawValue.details.redirectUris.map((entry: any) => String(entry || '')).filter(Boolean)
        : []
    },
    createdAt: String(rawValue?.createdAt || ''),
    updatedAt: String(rawValue?.updatedAt || '')
  };
}

export async function getToolsStorageLocalList(payload: {
  path: string;
  sortBy?: 'name' | 'size' | 'mtime';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  includeDirSize?: boolean;
}): Promise<ToolsStorageLocalListPayload> {
  const params = new URLSearchParams();
  params.set('path', String(payload.path || ''));
  if (payload.sortBy) params.set('sortBy', payload.sortBy);
  if (payload.sortOrder) params.set('sortOrder', payload.sortOrder);
  if (Number.isInteger(Number(payload.limit))) params.set('limit', String(payload.limit));
  if (payload.includeDirSize === false) params.set('includeDirSize', '0');
  const data = await api<ToolsStorageLocalListPayload>(`/api/tools/storage/local/list?${params.toString()}`);
  return {
    path: String(data?.path || ''),
    parentPath: String(data?.parentPath || ''),
    sortBy:
      data?.sortBy === 'size' || data?.sortBy === 'mtime'
        ? data.sortBy
        : 'name',
    sortOrder: data?.sortOrder === 'asc' ? 'asc' : 'desc',
    totalEntries: Math.max(0, Number(data?.totalEntries) || 0),
    entries: Array.isArray(data?.entries)
      ? data.entries.map((entry: any) => ({
          name: String(entry?.name || ''),
          path: String(entry?.path || ''),
          type:
            entry?.type === 'directory' ||
            entry?.type === 'symlink' ||
            entry?.type === 'other'
              ? entry.type
              : 'file',
          sizeBytes: Number.isFinite(Number(entry?.sizeBytes)) ? Number(entry.sizeBytes) : null,
          modifiedAt: String(entry?.modifiedAt || '')
        }))
      : []
  };
}

export async function getToolsStorageHeavy(payload: {
  path: string;
  limit?: number;
  maxDepth?: number;
}): Promise<ToolsStorageHeavyPayload> {
  const params = new URLSearchParams();
  params.set('path', String(payload.path || ''));
  if (Number.isInteger(Number(payload.limit))) params.set('limit', String(payload.limit));
  if (Number.isInteger(Number(payload.maxDepth))) params.set('maxDepth', String(payload.maxDepth));
  const data = await api<ToolsStorageHeavyPayload>(`/api/tools/storage/local/heavy?${params.toString()}`);
  return {
    path: String(data?.path || ''),
    scannedAt: String(data?.scannedAt || ''),
    maxDepth: Number(data?.maxDepth) || 0,
    limit: Number(data?.limit) || 0,
    totalBytes: Number(data?.totalBytes) || 0,
    entries: Array.isArray(data?.entries)
      ? data.entries.map((entry: any) => ({
          path: String(entry?.path || ''),
          name: String(entry?.name || ''),
          type: entry?.type === 'directory' ? 'directory' : entry?.type === 'other' ? 'other' : 'file',
          sizeBytes: Number(entry?.sizeBytes) || 0
        }))
      : []
  };
}

export async function moveToolsStoragePaths(payload: {
  paths: string[];
  destinationDir: string;
}): Promise<{ destinationDir: string; moved: Array<{ sourcePath: string; targetPath: string }>; failed: Array<{ sourcePath: string; error: string }> }> {
  return api('/api/tools/storage/local/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function compressToolsStoragePaths(payload: {
  paths: string[];
  archiveName?: string;
  destinationDir?: string;
}): Promise<{ archive: { path: string; name: string; sizeBytes: number; createdAt: string } }> {
  return api('/api/tools/storage/local/compress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function getToolsStorageOverview(
  accountId = '',
  pathValue = ''
): Promise<ToolsStorageOverview> {
  const params = new URLSearchParams();
  if (accountId) params.set('accountId', accountId);
  if (pathValue) params.set('path', pathValue);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api<ToolsStorageOverview>(`/api/tools/storage/overview${suffix}`);
  return {
    localDisk: {
      path: String(data?.localDisk?.path || ''),
      totalBytes: Number.isFinite(Number(data?.localDisk?.totalBytes)) ? Number(data.localDisk.totalBytes) : null,
      usedBytes: Number.isFinite(Number(data?.localDisk?.usedBytes)) ? Number(data.localDisk.usedBytes) : null,
      availableBytes: Number.isFinite(Number(data?.localDisk?.availableBytes)) ? Number(data.localDisk.availableBytes) : null,
      usagePercent: String(data?.localDisk?.usagePercent || '')
    },
    cloud: {
      accountId: String(data?.cloud?.accountId || ''),
      available: Boolean(data?.cloud?.available),
      error: String((data as any)?.cloud?.error || ''),
      quota: {
        limit: Number.isFinite(Number(data?.cloud?.quota?.limit)) ? Number(data.cloud.quota.limit) : null,
        usage: Number.isFinite(Number(data?.cloud?.quota?.usage)) ? Number(data.cloud.quota.usage) : null,
        usageInDrive: Number.isFinite(Number(data?.cloud?.quota?.usageInDrive)) ? Number(data.cloud.quota.usageInDrive) : null
      }
    },
    jobs: Array.isArray(data?.jobs) ? data.jobs.map((row: any) => normalizeToolsStorageJob(row)) : []
  };
}

export async function getToolsStorageJobs(limit = 40): Promise<ToolsStorageJob[]> {
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 120) : 40;
  const data = await api<{ jobs: ToolsStorageJob[] }>(`/api/tools/storage/jobs?limit=${safeLimit}`);
  return Array.isArray(data?.jobs) ? data.jobs.map((row: any) => normalizeToolsStorageJob(row)) : [];
}

export async function getToolsStorageJob(jobId: string): Promise<ToolsStorageJob> {
  const data = await api<{ job: ToolsStorageJob }>(
    `/api/tools/storage/jobs/${encodeURIComponent(String(jobId || '').trim())}`
  );
  return normalizeToolsStorageJob(data?.job);
}

export async function listToolsDriveAccounts(): Promise<ToolsDriveAccount[]> {
  const data = await api<{ accounts: ToolsDriveAccount[] }>('/api/tools/storage/dropbox/accounts');
  return Array.isArray(data?.accounts) ? data.accounts.map((row: any) => normalizeToolsDriveAccount(row)) : [];
}

export async function createToolsDriveAccount(payload: {
  alias: string;
  rootFolderId?: string;
  credentialsJson: Record<string, any> | string;
}): Promise<ToolsDriveAccount> {
  const data = await api<{ account: ToolsDriveAccount }>('/api/tools/storage/dropbox/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return normalizeToolsDriveAccount(data?.account);
}

export async function validateToolsDriveAccount(accountId: string): Promise<{
  account: ToolsDriveAccount;
  about: { email: string; displayName: string; quota: { limit: number | null; usage: number | null; usageInDrive: number | null } };
}> {
  const data = await api<{
    account: ToolsDriveAccount;
    about: { email: string; displayName: string; quota: { limit: number | null; usage: number | null; usageInDrive: number | null } };
  }>(
    `/api/tools/storage/dropbox/accounts/${encodeURIComponent(String(accountId || '').trim())}/validate`,
    { method: 'POST' }
  );
  return {
    account: normalizeToolsDriveAccount(data?.account),
    about: data.about
  };
}

export async function startToolsDriveOauth(accountId: string, redirectUri = ''): Promise<{
  account: ToolsDriveAccount;
  oauth: { authUrl: string; redirectUri: string; instructions: string };
}> {
  const data = await api<{
    account: ToolsDriveAccount;
    oauth: { authUrl: string; redirectUri: string; instructions: string };
  }>(
    `/api/tools/storage/dropbox/accounts/${encodeURIComponent(String(accountId || '').trim())}/oauth/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUri })
    }
  );
  return {
    account: normalizeToolsDriveAccount(data?.account),
    oauth: {
      authUrl: String(data?.oauth?.authUrl || ''),
      redirectUri: String(data?.oauth?.redirectUri || ''),
      instructions: String(data?.oauth?.instructions || '')
    }
  };
}

export async function completeToolsDriveOauth(payload: {
  accountId: string;
  code: string;
  redirectUri?: string;
}): Promise<{ account: ToolsDriveAccount }> {
  const data = await api<{ account: ToolsDriveAccount }>(
    `/api/tools/storage/dropbox/accounts/${encodeURIComponent(String(payload.accountId || '').trim())}/oauth/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: payload.code, redirectUri: payload.redirectUri || '' })
    }
  );
  return {
    account: normalizeToolsDriveAccount(data?.account)
  };
}

export async function deleteToolsDriveAccount(accountId: string): Promise<{ deleted: boolean; accountId: string }> {
  return api(`/api/tools/storage/dropbox/accounts/${encodeURIComponent(String(accountId || '').trim())}`, {
    method: 'DELETE'
  });
}

export async function listToolsDriveFiles(payload: {
  accountId: string;
  folderId?: string;
  pageToken?: string;
  query?: string;
}): Promise<ToolsDriveFilesPayload> {
  const params = new URLSearchParams();
  params.set('accountId', String(payload.accountId || ''));
  if (payload.folderId) params.set('folderId', String(payload.folderId));
  if (payload.pageToken) params.set('pageToken', String(payload.pageToken));
  if (payload.query) params.set('query', String(payload.query));
  const data = await api<ToolsDriveFilesPayload>(`/api/tools/storage/dropbox/files?${params.toString()}`);
  return {
    account: normalizeToolsDriveAccount(data?.account),
    folderId: String(data?.folderId || ''),
    nextPageToken: String(data?.nextPageToken || ''),
    files: Array.isArray(data?.files)
      ? data.files.map((file: any) => ({
          id: String(file?.id || ''),
          name: String(file?.name || ''),
          mimeType: String(file?.mimeType || ''),
          sizeBytes: Number.isFinite(Number(file?.sizeBytes)) ? Number(file.sizeBytes) : null,
          createdAt: String(file?.createdAt || ''),
          modifiedAt: String(file?.modifiedAt || ''),
          parents: Array.isArray(file?.parents) ? file.parents.map((entry: any) => String(entry || '')).filter(Boolean) : [],
          appProperties:
            file?.appProperties && typeof file.appProperties === 'object'
              ? file.appProperties
              : {}
        }))
      : []
  };
}

export async function uploadToolsDriveFiles(payload: {
  accountId: string;
  paths: string[];
  parentId?: string;
}): Promise<{ job: ToolsStorageJob }> {
  const data = await api<{ job: ToolsStorageJob }>('/api/tools/storage/dropbox/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return {
    job: normalizeToolsStorageJob(data?.job)
  };
}

export async function deleteToolsDriveFile(payload: {
  accountId: string;
  fileId: string;
}): Promise<{ deleted: boolean; fileId: string; account: ToolsDriveAccount }> {
  const data = await api<{ deleted: boolean; fileId: string; account: ToolsDriveAccount }>(
    `/api/tools/storage/dropbox/files/${encodeURIComponent(String(payload.fileId || '').trim())}?accountId=${encodeURIComponent(String(payload.accountId || '').trim())}&confirm=DELETE`,
    {
      method: 'DELETE'
    }
  );
  return {
    deleted: Boolean(data?.deleted),
    fileId: String(data?.fileId || ''),
    account: normalizeToolsDriveAccount(data?.account)
  };
}

export async function listToolsDeployedAppBackups(
  appId: string,
  accountId = ''
): Promise<{ appId: string; accountId: string; retentionDays: number; backups: ToolsDeployedAppBackupItem[]; warning?: string }> {
  const params = new URLSearchParams();
  if (accountId) params.set('accountId', accountId);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api<{
    appId: string;
    accountId: string;
    retentionDays: number;
    backups: ToolsDeployedAppBackupItem[];
    warning?: string;
  }>(
    `/api/tools/deployed-apps/${encodeURIComponent(String(appId || '').trim())}/backups${suffix}`
  );
  return {
    appId: String(data?.appId || appId),
    accountId: String(data?.accountId || accountId),
    retentionDays: Number(data?.retentionDays) || 4,
    backups: Array.isArray(data?.backups)
      ? data.backups.map((entry: any) => ({
          id: String(entry?.id || ''),
          appId: String(entry?.appId || appId),
          driveFileId: String(entry?.driveFileId || ''),
          remoteFileId: String(entry?.remoteFileId || entry?.driveFileId || ''),
          accountId: String(entry?.accountId || ''),
          accountAlias: String(entry?.accountAlias || ''),
          name: String(entry?.name || ''),
          targetPath: String(entry?.targetPath || ''),
          sizeBytes: Number.isFinite(Number(entry?.sizeBytes)) ? Number(entry.sizeBytes) : null,
          createdAt: String(entry?.createdAt || ''),
          modifiedAt: String(entry?.modifiedAt || ''),
          appProperties:
            entry?.appProperties && typeof entry.appProperties === 'object'
              ? entry.appProperties
              : {}
        }))
      : [],
    warning: String(data?.warning || '')
  };
}

export async function createToolsDeployedAppBackup(payload: {
  appId: string;
  accountId: string;
  sourcePath?: string;
  targetPath?: string;
}): Promise<{ appId: string; job: ToolsStorageJob }> {
  const data = await api<{ appId: string; job: ToolsStorageJob }>(
    `/api/tools/deployed-apps/${encodeURIComponent(String(payload.appId || '').trim())}/backups`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  return {
    appId: String(data?.appId || payload.appId),
    job: normalizeToolsStorageJob(data?.job)
  };
}

export async function restoreToolsDeployedAppBackup(payload: {
  appId: string;
  accountId: string;
  fileId: string;
  targetPath?: string;
}): Promise<{ appId: string; job: ToolsStorageJob }> {
  const data = await api<{ appId: string; job: ToolsStorageJob }>(
    `/api/tools/deployed-apps/${encodeURIComponent(String(payload.appId || '').trim())}/restore`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: payload.appId,
        accountId: payload.accountId,
        fileId: payload.fileId,
        targetPath: payload.targetPath || '',
        confirm: 'RESTORE'
      })
    }
  );
  return {
    appId: String(data?.appId || payload.appId),
    job: normalizeToolsStorageJob(data?.job)
  };
}

export async function getToolsGitRepos(forceRefresh = false): Promise<ToolsGitReposPayload> {
  const suffix = forceRefresh ? '?refresh=1' : '';
  const data = await api<{ scannedAt: string; repos: ToolsGitRepoSummary[] }>(`/api/tools/git/repos${suffix}`);
  return {
    scannedAt: String(data.scannedAt || ''),
    repos: Array.isArray(data.repos)
      ? data.repos.map((repo: any) => ({
          ...repo,
          branches: Array.isArray(repo?.branches)
            ? repo.branches.map((entry: any) => String(entry || '').trim()).filter(Boolean)
            : []
        }))
      : []
  };
}

export async function pushToolsGitRepo(
  repoId: string,
  payload?: { commitMessage?: string; branch?: string; createBranch?: boolean; remote?: string }
): Promise<{ repo: ToolsGitRepoSummary; push: ToolsGitPushResult }> {
  return api(`/api/tools/git/repos/${encodeURIComponent(String(repoId || ''))}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commitMessage: String(payload?.commitMessage || ''),
      branch: String(payload?.branch || ''),
      createBranch: Boolean(payload?.createBranch),
      remote: String(payload?.remote || '')
    })
  });
}

export async function getToolsGitBranches(repoId: string): Promise<ToolsGitBranchesPayload> {
  const data = await api<ToolsGitBranchesPayload>(
    `/api/tools/git/repos/${encodeURIComponent(String(repoId || ''))}/branches`
  );
  return {
    repo: {
      ...data.repo,
      branches: Array.isArray(data?.repo?.branches)
        ? data.repo.branches.map((entry: any) => String(entry || '').trim()).filter(Boolean)
        : []
    },
    branches: Array.isArray(data?.branches)
      ? data.branches.map((entry: any) => String(entry || '').trim()).filter(Boolean)
      : []
  };
}

export async function checkoutToolsGitBranch(
  repoId: string,
  payload: { branch: string; create?: boolean }
): Promise<{ repo: ToolsGitRepoSummary; branch: string; created: boolean; output: string }> {
  return api(`/api/tools/git/repos/${encodeURIComponent(String(repoId || ''))}/branches/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function mergeToolsGitBranches(
  repoId: string,
  payload: { sourceBranch: string; targetBranch: string }
): Promise<{ repo: ToolsGitRepoSummary; merge?: ToolsGitMergePayload }> {
  return api(`/api/tools/git/repos/${encodeURIComponent(String(repoId || ''))}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function resolveToolsGitConflicts(
  repoId: string
): Promise<{ repo: ToolsGitRepoSummary; resolver: ToolsGitResolvePayload }> {
  return api(`/api/tools/git/repos/${encodeURIComponent(String(repoId || ''))}/resolve-conflicts`, {
    method: 'POST'
  });
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
  const data = await api<{ auth: CodexAuthStatus }>('/api/codex/auth/status');
  return data.auth;
}

export async function startCodexDeviceLogin(): Promise<CodexAuthStatus['login']> {
  const data = await api<{ login: CodexAuthStatus['login'] }>('/api/codex/auth/device/start', {
    method: 'POST'
  });
  return data.login ?? null;
}

export async function cancelCodexDeviceLogin(): Promise<{ cancelled: boolean; reason?: string }> {
  return api('/api/codex/auth/device/cancel', { method: 'POST' });
}

export async function logoutCodexAuth(): Promise<void> {
  await api('/api/codex/auth/logout', { method: 'POST' });
}

export async function listAttachments(limit = 200): Promise<AttachmentItem[]> {
  const data = await api<{ attachments: AttachmentItem[] }>(`/api/attachments?limit=${limit}`);
  return Array.isArray(data.attachments) ? data.attachments : [];
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  await api(`/api/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' });
}

export async function uploadAttachment(
  file: File,
  conversationId: number | null,
  signal?: AbortSignal,
  onProgress?: (progress: { loaded: number; total: number }) => void
): Promise<{ uploadId: string }> {
  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
    'X-File-Name': encodeURIComponent(file.name || 'file'),
    'X-File-Type': file.type || 'application/octet-stream'
  };
  if (conversationId && Number.isInteger(conversationId) && conversationId > 0) {
    headers['X-Conversation-Id'] = String(conversationId);
  }

  return new Promise<{ uploadId: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const defaultTotal = Math.max(0, Number(file.size) || 0);
    let settled = false;
    let handleAbortSignal = () => {};

    const settleResolve = (value: { uploadId: string }) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', handleAbortSignal);
      resolve(value);
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', handleAbortSignal);
      reject(error);
    };

    handleAbortSignal = () => {
      xhr.abort();
      settleReject(new DOMException('The operation was aborted.', 'AbortError'));
    };

    if (signal?.aborted) {
      handleAbortSignal();
      return;
    }

    if (signal) {
      signal.addEventListener('abort', handleAbortSignal, { once: true });
    }

    xhr.open('POST', '/api/uploads', true);
    xhr.withCredentials = true;
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    if (onProgress) {
      onProgress({ loaded: 0, total: defaultTotal });
    }

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      const loaded = Math.max(0, Number(event.loaded) || 0);
      const totalCandidate = Math.max(0, Number(event.total) || 0);
      onProgress({
        loaded,
        total: totalCandidate > 0 ? totalCandidate : Math.max(defaultTotal, loaded)
      });
    };

    xhr.onerror = () => {
      settleReject(new Error(`No se pudo subir ${file.name}`));
    };

    xhr.onabort = () => {
      settleReject(new DOMException('The operation was aborted.', 'AbortError'));
    };

    xhr.onload = () => {
      let data: any = {};
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch (_error) {
        data = {};
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        settleReject(new Error(data?.error || `No se pudo subir ${file.name}`));
        return;
      }

      const uploadId = data?.attachment?.uploadId;
      if (!uploadId) {
        settleReject(new Error(`Respuesta invalida al subir ${file.name}`));
        return;
      }

      if (onProgress) {
        const completed = Math.max(defaultTotal, Number(file.size) || 0);
        onProgress({
          loaded: completed,
          total: completed
        });
      }

      settleResolve({ uploadId: String(uploadId) });
    };

    xhr.send(file);
  });
}

export async function restartServer(): Promise<{ attemptId: string }> {
  return api('/api/restart', { method: 'POST' });
}

export async function getRestartStatus(): Promise<RestartState> {
  const data = await api<{ restart: RestartState }>('/api/restart/status');
  return data.restart;
}

export async function startChatStream(payload: {
  message: string;
  model: string;
  reasoningEffort: string;
  conversationId: number | null;
  attachments: Array<{ uploadId: string }>;
  signal: AbortSignal;
}): Promise<Response> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: payload.message,
      model: payload.model,
      reasoningEffort: payload.reasoningEffort,
      conversationId: payload.conversationId,
      attachments: payload.attachments
    }),
    signal: payload.signal
  });

  if (!response.ok) {
    const data = await parseJsonSafe(response);
    throw new Error(data?.error || `No se pudo enviar el mensaje (${response.status})`);
  }

  return response;
}
