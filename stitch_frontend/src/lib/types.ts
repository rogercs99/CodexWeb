export type Screen =
  | 'login'
  | 'hub'
  | 'chat'
  | 'search'
  | 'attachments'
  | 'terminal'
  | 'settings'
  | 'reboot'
  | 'offline';

export interface User {
  id: number;
  username: string;
}

export interface Conversation {
  id: number;
  title: string;
  model: string;
  reasoningEffort: string;
  created_at: string;
  last_message_at: string;
  liveDraftOpen?: boolean;
  liveDraftUpdatedAt?: string;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  conversationId: number;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

export interface AttachmentItem {
  id: string;
  conversationId: number;
  conversationTitle: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

export interface TerminalEntry {
  id: string;
  itemId: string;
  conversationId: number | null;
  kind: 'running' | 'success' | 'error' | 'notice';
  command: string;
  output: string;
  statusText: string;
  timestamp: string;
  durationMs: number;
}

export interface CodexBackgroundRun {
  conversationId: number;
  title: string;
  startedAt: string;
  pid: number | null;
  status: 'running' | 'stopping';
  killRequested: boolean;
}

export interface ChatOptions {
  models: string[];
  reasoningEfforts: string[];
  defaults: {
    model: string;
    reasoningEffort: string;
  };
}

export interface NotificationSettings {
  discordWebhookUrl: string;
  notifyOnFinish: boolean;
  includeResult: boolean;
}

export interface RestartState {
  attemptId: string;
  active: boolean;
  phase: string;
  requestedBy: string;
  startedAt: string;
  finishedAt: string;
  updatedAt: string;
  logs: Array<{ at: string; message: string }>;
}

export interface TaskRunCommand {
  id: number;
  itemId: string;
  command: string;
  output: string;
  status: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface TaskRecovery {
  taskId: number;
  status: string;
  startedAt: string;
  updatedAt: string;
  planText: string;
  commands: TaskRunCommand[];
}

export interface TaskRunDashboardItem {
  id: number;
  conversationId: number | null;
  conversationTitle: string;
  status: string;
  result: string;
  closeReason: string;
  riskLevel: string;
  startedAt: string;
  finishedAt: string;
  updatedAt: string;
  durationMs: number;
  filesTouched: string[];
  testsExecuted: string[];
  metrics: Record<string, any>;
  commandTotal: number;
  commandFailed: number;
  rollbackAvailable: boolean;
  rollbackStatus: string;
  rollbackError: string;
  rollbackAt: string;
  snapshotReady: boolean;
  snapshotDir: string;
  planText: string;
}

export interface UnifiedSearchChatHit {
  conversationId: number;
  title: string;
  lastMessageAt: string;
  matchField: 'title' | 'messages';
  snippet: string;
}

export interface UnifiedSearchCommandHit {
  id: number;
  taskId: number;
  conversationId: number | null;
  conversationTitle: string;
  command: string;
  outputSnippet: string;
  status: string;
  exitCode: number | null;
  at: string;
}

export interface UnifiedSearchErrorHit {
  taskId: number;
  conversationId: number | null;
  conversationTitle: string;
  status: string;
  commandFailed: number;
  summary: string;
  at: string;
}

export interface UnifiedSearchFileHit {
  taskId: number;
  conversationId: number | null;
  conversationTitle: string;
  files: string[];
  filesCount: number;
  at: string;
}

export interface UnifiedSearchPayload {
  query: string;
  minQueryLength: number;
  limit: number;
  counts: {
    chats: number;
    commands: number;
    errors: number;
    files: number;
  };
  results: {
    chats: UnifiedSearchChatHit[];
    commands: UnifiedSearchCommandHit[];
    errors: UnifiedSearchErrorHit[];
    files: UnifiedSearchFileHit[];
  };
}

export interface ApiObservabilityEndpoint {
  method: string;
  path: string;
  requests: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  lastStatus: number;
  lastAt: string;
}

export interface ApiObservabilityErrorSample {
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export interface ObservabilitySnapshot {
  sampledAt: string;
  startedAt: string;
  uptimeSeconds: number;
  process: {
    pid: number;
    nodeVersion: string;
    platform: string;
    cpuPercent: number;
    cpuPerCorePercent: number;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
      arrayBuffersBytes: number;
    };
  };
  system: {
    cpuCount: number;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    totalMemBytes: number;
    freeMemBytes: number;
    usedMemBytes: number;
    usedMemPercent: number;
  };
  api: {
    totalRequests: number;
    totalErrors: number;
    errorRate: number;
    latency: {
      sampleCount: number;
      avgMs: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      maxMs: number;
    };
    endpoints: ApiObservabilityEndpoint[];
    recentErrors: ApiObservabilityErrorSample[];
  };
}

export type DeployedAppSource = 'docker' | 'systemd' | 'pm2';
export type DeployedAppStatus = 'running' | 'stopped' | 'error' | 'unknown';

export interface ToolsDeployedApp {
  id: string;
  source: DeployedAppSource;
  name: string;
  status: DeployedAppStatus;
  detailStatus: string;
  description: string;
  pid: number | null;
  location: string;
  uptime: string;
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
  hasLogs: boolean;
  scannedAt: string;
}

export interface ToolsDeployedAppsPayload {
  scannedAt: string;
  apps: ToolsDeployedApp[];
}

export interface ToolsDeployedAppActionResponse {
  action: 'start' | 'stop' | 'restart';
  app: ToolsDeployedApp;
  output: string;
  scannedAt: string;
}

export interface ToolsDeployedAppLogsResponse {
  app: ToolsDeployedApp;
  lines: number;
  logs: string;
  fetchedAt: string;
}

export interface ToolsGitRepoStatusCounts {
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  total: number;
}

export interface ToolsGitRepoSummary {
  id: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  detached: boolean;
  hasRemote: boolean;
  remotes: string[];
  hasChanges: boolean;
  hasConflicts: boolean;
  status: ToolsGitRepoStatusCounts;
  changedFiles: string[];
  conflictFiles: string[];
  scannedAt: string;
}

export interface ToolsGitReposPayload {
  scannedAt: string;
  repos: ToolsGitRepoSummary[];
}

export interface ToolsGitPushResult {
  commitCreated: boolean;
  commitMessage: string;
  commitHash: string;
  output: string;
}

export interface ToolsGitResolvePayload {
  conversationId: number;
  prompt: string;
  autoSend: boolean;
}

export interface Capabilities {
  web: boolean;
  code: boolean;
  memory: boolean;
}

export interface CodexQuotaWindow {
  totalPercent: number;
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number;
  resetAt: string;
}

export interface CodexQuotaCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: number | null;
}

export interface CodexQuota {
  source: string;
  observedAt: string;
  fetchedAt: string;
  limitId: string;
  planType: string;
  primary: CodexQuotaWindow | null;
  secondary: CodexQuotaWindow | null;
  credits: CodexQuotaCredits;
}

export interface CodexDeviceLogin {
  startedAt: string;
  verificationUri: string;
  userCode: string;
  expiresAt: string;
  inProgress: boolean;
  completed: boolean;
  failed: boolean;
  cancelled: boolean;
  statusText: string;
  error: string;
}

export interface CodexAuthDetails {
  checkedAt: string;
  authMethod: string;
  authMode: string;
  accountId: string;
  email: string;
  emailVerified: boolean;
  subject: string;
  issuer: string;
  authProvider: string;
  lastRefresh: string;
  tokenIssuedAt: string;
  tokenExpiresAt: string;
  hasRefreshToken: boolean;
  hasApiKey: boolean;
}

export interface CodexAuthStatus {
  loggedIn: boolean;
  statusText: string;
  details?: CodexAuthDetails | null;
  loginInProgress: boolean;
  login: CodexDeviceLogin | null;
}
