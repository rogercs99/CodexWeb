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
  projectId?: number | null;
  project?: ChatProjectRef | null;
  title: string;
  model: string;
  reasoningEffort: string;
  created_at: string;
  last_message_at: string;
  liveDraftOpen?: boolean;
  liveDraftUpdatedAt?: string;
}

export type ProjectContextMode = 'manual' | 'automatic' | 'mixed';

export interface ChatProjectRef {
  id: number;
  name: string;
  contextMode: ProjectContextMode;
  autoContextEnabled: boolean;
}

export interface ChatProject extends ChatProjectRef {
  manualContext?: string;
  autoContext?: string;
  manualContextPreview?: string;
  autoContextPreview?: string;
  autoUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  autoLastMessageId?: number;
  autoMeta?: Record<string, any>;
  stats?: {
    chatCount: number;
    lastMessageAt: string;
  };
}

export interface ConversationProjectContext {
  projectId: number;
  projectName: string;
  mode: ProjectContextMode;
  autoEnabled: boolean;
  manualContext: string;
  autoContext: string;
  effectiveContext: string;
  manualUsed: boolean;
  autoUsed: boolean;
  autoUpdatedAt: string;
  autoMeta?: Record<string, any>;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  attachments?: MessageAttachment[];
}

export interface MessagesPagination {
  limit: number;
  hasMore: boolean;
  nextBeforeId: number | null;
  oldestLoadedId: number | null;
  newestLoadedId: number | null;
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

export interface StorageHealthSnapshot {
  path: string;
  mountPoint: string;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
  status: 'ok' | 'warning' | 'critical';
  thresholds: {
    warningFreeBytes: number;
    criticalFreeBytes: number;
  };
  requiredBytes?: number | null;
  enoughForRequired?: boolean | null;
}

export interface AttachmentUploadPreflight {
  accepted: boolean;
  files: Array<{
    name: string;
    size: number;
  }>;
  estimate: {
    payloadBytes: number;
    requiredBytes: number;
  };
  limits: {
    maxAttachments: number;
    maxAttachmentSizeBytes: number;
    maxAttachmentSizeMb: number;
  };
  storage: StorageHealthSnapshot;
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
  providerId?: string;
  activeAgentId?: string;
  activeAgentName?: string;
  runtimeProvider?: 'codex' | 'gemini' | string;
  capabilities?: string[];
  quota?: AiProviderQuota | null;
  permissions?: AiProviderPermissionProfile | null;
}

export interface NotificationSettings {
  discordWebhookUrl: string;
  notifyOnFinish: boolean;
  includeResult: boolean;
}

export type AiAgentPricing = 'free' | 'freemium' | 'paid';

export type AiAgentIntegrationType = 'api_key' | 'oauth' | 'local_cli';

export interface AiAgentIntegrationState {
  enabled: boolean;
  configured: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  baseUrl: string;
  updatedAt: string;
}

export interface AiAgentTutorial {
  title: string;
  steps: string[];
  notes: string[];
}

export interface AiAgentSettingsItem {
  id: string;
  name: string;
  vendor: string;
  description: string;
  pricing: AiAgentPricing;
  isFree: boolean;
  integrationType: AiAgentIntegrationType;
  authModes?: string[];
  docsUrl: string;
  supportsBaseUrl: boolean;
  capabilities?: string[];
  integration: AiAgentIntegrationState;
  tutorial: AiAgentTutorial;
}

export interface AiAgentSettingsPayload {
  agents: AiAgentSettingsItem[];
  activeAgentId: string;
}

export interface AiProviderQuota {
  used: number | null;
  limit: number | null;
  remaining: number | null;
  unit: 'requests' | 'tokens' | 'credits' | 'usd' | null;
  resetAt: string | null;
  available: boolean;
}

export interface AiProviderPermissionProfile {
  agentId: string;
  accessMode: 'full_access' | 'workspace_only' | 'restricted_paths' | 'read_only';
  allowRoot: boolean;
  runAsUser: string;
  allowedPaths: string[];
  deniedPaths: string[];
  canWriteFiles: boolean;
  readOnly: boolean;
  allowShell: boolean;
  allowSensitiveTools: boolean;
  allowNetwork: boolean;
  allowGit: boolean;
  allowBackupRestore: boolean;
  allowedTools: string[];
  updatedAt: string;
}

export interface AiProviderInfo {
  id: string;
  name: string;
  vendor: string;
  description: string;
  pricing: AiAgentPricing;
  integrationType: AiAgentIntegrationType;
  authModes: string[];
  docsUrl: string;
  integration: AiAgentIntegrationState;
  capabilities: string[];
  models: string[];
  defaults: {
    model: string;
    reasoningEffort: string;
  };
  quota: AiProviderQuota;
  permissions: AiProviderPermissionProfile;
  availability: {
    chat: boolean;
    configured: boolean;
    enabled: boolean;
  };
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
    disk: {
      path: string;
      mountPoint: string;
      totalBytes: number | null;
      usedBytes: number | null;
      availableBytes: number | null;
      usedPercent: number | null;
    } | null;
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
export type DeployedAppCategory = 'system' | 'user' | 'docker' | 'custom';
export type DeployedAppDescriptionJobStatus = 'idle' | 'pending' | 'running' | 'completed' | 'error';

export interface ToolsDeployedApp {
  id: string;
  source: DeployedAppSource;
  name: string;
  status: DeployedAppStatus;
  normalizedStatus: DeployedAppStatus;
  isRunning: boolean;
  isStopped: boolean;
  isSystem: boolean;
  category: DeployedAppCategory;
  searchableText: string;
  descriptionJobStatus: DeployedAppDescriptionJobStatus;
  aiDescription: string;
  aiDescriptionGeneratedAt: string;
  aiDescriptionProvider: string;
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

export interface ToolsDeployedAppGeneratedDescription {
  appId: string;
  name: string;
  description: string;
  generatedAt: string;
}

export interface ToolsDeployedAppDescribeJobResult {
  scannedAt: string;
  generatedAt: string;
  missingAppIds: string[];
  descriptions: ToolsDeployedAppGeneratedDescription[];
}

export interface ToolsDeployedAppDescribeJob {
  id: string;
  status: Exclude<DeployedAppDescriptionJobStatus, 'idle'>;
  provider: string;
  activeAgentId: string;
  appIds: string[];
  error: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt: string;
  result: ToolsDeployedAppDescribeJobResult;
}

export interface ToolsDeployedAppDescribeResponse {
  scannedAt: string;
  job: ToolsDeployedAppDescribeJob;
}

export interface ToolsStorageLocalEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  sizeBytes: number | null;
  modifiedAt: string;
}

export interface ToolsStorageLocalListPayload {
  path: string;
  parentPath: string;
  sortBy: 'name' | 'size' | 'mtime';
  sortOrder: 'asc' | 'desc';
  totalEntries: number;
  entries: ToolsStorageLocalEntry[];
}

export interface ToolsStorageHeavyEntry {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'other';
  sizeBytes: number;
}

export interface ToolsStorageHeavyPayload {
  path: string;
  scannedAt: string;
  maxDepth: number;
  limit: number;
  totalBytes: number;
  entries: ToolsStorageHeavyEntry[];
}

export interface ToolsDriveAccount {
  id: string;
  alias: string;
  authMode: 'rclone';
  rootFolderId: string;
  status: 'pending' | 'active' | 'error';
  lastError: string;
  details: {
    remoteName: string;
    configPath: string;
    rootPath: string;
    provider: string;
    connectionState: 'active' | 'invalid' | 'pending' | 'unknown';
    validatedAt: string;
    about?: {
      limit: number | null;
      usage: number | null;
      usageInDrive: number | null;
      free?: number | null;
    };
  };
  createdAt: string;
  updatedAt: string;
}

export interface ToolsDriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
  modifiedAt: string;
  parents: string[];
  appProperties: Record<string, string>;
}

export interface ToolsDriveFilesPayload {
  account: ToolsDriveAccount;
  folderId: string;
  nextPageToken: string;
  files: ToolsDriveFileItem[];
}

export type ToolsStorageJobType =
  | 'cleanup_residual_analyze'
  | 'drive_upload_files'
  | 'deployed_backup_create'
  | 'deployed_backup_restore'
  | 'git_merge_branches'
  | 'local_delete_paths'
  | 'project_context_refresh';
export type ToolsStorageJobStatus = 'pending' | 'running' | 'completed' | 'error';

export interface ToolsStorageJob {
  id: string;
  type: ToolsStorageJobType;
  status: ToolsStorageJobStatus;
  payload: Record<string, any>;
  progress: Record<string, any>;
  result: Record<string, any>;
  error: string;
  log: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt: string;
}

export interface ToolsDeployedAppBackupItem {
  id: string;
  appId: string;
  driveFileId: string;
  remoteFileId?: string;
  accountId: string;
  accountAlias: string;
  name: string;
  targetPath: string;
  sizeBytes: number | null;
  createdAt: string;
  modifiedAt?: string;
  appProperties?: Record<string, string>;
}

export interface ToolsStorageOverview {
  localDisk: {
    path: string;
    totalBytes: number | null;
    usedBytes: number | null;
    availableBytes: number | null;
    usagePercent: string;
  };
  cloud: {
    accountId: string;
    available: boolean;
    error?: string;
    quota: {
      limit: number | null;
      usage: number | null;
      usageInDrive: number | null;
    };
  };
  jobs: ToolsStorageJob[];
}

export interface ToolsWireGuardServiceState {
  unit: string;
  isActive: boolean;
  activeState: string;
  subState: string;
  unitFileState: string;
  loadState: string;
  description?: string;
  fragmentPath?: string;
}

export interface ToolsWireGuardPeer {
  id: string;
  name: string;
  publicKey: string;
  clientIp: string;
  allowedIps: string;
  endpoint: string;
  latestHandshakeAt: string;
  secondsSinceHandshake: number | null;
  active: boolean;
  transferRxBytes: number;
  transferTxBytes: number;
  persistentKeepalive: number | null;
  createdAt: string;
  notes: string;
  hasProfile: boolean;
}

export interface ToolsWireGuardStatus {
  runtime: {
    interfaceName: string;
    availableInterfaces: string[];
    configPath: string;
    configExists: boolean;
  };
  binaries: {
    wg: boolean;
    wgQuick: boolean;
    qrencode: boolean;
    systemctl: boolean;
  };
  service: ToolsWireGuardServiceState;
  interface: {
    name: string;
    address: string;
    listenPort: number | null;
    postUp: string;
    postDown: string;
    hasPrivateKey: boolean;
    publicKey: string;
    fwmark: string;
    configError: string;
  };
  profileDefaults: {
    endpointHost: string;
    defaultDns: string;
    defaultAllowedIps: string;
    defaultKeepaliveSeconds: number;
    updatedAt: string;
  };
  peers: ToolsWireGuardPeer[];
  stats: {
    configuredPeers: number;
    activePeers: number;
    totalRxBytes: number;
    totalTxBytes: number;
    activeWindowSeconds: number;
    updatedAt: string;
  };
}

export interface ToolsWireGuardDiagnostics {
  runtime: ToolsWireGuardStatus['runtime'];
  service: ToolsWireGuardServiceState;
  checks: {
    wgBinary: boolean;
    wgQuickBinary: boolean;
    systemctlBinary: boolean;
    configExists: boolean;
    configStripOk: boolean;
    configStripError: string;
  };
  logs: {
    lines: number;
    output: string;
  };
}

export interface ToolsWireGuardPeerProfile {
  peerId: string;
  interfaceName: string;
  name: string;
  publicKey: string;
  fileName: string;
  config: string;
}

export interface ToolsStorageResidualCandidate {
  id: string;
  path: string;
  name: string;
  type: 'file' | 'directory' | 'other';
  sizeBytes: number;
  modifiedAt: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  risk: 'high' | 'medium' | 'low';
  category: 'temporary' | 'logs' | 'cache' | 'backup' | 'artifact' | 'residual' | 'other';
  analysisSource: 'ai' | 'heuristic';
  score: number;
}

export interface ToolsStorageResidualAnalysis {
  scannedAt: string;
  roots: string[];
  maxDepth: number;
  limit: number;
  candidates: ToolsStorageResidualCandidate[];
  ai: {
    requested: boolean;
    used: boolean;
    fallbackReason: string;
    providerId?: string;
    providerName?: string;
    attemptedProviders?: string[];
  };
  summary?: {
    totalCandidates: number;
    totalBytes: number;
    byCategory: Record<string, number>;
    criteria: string[];
    pipeline: string;
  };
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
  branches?: string[];
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
  targetBranch?: string;
  remote?: string;
  branchSwitched?: boolean;
  branchCreated?: boolean;
  output: string;
}

export interface ToolsGitResolvePayload {
  conversationId: number;
  prompt: string;
  autoSend: boolean;
}

export interface ToolsGitBranchesPayload {
  repo: ToolsGitRepoSummary;
  branches: string[];
}

export interface ToolsGitMergePayload {
  sourceBranch: string;
  targetBranch: string;
  output?: string;
  status?: 'queued' | 'merged' | 'conflict' | 'failed';
  hasConflicts?: boolean;
  conflictFiles?: string[];
}

export interface Capabilities {
  web: boolean;
  code: boolean;
  memory: boolean;
}

export interface CodexQuotaWindow {
  used: number;
  limit: number;
  remaining: number;
  unit: "percent_of_window";
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
