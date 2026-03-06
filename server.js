require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync, spawn } = require('child_process');
const { Transform, pipeline } = require('stream');
const util = require('util');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const execFileAsync = util.promisify(execFile);
const pipelineAsync = util.promisify(pipeline);
const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
const defaultWebhookUrl = String(process.env.WEBHOOK_URL || '').trim();
let resolvedCodexPath = null;
let resolvedGeminiPath = null;
const sentMilestones = new Set();
const DEFAULT_CHAT_MODEL = 'gpt-5.3-codex';
const DEFAULT_REASONING_EFFORT = 'xhigh';
const DISCORD_WEBHOOK_PREFIXES = [
  'https://discord.com/api/webhooks/',
  'https://discordapp.com/api/webhooks/',
  'https://ptb.discord.com/api/webhooks/',
  'https://canary.discord.com/api/webhooks/'
];
const DISCORD_RESULT_SNIPPET_MAX_LEN = 1400;
const DISCORD_MESSAGE_MAX_LEN = 1900;
const supportedAiAgents = [
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    description: 'Agente de terminal para tareas de codigo y repositorios.',
    pricing: 'paid',
    integrationType: 'oauth',
    docsUrl: 'https://developers.openai.com/codex/cli',
    supportsBaseUrl: false
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    vendor: 'Google',
    description: 'Agente de terminal de Gemini con ejecucion de comandos y cambios en archivos.',
    pricing: 'freemium',
    integrationType: 'api_key',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    supportsBaseUrl: false
  }
];
const supportedAiAgentsById = new Map(
  supportedAiAgents.map((agent) => [agent.id, agent])
);
const aiAgentTutorialsById = {
  'codex-cli': {
    title: 'Integracion Codex CLI',
    steps: [
      'Instala Codex CLI en el servidor donde corre CodexWeb.',
      'En Settings > Integraciones IA > Codex CLI, pulsa "Iniciar sesion con ChatGPT".',
      'Abre el enlace de verificacion, pega el codigo y confirma.',
      'Vuelve a CodexWeb, refresca y verifica estado "Conectado".',
      'Activa la integracion y seleccionalo en "Agente en uso".'
    ],
    notes: [
      'No necesitas API key para esta integracion cuando usas login ChatGPT.',
      'Codex CLI funciona en modo agente y puede ejecutar comandos del sistema.'
    ]
  },
  'gemini-cli': {
    title: 'Integracion Gemini CLI (modo agente)',
    steps: [
      'Instala Gemini CLI en el servidor: npm install -g @google/gemini-cli',
      'Crea una API key en Google AI Studio.',
      'En CodexWeb > Settings > Integraciones IA > Gemini CLI, activa la integracion.',
      'Pega la API key, guarda y selecciona Gemini CLI en "Agente en uso".',
      'Abre un chat nuevo y prueba una tarea de sistema (por ejemplo, listar archivos del proyecto).'
    ],
    notes: [
      'Si el binario no esta en PATH, define GEMINI_CMD con la ruta del ejecutable.',
      'Gemini se ejecuta en modo agente con acceso a archivos y comandos de terminal.',
      'Para acceso total del sistema define GEMINI_INCLUDE_DIRECTORIES=/ (modo root del host).'
    ]
  }
};
const chatGptModelOptions = [
  DEFAULT_CHAT_MODEL,
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
  'o3',
  'o4-mini'
];
const geminiModelOptions = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash'
];
const DEFAULT_GEMINI_CHAT_MODEL = geminiModelOptions[0];
const chatReasoningEffortOptions = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const allowedReasoningEfforts = new Set(chatReasoningEffortOptions);
const supportedChatRuntimeAgentIds = new Set(['codex-cli', 'gemini-cli']);
const geminiReasoningInstructionsByEffort = {
  minimal:
    'Responde de forma muy breve y directa. Evita exploraciones largas y ve al punto.',
  low:
    'Mantén una respuesta compacta con razonamiento corto y práctico, priorizando la solución.',
  medium:
    'Equilibra claridad y detalle, explicando decisiones relevantes sin extenderte en exceso.',
  high:
    'Analiza con mayor profundidad, explicando trade-offs y verificaciones importantes.',
  xhigh:
    'Haz un análisis profundo, con validaciones explícitas, posibles riesgos y alternativas.'
};
const uploadsDir = path.join(__dirname, 'uploads');
const pendingUploadsDir = path.join(uploadsDir, 'pending');
const uploadsDirUrlPath = uploadsDir.replace(/\\/g, '/');
const legacyUploadsRouteBasePath = uploadsDirUrlPath.startsWith('/') ? uploadsDirUrlPath : `/${uploadsDirUrlPath}`;
const codexUsersRootDir = path.join(__dirname, '.codex_users');
const restartStatePath = path.join(__dirname, 'restart-state.json');
const restartLogLimit = 200;
const maxAttachments = 5;
const maxAttachmentSizeBytes = 500 * 1024 * 1024;
const maxAttachmentSizeMb = Math.floor(maxAttachmentSizeBytes / (1024 * 1024));
const maxJsonBodyBytes = 2 * 1024 * 1024;
const maxJsonBodyMb = Math.floor(maxJsonBodyBytes / (1024 * 1024));
const configuredAutoContinuationLimit = Number.parseInt(
  String(process.env.CHAT_AUTO_CONTINUATIONS || '2'),
  10
);
const chatAutoContinuationLimit =
  Number.isInteger(configuredAutoContinuationLimit) && configuredAutoContinuationLimit >= 0
    ? Math.min(configuredAutoContinuationLimit, 6)
    : 2;
const configuredContinuationTailChars = Number.parseInt(
  String(process.env.CHAT_CONTINUATION_TAIL_CHARS || '6000'),
  10
);
const chatContinuationTailChars =
  Number.isInteger(configuredContinuationTailChars) && configuredContinuationTailChars >= 500
    ? Math.min(configuredContinuationTailChars, 20000)
    : 6000;
const configuredChatRequestTimeoutMs = Number.parseInt(
  String(process.env.CHAT_REQUEST_TIMEOUT_MS || String(1000 * 60 * 20)),
  10
);
const chatRequestTimeoutMs =
  Number.isInteger(configuredChatRequestTimeoutMs) && configuredChatRequestTimeoutMs >= 60 * 1000
    ? configuredChatRequestTimeoutMs
    : 1000 * 60 * 20;
const geminiIncludeDirectories = (() => {
  const parsed = String(process.env.GEMINI_INCLUDE_DIRECTORIES || '/')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (parsed.length === 0) {
    return ['/'];
  }
  return parsed.filter((value, index, list) => list.indexOf(value) === index);
})();
const codexQuotaCacheTtlMs = 15000;
const adminUsers = new Set(
  String(process.env.ADMIN_USERS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
adminUsers.add('admin');
const pendingUploadTtlMs = 1000 * 60 * 60;
const pendingUploads = new Map();
let restartScheduled = false;
let restartState = null;
const codexQuotaStateByUser = new Map();
const activeChatRuns = new Map();
const activeCodexLoginFlows = new Map();
let activeChatRunClientSeq = 0;
const repoContextScanTtlMs = 45 * 1000;
const repoContextMaxIndexedFiles = 6000;
const repoContextMaxCandidates = 8;
const repoContextMaxTopLevelEntries = 10;
const repoContextIgnoredDirs = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tmp',
  'temp',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.codex_users',
  'uploads',
  'test-results'
]);
const repoContextAllowedTextExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.env',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.sql',
  '.graphql',
  '.gql',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.cs',
  '.c',
  '.h',
  '.hpp',
  '.cpp',
  '.vue',
  '.svelte'
]);
const repoContextAllowedBareNames = new Set([
  'dockerfile',
  'makefile',
  'readme',
  'readme.md',
  'license',
  'license.md'
]);
const repoContextStopWords = new Set([
  'a',
  'al',
  'algo',
  'and',
  'como',
  'con',
  'de',
  'del',
  'do',
  'el',
  'en',
  'este',
  'esta',
  'esto',
  'for',
  'haz',
  'hacer',
  'i',
  'la',
  'las',
  'lo',
  'los',
  'me',
  'mi',
  'my',
  'need',
  'necesito',
  'of',
  'para',
  'por',
  'que',
  'quiero',
  'se',
  'the',
  'to',
  'un',
  'una',
  'y'
]);
const repoRootDir = resolveRepoRootDir(__dirname);
let repoContextIndexCache = null;
const taskSnapshotsRootDir = path.join(__dirname, 'tmp', 'task-snapshots');
const taskCommandOutputMaxChars = 12000;
const taskResultSummaryMaxChars = 5000;
const taskPlanMaxChars = 8000;
const taskDashboardLimitMax = 100;
const toolsSearchLimitMax = 40;
const toolsSearchMinQueryLen = 2;
const observabilityGlobalLatencyLimit = 500;
const observabilityEndpointLatencyLimit = 140;
const observabilityRecentErrorsLimit = 140;
const observabilityEndpointsLimit = 80;
const gitToolsScanTtlMs = 12000;
const gitToolsMaxDepth = 6;
const gitToolsMaxRepos = 80;
const gitToolsCommandTimeoutMs = 45000;
const gitToolsScanRoots = resolveGitToolsScanRoots(process.env.GIT_TOOLS_SCAN_ROOTS, [repoRootDir]);
const deployedAppsScanTtlMs = 12000;
const deployedAppsMaxSystemdUnits = 80;
const deployedAppsDefaultLogLines = 180;
const deployedAppsMaxLogLines = 1000;
const deployedAppsDescribeMaxItems = 20;
const deployedAppsDescribeTimeoutMs = 1000 * 60 * 2;
const gitToolsIgnoredDirs = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  '.codex_users',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tmp',
  'temp',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  'uploads',
  'test-results'
]);
let gitToolsRepoCache = {
  scannedAtMs: 0,
  repos: []
};
const commandExistsCache = new Map();
let deployedAppsCache = {
  scannedAtMs: 0,
  apps: []
};

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const defaultDbPath = fs.existsSync(path.join(__dirname, 'app.db')) ? 'app.db' : 'chat.db';
const dbPath = process.env.DB_PATH || defaultDbPath;
const db = new Database(path.join(__dirname, dbPath));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(pendingUploadsDir, { recursive: true });
fs.mkdirSync(codexUsersRootDir, { recursive: true });
fs.mkdirSync(taskSnapshotsRootDir, { recursive: true });

const observabilityState = {
  startedAtMs: Date.now(),
  totalRequests: 0,
  totalErrors: 0,
  recentLatenciesMs: [],
  endpointStats: new Map(),
  recentErrors: []
};
let processCpuSnapshot = {
  usage: process.cpuUsage(),
  atMs: Date.now()
};

function truncateForNotify(text, maxLen = 300) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) {
    return 'n/a';
  }
  return value.length > maxLen ? `${value.slice(0, maxLen - 3)}...` : value;
}

function nowIso() {
  return new Date().toISOString();
}

function resolveRepoRootDir(startDir) {
  let current = path.resolve(startDir || __dirname);
  while (true) {
    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir || __dirname);
    }
    current = parent;
  }
}

function normalizeAbsoluteDirPath(rawPath) {
  const value = String(rawPath || '').trim();
  if (!value) return '';
  try {
    return path.resolve(value);
  } catch (_error) {
    return '';
  }
}

function resolveGitToolsScanRoots(rawValue, fallbackDirs = []) {
  const requested = String(rawValue || '')
    .split(',')
    .map((entry) => normalizeAbsoluteDirPath(entry))
    .filter(Boolean);
  const source =
    requested.length > 0
      ? requested
      : (Array.isArray(fallbackDirs) ? fallbackDirs : [fallbackDirs]);
  const resolved = [];
  const seen = new Set();

  source.forEach((entry) => {
    const absolutePath = normalizeAbsoluteDirPath(entry);
    if (!absolutePath || seen.has(absolutePath)) return;
    let stats = null;
    try {
      stats = fs.statSync(absolutePath);
    } catch (_error) {
      stats = null;
    }
    if (!stats || !stats.isDirectory()) return;
    seen.add(absolutePath);
    resolved.push(absolutePath);
  });

  if (resolved.length > 0) {
    return resolved;
  }
  return [repoRootDir];
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function getSafeUserId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function getUserCodexHome(userId) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    throw new Error('INVALID_USER_ID');
  }
  const target = path.join(codexUsersRootDir, `user_${safeUserId}`);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function getUserCodexSessionsDir(userId) {
  return path.join(getUserCodexHome(userId), 'sessions');
}

function getCodexEnvForUser(userId, options = {}) {
  const username =
    options && typeof options.username === 'string'
      ? options.username
      : '';
  const gitIdentity = buildGitIdentityFromUsername(username);
  return {
    ...process.env,
    CODEX_HOME: getUserCodexHome(userId),
    ...buildGitIdentityEnv(gitIdentity)
  };
}

function getCodexQuotaStateForUser(userId) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    return {
      fetchedAtMs: 0,
      payload: null,
      lastSnapshot: null
    };
  }
  if (!codexQuotaStateByUser.has(safeUserId)) {
    codexQuotaStateByUser.set(safeUserId, {
      fetchedAtMs: 0,
      payload: null,
      lastSnapshot: null
    });
  }
  return codexQuotaStateByUser.get(safeUserId);
}

function updateCodexQuotaStateForUser(userId, snapshot) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) return;
  const state = getCodexQuotaStateForUser(safeUserId);
  state.fetchedAtMs = Date.now();
  state.payload = snapshot || null;
  if (snapshot) {
    state.lastSnapshot = snapshot;
  }
  codexQuotaStateByUser.set(safeUserId, state);
}

function normalizeCodexStatusText(rawValue, fallback = '') {
  const cleaned = stripAnsi(rawValue)
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned) return cleaned;
  return String(fallback || '').trim();
}

function readJsonObjectFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function decodeJwtPayloadUnsafe(token) {
  const rawToken = String(token || '').trim();
  if (!rawToken) return null;
  const parts = rawToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payloadRaw = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadRaw);
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_error) {
    return null;
  }
}

function inferCodexAuthMethod(statusText, authMode, hasApiKey) {
  const hints = [String(authMode || ''), String(statusText || '')]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (hints.some((value) => value.includes('chatgpt'))) {
    return 'chatgpt';
  }
  if (
    hints.some((value) => value.includes('api key') || value.includes('api_key') || value.includes('api-key')) ||
    hasApiKey
  ) {
    return 'api_key';
  }
  if (hints.some((value) => value.includes('logged in'))) {
    return 'session';
  }
  return '';
}

function getCodexAuthDetailsForUser(userId, statusText) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    return null;
  }
  const codexHome = getUserCodexHome(safeUserId);
  const authPath = path.join(codexHome, 'auth.json');
  const rawAuth = readJsonObjectFileSafe(authPath);
  const tokens = rawAuth && rawAuth.tokens && typeof rawAuth.tokens === 'object' ? rawAuth.tokens : {};
  const apiKeyRaw =
    rawAuth && Object.prototype.hasOwnProperty.call(rawAuth, 'OPENAI_API_KEY')
      ? rawAuth.OPENAI_API_KEY
      : '';
  const hasApiKey = typeof apiKeyRaw === 'string' && Boolean(apiKeyRaw.trim());
  const authMode = rawAuth && typeof rawAuth.auth_mode === 'string' ? rawAuth.auth_mode.trim() : '';
  const accountId = typeof tokens.account_id === 'string' ? tokens.account_id.trim() : '';
  const hasRefreshToken = typeof tokens.refresh_token === 'string' && Boolean(tokens.refresh_token.trim());
  const idTokenPayload = decodeJwtPayloadUnsafe(
    typeof tokens.id_token === 'string' ? tokens.id_token : ''
  );
  const email = idTokenPayload && typeof idTokenPayload.email === 'string' ? idTokenPayload.email.trim() : '';
  const emailVerified = Boolean(idTokenPayload && idTokenPayload.email_verified);
  const subject = idTokenPayload && typeof idTokenPayload.sub === 'string' ? idTokenPayload.sub.trim() : '';
  const issuer = idTokenPayload && typeof idTokenPayload.iss === 'string' ? idTokenPayload.iss.trim() : '';
  const authProvider =
    idTokenPayload && typeof idTokenPayload.auth_provider === 'string'
      ? idTokenPayload.auth_provider.trim()
      : '';

  const issuedAtSeconds = Number(idTokenPayload && idTokenPayload.iat);
  const expiresAtSeconds = Number(idTokenPayload && idTokenPayload.exp);
  const tokenIssuedAt =
    Number.isFinite(issuedAtSeconds) && issuedAtSeconds > 0
      ? new Date(issuedAtSeconds * 1000).toISOString()
      : '';
  const tokenExpiresAt =
    Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
      ? new Date(expiresAtSeconds * 1000).toISOString()
      : '';

  return {
    checkedAt: nowIso(),
    authMethod: inferCodexAuthMethod(statusText, authMode, hasApiKey),
    authMode,
    accountId,
    email,
    emailVerified,
    subject,
    issuer,
    authProvider,
    lastRefresh: rawAuth && typeof rawAuth.last_refresh === 'string' ? rawAuth.last_refresh : '',
    tokenIssuedAt,
    tokenExpiresAt,
    hasRefreshToken,
    hasApiKey
  };
}

function buildActiveChatRunKey(userId, conversationId) {
  return `${Number(userId)}:${Number(conversationId)}`;
}

function terminateActiveChatRun(activeRun, reason = 'killed_by_user') {
  if (!activeRun || !activeRun.process) return false;
  activeRun.killRequested = true;
  activeRun.killReason = String(reason || 'killed_by_user');
  const proc = activeRun.process;
  if (proc.exitCode !== null || proc.killed) {
    return false;
  }
  let terminated = false;
  try {
    terminated = proc.kill('SIGTERM');
  } catch (_error) {
    terminated = false;
  }
  if (terminated) {
    const forceKillTimer = setTimeout(() => {
      if (proc.exitCode !== null || proc.killed) return;
      try {
        proc.kill('SIGKILL');
      } catch (_error) {
        // best effort
      }
    }, 2500);
    if (forceKillTimer && typeof forceKillTimer.unref === 'function') {
      forceKillTimer.unref();
    }
  }
  return terminated;
}

function registerActiveChatRun(userId, conversationId, processHandle) {
  const key = buildActiveChatRunKey(userId, conversationId);
  const existing = activeChatRuns.get(key);
  if (existing && existing.process && existing.process.exitCode === null && !existing.process.killed) {
    terminateActiveChatRun(existing, 'superseded_by_new_request');
  }
  const activeRun = {
    key,
    id: ++activeChatRunClientSeq,
    userId: Number(userId),
    conversationId: Number(conversationId),
    process: processHandle,
    startedAtMs: Date.now(),
    killRequested: false,
    killReason: ''
  };
  activeChatRuns.set(key, activeRun);
  return activeRun;
}

function clearActiveChatRun(activeRun) {
  if (!activeRun) return;
  const current = activeChatRuns.get(activeRun.key);
  if (current && current.id === activeRun.id) {
    activeChatRuns.delete(activeRun.key);
  }
}

function hasActiveChatRun(userId, conversationId) {
  const key = buildActiveChatRunKey(userId, conversationId);
  const activeRun = activeChatRuns.get(key);
  if (!activeRun || !activeRun.process) return false;
  if (activeRun.process.exitCode !== null || activeRun.process.killed) {
    clearActiveChatRun(activeRun);
    return false;
  }
  return true;
}

function notifyCodexLoginFlowWaiters(flow) {
  if (!flow || !Array.isArray(flow.waiters) || flow.waiters.length === 0) return;
  const waiters = flow.waiters.splice(0);
  waiters.forEach((fn) => {
    try {
      fn();
    } catch (_error) {
      // no-op
    }
  });
}

function serializeCodexLoginFlow(flow) {
  if (!flow || typeof flow !== 'object') return null;
  return {
    startedAt: flow.startedAt || '',
    verificationUri: flow.verificationUri || '',
    userCode: flow.userCode || '',
    expiresAt: flow.expiresAt || '',
    inProgress: Boolean(flow.inProgress),
    completed: Boolean(flow.completed),
    failed: Boolean(flow.failed),
    cancelled: Boolean(flow.cancelled),
    statusText: normalizeCodexStatusText(flow.statusText || ''),
    error: normalizeCodexStatusText(flow.error || '')
  };
}

function parseCodexDeviceAuthHints(flow, chunkText) {
  if (!flow) return;
  const text = stripAnsi(chunkText);
  if (!text.trim()) return;

  if (!flow.verificationUri) {
    const urlMatch = text.match(/https?:\/\/[^\s)]+/i);
    if (urlMatch) {
      flow.verificationUri = String(urlMatch[0]).trim();
    }
  }

  if (!flow.userCode) {
    const codeMatch = text.match(/\b[A-Z0-9]{4,6}-[A-Z0-9]{4,8}\b/);
    if (codeMatch) {
      flow.userCode = String(codeMatch[0]).trim();
      if (!flow.expiresAt) {
        flow.expiresAt = new Date(flow.startedAtMs + 15 * 60 * 1000).toISOString();
      }
    }
  }

  const lowered = text.toLowerCase();
  if (!flow.completed && (lowered.includes('logged in using chatgpt') || lowered.includes('logged in'))) {
    flow.completed = true;
    flow.inProgress = false;
    flow.statusText = normalizeCodexStatusText(text, 'Sesión iniciada en Codex CLI.');
  }
}

function terminateCodexLoginFlow(flow, reason = 'cancelled_by_user') {
  if (!flow || !flow.process) return false;
  flow.inProgress = false;
  flow.cancelled = true;
  flow.statusText = reason;
  const proc = flow.process;
  if (proc.exitCode !== null || proc.killed) {
    return false;
  }
  let terminated = false;
  try {
    terminated = proc.kill('SIGTERM');
  } catch (_error) {
    terminated = false;
  }
  if (terminated) {
    const forceKillTimer = setTimeout(() => {
      if (proc.exitCode !== null || proc.killed) return;
      try {
        proc.kill('SIGKILL');
      } catch (_error) {
        // best effort
      }
    }, 2500);
    if (forceKillTimer && typeof forceKillTimer.unref === 'function') {
      forceKillTimer.unref();
    }
  }
  return terminated;
}

function getActiveCodexLoginFlow(userId) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) return null;
  const flow = activeCodexLoginFlows.get(safeUserId);
  if (!flow) return null;
  if (!flow.process || flow.process.exitCode !== null || flow.process.killed || !flow.inProgress) {
    activeCodexLoginFlows.delete(safeUserId);
    return null;
  }
  return flow;
}

async function getCodexAuthStatusForUser(userId, options = {}) {
  const codexPath = await resolveCodexPath();
  const env = getCodexEnvForUser(userId, options);
  try {
    const result = await execFileAsync(codexPath, ['login', 'status'], {
      env,
      cwd: process.cwd(),
      timeout: 15000,
      maxBuffer: 128 * 1024
    });
    const statusText = normalizeCodexStatusText(result && result.stdout, 'Logged in using ChatGPT');
    return {
      loggedIn: true,
      statusText,
      details: getCodexAuthDetailsForUser(userId, statusText)
    };
  } catch (error) {
    const outText = normalizeCodexStatusText(
      `${error && error.stdout ? error.stdout : ''}\n${error && error.stderr ? error.stderr : ''}`
    );
    const fallback = normalizeCodexStatusText(error && error.message ? error.message : '', 'Not logged in');
    const statusText = outText || fallback || 'Not logged in';
    const notLogged =
      statusText.toLowerCase().includes('not logged in') ||
      statusText.toLowerCase().includes('no auth') ||
      statusText.toLowerCase().includes('not authenticated');
    return {
      loggedIn: !notLogged && !String(statusText).toLowerCase().includes('error'),
      statusText,
      details: getCodexAuthDetailsForUser(userId, statusText)
    };
  }
}

function waitForCodexLoginBootstrap(flow, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!flow || typeof flow !== 'object') {
      resolve();
      return;
    }
    if (flow.userCode || flow.verificationUri || flow.completed || flow.failed || !flow.inProgress) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      const idx = flow.waiters.indexOf(done);
      if (idx >= 0) {
        flow.waiters.splice(idx, 1);
      }
      resolve();
    }, timeoutMs);
    flow.waiters.push(done);
  });
}

function readNumberField(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampPercentage(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Number(value)));
}

function normalizeRateWindow(rawWindow) {
  if (!rawWindow || typeof rawWindow !== 'object') {
    return null;
  }

  const usedRaw =
    Object.prototype.hasOwnProperty.call(rawWindow, 'used_percent')
      ? rawWindow.used_percent
      : rawWindow.usedPercent;
  const usedPercent = clampPercentage(readNumberField(usedRaw));
  if (!Number.isFinite(usedPercent)) {
    return null;
  }

  const windowMinutesRaw =
    Object.prototype.hasOwnProperty.call(rawWindow, 'window_minutes')
      ? rawWindow.window_minutes
      : rawWindow.windowMinutes;
  const windowMinutesNum = readNumberField(windowMinutesRaw);
  const windowMinutes =
    Number.isInteger(windowMinutesNum) && windowMinutesNum > 0 ? windowMinutesNum : 0;

  const resetRaw =
    Object.prototype.hasOwnProperty.call(rawWindow, 'resets_at')
      ? rawWindow.resets_at
      : rawWindow.resetsAt;
  const resetSeconds = readNumberField(resetRaw);
  const resetAt =
    Number.isFinite(resetSeconds) && resetSeconds > 0
      ? new Date(resetSeconds * 1000).toISOString()
      : '';

  const totalPercent = 100;
  const remainingPercent = clampPercentage(totalPercent - usedPercent);

  return {
    totalPercent,
    usedPercent: Number(usedPercent.toFixed(1)),
    remainingPercent: Number((remainingPercent || 0).toFixed(1)),
    windowMinutes,
    resetAt
  };
}

function normalizeCredits(rawCredits) {
  const credits = rawCredits && typeof rawCredits === 'object' ? rawCredits : {};
  const hasCredits =
    Object.prototype.hasOwnProperty.call(credits, 'has_credits')
      ? Boolean(credits.has_credits)
      : Boolean(credits.hasCredits);
  const unlimited = Boolean(credits.unlimited);
  const balance = readNumberField(credits.balance);
  return {
    hasCredits,
    unlimited,
    balance: Number.isFinite(balance) ? balance : null
  };
}

function normalizeCodexRateLimits(rawRateLimits) {
  if (!rawRateLimits || typeof rawRateLimits !== 'object') {
    return null;
  }
  const primary = normalizeRateWindow(rawRateLimits.primary);
  const secondary = normalizeRateWindow(rawRateLimits.secondary);
  if (!primary && !secondary) {
    return null;
  }
  return {
    limitId: String(rawRateLimits.limit_id || rawRateLimits.limitId || 'codex'),
    planType: String(rawRateLimits.plan_type || rawRateLimits.planType || ''),
    primary,
    secondary,
    credits: normalizeCredits(rawRateLimits.credits)
  };
}

function buildCodexQuotaSnapshot(rawRateLimits, source, observedAt) {
  const normalized = normalizeCodexRateLimits(rawRateLimits);
  if (!normalized) {
    return null;
  }
  const observedAtValue = String(observedAt || '').trim() || nowIso();
  return {
    source: String(source || 'unknown'),
    observedAt: observedAtValue,
    fetchedAt: nowIso(),
    limitId: normalized.limitId,
    planType: normalized.planType,
    primary: normalized.primary,
    secondary: normalized.secondary,
    credits: normalized.credits
  };
}

function extractRateLimitsFromSessionEvent(lineObj) {
  if (!lineObj || typeof lineObj !== 'object') {
    return null;
  }

  if (lineObj.type === 'event_msg' && lineObj.payload && typeof lineObj.payload === 'object') {
    const payloadType = String(lineObj.payload.type || '').trim().toLowerCase();
    if (payloadType === 'token_count' && lineObj.payload.rate_limits) {
      return {
        rateLimits: lineObj.payload.rate_limits,
        observedAt: String(lineObj.timestamp || '')
      };
    }
  }

  return null;
}

function listRecentSessionFiles(rootDir, maxFiles = 20) {
  if (!fs.existsSync(rootDir)) return [];
  const stack = [rootDir];
  const discovered = [];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_error) {
      entries = [];
    }

    entries.forEach((entry) => {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        return;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        return;
      }
      try {
        const stats = fs.statSync(fullPath);
        discovered.push({
          path: fullPath,
          mtimeMs: Number(stats.mtimeMs) || 0
        });
      } catch (_error) {
        // ignore unreadable files
      }
    });
  }

  return discovered
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((entry) => entry.path);
}

function findLatestRateLimitsInSessionFile(filePath) {
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_error) {
    return null;
  }
  if (!raw) return null;

  const lines = raw.split(/\r?\n/);
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const line = String(lines[idx] || '').trim();
    if (!line || line[0] !== '{') continue;
    try {
      const parsed = JSON.parse(line);
      const extracted = extractRateLimitsFromSessionEvent(parsed);
      if (extracted && extracted.rateLimits) {
        return extracted;
      }
    } catch (_error) {
      // ignore malformed lines
    }
  }

  return null;
}

function findLatestRateLimitsFromSessions(sessionsDir) {
  const files = listRecentSessionFiles(sessionsDir, 24);
  for (const filePath of files) {
    const found = findLatestRateLimitsInSessionFile(filePath);
    if (found) {
      return found;
    }
  }
  return null;
}

function getCodexQuotaSnapshotForUser(userId) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    return null;
  }
  const quotaState = getCodexQuotaStateForUser(safeUserId);
  const now = Date.now();
  if (quotaState.payload && now - quotaState.fetchedAtMs < codexQuotaCacheTtlMs) {
    return quotaState.payload;
  }

  let snapshot = null;
  if (quotaState.lastSnapshot && quotaState.lastSnapshot.observedAt) {
    const observedMs = Date.parse(quotaState.lastSnapshot.observedAt);
    if (Number.isFinite(observedMs) && now - observedMs < 1000 * 60 * 60) {
      snapshot = {
        ...quotaState.lastSnapshot,
        fetchedAt: nowIso()
      };
    }
  }

  if (!snapshot) {
    const latest = findLatestRateLimitsFromSessions(getUserCodexSessionsDir(safeUserId));
    if (latest && latest.rateLimits) {
      snapshot = buildCodexQuotaSnapshot(
        latest.rateLimits,
        'session_log',
        latest.observedAt || nowIso()
      );
    }
  }

  quotaState.fetchedAtMs = now;
  quotaState.payload = snapshot || null;
  if (snapshot) {
    quotaState.lastSnapshot = snapshot;
  }
  codexQuotaStateByUser.set(safeUserId, quotaState);
  return snapshot;
}

function buildDefaultRestartState() {
  return {
    attemptId: '',
    active: false,
    phase: 'idle',
    requestedBy: '',
    notifyWebhookUrl: '',
    startedAt: '',
    finishedAt: '',
    updatedAt: '',
    logs: []
  };
}

function normalizeRestartState(rawState) {
  const base = buildDefaultRestartState();
  const input = rawState && typeof rawState === 'object' ? rawState : {};
  const logs = Array.isArray(input.logs) ? input.logs : [];
  base.attemptId = String(input.attemptId || '');
  base.active = Boolean(input.active);
  base.phase = String(input.phase || 'idle');
  base.requestedBy = String(input.requestedBy || '');
  base.notifyWebhookUrl = sanitizeDiscordWebhookUrl(input.notifyWebhookUrl, '');
  base.startedAt = String(input.startedAt || '');
  base.finishedAt = String(input.finishedAt || '');
  base.updatedAt = String(input.updatedAt || '');
  base.logs = logs
    .map((entry) => ({
      at: String((entry && entry.at) || ''),
      message: truncateForNotify((entry && entry.message) || '', 500)
    }))
    .filter((entry) => entry.message)
    .slice(-restartLogLimit);
  return base;
}

function loadRestartStateFromDisk() {
  try {
    if (!fs.existsSync(restartStatePath)) {
      return buildDefaultRestartState();
    }
    const raw = fs.readFileSync(restartStatePath, 'utf8');
    if (!raw || !raw.trim()) {
      return buildDefaultRestartState();
    }
    const parsed = JSON.parse(raw);
    return normalizeRestartState(parsed);
  } catch (_error) {
    return buildDefaultRestartState();
  }
}

function saveRestartStateToDisk(state) {
  try {
    fs.writeFileSync(restartStatePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (_error) {
    // best-effort persistence
  }
}

function syncRestartStateFromDisk() {
  restartState = loadRestartStateFromDisk();
  return restartState;
}

function updateRestartState(mutator) {
  const current = syncRestartStateFromDisk();
  const next = normalizeRestartState(current);
  if (typeof mutator === 'function') {
    mutator(next);
  }
  next.updatedAt = nowIso();
  restartState = normalizeRestartState(next);
  saveRestartStateToDisk(restartState);
  return restartState;
}

function pushRestartLog(message) {
  const safeMessage = truncateForNotify(message, 500);
  if (!safeMessage) return;
  updateRestartState((state) => {
    const logs = Array.isArray(state.logs) ? state.logs : [];
    logs.push({
      at: nowIso(),
      message: safeMessage
    });
    state.logs = logs.slice(-restartLogLimit);
  });
}

function setRestartPhase(phase) {
  updateRestartState((state) => {
    state.phase = String(phase || 'unknown');
  });
}

function beginRestartAttempt(username, options = {}) {
  const safeUser = truncateForNotify(username || 'anon', 80);
  const requestedWebhookUrl =
    options && typeof options.webhookUrl === 'string' ? options.webhookUrl : '';
  const notifyWebhookUrl = sanitizeDiscordWebhookUrl(requestedWebhookUrl, defaultWebhookUrl);
  const attemptId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const startedAt = nowIso();
  restartState = normalizeRestartState({
    attemptId,
    active: true,
    phase: 'requested',
    requestedBy: safeUser,
    notifyWebhookUrl,
    startedAt,
    finishedAt: '',
    updatedAt: startedAt,
    logs: [{ at: startedAt, message: `Reinicio solicitado por ${safeUser}` }]
  });
  saveRestartStateToDisk(restartState);
  return restartState;
}

function finishRestartAttempt(phase, message) {
  updateRestartState((state) => {
    state.active = false;
    state.phase = String(phase || 'failed');
    state.finishedAt = nowIso();
    if (message) {
      const logs = Array.isArray(state.logs) ? state.logs : [];
      logs.push({
        at: nowIso(),
        message: truncateForNotify(message, 500)
      });
      state.logs = logs.slice(-restartLogLimit);
    }
  });
}

function getRestartStatusPayload() {
  const state = syncRestartStateFromDisk();
  return {
    attemptId: state.attemptId,
    active: state.active,
    phase: state.phase,
    requestedBy: state.requestedBy,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    updatedAt: state.updatedAt,
    logs: state.logs
  };
}

function markRestartRecoveredOnStartup() {
  const snapshot = syncRestartStateFromDisk();
  if (!snapshot.active) {
    return;
  }
  const updated = updateRestartState((state) => {
    const logs = Array.isArray(state.logs) ? state.logs : [];
    logs.push({
      at: nowIso(),
      message: `Nuevo proceso iniciado (pid ${process.pid})`
    });
    state.logs = logs.slice(-restartLogLimit);
    state.active = false;
    state.phase = 'completed';
    state.finishedAt = nowIso();
  });
  const webhookUrl = sanitizeDiscordWebhookUrl(snapshot.notifyWebhookUrl, defaultWebhookUrl);
  const startedAtMs = Date.parse(snapshot.startedAt || '');
  const finishedAtMs = Date.parse(updated.finishedAt || '');
  const durationMs =
    Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
      ? Math.max(0, finishedAtMs - startedAtMs)
      : null;
  const restartMessage = buildRestartDiscordMessage({
    status: 'completed',
    username: snapshot.requestedBy,
    attemptId: snapshot.attemptId,
    finishedAt: updated.finishedAt || nowIso(),
    durationMs,
    phase: updated.phase
  });
  if (restartMessage) {
    void notify(restartMessage, { webhookUrl });
  }
}

function markStaleTaskRunsOnStartup() {
  try {
    const timestamp = nowIso();
    const result = markStaleRunningTaskRunsStmt.run(timestamp, timestamp);
    if (result && Number(result.changes) > 0) {
      void notify(`Task runs recuperados tras reinicio: ${Number(result.changes)} marcados como fallidos.`);
    }
  } catch (error) {
    const reason = truncateForNotify(error && error.message ? error.message : 'stale_task_recovery_failed', 180);
    void notify(`WARN stale_task_recovery_failed reason=${reason}`);
  }
}

function sanitizeDiscordWebhookUrl(rawValue, fallback = '') {
  const source = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!source) return String(fallback || '').trim();
  const isAllowed = DISCORD_WEBHOOK_PREFIXES.some((prefix) => source.startsWith(prefix));
  if (!isAllowed) return String(fallback || '').trim();
  if (source.includes(' ')) return String(fallback || '').trim();
  return source;
}

function sanitizeHttpUrl(rawValue, fallback = '') {
  const source = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!source) return String(fallback || '').trim();
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return String(fallback || '').trim();
    }
    if (parsed.username || parsed.password) {
      return String(fallback || '').trim();
    }
    return parsed.toString();
  } catch (_error) {
    return String(fallback || '').trim();
  }
}

