import type {
  AiAgentSettingsItem,
  AiAgentSettingsPayload,
  AttachmentItem,
  CodexBackgroundRun,
  CodexAuthStatus,
  ChatOptions,
  CodexQuota,
  NotificationSettings,
  Conversation,
  MessageAttachment,
  Message,
  ToolsDeployedAppActionResponse,
  ToolsDeployedAppDescribeResponse,
  ToolsDeployedAppLogsResponse,
  ToolsDeployedAppsPayload,
  ToolsGitPushResult,
  ToolsGitRepoSummary,
  ToolsGitResolvePayload,
  ToolsGitReposPayload,
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

export async function listMessages(conversationId: number): Promise<{
  conversation: { id: number; title: string; model: string; reasoningEffort: string };
  messages: Message[];
  liveDraft?: any;
  taskRecovery?: TaskRecovery | null;
}> {
  const data = await api<{
    conversation: { id: number; title: string; model: string; reasoningEffort: string };
    messages: Message[];
    liveDraft?: any;
    taskRecovery?: TaskRecovery | null;
  }>(
    `/api/conversations/${conversationId}/messages`
  );
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
    activeAgentId?: string;
    activeAgentName?: string;
    runtimeProvider?: string;
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
    activeAgentId: String(data.activeAgentId || '').trim(),
    activeAgentName: String(data.activeAgentName || '').trim(),
    runtimeProvider: String(data.runtimeProvider || '').trim()
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

export async function getToolsDeployedApps(forceRefresh = false): Promise<ToolsDeployedAppsPayload> {
  const suffix = forceRefresh ? '?refresh=1' : '';
  const data = await api<{ scannedAt: string; apps: ToolsDeployedAppsPayload['apps'] }>(
    `/api/tools/deployed-apps${suffix}`
  );
  return {
    scannedAt: String(data.scannedAt || ''),
    apps: Array.isArray(data.apps) ? data.apps : []
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
  return api('/api/tools/deployed-apps/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appIds: normalized })
  });
}

export async function getToolsGitRepos(forceRefresh = false): Promise<ToolsGitReposPayload> {
  const suffix = forceRefresh ? '?refresh=1' : '';
  const data = await api<{ scannedAt: string; repos: ToolsGitRepoSummary[] }>(`/api/tools/git/repos${suffix}`);
  return {
    scannedAt: String(data.scannedAt || ''),
    repos: Array.isArray(data.repos) ? data.repos : []
  };
}

export async function pushToolsGitRepo(
  repoId: string,
  commitMessage = ''
): Promise<{ repo: ToolsGitRepoSummary; push: ToolsGitPushResult }> {
  return api(`/api/tools/git/repos/${encodeURIComponent(String(repoId || ''))}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitMessage })
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

export async function uploadAttachment(file: File, conversationId: number | null, signal?: AbortSignal): Promise<{ uploadId: string }> {
  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
    'X-File-Name': encodeURIComponent(file.name || 'file'),
    'X-File-Type': file.type || 'application/octet-stream'
  };
  if (conversationId && Number.isInteger(conversationId) && conversationId > 0) {
    headers['X-Conversation-Id'] = String(conversationId);
  }

  const response = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: file,
    signal
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(data?.error || `No se pudo subir ${file.name}`);
  }

  const uploadId = data?.attachment?.uploadId;
  if (!uploadId) {
    throw new Error(`Respuesta invalida al subir ${file.name}`);
  }

  return { uploadId: String(uploadId) };
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
