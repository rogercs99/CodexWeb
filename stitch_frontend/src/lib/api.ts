import type {
  AiProviderInfo,
  AiProviderPermissionProfile,
  AiProviderQuota,
  AiAgentSettingsItem,
  AiAgentSettingsPayload,
  AttachmentUploadPreflight,
  AttachmentItem,
  ChatProject,
  ChatProjectRef,
  CodexBackgroundRun,
  CodexAuthStatus,
  ChatOptions,
  CodexQuota,
  NotificationSettings,
  Conversation,
  MessagesPagination,
  MessageAttachment,
  Message,
  ConversationProjectContext,
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
  ToolsStorageResidualAnalysis,
  ToolsStorageResidualCandidate,
  ToolsWireGuardDiagnostics,
  ToolsWireGuardPeer,
  ToolsWireGuardPeerProfile,
  ToolsWireGuardStatus,
  RestartState,
  StorageHealthSnapshot,
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

function parseContentDispositionFileName(rawValue: string): string {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  const utf8Match = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(String(utf8Match[1]).trim().replace(/^"|"$/g, ''));
    } catch (_error) {
      // ignore malformed filename*
    }
  }
  const basicMatch = value.match(/filename\s*=\s*"([^"]+)"/i) || value.match(/filename\s*=\s*([^;]+)/i);
  if (!basicMatch || !basicMatch[1]) return '';
  return String(basicMatch[1]).trim().replace(/^"|"$/g, '');
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
  const accessModeRaw = String(rawValue?.accessMode || '').trim().toLowerCase();
  const normalizedAccessMode =
    accessModeRaw === 'full_access' ||
    accessModeRaw === 'workspace_only' ||
    accessModeRaw === 'restricted_paths' ||
    accessModeRaw === 'read_only'
      ? (accessModeRaw as AiProviderPermissionProfile['accessMode'])
      : Boolean(rawValue?.readOnly)
        ? 'read_only'
        : Boolean(rawValue?.allowRoot) && Array.isArray(rawValue?.allowedPaths) && rawValue.allowedPaths.includes('/')
          ? 'full_access'
          : 'restricted_paths';
  return {
    agentId: String(rawValue?.agentId || ''),
    accessMode: normalizedAccessMode,
    allowRoot: Boolean(rawValue?.allowRoot),
    runAsUser: String(rawValue?.runAsUser || ''),
    allowedPaths: Array.isArray(rawValue?.allowedPaths)
      ? rawValue.allowedPaths.map((entry: any) => String(entry || '')).filter(Boolean)
      : ['/'],
    deniedPaths: Array.isArray(rawValue?.deniedPaths)
      ? rawValue.deniedPaths.map((entry: any) => String(entry || '')).filter(Boolean)
      : [],
    canWriteFiles: Boolean(
      rawValue?.canWriteFiles ?? (rawValue?.readOnly ? false : true)
    ),
    readOnly: Boolean(rawValue?.readOnly),
    allowShell: Boolean(rawValue?.allowShell),
    allowSensitiveTools: Boolean(rawValue?.allowSensitiveTools),
    allowNetwork: Boolean(rawValue?.allowNetwork),
    allowGit: Boolean(rawValue?.allowGit),
    allowBackupRestore: Boolean(rawValue?.allowBackupRestore),
    allowedTools: Array.isArray(rawValue?.allowedTools)
      ? rawValue.allowedTools.map((entry: any) => String(entry || '').trim().toLowerCase()).filter(Boolean)
      : ['chat', 'git', 'storage', 'drive', 'backups', 'deployments', 'shell', 'wireguard'],
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

function normalizeProjectContextMode(rawValue: any): 'manual' | 'automatic' | 'mixed' {
  const value = String(rawValue || '').trim().toLowerCase();
  if (value === 'manual' || value === 'automatic') return value;
  return 'mixed';
}

function normalizeChatProjectRef(rawValue: any): ChatProjectRef | null {
  const id = Number(rawValue?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    name: String(rawValue?.name || '').trim() || `Proyecto ${id}`,
    contextMode: normalizeProjectContextMode(rawValue?.contextMode),
    autoContextEnabled: Boolean(rawValue?.autoContextEnabled)
  };
}

function normalizeChatProject(rawValue: any): ChatProject | null {
  const base = normalizeChatProjectRef(rawValue);
  if (!base) return null;
  return {
    ...base,
    manualContext: String(rawValue?.manualContext || ''),
    autoContext: String(rawValue?.autoContext || ''),
    manualContextPreview: String(rawValue?.manualContextPreview || ''),
    autoContextPreview: String(rawValue?.autoContextPreview || ''),
    autoUpdatedAt: String(rawValue?.autoUpdatedAt || ''),
    createdAt: String(rawValue?.createdAt || ''),
    updatedAt: String(rawValue?.updatedAt || ''),
    autoLastMessageId: Number.isInteger(Number(rawValue?.autoLastMessageId))
      ? Number(rawValue.autoLastMessageId)
      : 0,
    autoMeta: rawValue?.autoMeta && typeof rawValue.autoMeta === 'object' ? rawValue.autoMeta : {},
    stats: {
      chatCount: Math.max(0, Number(rawValue?.stats?.chatCount) || 0),
      lastMessageAt: String(rawValue?.stats?.lastMessageAt || '')
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

export async function listConversations(options?: {
  scope?: 'all' | 'unassigned' | 'project';
  projectId?: number | null;
}): Promise<Conversation[]> {
  const query = new URLSearchParams();
  const scope = String(options?.scope || '').trim().toLowerCase();
  if (scope === 'all' || scope === 'unassigned' || scope === 'project') {
    query.set('scope', scope);
  }
  if (Number.isInteger(Number(options?.projectId)) && Number(options?.projectId) > 0) {
    query.set('projectId', String(Number(options?.projectId)));
  }
  const querySuffix = query.toString() ? `?${query.toString()}` : '';
  const data = await api<{ conversations: any[] }>(`/api/conversations${querySuffix}`);
  return Array.isArray(data.conversations)
    ? data.conversations.map((entry: any) => {
        const project = normalizeChatProjectRef(entry?.project);
        return {
          id: Number(entry?.id) || 0,
          projectId:
            Number.isInteger(Number(entry?.projectId)) && Number(entry?.projectId) > 0
              ? Number(entry.projectId)
              : project
                ? project.id
                : null,
          project,
          title: String(entry?.title || ''),
          model: String(entry?.model || ''),
          reasoningEffort: String(entry?.reasoningEffort || ''),
          created_at: String(entry?.created_at || ''),
          last_message_at: String(entry?.last_message_at || ''),
          liveDraftOpen: Boolean(entry?.liveDraftOpen),
          liveDraftUpdatedAt: String(entry?.liveDraftUpdatedAt || '')
        } as Conversation;
      })
    : [];
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

export async function listProjects(): Promise<{ projects: ChatProject[]; unassignedCount: number }> {
  const data = await api<{ projects?: any[]; unassignedCount?: number }>('/api/projects');
  return {
    projects: Array.isArray(data?.projects)
      ? data.projects
          .map((entry: any) => normalizeChatProject(entry))
          .filter((entry): entry is ChatProject => Boolean(entry))
      : [],
    unassignedCount: Math.max(0, Number(data?.unassignedCount) || 0)
  };
}

export async function createProject(payload: {
  name: string;
  contextMode: 'manual' | 'automatic' | 'mixed';
  autoContextEnabled?: boolean;
  manualContext?: string;
}): Promise<ChatProject> {
  const data = await api<{ project: any }>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const project = normalizeChatProject(data?.project);
  if (!project) {
    throw new Error('Proyecto inválido en respuesta');
  }
  return project;
}

export async function updateProject(
  projectId: number,
  payload: {
    name?: string;
    contextMode?: 'manual' | 'automatic' | 'mixed';
    autoContextEnabled?: boolean;
    manualContext?: string;
  }
): Promise<ChatProject> {
  const data = await api<{ project: any }>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const project = normalizeChatProject(data?.project);
  if (!project) {
    throw new Error('Proyecto inválido en respuesta');
  }
  return project;
}

export async function deleteProject(projectId: number): Promise<{ projectId: number; detachedChats: number }> {
  const data = await api<{ deleted?: { projectId: number; detachedChats: number } }>(`/api/projects/${projectId}`, {
    method: 'DELETE'
  });
  return {
    projectId: Number(data?.deleted?.projectId) || projectId,
    detachedChats: Math.max(0, Number(data?.deleted?.detachedChats) || 0)
  };
}

export async function regenerateProjectContext(projectId: number): Promise<{ project: ChatProject; jobId: string }> {
  const data = await api<{ project: any; job?: { id?: string } | null }>(`/api/projects/${projectId}/regenerate-context`, {
    method: 'POST'
  });
  const project = normalizeChatProject(data?.project);
  if (!project) {
    throw new Error('Proyecto inválido en respuesta');
  }
  return {
    project,
    jobId: String(data?.job?.id || '')
  };
}

export async function moveConversationToProject(
  conversationId: number,
  projectId: number | null
): Promise<{ id: number; projectId: number | null; project: ChatProjectRef | null }> {
  const data = await api<{ conversation?: any }>(`/api/conversations/${conversationId}/project`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId })
  });
  const project = normalizeChatProjectRef(data?.conversation?.project);
  return {
    id: Number(data?.conversation?.id) || conversationId,
    projectId:
      Number.isInteger(Number(data?.conversation?.projectId)) && Number(data?.conversation?.projectId) > 0
        ? Number(data?.conversation?.projectId)
        : null,
    project
  };
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
  conversation: {
    id: number;
    title: string;
    model: string;
    reasoningEffort: string;
    projectId: number | null;
    project: ChatProjectRef | null;
  };
  projectContext: ConversationProjectContext | null;
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
    conversation: {
      id: number;
      title: string;
      model: string;
      reasoningEffort: string;
      projectId?: number | null;
      project?: any;
    };
    projectContext?: any;
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

  const projectRef = normalizeChatProjectRef(data?.conversation?.project);
  const projectContextRaw = data?.projectContext;
  const projectContext: ConversationProjectContext | null =
    projectContextRaw && typeof projectContextRaw === 'object'
      ? {
          projectId: Number(projectContextRaw.projectId) || 0,
          projectName: String(projectContextRaw.projectName || ''),
          mode: normalizeProjectContextMode(projectContextRaw.mode),
          autoEnabled: Boolean(projectContextRaw.autoEnabled),
          manualContext: String(projectContextRaw.manualContext || ''),
          autoContext: String(projectContextRaw.autoContext || ''),
          effectiveContext: String(projectContextRaw.effectiveContext || ''),
          manualUsed: Boolean(projectContextRaw.manualUsed),
          autoUsed: Boolean(projectContextRaw.autoUsed),
          autoUpdatedAt: String(projectContextRaw.autoUpdatedAt || ''),
          autoMeta:
            projectContextRaw.autoMeta && typeof projectContextRaw.autoMeta === 'object'
              ? projectContextRaw.autoMeta
              : {}
        }
      : null;

  return {
    conversation: {
      id: Number(data?.conversation?.id) || conversationId,
      title: String(data?.conversation?.title || ''),
      model: String(data?.conversation?.model || ''),
      reasoningEffort: String(data?.conversation?.reasoningEffort || ''),
      projectId:
        Number.isInteger(Number(data?.conversation?.projectId)) && Number(data?.conversation?.projectId) > 0
          ? Number(data?.conversation?.projectId)
          : projectRef
            ? projectRef.id
            : null,
      project: projectRef
    },
    projectContext,
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
      rawValue?.type === 'cleanup_residual_analyze' ||
      rawValue?.type === 'drive_upload_files' ||
      rawValue?.type === 'deployed_backup_create' ||
      rawValue?.type === 'deployed_backup_restore' ||
      rawValue?.type === 'git_merge_branches' ||
      rawValue?.type === 'local_delete_paths' ||
      rawValue?.type === 'project_context_refresh'
        ? rawValue.type
      : 'drive_upload_files',
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
    authMode: 'rclone',
    rootFolderId: String(rawValue?.rootFolderId || 'root'),
    status:
      rawValue?.status === 'active' ||
      rawValue?.status === 'error'
        ? rawValue.status
        : 'pending',
    lastError: String(rawValue?.lastError || ''),
    details: {
      remoteName: String(rawValue?.details?.remoteName || ''),
      configPath: String(rawValue?.details?.configPath || ''),
      rootPath: String(rawValue?.details?.rootPath || ''),
      provider: String(rawValue?.details?.provider || 'rclone'),
      connectionState:
        rawValue?.details?.connectionState === 'active' ||
        rawValue?.details?.connectionState === 'invalid' ||
        rawValue?.details?.connectionState === 'pending'
          ? rawValue.details.connectionState
          : 'unknown',
      validatedAt: String(rawValue?.details?.validatedAt || ''),
      about: {
        limit: Number.isFinite(Number(rawValue?.details?.about?.limit)) ? Number(rawValue.details.about.limit) : null,
        usage: Number.isFinite(Number(rawValue?.details?.about?.usage)) ? Number(rawValue.details.about.usage) : null,
        usageInDrive: Number.isFinite(Number(rawValue?.details?.about?.usageInDrive))
          ? Number(rawValue.details.about.usageInDrive)
          : null,
        free: Number.isFinite(Number(rawValue?.details?.about?.free)) ? Number(rawValue.details.about.free) : null
      }
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

export async function deleteToolsStorageLocalPaths(payload: {
  paths: string[];
  confirmText: string;
}): Promise<{ job: ToolsStorageJob }> {
  const data = await api<{ job: ToolsStorageJob }>('/api/tools/storage/local/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return {
    job: normalizeToolsStorageJob(data?.job)
  };
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

export async function getToolsDriveRcloneStatus(configPath = ''): Promise<{
  binary: string;
  configPath: string;
  configExists: boolean;
  remotes: string[];
  defaultRemote: string;
  defaultRootPath: string;
}> {
  const params = new URLSearchParams();
  if (configPath) params.set('configPath', String(configPath));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api<{
    rclone: {
      binary: string;
      configPath: string;
      configExists: boolean;
      remotes: string[];
      defaultRemote: string;
      defaultRootPath: string;
    };
  }>(`/api/tools/storage/drive/rclone/status${suffix}`);
  return {
    binary: String(data?.rclone?.binary || 'rclone'),
    configPath: String(data?.rclone?.configPath || ''),
    configExists: Boolean(data?.rclone?.configExists),
    remotes: Array.isArray(data?.rclone?.remotes)
      ? data.rclone.remotes.map((entry: any) => String(entry || '').trim()).filter(Boolean)
      : [],
    defaultRemote: String(data?.rclone?.defaultRemote || ''),
    defaultRootPath: String(data?.rclone?.defaultRootPath || '')
  };
}

export async function createToolsDriveRcloneRemote(payload: {
  remoteName: string;
  configPath?: string;
  scope?: string;
  authMode?: 'none' | 'service_account' | 'oauth_token';
  clientId?: string;
  clientSecret?: string;
  tokenJson?: string;
  serviceAccountJson?: string;
  rootFolderId?: string;
  teamDrive?: string;
}): Promise<{
  remote: {
    remoteName: string;
    configPath: string;
    authMode: string;
    scope: string;
    rootFolderId: string;
    teamDrive: string;
    remotes: string[];
  };
}> {
  const data = await api<{
    remote: {
      remoteName: string;
      configPath: string;
      authMode: string;
      scope: string;
      rootFolderId: string;
      teamDrive: string;
      remotes: string[];
    };
  }>('/api/tools/storage/drive/rclone/remotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return {
    remote: {
      remoteName: String(data?.remote?.remoteName || ''),
      configPath: String(data?.remote?.configPath || ''),
      authMode: String(data?.remote?.authMode || 'none'),
      scope: String(data?.remote?.scope || 'drive'),
      rootFolderId: String(data?.remote?.rootFolderId || ''),
      teamDrive: String(data?.remote?.teamDrive || ''),
      remotes: Array.isArray(data?.remote?.remotes)
        ? data.remote.remotes.map((entry: any) => String(entry || '').trim()).filter(Boolean)
        : []
    }
  };
}

export async function deleteToolsDriveRcloneRemote(remoteName: string, configPath = ''): Promise<{
  deleted: boolean;
  remoteName: string;
  rclone: {
    binary: string;
    configPath: string;
    configExists: boolean;
    remotes: string[];
    defaultRemote: string;
    defaultRootPath: string;
  };
}> {
  const params = new URLSearchParams();
  if (configPath) params.set('configPath', configPath);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api<{
    deleted: boolean;
    remoteName: string;
    rclone: {
      binary: string;
      configPath: string;
      configExists: boolean;
      remotes: string[];
      defaultRemote: string;
      defaultRootPath: string;
    };
  }>(`/api/tools/storage/drive/rclone/remotes/${encodeURIComponent(String(remoteName || '').trim())}${suffix}`, {
    method: 'DELETE'
  });
  return {
    deleted: Boolean(data?.deleted),
    remoteName: String(data?.remoteName || ''),
    rclone: {
      binary: String(data?.rclone?.binary || ''),
      configPath: String(data?.rclone?.configPath || ''),
      configExists: Boolean(data?.rclone?.configExists),
      remotes: Array.isArray(data?.rclone?.remotes)
        ? data.rclone.remotes.map((entry: any) => String(entry || '').trim()).filter(Boolean)
        : [],
      defaultRemote: String(data?.rclone?.defaultRemote || ''),
      defaultRootPath: String(data?.rclone?.defaultRootPath || '')
    }
  };
}

export async function validateToolsDriveRcloneRemote(remoteName: string, configPath = ''): Promise<{
  remoteName: string;
  configPath: string;
  about: Record<string, any>;
}> {
  const params = new URLSearchParams();
  if (configPath) params.set('configPath', configPath);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api<{
    validation: {
      remoteName: string;
      configPath: string;
      about: Record<string, any>;
    };
  }>(
    `/api/tools/storage/drive/rclone/remotes/${encodeURIComponent(String(remoteName || '').trim())}/validate${suffix}`,
    {
      method: 'POST'
    }
  );
  return {
    remoteName: String(data?.validation?.remoteName || ''),
    configPath: String(data?.validation?.configPath || ''),
    about:
      data?.validation?.about && typeof data.validation.about === 'object'
        ? data.validation.about
        : {}
  };
}

export async function listToolsDriveAccounts(): Promise<ToolsDriveAccount[]> {
  const data = await api<{ accounts: ToolsDriveAccount[] }>('/api/tools/storage/drive/accounts');
  return Array.isArray(data?.accounts) ? data.accounts.map((row: any) => normalizeToolsDriveAccount(row)) : [];
}

export async function createToolsDriveAccount(payload: {
  alias: string;
  remoteName: string;
  configPath?: string;
  rootPath?: string;
  rootFolderId?: string;
}): Promise<ToolsDriveAccount> {
  const data = await api<{ account: ToolsDriveAccount }>('/api/tools/storage/drive/accounts', {
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
    `/api/tools/storage/drive/accounts/${encodeURIComponent(String(accountId || '').trim())}/validate`,
    { method: 'POST' }
  );
  return {
    account: normalizeToolsDriveAccount(data?.account),
    about: data.about
  };
}

export async function deleteToolsDriveAccount(accountId: string): Promise<{ deleted: boolean; accountId: string }> {
  return api(`/api/tools/storage/drive/accounts/${encodeURIComponent(String(accountId || '').trim())}`, {
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
  const data = await api<ToolsDriveFilesPayload>(`/api/tools/storage/drive/files?${params.toString()}`);
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
  const data = await api<{ job: ToolsStorageJob }>('/api/tools/storage/drive/upload', {
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
    `/api/tools/storage/drive/files/${encodeURIComponent(String(payload.fileId || '').trim())}?accountId=${encodeURIComponent(String(payload.accountId || '').trim())}&confirm=DELETE`,
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

export async function downloadToolsDriveFile(payload: {
  accountId: string;
  fileId: string;
}): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
  const fileId = String(payload.fileId || '').trim();
  const accountId = String(payload.accountId || '').trim();
  const response = await fetch(
    `/api/tools/storage/drive/files/${encodeURIComponent(fileId)}/download?accountId=${encodeURIComponent(accountId)}`,
    {
      method: 'GET',
      credentials: 'include'
    }
  );
  if (!response.ok) {
    const data = await parseJsonSafe(response);
    const err = new Error(data?.error || `Request failed (${response.status})`) as ApiError;
    err.status = response.status;
    throw err;
  }
  const blob = await response.blob();
  const headerName = parseContentDispositionFileName(String(response.headers.get('content-disposition') || ''));
  const fallbackName = fileId ? String(fileId).split('/').filter(Boolean).pop() || 'drive-file' : 'drive-file';
  const fileName = headerName || fallbackName;
  return {
    blob,
    fileName,
    mimeType: String(blob.type || response.headers.get('content-type') || '').trim() || 'application/octet-stream'
  };
}

function normalizeToolsStorageResidualCandidate(rawValue: any): ToolsStorageResidualCandidate {
  const categoryRaw = String(rawValue?.category || '')
    .trim()
    .toLowerCase();
  const normalizedCategory:
    | 'temporary'
    | 'logs'
    | 'cache'
    | 'backup'
    | 'artifact'
    | 'residual'
    | 'other' =
    categoryRaw === 'temporary' ||
    categoryRaw === 'logs' ||
    categoryRaw === 'cache' ||
    categoryRaw === 'backup' ||
    categoryRaw === 'artifact' ||
    categoryRaw === 'other'
      ? categoryRaw
      : 'residual';
  const sourceRaw = String(rawValue?.analysisSource || '')
    .trim()
    .toLowerCase();
  return {
    id: String(rawValue?.id || rawValue?.path || ''),
    path: String(rawValue?.path || ''),
    name: String(rawValue?.name || rawValue?.path || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || String(rawValue?.path || ''),
    type: rawValue?.type === 'directory' || rawValue?.type === 'other' ? rawValue.type : 'file',
    sizeBytes: Number.isFinite(Number(rawValue?.sizeBytes)) ? Number(rawValue.sizeBytes) : 0,
    modifiedAt: String(rawValue?.modifiedAt || ''),
    reason: String(rawValue?.reason || ''),
    confidence:
      rawValue?.confidence === 'high' || rawValue?.confidence === 'medium' ? rawValue.confidence : 'low',
    risk: rawValue?.risk === 'high' || rawValue?.risk === 'medium' ? rawValue.risk : 'low',
    category: normalizedCategory,
    analysisSource: sourceRaw === 'ai' ? 'ai' : 'heuristic',
    score: Number.isFinite(Number(rawValue?.score)) ? Number(rawValue.score) : 0
  };
}

export function normalizeToolsStorageResidualAnalysis(rawValue: any): ToolsStorageResidualAnalysis {
  return {
    scannedAt: String(rawValue?.scannedAt || ''),
    roots: Array.isArray(rawValue?.roots) ? rawValue.roots.map((entry: any) => String(entry || '')).filter(Boolean) : [],
    maxDepth: Number(rawValue?.maxDepth) || 0,
    limit: Number(rawValue?.limit) || 0,
    candidates: Array.isArray(rawValue?.candidates)
      ? rawValue.candidates.map((entry: any) => normalizeToolsStorageResidualCandidate(entry))
      : [],
    ai: {
      requested: Boolean(rawValue?.ai?.requested),
      used: Boolean(rawValue?.ai?.used),
      fallbackReason: String(rawValue?.ai?.fallbackReason || ''),
      providerId: String(rawValue?.ai?.providerId || ''),
      providerName: String(rawValue?.ai?.providerName || ''),
      attemptedProviders: Array.isArray(rawValue?.ai?.attemptedProviders)
        ? rawValue.ai.attemptedProviders.map((entry: any) => String(entry || '').trim()).filter(Boolean)
        : []
    },
    summary:
      rawValue?.summary && typeof rawValue.summary === 'object'
        ? {
            totalCandidates: Number(rawValue.summary?.totalCandidates) || 0,
            totalBytes: Number(rawValue.summary?.totalBytes) || 0,
            byCategory:
              rawValue.summary?.byCategory && typeof rawValue.summary.byCategory === 'object'
                ? Object.fromEntries(
                    Object.entries(rawValue.summary.byCategory)
                      .map(([key, value]) => [String(key || '').trim(), Number(value) || 0])
                      .filter(([key]) => Boolean(key))
                  )
                : {},
            criteria: Array.isArray(rawValue.summary?.criteria)
              ? rawValue.summary.criteria.map((entry: any) => String(entry || '').trim()).filter(Boolean)
              : [],
            pipeline: String(rawValue.summary?.pipeline || '')
          }
        : undefined
  };
}

export async function analyzeToolsStorageResidual(payload?: {
  roots?: string[];
  limit?: number;
  maxDepth?: number;
  useAi?: boolean;
}): Promise<{ job: ToolsStorageJob }> {
  const data = await api<{ job: ToolsStorageJob }>('/api/tools/storage/cleanup/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  return {
    job: normalizeToolsStorageJob(data?.job)
  };
}

export async function deleteToolsStorageResidual(payload: {
  paths: string[];
  analysisJobId: string;
}): Promise<{
  analysisJobId: string;
  analysisScannedAt: string;
  requestedCount: number;
  deletedCount: number;
  failedCount: number;
  freedBytes: number;
  deleted: string[];
  deletedEntries: Array<{
    path: string;
    name: string;
    type: 'file' | 'directory' | 'other';
    sizeBytes: number;
    category: string;
  }>;
  failed: Array<{ path: string; error: string }>;
}> {
  const data = await api<{
    analysisJobId?: string;
    analysisScannedAt?: string;
    requestedCount?: number;
    deletedCount?: number;
    failedCount?: number;
    freedBytes?: number;
    deleted: string[];
    deletedEntries?: Array<{
      path?: string;
      name?: string;
      type?: string;
      sizeBytes?: number;
      category?: string;
    }>;
    failed: Array<{ path: string; error: string }>;
  }>(
    '/api/tools/storage/cleanup/delete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths: Array.isArray(payload?.paths) ? payload.paths : [],
        analysisJobId: String(payload?.analysisJobId || '').trim(),
        confirm: 'DELETE'
      })
    }
  );
  return {
    analysisJobId: String(data?.analysisJobId || ''),
    analysisScannedAt: String(data?.analysisScannedAt || ''),
    requestedCount: Number(data?.requestedCount) || 0,
    deletedCount: Number(data?.deletedCount) || 0,
    failedCount: Number(data?.failedCount) || 0,
    freedBytes: Number(data?.freedBytes) || 0,
    deleted: Array.isArray(data?.deleted) ? data.deleted.map((entry: any) => String(entry || '')).filter(Boolean) : [],
    deletedEntries: Array.isArray(data?.deletedEntries)
      ? data.deletedEntries
          .map((entry: any) => ({
            path: String(entry?.path || ''),
            name: String(entry?.name || ''),
            type: entry?.type === 'directory' || entry?.type === 'other' ? entry.type : 'file',
            sizeBytes: Number(entry?.sizeBytes) || 0,
            category: String(entry?.category || '')
          }))
          .filter((entry: any) => Boolean(entry.path))
      : [],
    failed: Array.isArray(data?.failed)
      ? data.failed.map((entry: any) => ({
          path: String(entry?.path || ''),
          error: String(entry?.error || '')
        }))
      : []
  };
}

function normalizeToolsWireGuardPeer(rawValue: any): ToolsWireGuardPeer {
  return {
    id: String(rawValue?.id || ''),
    name: String(rawValue?.name || ''),
    publicKey: String(rawValue?.publicKey || ''),
    clientIp: String(rawValue?.clientIp || ''),
    allowedIps: String(rawValue?.allowedIps || ''),
    endpoint: String(rawValue?.endpoint || ''),
    latestHandshakeAt: String(rawValue?.latestHandshakeAt || ''),
    secondsSinceHandshake:
      Number.isFinite(Number(rawValue?.secondsSinceHandshake)) && Number(rawValue.secondsSinceHandshake) >= 0
        ? Number(rawValue.secondsSinceHandshake)
        : null,
    active: Boolean(rawValue?.active),
    transferRxBytes: Number.isFinite(Number(rawValue?.transferRxBytes)) ? Number(rawValue.transferRxBytes) : 0,
    transferTxBytes: Number.isFinite(Number(rawValue?.transferTxBytes)) ? Number(rawValue.transferTxBytes) : 0,
    persistentKeepalive:
      Number.isFinite(Number(rawValue?.persistentKeepalive)) && Number(rawValue.persistentKeepalive) >= 0
        ? Number(rawValue.persistentKeepalive)
        : null,
    createdAt: String(rawValue?.createdAt || ''),
    notes: String(rawValue?.notes || ''),
    hasProfile: Boolean(rawValue?.hasProfile)
  };
}

function normalizeToolsWireGuardStatus(rawValue: any): ToolsWireGuardStatus {
  const peers = Array.isArray(rawValue?.peers) ? rawValue.peers.map((entry: any) => normalizeToolsWireGuardPeer(entry)) : [];
  return {
    runtime: {
      interfaceName: String(rawValue?.runtime?.interfaceName || ''),
      availableInterfaces: Array.isArray(rawValue?.runtime?.availableInterfaces)
        ? rawValue.runtime.availableInterfaces.map((entry: any) => String(entry || '').trim()).filter(Boolean)
        : [],
      configPath: String(rawValue?.runtime?.configPath || ''),
      configExists: Boolean(rawValue?.runtime?.configExists)
    },
    binaries: {
      wg: Boolean(rawValue?.binaries?.wg),
      wgQuick: Boolean(rawValue?.binaries?.wgQuick),
      qrencode: Boolean(rawValue?.binaries?.qrencode),
      systemctl: Boolean(rawValue?.binaries?.systemctl)
    },
    service: {
      unit: String(rawValue?.service?.unit || ''),
      isActive: Boolean(rawValue?.service?.isActive),
      activeState: String(rawValue?.service?.activeState || ''),
      subState: String(rawValue?.service?.subState || ''),
      unitFileState: String(rawValue?.service?.unitFileState || ''),
      loadState: String(rawValue?.service?.loadState || ''),
      description: String(rawValue?.service?.description || ''),
      fragmentPath: String(rawValue?.service?.fragmentPath || '')
    },
    interface: {
      name: String(rawValue?.interface?.name || ''),
      address: String(rawValue?.interface?.address || ''),
      listenPort:
        Number.isFinite(Number(rawValue?.interface?.listenPort)) && Number(rawValue.interface.listenPort) > 0
          ? Number(rawValue.interface.listenPort)
          : null,
      postUp: String(rawValue?.interface?.postUp || ''),
      postDown: String(rawValue?.interface?.postDown || ''),
      hasPrivateKey: Boolean(rawValue?.interface?.hasPrivateKey),
      publicKey: String(rawValue?.interface?.publicKey || ''),
      fwmark: String(rawValue?.interface?.fwmark || ''),
      configError: String(rawValue?.interface?.configError || '')
    },
    profileDefaults: {
      endpointHost: String(rawValue?.profileDefaults?.endpointHost || ''),
      defaultDns: String(rawValue?.profileDefaults?.defaultDns || ''),
      defaultAllowedIps: String(rawValue?.profileDefaults?.defaultAllowedIps || ''),
      defaultKeepaliveSeconds:
        Number.isFinite(Number(rawValue?.profileDefaults?.defaultKeepaliveSeconds))
          ? Number(rawValue.profileDefaults.defaultKeepaliveSeconds)
          : 25,
      updatedAt: String(rawValue?.profileDefaults?.updatedAt || '')
    },
    peers,
    stats: {
      configuredPeers: Number(rawValue?.stats?.configuredPeers) || peers.length,
      activePeers: Number(rawValue?.stats?.activePeers) || peers.filter((entry) => entry.active).length,
      totalRxBytes: Number(rawValue?.stats?.totalRxBytes) || 0,
      totalTxBytes: Number(rawValue?.stats?.totalTxBytes) || 0,
      activeWindowSeconds: Number(rawValue?.stats?.activeWindowSeconds) || 0,
      updatedAt: String(rawValue?.stats?.updatedAt || '')
    }
  };
}

export async function getToolsWireGuardStatus(interfaceName = ''): Promise<ToolsWireGuardStatus> {
  const params = new URLSearchParams();
  if (interfaceName) params.set('interfaceName', interfaceName);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api<{ wireguard: any }>(`/api/tools/wireguard/status${suffix}`);
  return normalizeToolsWireGuardStatus(data?.wireguard);
}

export async function controlToolsWireGuardService(payload: {
  action: 'start' | 'stop' | 'restart' | 'reload';
  confirm?: string;
  interfaceName?: string;
}): Promise<{ action: string; effectiveAction: string; output: string; wireguard: ToolsWireGuardStatus }> {
  const data = await api<{ action: string; effectiveAction: string; output: string; wireguard: any }>(
    '/api/tools/wireguard/service',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  return {
    action: String(data?.action || ''),
    effectiveAction: String(data?.effectiveAction || ''),
    output: String(data?.output || ''),
    wireguard: normalizeToolsWireGuardStatus(data?.wireguard)
  };
}

export async function getToolsWireGuardConfig(interfaceName = ''): Promise<{
  runtime: ToolsWireGuardStatus['runtime'];
  service: ToolsWireGuardStatus['service'];
  interface: ToolsWireGuardStatus['interface'];
  profileDefaults: ToolsWireGuardStatus['profileDefaults'];
  editable: {
    profileDefaultsOnly: boolean;
  };
}> {
  const params = new URLSearchParams();
  if (interfaceName) params.set('interfaceName', interfaceName);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api<{
    config: {
      runtime: any;
      service: any;
      interface: any;
      profileDefaults: any;
      editable: { profileDefaultsOnly: boolean };
    };
  }>(`/api/tools/wireguard/config${suffix}`);
  const normalized = normalizeToolsWireGuardStatus({
    runtime: data?.config?.runtime,
    service: data?.config?.service,
    interface: data?.config?.interface,
    profileDefaults: data?.config?.profileDefaults,
    peers: [],
    stats: {}
  });
  return {
    runtime: normalized.runtime,
    service: normalized.service,
    interface: normalized.interface,
    profileDefaults: normalized.profileDefaults,
    editable: {
      profileDefaultsOnly: Boolean(data?.config?.editable?.profileDefaultsOnly)
    }
  };
}

export async function updateToolsWireGuardConfig(payload: {
  interfaceName?: string;
  endpointHost?: string;
  defaultDns?: string;
  defaultAllowedIps?: string;
  defaultKeepaliveSeconds?: number;
}): Promise<{ settings: ToolsWireGuardStatus['profileDefaults']; wireguard: ToolsWireGuardStatus }> {
  const data = await api<{ settings: any; wireguard: any }>('/api/tools/wireguard/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  const normalizedWireGuard = normalizeToolsWireGuardStatus(data?.wireguard);
  return {
    settings: normalizedWireGuard.profileDefaults,
    wireguard: normalizedWireGuard
  };
}

export async function getToolsWireGuardDiagnostics(payload?: {
  interfaceName?: string;
  lines?: number;
}): Promise<ToolsWireGuardDiagnostics> {
  const params = new URLSearchParams();
  if (payload?.interfaceName) params.set('interfaceName', String(payload.interfaceName));
  if (Number.isInteger(Number(payload?.lines))) params.set('lines', String(payload?.lines));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api<{ diagnostics: any }>(`/api/tools/wireguard/diagnostics${suffix}`);
  const statusLike = normalizeToolsWireGuardStatus({
    runtime: data?.diagnostics?.runtime,
    service: data?.diagnostics?.service,
    interface: {},
    profileDefaults: {},
    peers: [],
    stats: {}
  });
  return {
    runtime: statusLike.runtime,
    service: statusLike.service,
    checks: {
      wgBinary: Boolean(data?.diagnostics?.checks?.wgBinary),
      wgQuickBinary: Boolean(data?.diagnostics?.checks?.wgQuickBinary),
      systemctlBinary: Boolean(data?.diagnostics?.checks?.systemctlBinary),
      configExists: Boolean(data?.diagnostics?.checks?.configExists),
      configStripOk: Boolean(data?.diagnostics?.checks?.configStripOk),
      configStripError: String(data?.diagnostics?.checks?.configStripError || '')
    },
    logs: {
      lines: Number(data?.diagnostics?.logs?.lines) || 0,
      output: String(data?.diagnostics?.logs?.output || '')
    }
  };
}

export async function createToolsWireGuardPeer(payload: {
  interfaceName?: string;
  name: string;
  clientIp?: string;
  dns?: string;
  allowedIps?: string;
  keepaliveSeconds?: number;
  endpointHost?: string;
  comment?: string;
}): Promise<{ peer: ToolsWireGuardPeer; profile: { peerId: string; downloadPath: string; qrPath: string }; wireguard: ToolsWireGuardStatus }> {
  const data = await api<{ peer: any; profile: any; wireguard: any }>('/api/tools/wireguard/peers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  return {
    peer: normalizeToolsWireGuardPeer(data?.peer),
    profile: {
      peerId: String(data?.profile?.peerId || ''),
      downloadPath: String(data?.profile?.downloadPath || ''),
      qrPath: String(data?.profile?.qrPath || '')
    },
    wireguard: normalizeToolsWireGuardStatus(data?.wireguard)
  };
}

export async function deleteToolsWireGuardPeer(payload: {
  peerId: string;
  interfaceName?: string;
  publicKey?: string;
}): Promise<{ deleted: boolean; peerId: string; publicKey: string; wireguard: ToolsWireGuardStatus }> {
  const peerId = String(payload?.peerId || '').trim();
  const params = new URLSearchParams();
  params.set('confirm', 'DELETE');
  const data = await api<{ deleted: boolean; peerId: string; publicKey: string; wireguard: any }>(
    `/api/tools/wireguard/peers/${encodeURIComponent(peerId)}?${params.toString()}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interfaceName: payload?.interfaceName || '',
        publicKey: payload?.publicKey || ''
      })
    }
  );
  return {
    deleted: Boolean(data?.deleted),
    peerId: String(data?.peerId || ''),
    publicKey: String(data?.publicKey || ''),
    wireguard: normalizeToolsWireGuardStatus(data?.wireguard)
  };
}

export async function getToolsWireGuardPeerProfile(peerId: string): Promise<ToolsWireGuardPeerProfile> {
  const data = await api<any>(`/api/tools/wireguard/peers/${encodeURIComponent(String(peerId || '').trim())}/profile`);
  return {
    peerId: String(data?.peerId || ''),
    interfaceName: String(data?.interfaceName || ''),
    name: String(data?.name || ''),
    publicKey: String(data?.publicKey || ''),
    fileName: String(data?.fileName || ''),
    config: String(data?.config || '')
  };
}

export async function downloadToolsWireGuardPeerProfile(peerId: string): Promise<{ blob: Blob; fileName: string }> {
  const safePeerId = String(peerId || '').trim();
  const response = await fetch(`/api/tools/wireguard/peers/${encodeURIComponent(safePeerId)}/profile/download`, {
    method: 'GET',
    credentials: 'include'
  });
  if (!response.ok) {
    const data = await parseJsonSafe(response);
    const err = new Error(data?.error || `Request failed (${response.status})`) as ApiError;
    err.status = response.status;
    throw err;
  }
  const blob = await response.blob();
  const headerName = parseContentDispositionFileName(String(response.headers.get('content-disposition') || ''));
  return {
    blob,
    fileName: headerName || `${safePeerId || 'wireguard-peer'}.conf`
  };
}

export async function getToolsWireGuardPeerQr(peerId: string): Promise<{ mimeType: string; dataUrl: string; generatedAt: string }> {
  const data = await api<any>(`/api/tools/wireguard/peers/${encodeURIComponent(String(peerId || '').trim())}/profile/qr`);
  return {
    mimeType: String(data?.mimeType || 'image/png'),
    dataUrl: String(data?.dataUrl || ''),
    generatedAt: String(data?.generatedAt || '')
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
): Promise<{ repo: ToolsGitRepoSummary; merge?: ToolsGitMergePayload; job?: ToolsStorageJob }> {
  const data = await api<{ repo: ToolsGitRepoSummary; merge?: ToolsGitMergePayload; job?: ToolsStorageJob }>(
    `/api/tools/git/repos/${encodeURIComponent(String(repoId || ''))}/merge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  return {
    repo: {
      ...data.repo,
      branches: Array.isArray(data?.repo?.branches)
        ? data.repo.branches.map((entry: any) => String(entry || '').trim()).filter(Boolean)
        : []
    },
    merge: data.merge
      ? {
          sourceBranch: String(data.merge.sourceBranch || ''),
          targetBranch: String(data.merge.targetBranch || ''),
          output: String(data.merge.output || ''),
          status:
            data.merge.status === 'queued' ||
            data.merge.status === 'merged' ||
            data.merge.status === 'conflict' ||
            data.merge.status === 'failed'
              ? data.merge.status
              : undefined,
          hasConflicts: Boolean(data.merge.hasConflicts),
          conflictFiles: Array.isArray(data.merge.conflictFiles)
            ? data.merge.conflictFiles.map((entry: any) => String(entry || '').trim()).filter(Boolean)
            : []
        }
      : undefined,
    job: data?.job ? normalizeToolsStorageJob(data.job) : undefined
  };
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

export async function getStorageHealth(path?: string): Promise<StorageHealthSnapshot> {
  const suffix = path ? `?path=${encodeURIComponent(path)}` : '';
  const data = await api<{ storage: any }>(`/api/storage/health${suffix}`);
  const raw = data?.storage && typeof data.storage === 'object' ? data.storage : {};
  const statusRaw = String(raw.status || '').trim().toLowerCase();
  return {
    path: String(raw.path || ''),
    mountPoint: String(raw.mountPoint || ''),
    totalBytes: Number.isFinite(Number(raw.totalBytes)) ? Number(raw.totalBytes) : null,
    usedBytes: Number.isFinite(Number(raw.usedBytes)) ? Number(raw.usedBytes) : null,
    availableBytes: Number.isFinite(Number(raw.availableBytes)) ? Number(raw.availableBytes) : null,
    usedPercent: Number.isFinite(Number(raw.usedPercent)) ? Number(raw.usedPercent) : null,
    status: statusRaw === 'warning' || statusRaw === 'critical' ? statusRaw : 'ok',
    thresholds: {
      warningFreeBytes: Number.isFinite(Number(raw?.thresholds?.warningFreeBytes))
        ? Number(raw.thresholds.warningFreeBytes)
        : 0,
      criticalFreeBytes: Number.isFinite(Number(raw?.thresholds?.criticalFreeBytes))
        ? Number(raw.thresholds.criticalFreeBytes)
        : 0
    },
    requiredBytes: Number.isFinite(Number(raw.requiredBytes)) ? Number(raw.requiredBytes) : null,
    enoughForRequired:
      typeof raw.enoughForRequired === 'boolean' ? raw.enoughForRequired : null
  };
}

export async function preflightAttachmentUpload(
  files: File[],
  conversationId: number | null
): Promise<AttachmentUploadPreflight> {
  const payload = {
    conversationId:
      Number.isInteger(Number(conversationId)) && Number(conversationId) > 0 ? Number(conversationId) : null,
    files: (Array.isArray(files) ? files : []).map((file) => ({
      name: String(file?.name || 'file'),
      size: Math.max(0, Number(file?.size) || 0)
    }))
  };
  const data = await api<any>('/api/uploads/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const storageRaw = data?.storage && typeof data.storage === 'object' ? data.storage : {};
  const storageStatusRaw = String(storageRaw.status || '').trim().toLowerCase();
  return {
    accepted: Boolean(data?.accepted),
    files: Array.isArray(data?.files)
      ? data.files
          .map((entry: any) => ({
            name: String(entry?.name || ''),
            size: Math.max(0, Number(entry?.size) || 0)
          }))
          .filter((entry) => Boolean(entry.name))
      : [],
    estimate: {
      payloadBytes: Math.max(0, Number(data?.estimate?.payloadBytes) || 0),
      requiredBytes: Math.max(0, Number(data?.estimate?.requiredBytes) || 0)
    },
    limits: {
      maxAttachments: Math.max(0, Number(data?.limits?.maxAttachments) || 0),
      maxAttachmentSizeBytes: Math.max(0, Number(data?.limits?.maxAttachmentSizeBytes) || 0),
      maxAttachmentSizeMb: Math.max(0, Number(data?.limits?.maxAttachmentSizeMb) || 0)
    },
    storage: {
      path: String(storageRaw.path || ''),
      mountPoint: String(storageRaw.mountPoint || ''),
      totalBytes: Number.isFinite(Number(storageRaw.totalBytes)) ? Number(storageRaw.totalBytes) : null,
      usedBytes: Number.isFinite(Number(storageRaw.usedBytes)) ? Number(storageRaw.usedBytes) : null,
      availableBytes: Number.isFinite(Number(storageRaw.availableBytes)) ? Number(storageRaw.availableBytes) : null,
      usedPercent: Number.isFinite(Number(storageRaw.usedPercent)) ? Number(storageRaw.usedPercent) : null,
      status: storageStatusRaw === 'warning' || storageStatusRaw === 'critical' ? storageStatusRaw : 'ok',
      thresholds: {
        warningFreeBytes: Number.isFinite(Number(storageRaw?.thresholds?.warningFreeBytes))
          ? Number(storageRaw.thresholds.warningFreeBytes)
          : 0,
        criticalFreeBytes: Number.isFinite(Number(storageRaw?.thresholds?.criticalFreeBytes))
          ? Number(storageRaw.thresholds.criticalFreeBytes)
          : 0
      },
      requiredBytes: Number.isFinite(Number(storageRaw.requiredBytes)) ? Number(storageRaw.requiredBytes) : null,
      enoughForRequired:
        typeof storageRaw.enoughForRequired === 'boolean' ? storageRaw.enoughForRequired : null
    }
  };
}

const CHUNKED_UPLOAD_THRESHOLD_BYTES = 90 * 1024 * 1024;
const CHUNKED_UPLOAD_DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;

async function uploadAttachmentChunked(
  file: File,
  conversationId: number | null,
  signal?: AbortSignal,
  onProgress?: (progress: { loaded: number; total: number }) => void
): Promise<{ uploadId: string }> {
  const startPayload = {
    fileName: String(file?.name || 'file'),
    fileType: String(file?.type || 'application/octet-stream'),
    totalSize: Math.max(0, Number(file?.size) || 0),
    conversationId:
      Number.isInteger(Number(conversationId)) && Number(conversationId) > 0 ? Number(conversationId) : null
  };
  const startResp = await fetch('/api/uploads/chunked/start', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(startPayload),
    signal
  });
  const startData = await parseJsonSafe(startResp);
  if (!startResp.ok) {
    throw new Error(startData?.error || `No se pudo iniciar subida por partes de ${file.name}`);
  }
  const uploadId = String(startData?.uploadId || startData?.attachment?.uploadId || '').trim();
  if (!uploadId) {
    throw new Error(`Respuesta invalida al iniciar subida por partes de ${file.name}`);
  }
  const chunkSizeRaw = Number(startData?.chunkSizeBytes);
  const chunkSize =
    Number.isFinite(chunkSizeRaw) && chunkSizeRaw > 0
      ? Math.max(512 * 1024, Math.min(Math.round(chunkSizeRaw), 32 * 1024 * 1024))
      : CHUNKED_UPLOAD_DEFAULT_CHUNK_BYTES;
  const totalBytes = Math.max(0, Number(file?.size) || 0);
  let loadedBytes = 0;
  if (onProgress) {
    onProgress({ loaded: 0, total: totalBytes });
  }

  let chunkIndex = 0;
  while (loadedBytes < totalBytes) {
    const nextEnd = Math.min(totalBytes, loadedBytes + chunkSize);
    const chunkBlob = file.slice(loadedBytes, nextEnd);
    const chunkResp = await fetch(
      `/api/uploads/chunked/${encodeURIComponent(uploadId)}/chunk?index=${chunkIndex}`,
      {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: chunkBlob,
        signal
      }
    );
    const chunkData = await parseJsonSafe(chunkResp);
    if (!chunkResp.ok) {
      throw new Error(chunkData?.error || `No se pudo subir chunk ${chunkIndex + 1} de ${file.name}`);
    }
    loadedBytes = Number.isFinite(Number(chunkData?.receivedBytes))
      ? Math.max(loadedBytes, Number(chunkData.receivedBytes))
      : nextEnd;
    chunkIndex += 1;
    if (onProgress) {
      onProgress({
        loaded: Math.min(totalBytes, loadedBytes),
        total: totalBytes
      });
    }
  }

  const completeResp = await fetch(`/api/uploads/chunked/${encodeURIComponent(uploadId)}/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    signal
  });
  const completeData = await parseJsonSafe(completeResp);
  if (!completeResp.ok) {
    throw new Error(completeData?.error || `No se pudo completar la subida por partes de ${file.name}`);
  }
  const completeUploadId = String(completeData?.attachment?.uploadId || uploadId).trim();
  if (!completeUploadId) {
    throw new Error(`Respuesta invalida al completar subida por partes de ${file.name}`);
  }
  if (onProgress) {
    onProgress({
      loaded: totalBytes,
      total: totalBytes
    });
  }
  return { uploadId: completeUploadId };
}

export async function uploadAttachment(
  file: File,
  conversationId: number | null,
  signal?: AbortSignal,
  onProgress?: (progress: { loaded: number; total: number }) => void
): Promise<{ uploadId: string }> {
  if (Math.max(0, Number(file?.size) || 0) >= CHUNKED_UPLOAD_THRESHOLD_BYTES) {
    return uploadAttachmentChunked(file, conversationId, signal, onProgress);
  }
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
  projectId?: number | null;
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
      projectId:
        Number.isInteger(Number(payload.projectId)) && Number(payload.projectId) > 0
          ? Number(payload.projectId)
          : null,
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