function formatDurationMs(durationMs) {
  const safeMs = Number.isFinite(Number(durationMs)) ? Math.max(0, Number(durationMs)) : 0;
  if (safeMs < 1000) return `${safeMs}ms`;
  const seconds = Math.round(safeMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes}m`;
}

function buildChatCompletionDiscordMessage(payload) {
  const safe = payload && typeof payload === 'object' ? payload : {};
  const status = safe.status === 'ok' ? 'listo' : 'error';
  const lines = [
    'CodexWeb - respuesta finalizada',
    `Estado: ${status}`,
    `Usuario: ${truncateForNotify(safe.username || 'anon', 80)}`,
    `Chat: ${Number.isInteger(Number(safe.conversationId)) ? Number(safe.conversationId) : 'n/a'}`,
    `Hora: ${String(safe.finishedAt || nowIso())}`,
    `Duracion: ${formatDurationMs(safe.durationMs)}`,
    `Motivo cierre: ${truncateForNotify(safe.closeReason || 'normal', 120)}`
  ];
  const includeResult = Boolean(safe.includeResult);
  if (includeResult) {
    const compactResult = truncateForNotify(
      String(safe.result || '').trim() || '(Sin salida de Codex)',
      DISCORD_RESULT_SNIPPET_MAX_LEN
    );
    lines.push('');
    lines.push('Resultado:');
    lines.push(compactResult);
  }
  const joined = lines.join('\n').trim();
  return truncateForNotify(joined, DISCORD_MESSAGE_MAX_LEN);
}

function buildRestartDiscordMessage(payload) {
  const safe = payload && typeof payload === 'object' ? payload : {};
  const normalizedStatus = String(safe.status || '').trim().toLowerCase();
  let status = 'actualizado';
  if (normalizedStatus === 'requested') status = 'solicitado';
  if (normalizedStatus === 'completed') status = 'completado';
  if (normalizedStatus === 'failed') status = 'fallido';
  const lines = [
    'CodexWeb - reinicio',
    `Estado: ${status}`,
    `Usuario: ${truncateForNotify(safe.username || 'anon', 80)}`,
    `Intento: ${truncateForNotify(safe.attemptId || 'n/a', 120)}`,
    `Hora: ${String(safe.finishedAt || safe.startedAt || nowIso())}`
  ];
  if (Number.isFinite(Number(safe.durationMs))) {
    lines.push(`Duracion: ${formatDurationMs(safe.durationMs)}`);
  }
  if (safe.phase) {
    lines.push(`Fase: ${truncateForNotify(safe.phase, 80)}`);
  }
  if (safe.reason) {
    lines.push(`Detalle: ${truncateForNotify(safe.reason, 220)}`);
  }
  return truncateForNotify(lines.join('\n').trim(), DISCORD_MESSAGE_MAX_LEN);
}

function notify(msg, options = {}) {
  const requestedWebhook =
    options && typeof options.webhookUrl === 'string' ? options.webhookUrl : '';
  const targetWebhookUrl = sanitizeDiscordWebhookUrl(requestedWebhook, defaultWebhookUrl);
  if (!targetWebhookUrl) {
    return Promise.resolve(false);
  }
  const safeMsg = truncateForNotify(msg, DISCORD_MESSAGE_MAX_LEN);
  try {
    const payload = JSON.stringify({ content: safeMsg });
    return new Promise((resolve) => {
      const curl = spawn(
        'curl',
        ['-4', '-sS', '--max-time', '8', '-H', 'Content-Type: application/json', '-d', payload, targetWebhookUrl],
        {
          stdio: ['ignore', 'ignore', 'pipe']
        }
      );

      curl.stderr.on('data', () => {
        // Best-effort notifications only; ignore stderr output.
      });
      curl.on('error', () => resolve(false));
      curl.on('close', () => resolve(true));
    });
  } catch (_error) {
    return Promise.resolve(false);
  }
}

function toBase64Json(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function sendSse(res, event, payload) {
  if (!res || res.writableEnded || res.destroyed || (res.socket && res.socket.destroyed)) {
    return false;
  }
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${toBase64Json(payload)}\n\n`);
    return true;
  } catch (_error) {
    return false;
  }
}

function sendSseComment(res, comment) {
  if (!res || res.writableEnded || res.destroyed || (res.socket && res.socket.destroyed)) {
    return false;
  }
  try {
    res.write(`: ${String(comment || '').trim() || 'ping'}\n\n`);
    return true;
  } catch (_error) {
    return false;
  }
}

function createClientRequestError(message, statusCode = 400) {
  const error = new Error(String(message || 'Solicitud invalida'));
  error.statusCode = Number.isInteger(statusCode) ? statusCode : 400;
  error.exposeToClient = true;
  return error;
}

function parseNullSeparatedList(rawText) {
  return String(rawText || '')
    .split('\0')
    .map((entry) => normalizeRepoRelativePath(entry))
    .filter(Boolean);
}

function normalizeRepoRelativePath(rawPath) {
  const source = String(rawPath || '')
    .replace(/\\/g, '/')
    .trim();
  if (!source) return '';
  const normalized = path.posix.normalize(source).replace(/^(\.\/)+/, '');
  if (!normalized || normalized === '.' || normalized.includes('\0')) return '';
  if (normalized.startsWith('../') || normalized === '..') return '';
  return normalized;
}

function resolveRepoPathFromRelative(relativePath) {
  const normalized = normalizeRepoRelativePath(relativePath);
  if (!normalized) return '';
  const resolved = path.resolve(repoRootDir, normalized.split('/').join(path.sep));
  const rel = path.relative(repoRootDir, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return '';
  }
  return resolved;
}

function runGitStdoutSync(args) {
  try {
    return String(
      execFileSync('git', args, {
        cwd: repoRootDir,
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 1024 * 1024 * 64
      }) || ''
    );
  } catch (_error) {
    return '';
  }
}

function sanitizeGitIdentityName(rawName) {
  const value = String(rawName || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';
  return value.length > 80 ? value.slice(0, 80).trim() : value;
}

function buildGitIdentityFromUsername(rawUsername) {
  const name = sanitizeGitIdentityName(rawUsername) || 'CodexWeb';
  const localPart = String(name || 'codexweb')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  const safeLocalPart = localPart || 'codexweb';
  return {
    name,
    email: `${safeLocalPart}@codexweb.local`
  };
}

function buildGitIdentityFromRequest(req) {
  const username =
    req && req.session && typeof req.session.username === 'string'
      ? req.session.username
      : '';
  return buildGitIdentityFromUsername(username);
}

function normalizeGitIdentity(identity) {
  const source = identity && typeof identity === 'object' ? identity : {};
  const name = sanitizeGitIdentityName(source.name) || 'CodexWeb';
  const emailRaw = String(source.email || '').trim().toLowerCase();
  const email = emailRaw || 'codexweb@codexweb.local';
  return { name, email };
}

function buildGitIdentityEnv(identity) {
  const safeIdentity = normalizeGitIdentity(identity);
  return {
    GIT_AUTHOR_NAME: safeIdentity.name,
    GIT_AUTHOR_EMAIL: safeIdentity.email,
    GIT_COMMITTER_NAME: safeIdentity.name,
    GIT_COMMITTER_EMAIL: safeIdentity.email
  };
}

function runGitInRepoSync(repoPath, args, options = {}) {
  const safeRepoPath = String(repoPath || '').trim() || repoRootDir;
  const safeArgs = Array.isArray(args) ? args.map((entry) => String(entry || '')) : [];
  const timeoutMs = Number.isInteger(Number(options.timeoutMs))
    ? Math.max(500, Number(options.timeoutMs))
    : gitToolsCommandTimeoutMs;
  const allowNonZero = Boolean(options.allowNonZero);
  const extraEnv =
    options && options.env && typeof options.env === 'object' && !Array.isArray(options.env)
      ? options.env
      : {};
  try {
    const stdout = execFileSync('git', safeArgs, {
      cwd: safeRepoPath,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 64,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...extraEnv
      }
    });
    return {
      ok: true,
      code: 0,
      stdout: String(stdout || ''),
      stderr: ''
    };
  } catch (error) {
    const statusCandidate = Number(error && error.status);
    const codeCandidate = Number(error && error.code);
    const exitCode = Number.isInteger(statusCandidate)
      ? statusCandidate
      : Number.isInteger(codeCandidate)
        ? codeCandidate
        : null;
    return {
      ok: allowNonZero && exitCode !== null,
      code: exitCode === null ? 1 : exitCode,
      stdout: String((error && error.stdout) || ''),
      stderr: String((error && error.stderr) || (error && error.message) || '')
    };
  }
}

async function runGitInRepoAsync(repoPath, args, options = {}) {
  const safeRepoPath = String(repoPath || '').trim() || repoRootDir;
  const safeArgs = Array.isArray(args) ? args.map((entry) => String(entry || '')) : [];
  const timeoutMs = Number.isInteger(Number(options.timeoutMs))
    ? Math.max(500, Number(options.timeoutMs))
    : gitToolsCommandTimeoutMs;
  const allowNonZero = Boolean(options.allowNonZero);
  const extraEnv =
    options && options.env && typeof options.env === 'object' && !Array.isArray(options.env)
      ? options.env
      : {};
  try {
    const result = await execFileAsync('git', safeArgs, {
      cwd: safeRepoPath,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 64,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...extraEnv
      }
    });
    return {
      ok: true,
      code: 0,
      stdout: String((result && result.stdout) || ''),
      stderr: String((result && result.stderr) || '')
    };
  } catch (error) {
    const statusCandidate = Number(error && error.status);
    const codeCandidate = Number(error && error.code);
    const exitCode = Number.isInteger(statusCandidate)
      ? statusCandidate
      : Number.isInteger(codeCandidate)
        ? codeCandidate
        : null;
    return {
      ok: allowNonZero && exitCode !== null,
      code: exitCode === null ? 1 : exitCode,
      stdout: String((error && error.stdout) || ''),
      stderr: String((error && error.stderr) || (error && error.message) || '')
    };
  }
}

function extractGitConfigValue(result) {
  if (!result || typeof result !== 'object') return '';
  return String(result.stdout || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .find(Boolean) || '';
}

function isGitIdentityUnknownError(rawText) {
  const text = String(rawText || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('author identity unknown') ||
    text.includes('please tell me who you are') ||
    text.includes('unable to auto-detect email address') ||
    text.includes('fatal: no email was given and auto-detection is disabled')
  );
}

function ensureGitIdentityForRepo(repoPath, gitIdentity) {
  const safeRepoPath = String(repoPath || '').trim() || repoRootDir;
  const requested = normalizeGitIdentity(gitIdentity);
  const existingName = extractGitConfigValue(
    runGitInRepoSync(safeRepoPath, ['config', '--local', '--get', 'user.name'], { allowNonZero: true })
  );
  const existingEmail = extractGitConfigValue(
    runGitInRepoSync(safeRepoPath, ['config', '--local', '--get', 'user.email'], { allowNonZero: true })
  );

  const targetName = existingName || requested.name;
  const targetEmail = existingEmail || requested.email;

  if (!existingName) {
    const setNameResult = runGitInRepoSync(safeRepoPath, ['config', '--local', 'user.name', targetName]);
    if (!setNameResult.ok) {
      return {
        ok: false,
        error: truncateForNotify(setNameResult.stderr || setNameResult.stdout || 'git_config_name_failed', 180),
        identity: requested
      };
    }
  }

  if (!existingEmail) {
    const setEmailResult = runGitInRepoSync(safeRepoPath, ['config', '--local', 'user.email', targetEmail]);
    if (!setEmailResult.ok) {
      return {
        ok: false,
        error: truncateForNotify(setEmailResult.stderr || setEmailResult.stdout || 'git_config_email_failed', 180),
        identity: requested
      };
    }
  }

  return {
    ok: true,
    identity: {
      name: targetName,
      email: targetEmail
    },
    configured: !existingName || !existingEmail
  };
}

function truncateRawText(rawValue, maxChars = 120000) {
  const text = String(rawValue || '');
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function runSystemCommandSync(command, args, options = {}) {
  const safeCommand = String(command || '').trim();
  if (!safeCommand) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'invalid_command'
    };
  }
  const safeArgs = Array.isArray(args) ? args.map((entry) => String(entry || '')) : [];
  const timeoutMs = Number.isInteger(Number(options.timeoutMs))
    ? Math.max(500, Number(options.timeoutMs))
    : gitToolsCommandTimeoutMs;
  const allowNonZero = Boolean(options.allowNonZero);
  const cwdValue = options && typeof options.cwd === 'string' && options.cwd.trim() ? options.cwd : process.cwd();
  const maxBuffer = Number.isInteger(Number(options.maxBuffer))
    ? Math.max(1024 * 8, Number(options.maxBuffer))
    : 1024 * 1024 * 64;

  try {
    const stdout = execFileSync(safeCommand, safeArgs, {
      cwd: cwdValue,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer,
      env: process.env
    });
    return {
      ok: true,
      code: 0,
      stdout: String(stdout || ''),
      stderr: ''
    };
  } catch (error) {
    const statusCandidate = Number(error && error.status);
    const codeCandidate = Number(error && error.code);
    const exitCode = Number.isInteger(statusCandidate)
      ? statusCandidate
      : Number.isInteger(codeCandidate)
        ? codeCandidate
        : null;
    return {
      ok: allowNonZero && exitCode !== null,
      code: exitCode === null ? 1 : exitCode,
      stdout: String((error && error.stdout) || ''),
      stderr: String((error && error.stderr) || (error && error.message) || '')
    };
  }
}

function commandExistsSync(commandName) {
  const safeName = String(commandName || '').trim();
  if (!safeName) return false;
  if (commandExistsCache.has(safeName)) {
    return Boolean(commandExistsCache.get(safeName));
  }
  const result = runSystemCommandSync('which', [safeName], {
    allowNonZero: true,
    timeoutMs: 4000,
    maxBuffer: 32 * 1024
  });
  const exists = Boolean(result && result.code === 0 && String(result.stdout || '').trim());
  commandExistsCache.set(safeName, exists);
  return exists;
}

function parseKeyValueOutput(rawText) {
  const map = {};
  const lines = String(rawText || '')
    .replace(/\r/g, '')
    .split('\n');
  lines.forEach((line) => {
    const idx = line.indexOf('=');
    if (idx <= 0) return;
    const key = String(line.slice(0, idx) || '').trim();
    if (!key) return;
    map[key] = String(line.slice(idx + 1) || '').trim();
  });
  return map;
}

function buildDeployedAppId(source, locator) {
  const safeSource = String(source || '')
    .trim()
    .toLowerCase();
  const safeLocator = String(locator || '').trim();
  if (!safeSource || !safeLocator) return '';
  return `${safeSource}:${Buffer.from(safeLocator, 'utf8').toString('base64url')}`;
}

function parseDeployedAppId(rawAppId) {
  const value = String(rawAppId || '').trim();
  if (!value) return null;
  const idx = value.indexOf(':');
  if (idx <= 0) return null;
  const source = value.slice(0, idx).toLowerCase();
  const encodedLocator = value.slice(idx + 1);
  if (!['docker', 'systemd', 'pm2'].includes(source)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(encodedLocator)) return null;
  let locator = '';
  try {
    locator = Buffer.from(encodedLocator, 'base64url').toString('utf8').trim();
  } catch (_error) {
    locator = '';
  }
  if (!locator || locator.length > 260 || locator.includes('\0')) return null;
  return {
    source,
    locator
  };
}

function normalizeDeployedStatus(rawValue, fallback = 'unknown') {
  const value = String(rawValue || '')
    .trim()
    .toLowerCase();
  if (!value) return fallback;
  if (
    value.includes('running') ||
    value.includes('active') ||
    value.includes('online') ||
    value.includes('up')
  ) {
    return 'running';
  }
  if (
    value.includes('error') ||
    value.includes('errored') ||
    value.includes('failed') ||
    value.includes('unhealthy')
  ) {
    return 'error';
  }
  if (
    value.includes('stopped') ||
    value.includes('inactive') ||
    value.includes('exited') ||
    value.includes('dead') ||
    value.includes('created')
  ) {
    return 'stopped';
  }
  return fallback;
}

function buildDeployedAppSummary(payload, scannedAtIso) {
  const source = String(payload && payload.source ? payload.source : '')
    .trim()
    .toLowerCase();
  const locator = String(payload && payload.locator ? payload.locator : '').trim();
  const name = String(payload && payload.name ? payload.name : '').trim();
  if (!source || !locator || !name) {
    return null;
  }
  const id = buildDeployedAppId(source, locator);
  if (!id) return null;
  const status = normalizeDeployedStatus(payload && payload.status ? payload.status : 'unknown');
  const pidRaw = Number(payload && payload.pid);
  const pid = Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : null;
  return {
    id,
    source,
    name,
    status,
    detailStatus: String((payload && payload.detailStatus) || '').trim(),
    description: String((payload && payload.description) || '').trim(),
    pid,
    location: String((payload && payload.location) || '').trim(),
    uptime: String((payload && payload.uptime) || '').trim(),
    canStart: Boolean(payload && payload.canStart),
    canStop: Boolean(payload && payload.canStop),
    canRestart: Boolean(payload && payload.canRestart),
    hasLogs: Boolean(payload && payload.hasLogs),
    scannedAt: scannedAtIso
  };
}

function collectDockerDeployedApps(scannedAtIso) {
  if (!commandExistsSync('docker')) return [];
  const listResult = runSystemCommandSync('docker', ['ps', '-a', '--no-trunc', '--format', '{{json .}}'], {
    allowNonZero: true,
    timeoutMs: 12000,
    maxBuffer: 1024 * 1024 * 16
  });
  const rows = String(listResult.stdout || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (rows.length === 0) {
    return [];
  }

  const apps = [];
  rows.forEach((line) => {
    let parsed = null;
    try {
      parsed = JSON.parse(line);
    } catch (_error) {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object') return;

    const containerId = String(parsed.ID || '').trim();
    const names = String(parsed.Names || '').trim();
    const locator = containerId || names;
    if (!locator) return;

    const statusRaw = String(parsed.Status || '').trim();
    const stateRaw = String(parsed.State || '').trim().toLowerCase();
    let status = normalizeDeployedStatus(stateRaw || statusRaw, 'unknown');
    if (/^up\b/i.test(statusRaw)) status = 'running';
    if (stateRaw === 'restarting') status = 'running';
    if (stateRaw === 'paused') status = 'running';
    if (stateRaw === 'dead') status = 'error';

    const summary = buildDeployedAppSummary(
      {
        source: 'docker',
        locator,
        name: names || containerId.slice(0, 12) || 'container',
        status,
        detailStatus: statusRaw || stateRaw,
        description: String(parsed.Image || '').trim(),
        location: String(parsed.Ports || '').trim(),
        uptime: String(parsed.RunningFor || '').trim(),
        canStart: status !== 'running',
        canStop: status === 'running',
        canRestart: true,
        hasLogs: true
      },
      scannedAtIso
    );
    if (summary) {
      apps.push(summary);
    }
  });

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

function listSystemdServiceUnits() {
  const rootDir = '/etc/systemd/system';
  if (!fs.existsSync(rootDir)) return [];
  const units = new Set();
  const queue = [{ dir: rootDir, depth: 0 }];
  const visited = new Set();

  while (queue.length > 0 && units.size < deployedAppsMaxSystemdUnits) {
    const current = queue.pop();
    if (!current || !current.dir) continue;
    const currentDir = path.resolve(current.dir);
    if (visited.has(currentDir)) continue;
    visited.add(currentDir);

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_error) {
      entries = [];
    }

    entries.forEach((entry) => {
      const name = String(entry && entry.name ? entry.name : '').trim();
      if (!name || name === '.' || name === '..') return;
      if (name.endsWith('.service')) {
        units.add(path.basename(name));
      }
      if (entry && entry.isDirectory() && current.depth < 2) {
        queue.push({
          dir: path.join(currentDir, name),
          depth: current.depth + 1
        });
      }
    });
  }

  return Array.from(units)
    .filter((unit) => unit && unit.endsWith('.service'))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, deployedAppsMaxSystemdUnits);
}

function collectSystemdDeployedApps(scannedAtIso) {
  if (!commandExistsSync('systemctl')) return [];
  const units = listSystemdServiceUnits();
  if (units.length === 0) return [];
  const apps = [];

  units.forEach((unitName) => {
    const showResult = runSystemCommandSync(
      'systemctl',
      [
        'show',
        unitName,
        '--no-pager',
        '--property=Id,Description,ActiveState,SubState,MainPID,ExecMainStartTimestamp,FragmentPath,UnitFileState'
      ],
      {
        allowNonZero: true,
        timeoutMs: 9000,
        maxBuffer: 1024 * 1024 * 2
      }
    );
    const fields = parseKeyValueOutput(showResult.stdout || '');
    const serviceId = String(fields.Id || unitName).trim() || unitName;
    if (!serviceId.endsWith('.service')) return;

    const activeState = String(fields.ActiveState || '').trim().toLowerCase();
    const subState = String(fields.SubState || '').trim().toLowerCase();
    const detailStatus = [activeState, subState].filter(Boolean).join(' ').trim() || 'unknown';
    let status = normalizeDeployedStatus(detailStatus, 'unknown');
    if (activeState === 'activating') status = 'running';
    if (activeState === 'failed') status = 'error';

    const mainPid = Number(fields.MainPID);
    const startTimestampRaw = String(fields.ExecMainStartTimestamp || '').trim();
    const startedAtMs = Date.parse(startTimestampRaw);
    const uptime =
      Number.isFinite(startedAtMs) && startedAtMs > 0 && status === 'running'
        ? formatDurationMs(Date.now() - startedAtMs)
        : '';

    const summary = buildDeployedAppSummary(
      {
        source: 'systemd',
        locator: serviceId,
        name: serviceId.replace(/\.service$/, ''),
        status,
        detailStatus,
        description: String(fields.Description || '').trim(),
        pid: Number.isInteger(mainPid) && mainPid > 0 ? mainPid : null,
        location: String(fields.FragmentPath || '').trim(),
        uptime,
        canStart: status !== 'running',
        canStop: status === 'running',
        canRestart: true,
        hasLogs: true
      },
      scannedAtIso
    );
    if (summary) {
      apps.push(summary);
    }
  });

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

function collectPm2DeployedApps(scannedAtIso) {
  if (!commandExistsSync('pm2')) return [];
  const result = runSystemCommandSync('pm2', ['jlist'], {
    allowNonZero: true,
    timeoutMs: 15000,
    maxBuffer: 1024 * 1024 * 16
  });
  const raw = String(result.stdout || '').trim();
  if (!raw) return [];
  let parsed = [];
  try {
    const json = JSON.parse(raw);
    parsed = Array.isArray(json) ? json : [];
  } catch (_error) {
    parsed = [];
  }
  const apps = [];

  parsed.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const pm2Env = item.pm2_env && typeof item.pm2_env === 'object' ? item.pm2_env : {};
    const pmId = Number(item.pm_id);
    const name = String(item.name || '').trim() || (Number.isInteger(pmId) ? `pm2-${pmId}` : 'pm2-app');
    const locator = Number.isInteger(pmId) ? String(pmId) : name;
    const rawStatus = String(pm2Env.status || item.status || '').trim().toLowerCase();
    let status = normalizeDeployedStatus(rawStatus, 'unknown');
    if (rawStatus === 'online' || rawStatus === 'launching' || rawStatus === 'waiting restart') {
      status = 'running';
    }
    if (rawStatus === 'stopped' || rawStatus === 'stopping') {
      status = 'stopped';
    }
    if (rawStatus === 'errored') {
      status = 'error';
    }

    const pidRaw = Number(item.pid || pm2Env.pm_pid);
    const uptimeFrom = Number(pm2Env.pm_uptime);
    const uptime =
      Number.isFinite(uptimeFrom) && uptimeFrom > 0 && status === 'running'
        ? formatDurationMs(Date.now() - uptimeFrom)
        : '';

    const summary = buildDeployedAppSummary(
      {
        source: 'pm2',
        locator,
        name,
        status,
        detailStatus: rawStatus || 'unknown',
        description: String(pm2Env.pm_exec_path || '').trim() || String(pm2Env.node_args || '').trim(),
        pid: Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : null,
        location: String(pm2Env.pm_cwd || '').trim(),
        uptime,
        canStart: status !== 'running',
        canStop: status === 'running',
        canRestart: true,
        hasLogs: true
      },
      scannedAtIso
    );
    if (summary) {
      apps.push(summary);
    }
  });

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

function collectDeployedAppsSnapshot(forceRefresh = false) {
  const nowMs = Date.now();
  const cacheFresh = nowMs - deployedAppsCache.scannedAtMs <= deployedAppsScanTtlMs;
  if (!forceRefresh && cacheFresh && Array.isArray(deployedAppsCache.apps)) {
    return {
      scannedAt: new Date(deployedAppsCache.scannedAtMs).toISOString(),
      apps: deployedAppsCache.apps
    };
  }

  const scannedAtIso = nowIso();
  const apps = [
    ...collectDockerDeployedApps(scannedAtIso),
    ...collectSystemdDeployedApps(scannedAtIso),
    ...collectPm2DeployedApps(scannedAtIso)
  ];
  const statusRank = (status) => {
    if (status === 'running') return 0;
    if (status === 'error') return 1;
    if (status === 'unknown') return 2;
    return 3;
  };
  apps.sort((a, b) => {
    const rankDelta = statusRank(String(a.status || '')) - statusRank(String(b.status || ''));
    if (rankDelta !== 0) return rankDelta;
    const sourceDelta = String(a.source || '').localeCompare(String(b.source || ''));
    if (sourceDelta !== 0) return sourceDelta;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  deployedAppsCache = {
    scannedAtMs: nowMs,
    apps
  };
  return {
    scannedAt: scannedAtIso,
    apps
  };
}

function findDeployedAppById(appId, options = {}) {
  const safeId = String(appId || '').trim();
  if (!safeId) return null;
  const snapshot = collectDeployedAppsSnapshot(Boolean(options.forceRefresh));
  return snapshot.apps.find((app) => String(app && app.id).trim() === safeId) || null;
}

function normalizeDeployedAppAction(rawAction) {
  const action = String(rawAction || '')
    .trim()
    .toLowerCase();
  if (action === 'start' || action === 'stop' || action === 'restart') {
    return action;
  }
  return '';
}

function runDeployedAppAction(appId, action) {
  const parsedAppId = parseDeployedAppId(appId);
  if (!parsedAppId) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'app_id_invalido'
    };
  }
  const safeAction = normalizeDeployedAppAction(action);
  if (!safeAction) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'accion_invalida'
    };
  }

  if (parsedAppId.source === 'docker') {
    return runSystemCommandSync('docker', [safeAction, parsedAppId.locator], {
      timeoutMs: 45000
    });
  }
  if (parsedAppId.source === 'systemd') {
    return runSystemCommandSync('systemctl', [safeAction, parsedAppId.locator, '--no-pager'], {
      timeoutMs: 45000
    });
  }
  if (parsedAppId.source === 'pm2') {
    return runSystemCommandSync('pm2', [safeAction, parsedAppId.locator], {
      timeoutMs: 45000
    });
  }
  return {
    ok: false,
    code: 1,
    stdout: '',
    stderr: 'source_no_soportado'
  };
}

function getDeployedAppLogs(appId, rawLines) {
  const parsedAppId = parseDeployedAppId(appId);
  if (!parsedAppId) {
    return {
      ok: false,
      lines: deployedAppsDefaultLogLines,
      logs: '',
      error: 'app_id_invalido'
    };
  }
  const parsedLines = Number.parseInt(String(rawLines || ''), 10);
  const safeLines = Number.isInteger(parsedLines)
    ? Math.min(Math.max(parsedLines, 20), deployedAppsMaxLogLines)
    : deployedAppsDefaultLogLines;

  let result = null;
  if (parsedAppId.source === 'docker') {
    result = runSystemCommandSync('docker', ['logs', '--tail', String(safeLines), parsedAppId.locator], {
      allowNonZero: true,
      timeoutMs: 45000,
      maxBuffer: 1024 * 1024 * 12
    });
  } else if (parsedAppId.source === 'systemd') {
    result = runSystemCommandSync(
      'journalctl',
      ['-u', parsedAppId.locator, '-n', String(safeLines), '--no-pager', '--output=short-iso'],
      {
        allowNonZero: true,
        timeoutMs: 45000,
        maxBuffer: 1024 * 1024 * 12
      }
    );
  } else if (parsedAppId.source === 'pm2') {
    result = runSystemCommandSync('pm2', ['logs', parsedAppId.locator, '--nostream', '--lines', String(safeLines)], {
      allowNonZero: true,
      timeoutMs: 45000,
      maxBuffer: 1024 * 1024 * 12
    });
  } else {
    return {
      ok: false,
      lines: safeLines,
      logs: '',
      error: 'source_no_soportado'
    };
  }

  const mergedOutput = truncateRawText(
    stripAnsi([result.stdout, result.stderr].filter(Boolean).join('\n')).trim(),
    120000
  );
  if (!result.ok && !mergedOutput) {
    return {
      ok: false,
      lines: safeLines,
      logs: '',
      error: truncateForNotify(result.stderr || result.stdout || 'logs_failed', 220)
    };
  }

  return {
    ok: true,
    lines: safeLines,
    logs: mergedOutput,
    error: ''
  };
}

function normalizeGeneratedDeployedDescription(rawValue, maxChars = 260) {
  const compact = String(rawValue || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\-*#\d.\s]+/, '')
    .trim();
  if (!compact) return '';
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
}

function formatDeployedStatusForDescription(status) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  if (normalized === 'running') return 'en ejecucion';
  if (normalized === 'stopped') return 'detenida';
  if (normalized === 'error') return 'con errores';
  return 'en estado desconocido';
}

function formatDeployedSourceForDescription(source) {
  const normalized = String(source || '')
    .trim()
    .toLowerCase();
  if (normalized === 'docker') return 'Docker';
  if (normalized === 'systemd') return 'systemd';
  if (normalized === 'pm2') return 'PM2';
  return normalized || 'orquestador desconocido';
}

function buildFallbackDeployedAppDescription(app) {
  const safeApp = app && typeof app === 'object' ? app : {};
  const sourceLabel = formatDeployedSourceForDescription(safeApp.source);
  const statusLabel = formatDeployedStatusForDescription(safeApp.status);
  const rawDetail = normalizeGeneratedDeployedDescription(safeApp.description, 110);
  const detailSuffix = rawDetail ? ` Se asocia con: ${rawDetail}.` : '';
  const locationHint = normalizeGeneratedDeployedDescription(safeApp.location, 80);
  const locationSuffix = locationHint ? ` Ubicacion: ${locationHint}.` : '';
  const text = `${String(safeApp.name || 'App')} es un servicio gestionado con ${sourceLabel} y ahora esta ${statusLabel}.${detailSuffix}${locationSuffix}`;
  return normalizeGeneratedDeployedDescription(text, 260);
}

function buildDeployedAppsDescribePrompt(apps, activeAgentId = '') {
  const list = Array.isArray(apps) ? apps : [];
  const lines = [
    'Eres un asistente tecnico de CodexWeb.',
    'Genera una descripcion corta y util para usuario final de cada app desplegada.',
    'Responde SOLO JSON valido (sin markdown, sin texto extra).',
    'Formato obligatorio exacto:',
    '{"descriptions":[{"appId":"<id>","description":"<texto>"}]}',
    '',
    'Reglas:',
    '- idioma: espanol neutro',
    '- cada descripcion: 1 frase (maximo 220 caracteres)',
    '- explica para que sirve la app usando nombre, source, estado y metadatos disponibles',
    '- no inventes datos no visibles',
    '- devuelve una entrada por cada app',
    activeAgentId ? `- contexto: agente activo en CodexWeb = ${activeAgentId}` : '- contexto: agente activo no definido',
    '',
    'Apps:'
  ];

  list.forEach((app, index) => {
    lines.push(`${index + 1}. appId=${String(app.id || '')}`);
    lines.push(`   name=${String(app.name || '')}`);
    lines.push(`   source=${String(app.source || '')}`);
    lines.push(`   status=${String(app.status || '')}`);
    lines.push(`   detailStatus=${String(app.detailStatus || '')}`);
    lines.push(`   description=${String(app.description || '')}`);
    lines.push(`   location=${String(app.location || '')}`);
    lines.push(`   uptime=${String(app.uptime || '')}`);
    lines.push(`   pid=${String(app.pid || '')}`);
  });

  return lines.join('\n');
}

function tryParseGeneratedDeployedDescriptions(rawOutput, appsById) {
  const knownApps = appsById instanceof Map ? appsById : new Map();
  const value = String(rawOutput || '').trim();
  if (!value) return [];

  const parseCandidate = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      return null;
    }
  };

  const candidates = [];
  candidates.push(value);
  const unfenced = value
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  if (unfenced && unfenced !== value) {
    candidates.push(unfenced);
  }
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  }

  let parsed = null;
  for (const candidate of candidates) {
    parsed = parseCandidate(candidate);
    if (parsed && typeof parsed === 'object') break;
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const rawItems = Array.isArray(parsed.descriptions)
    ? parsed.descriptions
    : Array.isArray(parsed.items)
      ? parsed.items
      : [];
  if (rawItems.length === 0) return [];

  const seen = new Set();
  const normalized = [];
  rawItems.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const appId = String(item.appId || item.id || '').trim();
    if (!appId || seen.has(appId) || !knownApps.has(appId)) return;
    const description = normalizeGeneratedDeployedDescription(item.description || item.text || '');
    if (!description) return;
    seen.add(appId);
    normalized.push({ appId, description });
  });
  return normalized;
}

async function generateDeployedAppsDescriptionsWithCodex(payload = {}) {
  const userId = getSafeUserId(payload.userId);
  const username = String(payload.username || '').trim();
  const activeAgentId = String(payload.activeAgentId || '').trim();
  const apps = Array.isArray(payload.apps) ? payload.apps : [];
  if (!userId) {
    throw new Error('INVALID_USER_ID');
  }
  if (apps.length === 0) {
    return [];
  }

  const codexPath = await resolveCodexPath();
  const prompt = buildDeployedAppsDescribePrompt(apps, activeAgentId);
  const args = [
    '-c',
    'shell_environment_policy.inherit=all',
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'danger-full-access',
    '--color',
    'never',
    prompt
  ];

  let stdout = '';
  let stderr = '';
  try {
    const result = await execFileAsync(codexPath, args, {
      env: getCodexEnvForUser(userId, { username }),
      cwd: process.cwd(),
      timeout: deployedAppsDescribeTimeoutMs,
      maxBuffer: 1024 * 1024 * 6
    });
    stdout = String((result && result.stdout) || '');
    stderr = String((result && result.stderr) || '');
  } catch (error) {
    stdout = String((error && error.stdout) || '');
    stderr = String((error && error.stderr) || (error && error.message) || '');
    if (!stdout.trim() && !stderr.trim()) {
      throw error;
    }
  }

  const cleanedStdout = truncateRawText(stripAnsi(stdout).trim(), 120000);
  const cleanedStderr = truncateRawText(stripAnsi(stderr).trim(), 120000);
  const combinedOutput = [cleanedStdout, cleanedStderr].filter(Boolean).join('\n').trim();
  const appsById = new Map(
    apps.map((app) => [String((app && app.id) || '').trim(), app])
  );
  const parsed = tryParseGeneratedDeployedDescriptions(combinedOutput, appsById);
  const parsedById = new Map(parsed.map((entry) => [entry.appId, entry.description]));

  return apps.map((app) => {
    const appId = String((app && app.id) || '').trim();
    const parsedDescription = parsedById.get(appId);
    const description = parsedDescription || buildFallbackDeployedAppDescription(app);
    return {
      appId,
      name: String((app && app.name) || '').trim() || appId,
      description
    };
  });
}

function parseGitPorcelainPath(line) {
  const raw = String(line || '');
  if (raw.length < 4) return '';
  const body = raw.slice(3).trim();
  if (!body) return '';
  const renameMarker = ' -> ';
  const renameIdx = body.lastIndexOf(renameMarker);
  const target = renameIdx >= 0 ? body.slice(renameIdx + renameMarker.length) : body;
  const unquoted = target.replace(/^"/, '').replace(/"$/, '');
  return normalizeRepoRelativePath(unquoted);
}

function parseGitStatusPorcelain(rawOutput) {
  const lines = String(rawOutput || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => String(line || '').trim().length > 0);

  let branch = '';
  let upstream = '';
  let ahead = 0;
  let behind = 0;
  let detached = false;
  let headerText = '';

  if (lines.length > 0 && lines[0].startsWith('## ')) {
    headerText = String(lines.shift() || '').slice(3).trim();
    const trackingMatch = headerText.match(/\[([^\]]+)\]\s*$/);
    const trackingText = trackingMatch ? trackingMatch[1] : '';
    const branchPart = trackingMatch
      ? headerText.slice(0, headerText.length - trackingMatch[0].length).trim()
      : headerText;

    if (branchPart.startsWith('No commits yet on ')) {
      branch = branchPart.replace('No commits yet on ', '').trim();
    } else if (branchPart.includes('...')) {
      const split = branchPart.split('...');
      branch = String(split[0] || '').trim();
      upstream = String(split[1] || '').trim();
    } else {
      branch = branchPart;
    }

    const aheadMatch = trackingText.match(/ahead\s+(\d+)/i);
    const behindMatch = trackingText.match(/behind\s+(\d+)/i);
    ahead = aheadMatch ? Math.max(0, Number(aheadMatch[1])) : 0;
    behind = behindMatch ? Math.max(0, Number(behindMatch[1])) : 0;
  }

  if (!branch) {
    branch = 'HEAD';
  }
  detached = branch === 'HEAD' || headerText.includes('detached');

  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicted = 0;
  const files = [];
  const conflictedFiles = [];

  for (const line of lines) {
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    const isUntracked = x === '?' && y === '?';
    const isConflict = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    if (isUntracked) {
      untracked += 1;
    } else {
      if (x !== ' ' && x !== '?') staged += 1;
      if (y !== ' ' && y !== '?') modified += 1;
    }
    if (isConflict) {
      conflicted += 1;
    }

    const filePath = parseGitPorcelainPath(line);
    if (filePath) {
      files.push(filePath);
      if (isConflict) {
        conflictedFiles.push(filePath);
      }
    }
  }

  const uniqueFiles = Array.from(new Set(files));
  const uniqueConflictedFiles = Array.from(new Set(conflictedFiles));

  return {
    branch,
    upstream,
    ahead,
    behind,
    detached,
    hasChanges: lines.length > 0,
    hasConflicts: conflicted > 0,
    counts: {
      staged,
      modified,
      untracked,
      conflicted,
      total: lines.length
    },
    files: uniqueFiles,
    conflictedFiles: uniqueConflictedFiles
  };
}

function listGitRepositoriesUnderRoots(baseDirs) {
  const requestedRoots = Array.isArray(baseDirs) ? baseDirs : [baseDirs];
  const normalizedRoots = [];
  const seenRoots = new Set();
  requestedRoots.forEach((entry) => {
    const absolutePath = normalizeAbsoluteDirPath(entry);
    if (!absolutePath || seenRoots.has(absolutePath)) return;
    seenRoots.add(absolutePath);
    normalizedRoots.push(absolutePath);
  });
  if (normalizedRoots.length === 0) {
    normalizedRoots.push(repoRootDir);
  }

  const queue = normalizedRoots.map((dir) => ({ dir, depth: 0, scanRoot: dir }));
  const visited = new Set();
  const discovered = [];
  const seenRepos = new Set();

  while (queue.length > 0 && discovered.length < gitToolsMaxRepos) {
    const current = queue.pop();
    if (!current || !current.dir) continue;
    const currentDir = path.resolve(current.dir);
    const currentScanRoot = normalizeAbsoluteDirPath(current.scanRoot) || repoRootDir;
    if (visited.has(currentDir)) continue;
    visited.add(currentDir);

    const gitPath = path.join(currentDir, '.git');
    if (fs.existsSync(gitPath) && !seenRepos.has(currentDir)) {
      discovered.push({
        repoPath: currentDir,
        scanRoot: currentScanRoot
      });
      seenRepos.add(currentDir);
    }

    if (current.depth >= gitToolsMaxDepth) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_error) {
      entries = [];
    }

    entries.forEach((entry) => {
      if (!entry || !entry.isDirectory()) return;
      const name = String(entry.name || '').trim();
      if (!name || name === '.' || name === '..') return;
      if (gitToolsIgnoredDirs.has(name)) return;
      queue.push({
        dir: path.join(currentDir, name),
        depth: current.depth + 1,
        scanRoot: currentScanRoot
      });
    });
  }

  return discovered.sort((a, b) => {
    const pathA = String(a && a.repoPath ? a.repoPath : '');
    const pathB = String(b && b.repoPath ? b.repoPath : '');
    return pathA.localeCompare(pathB);
  });
}

function buildGitRepoId(relativePath, absolutePath) {
  const seed = `${String(relativePath || '.')}|${String(absolutePath || '')}`;
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
}

function collectGitRepoSummary(repoDir, scannedAtIso, scanRoot = repoRootDir) {
  const safeRepoDir = path.resolve(String(repoDir || repoRootDir));
  const safeScanRoot = path.resolve(String(scanRoot || repoRootDir));
  const relativePathRaw = path.relative(safeScanRoot, safeRepoDir);
  const relativePath = normalizeRepoRelativePath(relativePathRaw.split(path.sep).join('/')) || '.';
  const statusResult = runGitInRepoSync(safeRepoDir, ['status', '--porcelain=1', '--branch']);
  if (!statusResult.ok) {
    return null;
  }
  const parsedStatus = parseGitStatusPorcelain(statusResult.stdout);
  const remoteResult = runGitInRepoSync(safeRepoDir, ['remote'], { allowNonZero: true });
  const remotes = String(remoteResult.stdout || '')
    .split(/\r?\n/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  const name =
    relativePath === '.'
      ? path.basename(safeRepoDir) || path.basename(safeScanRoot) || safeRepoDir
      : relativePath.split('/').filter(Boolean).slice(-1)[0] || relativePath;

  return {
    id: buildGitRepoId(relativePath, safeRepoDir),
    name,
    relativePath,
    absolutePath: safeRepoDir,
    branch: parsedStatus.branch,
    upstream: parsedStatus.upstream,
    ahead: parsedStatus.ahead,
    behind: parsedStatus.behind,
    detached: parsedStatus.detached,
    hasRemote: remotes.length > 0,
    remotes,
    hasChanges: parsedStatus.hasChanges,
    hasConflicts: parsedStatus.hasConflicts,
    status: parsedStatus.counts,
    changedFiles: parsedStatus.files.slice(0, 120),
    conflictFiles: parsedStatus.conflictedFiles.slice(0, 120),
    scanRoot: safeScanRoot,
    scannedAt: scannedAtIso
  };
}

function collectGitToolsReposSnapshot(forceRefresh = false) {
  const nowMs = Date.now();
  const cacheFresh = nowMs - gitToolsRepoCache.scannedAtMs <= gitToolsScanTtlMs;
  if (!forceRefresh && cacheFresh && Array.isArray(gitToolsRepoCache.repos)) {
    return {
      scannedAt: new Date(gitToolsRepoCache.scannedAtMs).toISOString(),
      repos: gitToolsRepoCache.repos
    };
  }

  const scannedAtIso = nowIso();
  const repos = [];
  const roots = listGitRepositoriesUnderRoots(gitToolsScanRoots);
  roots.forEach((entry) => {
    const repoPath = entry && entry.repoPath ? entry.repoPath : '';
    const scanRoot = entry && entry.scanRoot ? entry.scanRoot : repoRootDir;
    const summary = collectGitRepoSummary(repoPath, scannedAtIso, scanRoot);
    if (summary) {
      repos.push(summary);
    }
  });

  repos.sort((a, b) => {
    if (a.hasConflicts !== b.hasConflicts) return a.hasConflicts ? -1 : 1;
    if (a.hasChanges !== b.hasChanges) return a.hasChanges ? -1 : 1;
    const relativeComparison = String(a.relativePath || '').localeCompare(String(b.relativePath || ''));
    if (relativeComparison !== 0) return relativeComparison;
    return String(a.absolutePath || '').localeCompare(String(b.absolutePath || ''));
  });

  gitToolsRepoCache = {
    scannedAtMs: nowMs,
    repos
  };
  return {
    scannedAt: scannedAtIso,
    repos
  };
}

function findGitRepoById(repoId, options = {}) {
  const safeRepoId = String(repoId || '')
    .trim()
    .toLowerCase();
  if (!safeRepoId || !/^[a-f0-9]{6,40}$/.test(safeRepoId)) {
    return null;
  }
  const snapshot = collectGitToolsReposSnapshot(Boolean(options.forceRefresh));
  return snapshot.repos.find((repo) => String(repo && repo.id).toLowerCase() === safeRepoId) || null;
}

function normalizeGitCommitMessage(rawMessage, repoName = 'repo') {
  const value = String(rawMessage || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (value) {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }
  const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  return `CodexWeb sync ${String(repoName || 'repo')} ${timestamp}`;
}

function buildGitConflictResolverPrompt(repoSummary, gitIdentity) {
  const repo = repoSummary && typeof repoSummary === 'object' ? repoSummary : {};
  const identity =
    gitIdentity && typeof gitIdentity === 'object'
      ? {
          name: sanitizeGitIdentityName(gitIdentity.name) || 'CodexWeb',
          email: String(gitIdentity.email || '').trim() || 'codexweb@codexweb.local'
        }
      : {
          name: 'CodexWeb',
          email: 'codexweb@codexweb.local'
        };
  const conflictFiles = Array.isArray(repo.conflictFiles) ? repo.conflictFiles : [];
  const fileLines =
    conflictFiles.length > 0
      ? conflictFiles.slice(0, 40).map((entry) => `- ${entry}`).join('\n')
      : '- Detecta los archivos en conflicto con git status';
  const repoPathLabel =
    repo.relativePath && repo.relativePath !== '.'
      ? `${repo.relativePath} (${repo.absolutePath})`
      : String(repo.absolutePath || repoRootDir);

  return [
    `Resuelve los conflictos Git del repositorio "${String(repo.name || 'repo')}".`,
    `Ruta: ${repoPathLabel}`,
    '',
    'Archivos en conflicto detectados:',
    fileLines,
    '',
    'Pasos obligatorios:',
    `1. Entra al repositorio correcto (cd "${String(repo.absolutePath || repoRootDir)}").`,
    '2. Revisa y resuelve todos los conflictos de merge/rebase.',
    '3. Ejecuta pruebas o validaciones rapidas relevantes.',
    '4. Ejecuta git add -A y crea commit con mensaje claro de resolucion.',
    '5. Ejecuta git push al remoto correcto.',
    `6. Si Git solicita identidad, usa nombre "${identity.name}" y email "${identity.email}".`,
    '7. Devuelve resumen final con archivos resueltos, commit y resultado del push.'
  ].join('\n');
}

function listTrackedAndUntrackedRepoFiles() {
  const tracked = parseNullSeparatedList(runGitStdoutSync(['ls-files', '-z']));
  const untracked = parseNullSeparatedList(
    runGitStdoutSync(['ls-files', '--others', '--exclude-standard', '-z'])
  );
  const merged = [];
  const seen = new Set();
  [...tracked, ...untracked].forEach((entry) => {
    if (!entry || seen.has(entry)) return;
    seen.add(entry);
    merged.push(entry);
  });
  return merged.sort();
}

function ensureParentDirForFile(filePath) {
  const parent = path.dirname(filePath);
  if (!parent) return;
  fs.mkdirSync(parent, { recursive: true });
}

function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function pathExistsOrSymlink(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeTaskSnapshotManifest(rawManifest) {
  const input = rawManifest && typeof rawManifest === 'object' ? rawManifest : {};
  const knownPaths = Array.isArray(input.knownPaths) ? input.knownPaths : [];
  const files = Array.isArray(input.files) ? input.files : [];
  const normalizedKnown = [];
  const knownSeen = new Set();
  knownPaths.forEach((entry) => {
    const normalized = normalizeRepoRelativePath(entry);
    if (!normalized || knownSeen.has(normalized)) return;
    knownSeen.add(normalized);
    normalizedKnown.push(normalized);
  });
  const normalizedFiles = [];
  files.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const relPath = normalizeRepoRelativePath(entry.path);
    if (!relPath) return;
    const type = entry.type === 'symlink' ? 'symlink' : 'file';
    const normalizedEntry = {
      path: relPath,
      type,
      backupPath:
        type === 'file' ? normalizeRepoRelativePath(entry.backupPath || path.posix.join('files', relPath)) : '',
      sha256: type === 'file' ? String(entry.sha256 || '') : '',
      size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0,
      mode: Number.isFinite(Number(entry.mode)) ? Number(entry.mode) : 0,
      linkTarget: type === 'symlink' ? String(entry.linkTarget || '') : ''
    };
    normalizedFiles.push(normalizedEntry);
    if (!knownSeen.has(relPath)) {
      knownSeen.add(relPath);
      normalizedKnown.push(relPath);
    }
  });
  return {
    version: 1,
    createdAt: String(input.createdAt || ''),
    repoRoot: String(input.repoRoot || repoRootDir),
    knownPaths: normalizedKnown,
    files: normalizedFiles
  };
}

function loadTaskSnapshotManifest(snapshotDir) {
  const dir = String(snapshotDir || '').trim();
  if (!dir) return null;
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return normalizeTaskSnapshotManifest(parsed);
  } catch (_error) {
    return null;
  }
}

function createTaskSnapshot(taskRunId) {
  const safeTaskRunId = Number(taskRunId);
  if (!Number.isInteger(safeTaskRunId) || safeTaskRunId <= 0) {
    return {
      snapshotDir: '',
      snapshotReady: false,
      filesTotal: 0,
      manifest: null
    };
  }

  const knownPaths = listTrackedAndUntrackedRepoFiles();
  const token = `${safeTaskRunId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const snapshotDir = path.join(taskSnapshotsRootDir, token);
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.mkdirSync(path.join(snapshotDir, 'files'), { recursive: true });

  const manifestFiles = [];
  knownPaths.forEach((relPath) => {
    const absolutePath = resolveRepoPathFromRelative(relPath);
    if (!absolutePath || !pathExistsOrSymlink(absolutePath)) return;
    let stats = null;
    try {
      stats = fs.lstatSync(absolutePath);
    } catch (_error) {
      stats = null;
    }
    if (!stats) return;

    if (stats.isSymbolicLink()) {
      let linkTarget = '';
      try {
        linkTarget = fs.readlinkSync(absolutePath);
      } catch (_error) {
        linkTarget = '';
      }
      manifestFiles.push({
        path: relPath,
        type: 'symlink',
        linkTarget,
        mode: Number(stats.mode) || 0
      });
      return;
    }

    if (!stats.isFile()) return;
    const backupPosixPath = path.posix.join('files', relPath);
    const backupAbsolutePath = path.join(snapshotDir, ...backupPosixPath.split('/'));
    try {
      ensureParentDirForFile(backupAbsolutePath);
      fs.copyFileSync(absolutePath, backupAbsolutePath);
      manifestFiles.push({
        path: relPath,
        type: 'file',
        backupPath: backupPosixPath,
        sha256: computeFileSha256(absolutePath),
        size: Number(stats.size) || 0,
        mode: Number(stats.mode) || 0
      });
    } catch (_error) {
      // best-effort snapshot file copy
    }
  });

  const manifest = normalizeTaskSnapshotManifest({
    version: 1,
    createdAt: nowIso(),
    repoRoot: repoRootDir,
    knownPaths,
    files: manifestFiles
  });
  try {
    fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  } catch (_error) {
    // best-effort snapshot persistence
  }
  return {
    snapshotDir,
    snapshotReady: manifest.files.length > 0,
    filesTotal: manifest.files.length,
    manifest
  };
}

function detectTouchedFilesFromSnapshot(snapshotManifest) {
  if (!snapshotManifest) return [];
  const manifest = normalizeTaskSnapshotManifest(snapshotManifest);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return [];
  }
  const touched = new Set();
  const baseline = new Set(manifest.knownPaths || []);
  const manifestByPath = new Map();
  manifest.files.forEach((entry) => {
    manifestByPath.set(entry.path, entry);
    baseline.add(entry.path);
  });

  manifest.files.forEach((entry) => {
    const absolutePath = resolveRepoPathFromRelative(entry.path);
    if (!absolutePath || !pathExistsOrSymlink(absolutePath)) {
      touched.add(entry.path);
      return;
    }
    let stats = null;
    try {
      stats = fs.lstatSync(absolutePath);
    } catch (_error) {
      stats = null;
    }
    if (!stats) {
      touched.add(entry.path);
      return;
    }

    if (entry.type === 'symlink') {
      if (!stats.isSymbolicLink()) {
        touched.add(entry.path);
        return;
      }
      let currentTarget = '';
      try {
        currentTarget = fs.readlinkSync(absolutePath);
      } catch (_error) {
        currentTarget = '';
      }
      if (String(currentTarget || '') !== String(entry.linkTarget || '')) {
        touched.add(entry.path);
      }
      return;
    }

    if (!stats.isFile()) {
      touched.add(entry.path);
      return;
    }
    try {
      const currentSha = computeFileSha256(absolutePath);
      if (entry.sha256 && currentSha !== entry.sha256) {
        touched.add(entry.path);
        return;
      }
      if (!entry.sha256 && Number(stats.size) !== Number(entry.size || 0)) {
        touched.add(entry.path);
      }
    } catch (_error) {
      touched.add(entry.path);
    }
  });

  const currentPaths = listTrackedAndUntrackedRepoFiles();
  currentPaths.forEach((entryPath) => {
    const normalized = normalizeRepoRelativePath(entryPath);
    if (!normalized) return;
    if (!baseline.has(normalized)) {
      touched.add(normalized);
    }
  });

  return Array.from(touched).sort();
}

function normalizeTaskStatus(rawStatus) {
  const normalized = String(rawStatus || '')
    .trim()
    .toLowerCase();
  if (!normalized) return 'running';
  if (normalized === 'ok') return 'success';
  if (normalized === 'error') return 'failed';
  return normalized;
}

function toTaskCommandStatus(rawStatus, exitCode = null) {
  const normalized = String(rawStatus || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'running' || normalized === 'in_progress') return 'running';
  if (normalized === 'success' || normalized === 'ok' || normalized === 'completed') {
    if (Number.isInteger(exitCode) && Number(exitCode) !== 0) {
      return 'failed';
    }
    return 'success';
  }
  if (normalized === 'failed' || normalized === 'error' || normalized === 'declined') return 'failed';
  if (!normalized) return Number.isInteger(exitCode) ? (Number(exitCode) === 0 ? 'success' : 'failed') : 'notice';
  return normalized;
}

function normalizeTaskCommandOutput(rawValue) {
  const value = String(rawValue || '');
  if (!value) return '';
  if (value.length <= taskCommandOutputMaxChars) return value;
  return `${value.slice(0, taskCommandOutputMaxChars - 3)}...`;
}

function normalizeTaskResultSummary(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.length <= taskResultSummaryMaxChars) return value;
  return `${value.slice(0, taskResultSummaryMaxChars - 3)}...`;
}

function normalizeTaskPlanText(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.length <= taskPlanMaxChars) return value;
  return `${value.slice(0, taskPlanMaxChars - 3)}...`;
}

function isTestLikeCommand(rawCommand) {
  const command = String(rawCommand || '')
    .trim()
    .toLowerCase();
  if (!command) return false;
  return (
    /\b(test|tests|jest|vitest|pytest|unittest|go test|cargo test|ctest|phpunit|rspec)\b/.test(command) ||
    /\b(lint|eslint|stylelint)\b/.test(command) ||
    /\b(typecheck|tsc\b|mypy|pyright|flow)\b/.test(command)
  );
}

function computeTaskRiskLevel(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const status = normalizeTaskStatus(data.status || 'running');
  const filesTouchedCount = Number.isFinite(Number(data.filesTouchedCount)) ? Number(data.filesTouchedCount) : 0;
  const commandFailed = Number.isFinite(Number(data.commandFailed)) ? Number(data.commandFailed) : 0;
  const testsExecutedCount =
    Number.isFinite(Number(data.testsExecutedCount)) ? Number(data.testsExecutedCount) : 0;
  const rollbackReady = Boolean(data.rollbackReady);

  let score = 0;
  if (status !== 'success') score += 2;
  if (commandFailed > 0) score += 2;
  if (filesTouchedCount >= 12) score += 2;
  else if (filesTouchedCount >= 5) score += 1;
  if (testsExecutedCount === 0) score += 1;
  if (!rollbackReady) score += 1;

  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function safeParseJsonArray(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function safeParseJsonObject(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function pushLimited(list, item, maxItems) {
  if (!Array.isArray(list)) return;
  list.push(item);
  if (list.length > maxItems) {
    list.splice(0, list.length - maxItems);
  }
}

function normalizeApiMetricPath(pathValue) {
  const raw = String(pathValue || '').split('?')[0].trim();
  if (!raw) return '/';
  return raw
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{13,}(?=\/|$)/gi, '/:uuid')
    .replace(/\/[A-Za-z0-9_-]{18,}(?=\/|$)/g, '/:token');
}

function resolveApiMetricPath(req) {
  if (!req || typeof req !== 'object') return '/';
  if (req.route && typeof req.route.path === 'string') {
    const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
    return normalizeApiMetricPath(`${base}${req.route.path}`);
  }
  return normalizeApiMetricPath(req.path || req.originalUrl || '/');
}

function recordApiRequestMetric(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const method = String(data.method || 'GET').trim().toUpperCase() || 'GET';
  const pathName = normalizeApiMetricPath(data.path || '/');
  const durationMs = Number.isFinite(Number(data.durationMs)) ? Math.max(0, Number(data.durationMs)) : 0;
  const statusCode = Number(data.statusCode);
  const safeStatus = Number.isInteger(statusCode) ? statusCode : 0;
  const key = `${method} ${pathName}`;

  let entry = observabilityState.endpointStats.get(key);
  if (!entry) {
    entry = {
      method,
      path: pathName,
      count: 0,
      errorCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      recentDurationsMs: [],
      lastStatus: 0,
      lastAt: ''
    };
    observabilityState.endpointStats.set(key, entry);
  }

  entry.count += 1;
  entry.totalDurationMs += durationMs;
  entry.maxDurationMs = Math.max(entry.maxDurationMs, durationMs);
  pushLimited(entry.recentDurationsMs, durationMs, observabilityEndpointLatencyLimit);
  entry.lastStatus = safeStatus;
  entry.lastAt = nowIso();
  if (safeStatus >= 400) {
    entry.errorCount += 1;
    observabilityState.totalErrors += 1;
    pushLimited(
      observabilityState.recentErrors,
      {
        at: entry.lastAt,
        method,
        path: pathName,
        status: safeStatus,
        durationMs
      },
      observabilityRecentErrorsLimit
    );
  }

  observabilityState.totalRequests += 1;
  pushLimited(observabilityState.recentLatenciesMs, durationMs, observabilityGlobalLatencyLimit);
}

function computePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const safePercentile = Number.isFinite(Number(percentile)) ? Math.max(0, Math.min(100, Number(percentile))) : 0;
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((safePercentile / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function summarizeLatencySamples(values) {
  const numbers = Array.isArray(values)
    ? values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  if (numbers.length === 0) {
    return {
      sampleCount: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0
    };
  }
  const total = numbers.reduce((acc, value) => acc + value, 0);
  const maxMs = numbers.reduce((acc, value) => Math.max(acc, value), 0);
  return {
    sampleCount: numbers.length,
    avgMs: Number((total / numbers.length).toFixed(1)),
    p50Ms: Number(computePercentile(numbers, 50).toFixed(1)),
    p95Ms: Number(computePercentile(numbers, 95).toFixed(1)),
    p99Ms: Number(computePercentile(numbers, 99).toFixed(1)),
    maxMs: Number(maxMs.toFixed(1))
  };
}

function sampleProcessCpuUsagePercent() {
  const nowMs = Date.now();
  const usage = process.cpuUsage();
  const elapsedUs = Math.max(1, (nowMs - processCpuSnapshot.atMs) * 1000);
  const userDiff = usage.user - processCpuSnapshot.usage.user;
  const systemDiff = usage.system - processCpuSnapshot.usage.system;
  const totalUsedUs = Math.max(0, userDiff + systemDiff);
  const rawPercent = (totalUsedUs / elapsedUs) * 100;
  processCpuSnapshot = {
    usage,
    atMs: nowMs
  };
  const logicalCpuCount = Math.max(1, (os.cpus() || []).length);
  return {
    processCpuPercent: Number(rawPercent.toFixed(1)),
    processCpuPerCorePercent: Number((rawPercent / logicalCpuCount).toFixed(1))
  };
}

function buildObservabilitySnapshot() {
  const nowMs = Date.now();
  const uptimeSeconds = Math.max(0, Math.round(process.uptime()));
  const processMemory = process.memoryUsage();
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);
  const usedMemPercent = totalMemBytes > 0 ? (usedMemBytes / totalMemBytes) * 100 : 0;
  const cpuUsage = sampleProcessCpuUsagePercent();
  const endpointStats = Array.from(observabilityState.endpointStats.values()).map((entry) => {
    const latency = summarizeLatencySamples(entry.recentDurationsMs);
    const requests = Math.max(0, Number(entry.count) || 0);
    const errors = Math.max(0, Number(entry.errorCount) || 0);
    return {
      method: entry.method,
      path: entry.path,
      requests,
      errors,
      errorRate: requests > 0 ? Number(((errors / requests) * 100).toFixed(1)) : 0,
      avgMs: latency.avgMs,
      p95Ms: latency.p95Ms,
      maxMs: latency.maxMs,
      lastStatus: Number.isInteger(Number(entry.lastStatus)) ? Number(entry.lastStatus) : 0,
      lastAt: String(entry.lastAt || '')
    };
  });
  endpointStats.sort((a, b) => {
    if (b.errors !== a.errors) return b.errors - a.errors;
    if (b.avgMs !== a.avgMs) return b.avgMs - a.avgMs;
    return b.requests - a.requests;
  });
  const globalLatency = summarizeLatencySamples(observabilityState.recentLatenciesMs);
  const totalRequests = Math.max(0, Number(observabilityState.totalRequests) || 0);
  const totalErrors = Math.max(0, Number(observabilityState.totalErrors) || 0);

  return {
    sampledAt: new Date(nowMs).toISOString(),
    startedAt: new Date(observabilityState.startedAtMs).toISOString(),
    uptimeSeconds,
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      cpuPercent: cpuUsage.processCpuPercent,
      cpuPerCorePercent: cpuUsage.processCpuPerCorePercent,
      memory: {
        rssBytes: processMemory.rss,
        heapUsedBytes: processMemory.heapUsed,
        heapTotalBytes: processMemory.heapTotal,
        externalBytes: processMemory.external,
        arrayBuffersBytes: processMemory.arrayBuffers
      }
    },
    system: {
      cpuCount: Math.max(1, (os.cpus() || []).length),
      loadAvg1m: Number((os.loadavg()[0] || 0).toFixed(2)),
      loadAvg5m: Number((os.loadavg()[1] || 0).toFixed(2)),
      loadAvg15m: Number((os.loadavg()[2] || 0).toFixed(2)),
      totalMemBytes,
      freeMemBytes,
      usedMemBytes,
      usedMemPercent: Number(usedMemPercent.toFixed(1))
    },
    api: {
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? Number(((totalErrors / totalRequests) * 100).toFixed(1)) : 0,
      latency: globalLatency,
      endpoints: endpointStats.slice(0, observabilityEndpointsLimit),
      recentErrors: observabilityState.recentErrors.slice().reverse().slice(0, 50)
    }
  };
}

function normalizeToolsSearchQuery(rawValue) {
  const compact = String(rawValue || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  if (compact.length <= 120) return compact;
  return compact.slice(0, 120);
}

function toSqlLikePattern(value) {
  return `%${String(value || '').toLowerCase()}%`;
}

function buildSearchSnippet(rawText, rawQuery, maxLen = 190) {
  const text = String(rawText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (!rawQuery) {
    return text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
  }
  const query = String(rawQuery || '').toLowerCase();
  const lower = text.toLowerCase();
  const matchIdx = lower.indexOf(query);
  if (matchIdx < 0) {
    return text.length > maxLen ? `${text.slice(0, maxLen - 3)}...` : text;
  }
  const contextPadding = Math.max(30, Math.floor(maxLen * 0.35));
  const start = Math.max(0, matchIdx - contextPadding);
  const end = Math.min(text.length, start + maxLen);
  const chunk = text.slice(start, end);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${chunk}${suffix}`;
}

function serializeTaskCommandRow(row) {
  const safe = row && typeof row === 'object' ? row : {};
  const exitCode = Number(safe.exit_code);
  const parsedId = Number(safe.id);
  const durationMs = Number(safe.duration_ms);
  return {
    id: Number.isInteger(parsedId) ? parsedId : 0,
    itemId: String(safe.item_id || ''),
    command: String(safe.command || ''),
    output: normalizeTaskCommandOutput(safe.output || ''),
    status: toTaskCommandStatus(safe.status || '', Number.isInteger(exitCode) ? exitCode : null),
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    startedAt: String(safe.started_at || ''),
    finishedAt: String(safe.finished_at || ''),
    durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  };
}

function serializeTaskRow(row) {
  const safe = row && typeof row === 'object' ? row : {};
  const filesTouched = safeParseJsonArray(safe.files_touched_json)
    .map((entry) => normalizeRepoRelativePath(entry))
    .filter(Boolean);
  const testsExecuted = safeParseJsonArray(safe.tests_json)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  const metrics = safeParseJsonObject(safe.metrics_json);
  const parsedConversationId = Number(safe.conversation_id);
  const parsedTaskId = Number(safe.id);
  const commandTotal = Number(safe.command_total);
  const commandFailed = Number(safe.command_failed);
  const durationMs = Number(safe.duration_ms);

  return {
    id: Number.isInteger(parsedTaskId) ? parsedTaskId : 0,
    conversationId:
      Number.isInteger(parsedConversationId) && parsedConversationId > 0 ? parsedConversationId : null,
    conversationTitle: String(safe.conversation_title || ''),
    status: normalizeTaskStatus(safe.status || 'running'),
    result: normalizeTaskResultSummary(safe.result_summary || ''),
    closeReason: String(safe.close_reason || ''),
    riskLevel: String(safe.risk_level || 'low'),
    startedAt: String(safe.started_at || ''),
    finishedAt: String(safe.finished_at || ''),
    updatedAt: String(safe.updated_at || ''),
    durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
    filesTouched,
    testsExecuted,
    metrics,
    commandTotal: Number.isFinite(commandTotal) ? Math.max(0, Number(commandTotal)) : 0,
    commandFailed: Number.isFinite(commandFailed) ? Math.max(0, Number(commandFailed)) : 0,
    rollbackAvailable: Boolean(Number(safe.rollback_available)),
    rollbackStatus: String(safe.rollback_status || ''),
    rollbackError: String(safe.rollback_error || ''),
    rollbackAt: String(safe.rollback_at || ''),
    snapshotReady: Boolean(Number(safe.snapshot_ready)),
    snapshotDir: String(safe.snapshot_dir || ''),
    planText: normalizeTaskPlanText(safe.plan_text || '')
  };
}

function serializeTaskRecovery(row, commandRows, fallbackPlanText = '') {
  if (!row) return null;
  const task = serializeTaskRow(row);
  const commands = Array.isArray(commandRows) ? commandRows.map(serializeTaskCommandRow) : [];
  const planText = task.planText || normalizeTaskPlanText(fallbackPlanText);
  return {
    taskId: task.id,
    status: task.status,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    planText,
    commands
  };
}

function serializeReasoningMapToText(reasoningMap) {
  if (!reasoningMap || typeof reasoningMap !== 'object') return '';
  return normalizeTaskPlanText(
    Object.values(reasoningMap)
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .join('\n\n')
  );
}

function restoreTaskFilesFromSnapshot(snapshotDir, touchedFiles) {
  const manifest = loadTaskSnapshotManifest(snapshotDir);
  if (!manifest) {
    return {
      restored: 0,
      removed: 0,
      failed: 1,
      touchedFiles: [],
      errors: ['snapshot_manifest_missing']
    };
  }
  const entryByPath = new Map();
  manifest.files.forEach((entry) => {
    entryByPath.set(entry.path, entry);
  });

  const targetPaths = [];
  const seen = new Set();
  (Array.isArray(touchedFiles) ? touchedFiles : []).forEach((entry) => {
    const normalized = normalizeRepoRelativePath(entry);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    targetPaths.push(normalized);
  });
  if (targetPaths.length === 0) {
    const inferredTouched = detectTouchedFilesFromSnapshot(manifest);
    inferredTouched.forEach((entry) => {
      if (!seen.has(entry)) {
        seen.add(entry);
        targetPaths.push(entry);
      }
    });
  }

  let restored = 0;
  let removed = 0;
  let failed = 0;
  const errors = [];

  targetPaths.forEach((relPath) => {
    const absolutePath = resolveRepoPathFromRelative(relPath);
    if (!absolutePath) return;
    const snapshotEntry = entryByPath.get(relPath);
    try {
      if (snapshotEntry) {
        ensureParentDirForFile(absolutePath);
        if (pathExistsOrSymlink(absolutePath)) {
          fs.rmSync(absolutePath, { recursive: true, force: true });
        }
        if (snapshotEntry.type === 'symlink') {
          fs.symlinkSync(snapshotEntry.linkTarget || '', absolutePath);
          restored += 1;
          return;
        }
        const backupPath = normalizeRepoRelativePath(snapshotEntry.backupPath);
        const backupAbsolutePath = backupPath
          ? path.join(snapshotDir, ...backupPath.split('/'))
          : '';
        if (!backupAbsolutePath || !fs.existsSync(backupAbsolutePath)) {
          failed += 1;
          errors.push(`backup_missing:${relPath}`);
          return;
        }
        fs.copyFileSync(backupAbsolutePath, absolutePath);
        if (Number.isInteger(snapshotEntry.mode) && snapshotEntry.mode > 0) {
          try {
            fs.chmodSync(absolutePath, snapshotEntry.mode);
          } catch (_error) {
            // best-effort mode restore
          }
        }
        restored += 1;
        return;
      }

      if (pathExistsOrSymlink(absolutePath)) {
        fs.rmSync(absolutePath, { recursive: true, force: true });
        removed += 1;
      }
    } catch (error) {
      failed += 1;
      errors.push(
        `${relPath}:${truncateForNotify(error && error.message ? error.message : 'restore_failed', 160)}`
      );
    }
  });

  return {
    restored,
    removed,
    failed,
    touchedFiles: targetPaths,
    errors
  };
}

function sanitizeFilename(name) {
  const base = String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const compact = base.replace(/^_+|_+$/g, '');
  return compact || 'file';
}

function decodeHeaderValue(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    return decodeURIComponent(source);
  } catch (_error) {
    return source;
  }
}

function cleanupPendingUploads() {
  const now = Date.now();
  for (const [uploadId, entry] of pendingUploads.entries()) {
    const filePath = entry && entry.path ? String(entry.path) : '';
    if (!filePath || !fs.existsSync(filePath)) {
      pendingUploads.delete(uploadId);
      continue;
    }
    const createdAt = Number(entry && entry.createdAt);
    const isExpired = !Number.isFinite(createdAt) || now - createdAt > pendingUploadTtlMs;
    if (!isExpired) continue;
    pendingUploads.delete(uploadId);
    try {
      fs.unlinkSync(filePath);
    } catch (_error) {
      // best-effort cleanup
    }
  }
}

async function streamRequestToFile(req, destinationPath, maxBytes) {
  let totalBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        callback(createClientRequestError(`Adjunto demasiado grande (maximo ${maxAttachmentSizeMb}MB)`, 413));
        return;
      }
      callback(null, chunk);
    }
  });

  try {
    await pipelineAsync(req, limiter, fs.createWriteStream(destinationPath, { flags: 'wx' }));
  } catch (error) {
    try {
      if (fs.existsSync(destinationPath)) {
        fs.unlinkSync(destinationPath);
      }
    } catch (_unlinkError) {
      // best-effort cleanup
    }
    throw error;
  }

  return totalBytes;
}

function moveFileSync(sourcePath, targetPath) {
  try {
    fs.renameSync(sourcePath, targetPath);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') {
      throw error;
    }
  }
  fs.copyFileSync(sourcePath, targetPath);
  fs.unlinkSync(sourcePath);
}

function buildAttachmentPreviewText(filePath, name, mimeType, size) {
  const isTextLike =
    mimeType.startsWith('text/') ||
    /\.(md|txt|json|js|ts|tsx|jsx|css|html|xml|yaml|yml|csv|log|py|java|go|rs|sql|sh)$/i.test(name);
  if (!isTextLike || size > 200 * 1024) {
    return '';
  }
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_error) {
    return '';
  }
}

function decodeAttachmentBase64(base64Value) {
  const value = String(base64Value || '');
  if (!value) return null;
  try {
    const normalized = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized || normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
      return null;
    }
    const decoded = Buffer.from(normalized, 'base64');
    if (decoded.length === 0) {
      return null;
    }
    const canonicalInput = normalized.replace(/=+$/, '');
    const canonicalDecoded = decoded.toString('base64').replace(/=+$/, '');
    if (canonicalInput !== canonicalDecoded) {
      return null;
    }
    return decoded;
  } catch (_error) {
    return null;
  }
}

function persistAttachments(rawAttachments, conversationId, userId) {
  const safeList = Array.isArray(rawAttachments) ? rawAttachments : [];
  if (safeList.length === 0) return [];
  if (safeList.length > maxAttachments) {
    throw createClientRequestError(`Demasiados adjuntos (maximo ${maxAttachments})`, 413);
  }
  cleanupPendingUploads();

  const conversationDir = path.join(uploadsDir, String(conversationId));
  fs.mkdirSync(conversationDir, { recursive: true });
  const consumedUploadIds = new Set();

  return safeList.map((item, index) => {
    const uploadId = String((item && item.uploadId) || '').trim();
    if (uploadId) {
      if (consumedUploadIds.has(uploadId)) {
        throw createClientRequestError(`Adjunto duplicado: ${uploadId}`, 400);
      }
      consumedUploadIds.add(uploadId);
      const uploaded = pendingUploads.get(uploadId);
      if (!uploaded || uploaded.userId !== userId) {
        throw createClientRequestError(`Adjunto invalido: ${uploadId}`, 400);
      }
      if (uploaded.conversationId !== null && uploaded.conversationId !== conversationId) {
        throw createClientRequestError(`Adjunto invalido para esta conversacion: ${uploaded.name}`, 400);
      }
      if (!uploaded.path || !fs.existsSync(uploaded.path)) {
        pendingUploads.delete(uploadId);
        throw createClientRequestError(`Adjunto no disponible: ${uploaded.name || uploadId}`, 400);
      }
      const name = sanitizeFilename(uploaded.name || `file_${index + 1}`);
      const mimeType = String(uploaded.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
      const size = Number(uploaded.size);
      if (!Number.isFinite(size) || size <= 0) {
        pendingUploads.delete(uploadId);
        throw createClientRequestError(`Adjunto invalido: ${name}`, 400);
      }
      if (size > maxAttachmentSizeBytes) {
        pendingUploads.delete(uploadId);
        throw createClientRequestError(`Adjunto demasiado grande: ${name} (maximo ${maxAttachmentSizeMb}MB)`, 413);
      }

      const storedName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${name}`;
      const storedPath = path.join(conversationDir, storedName);
      moveFileSync(uploaded.path, storedPath);
      pendingUploads.delete(uploadId);

      const previewText = buildAttachmentPreviewText(storedPath, name, mimeType, size);
      return {
        name,
        mimeType,
        size,
        path: storedPath,
        previewText
      };
    }

    const name = sanitizeFilename(item && item.name ? item.name : `file_${index + 1}`);
    const mimeType = String((item && item.type) || 'application/octet-stream').trim() || 'application/octet-stream';
    const declaredSize = Number(item && item.size);
    if (Number.isFinite(declaredSize) && declaredSize > maxAttachmentSizeBytes) {
      throw createClientRequestError(`Adjunto demasiado grande: ${name} (maximo ${maxAttachmentSizeMb}MB)`, 413);
    }
    const dataBuffer = decodeAttachmentBase64(item && item.base64 ? item.base64 : '');
    if (!dataBuffer || dataBuffer.length === 0) {
      throw createClientRequestError(`Adjunto invalido: ${name}`, 400);
    }
    if (Number.isFinite(declaredSize) && declaredSize !== dataBuffer.length) {
      throw createClientRequestError(`Adjunto invalido: ${name}`, 400);
    }
    if (dataBuffer.length > maxAttachmentSizeBytes) {
      throw createClientRequestError(`Adjunto demasiado grande: ${name} (maximo ${maxAttachmentSizeMb}MB)`, 413);
    }

    const storedName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${name}`;
    const storedPath = path.join(conversationDir, storedName);
    fs.writeFileSync(storedPath, dataBuffer);

    const previewText = buildAttachmentPreviewText(storedPath, name, mimeType, dataBuffer.length);

    return {
      name,
      mimeType,
      size: dataBuffer.length,
      path: storedPath,
      previewText
    };
  });
}

function buildPromptWithAttachments(prompt, attachments) {
  if (!attachments || attachments.length === 0) return prompt;
  const lines = [prompt, '', 'Adjuntos disponibles en disco local del servidor:'];
  attachments.forEach((file, idx) => {
    lines.push(`${idx + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes) -> ${file.path}`);
    if (file.previewText) {
      lines.push(`Contenido de ${file.name}:`);
      lines.push('```');
      lines.push(file.previewText);
      lines.push('```');
    }
  });
  lines.push('Usa los adjuntos para responder. Si es imagen, analizala desde su ruta.');
  return lines.join('\n');
}

function buildPromptWithConversationHistory(currentPrompt, conversationMessages) {
  const normalized = Array.isArray(conversationMessages)
    ? conversationMessages
        .map((entry) => ({
          role: entry && typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '',
          content: entry && typeof entry.content === 'string' ? entry.content.trim() : ''
        }))
        .filter((entry) => (entry.role === 'user' || entry.role === 'assistant' || entry.role === 'system') && entry.content)
    : [];

  if (normalized.length === 0) {
    return currentPrompt;
  }

  const maxTurns = 24;
  const selected = normalized.slice(-maxTurns);
  const lines = [
    'Continua esta conversacion y responde al ultimo mensaje del usuario.',
    'Historial (orden cronologico):'
  ];

  selected.forEach((entry) => {
    if (entry.role === 'user') {
      lines.push(`Usuario: ${entry.content}`);
      return;
    }
    if (entry.role === 'assistant') {
      lines.push(`Asistente: ${entry.content}`);
      return;
    }
    lines.push(`Sistema: ${entry.content}`);
  });

  lines.push('');
  lines.push('Responde de forma coherente con el historial y enfocate en la ultima pregunta del usuario.');
  return lines.join('\n');
}

function normalizeRepoRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .trim();
}

function shouldIgnoreRepoDir(name) {
  const dirName = String(name || '').trim().toLowerCase();
  if (!dirName) return true;
  if (repoContextIgnoredDirs.has(dirName)) return true;
  if (dirName.startsWith('.') && dirName !== '.github') return true;
  return false;
}

function shouldIncludeRepoFile(fileName, relativePath) {
  const normalized = normalizeRepoRelativePath(relativePath).toLowerCase();
  if (!normalized) return false;
  if (
    normalized.startsWith('uploads/') ||
    normalized.startsWith('.codex_users/') ||
    normalized.startsWith('public/assets/') ||
    normalized.includes('/node_modules/')
  ) {
    return false;
  }

  const baseName = String(fileName || '').trim().toLowerCase();
  if (!baseName) return false;
  if (repoContextAllowedBareNames.has(baseName)) return true;
  const ext = path.extname(baseName);
  if (!ext || !repoContextAllowedTextExtensions.has(ext)) return false;
  if (baseName.endsWith('.min.js') || baseName.endsWith('.min.css')) return false;
  return true;
}

function detectRepoStackHints(indexedFiles) {
  const lowerPaths = new Set(
    (Array.isArray(indexedFiles) ? indexedFiles : []).map((file) => String(file && file.lowerPath).toLowerCase())
  );
  const hasTs = Array.from(lowerPaths).some((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'));
  const hasReact = Array.from(lowerPaths).some((entry) => entry.endsWith('.tsx') || entry.endsWith('.jsx'));
  const hints = [];

  if (lowerPaths.has('package.json')) hints.push('Node.js');
  if (hasTs || lowerPaths.has('tsconfig.json')) hints.push('TypeScript');
  if (hasReact) hints.push('React');
  if (lowerPaths.has('server.js') || Array.from(lowerPaths).some((entry) => entry.startsWith('server/'))) {
    hints.push('Backend JavaScript');
  }
  if (lowerPaths.has('readme.md')) hints.push('README');
  return hints.slice(0, 5);
}

function buildRepoContextIndex() {
  const now = Date.now();
  if (repoContextIndexCache && now - repoContextIndexCache.indexedAtMs < repoContextScanTtlMs) {
    return repoContextIndexCache;
  }

  const indexedFiles = [];
  const topLevelEntries = [];
  const pendingDirs = [{ absPath: repoRootDir, relPath: '', depth: 0 }];

  while (pendingDirs.length > 0 && indexedFiles.length < repoContextMaxIndexedFiles) {
    const current = pendingDirs.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current.absPath, { withFileTypes: true });
    } catch (_error) {
      continue;
    }

    entries.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (current.depth === 0) {
      entries.forEach((entry) => {
        if (topLevelEntries.length >= repoContextMaxTopLevelEntries) return;
        if (shouldIgnoreRepoDir(entry.name)) return;
        topLevelEntries.push(entry.name);
      });
    }

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const name = String(entry && entry.name ? entry.name : '').trim();
      if (!name) continue;
      const relativePath = current.relPath ? `${current.relPath}/${name}` : name;
      const normalizedRel = normalizeRepoRelativePath(relativePath).toLowerCase();
      if (!normalizedRel) continue;
      if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (shouldIgnoreRepoDir(name)) continue;
        if (
          normalizedRel === 'dixit/cards' ||
          normalizedRel.startsWith('uploads/') ||
          normalizedRel.startsWith('.codex_users/') ||
          normalizedRel.startsWith('public/assets/')
        ) {
          continue;
        }
        pendingDirs.push({
          absPath: path.join(current.absPath, name),
          relPath: relativePath,
          depth: current.depth + 1
        });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!shouldIncludeRepoFile(name, relativePath)) continue;
      indexedFiles.push({
        relativePath,
        lowerPath: normalizedRel,
        baseLower: name.toLowerCase()
      });
      if (indexedFiles.length >= repoContextMaxIndexedFiles) {
        break;
      }
    }
  }

  indexedFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const nextCache = {
    rootDir: repoRootDir,
    indexedAtMs: now,
    files: indexedFiles,
    topLevelEntries,
    stackHints: detectRepoStackHints(indexedFiles)
  };
  repoContextIndexCache = nextCache;
  return nextCache;
}

function extractRepoQueryTokens(text) {
  const source = String(text || '').toLowerCase();
  if (!source) return [];
  const rawParts = source.match(/[a-z0-9._/-]{2,}/g) || [];
  const unique = new Set();
  const result = [];

  const pushToken = (rawValue) => {
    const token = String(rawValue || '')
      .toLowerCase()
      .replace(/^[._/-]+|[._/-]+$/g, '');
    if (!token) return;
    if (token.length < 2) return;
    if (/^\d+$/.test(token)) return;
    if (repoContextStopWords.has(token)) return;
    if (unique.has(token)) return;
    unique.add(token);
    result.push(token);
  };

  rawParts.forEach((part) => {
    pushToken(part);
    if (part.includes('/')) {
      part.split('/').forEach((segment) => pushToken(segment));
    }
    if (part.includes('.')) {
      part.split('.').forEach((segment) => pushToken(segment));
    }
  });

  return result.slice(0, 28);
}

function extractExplicitRepoPaths(text) {
  const source = String(text || '');
  const matches = source.match(/(?:\.{0,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g) || [];
  const normalized = new Set();
  matches.forEach((entry) => {
    const cleaned = String(entry || '').replace(/^[`"'([{]+|[`"')\]},.:;!?]+$/g, '');
    const relative = normalizeRepoRelativePath(cleaned).toLowerCase();
    if (relative) {
      normalized.add(relative);
    }
  });
  return normalized;
}

function extractExplicitRepoFilenames(text) {
  const source = String(text || '').toLowerCase();
  const matches = source.match(/\b[a-z0-9_.-]+\.[a-z0-9_-]{1,8}\b/g) || [];
  return new Set(matches.map((entry) => String(entry || '').trim()).filter(Boolean));
}

function selectDefaultRepoCandidates(indexedFiles) {
  const preferredPaths = [
    'server.js',
    'package.json',
    'readme.md',
    'stitch_frontend/src/components/chatscreen.tsx',
    'stitch_frontend/src/app.tsx'
  ];
  const chosen = [];
  preferredPaths.forEach((target) => {
    if (chosen.length >= repoContextMaxCandidates) return;
    const hit = indexedFiles.find((file) => file.lowerPath === target);
    if (!hit) return;
    chosen.push({
      relativePath: hit.relativePath,
      score: 1,
      matches: ['base']
    });
  });
  if (chosen.length >= repoContextMaxCandidates) {
    return chosen;
  }

  const extras = indexedFiles
    .filter((file) => !chosen.some((entry) => entry.relativePath === file.relativePath))
    .slice(0, repoContextMaxCandidates - chosen.length)
    .map((file) => ({
      relativePath: file.relativePath,
      score: 1,
      matches: ['base']
    }));
  return [...chosen, ...extras];
}

function rankRepoFilesForPrompt(promptText) {
  const contextIndex = buildRepoContextIndex();
  const indexedFiles = contextIndex.files;
  if (!indexedFiles || indexedFiles.length === 0) {
    return {
      rootDir: contextIndex.rootDir,
      stackHints: contextIndex.stackHints,
      topLevelEntries: contextIndex.topLevelEntries,
      candidates: []
    };
  }

  const tokens = extractRepoQueryTokens(promptText);
  const explicitPaths = extractExplicitRepoPaths(promptText);
  const explicitPathList = Array.from(explicitPaths);
  const explicitFilenames = extractExplicitRepoFilenames(promptText);

  const scored = [];
  indexedFiles.forEach((file) => {
    let score = 0;
    const matchedTokens = new Set();

    if (
      explicitPaths.has(file.lowerPath) ||
      explicitPathList.some((entry) => file.lowerPath === entry || file.lowerPath.endsWith(`/${entry}`))
    ) {
      score += 360;
      matchedTokens.add('ruta');
    }
    if (explicitFilenames.has(file.baseLower)) {
      score += 190;
      matchedTokens.add(file.baseLower);
    }

    tokens.forEach((token) => {
      let tokenMatched = false;

      if (file.baseLower === token) {
        score += 180;
        tokenMatched = true;
      } else if (
        file.baseLower.startsWith(`${token}.`) ||
        file.baseLower.startsWith(`${token}-`) ||
        file.baseLower.startsWith(`${token}_`)
      ) {
        score += 120;
        tokenMatched = true;
      } else if (file.baseLower.includes(token)) {
        score += 70;
        tokenMatched = true;
      }

      if (file.lowerPath.includes(`/${token}/`) || file.lowerPath.endsWith(`/${token}`)) {
        score += 55;
        tokenMatched = true;
      } else if (file.lowerPath.includes(token)) {
        score += 25;
        tokenMatched = true;
      }

      if (tokenMatched && matchedTokens.size < 4) {
        matchedTokens.add(token);
      }
    });

    if (score > 0) {
      scored.push({
        relativePath: file.relativePath,
        score,
        matches: Array.from(matchedTokens).slice(0, 4)
      });
    }
  });

  scored.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));
  const selected = scored.slice(0, repoContextMaxCandidates);
  const candidates = selected.length > 0 ? selected : selectDefaultRepoCandidates(indexedFiles);

  return {
    rootDir: contextIndex.rootDir,
    stackHints: contextIndex.stackHints,
    topLevelEntries: contextIndex.topLevelEntries,
    candidates
  };
}

function buildPromptWithRepoContext(currentPrompt, userPrompt) {
  const context = rankRepoFilesForPrompt(userPrompt);
  const candidates = Array.isArray(context.candidates) ? context.candidates : [];
  if (candidates.length === 0) {
    return currentPrompt;
  }

  const lines = [currentPrompt, '', 'Contexto automatico del repo (deteccion previa de CodexWeb):'];
  lines.push(`Raiz detectada: ${context.rootDir}`);

  if (Array.isArray(context.stackHints) && context.stackHints.length > 0) {
    lines.push(`Stack probable: ${context.stackHints.join(', ')}`);
  }
  if (Array.isArray(context.topLevelEntries) && context.topLevelEntries.length > 0) {
    lines.push(`Top-level: ${context.topLevelEntries.join(', ')}`);
  }

  lines.push('Archivos posiblemente relevantes para esta consulta:');
  candidates.forEach((entry, index) => {
    const matchHint =
      Array.isArray(entry.matches) && entry.matches.length > 0
        ? ` [match: ${entry.matches.join(', ')}]`
        : '';
    lines.push(`${index + 1}. ${entry.relativePath}${matchHint}`);
  });

  lines.push('Toma esto como punto de partida y valida en los archivos reales antes de editar.');
  return lines.join('\n');
}

function notifyMilestone(key, message) {
  if (sentMilestones.has(key)) return;
  sentMilestones.add(key);
  void notify(message);
}

async function resolveWhichPath(commandName) {
  if (!/^[a-zA-Z0-9._-]+$/.test(commandName || '')) {
    throw new Error('INVALID_COMMAND');
  }
  const { stdout } = await execFileAsync('which', [commandName], {
    timeout: 5000,
    maxBuffer: 16 * 1024
  });
  const binPath = (stdout || '').trim().split('\n')[0];
  if (!binPath) throw new Error('NOT_FOUND');
  return binPath;
}

async function resolveCodexPath() {
  if (resolvedCodexPath) {
    return resolvedCodexPath;
  }
  if (process.env.CODEX_CMD && process.env.CODEX_CMD.trim()) {
    resolvedCodexPath = process.env.CODEX_CMD.trim();
    return resolvedCodexPath;
  }
  let discovered = null;
  try {
    discovered = await resolveWhichPath('codex');
  } catch (_error) {
    discovered = null;
  }
  if (!discovered) {
    throw new Error('CODEX_NOT_FOUND');
  }
  resolvedCodexPath = discovered;
  return resolvedCodexPath;
}

async function resolveGeminiPath() {
  if (resolvedGeminiPath) {
    return resolvedGeminiPath;
  }
  if (process.env.GEMINI_CMD && process.env.GEMINI_CMD.trim()) {
    resolvedGeminiPath = process.env.GEMINI_CMD.trim();
    return resolvedGeminiPath;
  }
  let discovered = null;
  try {
    discovered = await resolveWhichPath('gemini');
  } catch (_error) {
    discovered = null;
  }
  if (!discovered) {
    throw new Error('GEMINI_NOT_FOUND');
  }
  resolvedGeminiPath = discovered;
  return resolvedGeminiPath;
}

function scheduleApplicationRestart(attemptId) {
  const relaunchArgs = [...process.execArgv, ...process.argv.slice(1)];
  if (relaunchArgs.length === 0) {
    throw new Error('no_entrypoint_for_restart');
  }
  const helperScript = `
const { spawn } = require('child_process');
const fs = require('fs');
const relaunchArgs = ${JSON.stringify(relaunchArgs)};
const statePath = ${JSON.stringify(restartStatePath)};
const attemptId = ${JSON.stringify(attemptId || '')};
const logLimit = ${Number(restartLogLimit)};

function loadState() {
  try {
    if (!fs.existsSync(statePath)) return null;
    const raw = fs.readFileSync(statePath, 'utf8');
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (_error) {
    // best-effort logging only
  }
}

function withState(updateFn) {
  const state = loadState();
  if (!state || state.attemptId !== attemptId) return;
  updateFn(state);
  state.updatedAt = new Date().toISOString();
  saveState(state);
}

function appendLog(message) {
  withState((state) => {
    const logs = Array.isArray(state.logs) ? state.logs : [];
    logs.push({
      at: new Date().toISOString(),
      message: String(message || '').slice(0, 500)
    });
    state.logs = logs.slice(-logLimit);
  });
}

function setPhase(phase) {
  withState((state) => {
    state.phase = String(phase || 'unknown');
  });
}

appendLog('Helper de reinicio iniciado');
setPhase('relaunch_pending');
setTimeout(() => {
  try {
    appendLog('Lanzando nuevo proceso de CodexWeb');
    const child = spawn(${JSON.stringify(process.execPath)}, relaunchArgs, {
      cwd: ${JSON.stringify(process.cwd())},
      env: process.env,
      detached: true,
      stdio: 'ignore'
    });
    if (child && child.pid) {
      appendLog('Nuevo proceso lanzado');
      setPhase('relaunch_spawned');
      child.unref();
      return;
    }
    appendLog('No se pudo obtener PID del nuevo proceso');
    setPhase('relaunch_failed');
  } catch (error) {
    appendLog('Error al relanzar: ' + (error && error.message ? error.message : 'spawn_failed'));
    setPhase('relaunch_failed');
  }
}, 700);
`;

  const helper = spawn(process.execPath, ['-e', helperScript], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore'
  });
  if (!helper.pid) {
    throw new Error('restart_helper_spawn_failed');
  }
  helper.unref();
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active_ai_agent_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_agent_integrations (
  user_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  api_key TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, agent_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_agent_integrations_user
ON user_agent_integrations(user_id, agent_id ASC);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  UNIQUE (message_id, stored_name)
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_created
ON conversations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
ON messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
ON message_attachments(message_id, id ASC);

CREATE INDEX IF NOT EXISTS idx_message_attachments_conversation
ON message_attachments(conversation_id, id ASC);

CREATE TABLE IF NOT EXISTS chat_live_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  conversation_id INTEGER,
  assistant_message_id INTEGER,
  request_id TEXT NOT NULL,
  user_message_content TEXT NOT NULL,
  assistant_content TEXT NOT NULL DEFAULT '',
  reasoning_json TEXT NOT NULL DEFAULT '{}',
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (assistant_message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_live_drafts_user_conversation
ON chat_live_drafts(user_id, conversation_id, completed, updated_at DESC);

CREATE TABLE IF NOT EXISTS task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  conversation_id INTEGER,
  request_id TEXT NOT NULL UNIQUE,
  prompt_text TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  reasoning_effort TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  close_reason TEXT NOT NULL DEFAULT '',
  result_summary TEXT NOT NULL DEFAULT '',
  plan_text TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'low',
  snapshot_dir TEXT NOT NULL DEFAULT '',
  snapshot_ready INTEGER NOT NULL DEFAULT 0,
  files_touched_json TEXT NOT NULL DEFAULT '[]',
  tests_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  command_total INTEGER NOT NULL DEFAULT 0,
  command_failed INTEGER NOT NULL DEFAULT 0,
  rollback_available INTEGER NOT NULL DEFAULT 0,
  rollback_status TEXT NOT NULL DEFAULT '',
  rollback_error TEXT NOT NULL DEFAULT '',
  rollback_at TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_task_runs_user_started
ON task_runs(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_runs_user_conversation_started
ON task_runs(user_id, conversation_id, started_at DESC);

CREATE TABLE IF NOT EXISTS task_run_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_run_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  command TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  started_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
  UNIQUE(task_run_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_task_run_commands_task_position
ON task_run_commands(task_run_id, position ASC, id ASC);
`);

function hasConversationColumn(columnName) {
  const columns = db.prepare('PRAGMA table_info(conversations)').all();
  return columns.some((column) => String(column && column.name) === columnName);
}

function hasUserColumn(columnName) {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  return columns.some((column) => String(column && column.name) === columnName);
}

if (!hasConversationColumn('model')) {
  db.exec("ALTER TABLE conversations ADD COLUMN model TEXT NOT NULL DEFAULT ''");
}

if (!hasConversationColumn('reasoning_effort')) {
  db.exec(
    `ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT '${DEFAULT_REASONING_EFFORT}'`
  );
}

if (!hasUserColumn('discord_webhook_url')) {
  db.exec("ALTER TABLE users ADD COLUMN discord_webhook_url TEXT NOT NULL DEFAULT ''");
}

if (!hasUserColumn('discord_notify_on_finish')) {
  db.exec('ALTER TABLE users ADD COLUMN discord_notify_on_finish INTEGER NOT NULL DEFAULT 0');
}

if (!hasUserColumn('discord_include_result')) {
  db.exec('ALTER TABLE users ADD COLUMN discord_include_result INTEGER NOT NULL DEFAULT 0');
}

if (!hasUserColumn('active_ai_agent_id')) {
  db.exec("ALTER TABLE users ADD COLUMN active_ai_agent_id TEXT NOT NULL DEFAULT ''");
}

db.exec(`
UPDATE conversations
SET model = COALESCE(model, '')
`);
db.exec(`
UPDATE conversations
SET reasoning_effort = CASE
  WHEN reasoning_effort IN ('minimal', 'low', 'medium', 'high', 'xhigh') THEN reasoning_effort
  ELSE '${DEFAULT_REASONING_EFFORT}'
END
`);
db.exec(`
UPDATE users
SET
  discord_webhook_url = COALESCE(discord_webhook_url, ''),
  discord_notify_on_finish = CASE
    WHEN discord_notify_on_finish IN (0, 1) THEN discord_notify_on_finish
    ELSE 0
  END,
  discord_include_result = CASE
    WHEN discord_include_result IN (0, 1) THEN discord_include_result
    ELSE 0
  END,
  active_ai_agent_id = COALESCE(active_ai_agent_id, '')
`);

const createConversationStmt = db.prepare(
  'INSERT INTO conversations (user_id, title, model, reasoning_effort) VALUES (?, ?, ?, ?)'
);
const insertMessageStmt = db.prepare(
  'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)'
);
const updateMessageContentStmt = db.prepare(
  'UPDATE messages SET content = ? WHERE id = ?'
);
const getConversationStmt = db.prepare(
  'SELECT id, user_id, title, model, reasoning_effort, created_at FROM conversations WHERE id = ?'
);
const updateConversationTitleStmt = db.prepare(
  "UPDATE conversations SET title = ? WHERE id = ? AND (title = 'Nuevo chat' OR title = '')"
);
const renameConversationTitleStmt = db.prepare(
  'UPDATE conversations SET title = ? WHERE id = ?'
);
const listConversationsStmt = db.prepare(`
  SELECT
    c.id,
    c.title,
    c.model,
    c.reasoning_effort,
    c.created_at,
    (
      SELECT MAX(d.updated_at)
      FROM chat_live_drafts d
      WHERE d.user_id = c.user_id
        AND d.conversation_id = c.id
        AND d.completed = 0
    ) AS live_draft_updated_at,
    (
      SELECT COUNT(1)
      FROM chat_live_drafts d
      WHERE d.user_id = c.user_id
        AND d.conversation_id = c.id
        AND d.completed = 0
    ) AS live_draft_open,
    (
      SELECT MAX(m.created_at)
      FROM messages m
      WHERE m.conversation_id = c.id
    ) AS last_message_at
  FROM conversations c
  WHERE c.user_id = ?
  ORDER BY COALESCE(last_message_at, c.created_at) DESC
`);
const updateConversationSettingsStmt = db.prepare(
  'UPDATE conversations SET model = ?, reasoning_effort = ? WHERE id = ?'
);
const getUserNotificationSettingsStmt = db.prepare(`
  SELECT
    discord_webhook_url,
    discord_notify_on_finish,
    discord_include_result
  FROM users
  WHERE id = ?
`);
const updateUserNotificationSettingsStmt = db.prepare(
  'UPDATE users SET discord_webhook_url = ?, discord_notify_on_finish = ?, discord_include_result = ? WHERE id = ?'
);
const getUserActiveAiAgentIdStmt = db.prepare(`
  SELECT active_ai_agent_id
  FROM users
  WHERE id = ?
  LIMIT 1
`);
const updateUserActiveAiAgentIdStmt = db.prepare(
  'UPDATE users SET active_ai_agent_id = ? WHERE id = ?'
);
const listUserAgentIntegrationsStmt = db.prepare(`
  SELECT
    agent_id,
    enabled,
    api_key,
    base_url,
    updated_at
  FROM user_agent_integrations
  WHERE user_id = ?
  ORDER BY agent_id ASC
`);
const getUserAgentIntegrationStmt = db.prepare(`
  SELECT
    agent_id,
    enabled,
    api_key,
    base_url,
    updated_at
  FROM user_agent_integrations
  WHERE user_id = ? AND agent_id = ?
  LIMIT 1
`);
const upsertUserAgentIntegrationStmt = db.prepare(`
  INSERT INTO user_agent_integrations (
    user_id,
    agent_id,
    enabled,
    api_key,
    base_url,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, agent_id) DO UPDATE SET
    enabled = excluded.enabled,
    api_key = excluded.api_key,
    base_url = excluded.base_url,
    updated_at = excluded.updated_at
`);
const deleteUserAgentIntegrationStmt = db.prepare(`
  DELETE FROM user_agent_integrations
  WHERE user_id = ? AND agent_id = ?
`);
const listMessagesStmt = db.prepare(`
  SELECT id, role, content, created_at
  FROM messages
  WHERE conversation_id = ?
  ORDER BY created_at ASC, id ASC
`);
const listMessagesPageDescStmt = db.prepare(`
  SELECT id, role, content, created_at
  FROM messages
  WHERE conversation_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);
const listMessagesBeforeIdPageDescStmt = db.prepare(`
  SELECT id, role, content, created_at
  FROM messages
  WHERE conversation_id = ?
    AND id < ?
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);
const listMessageAttachmentsByConversationRangeStmt = db.prepare(`
  SELECT
    message_id,
    conversation_id,
    stored_name,
    display_name,
    mime_type,
    size_bytes,
    created_at
  FROM message_attachments
  WHERE conversation_id = ?
    AND message_id BETWEEN ? AND ?
  ORDER BY id ASC
`);
const insertMessageAttachmentStmt = db.prepare(`
  INSERT INTO message_attachments (
    message_id,
    conversation_id,
    stored_name,
    display_name,
    mime_type,
    size_bytes,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const deleteMessageAttachmentsByFileStmt = db.prepare(`
  DELETE FROM message_attachments
  WHERE conversation_id = ?
    AND stored_name = ?
`);
const listOwnedConversationIdsStmt = db.prepare(`
  SELECT id, title
  FROM conversations
  WHERE user_id = ?
  ORDER BY created_at DESC
`);
const deleteConversationStmt = db.prepare('DELETE FROM conversations WHERE id = ?');
const closeOpenDraftsByConversationStmt = db.prepare(`
  UPDATE chat_live_drafts
  SET completed = 1, updated_at = ?
  WHERE user_id = ?
    AND completed = 0
    AND conversation_id = ?
`);
const insertLiveDraftStmt = db.prepare(`
  INSERT INTO chat_live_drafts (
    user_id,
    conversation_id,
    assistant_message_id,
    request_id,
    user_message_content,
    assistant_content,
    reasoning_json,
    completed,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateLiveDraftSnapshotStmt = db.prepare(`
  UPDATE chat_live_drafts
  SET
    conversation_id = ?,
    assistant_message_id = ?,
    assistant_content = ?,
    reasoning_json = ?,
    completed = ?,
    updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const updateLiveDraftSnapshotByRequestStmt = db.prepare(`
  UPDATE chat_live_drafts
  SET
    assistant_message_id = ?,
    assistant_content = ?,
    reasoning_json = ?,
    completed = ?,
    updated_at = ?
  WHERE user_id = ?
    AND conversation_id = ?
    AND request_id = ?
`);
const getOpenLiveDraftForConversationStmt = db.prepare(`
  SELECT
    id,
    request_id,
    conversation_id,
    assistant_message_id,
    user_message_content,
    assistant_content,
    reasoning_json,
    completed,
    updated_at,
    created_at
  FROM chat_live_drafts
  WHERE user_id = ?
    AND conversation_id = ?
    AND completed = 0
  ORDER BY updated_at DESC, id DESC
  LIMIT 1
`);
const insertTaskRunStmt = db.prepare(`
  INSERT INTO task_runs (
    user_id,
    conversation_id,
    request_id,
    prompt_text,
    model,
    reasoning_effort,
    status,
    snapshot_dir,
    snapshot_ready,
    started_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, 'running', '', 0, ?, ?)
`);
const updateTaskRunSnapshotStmt = db.prepare(`
  UPDATE task_runs
  SET
    snapshot_dir = ?,
    snapshot_ready = ?,
    updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const completeTaskRunStmt = db.prepare(`
  UPDATE task_runs
  SET
    status = ?,
    close_reason = ?,
    result_summary = ?,
    plan_text = ?,
    risk_level = ?,
    files_touched_json = ?,
    tests_json = ?,
    metrics_json = ?,
    command_total = ?,
    command_failed = ?,
    rollback_available = ?,
    finished_at = ?,
    duration_ms = ?,
    updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const markTaskRunRollbackStmt = db.prepare(`
  UPDATE task_runs
  SET
    status = 'rolled_back',
    rollback_status = ?,
    rollback_error = ?,
    rollback_at = ?,
    rollback_available = ?,
    close_reason = ?,
    updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const markTaskRunRollbackFailedStmt = db.prepare(`
  UPDATE task_runs
  SET
    rollback_status = ?,
    rollback_error = ?,
    rollback_at = ?,
    updated_at = ?
  WHERE id = ? AND user_id = ?
`);
const getTaskRunByIdForUserStmt = db.prepare(`
  SELECT
    t.*,
    c.title AS conversation_title
  FROM task_runs t
  LEFT JOIN conversations c
    ON c.id = t.conversation_id
  WHERE t.id = ? AND t.user_id = ?
  LIMIT 1
`);
const listTaskRunsForUserStmt = db.prepare(`
  SELECT
    t.*,
    c.title AS conversation_title
  FROM task_runs t
  LEFT JOIN conversations c
    ON c.id = t.conversation_id
  WHERE t.user_id = ?
  ORDER BY t.started_at DESC, t.id DESC
  LIMIT ?
`);
const searchConversationsStmt = db.prepare(`
  SELECT
    c.id AS conversation_id,
    c.title,
    c.created_at,
    (
      SELECT MAX(m.created_at)
      FROM messages m
      WHERE m.conversation_id = c.id
    ) AS last_message_at,
    (
      SELECT m.content
      FROM messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) AS last_message
  FROM conversations c
  WHERE c.user_id = ?
    AND (
      LOWER(c.title) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM messages m
        WHERE m.conversation_id = c.id
          AND LOWER(m.content) LIKE ?
      )
    )
  ORDER BY COALESCE(last_message_at, c.created_at) DESC, c.id DESC
  LIMIT ?
`);
const searchTaskCommandsStmt = db.prepare(`
  SELECT
    cmd.id,
    cmd.command,
    cmd.output,
    cmd.status,
    cmd.exit_code,
    cmd.started_at,
    cmd.finished_at,
    cmd.duration_ms,
    task.id AS task_id,
    task.conversation_id,
    task.updated_at AS task_updated_at,
    conv.title AS conversation_title
  FROM task_run_commands cmd
  INNER JOIN task_runs task
    ON task.id = cmd.task_run_id
  LEFT JOIN conversations conv
    ON conv.id = task.conversation_id
  WHERE task.user_id = ?
    AND (
      LOWER(cmd.command) LIKE ?
      OR LOWER(cmd.output) LIKE ?
    )
  ORDER BY COALESCE(cmd.finished_at, cmd.started_at, task.updated_at) DESC, cmd.id DESC
  LIMIT ?
`);
const searchTaskErrorsStmt = db.prepare(`
  SELECT
    task.id,
    task.conversation_id,
    conv.title AS conversation_title,
    task.status,
    task.close_reason,
    task.result_summary,
    task.command_failed,
    task.updated_at,
    task.finished_at,
    task.started_at
  FROM task_runs task
  LEFT JOIN conversations conv
    ON conv.id = task.conversation_id
  WHERE task.user_id = ?
    AND (
      task.status = 'failed'
      OR task.command_failed > 0
      OR LENGTH(task.close_reason) > 0
    )
    AND (
      LOWER(task.close_reason) LIKE ?
      OR LOWER(task.result_summary) LIKE ?
      OR LOWER(task.plan_text) LIKE ?
    )
  ORDER BY COALESCE(task.finished_at, task.updated_at, task.started_at) DESC, task.id DESC
  LIMIT ?
`);
const searchTaskFilesStmt = db.prepare(`
  SELECT
    task.id,
    task.conversation_id,
    conv.title AS conversation_title,
    task.files_touched_json,
    task.updated_at,
    task.finished_at,
    task.started_at
  FROM task_runs task
  LEFT JOIN conversations conv
    ON conv.id = task.conversation_id
  WHERE task.user_id = ?
    AND LOWER(task.files_touched_json) LIKE ?
  ORDER BY COALESCE(task.finished_at, task.updated_at, task.started_at) DESC, task.id DESC
  LIMIT ?
`);
const getLatestTaskRunForConversationStmt = db.prepare(`
  SELECT
    t.*,
    c.title AS conversation_title
  FROM task_runs t
  LEFT JOIN conversations c
    ON c.id = t.conversation_id
  WHERE t.user_id = ?
    AND t.conversation_id = ?
  ORDER BY t.started_at DESC, t.id DESC
  LIMIT 1
`);
const getTaskRunCommandByItemStmt = db.prepare(`
  SELECT
    id,
    task_run_id,
    item_id,
    position,
    command,
    status,
    output,
    exit_code,
    started_at,
    finished_at,
    duration_ms,
    updated_at
  FROM task_run_commands
  WHERE task_run_id = ?
    AND item_id = ?
  LIMIT 1
`);
const insertTaskRunCommandStmt = db.prepare(`
  INSERT INTO task_run_commands (
    task_run_id,
    item_id,
    position,
    command,
    status,
    output,
    exit_code,
    started_at,
    finished_at,
    duration_ms,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateTaskRunCommandStmt = db.prepare(`
  UPDATE task_run_commands
  SET
    position = ?,
    command = ?,
    status = ?,
    output = ?,
    exit_code = ?,
    started_at = ?,
    finished_at = ?,
    duration_ms = ?,
    updated_at = ?
  WHERE task_run_id = ?
    AND item_id = ?
`);
const listTaskRunCommandsStmt = db.prepare(`
  SELECT
    id,
    task_run_id,
    item_id,
    position,
    command,
    status,
    output,
    exit_code,
    started_at,
    finished_at,
    duration_ms,
    updated_at
  FROM task_run_commands
  WHERE task_run_id = ?
  ORDER BY position ASC, id ASC
  LIMIT ?
`);
const markStaleRunningTaskRunsStmt = db.prepare(`
  UPDATE task_runs
  SET
    status = 'failed',
    close_reason = 'server_restarted',
    finished_at = ?,
    rollback_available = CASE
      WHEN snapshot_ready = 1 THEN rollback_available
      ELSE 0
    END,
    updated_at = ?
  WHERE status = 'running'
`);

function resolveTaskDurationMs(startedAt, finishedAt, fallbackDuration = null) {
  if (Number.isFinite(Number(fallbackDuration))) {
    return Math.max(0, Number(fallbackDuration));
  }
  const startedMs = Date.parse(String(startedAt || ''));
  const finishedMs = Date.parse(String(finishedAt || ''));
  if (Number.isFinite(startedMs) && Number.isFinite(finishedMs)) {
    return Math.max(0, finishedMs - startedMs);
  }
  return 0;
}

function upsertTaskRunCommandRecord(taskRunId, itemId, payload = {}) {
  const safeTaskRunId = Number(taskRunId);
  const safeItemId = String(itemId || '').trim();
  if (!Number.isInteger(safeTaskRunId) || safeTaskRunId <= 0 || !safeItemId) {
    return null;
  }

  const existing = getTaskRunCommandByItemStmt.get(safeTaskRunId, safeItemId);
  const now = nowIso();
  const nextPositionRaw = Number(payload.position);
  const nextPosition =
    Number.isInteger(nextPositionRaw) && nextPositionRaw > 0
      ? nextPositionRaw
      : existing && Number.isInteger(Number(existing.position)) && Number(existing.position) > 0
        ? Number(existing.position)
        : 0;
  const nextCommand =
    String(payload.command || '').trim() ||
    String((existing && existing.command) || '').trim() ||
    '(comando)';
  const payloadExit = Number(payload.exitCode);
  const nextExitCode = Number.isInteger(payloadExit)
    ? payloadExit
    : Number.isInteger(Number(existing && existing.exit_code))
      ? Number(existing.exit_code)
      : null;
  const nextStatus = toTaskCommandStatus(
    String(payload.status || (existing && existing.status) || ''),
    nextExitCode
  );
  const nextOutput =
    payload.output !== undefined
      ? normalizeTaskCommandOutput(payload.output)
      : normalizeTaskCommandOutput((existing && existing.output) || '');
  const nextStartedAt =
    String(payload.startedAt || '').trim() ||
    String((existing && existing.started_at) || '').trim() ||
    now;
  const nextFinishedAt =
    String(payload.finishedAt || '').trim() ||
    String((existing && existing.finished_at) || '').trim() ||
    '';
  const nextDurationMs = resolveTaskDurationMs(nextStartedAt, nextFinishedAt, payload.durationMs);

  if (!existing) {
    insertTaskRunCommandStmt.run(
      safeTaskRunId,
      safeItemId,
      nextPosition,
      nextCommand,
      nextStatus,
      nextOutput,
      nextExitCode,
      nextStartedAt,
      nextFinishedAt,
      nextDurationMs,
      now
    );
    return getTaskRunCommandByItemStmt.get(safeTaskRunId, safeItemId) || null;
  }

  updateTaskRunCommandStmt.run(
    nextPosition,
    nextCommand,
    nextStatus,
    nextOutput,
    nextExitCode,
    nextStartedAt,
    nextFinishedAt,
    nextDurationMs,
    now,
    safeTaskRunId,
    safeItemId
  );
  return getTaskRunCommandByItemStmt.get(safeTaskRunId, safeItemId) || null;
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'upgrade-insecure-requests': null
      }
    }
  })
);

app.use(
  express.json({
    limit: maxJsonBodyBytes
  })
);
app.set('trust proxy', 1);
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  const pathName = String(req.path || '');
  if (!pathName.startsWith('/api/') && pathName !== '/health') {
    next();
    return;
  }
  const startedAtNs = process.hrtime.bigint();
  res.on('finish', () => {
    const endedAtNs = process.hrtime.bigint();
    const durationMs = Number(endedAtNs - startedAtNs) / 1e6;
    recordApiRequestMetric({
      method: req.method,
      path: resolveApiMetricPath(req),
      statusCode: res.statusCode,
      durationMs
    });
  });
  next();
});

app.use((req, res, next) => {
  const sensitiveRoutes = new Set(['/api/login', '/api/logout', '/api/uploads', '/api/chat', '/api/restart', '/health']);
  if (sensitiveRoutes.has(req.path)) {
    const username = truncateForNotify(req.session && req.session.username ? req.session.username : 'anon');
    void notify(`REQ START route=${req.path} method=${req.method} user=${username}`);
  }
  next();
});

app.get('/health', (_req, res) => {
  notifyMilestone('tests_ok', 'Tests OK');
  return res.status(200).json({ ok: true, service: 'codexweb' });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.get('/uploads/:conversationId/:storedName', requireAuth, (req, res) => {
  return serveManagedAttachmentFromParams(req, res, req.params.conversationId, req.params.storedName);
});

if (legacyUploadsRouteBasePath !== '/uploads') {
  app.get(`${legacyUploadsRouteBasePath}/:conversationId/:storedName`, requireAuth, (req, res) => {
    return serveManagedAttachmentFromParams(req, res, req.params.conversationId, req.params.storedName);
  });
}

// Backward compatibility for absolute-path links accidentally exposed in chat
// (e.g. "/root/CodexWeb/uploads/<conversationId>/<storedName>").
app.get(/^\/.*\/uploads\/([^/]+)\/([^/]+)$/, requireAuth, (req, res) => {
  const conversationId = req.params[0];
  const storedName = req.params[1];
  return serveManagedAttachmentFromParams(req, res, conversationId, storedName);
});

function buildConversationTitle(message) {
  const compact = String(message || '').replace(/\s+/g, ' ').trim();
  if (!compact) return 'Nuevo chat';
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function sanitizeConversationModel(rawValue) {
  if (typeof rawValue !== 'string') return '';
  return rawValue.trim();
}

function sanitizeReasoningEffort(rawValue, fallback = DEFAULT_REASONING_EFFORT) {
  const normalized =
    typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
  if (normalized && allowedReasoningEfforts.has(normalized)) {
    return normalized;
  }
  if (allowedReasoningEfforts.has(fallback)) {
    return fallback;
  }
  return DEFAULT_REASONING_EFFORT;
}

function normalizeUserNotificationSettings(rawValue) {
  const row = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const webhookUrl = sanitizeDiscordWebhookUrl(row.discord_webhook_url, '');
  return {
    discordWebhookUrl: webhookUrl,
    notifyOnFinish: Number(row.discord_notify_on_finish) === 1,
    includeResult: Number(row.discord_include_result) === 1
  };
}

function getUserNotificationSettings(userId) {
  const row = getUserNotificationSettingsStmt.get(userId);
  return normalizeUserNotificationSettings(row);
}

function parseBooleanSetting(rawValue, fallback) {
  if (typeof rawValue === 'boolean') return rawValue;
  if (rawValue === 1 || rawValue === '1') return true;
  if (rawValue === 0 || rawValue === '0') return false;
  return Boolean(fallback);
}

function maskSecretValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(Math.max(value.length, 4));
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 6))}${value.slice(-2)}`;
}

function normalizeSupportedAiAgentId(rawValue) {
  const safeAgentId = String(rawValue || '').trim();
  if (!safeAgentId || !supportedAiAgentsById.has(safeAgentId)) {
    return '';
  }
  return safeAgentId;
}

function buildAiAgentTutorial(agent) {
  const safeAgentId = normalizeSupportedAiAgentId(agent && agent.id);
  const byType = String(agent && agent.integrationType ? agent.integrationType : '').toLowerCase();
  const fallbackTutorial =
    byType === 'api_key'
      ? {
          title: `Integracion ${String((agent && agent.name) || 'agente')}`,
          steps: [
            'Consigue una API key del proveedor.',
            'Activa la integracion en CodexWeb.',
            'Pega la API key y guarda cambios.',
            'Verifica que el estado quede en "Listo".'
          ],
          notes: ['Si cambias la API key, vuelve a guardarla en este panel.']
        }
      : byType === 'oauth'
        ? {
            title: `Integracion ${String((agent && agent.name) || 'agente')}`,
            steps: [
              'Inicia sesion en el producto oficial del agente.',
              'Activa la integracion en CodexWeb.',
              'Guarda cambios en Settings.',
              'Selecciona este agente en el desplegable si sera el principal.'
            ],
            notes: ['En este panel no se solicita API key para este agente.']
          }
        : {
            title: `Integracion ${String((agent && agent.name) || 'agente')}`,
            steps: [
              'Instala o despliega el agente en tu entorno.',
              'Activa la integracion en CodexWeb.',
              'Configura endpoint o parametros requeridos.',
              'Guarda y valida conectividad.'
            ],
            notes: []
          };

  const candidate = safeAgentId ? aiAgentTutorialsById[safeAgentId] : null;
  const tutorial = candidate || fallbackTutorial;
  const steps = Array.isArray(tutorial.steps)
    ? tutorial.steps
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const notes = Array.isArray(tutorial.notes)
    ? tutorial.notes
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const title = String(tutorial.title || '').trim() || `Integracion ${String((agent && agent.name) || 'agente')}`;
  return {
    title,
    steps,
    notes
  };
}

function normalizeUserAgentIntegrationRow(rawValue) {
  const row = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const agentId = String(row.agent_id ?? row.agentId ?? '').trim();
  const apiKey = String(row.api_key ?? row.apiKey ?? '').trim();
  const baseUrl = sanitizeHttpUrl(row.base_url ?? row.baseUrl ?? '', '');
  const updatedAt = String(row.updated_at ?? row.updatedAt ?? '').trim();
  const enabled =
    typeof row.enabled === 'boolean' ? row.enabled : Number(row.enabled) === 1;
  return {
    agentId,
    enabled,
    apiKey,
    baseUrl,
    updatedAt
  };
}

function isCodexCliLinkedWithChatGptForUser(userId) {
  const details = getCodexAuthDetailsForUser(userId, '');
  if (!details || typeof details !== 'object') {
    return false;
  }
  const authMethod = String(details.authMethod || '').trim().toLowerCase();
  if (authMethod === 'chatgpt') {
    return true;
  }
  const authMode = String(details.authMode || '').trim().toLowerCase();
  if (authMode.includes('chatgpt')) {
    return true;
  }
  if (!details.hasRefreshToken) {
    return false;
  }
  return Boolean(
    String(details.email || '').trim() ||
      String(details.accountId || '').trim() ||
      String(details.subject || '').trim()
  );
}

function getAiAgentSerializationOptionsForUser(userId) {
  const codexLinked = isCodexCliLinkedWithChatGptForUser(userId);
  const forceEnabledAgentIds = new Set();
  if (codexLinked) {
    forceEnabledAgentIds.add('codex-cli');
  }
  return {
    forceEnabledAgentIds,
    codexLinked
  };
}

function serializeAiAgentIntegration(agent, integrationRow, options = {}) {
  const normalized = normalizeUserAgentIntegrationRow(integrationRow);
  const forceEnabled = Boolean(options && options.forceEnabled);
  const codexLinked = Boolean(options && options.codexLinked);
  const hasApiKey = Boolean(normalized.apiKey);
  const requiresApiKey = String(agent.integrationType || '') === 'api_key';
  const isCodexCli = String(agent && agent.id ? agent.id : '') === 'codex-cli';
  const configured = isCodexCli ? codexLinked : requiresApiKey ? hasApiKey : true;
  return {
    enabled: forceEnabled ? true : normalized.enabled,
    configured,
    hasApiKey,
    apiKeyMasked: hasApiKey ? maskSecretValue(normalized.apiKey) : '',
    baseUrl: normalized.baseUrl,
    updatedAt: normalized.updatedAt
  };
}

function serializeAiAgentSetting(agent, integrationRow, options = {}) {
  const forceEnabled =
    options &&
    options.forceEnabledAgentIds &&
    typeof options.forceEnabledAgentIds.has === 'function' &&
    options.forceEnabledAgentIds.has(agent.id);
  const codexLinked = Boolean(options && options.codexLinked);
  return {
    id: agent.id,
    name: agent.name,
    vendor: agent.vendor,
    description: agent.description,
    pricing: agent.pricing,
    isFree: agent.pricing === 'free',
    integrationType: agent.integrationType,
    docsUrl: agent.docsUrl,
    supportsBaseUrl: Boolean(agent.supportsBaseUrl),
    integration: serializeAiAgentIntegration(agent, integrationRow, { forceEnabled, codexLinked }),
    tutorial: buildAiAgentTutorial(agent)
  };
}

function serializeAiAgentSettingsForUser(userId, options = null) {
  const serializationOptions = options || getAiAgentSerializationOptionsForUser(userId);
  const rows = listUserAgentIntegrationsStmt.all(userId);
  const rowByAgentId = new Map();
  rows.forEach((entry) => {
    const normalized = normalizeUserAgentIntegrationRow(entry);
    if (!normalized.agentId) return;
    rowByAgentId.set(normalized.agentId, normalized);
  });
  return supportedAiAgents.map((agent) =>
    serializeAiAgentSetting(agent, rowByAgentId.get(agent.id) || null, serializationOptions)
  );
}

function getSerializedAiAgentSettingForUser(userId, agentId, options = null) {
  const serializationOptions = options || getAiAgentSerializationOptionsForUser(userId);
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (!safeAgentId) return null;
  const agent = supportedAiAgentsById.get(safeAgentId);
  if (!agent) return null;
  const existing = getUserAgentIntegrationStmt.get(userId, safeAgentId);
  return serializeAiAgentSetting(agent, existing, serializationOptions);
}

function isSerializedAiAgentSelectable(agent) {
  if (!agent || typeof agent !== 'object') return false;
  const integration = agent.integration && typeof agent.integration === 'object' ? agent.integration : null;
  return Boolean(integration && integration.enabled && integration.configured);
}

function getRawUserActiveAiAgentId(userId) {
  const row = getUserActiveAiAgentIdStmt.get(userId);
  return String((row && row.active_ai_agent_id) || '').trim();
}

function getUserActiveAiAgentId(userId) {
  return normalizeSupportedAiAgentId(getRawUserActiveAiAgentId(userId));
}

function setUserActiveAiAgentId(userId, agentId) {
  const normalized = normalizeSupportedAiAgentId(agentId);
  updateUserActiveAiAgentIdStmt.run(normalized || '', userId);
  return normalized || '';
}

function serializeAiAgentSettingsPayloadForUser(userId) {
  const serializationOptions = getAiAgentSerializationOptionsForUser(userId);
  const agents = serializeAiAgentSettingsForUser(userId, serializationOptions);
  const selectableIds = new Set(
    agents.filter((agent) => isSerializedAiAgentSelectable(agent)).map((agent) => agent.id)
  );
  const storedRaw = getRawUserActiveAiAgentId(userId);
  const storedActive = normalizeSupportedAiAgentId(storedRaw);
  const activeAgentId =
    storedActive && selectableIds.has(storedActive)
      ? storedActive
      : '';
  if (storedRaw !== activeAgentId) {
    updateUserActiveAiAgentIdStmt.run(activeAgentId, userId);
  }
  return {
    agents,
    activeAgentId
  };
}

function getChatAgentModelOptions(agentId) {
  const safeAgentId = String(agentId || '').trim();
  if (safeAgentId === 'gemini-cli') {
    return [...geminiModelOptions];
  }
  const cachedModels = loadCodexModelsFromCache();
  return [...chatGptModelOptions, ...cachedModels].filter(
    (slug, index, list) => list.indexOf(slug) === index
  );
}

function getChatAgentDefaultModel(agentId) {
  const safeAgentId = String(agentId || '').trim();
  if (safeAgentId === 'gemini-cli') {
    return DEFAULT_GEMINI_CHAT_MODEL;
  }
  return DEFAULT_CHAT_MODEL;
}

function normalizeChatAgentModel(agentId, rawModel) {
  const fallbackModel = getChatAgentDefaultModel(agentId);
  const normalized = sanitizeConversationModel(rawModel);
  if (!normalized) return fallbackModel;
  if (agentId === 'gemini-cli') {
    if (normalized.startsWith('gemini-')) {
      return normalized;
    }
    return fallbackModel;
  }
  return normalized;
}

function resolveChatAgentRuntimeForUser(userId) {
  const payload = serializeAiAgentSettingsPayloadForUser(userId);
  const requestedAgentId = normalizeSupportedAiAgentId(payload.activeAgentId);
  let effectiveAgentId = requestedAgentId;
  if (!effectiveAgentId || !supportedChatRuntimeAgentIds.has(effectiveAgentId)) {
    effectiveAgentId = 'codex-cli';
  }
  const selectedEntry =
    payload.agents.find((entry) => entry.id === requestedAgentId) || null;
  const selectedIsSelectable = isSerializedAiAgentSelectable(selectedEntry);
  if (!selectedIsSelectable && effectiveAgentId !== 'codex-cli') {
    effectiveAgentId = 'codex-cli';
  }
  const effectiveAgent = supportedAiAgentsById.get(effectiveAgentId);
  const models = getChatAgentModelOptions(effectiveAgentId);
  const defaultModel = getChatAgentDefaultModel(effectiveAgentId);
  return {
    requestedAgentId,
    activeAgentId: effectiveAgentId,
    activeAgentName:
      String((effectiveAgent && effectiveAgent.name) || '').trim() || effectiveAgentId || 'Codex CLI',
    runtimeProvider: effectiveAgentId === 'gemini-cli' ? 'gemini' : 'codex',
    models,
    reasoningEfforts: [...chatReasoningEffortOptions],
    defaults: {
      model: defaultModel,
      reasoningEffort: DEFAULT_REASONING_EFFORT
    }
  };
}

function getGeminiUserIntegrationForUser(userId) {
  const row = getUserAgentIntegrationStmt.get(userId, 'gemini-cli');
  return normalizeUserAgentIntegrationRow(row);
}

function buildGeminiPromptWithReasoning(prompt, reasoningEffort) {
  const normalizedReasoning = sanitizeReasoningEffort(reasoningEffort, DEFAULT_REASONING_EFFORT);
  const guidance =
    geminiReasoningInstructionsByEffort[normalizedReasoning] ||
    geminiReasoningInstructionsByEffort[DEFAULT_REASONING_EFFORT];
  return [
    'Modo agente operativo (root): puedes leer/escribir archivos y ejecutar comandos del sistema.',
    'Si el usuario pide estado de procesos/servicios/puertos/sistema, verifica con comandos reales antes de responder.',
    'No digas que no tienes acceso al sistema salvo que un comando falle; en ese caso reporta el comando y el error.',
    `Instruccion de razonamiento (${normalizedReasoning}): ${guidance}`,
    '',
    String(prompt || '').trim()
  ]
    .filter(Boolean)
    .join('\n');
}

function getOwnedConversationOrNull(conversationId, userId) {
  const conversation = getConversationStmt.get(conversationId);
  if (!conversation || conversation.user_id !== userId) {
    return null;
  }
  return conversation;
}

function isAdmin(req) {
  const username = String((req.session && req.session.username) || '')
    .trim()
    .toLowerCase();
  return Boolean(username) && adminUsers.has(username);
}

function canManageConversation(req, conversation) {
  if (!conversation) return false;
  const isOwner = Number(conversation.user_id) === Number(req.session.userId);
  return isOwner || isAdmin(req);
}

function parseAttachmentId(rawId) {
  const decoded = String(rawId || '').trim();
  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;
  const conversationId = Number(decoded.slice(0, separator));
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  const storedName = sanitizeFilename(decoded.slice(separator + 1));
  if (!storedName) return null;
  return { conversationId, storedName };
}

function resolveManagedAttachmentFileForRequest(req, conversationIdValue, storedNameValue) {
  const conversationId = Number(conversationIdValue);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return { errorStatus: 400, error: 'conversation_id inválido' };
  }

  const conversation = getConversationStmt.get(conversationId);
  if (!conversation) {
    return { errorStatus: 404, error: 'Conversación no encontrada' };
  }
  if (!canManageConversation(req, conversation)) {
    return { errorStatus: 403, error: 'No autorizado para abrir este adjunto' };
  }

  const storedName = sanitizeFilename(storedNameValue || '');
  if (!storedName) {
    return { errorStatus: 400, error: 'attachment_id inválido' };
  }

  const conversationDir = path.join(uploadsDir, String(conversationId));
  const filePath = path.join(conversationDir, storedName);
  const relativeFromConversationDir = path.relative(conversationDir, filePath);
  if (
    relativeFromConversationDir.startsWith('..') ||
    path.isAbsolute(relativeFromConversationDir)
  ) {
    return { errorStatus: 400, error: 'attachment_id inválido' };
  }
  if (!fs.existsSync(filePath)) {
    return { errorStatus: 404, error: 'Adjunto no encontrado' };
  }

  return {
    conversationId,
    storedName,
    filePath
  };
}

function serveManagedAttachmentFromParams(req, res, conversationIdValue, storedNameValue) {
  const resolved = resolveManagedAttachmentFileForRequest(req, conversationIdValue, storedNameValue);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.error });
  }
  res.type(inferMimeTypeFromFilename(resolved.storedName));
  return res.sendFile(resolved.filePath);
}

function removePendingUploadsForConversation(conversationId) {
  for (const [uploadId, upload] of pendingUploads.entries()) {
    if (!upload || upload.conversationId !== conversationId) continue;
    try {
      if (upload.path && fs.existsSync(upload.path)) {
        fs.unlinkSync(upload.path);
      }
    } catch (_error) {
      // best-effort cleanup
    }
    pendingUploads.delete(uploadId);
  }
}

function inferMimeTypeFromFilename(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const byExt = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.cjs': 'text/javascript',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.jsx': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.xml': 'application/xml',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.7z': 'application/x-7z-compressed',
    '.rar': 'application/vnd.rar',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
  };
  return byExt[ext] || 'application/octet-stream';
}

function listAttachmentsForUser(userId, maxItems) {
  const safeMax = Number.isInteger(maxItems) ? maxItems : 120;
  const limit = Math.max(1, Math.min(safeMax, 400));
  const conversations = listOwnedConversationIdsStmt.all(userId);
  const conversationTitles = new Map(
    conversations
      .filter((row) => Number.isInteger(Number(row && row.id)))
      .map((row) => [Number(row.id), String((row && row.title) || 'Chat')])
  );
  const attachments = [];

  conversations.forEach((conversation) => {
    const conversationId = Number(conversation && conversation.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) return;
    const conversationDir = path.join(uploadsDir, String(conversationId));
    if (!fs.existsSync(conversationDir)) return;

    let entries = [];
    try {
      entries = fs.readdirSync(conversationDir, { withFileTypes: true });
    } catch (_error) {
      entries = [];
    }

    entries.forEach((entry) => {
      if (!entry || !entry.isFile()) return;
      const absolutePath = path.join(conversationDir, entry.name);
      let stats = null;
      try {
        stats = fs.statSync(absolutePath);
      } catch (_error) {
        stats = null;
      }
      if (!stats || !stats.isFile()) return;

      const uploadedAt = stats.mtime && Number.isFinite(stats.mtime.getTime()) ? stats.mtime.toISOString() : '';
      attachments.push({
        id: `${conversationId}:${entry.name}`,
        conversationId,
        conversationTitle: conversationTitles.get(conversationId) || 'Chat',
        name: entry.name,
        size: Number.isFinite(stats.size) ? stats.size : 0,
        mimeType: inferMimeTypeFromFilename(entry.name),
        uploadedAt
      });
    });
  });

  attachments.sort((a, b) => {
    const timeA = Date.parse(a.uploadedAt || '');
    const timeB = Date.parse(b.uploadedAt || '');
    if (Number.isFinite(timeA) && Number.isFinite(timeB)) {
      return timeB - timeA;
    }
    if (Number.isFinite(timeA)) return -1;
    if (Number.isFinite(timeB)) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return attachments.slice(0, limit);
}

function loadCodexModelsFromCache() {
  try {
    const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
    if (!fs.existsSync(cachePath)) return [];
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    const models = Array.isArray(parsed && parsed.models) ? parsed.models : [];

    return models
      .map((model) => String((model && model.slug) || '').trim())
      .filter(Boolean)
      .filter((slug, index, list) => list.indexOf(slug) === index)
      .slice(0, 30);
  } catch (_error) {
    return [];
  }
}

app.post('/api/register', async (req, res) => {
  const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
  const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
  const username = rawUsername.trim();
  const password = rawPassword;
  const safeUsername = truncateForNotify(username || rawUsername);

  if (!username || !password) {
    void notify(`REGISTER failed username=${safeUsername} reason=missing_fields`);
    return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });
  }
  if (username.length < 3 || username.length > 48) {
    void notify(`REGISTER failed username=${safeUsername} reason=invalid_username_length`);
    return res.status(400).json({ error: 'El usuario debe tener entre 3 y 48 caracteres' });
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    void notify(`REGISTER failed username=${safeUsername} reason=invalid_username_chars`);
    return res.status(400).json({ error: 'Usuario inválido (usa letras, números, punto, guion o guion bajo)' });
  }
  if (password.length < 8) {
    void notify(`REGISTER failed username=${safeUsername} reason=weak_password`);
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  try {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      void notify(`REGISTER failed username=${safeUsername} reason=already_exists`);
      return res.status(409).json({ error: 'Ese usuario ya existe' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const created = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
    const userId = Number(created.lastInsertRowid);
    req.session.userId = userId;
    req.session.username = username;
    void notify(`REGISTER ok username=${safeUsername}`);
    return res.status(201).json({ ok: true, username });
  } catch (error) {
    const reason = truncateForNotify(error && error.message ? error.message : 'register_error', 180);
    void notify(`REGISTER failed username=${safeUsername} reason=${reason}`);
    return res.status(500).json({ error: 'No se pudo crear la cuenta' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const requestedUsername = truncateForNotify(username);
  if (!username || !password) {
    void notify(`LOGIN failed username=${requestedUsername} reason=missing_fields`);
    return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username.trim());
  if (!user) {
    void notify(`LOGIN failed username=${requestedUsername} reason=invalid_credentials`);
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    void notify(`LOGIN failed username=${requestedUsername} reason=invalid_credentials`);
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  void notify(`LOGIN ok username=${truncateForNotify(user.username)}`);
  return res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  const username = truncateForNotify(req.session && req.session.username ? req.session.username : 'anon');
  req.session.destroy(() => {
    void notify(`LOGOUT ok username=${username}`);
    res.json({ ok: true });
  });
});

app.get('/api/restart/status', (_req, res) => {
  return res.json({
    ok: true,
    restart: getRestartStatusPayload(),
    pid: process.pid
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false, user: null });
  }
  return res.json({
    authenticated: true,
    user: {
      id: req.session.userId,
      username: req.session.username
    }
  });
});

app.get('/api/settings/notifications', requireAuth, (req, res) => {
  const notifications = getUserNotificationSettings(req.session.userId);
  return res.json({
    ok: true,
    notifications
  });
});

app.patch('/api/settings/notifications', requireAuth, (req, res) => {
  const currentSettings = getUserNotificationSettings(req.session.userId);
  const webhookWasProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'discordWebhookUrl');
  const notifyWasProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'notifyOnFinish');
  const includeWasProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'includeResult');

  const rawWebhookUrl = webhookWasProvided ? req.body.discordWebhookUrl : currentSettings.discordWebhookUrl;
  if (webhookWasProvided && typeof rawWebhookUrl !== 'string') {
    return res.status(400).json({ error: 'Webhook de Discord inválido' });
  }
  const normalizedWebhook = sanitizeDiscordWebhookUrl(rawWebhookUrl, '');
  if (webhookWasProvided && String(rawWebhookUrl || '').trim() && !normalizedWebhook) {
    return res.status(400).json({ error: 'Webhook de Discord inválido' });
  }

  let notifyOnFinish = currentSettings.notifyOnFinish;
  if (notifyWasProvided) {
    const rawNotify = req.body.notifyOnFinish;
    const rawType = typeof rawNotify;
    if (
      !(
        rawType === 'boolean' ||
        rawNotify === 0 ||
        rawNotify === 1 ||
        rawNotify === '0' ||
        rawNotify === '1'
      )
    ) {
      return res.status(400).json({ error: 'Valor inválido para notifyOnFinish' });
    }
    notifyOnFinish = parseBooleanSetting(rawNotify, currentSettings.notifyOnFinish);
  }

  let includeResult = currentSettings.includeResult;
  if (includeWasProvided) {
    const rawInclude = req.body.includeResult;
    const rawType = typeof rawInclude;
    if (
      !(
        rawType === 'boolean' ||
        rawInclude === 0 ||
        rawInclude === 1 ||
        rawInclude === '0' ||
        rawInclude === '1'
      )
    ) {
      return res.status(400).json({ error: 'Valor inválido para includeResult' });
    }
    includeResult = parseBooleanSetting(rawInclude, currentSettings.includeResult);
  }

  if (notifyOnFinish && !sanitizeDiscordWebhookUrl(normalizedWebhook, defaultWebhookUrl)) {
    return res.status(400).json({ error: 'Configura un webhook de Discord antes de habilitar notificaciones' });
  }

  updateUserNotificationSettingsStmt.run(
    normalizedWebhook,
    notifyOnFinish ? 1 : 0,
    includeResult ? 1 : 0,
    req.session.userId
  );
  const notifications = getUserNotificationSettings(req.session.userId);
  return res.json({
    ok: true,
    notifications
  });
});

app.get('/api/settings/ai-agents', requireAuth, (req, res) => {
  const payload = serializeAiAgentSettingsPayloadForUser(req.session.userId);
  return res.json({
    ok: true,
    fetchedAt: nowIso(),
    agents: payload.agents,
    activeAgentId: payload.activeAgentId
  });
});

app.patch('/api/settings/ai-agents/active', requireAuth, (req, res) => {
  const wasProvided = req.body && Object.prototype.hasOwnProperty.call(req.body, 'agentId');
  if (!wasProvided) {
    return res.status(400).json({ error: 'Falta agentId' });
  }
  if (typeof req.body.agentId !== 'string') {
    return res.status(400).json({ error: 'agentId invalido' });
  }
  const requestedRaw = String(req.body.agentId || '').trim();
  const requestedAgentId = normalizeSupportedAiAgentId(requestedRaw);
  if (requestedRaw && !requestedAgentId) {
    return res.status(404).json({ error: 'Agente no soportado' });
  }
  if (!requestedAgentId) {
    setUserActiveAiAgentId(req.session.userId, '');
    return res.json({
      ok: true,
      activeAgentId: ''
    });
  }
  const payload = serializeAiAgentSettingsPayloadForUser(req.session.userId);
  const selectedAgent = payload.agents.find((entry) => entry.id === requestedAgentId) || null;
  if (!isSerializedAiAgentSelectable(selectedAgent)) {
    return res.status(400).json({
      error: 'Solo puedes seleccionar agentes activados y configurados'
    });
  }
  setUserActiveAiAgentId(req.session.userId, requestedAgentId);
  return res.json({
    ok: true,
    activeAgentId: requestedAgentId
  });
});

app.patch('/api/settings/ai-agents/:agentId', requireAuth, (req, res) => {
  const safeAgentId = normalizeSupportedAiAgentId((req.params && req.params.agentId) || '');
  if (!safeAgentId) {
    return res.status(404).json({ error: 'Agente no soportado' });
  }

  const agent = supportedAiAgentsById.get(safeAgentId);
  const current = normalizeUserAgentIntegrationRow(
    getUserAgentIntegrationStmt.get(req.session.userId, safeAgentId)
  );
  const enabledWasProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'enabled');
  const apiKeyWasProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'apiKey');
  const baseUrlWasProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'baseUrl');

  if (!enabledWasProvided && !apiKeyWasProvided && !baseUrlWasProvided) {
    return res.status(400).json({ error: 'No se recibieron cambios para guardar' });
  }

  let nextEnabled = current.enabled;
  if (enabledWasProvided) {
    const rawEnabled = req.body.enabled;
    const rawType = typeof rawEnabled;
    if (
      !(
        rawType === 'boolean' ||
        rawEnabled === 0 ||
        rawEnabled === 1 ||
        rawEnabled === '0' ||
        rawEnabled === '1'
      )
    ) {
      return res.status(400).json({ error: 'Valor invalido para enabled' });
    }
    nextEnabled = parseBooleanSetting(rawEnabled, current.enabled);
  }

  let nextApiKey = current.apiKey;
  if (apiKeyWasProvided) {
    if (String(agent.integrationType || '') !== 'api_key') {
      return res.status(400).json({ error: 'Este agente no usa API key en esta integracion' });
    }
    if (typeof req.body.apiKey !== 'string') {
      return res.status(400).json({ error: 'API key invalida' });
    }
    const normalizedApiKey = String(req.body.apiKey || '').trim();
    if (normalizedApiKey.length > 4000) {
      return res.status(400).json({ error: 'API key demasiado larga' });
    }
    nextApiKey = normalizedApiKey;
  }

  let nextBaseUrl = current.baseUrl;
  if (baseUrlWasProvided) {
    if (!agent.supportsBaseUrl) {
      return res.status(400).json({ error: 'Este agente no permite base URL personalizada' });
    }
    if (typeof req.body.baseUrl !== 'string') {
      return res.status(400).json({ error: 'Base URL invalida' });
    }
    const requestedBaseUrl = String(req.body.baseUrl || '').trim();
    const normalizedBaseUrl = sanitizeHttpUrl(requestedBaseUrl, '');
    if (requestedBaseUrl && !normalizedBaseUrl) {
      return res.status(400).json({ error: 'Base URL invalida' });
    }
    nextBaseUrl = normalizedBaseUrl;
  }

  if (!nextEnabled && !nextApiKey && !nextBaseUrl) {
    deleteUserAgentIntegrationStmt.run(req.session.userId, safeAgentId);
  } else {
    upsertUserAgentIntegrationStmt.run(
      req.session.userId,
      safeAgentId,
      nextEnabled ? 1 : 0,
      nextApiKey,
      nextBaseUrl,
      nowIso()
    );
  }

  const payload = serializeAiAgentSettingsPayloadForUser(req.session.userId);
  const serialized =
    payload.agents.find((entry) => entry.id === safeAgentId) ||
    getSerializedAiAgentSettingForUser(req.session.userId, safeAgentId);
  return res.json({
    ok: true,
    agent: serialized,
    activeAgentId: payload.activeAgentId
  });
});

app.post('/api/restart', requireAuth, (req, res) => {
  if (restartScheduled) {
    return res.status(409).json({ error: 'Ya hay un reinicio en progreso' });
  }

  const username = truncateForNotify(req.session && req.session.username ? req.session.username : 'anon');
  const userNotificationSettings = getUserNotificationSettings(req.session.userId);
  const restartWebhookUrl = sanitizeDiscordWebhookUrl(
    userNotificationSettings.discordWebhookUrl,
    defaultWebhookUrl
  );
  const attempt = beginRestartAttempt(username, { webhookUrl: restartWebhookUrl });
  try {
    restartScheduled = true;
    setRestartPhase('scheduling');
    pushRestartLog('Preparando helper de reinicio');
    scheduleApplicationRestart(attempt.attemptId);
    pushRestartLog('Helper de reinicio lanzado');
    setRestartPhase('waiting_shutdown');
    const restartMessage = buildRestartDiscordMessage({
      status: 'requested',
      username,
      attemptId: attempt.attemptId,
      startedAt: attempt.startedAt,
      phase: 'waiting_shutdown'
    });
    if (restartMessage) {
      void notify(restartMessage, { webhookUrl: restartWebhookUrl });
    }

    res.on('finish', () => {
      pushRestartLog('Respuesta enviada. Cerrando proceso actual');
      setRestartPhase('shutting_down');
      setTimeout(() => {
        process.exit(0);
      }, 120);
    });
    return res.json({ ok: true, restarting: true, attemptId: attempt.attemptId });
  } catch (error) {
    restartScheduled = false;
    const reason = truncateForNotify(error && error.message ? error.message : 'restart_error', 200);
    finishRestartAttempt('failed', `Error preparando reinicio: ${reason}`);
    const failedMessage = buildRestartDiscordMessage({
      status: 'failed',
      username,
      attemptId: attempt.attemptId,
      finishedAt: nowIso(),
      phase: 'failed',
      reason
    });
    if (failedMessage) {
      void notify(failedMessage, { webhookUrl: restartWebhookUrl });
    }
    return res.status(500).json({ error: 'No se pudo reiniciar CodexWeb' });
  }
});

app.get('/api/conversations', requireAuth, (req, res) => {
  const conversations = listConversationsStmt.all(req.session.userId);
  return res.json({
    ok: true,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      model: conversation.model || '',
      reasoningEffort: sanitizeReasoningEffort(conversation.reasoning_effort, DEFAULT_REASONING_EFFORT),
      created_at: conversation.created_at,
      last_message_at: conversation.last_message_at || conversation.created_at,
      liveDraftOpen:
        Number(conversation.live_draft_open) > 0 &&
        hasActiveChatRun(req.session.userId, conversation.id),
      liveDraftUpdatedAt: conversation.live_draft_updated_at || ''
    }))
  });
});

app.post('/api/conversations', requireAuth, (req, res) => {
  const rawTitle = req.body && typeof req.body.title === 'string' ? req.body.title : '';
  const title = buildConversationTitle(rawTitle);
  const selectedModel = sanitizeConversationModel(req.body && req.body.model);
  const selectedReasoningEffort = sanitizeReasoningEffort(
    req.body && req.body.reasoningEffort,
    DEFAULT_REASONING_EFFORT
  );
  const result = createConversationStmt.run(req.session.userId, title, selectedModel, selectedReasoningEffort);
  return res.json({
    ok: true,
    conversation: {
      id: result.lastInsertRowid,
      title,
      model: selectedModel,
      reasoningEffort: selectedReasoningEffort
    }
  });
});

app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'conversation_id inválido' });
  }
  const conversation = getOwnedConversationOrNull(conversationId, req.session.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversación no encontrada' });
  }

  const maxMessagesPageSize = 200;
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const hasLimitParam = String(req.query.limit || '').trim() !== '';
  const safeLimit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxMessagesPageSize) : null;
  if (hasLimitParam && safeLimit === null) {
    return res.status(400).json({ error: 'limit inválido' });
  }

  const rawBeforeIdValue = req.query.beforeId ?? req.query.before_id ?? req.query.before;
  const rawBeforeId = Number.parseInt(String(rawBeforeIdValue || ''), 10);
  const hasBeforeIdParam = String(rawBeforeIdValue || '').trim() !== '';
  const safeBeforeId =
    Number.isInteger(rawBeforeId) && rawBeforeId > 0 ? rawBeforeId : null;
  if (hasBeforeIdParam && safeBeforeId === null) {
    return res.status(400).json({ error: 'beforeId inválido' });
  }
  if (safeBeforeId !== null && safeLimit === null) {
    return res.status(400).json({ error: 'beforeId requiere limit' });
  }

  const includeMetaRaw = String(req.query.includeMeta || '').trim().toLowerCase();
  const includeMeta =
    includeMetaRaw === '' ||
    (includeMetaRaw !== '0' && includeMetaRaw !== 'false' && includeMetaRaw !== 'no');

  let messageRows = [];
  let hasMoreMessages = false;
  if (safeLimit !== null) {
    const pageFetchSize = safeLimit + 1;
    const rowsDesc =
      safeBeforeId !== null
        ? listMessagesBeforeIdPageDescStmt.all(conversationId, safeBeforeId, pageFetchSize)
        : listMessagesPageDescStmt.all(conversationId, pageFetchSize);
    hasMoreMessages = rowsDesc.length > safeLimit;
    const limitedRows = hasMoreMessages ? rowsDesc.slice(0, safeLimit) : rowsDesc;
    messageRows = limitedRows.reverse();
  } else {
    messageRows = listMessagesStmt.all(conversationId);
  }

  const messageIds = messageRows
    .map((row) => Number(row && row.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const messageIdSet = new Set(messageIds);
  let minMessageId = null;
  let maxMessageId = null;
  messageIds.forEach((id) => {
    if (!Number.isInteger(id) || id <= 0) return;
    if (minMessageId === null || id < minMessageId) {
      minMessageId = id;
    }
    if (maxMessageId === null || id > maxMessageId) {
      maxMessageId = id;
    }
  });
  const attachmentRows =
    minMessageId !== null && maxMessageId !== null
      ? listMessageAttachmentsByConversationRangeStmt.all(conversationId, minMessageId, maxMessageId)
      : [];
  const attachmentsByMessageId = new Map();
  attachmentRows.forEach((row) => {
    const messageId = Number(row && row.message_id);
    if (!Number.isInteger(messageId) || messageId <= 0) return;
    if (!messageIdSet.has(messageId)) return;
    const storedName = sanitizeFilename((row && row.stored_name) || '');
    if (!storedName) return;
    const filePath = path.join(uploadsDir, String(conversationId), storedName);
    if (!fs.existsSync(filePath)) return;
    if (!attachmentsByMessageId.has(messageId)) {
      attachmentsByMessageId.set(messageId, []);
    }
    attachmentsByMessageId.get(messageId).push({
      id: `${conversationId}:${storedName}`,
      conversationId,
      name: String((row && row.display_name) || storedName),
      mimeType: String((row && row.mime_type) || inferMimeTypeFromFilename(storedName)),
      size: Math.max(0, Number(row && row.size_bytes) || 0),
      uploadedAt: String((row && row.created_at) || '')
    });
  });
  const messages = messageRows.map((message) => {
    const messageId = Number(message && message.id);
    const attachments =
      Number.isInteger(messageId) && messageId > 0 && attachmentsByMessageId.has(messageId)
        ? attachmentsByMessageId.get(messageId)
        : [];
    return {
      ...message,
      attachments
    };
  });
  const oldestLoadedId = messageIds.length > 0 ? messageIds[0] : null;
  const newestLoadedId = messageIds.length > 0 ? messageIds[messageIds.length - 1] : null;
  const responseLimit = safeLimit !== null ? safeLimit : messageIds.length;
  const pagination = {
    limit: responseLimit,
    hasMore: safeLimit !== null ? hasMoreMessages : false,
    nextBeforeId: safeLimit !== null && hasMoreMessages ? oldestLoadedId : null,
    oldestLoadedId,
    newestLoadedId
  };

  let liveDraft = null;
  let parsedReasoning = {};
  let taskRecovery = null;
  if (includeMeta) {
    const runIsActive = hasActiveChatRun(req.session.userId, conversationId);
    if (!runIsActive) {
      closeOpenDraftsByConversationStmt.run(nowIso(), req.session.userId, conversationId);
    }
    liveDraft = runIsActive
      ? getOpenLiveDraftForConversationStmt.get(req.session.userId, conversationId)
      : null;
    if (liveDraft && liveDraft.reasoning_json) {
      try {
        const decoded = JSON.parse(liveDraft.reasoning_json);
        if (decoded && typeof decoded === 'object') {
          parsedReasoning = decoded;
        }
      } catch (_error) {
        parsedReasoning = {};
      }
    }
    const latestTaskRun = getLatestTaskRunForConversationStmt.get(req.session.userId, conversationId) || null;
    const latestTaskCommands =
      latestTaskRun && Number.isInteger(Number(latestTaskRun.id))
        ? listTaskRunCommandsStmt.all(Number(latestTaskRun.id), 220)
        : [];
    taskRecovery = latestTaskRun
      ? serializeTaskRecovery(latestTaskRun, latestTaskCommands, serializeReasoningMapToText(parsedReasoning))
      : null;
  }
  return res.json({
    ok: true,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      model: conversation.model || '',
      reasoningEffort: sanitizeReasoningEffort(conversation.reasoning_effort, DEFAULT_REASONING_EFFORT)
    },
    messages,
    pagination,
    liveDraft: liveDraft
      ? {
          requestId: liveDraft.request_id || '',
          conversationId: Number.isInteger(liveDraft.conversation_id) ? liveDraft.conversation_id : conversationId,
          messageId: Number.isInteger(liveDraft.assistant_message_id) ? liveDraft.assistant_message_id : 0,
          userMessage: {
            id: 0,
            role: 'user',
            content: String(liveDraft.user_message_content || ''),
            created_at: liveDraft.created_at || nowIso()
          },
          assistantMessage: {
            id: Number.isInteger(liveDraft.assistant_message_id) ? liveDraft.assistant_message_id : 0,
            role: 'assistant',
            content: String(liveDraft.assistant_content || ''),
            created_at: liveDraft.created_at || nowIso()
          },
          reasoningByItem: parsedReasoning,
          completed: false,
          updatedAt: liveDraft.updated_at || nowIso()
        }
      : null,
    taskRecovery
  });
});

app.patch('/api/conversations/:id/title', requireAuth, (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'conversation_id inválido' });
  }

  const conversation = getOwnedConversationOrNull(conversationId, req.session.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversación no encontrada' });
  }

  if (!req.body || typeof req.body.title !== 'string') {
    return res.status(400).json({ error: 'Título inválido' });
  }

  const nextTitle = buildConversationTitle(req.body.title);
  renameConversationTitleStmt.run(nextTitle, conversationId);

  return res.json({
    ok: true,
    conversation: {
      id: conversationId,
      title: nextTitle
    }
  });
});

app.patch('/api/conversations/:id/settings', requireAuth, (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'conversation_id inválido' });
  }

  const conversation = getOwnedConversationOrNull(conversationId, req.session.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversación no encontrada' });
  }

  const modelWasProvided = req.body && Object.prototype.hasOwnProperty.call(req.body, 'model');
  const reasoningWasProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'reasoningEffort');

  const selectedModel = modelWasProvided
    ? sanitizeConversationModel(req.body && req.body.model)
    : String(conversation.model || '');
  const requestedReasoningRaw =
    reasoningWasProvided && req.body ? req.body.reasoningEffort : conversation.reasoning_effort;
  if (
    reasoningWasProvided &&
    typeof requestedReasoningRaw === 'string' &&
    requestedReasoningRaw.trim() &&
    !allowedReasoningEfforts.has(requestedReasoningRaw.trim().toLowerCase())
  ) {
    return res.status(400).json({ error: 'Nivel de razonamiento inválido' });
  }
  const normalizedReasoning = sanitizeReasoningEffort(
    requestedReasoningRaw,
    sanitizeReasoningEffort(conversation.reasoning_effort, DEFAULT_REASONING_EFFORT)
  );

  updateConversationSettingsStmt.run(selectedModel, normalizedReasoning, conversationId);

  return res.json({
    ok: true,
    conversation: {
      id: conversationId,
      model: selectedModel,
      reasoningEffort: normalizedReasoning
    }
  });
});

app.post('/api/conversations/:id/kill', requireAuth, (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'conversation_id inválido' });
  }

  const conversation = getOwnedConversationOrNull(conversationId, req.session.userId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversación no encontrada' });
  }

  const activeRunKey = buildActiveChatRunKey(req.session.userId, conversationId);
  const activeRun = activeChatRuns.get(activeRunKey);
  if (!activeRun || !activeRun.process) {
    return res.json({ ok: true, killed: false, reason: 'no_active_run' });
  }

  if (activeRun.process.exitCode !== null || activeRun.process.killed) {
    clearActiveChatRun(activeRun);
    return res.json({ ok: true, killed: false, reason: 'already_finished' });
  }

  const wasTerminated = terminateActiveChatRun(activeRun, 'killed_by_user');
  const username = truncateForNotify(req.session && req.session.username ? req.session.username : 'anon');
  void notify(
    `Chat kill request user=${username} conv=${conversationId} accepted=${wasTerminated ? 'yes' : 'no'}`
  );

  return res.json({
    ok: true,
    killed: wasTerminated,
    reason: wasTerminated ? 'terminated' : 'not_running'
  });
});

app.delete('/api/conversations/:id', requireAuth, (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'conversation_id inválido' });
  }

  const conversation = getConversationStmt.get(conversationId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversación no encontrada' });
  }
  if (!canManageConversation(req, conversation)) {
    return res.status(403).json({ error: 'No autorizado para eliminar esta conversación' });
  }

  deleteConversationStmt.run(conversationId);
  removePendingUploadsForConversation(conversationId);

  const conversationDir = path.join(uploadsDir, String(conversationId));
  try {
    if (fs.existsSync(conversationDir)) {
      fs.rmSync(conversationDir, { recursive: true, force: true });
    }
  } catch (_error) {
    // best-effort cleanup
  }

  return res.json({ ok: true, deleted: { conversationId } });
});

app.get('/api/chat/options', requireAuth, (req, res) => {
  const runtime = resolveChatAgentRuntimeForUser(req.session.userId);
  return res.json({
    ok: true,
    activeAgentId: runtime.activeAgentId,
    activeAgentName: runtime.activeAgentName,
    runtimeProvider: runtime.runtimeProvider,
    models: runtime.models,
    reasoningEfforts: runtime.reasoningEfforts,
    defaults: runtime.defaults
  });
});

app.get('/api/codex/quota', requireAuth, (req, res) => {
  const quota = getCodexQuotaSnapshotForUser(req.session.userId);
  return res.json({
    ok: true,
    quota
  });
});

app.get('/api/codex/runs', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }

  const runs = Array.from(activeChatRuns.values())
    .filter((run) => run && Number(run.userId) === safeUserId)
    .filter((run) => run.process && run.process.exitCode === null && !run.process.killed)
    .map((run) => {
      const conversation = getOwnedConversationOrNull(run.conversationId, safeUserId);
      const parsedStart = Number(run.startedAtMs);
      const startedAt = Number.isFinite(parsedStart) ? new Date(parsedStart).toISOString() : nowIso();
      const pid = Number(run.process && run.process.pid);
      return {
        conversationId: Number(run.conversationId),
        title: conversation ? String(conversation.title || 'Chat') : `Chat ${run.conversationId}`,
        startedAt,
        pid: Number.isInteger(pid) && pid > 0 ? pid : null,
        status: run.killRequested ? 'stopping' : 'running',
        killRequested: Boolean(run.killRequested)
      };
    })
    .sort((a, b) => Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''));

  return res.json({
    ok: true,
    runs
  });
});

app.post('/api/codex/runs/kill-all', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }

  const activeRuns = Array.from(activeChatRuns.values()).filter((run) => {
    return (
      run &&
      Number(run.userId) === safeUserId &&
      run.process &&
      run.process.exitCode === null &&
      !run.process.killed
    );
  });

  let stopped = 0;
  activeRuns.forEach((run) => {
    if (terminateActiveChatRun(run, 'killed_by_user_bulk')) {
      stopped += 1;
    }
  });

  const username = truncateForNotify(req.session && req.session.username ? req.session.username : 'anon');
  void notify(`Chat kill-all request user=${username} active=${activeRuns.length} stopped=${stopped}`);

  return res.json({
    ok: true,
    active: activeRuns.length,
    stopped
  });
});

app.get('/api/tasks', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const safeLimit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), taskDashboardLimitMax)
    : 30;
  const rows = listTaskRunsForUserStmt.all(safeUserId, safeLimit);
  return res.json({
    ok: true,
    tasks: rows.map((row) => serializeTaskRow(row))
  });
});

app.get('/api/tools/search', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const query = normalizeToolsSearchQuery(req.query.q);
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const safeLimit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), toolsSearchLimitMax)
    : 12;

  if (!query || query.length < toolsSearchMinQueryLen) {
    return res.json({
      ok: true,
      query,
      minQueryLength: toolsSearchMinQueryLen,
      limit: safeLimit,
      counts: {
        chats: 0,
        commands: 0,
        errors: 0,
        files: 0
      },
      results: {
        chats: [],
        commands: [],
        errors: [],
        files: []
      }
    });
  }

  const queryLower = query.toLowerCase();
  const likePattern = toSqlLikePattern(queryLower);
  const chatRows = searchConversationsStmt.all(safeUserId, likePattern, likePattern, safeLimit);
  const commandRows = searchTaskCommandsStmt.all(safeUserId, likePattern, likePattern, safeLimit);
  const errorRows = searchTaskErrorsStmt.all(
    safeUserId,
    likePattern,
    likePattern,
    likePattern,
    safeLimit
  );
  const fileRows = searchTaskFilesStmt.all(safeUserId, likePattern, safeLimit * 3);

  const chats = chatRows.map((row) => {
    const conversationId = Number(row && row.conversation_id);
    const safeConversationId = Number.isInteger(conversationId) && conversationId > 0 ? conversationId : 0;
    const title = String((row && row.title) || '').trim() || `Chat ${safeConversationId}`;
    const titleMatches = title.toLowerCase().includes(queryLower);
    const messageSample = String((row && row.last_message) || '');
    const sourceText = titleMatches ? title : messageSample || title;
    return {
      conversationId: safeConversationId,
      title,
      lastMessageAt: String((row && row.last_message_at) || (row && row.created_at) || ''),
      matchField: titleMatches ? 'title' : 'messages',
      snippet: buildSearchSnippet(sourceText, query)
    };
  });

  const commands = commandRows.map((row) => {
    const conversationIdRaw = Number(row && row.conversation_id);
    const conversationId =
      Number.isInteger(conversationIdRaw) && conversationIdRaw > 0 ? conversationIdRaw : null;
    const taskIdRaw = Number(row && row.task_id);
    const taskId = Number.isInteger(taskIdRaw) && taskIdRaw > 0 ? taskIdRaw : 0;
    const output = String((row && row.output) || '');
    const commandText = String((row && row.command) || '');
    const outputMatches = output.toLowerCase().includes(queryLower);
    const snippetSource = outputMatches ? output : commandText;
    const atValue =
      String((row && row.finished_at) || (row && row.started_at) || (row && row.task_updated_at) || '');
    const exitCodeRaw = Number(row && row.exit_code);
    return {
      id: Number(row && row.id) || 0,
      taskId,
      conversationId,
      conversationTitle:
        String((row && row.conversation_title) || '').trim() ||
        (conversationId ? `Chat ${conversationId}` : 'Sin chat'),
      command: buildSearchSnippet(commandText, query, 160),
      outputSnippet: buildSearchSnippet(snippetSource, query, 200),
      status: toTaskCommandStatus((row && row.status) || '', Number.isInteger(exitCodeRaw) ? exitCodeRaw : null),
      exitCode: Number.isInteger(exitCodeRaw) ? exitCodeRaw : null,
      at: atValue
    };
  });

  const errors = errorRows.map((row) => {
    const conversationIdRaw = Number(row && row.conversation_id);
    const conversationId =
      Number.isInteger(conversationIdRaw) && conversationIdRaw > 0 ? conversationIdRaw : null;
    const taskIdRaw = Number(row && row.id);
    const taskId = Number.isInteger(taskIdRaw) && taskIdRaw > 0 ? taskIdRaw : 0;
    const closeReason = String((row && row.close_reason) || '').trim();
    const resultSummary = String((row && row.result_summary) || '').trim();
    const summarySource = closeReason || resultSummary || 'Error sin detalle';
    const atValue = String((row && row.finished_at) || (row && row.updated_at) || (row && row.started_at) || '');
    const failedCommands = Number(row && row.command_failed);
    return {
      taskId,
      conversationId,
      conversationTitle:
        String((row && row.conversation_title) || '').trim() ||
        (conversationId ? `Chat ${conversationId}` : 'Sin chat'),
      status: normalizeTaskStatus((row && row.status) || ''),
      commandFailed: Number.isFinite(failedCommands) ? Math.max(0, failedCommands) : 0,
      summary: buildSearchSnippet(summarySource, query, 220),
      at: atValue
    };
  });

  const files = [];
  for (const row of fileRows) {
    if (files.length >= safeLimit) break;
    const allFiles = safeParseJsonArray(row && row.files_touched_json)
      .map((entry) => normalizeRepoRelativePath(entry))
      .filter(Boolean);
    const matchedFiles = allFiles.filter((entry) => String(entry).toLowerCase().includes(queryLower));
    if (matchedFiles.length === 0) continue;
    const conversationIdRaw = Number(row && row.conversation_id);
    const conversationId =
      Number.isInteger(conversationIdRaw) && conversationIdRaw > 0 ? conversationIdRaw : null;
    const taskIdRaw = Number(row && row.id);
    const taskId = Number.isInteger(taskIdRaw) && taskIdRaw > 0 ? taskIdRaw : 0;
    files.push({
      taskId,
      conversationId,
      conversationTitle:
        String((row && row.conversation_title) || '').trim() ||
        (conversationId ? `Chat ${conversationId}` : 'Sin chat'),
      files: matchedFiles.slice(0, 10),
      filesCount: matchedFiles.length,
      at: String((row && row.finished_at) || (row && row.updated_at) || (row && row.started_at) || '')
    });
  }

  return res.json({
    ok: true,
    query,
    minQueryLength: toolsSearchMinQueryLen,
    limit: safeLimit,
    counts: {
      chats: chats.length,
      commands: commands.length,
      errors: errors.length,
      files: files.length
    },
    results: {
      chats,
      commands,
      errors,
      files
    }
  });
});

app.get('/api/tools/observability', requireAuth, (_req, res) => {
  return res.json({
    ok: true,
    observability: buildObservabilitySnapshot()
  });
});

app.get('/api/tools/deployed-apps', requireAuth, (req, res) => {
  const forceRefresh = String(req.query.refresh || '').trim() === '1';
  const snapshot = collectDeployedAppsSnapshot(forceRefresh);
  return res.json({
    ok: true,
    scannedAt: snapshot.scannedAt,
    apps: snapshot.apps
  });
});

app.post('/api/tools/deployed-apps/describe', requireAuth, async (req, res) => {
  const rawIds =
    req.body && Array.isArray(req.body.appIds)
      ? req.body.appIds
      : [];
  const requestedIds = Array.from(
    new Set(
      rawIds
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  ).slice(0, deployedAppsDescribeMaxItems);
  if (requestedIds.length === 0) {
    return res.status(400).json({ error: 'Selecciona al menos una app para generar descripcion.' });
  }

  const snapshot = collectDeployedAppsSnapshot(true);
  const appById = new Map(
    snapshot.apps.map((app) => [String((app && app.id) || '').trim(), app])
  );
  const selectedApps = requestedIds
    .map((appId) => appById.get(appId))
    .filter(Boolean);
  if (selectedApps.length === 0) {
    return res.status(404).json({ error: 'No se encontraron apps desplegadas para los IDs seleccionados.' });
  }
  const missingAppIds = requestedIds.filter((appId) => !appById.has(appId));
  const activeAgentId = getUserActiveAiAgentId(req.session.userId) || '';
  const provider = 'codex-cli';
  const generatedAt = nowIso();

  try {
    const descriptions = await generateDeployedAppsDescriptionsWithCodex({
      userId: req.session.userId,
      username: req.session && typeof req.session.username === 'string' ? req.session.username : '',
      activeAgentId,
      apps: selectedApps
    });

    return res.json({
      ok: true,
      provider,
      activeAgentId,
      scannedAt: snapshot.scannedAt,
      generatedAt,
      missingAppIds,
      descriptions: descriptions.map((entry) => ({
        appId: entry.appId,
        name: entry.name,
        description: entry.description,
        generatedAt
      }))
    });
  } catch (error) {
    if (error && error.message === 'CODEX_NOT_FOUND') {
      return res.status(503).json({
        error: 'No se encontro Codex CLI en el servidor para generar descripciones.'
      });
    }
    const reason = truncateForNotify(error && error.message ? error.message : 'describe_failed', 220);
    return res.status(500).json({
      error: `No se pudo generar la descripcion con IA: ${reason}`
    });
  }
});

app.post('/api/tools/deployed-apps/:appId/action', requireAuth, (req, res) => {
  const appId = String(req.params.appId || '').trim();
  const action = normalizeDeployedAppAction(req.body && req.body.action);
  if (!action) {
    return res.status(400).json({ error: 'Accion invalida. Usa start, stop o restart.' });
  }

  const appSummary = findDeployedAppById(appId, { forceRefresh: true });
  if (!appSummary) {
    return res.status(404).json({ error: 'App desplegada no encontrada.' });
  }
  if (action === 'start' && !appSummary.canStart) {
    return res.status(409).json({ error: 'Esta app ya esta en ejecucion.' });
  }
  if (action === 'stop' && !appSummary.canStop) {
    return res.status(409).json({ error: 'Esta app ya esta detenida.' });
  }
  if (action === 'restart' && !appSummary.canRestart) {
    return res.status(409).json({ error: 'Reinicio no disponible para esta app.' });
  }

  const actionResult = runDeployedAppAction(appSummary.id, action);
  if (!actionResult.ok) {
    const reason = truncateForNotify(actionResult.stderr || actionResult.stdout || 'app_action_failed', 220);
    return res.status(500).json({ error: `No se pudo aplicar accion "${action}": ${reason}` });
  }

  const refreshedSnapshot = collectDeployedAppsSnapshot(true);
  const refreshedApp = refreshedSnapshot.apps.find((entry) => entry.id === appSummary.id) || appSummary;
  const output = truncateRawText(stripAnsi([actionResult.stdout, actionResult.stderr].filter(Boolean).join('\n')).trim(), 6000);

  return res.json({
    ok: true,
    action,
    app: refreshedApp,
    output,
    scannedAt: refreshedSnapshot.scannedAt
  });
});

app.get('/api/tools/deployed-apps/:appId/logs', requireAuth, (req, res) => {
  const appId = String(req.params.appId || '').trim();
  const appSummary = findDeployedAppById(appId, { forceRefresh: true });
  if (!appSummary) {
    return res.status(404).json({ error: 'App desplegada no encontrada.' });
  }
  if (!appSummary.hasLogs) {
    return res.status(409).json({ error: 'Esta app no expone logs desde esta vista.' });
  }

  const logsPayload = getDeployedAppLogs(appSummary.id, req.query.lines);
  if (!logsPayload.ok) {
    return res.status(500).json({ error: `No se pudieron obtener logs: ${logsPayload.error || 'logs_failed'}` });
  }

  return res.json({
    ok: true,
    app: appSummary,
    lines: logsPayload.lines,
    logs: logsPayload.logs,
    fetchedAt: nowIso()
  });
});

app.get('/api/tools/git/repos', requireAuth, (req, res) => {
  const forceRefresh = String(req.query.refresh || '').trim() === '1';
  const snapshot = collectGitToolsReposSnapshot(forceRefresh);
  return res.json({
    ok: true,
    scannedAt: snapshot.scannedAt,
    scanRoots: gitToolsScanRoots,
    repos: snapshot.repos
  });
});

app.post('/api/tools/git/repos/:repoId/push', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }

  const repo = findGitRepoById(req.params.repoId, { forceRefresh: true });
  if (!repo) {
    return res.status(404).json({ error: 'Repositorio no encontrado' });
  }
  if (repo.hasConflicts) {
    return res.status(409).json({ error: 'Este repositorio tiene conflictos. Resuelvelos antes de subir.' });
  }

  const commitMessage = normalizeGitCommitMessage(req.body && req.body.commitMessage, repo.name);
  const gitIdentity = buildGitIdentityFromRequest(req);
  const ensuredIdentity = ensureGitIdentityForRepo(repo.absolutePath, gitIdentity);
  if (!ensuredIdentity.ok) {
    return res.status(500).json({
      error: `No se pudo preparar identidad Git del repo: ${ensuredIdentity.error || 'git_identity_failed'}`
    });
  }
  const gitIdentityEnv = buildGitIdentityEnv(ensuredIdentity.identity);

  const addResult = await runGitInRepoAsync(repo.absolutePath, ['add', '-A'], { env: gitIdentityEnv });
  if (!addResult.ok) {
    const reason = truncateForNotify(addResult.stderr || addResult.stdout || 'git_add_failed', 220);
    return res.status(500).json({ error: `No se pudo preparar cambios: ${reason}` });
  }

  const stagedCheck = await runGitInRepoAsync(
    repo.absolutePath,
    ['diff', '--cached', '--quiet'],
    { allowNonZero: true }
  );
  if (![0, 1].includes(Number(stagedCheck.code))) {
    const reason = truncateForNotify(stagedCheck.stderr || stagedCheck.stdout || 'git_diff_failed', 220);
    return res.status(500).json({ error: `No se pudo validar cambios staged: ${reason}` });
  }

  let commitCreated = false;
  let commitHash = '';
  let commitOutput = '';

  if (Number(stagedCheck.code) === 1) {
    let commitResult = await runGitInRepoAsync(repo.absolutePath, ['commit', '-m', commitMessage], {
      env: gitIdentityEnv
    });
    if (!commitResult.ok && isGitIdentityUnknownError(`${commitResult.stderr}\n${commitResult.stdout}`)) {
      const retryIdentity = ensureGitIdentityForRepo(repo.absolutePath, gitIdentity);
      if (!retryIdentity.ok) {
        return res.status(500).json({
          error: `No se pudo configurar identidad Git para commit: ${retryIdentity.error || 'git_identity_retry_failed'}`
        });
      }
      commitResult = await runGitInRepoAsync(repo.absolutePath, ['commit', '-m', commitMessage], {
        env: buildGitIdentityEnv(retryIdentity.identity)
      });
    }
    if (!commitResult.ok) {
      const reason = truncateForNotify(commitResult.stderr || commitResult.stdout || 'git_commit_failed', 220);
      return res.status(500).json({ error: `No se pudo crear commit: ${reason}` });
    }
    commitCreated = true;
    commitOutput = String(commitResult.stdout || commitResult.stderr || '');
    const hashResult = runGitInRepoSync(repo.absolutePath, ['rev-parse', '--short', 'HEAD']);
    commitHash = hashResult.ok ? String(hashResult.stdout || '').trim() : '';
  }

  const refreshedBeforePush = collectGitRepoSummary(repo.absolutePath, nowIso());
  if (!refreshedBeforePush) {
    return res.status(500).json({ error: 'No se pudo refrescar estado del repositorio.' });
  }
  if (refreshedBeforePush.hasConflicts) {
    return res.status(409).json({ error: 'El repositorio volvió a quedar con conflictos.' });
  }
  if (refreshedBeforePush.detached) {
    return res.status(409).json({ error: 'No se puede subir desde HEAD detached.' });
  }
  if (!refreshedBeforePush.hasRemote || refreshedBeforePush.remotes.length === 0) {
    return res.status(409).json({ error: 'Este repositorio no tiene remotos configurados.' });
  }

  if (!commitCreated && refreshedBeforePush.ahead <= 0) {
    return res.status(409).json({ error: 'No hay cambios para subir al remoto.' });
  }

  const pushArgs = ['push'];
  if (!refreshedBeforePush.upstream) {
    const defaultRemote = refreshedBeforePush.remotes.includes('origin')
      ? 'origin'
      : refreshedBeforePush.remotes[0];
    if (!defaultRemote) {
      return res.status(409).json({ error: 'No se encontró remoto para hacer push.' });
    }
    pushArgs.push('-u', defaultRemote, refreshedBeforePush.branch);
  }

  const pushResult = await runGitInRepoAsync(repo.absolutePath, pushArgs, {
    timeoutMs: gitToolsCommandTimeoutMs,
    allowNonZero: false,
    env: gitIdentityEnv
  });
  if (!pushResult.ok) {
    const reason = truncateForNotify(pushResult.stderr || pushResult.stdout || 'git_push_failed', 260);
    return res.status(500).json({ error: `Push fallido: ${reason}` });
  }

  const refreshedSnapshot = collectGitToolsReposSnapshot(true);
  const refreshedRepo =
    refreshedSnapshot.repos.find((entry) => entry.id === repo.id) || refreshedBeforePush;
  const output = truncateForNotify(
    [commitOutput, pushResult.stdout, pushResult.stderr].filter(Boolean).join('\n').trim(),
    1800
  );

  return res.json({
    ok: true,
    repo: refreshedRepo,
    push: {
      commitCreated,
      commitMessage,
      commitHash,
      output
    }
  });
});

app.post('/api/tools/git/repos/:repoId/resolve-conflicts', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }

  const repo = findGitRepoById(req.params.repoId, { forceRefresh: true });
  if (!repo) {
    return res.status(404).json({ error: 'Repositorio no encontrado' });
  }
  if (!repo.hasConflicts) {
    return res.status(409).json({ error: 'Este repositorio no tiene conflictos activos.' });
  }
  const gitIdentity = buildGitIdentityFromRequest(req);
  const ensuredIdentity = ensureGitIdentityForRepo(repo.absolutePath, gitIdentity);
  if (!ensuredIdentity.ok) {
    return res.status(500).json({
      error: `No se pudo preparar identidad Git del repo: ${ensuredIdentity.error || 'git_identity_failed'}`
    });
  }

  const title = buildConversationTitle(`Resolver conflictos ${repo.name || 'repo'}`);
  const created = createConversationStmt.run(
    safeUserId,
    title,
    DEFAULT_CHAT_MODEL,
    DEFAULT_REASONING_EFFORT
  );
  const conversationId = Number(created.lastInsertRowid);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(500).json({ error: 'No se pudo crear el chat de resolución.' });
  }

  return res.json({
    ok: true,
    repo,
    resolver: {
      conversationId,
      prompt: buildGitConflictResolverPrompt(repo, ensuredIdentity.identity),
      autoSend: true
    }
  });
});

app.post('/api/tasks/:id/rollback', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const taskId = Number(req.params.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return res.status(400).json({ error: 'task_id inválido' });
  }
  const row = getTaskRunByIdForUserStmt.get(taskId, safeUserId);
  if (!row) {
    return res.status(404).json({ error: 'Tarea no encontrada' });
  }
  const task = serializeTaskRow(row);
  if (task.rollbackStatus === 'done') {
    return res.json({
      ok: true,
      alreadyRolledBack: true,
      task
    });
  }
  if (!task.snapshotReady || !task.snapshotDir) {
    return res.status(409).json({ error: 'Esta tarea no tiene snapshot para rollback.' });
  }
  const rollbackResult = restoreTaskFilesFromSnapshot(task.snapshotDir, task.filesTouched);
  if (rollbackResult.failed > 0) {
    const rollbackAt = nowIso();
    const errorSummary = truncateForNotify(rollbackResult.errors.join(' | ') || 'rollback_failed', 900);
    markTaskRunRollbackFailedStmt.run(
      'failed',
      errorSummary,
      rollbackAt,
      nowIso(),
      taskId,
      safeUserId
    );
    return res.status(500).json({
      error: 'El rollback no pudo completarse.',
      rollback: rollbackResult
    });
  }
  const rollbackAt = nowIso();
  markTaskRunRollbackStmt.run(
    'done',
    '',
    rollbackAt,
    0,
    'manual_rollback',
    nowIso(),
    taskId,
    safeUserId
  );
  const refreshed = getTaskRunByIdForUserStmt.get(taskId, safeUserId);
  return res.json({
    ok: true,
    task: serializeTaskRow(refreshed || row),
    rollback: rollbackResult
  });
});

app.get('/api/codex/auth/status', requireAuth, async (req, res) => {
  try {
    const auth = await getCodexAuthStatusForUser(req.session.userId, {
      username: req.session && typeof req.session.username === 'string' ? req.session.username : ''
    });
    const activeFlow = getActiveCodexLoginFlow(req.session.userId);
    return res.json({
      ok: true,
      auth: {
        loggedIn: Boolean(auth.loggedIn),
        statusText: String(auth.statusText || ''),
        details: auth && auth.details && typeof auth.details === 'object' ? auth.details : null,
        loginInProgress: Boolean(activeFlow),
        login: serializeCodexLoginFlow(activeFlow)
      }
    });
  } catch (error) {
    const reason = truncateForNotify(error && error.message ? error.message : 'codex_auth_status_error', 180);
    return res.status(500).json({ error: `No se pudo leer estado de Codex CLI: ${reason}` });
  }
});

app.post('/api/codex/auth/device/start', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }

  const existing = getActiveCodexLoginFlow(safeUserId);
  if (existing) {
    return res.json({
      ok: true,
      login: serializeCodexLoginFlow(existing)
    });
  }

  try {
    const codexPath = await resolveCodexPath();
    const codexHome = getUserCodexHome(safeUserId);
    const loginProcess = spawn(codexPath, ['login', '--device-auth'], {
      cwd: process.cwd(),
      env: getCodexEnvForUser(safeUserId, {
        username: req.session && typeof req.session.username === 'string' ? req.session.username : ''
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const loginFlow = {
      userId: safeUserId,
      codexHome,
      process: loginProcess,
      startedAt: nowIso(),
      startedAtMs: Date.now(),
      verificationUri: '',
      userCode: '',
      expiresAt: '',
      inProgress: true,
      completed: false,
      failed: false,
      cancelled: false,
      statusText: '',
      error: '',
      waiters: []
    };
    activeCodexLoginFlows.set(safeUserId, loginFlow);

    const captureOutput = (chunk) => {
      const raw = String(chunk || '');
      if (!raw) return;
      parseCodexDeviceAuthHints(loginFlow, raw);
      const text = normalizeCodexStatusText(raw);
      if (text) {
        loginFlow.statusText = text;
      }
      notifyCodexLoginFlowWaiters(loginFlow);
    };

    if (loginProcess.stdout) {
      loginProcess.stdout.on('data', captureOutput);
    }
    if (loginProcess.stderr) {
      loginProcess.stderr.on('data', captureOutput);
    }

    loginProcess.on('error', (error) => {
      loginFlow.inProgress = false;
      loginFlow.failed = true;
      loginFlow.error = normalizeCodexStatusText(error && error.message ? error.message : 'login_spawn_error');
      loginFlow.statusText = loginFlow.error;
      notifyCodexLoginFlowWaiters(loginFlow);
      activeCodexLoginFlows.delete(safeUserId);
    });

    loginProcess.on('close', (code, signal) => {
      if (loginFlow.cancelled) {
        loginFlow.inProgress = false;
        loginFlow.statusText = loginFlow.statusText || 'Login cancelado.';
      } else if (Number.isInteger(code) && code === 0) {
        loginFlow.inProgress = false;
        loginFlow.completed = true;
        loginFlow.statusText = loginFlow.statusText || 'Sesión iniciada en Codex CLI.';
      } else {
        loginFlow.inProgress = false;
        loginFlow.failed = true;
        loginFlow.error = loginFlow.error || `El login de Codex finalizó con error (${code ?? signal ?? 'n/a'}).`;
        loginFlow.statusText = loginFlow.error;
      }
      notifyCodexLoginFlowWaiters(loginFlow);
      activeCodexLoginFlows.delete(safeUserId);
    });

    await waitForCodexLoginBootstrap(loginFlow, 1800);
    return res.json({
      ok: true,
      login: serializeCodexLoginFlow(loginFlow)
    });
  } catch (error) {
    const reason = truncateForNotify(error && error.message ? error.message : 'codex_device_login_error', 180);
    return res.status(500).json({ error: `No se pudo iniciar login de Codex: ${reason}` });
  }
});

app.post('/api/codex/auth/device/cancel', requireAuth, (req, res) => {
  const activeFlow = getActiveCodexLoginFlow(req.session.userId);
  if (!activeFlow) {
    return res.json({ ok: true, cancelled: false, reason: 'no_active_login' });
  }
  const cancelled = terminateCodexLoginFlow(activeFlow, 'cancelled_by_user');
  notifyCodexLoginFlowWaiters(activeFlow);
  return res.json({
    ok: true,
    cancelled,
    reason: cancelled ? 'cancelled' : 'already_stopped'
  });
});

app.post('/api/codex/auth/logout', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }

  const activeFlow = getActiveCodexLoginFlow(safeUserId);
  if (activeFlow) {
    terminateCodexLoginFlow(activeFlow, 'cancelled_by_logout');
  }

  try {
    const codexPath = await resolveCodexPath();
    await execFileAsync(codexPath, ['logout'], {
      env: getCodexEnvForUser(safeUserId, {
        username: req.session && typeof req.session.username === 'string' ? req.session.username : ''
      }),
      cwd: process.cwd(),
      timeout: 15000,
      maxBuffer: 128 * 1024
    });
  } catch (error) {
    const detail = normalizeCodexStatusText(
      `${error && error.stdout ? error.stdout : ''}\n${error && error.stderr ? error.stderr : ''}`
    );
    const notLogged = detail.toLowerCase().includes('not logged in');
    if (!notLogged) {
      const reason = truncateForNotify(detail || (error && error.message ? error.message : 'logout_error'), 180);
      return res.status(500).json({ error: `No se pudo cerrar sesión de Codex: ${reason}` });
    }
  }

  codexQuotaStateByUser.delete(safeUserId);
  return res.json({ ok: true });
});

app.get('/api/attachments', requireAuth, (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const attachments = listAttachmentsForUser(req.session.userId, rawLimit);
  return res.json({
    ok: true,
    attachments
  });
});

app.delete('/api/attachments/:id', requireAuth, (req, res) => {
  const parsedId = parseAttachmentId(req.params.id);
  if (!parsedId) {
    return res.status(400).json({ error: 'attachment_id inválido' });
  }

  const conversation = getConversationStmt.get(parsedId.conversationId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversación no encontrada' });
  }
  if (!canManageConversation(req, conversation)) {
    return res.status(403).json({ error: 'No autorizado para eliminar este adjunto' });
  }

  const conversationDir = path.join(uploadsDir, String(parsedId.conversationId));
  const targetPath = path.join(conversationDir, parsedId.storedName);
  if (!targetPath.startsWith(`${conversationDir}${path.sep}`) && targetPath !== conversationDir) {
    return res.status(400).json({ error: 'attachment_id inválido' });
  }
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'Adjunto no encontrado' });
  }

  fs.unlinkSync(targetPath);
  deleteMessageAttachmentsByFileStmt.run(parsedId.conversationId, parsedId.storedName);
  try {
    const leftovers = fs.readdirSync(conversationDir);
    if (leftovers.length === 0) {
      fs.rmdirSync(conversationDir);
    }
  } catch (_error) {
    // ignore cleanup failures
  }

  return res.json({
    ok: true,
    deleted: {
      attachmentId: `${parsedId.conversationId}:${parsedId.storedName}`
    }
  });
});

app.post('/api/uploads', requireAuth, async (req, res) => {
  const username = truncateForNotify(req.session && req.session.username ? req.session.username : 'anon');
  const declaredSize = Number(req.get('content-length'));
  const decodedName = decodeHeaderValue(req.get('x-file-name'));
  const name = sanitizeFilename(decodedName || 'file');
  const detectedMimeType = decodeHeaderValue(req.get('x-file-type')) || String(req.get('content-type') || '');
  const mimeType = String(detectedMimeType || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
  const conversationHeader = String(req.get('x-conversation-id') || '').trim();
  let conversationId = null;

  if (conversationHeader) {
    conversationId = Number(conversationHeader);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'conversation_id inválido' });
    }
    const ownedConversation = getOwnedConversationOrNull(conversationId, req.session.userId);
    if (!ownedConversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
  }

  if (Number.isFinite(declaredSize) && declaredSize > maxAttachmentSizeBytes) {
    return res.status(413).json({ error: `Adjunto demasiado grande: ${name} (maximo ${maxAttachmentSizeMb}MB)` });
  }

  cleanupPendingUploads();
  const uploadId = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const pendingDir = path.join(pendingUploadsDir, String(req.session.userId));
  fs.mkdirSync(pendingDir, { recursive: true });
  const storedPath = path.join(pendingDir, `${uploadId}_${name}`);

  try {
    const storedSize = await streamRequestToFile(req, storedPath, maxAttachmentSizeBytes);
    if (storedSize <= 0) {
      if (fs.existsSync(storedPath)) {
        fs.unlinkSync(storedPath);
      }
      return res.status(400).json({ error: `Adjunto invalido: ${name}` });
    }
    if (Number.isFinite(declaredSize) && declaredSize !== storedSize) {
      if (fs.existsSync(storedPath)) {
        fs.unlinkSync(storedPath);
      }
      return res.status(400).json({ error: `Adjunto invalido: ${name}` });
    }

    pendingUploads.set(uploadId, {
      uploadId,
      userId: req.session.userId,
      conversationId,
      name,
      mimeType,
      size: storedSize,
      path: storedPath,
      createdAt: Date.now()
    });

    return res.json({
      ok: true,
      attachment: {
        uploadId,
        name,
        mimeType,
        size: storedSize
      }
    });
  } catch (error) {
    const reason = truncateForNotify(error && error.message ? error.message : 'upload_error', 160);
    void notify(`Error upload user=${username}: ${reason}`);
    if (error && error.exposeToClient) {
      return res.status(error.statusCode || 400).json({ error: error.message || 'Adjunto invalido' });
    }
    return res.status(500).json({ error: `No se pudo subir el adjunto: ${name}` });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  const requestStartedAtMs = Date.now();
  const { message } = req.body;
  const requestedModel = sanitizeConversationModel(req.body && req.body.model);
  const modelWasProvided = req.body && Object.prototype.hasOwnProperty.call(req.body, 'model');
  const reasoningWasProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'reasoningEffort');
  const requestedReasoningEffort =
    req.body && typeof req.body.reasoningEffort === 'string'
      ? req.body.reasoningEffort.trim().toLowerCase()
      : '';
  const requestedConversationId = req.body && req.body.conversationId ? Number(req.body.conversationId) : null;
  const rawAttachments = req.body && Array.isArray(req.body.attachments) ? req.body.attachments : [];
  const username = truncateForNotify(req.session && req.session.username ? req.session.username : 'anon');
  const userNotificationSettings = getUserNotificationSettings(req.session.userId);
  const hasAttachments = rawAttachments.length > 0;
  if ((!message || !message.trim()) && !hasAttachments) {
    void notify(`Error en chat user=${username}: mensaje vacío`);
    return res.status(400).json({ error: 'Mensaje vacío' });
  }
  const prompt = message && message.trim() ? message.trim() : 'Analiza los adjuntos y responde.';
  if (reasoningWasProvided && requestedReasoningEffort && !allowedReasoningEfforts.has(requestedReasoningEffort)) {
    return res.status(400).json({ error: 'Nivel de razonamiento inválido' });
  }
  const chatRuntime = resolveChatAgentRuntimeForUser(req.session.userId);
  let selectedModel = normalizeChatAgentModel(
    chatRuntime.activeAgentId,
    requestedModel || chatRuntime.defaults.model
  );
  let selectedReasoningEffort = sanitizeReasoningEffort(
    requestedReasoningEffort,
    chatRuntime.defaults.reasoningEffort
  );
  let conversationId = null;
  let persistedAttachments = [];
  let userMessageId = null;
  let assistantMessageId = null;
  let liveDraftId = null;
  const liveDraftRequestId = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  let taskRunId = null;
  let taskSnapshot = null;
  let taskCommandSeq = 0;
  const taskCommandStateByItem = new Map();
  const taskTestCommands = new Set();
  let taskCompletionWritten = false;

  const finalizeTaskRun = (payload = {}) => {
    if (!taskRunId || taskCompletionWritten) return;
    taskCompletionWritten = true;
    const finishedAt = String(payload.finishedAt || nowIso());
    const status = normalizeTaskStatus(payload.status || 'failed');
    const closeReason = String(payload.closeReason || '').trim();
    const resultSummary = normalizeTaskResultSummary(payload.resultSummary || '');
    const planText = normalizeTaskPlanText(payload.planText || '');
    const explicitDurationMs = Number(payload.durationMs);
    const durationMs = Number.isFinite(explicitDurationMs)
      ? Math.max(0, explicitDurationMs)
      : Math.max(0, Date.now() - requestStartedAtMs);
    const sortedCommands = Array.from(taskCommandStateByItem.values()).sort(
      (a, b) => Number(a.position || 0) - Number(b.position || 0)
    );
    const commandTotal = sortedCommands.length;
    const commandFailed = sortedCommands.reduce((acc, entry) => {
      return toTaskCommandStatus(entry.status || '', entry.exitCode) === 'failed' ? acc + 1 : acc;
    }, 0);
    const testsExecuted = Array.from(taskTestCommands.values()).slice(0, 40);
    const filesTouched =
      taskSnapshot && taskSnapshot.manifest ? detectTouchedFilesFromSnapshot(taskSnapshot.manifest) : [];
    const rollbackAvailable = Boolean(taskSnapshot && taskSnapshot.snapshotReady && filesTouched.length > 0);
    const riskLevel = computeTaskRiskLevel({
      status,
      filesTouchedCount: filesTouched.length,
      commandFailed,
      testsExecutedCount: testsExecuted.length,
      rollbackReady: rollbackAvailable
    });
    const metrics = {
      usage: payload.usage && typeof payload.usage === 'object' ? payload.usage : null,
      structured: Boolean(payload.structured),
      filesTouchedCount: filesTouched.length,
      clientDisconnected: Boolean(payload.clientDisconnected),
      snapshotReady: Boolean(taskSnapshot && taskSnapshot.snapshotReady)
    };
    try {
      completeTaskRunStmt.run(
        status,
        closeReason,
        resultSummary,
        planText,
        riskLevel,
        JSON.stringify(filesTouched),
        JSON.stringify(testsExecuted),
        JSON.stringify(metrics),
        commandTotal,
        commandFailed,
        rollbackAvailable ? 1 : 0,
        finishedAt,
        durationMs,
        nowIso(),
        taskRunId,
        req.session.userId
      );
    } catch (error) {
      const reason = truncateForNotify(error && error.message ? error.message : 'task_finalize_failed', 160);
      void notify(`WARN task_finalize_failed user=${username} conv=${conversationId} reason=${reason}`);
    }
  };

  if (requestedConversationId !== null) {
    if (!Number.isInteger(requestedConversationId) || requestedConversationId <= 0) {
      return res.status(400).json({ error: 'conversation_id inválido' });
    }
    const ownedConversation = getOwnedConversationOrNull(requestedConversationId, req.session.userId);
    if (!ownedConversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    conversationId = requestedConversationId;
    const storedConversationModel = String(
      ownedConversation.model || chatRuntime.defaults.model || DEFAULT_CHAT_MODEL
    );
    const storedConversationReasoning = sanitizeReasoningEffort(
      ownedConversation.reasoning_effort,
      chatRuntime.defaults.reasoningEffort
    );
    selectedModel = modelWasProvided
      ? normalizeChatAgentModel(chatRuntime.activeAgentId, requestedModel || chatRuntime.defaults.model)
      : normalizeChatAgentModel(chatRuntime.activeAgentId, storedConversationModel);
    selectedReasoningEffort = reasoningWasProvided
      ? sanitizeReasoningEffort(
          requestedReasoningEffort,
          storedConversationReasoning
        )
      : storedConversationReasoning;

    if (
      modelWasProvided ||
      reasoningWasProvided ||
      selectedModel !== storedConversationModel ||
      selectedReasoningEffort !== storedConversationReasoning
    ) {
      updateConversationSettingsStmt.run(selectedModel, selectedReasoningEffort, conversationId);
    }
  } else {
    const title = buildConversationTitle(prompt);
    const created = createConversationStmt.run(req.session.userId, title, selectedModel, selectedReasoningEffort);
    conversationId = Number(created.lastInsertRowid);
  }

  try {
    const taskStartedAt = nowIso();
    const createdTask = insertTaskRunStmt.run(
      req.session.userId,
      conversationId,
      liveDraftRequestId,
      prompt,
      selectedModel,
      selectedReasoningEffort,
      taskStartedAt,
      taskStartedAt
    );
    taskRunId = Number(createdTask.lastInsertRowid);
    taskSnapshot = createTaskSnapshot(taskRunId);
    if (taskRunId) {
      updateTaskRunSnapshotStmt.run(
        String((taskSnapshot && taskSnapshot.snapshotDir) || ''),
        taskSnapshot && taskSnapshot.snapshotReady ? 1 : 0,
        nowIso(),
        taskRunId,
        req.session.userId
      );
    }
  } catch (error) {
    const reason = truncateForNotify(error && error.message ? error.message : 'task_start_failed', 160);
    void notify(`WARN task_start_failed user=${username} conv=${conversationId} reason=${reason}`);
    taskRunId = null;
    taskSnapshot = null;
  }

  const userMessage = insertMessageStmt.run(conversationId, 'user', prompt);
  userMessageId = Number(userMessage.lastInsertRowid);
  updateConversationTitleStmt.run(buildConversationTitle(prompt), conversationId);
  void notify(`Arranca request chat user=${username}`);

  try {
    persistedAttachments = persistAttachments(rawAttachments, conversationId, req.session.userId);
    if (userMessageId && Number.isInteger(userMessageId) && persistedAttachments.length > 0) {
      try {
        persistedAttachments.forEach((file) => {
          const storedName = sanitizeFilename(path.basename(String((file && file.path) || '')));
          if (!storedName) return;
          const safeDisplayName = sanitizeFilename((file && file.name) || storedName);
          const safeMimeType =
            String((file && file.mimeType) || inferMimeTypeFromFilename(storedName)).trim() ||
            'application/octet-stream';
          const safeSize = Math.max(0, Number(file && file.size) || 0);
          insertMessageAttachmentStmt.run(
            userMessageId,
            conversationId,
            storedName,
            safeDisplayName,
            safeMimeType,
            safeSize,
            nowIso()
          );
        });
      } catch (error) {
        const reason = truncateForNotify(error && error.message ? error.message : 'message_attachments_insert_failed', 160);
        void notify(`WARN message_attachments_insert_failed user=${username} conv=${conversationId} reason=${reason}`);
      }
    }
    const conversationMessages = listMessagesStmt.all(conversationId);
    const promptWithHistory = buildPromptWithConversationHistory(prompt, conversationMessages);
    const promptWithRepoContext = buildPromptWithRepoContext(promptWithHistory, prompt);
    const executionPrompt = buildPromptWithAttachments(promptWithRepoContext, persistedAttachments);
    if (chatRuntime.runtimeProvider === 'gemini') {
      const geminiIntegration = getGeminiUserIntegrationForUser(req.session.userId);
      if (!geminiIntegration.apiKey) {
        throw createClientRequestError(
          'Gemini está seleccionado pero falta API key en Integraciones IA.',
          400
        );
      }
      let geminiPath = '';
      try {
        geminiPath = await resolveGeminiPath();
      } catch (_error) {
        throw createClientRequestError(
          'Gemini CLI no está instalado en el servidor. Instala `@google/gemini-cli` o configura `GEMINI_CMD`.',
          400
        );
      }

      const assistantMessage = insertMessageStmt.run(conversationId, 'assistant', '');
      assistantMessageId = Number(assistantMessage.lastInsertRowid);
      const draftCreatedAt = nowIso();
      closeOpenDraftsByConversationStmt.run(draftCreatedAt, req.session.userId, conversationId);
      const draftInsert = insertLiveDraftStmt.run(
        req.session.userId,
        conversationId,
        assistantMessageId,
        liveDraftRequestId,
        prompt,
        '',
        '{}',
        0,
        draftCreatedAt,
        draftCreatedAt
      );
      liveDraftId = Number(draftInsert.lastInsertRowid);

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-Conversation-Id', String(conversationId));
      req.setTimeout(0);
      res.setTimeout(0);
      if (req.socket && typeof req.socket.setTimeout === 'function') {
        req.socket.setTimeout(0);
      }
      if (res.socket && typeof res.socket.setTimeout === 'function') {
        res.socket.setTimeout(0);
      }
      if (req.socket && typeof req.socket.setKeepAlive === 'function') {
        req.socket.setKeepAlive(true);
      }
      if (req.socket && typeof req.socket.setNoDelay === 'function') {
        req.socket.setNoDelay(true);
      }
      if (res.socket && typeof res.socket.setKeepAlive === 'function') {
        res.socket.setKeepAlive(true);
      }
      if (res.socket && typeof res.socket.setNoDelay === 'function') {
        res.socket.setNoDelay(true);
      }
      res.flushHeaders();

      let clientDisconnected = false;
      const handleGeminiClientDisconnect = () => {
        clientDisconnected = true;
      };
      req.on('aborted', handleGeminiClientDisconnect);
      req.on('close', handleGeminiClientDisconnect);
      res.on('close', handleGeminiClientDisconnect);
      res.on('error', handleGeminiClientDisconnect);

      sendSseComment(res, 'ok');
      sendSse(res, 'conversation', { conversationId });
      sendSse(res, 'chat_agent', {
        id: chatRuntime.activeAgentId,
        name: chatRuntime.activeAgentName,
        provider: chatRuntime.runtimeProvider
      });
      sendSse(res, 'reasoning_step', {
        itemId: 'agent_runtime',
        text: `Agente activo: ${chatRuntime.activeAgentName} (modo agente)`
      });

      const geminiArgs = ['-p', buildGeminiPromptWithReasoning(executionPrompt, selectedReasoningEffort)];
      if (selectedModel) {
        geminiArgs.push('-m', selectedModel);
      }
      geminiArgs.push('--approval-mode', 'yolo', '--sandbox', 'false');
      geminiIncludeDirectories.forEach((directory) => {
        geminiArgs.push('--include-directories', directory);
      });
      const geminiEnv = {
        ...process.env,
        GEMINI_API_KEY: String(geminiIntegration.apiKey || '').trim()
      };

      let geminiProcess = null;
      let activeRun = null;
      let finished = false;
      let stdoutText = '';
      let stderrText = '';

      const finalizeGeminiRequest = ({ ok, exitCode, closeReason, output }) => {
        if (finished) return;
        finished = true;
        const safeOutput = String(output || '').trim() || '(Sin salida de Gemini CLI)';
        const runWasKilled = Boolean(activeRun && activeRun.killRequested);
        const safeExitCode = Number.isInteger(exitCode) ? Number(exitCode) : runWasKilled ? 130 : 1;
        const effectiveCloseReason = runWasKilled
          ? String(activeRun && activeRun.killReason ? activeRun.killReason : closeReason || 'killed_by_user')
          : String(closeReason || (ok ? 'completed' : 'provider_error'));
        const success = Boolean(ok) && !runWasKilled;
        if (activeRun) {
          clearActiveChatRun(activeRun);
        }

        if (assistantMessageId) {
          updateMessageContentStmt.run(safeOutput, assistantMessageId);
        } else {
          const fallbackMessage = insertMessageStmt.run(conversationId, 'assistant', safeOutput);
          assistantMessageId = Number(fallbackMessage.lastInsertRowid);
        }
        if (liveDraftId) {
          try {
            updateLiveDraftSnapshotStmt.run(
              conversationId,
              assistantMessageId,
              safeOutput,
              '{}',
              1,
              nowIso(),
              liveDraftId,
              req.session.userId
            );
          } catch (_draftError) {
            // ignore fallback draft update errors
          }
        }

        if (!clientDisconnected) {
          const chunkSize = 1600;
          for (let index = 0; index < safeOutput.length; index += chunkSize) {
            const chunk = safeOutput.slice(index, index + chunkSize);
            if (!chunk) continue;
            if (!sendSse(res, 'assistant_delta', { text: chunk })) {
              clientDisconnected = true;
              break;
            }
          }
          if (!clientDisconnected) {
            sendSse(res, 'done', {
              ok: success,
              conversationId,
              exitCode: safeExitCode,
              closeReason: effectiveCloseReason,
              usage: null,
              structured: false
            });
            if (!res.writableEnded && !res.destroyed) {
              res.end();
            }
          }
        }

        const finishedAt = nowIso();
        const durationMs = Math.max(0, Date.now() - requestStartedAtMs);
        finalizeTaskRun({
          status: success ? 'success' : 'failed',
          closeReason: effectiveCloseReason,
          resultSummary: safeOutput,
          planText: '',
          finishedAt,
          durationMs,
          usage: null,
          structured: false,
          clientDisconnected
        });
        if (userNotificationSettings.notifyOnFinish) {
          const message = buildChatCompletionDiscordMessage({
            status: success ? 'ok' : 'error',
            username,
            conversationId,
            finishedAt,
            durationMs,
            closeReason: effectiveCloseReason,
            includeResult: userNotificationSettings.includeResult,
            result: safeOutput
          });
          if (message) {
            void notify(message, {
              webhookUrl: userNotificationSettings.discordWebhookUrl
            });
          }
        }
        if (success) {
          void notify(
            `Chat ejecutado OK user=${username} conv=${conversationId} agent=${chatRuntime.activeAgentId} result=${truncateForNotify(
              safeOutput,
              1000
            )}`
          );
          return;
        }
        void notify(
          `Error en chat user=${username} conv=${conversationId} agent=${chatRuntime.activeAgentId}: ${truncateForNotify(
            safeOutput,
            240
          )}`
        );
      };

      try {
        geminiProcess = spawn(geminiPath, geminiArgs, {
          cwd: process.cwd(),
          env: geminiEnv,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        const reason = truncateForNotify(error && error.message ? error.message : 'gemini_spawn_error', 200);
        finalizeGeminiRequest({
          ok: false,
          exitCode: 1,
          closeReason: 'spawn_error',
          output: `No se pudo iniciar Gemini CLI: ${reason}`
        });
        return;
      }

      activeRun = registerActiveChatRun(req.session.userId, conversationId, geminiProcess);

      geminiProcess.stdout.on('data', (chunk) => {
        stdoutText += String(chunk || '');
      });
      geminiProcess.stderr.on('data', (chunk) => {
        stderrText += String(chunk || '');
      });
      geminiProcess.on('error', (error) => {
        const codeNotFound =
          error && (error.code === 'ENOENT' || error.errno === 'ENOENT');
        const reason = truncateForNotify(error && error.message ? error.message : 'gemini_exec_error', 220);
        finalizeGeminiRequest({
          ok: false,
          exitCode: codeNotFound ? 127 : 1,
          closeReason: codeNotFound ? 'gemini_not_found' : 'spawn_error',
          output: codeNotFound
            ? 'No se encontró el binario `gemini` en el servidor. Instala Gemini CLI o define GEMINI_CMD.'
            : `No se pudo iniciar Gemini CLI: ${reason}`
        });
      });
      geminiProcess.on('close', (code, signal) => {
        const normalizedExitCode = Number.isInteger(code) ? Number(code) : signal ? 130 : 1;
        const cleanStdout = String(stdoutText || '').trim();
        const cleanStderr = String(stderrText || '').trim();
        const stderrTail = cleanStderr
          ? cleanStderr
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter(Boolean)
              .slice(-1)[0] || ''
          : '';
        const runWasKilled = Boolean(activeRun && activeRun.killRequested);
        const success = normalizedExitCode === 0 && !runWasKilled;
        let output = cleanStdout;
        let closeReason = success ? 'completed' : 'provider_error';

        if (runWasKilled) {
          closeReason = String(activeRun && activeRun.killReason ? activeRun.killReason : 'killed_by_user');
        }
        if (!success) {
          output =
            output ||
            stderrTail ||
            (signal
              ? `Gemini CLI terminó por señal ${signal}.`
              : `Gemini CLI terminó con código ${normalizedExitCode}.`);
        }

        finalizeGeminiRequest({
          ok: success,
          exitCode: normalizedExitCode,
          closeReason,
          output
        });
      });
      return;
    }

    const codexPath = await resolveCodexPath();
    const args = [
      '-c',
      'shell_environment_policy.inherit=all',
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'danger-full-access',
      '--json',
      '--color',
      'never'
    ];
    if (selectedModel) {
      args.push('-m', selectedModel);
    }
    if (selectedReasoningEffort) {
      args.push('-c', `model_reasoning_effort="${selectedReasoningEffort}"`);
    }
    args.push(executionPrompt);

    const assistantMessage = insertMessageStmt.run(conversationId, 'assistant', '');
    assistantMessageId = Number(assistantMessage.lastInsertRowid);
    const draftCreatedAt = nowIso();
    closeOpenDraftsByConversationStmt.run(draftCreatedAt, req.session.userId, conversationId);
    const draftInsert = insertLiveDraftStmt.run(
      req.session.userId,
      conversationId,
      assistantMessageId,
      liveDraftRequestId,
      prompt,
      '',
      '{}',
      0,
      draftCreatedAt,
      draftCreatedAt
    );
    liveDraftId = Number(draftInsert.lastInsertRowid);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Conversation-Id', String(conversationId));
    req.setTimeout(0);
    res.setTimeout(0);
    if (req.socket && typeof req.socket.setTimeout === 'function') {
      req.socket.setTimeout(0);
    }
    if (res.socket && typeof res.socket.setTimeout === 'function') {
      res.socket.setTimeout(0);
    }
    if (req.socket && typeof req.socket.setKeepAlive === 'function') {
      req.socket.setKeepAlive(true);
    }
    if (req.socket && typeof req.socket.setNoDelay === 'function') {
      req.socket.setNoDelay(true);
    }
    if (res.socket && typeof res.socket.setKeepAlive === 'function') {
      res.socket.setKeepAlive(true);
    }
    if (res.socket && typeof res.socket.setNoDelay === 'function') {
      res.socket.setNoDelay(true);
    }
    res.flushHeaders();
    let codexProcess = null;
    let activeRun = null;
    let clientDisconnected = false;
    const sseWriteQueue = [];
    let sseBlocked = false;
    let queuedBytes = 0;
    let pendingStreamEnd = false;
    const sseMaxQueueBytes = 1024 * 1024 * 64;

    const canWriteSse = () =>
      !clientDisconnected &&
      !res.writableEnded &&
      !res.destroyed &&
      !(res.socket && res.socket.destroyed);

    const pauseCodexStreams = () => {
      if (!codexProcess) return;
      if (codexProcess.stdout && typeof codexProcess.stdout.pause === 'function') {
        codexProcess.stdout.pause();
      }
      if (codexProcess.stderr && typeof codexProcess.stderr.pause === 'function') {
        codexProcess.stderr.pause();
      }
    };

    const resumeCodexStreams = () => {
      if (!codexProcess) return;
      if (codexProcess.stdout && typeof codexProcess.stdout.resume === 'function') {
        codexProcess.stdout.resume();
      }
      if (codexProcess.stderr && typeof codexProcess.stderr.resume === 'function') {
        codexProcess.stderr.resume();
      }
    };

    const maybeEndSseResponse = () => {
      if (!pendingStreamEnd) return;
      if (clientDisconnected) return;
      if (!canWriteSse()) return;
      if (sseBlocked || sseWriteQueue.length > 0 || queuedBytes > 0) return;
      pendingStreamEnd = false;
      try {
        if (!res.writableEnded && !res.destroyed) {
          res.end();
        }
      } catch (_error) {
        // no-op
      }
    };

    const flushSseQueue = () => {
      if (!canWriteSse()) return false;
      while (sseWriteQueue.length > 0) {
        const chunk = sseWriteQueue.shift();
        queuedBytes = Math.max(0, queuedBytes - Buffer.byteLength(chunk, 'utf8'));
        const canContinue = res.write(chunk);
        if (!canContinue) {
          sseBlocked = true;
          pauseCodexStreams();
          return true;
        }
      }
      sseBlocked = false;
      resumeCodexStreams();
      maybeEndSseResponse();
      return true;
    };

    const enqueueSseChunk = (chunk) => {
      if (!canWriteSse()) return false;
      const text = String(chunk || '');
      if (!text) return true;
      if (sseBlocked || sseWriteQueue.length > 0) {
        queuedBytes += Buffer.byteLength(text, 'utf8');
        if (queuedBytes > sseMaxQueueBytes) {
          pauseCodexStreams();
        }
        sseWriteQueue.push(text);
        return true;
      }
      const canContinue = res.write(text);
      if (!canContinue) {
        sseBlocked = true;
        pauseCodexStreams();
      }
      return true;
    };

    const sendSseSafe = (event, payload) => {
      if (!event) return false;
      return enqueueSseChunk(`event: ${event}\ndata: ${toBase64Json(payload)}\n\n`);
    };

    const sendSseCommentSafe = (comment) => {
      return enqueueSseChunk(`: ${String(comment || '').trim() || 'ping'}\n\n`);
    };

    res.on('drain', () => {
      flushSseQueue();
    });
    sendSseCommentSafe('ok');
    sendSseSafe('conversation', { conversationId });
    sendSseSafe('chat_agent', {
      id: chatRuntime.activeAgentId,
      name: chatRuntime.activeAgentName,
      provider: chatRuntime.runtimeProvider
    });
    let heartbeatTimer = null;
    const stopHeartbeat = () => {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };
    heartbeatTimer = setInterval(() => {
      if (!sendSseCommentSafe('ping')) {
        stopHeartbeat();
      }
    }, 11000);
    const handleClientDisconnect = () => {
      if (clientDisconnected) return;
      clientDisconnected = true;
      stopHeartbeat();
      sseWriteQueue.length = 0;
      sseBlocked = false;
      queuedBytes = 0;
      pendingStreamEnd = false;
      resumeCodexStreams();
      notifyMilestone('fix_disconnect_no_kill', 'FIX aplicado: disconnect SSE no mata proceso Codex');
    };
    req.on('aborted', handleClientDisconnect);
    req.on('close', handleClientDisconnect);
    res.on('close', handleClientDisconnect);
    res.on('error', handleClientDisconnect);

    let assistantOutput = '';
    let stdoutPending = '';
    let stderrPending = '';
    const stderrLines = [];
    const codexNotices = [];
    const reasoningLines = [];
    const assistantItemTexts = new Map();
    const reasoningItemTexts = new Map();
    const commandOutputByItem = new Map();
    let usageSummary = null;
    let sawStructuredEvents = false;
    let lastPersistedAssistantContent = '';
    let lastPersistedDraftSignature = '';
    let assistantPersistErrorLogged = false;
    let lastCodexError = '';
    let latestAssistantMessage = '';
    let finished = false;

    const toSnakeCase = (value) =>
      String(value || '')
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[\s.-]+/g, '_')
        .toLowerCase();

    const getObjectField = (obj, keys) => {
      if (!obj || typeof obj !== 'object') return undefined;
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          return obj[key];
        }
      }
      return undefined;
    };

    const getStringField = (obj, keys) => {
      const value = getObjectField(obj, keys);
      return typeof value === 'string' ? value : '';
    };

    const getNumberField = (obj, keys) => {
      const value = getObjectField(obj, keys);
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      return null;
    };

    const normalizeErrorText = (rawValue) => {
      const value = String(rawValue || '').trim();
      if (!value) return '';
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          const detail = getStringField(parsed, ['detail', 'message', 'error']);
          return detail ? detail.trim() : value;
        }
      } catch (_error) {
        // ignore parse errors and fallback to raw text
      }
      return value;
    };

    const serializeReasoningDraft = () => {
      const byItem = {};
      reasoningLines.forEach((entry, index) => {
        if (!entry || !entry.text) return;
        const key = String(entry.itemId || `reasoning_${index + 1}`);
        byItem[key] = String(entry.text);
      });
      return byItem;
    };

    const persistLiveDraftSnapshot = (completed) => {
      if (!liveDraftId) return;
      const safeCompleted = completed ? 1 : 0;
      const assistantContent = String(assistantOutput || '');
      const reasoningSnapshot = serializeReasoningDraft();
      const reasoningJson = JSON.stringify(reasoningSnapshot);
      const signature = `${assistantContent.length}|${reasoningJson.length}|${safeCompleted}`;
      if (!safeCompleted && signature === lastPersistedDraftSignature) return;
      try {
        const updatedByTuple = updateLiveDraftSnapshotByRequestStmt.run(
          assistantMessageId,
          assistantContent,
          reasoningJson,
          safeCompleted,
          nowIso(),
          req.session.userId,
          conversationId,
          liveDraftRequestId
        );
        if (updatedByTuple.changes <= 0) {
          updateLiveDraftSnapshotStmt.run(
            conversationId,
            assistantMessageId,
            assistantContent,
            reasoningJson,
            safeCompleted,
            nowIso(),
            liveDraftId,
            req.session.userId
          );
        }
        lastPersistedDraftSignature = signature;
      } catch (error) {
        if (!assistantPersistErrorLogged) {
          assistantPersistErrorLogged = true;
          const reason = truncateForNotify(error && error.message ? error.message : 'draft_persist_error', 180);
          void notify(`WARN chat_draft_persist_failed user=${username} conv=${conversationId} reason=${reason}`);
        }
      }
    };

    const pushSystemNotice = (text) => {
      const value = String(text || '').trim();
      if (!value) return;
      codexNotices.push(value);
      if (codexNotices.length > 30) {
        codexNotices.shift();
      }
      sendSseSafe('system_notice', { text: value });
    };

    const buildAssistantContent = () => {
      return assistantOutput.trim();
    };

    const persistAssistantSnapshot = (isFinal = false) => {
      if (!assistantMessageId) return;
      const contentToSave = buildAssistantContent(isFinal);
      if (!isFinal && contentToSave === lastPersistedAssistantContent) return;
      try {
        updateMessageContentStmt.run(contentToSave, assistantMessageId);
        lastPersistedAssistantContent = contentToSave;
        persistLiveDraftSnapshot(false);
      } catch (error) {
        if (!assistantPersistErrorLogged) {
          assistantPersistErrorLogged = true;
          const reason = truncateForNotify(error && error.message ? error.message : 'persist_error', 180);
          void notify(`WARN chat_persist_failed user=${username} conv=${conversationId} reason=${reason}`);
        }
      }
    };

    const pushAssistantDelta = (text) => {
      const value = String(text || '');
      if (!value) return;
      assistantOutput += value;
      sendSseSafe('assistant_delta', { text: value });
      persistAssistantSnapshot(false);
    };

    const pushAssistantMessage = (text) => {
      const value = String(text || '').trim();
      if (!value) return;
      const prefix = assistantOutput ? '\n\n' : '';
      pushAssistantDelta(`${prefix}${value}`);
    };

    const upsertReasoningLine = (text, itemId) => {
      const value = String(text || '').trim();
      if (!value) return;
      if (itemId) {
        const idx = reasoningLines.findIndex((entry) => entry.itemId === itemId);
        if (idx >= 0) {
          reasoningLines[idx] = { itemId, text: value };
        } else {
          reasoningLines.push({ itemId, text: value });
        }
      } else {
        reasoningLines.push({ itemId: '', text: value });
      }
      persistLiveDraftSnapshot(false);
    };

    const resolveTaskCommandItemId = (rawItemId, rawCommand) => {
      const explicitId = String(rawItemId || '').trim();
      if (explicitId) return explicitId;
      const normalizedCommand = String(rawCommand || '').trim();
      if (normalizedCommand) {
        for (const entry of taskCommandStateByItem.values()) {
          if (entry.command === normalizedCommand && !entry.finishedAt) {
            return entry.itemId;
          }
        }
      }
      const commandSlug = normalizedCommand
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 22);
      return `cmd_auto_${taskCommandSeq + 1}_${commandSlug || 'step'}`;
    };

    const rememberTaskCommandState = (rawItemId, patch = {}) => {
      const itemId = resolveTaskCommandItemId(rawItemId, patch.command || '');
      const previous = taskCommandStateByItem.get(itemId) || null;
      let position = Number(patch.position);
      if (!Number.isInteger(position) || position <= 0) {
        const previousPos = previous ? Number(previous.position) : 0;
        if (Number.isInteger(previousPos) && previousPos > 0) {
          position = previousPos;
        } else {
          taskCommandSeq += 1;
          position = taskCommandSeq;
        }
      } else if (position > taskCommandSeq) {
        taskCommandSeq = position;
      }

      const command =
        String(patch.command || '').trim() || String((previous && previous.command) || '').trim() || '(comando)';
      const exitCodeRaw = Number(patch.exitCode);
      const previousExit = previous ? Number(previous.exitCode) : NaN;
      const exitCode = Number.isInteger(exitCodeRaw)
        ? exitCodeRaw
        : Number.isInteger(previousExit)
          ? previousExit
          : null;
      const startedAt =
        String(patch.startedAt || '').trim() ||
        String((previous && previous.startedAt) || '').trim() ||
        nowIso();
      const finishedAt =
        String(patch.finishedAt || '').trim() ||
        String((previous && previous.finishedAt) || '').trim() ||
        '';
      const status = toTaskCommandStatus(
        String(patch.status || (previous && previous.status) || ''),
        exitCode
      );
      const output =
        patch.output !== undefined
          ? normalizeTaskCommandOutput(patch.output)
          : normalizeTaskCommandOutput((previous && previous.output) || '');
      const durationMs = resolveTaskDurationMs(
        startedAt,
        finishedAt,
        patch.durationMs !== undefined ? patch.durationMs : previous && previous.durationMs
      );
      const next = {
        itemId,
        position,
        command,
        status,
        output,
        exitCode,
        startedAt,
        finishedAt,
        durationMs
      };
      taskCommandStateByItem.set(itemId, next);
      if (isTestLikeCommand(command)) {
        taskTestCommands.add(truncateForNotify(command, 220));
      }
      if (taskRunId) {
        upsertTaskRunCommandRecord(taskRunId, itemId, {
          position,
          command,
          status,
          output,
          exitCode,
          startedAt,
          finishedAt,
          durationMs
        });
      }
      return next;
    };

    const handleAgentMessageCompleted = (item) => {
      const itemId = getStringField(item, ['id', 'itemId']);
      const nextText = getStringField(item, ['text', 'message']);
      if (!nextText) return;
      const safeProgressItemId = itemId ? `agent_${itemId}` : 'agent_progress';
      if (itemId) {
        assistantItemTexts.set(itemId, nextText);
      }
      latestAssistantMessage = nextText;
      upsertReasoningLine(nextText, safeProgressItemId);
      sendSseSafe('reasoning_step', { itemId: safeProgressItemId, text: nextText });
    };

    const handleReasoningCompleted = (item) => {
      const itemId = getStringField(item, ['id', 'itemId']);
      const text = getStringField(item, ['text']);
      if (!text) return;
      if (itemId) {
        reasoningItemTexts.set(itemId, text);
      }
      upsertReasoningLine(text, itemId);
      sendSseSafe('reasoning_step', { itemId, text });
    };

    const handleCommandStarted = (item) => {
      const itemId = getStringField(item, ['id', 'itemId']);
      const command = getStringField(item, ['command']);
      const status = toSnakeCase(getStringField(item, ['status'])) || 'in_progress';
      const aggregatedOutput = getStringField(item, ['aggregated_output', 'aggregatedOutput']);
      const tracked = rememberTaskCommandState(itemId, {
        command,
        status,
        output: aggregatedOutput,
        startedAt: nowIso()
      });
      const safeItemId = tracked ? tracked.itemId : itemId;
      if (safeItemId) {
        commandOutputByItem.set(safeItemId, aggregatedOutput);
      }
      sendSseSafe('command_started', { itemId: safeItemId, command, status });
      if (aggregatedOutput) {
        sendSseSafe('command_output_delta', { itemId: safeItemId, text: aggregatedOutput });
      }
    };

    const handleCommandCompleted = (item) => {
      const itemId = getStringField(item, ['id', 'itemId']);
      const command = getStringField(item, ['command']);
      const status = toSnakeCase(getStringField(item, ['status'])) || 'completed';
      const output = getStringField(item, ['aggregated_output', 'aggregatedOutput']);
      const exitCode = getNumberField(item, ['exit_code', 'exitCode']);
      const tracked = rememberTaskCommandState(itemId, {
        command,
        status,
        output,
        exitCode,
        finishedAt: nowIso()
      });
      const safeItemId = tracked ? tracked.itemId : itemId;
      if (safeItemId) {
        const previousOutput = commandOutputByItem.get(safeItemId) || '';
        if (output && output !== previousOutput) {
          const delta = output.startsWith(previousOutput) ? output.slice(previousOutput.length) : output;
          if (delta) {
            sendSseSafe('command_output_delta', { itemId: safeItemId, text: delta });
          }
        }
        commandOutputByItem.set(safeItemId, output);
      }
      sendSseSafe('command_completed', {
        itemId: safeItemId,
        command,
        status,
        output,
        exitCode
      });
    };

    const handleItemStarted = (item) => {
      if (!item || typeof item !== 'object') return;
      const itemType = toSnakeCase(getStringField(item, ['type']));
      if (itemType === 'command_execution' || itemType.includes('command_execution')) {
        handleCommandStarted(item);
      } else if (itemType === 'reasoning') {
        const itemId = getStringField(item, ['id', 'itemId']);
        if (itemId) {
          reasoningItemTexts.set(itemId, '');
          sendSseSafe('reasoning_item_started', { itemId });
        }
      } else if (itemType === 'agent_message' || itemType === 'assistant_message') {
        const itemId = getStringField(item, ['id', 'itemId']);
        if (itemId && !assistantItemTexts.has(itemId)) {
          assistantItemTexts.set(itemId, '');
        }
      }
    };

    const handleItemUpdated = (item) => {
      if (!item || typeof item !== 'object') return;
      const itemType = toSnakeCase(getStringField(item, ['type']));
      if (itemType === 'command_execution' || itemType.includes('command_execution')) {
        const itemId = getStringField(item, ['id', 'itemId']);
        const command = getStringField(item, ['command']);
        const tracked = rememberTaskCommandState(itemId, {
          command,
          status: 'running'
        });
        const safeItemId = tracked ? tracked.itemId : itemId;
        if (!safeItemId) return;
        const previousOutput = commandOutputByItem.get(safeItemId) || '';
        const nextOutput = getStringField(item, ['aggregated_output', 'aggregatedOutput']);
        if (!nextOutput || nextOutput === previousOutput) return;
        const delta = nextOutput.startsWith(previousOutput) ? nextOutput.slice(previousOutput.length) : nextOutput;
        if (delta) {
          sendSseSafe('command_output_delta', { itemId: safeItemId, text: delta });
        }
        commandOutputByItem.set(safeItemId, nextOutput);
        rememberTaskCommandState(safeItemId, {
          command: tracked ? tracked.command : command,
          status: tracked ? tracked.status : 'running',
          output: nextOutput
        });
      }
    };

    const handleItemCompleted = (item) => {
      if (!item || typeof item !== 'object') return;
      const itemType = toSnakeCase(getStringField(item, ['type']));
      if (itemType === 'agent_message' || itemType === 'assistant_message') {
        handleAgentMessageCompleted(item);
      } else if (itemType === 'reasoning') {
        handleReasoningCompleted(item);
      } else if (itemType === 'command_execution' || itemType.includes('command_execution')) {
        handleCommandCompleted(item);
      } else if (itemType.includes('error')) {
        const errorText =
          normalizeErrorText(getStringField(item, ['message', 'text'])) ||
          normalizeErrorText(getStringField(getObjectField(item, ['error']), ['message'])) ||
          'Error reportado por Codex';
        lastCodexError = errorText;
        pushSystemNotice(errorText);
      }
    };

    const handleDeltaEvent = (eventType, eventObj) => {
      const itemId = getStringField(eventObj, ['item_id', 'itemId']);
      const delta = getStringField(eventObj, ['delta', 'text']);
      if (!delta) return;

      if (eventType.includes('agent_message') || eventType.includes('assistant_message')) {
        const safeProgressItemId = itemId ? `agent_${itemId}` : 'agent_progress';
        if (itemId) {
          const previous = assistantItemTexts.get(itemId) || '';
          const nextText = `${previous}${delta}`;
          assistantItemTexts.set(itemId, nextText);
          latestAssistantMessage = nextText;
          upsertReasoningLine(nextText, safeProgressItemId);
        } else {
          const previous = assistantItemTexts.get(safeProgressItemId) || '';
          const nextText = `${previous}${delta}`;
          assistantItemTexts.set(safeProgressItemId, nextText);
          latestAssistantMessage = nextText;
          upsertReasoningLine(nextText, safeProgressItemId);
        }
        sendSseSafe('reasoning_delta', { itemId: safeProgressItemId, text: delta });
        return;
      }

      if (eventType.includes('reasoning')) {
        if (itemId) {
          const previous = reasoningItemTexts.get(itemId) || '';
          const nextText = `${previous}${delta}`;
          reasoningItemTexts.set(itemId, nextText);
          upsertReasoningLine(nextText, itemId);
        } else {
          upsertReasoningLine(delta, '');
        }
        sendSseSafe('reasoning_delta', { itemId, text: delta });
        return;
      }

      if (eventType.includes('command_execution')) {
        sendSseSafe('command_output_delta', { itemId, text: delta });
      }
    };

    const handleStructuredEvent = (eventObj) => {
      if (!eventObj || typeof eventObj !== 'object') return false;
      const eventType = toSnakeCase(getStringField(eventObj, ['type']));
      if (!eventType) return false;
      sawStructuredEvents = true;

      if (eventType === 'thread_started') {
        sendSseSafe('codex_thread', { threadId: getStringField(eventObj, ['thread_id', 'threadId']) });
        return true;
      }

      if (eventType === 'turn_started') {
        sendSseSafe('turn_started', {});
        return true;
      }

      if (eventType === 'turn_completed') {
        const usage = getObjectField(eventObj, ['usage']);
        if (usage && typeof usage === 'object') {
          usageSummary = usage;
          sendSseSafe('codex_usage', { usage });
        }
        return true;
      }

      if (eventType === 'turn_failed') {
        const failedText =
          normalizeErrorText(getStringField(getObjectField(eventObj, ['error']), ['message'])) ||
          normalizeErrorText(getStringField(eventObj, ['message'])) ||
          'La ejecución de Codex falló.';
        lastCodexError = failedText;
        pushSystemNotice(failedText);
        return true;
      }

      if (eventType === 'token_count') {
        const rateLimits = getObjectField(eventObj, ['rate_limits', 'rateLimits']);
        const snapshot = buildCodexQuotaSnapshot(
          rateLimits,
          'chat_stream',
          getStringField(eventObj, ['timestamp']) || nowIso()
        );
        if (snapshot) {
          updateCodexQuotaStateForUser(req.session.userId, snapshot);
          sendSseSafe('codex_quota', { quota: snapshot });
        }
        return true;
      }

      if (eventType === 'item_started') {
        handleItemStarted(getObjectField(eventObj, ['item']));
        return true;
      }

      if (eventType === 'item_updated') {
        handleItemUpdated(getObjectField(eventObj, ['item']));
        return true;
      }

      if (eventType === 'item_completed') {
        handleItemCompleted(getObjectField(eventObj, ['item']));
        return true;
      }

      if (eventType.endsWith('_delta') || eventType.includes('_delta_')) {
        handleDeltaEvent(eventType, eventObj);
        return true;
      }

      if (eventType.includes('error')) {
        const errorText =
          normalizeErrorText(getStringField(eventObj, ['message'])) ||
          normalizeErrorText(getStringField(getObjectField(eventObj, ['error']), ['message'])) ||
          'Error reportado por Codex';
        lastCodexError = errorText;
        pushSystemNotice(errorText);
        return true;
      }

      sendSseSafe('codex_event', { type: eventType });
      return true;
    };

    const handleStdoutLine = (line) => {
      const raw = String(line || '');
      const trimmed = raw.trim();
      if (!trimmed) return;
      try {
        const payload = JSON.parse(trimmed);
        if (handleStructuredEvent(payload)) {
          return;
        }
      } catch (_error) {
        // fallback to plain text when output is not JSONL
      }
      if (sawStructuredEvents) {
        upsertReasoningLine(raw, 'stdout_fallback');
        sendSseSafe('reasoning_delta', { itemId: 'stdout_fallback', text: `${raw}\n` });
        return;
      }
      pushAssistantDelta(`${raw}\n`);
    };

    const pushRawStdoutDelta = (text) => {
      const value = String(text || '');
      if (!value) return;
      const itemId = 'stdout_raw';
      const previous = reasoningItemTexts.get(itemId) || '';
      const nextText = `${previous}${value}`;
      reasoningItemTexts.set(itemId, nextText);
      upsertReasoningLine(nextText, itemId);
      sendSseSafe('raw_stdout_delta', { itemId, text: value });
    };

    const flushStdoutPending = () => {
      const tail = stdoutPending;
      stdoutPending = '';
      if (!tail || !tail.trim()) return;
      handleStdoutLine(tail);
    };

    codexProcess = execFile(codexPath, args, {
      env: getCodexEnvForUser(req.session.userId, {
        username: req.session && typeof req.session.username === 'string' ? req.session.username : ''
      }),
      cwd: process.cwd()
    });
    activeRun = registerActiveChatRun(req.session.userId, conversationId, codexProcess);
    notifyMilestone('execfile_stdio_fixed', 'FIX aplicado: execFile invocado sin opción stdio');

    const flushStderrPending = () => {
      const tail = stderrPending.trim();
      if (!tail) return;
      stderrPending = '';
      stderrLines.push(tail);
      pushSystemNotice(tail);
    };

    const finalizeResponse = (exitCode, closeReason) => {
      if (finished) return;
      finished = true;
      clearActiveChatRun(activeRun);
      stopHeartbeat();
      flushStdoutPending();
      flushStderrPending();
      if (!assistantOutput.trim() && latestAssistantMessage.trim()) {
        assistantOutput = latestAssistantMessage.trim();
      }
      if (!assistantOutput.trim()) {
        const latestNotice = codexNotices.length > 0 ? codexNotices[codexNotices.length - 1] : '';
        const latestStderr = stderrLines.length > 0 ? stderrLines[stderrLines.length - 1] : '';
        let fallbackMessage = '';
        if (lastCodexError) {
          fallbackMessage = `Codex no devolvió respuesta final. Detalle: ${lastCodexError}`;
        } else if (latestNotice) {
          fallbackMessage = `Codex no devolvió respuesta final. Detalle: ${normalizeErrorText(latestNotice)}`;
        } else if (latestStderr) {
          fallbackMessage = `Codex no devolvió respuesta final. stderr: ${truncateForNotify(latestStderr, 260)}`;
        } else if (closeReason) {
          fallbackMessage = `La ejecución se interrumpió antes de finalizar (${closeReason}).`;
        } else if (exitCode !== 0) {
          fallbackMessage = `La ejecución terminó con error (exit code ${exitCode}).`;
        } else {
          fallbackMessage = 'Codex no devolvió contenido para este prompt.';
        }
        pushAssistantMessage(fallbackMessage);
      }
      const outputContent = assistantOutput.trim() ? assistantOutput.trim() : '(Sin salida de Codex)';
      persistAssistantSnapshot(true);
      persistLiveDraftSnapshot(true);
      notifyMilestone('draft_persists_offline', 'FIX aplicado: live draft persiste y finaliza aun sin cliente SSE');

      if (!clientDisconnected) {
        const doneQueued = sendSseSafe('done', {
          ok: exitCode === 0,
          conversationId,
          exitCode,
          closeReason: closeReason || '',
          usage: usageSummary,
          structured: sawStructuredEvents
        });
        if (doneQueued) {
          pendingStreamEnd = true;
          maybeEndSseResponse();
        }
      }

      const finishedAt = nowIso();
      const durationMs = Math.max(0, Date.now() - requestStartedAtMs);
      const closeReasonText =
        closeReason || (exitCode === 0 ? 'completed' : `exit_code_${Number(exitCode)}`);
      finalizeTaskRun({
        status: exitCode === 0 ? 'success' : 'failed',
        closeReason: closeReasonText,
        resultSummary: outputContent,
        planText: serializeReasoningMapToText(serializeReasoningDraft()),
        finishedAt,
        durationMs,
        usage: usageSummary,
        structured: sawStructuredEvents,
        clientDisconnected
      });
      if (userNotificationSettings.notifyOnFinish) {
        const message = buildChatCompletionDiscordMessage({
          status: exitCode === 0 ? 'ok' : 'error',
          username,
          conversationId,
          finishedAt,
          durationMs,
          closeReason: closeReasonText,
          includeResult: userNotificationSettings.includeResult,
          result: outputContent
        });
        if (message) {
          void notify(message, {
            webhookUrl: userNotificationSettings.discordWebhookUrl
          });
        }
      }

      if (clientDisconnected) {
        void notify(
          `Chat desconectado user=${username} conv=${conversationId} draft_guardado=true reason=${truncateForNotify(
            closeReason || 'client_closed',
            120
          )}`
        );
      } else if (exitCode === 0) {
        void notify(
          `Chat ejecutado OK user=${username} conv=${conversationId} result=${truncateForNotify(outputContent, 1000)}`
        );
      } else {
        void notify(
          `Error en chat user=${username} conv=${conversationId}: exit_code_${exitCode} result=${truncateForNotify(
            outputContent,
            1000
          )}`
        );
      }
    };

    codexProcess.stdout.on('data', (chunk) => {
      const text = chunk
        .toString('utf8')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      if (!text) return;
      const hadNewline = text.includes('\n');
      stdoutPending += text;

      let newlineIndex = stdoutPending.indexOf('\n');
      while (newlineIndex >= 0) {
        let line = stdoutPending.slice(0, newlineIndex);
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }
        stdoutPending = stdoutPending.slice(newlineIndex + 1);
        handleStdoutLine(line);
        newlineIndex = stdoutPending.indexOf('\n');
      }

      if (!hadNewline && stdoutPending) {
        pushRawStdoutDelta(text);
      }
    });

    codexProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrPending += text;
      const lines = stderrPending.split(/\r?\n/);
      stderrPending = lines.pop() || '';
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        stderrLines.push(trimmed);
        pushSystemNotice(trimmed);
      });
    });

    codexProcess.on('error', (error) => {
      const msg = `No se pudo iniciar codex: ${truncateForNotify(error.message || 'spawn_error', 160)}`;
      pushAssistantMessage(msg);
      finalizeResponse(1, 'error');
    });

    let stdoutEnded = false;
    let stderrEnded = false;
    let processClosed = false;
    let pendingExitCode = 0;
    let pendingCloseReason = null;

    const finalizeWhenDrained = () => {
      if (!processClosed || !stdoutEnded || !stderrEnded) return;
      finalizeResponse(pendingExitCode, pendingCloseReason);
    };

    codexProcess.stdout.on('end', () => {
      stdoutEnded = true;
      finalizeWhenDrained();
    });

    codexProcess.stderr.on('end', () => {
      stderrEnded = true;
      finalizeWhenDrained();
    });

    codexProcess.on('close', (code, signal) => {
      processClosed = true;
      pendingExitCode = Number.isInteger(code) ? code : 0;
      if (activeRun && activeRun.killRequested && activeRun.killReason) {
        pendingCloseReason = activeRun.killReason;
      } else {
        pendingCloseReason = clientDisconnected
          ? 'client_closed'
          : signal
            ? `signal ${signal}`
            : null;
      }
      finalizeWhenDrained();
    });

    notifyMilestone('codex_full_access', 'CodexWeb ejecuta Codex CLI con acceso total');
    notifyMilestone('streaming_realtime', 'Streaming en tiempo real implementado');
    notifyMilestone('history_persistent', 'Historial persistente implementado');
  } catch (error) {
    const clientStatus = Number(error && error.statusCode);
    const isClientError =
      Boolean(error && error.exposeToClient) &&
      Number.isInteger(clientStatus) &&
      clientStatus >= 400 &&
      clientStatus < 500;
    if (isClientError) {
      const clientMessage = String(error && error.message ? error.message : 'Solicitud invalida');
      const shortError = truncateForNotify(clientMessage, 140);
      void notify(`Error en chat user=${username}: ${shortError}`);
      const historyMessage = `No se pudo procesar la solicitud: ${clientMessage}`;
      finalizeTaskRun({
        status: 'failed',
        closeReason: 'client_error',
        resultSummary: historyMessage,
        planText: '',
        finishedAt: nowIso(),
        durationMs: Math.max(0, Date.now() - requestStartedAtMs),
        usage: null,
        structured: false,
        clientDisconnected: false
      });
      if (userNotificationSettings.notifyOnFinish) {
        const message = buildChatCompletionDiscordMessage({
          status: 'error',
          username,
          conversationId,
          finishedAt: nowIso(),
          durationMs: Math.max(0, Date.now() - requestStartedAtMs),
          closeReason: 'client_error',
          includeResult: userNotificationSettings.includeResult,
          result: historyMessage
        });
        if (message) {
          void notify(message, {
            webhookUrl: userNotificationSettings.discordWebhookUrl
          });
        }
      }
      if (assistantMessageId) {
        updateMessageContentStmt.run(historyMessage, assistantMessageId);
      } else {
        insertMessageStmt.run(conversationId, 'assistant', historyMessage);
      }
      if (liveDraftId) {
        try {
          updateLiveDraftSnapshotStmt.run(
            conversationId,
            assistantMessageId,
            historyMessage,
            '{}',
            1,
            nowIso(),
            liveDraftId,
            req.session.userId
          );
        } catch (_draftError) {
          // ignore draft write errors in fallback path
        }
      }
      if (res.headersSent) {
        try {
          if (!res.writableEnded && !res.destroyed) {
            res.end();
          }
        } catch (_error) {
          // no-op if client already disconnected
        }
        return;
      }
      return res.status(clientStatus).json({ error: clientMessage });
    }

    const usingCodexRuntime = chatRuntime.runtimeProvider !== 'gemini';
    const providerLabel = usingCodexRuntime ? 'Codex' : 'Gemini';
    const codeNotFound = usingCodexRuntime && Boolean(error && error.message === 'CODEX_NOT_FOUND');
    const shortError = codeNotFound
      ? 'codex no encontrado'
      : truncateForNotify(error && error.message ? error.message : 'exec_error', 120);
    void notify(`Error en chat user=${username}: ${shortError}`);
    const details = codeNotFound
      ? 'No se encontró el binario codex en el servidor.'
      : `No se pudo ejecutar ${providerLabel} en el servidor.`;
    const errorMessage = `Error ejecutando ${providerLabel}: ${details}`;
    finalizeTaskRun({
      status: 'failed',
      closeReason: codeNotFound ? 'codex_not_found' : 'exec_error',
      resultSummary: errorMessage,
      planText: '',
      finishedAt: nowIso(),
      durationMs: Math.max(0, Date.now() - requestStartedAtMs),
      usage: null,
      structured: false,
      clientDisconnected: false
    });
    if (userNotificationSettings.notifyOnFinish) {
      const message = buildChatCompletionDiscordMessage({
        status: 'error',
        username,
        conversationId,
        finishedAt: nowIso(),
        durationMs: Math.max(0, Date.now() - requestStartedAtMs),
        closeReason: codeNotFound ? 'codex_not_found' : 'exec_error',
        includeResult: userNotificationSettings.includeResult,
        result: errorMessage
      });
      if (message) {
        void notify(message, {
          webhookUrl: userNotificationSettings.discordWebhookUrl
        });
      }
    }
    if (assistantMessageId) {
      updateMessageContentStmt.run(errorMessage, assistantMessageId);
    } else {
      insertMessageStmt.run(conversationId, 'assistant', errorMessage);
    }
    if (liveDraftId) {
      try {
        updateLiveDraftSnapshotStmt.run(
          conversationId,
          assistantMessageId,
          errorMessage,
          '{}',
          1,
          nowIso(),
          liveDraftId,
          req.session.userId
        );
      } catch (_draftError) {
        // ignore draft write errors in fallback path
      }
    }
    return res.status(500).json({ error: `Error ejecutando ${providerLabel}. ${details}` });
  }
});

app.use((error, _req, res, next) => {
  if (!error) return next();
  if (error.type === 'entity.too.large' || error.status === 413) {
    return res.status(413).json({
      error: `Payload demasiado grande. Maximo ${maxAttachments} adjuntos por mensaje, ${maxAttachmentSizeMb}MB por adjunto y ${maxJsonBodyMb}MB en requests JSON.`
    });
  }
  if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, 'body')) {
    return res.status(400).json({ error: 'JSON invalido en el request.' });
  }
  return next(error);
});

process.on('unhandledRejection', (reason) => {
  const reasonSummary = reason && reason.message ? reason.message : String(reason);
  console.error('Unhandled rejection:', reason);
  void notify(`PROCESS unhandledRejection reason=${truncateForNotify(reasonSummary, 600)}`);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  const errSummary = error && error.message ? error.message : String(error);
  notify(`PROCESS uncaughtException reason=${truncateForNotify(errSummary, 600)}`)
    .finally(() => {
      process.exit(1);
    });
});

markStaleTaskRunsOnStartup();
markRestartRecoveredOnStartup();

const server = app.listen(port, host, () => {
  console.log(`CodexWeb escuchando en http://${host}:${port}`);
  resolveCodexPath()
    .then((codexPath) => {
      console.log(`Codex CLI detectado en ${codexPath}`);
    })
    .catch((error) => {
      const reason = truncateForNotify(error && error.message ? error.message : 'CODEX_NOT_FOUND', 120);
      console.warn(`No se pudo precargar ruta de codex: ${reason}`);
    });
  resolveGeminiPath()
    .then((geminiPath) => {
      console.log(`Gemini CLI detectado en ${geminiPath}`);
    })
    .catch((error) => {
      const reason = truncateForNotify(error && error.message ? error.message : 'GEMINI_NOT_FOUND', 120);
      console.warn(`No se pudo precargar ruta de gemini: ${reason}`);
    });
  notifyMilestone('history_persistent', 'Historial persistente implementado');
  notifyMilestone('codex_full_access', 'CodexWeb ejecuta Codex CLI con acceso total');
  notifyMilestone('streaming_realtime', 'Streaming en tiempo real implementado');
  notifyMilestone('fix_streaming_infinito', 'Arranco fix: streaming infinito');
  notifyMilestone('backend_sse_robusto', 'Backend SSE robusto listo');
  notifyMilestone('persistencia_incremental', 'Persistencia incremental lista');
  notifyMilestone('frontend_render_todo', 'Frontend renderiza TODO');
  notifyMilestone('notify_active', 'Notify server-side activo');
  notifyMilestone('service_restarted', 'Servicio reiniciado');
  void notify(`SERVER START CodexWeb listening on http://${host}:${port}`);
});

server.keepAliveTimeout = 1000 * 60 * 10;
server.headersTimeout = 1000 * 60 * 11;
server.requestTimeout = 0;
