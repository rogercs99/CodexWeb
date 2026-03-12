require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { execFile, execFileSync, spawn } = require('child_process');
const { Transform, pipeline, Readable } = require('stream');
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
const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const GROQ_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const LMSTUDIO_DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';
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
const openRouterFallbackModels = ['openrouter/auto', 'google/gemini-2.0-flash-exp:free'];
const DEFAULT_OPENROUTER_MODEL = openRouterFallbackModels[0];
const ollamaFallbackModels = ['llama3.2', 'qwen2.5-coder:7b'];
const DEFAULT_OLLAMA_MODEL = ollamaFallbackModels[0];
const groqFallbackModels = ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'qwen/qwen3-32b'];
const DEFAULT_GROQ_MODEL = groqFallbackModels[0];
const lmStudioFallbackModels = ['local-model'];
const DEFAULT_LMSTUDIO_MODEL = lmStudioFallbackModels[0];
const aiProviderDefinitions = [
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    description: 'Agente de terminal para tareas de codigo y repositorios.',
    pricing: 'paid',
    integrationType: 'oauth',
    authModes: ['oauth'],
    docsUrl: 'https://developers.openai.com/codex/cli',
    supportsBaseUrl: false,
    runtimeProvider: 'codex',
    capabilities: [
      'chat',
      'streaming',
      'tool-calling',
      'shell',
      'file-ops',
      'git',
      'background-tasks',
      'reasoning-visibility',
      'model-listing',
      'quota'
    ],
    defaultModel: DEFAULT_CHAT_MODEL
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    vendor: 'Google',
    description: 'Agente de terminal de Gemini con ejecucion de comandos y cambios en archivos.',
    pricing: 'freemium',
    integrationType: 'api_key',
    authModes: ['api_key'],
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    supportsBaseUrl: false,
    runtimeProvider: 'gemini',
    capabilities: [
      'chat',
      'streaming',
      'shell',
      'file-ops',
      'git',
      'background-tasks',
      'reasoning-visibility',
      'model-listing'
    ],
    defaultModel: DEFAULT_GEMINI_CHAT_MODEL
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    vendor: 'OpenRouter',
    description: 'Gateway API multimodelo con free tier y streaming estilo chat completions.',
    pricing: 'freemium',
    integrationType: 'api_key',
    authModes: ['api_key'],
    docsUrl: 'https://openrouter.ai/docs',
    supportsBaseUrl: true,
    runtimeProvider: 'openrouter',
    capabilities: ['chat', 'streaming', 'reasoning-visibility', 'model-listing', 'quota'],
    defaultModel: DEFAULT_OPENROUTER_MODEL
  },
  {
    id: 'ollama',
    name: 'Ollama',
    vendor: 'Ollama',
    description: 'Modelos locales en Ubuntu con API HTTP y streaming sin coste por token.',
    pricing: 'free',
    integrationType: 'local_cli',
    authModes: ['none'],
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
    supportsBaseUrl: true,
    runtimeProvider: 'ollama',
    capabilities: ['chat', 'streaming', 'reasoning-visibility', 'model-listing'],
    defaultModel: DEFAULT_OLLAMA_MODEL
  },
  {
    id: 'groq',
    name: 'Groq',
    vendor: 'Groq',
    description: 'API de inferencia ultrarrápida con free tier real y streaming OpenAI-compatible.',
    pricing: 'freemium',
    integrationType: 'api_key',
    authModes: ['api_key'],
    docsUrl: 'https://console.groq.com/docs/overview',
    supportsBaseUrl: true,
    runtimeProvider: 'groq',
    capabilities: ['chat', 'streaming', 'reasoning-visibility', 'model-listing'],
    defaultModel: DEFAULT_GROQ_MODEL
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    vendor: 'LM Studio',
    description: 'Servidor local OpenAI-compatible, gratuito y útil para flujos offline en Ubuntu.',
    pricing: 'free',
    integrationType: 'local_cli',
    authModes: ['none'],
    docsUrl: 'https://lmstudio.ai/docs/app/api/endpoints/openai',
    supportsBaseUrl: true,
    runtimeProvider: 'lmstudio',
    capabilities: ['chat', 'streaming', 'reasoning-visibility', 'model-listing'],
    defaultModel: DEFAULT_LMSTUDIO_MODEL
  }
];
const supportedAiAgents = aiProviderDefinitions.map((provider) => ({
  id: provider.id,
  name: provider.name,
  vendor: provider.vendor,
  description: provider.description,
  pricing: provider.pricing,
  integrationType: provider.integrationType,
  docsUrl: provider.docsUrl,
  supportsBaseUrl: provider.supportsBaseUrl
}));
const supportedAiAgentsById = new Map(supportedAiAgents.map((agent) => [agent.id, agent]));
const aiProviderDefinitionById = new Map(aiProviderDefinitions.map((provider) => [provider.id, provider]));
const aiProviderCapabilitiesById = aiProviderDefinitions.reduce((acc, provider) => {
  acc[provider.id] = Array.isArray(provider.capabilities) ? provider.capabilities.slice() : [];
  return acc;
}, {});
const aiProviderAuthModesById = aiProviderDefinitions.reduce((acc, provider) => {
  acc[provider.id] = Array.isArray(provider.authModes) ? provider.authModes.slice() : [provider.integrationType];
  return acc;
}, {});
const aiPermissionToolCatalog = [
  'chat',
  'git',
  'storage',
  'drive',
  'backups',
  'deployments',
  'shell',
  'wireguard'
];
const aiPermissionDefaultAllowedTools = ['chat', 'git', 'storage', 'drive', 'backups', 'deployments', 'shell', 'wireguard'];
const aiProviderQuotaUnits = new Set(['requests', 'tokens', 'credits', 'usd']);
const aiPermissionAccessModes = new Set(['full_access', 'workspace_only', 'restricted_paths', 'read_only']);
const aiProviderPermissionProfileDefaults = Object.freeze({
  accessMode: 'full_access',
  allowRoot: true,
  runAsUser: '',
  allowedPaths: ['/'],
  deniedPaths: [],
  canWriteFiles: true,
  readOnly: false,
  allowShell: true,
  allowSensitiveTools: true,
  allowNetwork: true,
  allowGit: true,
  allowBackupRestore: true,
  allowedTools: aiPermissionDefaultAllowedTools
});
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
  },
  openrouter: {
    title: 'Integracion OpenRouter',
    steps: [
      'Crea una API key en OpenRouter.',
      'En CodexWeb > Settings > Integraciones IA > OpenRouter, activa la integracion.',
      'Pega la API key y guarda.',
      'Opcional: configura base URL si usas un gateway compatible.',
      'Selecciona OpenRouter como agente activo y prueba el chat.'
    ],
    notes: [
      'Se soporta streaming SSE y listado dinámico de modelos cuando la API key es válida.',
      'La cuota se consulta en endpoint de créditos de OpenRouter cuando está disponible.'
    ]
  },
  ollama: {
    title: 'Integracion Ollama local',
    steps: [
      'Instala Ollama en Ubuntu y arranca el servicio.',
      'Pulsa \"ollama pull <modelo>\" para descargar al menos un modelo.',
      'En CodexWeb activa Ollama y, si hace falta, define base URL.',
      'Selecciona Ollama como agente activo y prueba el chat.'
    ],
    notes: [
      `Base URL por defecto: ${OLLAMA_DEFAULT_BASE_URL}.`,
      'No requiere API key para instancia local.'
    ]
  },
  groq: {
    title: 'Integracion Groq',
    steps: [
      'Crea una API key en Groq Console.',
      'En CodexWeb > Settings > Integraciones IA > Groq, activa la integración.',
      'Pega la API key y guarda.',
      'Opcional: configura base URL compatible OpenAI si usas gateway propio.',
      'Selecciona Groq como agente activo y prueba chat con streaming.'
    ],
    notes: ['Incluye free tier. El listado de modelos se obtiene dinámicamente vía /models.']
  },
  lmstudio: {
    title: 'Integracion LM Studio local',
    steps: [
      'Instala LM Studio en la máquina y habilita el servidor OpenAI-compatible.',
      `Verifica endpoint local (por defecto ${LMSTUDIO_DEFAULT_BASE_URL}).`,
      'En CodexWeb, activa LM Studio y define base URL si usas otro puerto.',
      'Selecciona LM Studio como agente activo y prueba el chat.'
    ],
    notes: ['No requiere API key en entorno local por defecto.']
  }
};
const chatReasoningEffortOptions = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const allowedReasoningEfforts = new Set(chatReasoningEffortOptions);
const supportedChatRuntimeAgentIds = new Set(
  aiProviderDefinitions
    .filter((provider) => Array.isArray(provider.capabilities) && provider.capabilities.includes('chat'))
    .map((provider) => provider.id)
);
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
function resolveConfiguredPath(rawValue, fallbackPath) {
  const fallback = path.resolve(fallbackPath);
  const text = String(rawValue || '').trim();
  if (!text) return fallback;
  try {
    return path.isAbsolute(text) ? path.resolve(text) : path.resolve(__dirname, text);
  } catch (_error) {
    return fallback;
  }
}

const uploadsDir = resolveConfiguredPath(process.env.UPLOADS_DIR, path.join(__dirname, 'uploads'));
const pendingUploadsDir = path.join(uploadsDir, 'pending');
const uploadsDirUrlPath = uploadsDir.replace(/\\/g, '/');
const legacyUploadsRouteBasePath = uploadsDirUrlPath.startsWith('/') ? uploadsDirUrlPath : `/${uploadsDirUrlPath}`;
const legacyCodexUsersRootDir = path.join(__dirname, '.codex_users');
const codexUsersRootDir = path.resolve(
  String(process.env.CODEX_HOME_ROOT || '/var/lib/codexweb/codex_users').trim() || '/var/lib/codexweb/codex_users'
);
const restartStatePath = resolveConfiguredPath(
  process.env.RESTART_STATE_PATH,
  path.join(__dirname, 'restart-state.json')
);
const staticAssetsDir = resolveConfiguredPath(
  process.env.STATIC_ASSETS_DIR,
  path.join(__dirname, 'public')
);
const restartLogLimit = 200;
const maxAttachments = 5;
const maxAttachmentSizeBytes = 500 * 1024 * 1024;
const maxAttachmentSizeMb = Math.floor(maxAttachmentSizeBytes / (1024 * 1024));
const configuredStorageLowSpaceWarningBytes = Number.parseInt(
  String(process.env.STORAGE_LOW_SPACE_WARNING_BYTES || String(2 * 1024 * 1024 * 1024)),
  10
);
const configuredStorageLowSpaceCriticalBytes = Number.parseInt(
  String(process.env.STORAGE_LOW_SPACE_CRITICAL_BYTES || String(1024 * 1024 * 1024)),
  10
);
const storageLowSpaceWarningBytes =
  Number.isInteger(configuredStorageLowSpaceWarningBytes) && configuredStorageLowSpaceWarningBytes > 0
    ? configuredStorageLowSpaceWarningBytes
    : 2 * 1024 * 1024 * 1024;
const storageLowSpaceCriticalBytes =
  Number.isInteger(configuredStorageLowSpaceCriticalBytes) && configuredStorageLowSpaceCriticalBytes > 0
    ? Math.min(configuredStorageLowSpaceCriticalBytes, storageLowSpaceWarningBytes - 64 * 1024 * 1024)
    : Math.min(1024 * 1024 * 1024, storageLowSpaceWarningBytes - 64 * 1024 * 1024);
const storageUploadHeadroomFactor = 0.12;
const storageUploadPerFileOverheadBytes = 12 * 1024 * 1024;
const storageUploadReserveBytes = 192 * 1024 * 1024;
const uploadChunkSizeBytes = 8 * 1024 * 1024;
const uploadChunkMaxBytes = 16 * 1024 * 1024;
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
const aiProviderModelCacheTtlMs = 1000 * 60;
const aiProviderQuotaCacheTtlMs = 1000 * 60;
const adminUsers = new Set(
  String(process.env.ADMIN_USERS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
adminUsers.add('admin');
const pendingUploadTtlMs = 1000 * 60 * 60;
const pendingUploads = new Map();
const pendingChunkUploadTtlMs = 1000 * 60 * 60;
const pendingChunkUploads = new Map();
let restartScheduled = false;
let restartState = null;
const codexQuotaStateByUser = new Map();
const aiProviderModelsCache = new Map();
const aiProviderQuotaCache = new Map();
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
const workspaceFileBlockedDirNames = new Set(['.git', '.codex_users', 'node_modules']);
const workspaceFileBlockedBaseNames = new Set([
  'app.db',
  'app.db-shm',
  'app.db-wal',
  '.env',
  '.npmrc',
  '.bashrc',
  '.bash_profile',
  '.zshrc'
]);
const workspaceFileBlockedExtensions = new Set(['.db', '.sqlite', '.sqlite3', '.pem', '.key']);
let repoContextIndexCache = null;
const taskSnapshotsRootDir = resolveConfiguredPath(
  process.env.TASK_SNAPSHOTS_DIR,
  path.join(__dirname, 'tmp', 'task-snapshots')
);
const configuredTaskSnapshotMaxFiles = Number.parseInt(String(process.env.TASK_SNAPSHOT_MAX_FILES || '1200'), 10);
const configuredTaskSnapshotMaxFileBytes = Number.parseInt(
  String(process.env.TASK_SNAPSHOT_MAX_FILE_BYTES || String(12 * 1024 * 1024)),
  10
);
const configuredTaskSnapshotMaxTotalBytes = Number.parseInt(
  String(process.env.TASK_SNAPSHOT_MAX_TOTAL_BYTES || String(96 * 1024 * 1024)),
  10
);
const configuredTaskSnapshotsRetentionMaxBytes = Number.parseInt(
  String(process.env.TASK_SNAPSHOTS_RETENTION_MAX_BYTES || String(768 * 1024 * 1024)),
  10
);
const configuredTaskSnapshotsRetentionMaxEntries = Number.parseInt(
  String(process.env.TASK_SNAPSHOTS_RETENTION_MAX_ENTRIES || '18'),
  10
);
const configuredTaskSnapshotsRetentionMaxAgeHours = Number.parseInt(
  String(process.env.TASK_SNAPSHOTS_RETENTION_MAX_AGE_HOURS || '36'),
  10
);
const configuredTaskSnapshotsPruneIntervalMinutes = Number.parseInt(
  String(process.env.TASK_SNAPSHOTS_PRUNE_INTERVAL_MINUTES || '30'),
  10
);
const taskSnapshotMaxFiles =
  Number.isInteger(configuredTaskSnapshotMaxFiles) && configuredTaskSnapshotMaxFiles >= 80
    ? Math.min(configuredTaskSnapshotMaxFiles, 15000)
    : 1200;
const taskSnapshotMaxFileBytes =
  Number.isInteger(configuredTaskSnapshotMaxFileBytes) && configuredTaskSnapshotMaxFileBytes > 0
    ? Math.min(configuredTaskSnapshotMaxFileBytes, 1024 * 1024 * 1024)
    : 12 * 1024 * 1024;
const taskSnapshotMaxTotalBytes =
  Number.isInteger(configuredTaskSnapshotMaxTotalBytes) && configuredTaskSnapshotMaxTotalBytes > 0
    ? Math.min(configuredTaskSnapshotMaxTotalBytes, 4 * 1024 * 1024 * 1024)
    : 96 * 1024 * 1024;
const taskSnapshotsRetentionMaxBytes =
  Number.isInteger(configuredTaskSnapshotsRetentionMaxBytes) && configuredTaskSnapshotsRetentionMaxBytes > 0
    ? Math.min(configuredTaskSnapshotsRetentionMaxBytes, 16 * 1024 * 1024 * 1024)
    : 768 * 1024 * 1024;
const taskSnapshotsRetentionMaxEntries =
  Number.isInteger(configuredTaskSnapshotsRetentionMaxEntries) && configuredTaskSnapshotsRetentionMaxEntries > 0
    ? Math.min(configuredTaskSnapshotsRetentionMaxEntries, 500)
    : 18;
const taskSnapshotsRetentionMaxAgeMs =
  Number.isInteger(configuredTaskSnapshotsRetentionMaxAgeHours) && configuredTaskSnapshotsRetentionMaxAgeHours > 0
    ? Math.min(configuredTaskSnapshotsRetentionMaxAgeHours, 24 * 30) * 60 * 60 * 1000
    : 36 * 60 * 60 * 1000;
const taskSnapshotsPruneIntervalMs =
  Number.isInteger(configuredTaskSnapshotsPruneIntervalMinutes) && configuredTaskSnapshotsPruneIntervalMinutes >= 5
    ? Math.min(configuredTaskSnapshotsPruneIntervalMinutes, 24 * 60) * 60 * 1000
    : 30 * 60 * 1000;
const taskSnapshotIgnoredRootDirs = new Set([
  '.git',
  '.runtime',
  '.codex_users',
  'node_modules',
  'uploads',
  'tmp',
  'dist',
  'build',
  'coverage',
  'test-results'
]);
let taskSnapshotPruneInFlight = false;
let taskSnapshotPruneScheduled = false;
let taskSnapshotPruneLastAtMs = 0;
const storageJobsRootDir = resolveConfiguredPath(
  process.env.STORAGE_JOBS_DIR,
  path.join(__dirname, 'tmp', 'storage-jobs')
);
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
const deployedAppsDescribeJobPollMaxItems = 200;
const storageJobPollMaxItems = 240;
const storageLocalListMaxItems = 500;
const storageHeavyScanMaxItems = 120;
const storageHeavyScanMaxDepth = 7;
const storageBackupRetentionDays = 4;
const storageBackupMaxSourceBytes = 8 * 1024 * 1024 * 1024;
const storageBackupReserveBytes = 512 * 1024 * 1024;
const storageUploadJobMaxFiles = 40;
const storageJobLogMaxChars = 12000;
const rcloneBinary = String(process.env.RCLONE_BIN || 'rclone').trim() || 'rclone';
const rcloneConfigPathDefault = String(process.env.RCLONE_CONFIG_PATH || '').trim();
const driveDefaultRemoteName = String(process.env.RCLONE_DRIVE_DEFAULT_REMOTE || '').trim();
const driveDefaultRootPath = String(process.env.RCLONE_DRIVE_DEFAULT_ROOT || 'CodexWeb').trim();
const configuredWireGuardInterface = normalizeWireGuardInterfaceName(process.env.WIREGUARD_INTERFACE);
const wireGuardDefaultInterface = configuredWireGuardInterface || 'wg0';
const wireGuardConfigDir = resolveConfiguredPath(process.env.WIREGUARD_CONFIG_DIR, '/etc/wireguard');
const wireGuardConfigPathDefault = resolveConfiguredPath(
  process.env.WIREGUARD_CONFIG_PATH,
  path.join(wireGuardConfigDir, `${wireGuardDefaultInterface}.conf`)
);
const wireGuardProfilesDir = resolveConfiguredPath(
  process.env.WIREGUARD_CLIENT_PROFILES_DIR,
  path.join(wireGuardConfigDir, 'codexweb-clients')
);
const wireGuardParamsPath = resolveConfiguredPath(
  process.env.WIREGUARD_PARAMS_PATH,
  path.join(wireGuardConfigDir, 'params')
);
const wireGuardPublicEndpointDefault = String(process.env.WIREGUARD_PUBLIC_ENDPOINT || '').trim();
const wireGuardAllowedIpsDefault = String(process.env.WIREGUARD_ALLOWED_IPS_DEFAULT || '0.0.0.0/0,::/0').trim() || '0.0.0.0/0,::/0';
const wireGuardClientDnsDefault = String(process.env.WIREGUARD_CLIENT_DNS_DEFAULT || '1.1.1.1,1.0.0.1').trim() || '1.1.1.1,1.0.0.1';
const configuredWireGuardKeepaliveDefault = Number.parseInt(
  String(process.env.WIREGUARD_KEEPALIVE_DEFAULT || '25'),
  10
);
const wireGuardKeepaliveDefault =
  Number.isInteger(configuredWireGuardKeepaliveDefault) && configuredWireGuardKeepaliveDefault >= 0
    ? Math.min(configuredWireGuardKeepaliveDefault, 120)
    : 25;
const configuredWireGuardActiveHandshakeWindow = Number.parseInt(
  String(process.env.WIREGUARD_ACTIVE_HANDSHAKE_WINDOW_SECONDS || '180'),
  10
);
const wireGuardActiveHandshakeWindowSeconds =
  Number.isInteger(configuredWireGuardActiveHandshakeWindow) && configuredWireGuardActiveHandshakeWindow > 0
    ? Math.min(configuredWireGuardActiveHandshakeWindow, 3600)
    : 180;
const wireGuardDiagnosticsMaxLogLines = 400;
const storageResidualScanMaxItems = 220;
const storageResidualScanMaxDepth = 5;
const storageResidualDeleteMaxItems = 80;
const storageResidualAiMaxCandidates = 80;
const storageResidualProgressTickMs = 700;
const storageResidualAiEtaBaseSeconds = 12;
const storageResidualAiEtaPerCandidateSeconds = 0.2;
const storageResidualAnalysisMaxAgeMs = 1000 * 60 * 60 * 24;
const projectContextManualMaxChars = 12000;
const projectContextAutoMaxChars = 12000;
const projectContextPromptMessagesLimit = 140;
const projectContextPromptMessageChars = 700;
const projectContextNameMaxChars = 90;
const projectContextModeOptions = new Set(['manual', 'automatic', 'mixed']);
const projectContextAutoRegenerateDebounceMs = 1800;
const storageProtectedMutationRoots = new Set([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/proc',
  '/run',
  '/sbin',
  '/sys',
  '/usr'
]);
const storageResidualScanRoots = resolveStorageCleanupScanRoots(
  process.env.STORAGE_RESIDUAL_SCAN_ROOTS,
  [
    path.join(__dirname, 'tmp'),
    storageJobsRootDir,
    uploadsDir,
    '/tmp',
    '/var/tmp'
  ]
);
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
const activeDeployedDescriptionWorkers = new Set();
const activeStorageJobWorkers = new Set();
const queuedProjectContextRefreshTimers = new Map();

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const defaultDbPath = fs.existsSync(path.join(__dirname, 'app.db')) ? 'app.db' : 'chat.db';
const dbPath = String(process.env.DB_PATH || defaultDbPath).trim() || defaultDbPath;
const dbAbsolutePath = path.isAbsolute(dbPath) ? path.resolve(dbPath) : path.resolve(__dirname, dbPath);
fs.mkdirSync(path.dirname(dbAbsolutePath), { recursive: true });
const db = new Database(dbAbsolutePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(pendingUploadsDir, { recursive: true });
fs.mkdirSync(codexUsersRootDir, { recursive: true, mode: 0o755 });
try {
  fs.chmodSync(codexUsersRootDir, 0o755);
} catch (_error) {
  // best effort
}
console.info(`Codex home root configurado en ${codexUsersRootDir}`);
fs.mkdirSync(taskSnapshotsRootDir, { recursive: true });
fs.mkdirSync(storageJobsRootDir, { recursive: true });
fs.mkdirSync(wireGuardProfilesDir, { recursive: true, mode: 0o700 });
try {
  fs.chmodSync(wireGuardProfilesDir, 0o700);
} catch (_error) {
  // best effort
}

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

function resolveCredentialsEncryptionKey() {
  const configured = String(process.env.CREDENTIALS_ENCRYPTION_KEY || '').trim();
  let source = configured;
  if (!source) {
    const uid = typeof process.getuid === 'function' ? String(process.getuid()) : '0';
    source = `${os.hostname()}:${dbAbsolutePath}:${uid}`;
  }
  if (/^[A-Za-z0-9+/=]+$/.test(source) && source.length >= 40) {
    try {
      const decoded = Buffer.from(source, 'base64');
      if (decoded.length >= 32) {
        return decoded.subarray(0, 32);
      }
    } catch (_error) {
      // fallback to SHA-256 below.
    }
  }
  return crypto.createHash('sha256').update(source, 'utf8').digest();
}

const credentialsEncryptionKey = resolveCredentialsEncryptionKey();

function encryptSecretText(rawValue) {
  const plain = String(rawValue || '');
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialsEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptSecretText(rawCipher) {
  const value = String(rawCipher || '').trim();
  if (!value) return '';
  const parts = value.split('.');
  if (parts.length !== 3) {
    throw new Error('cipher_text_invalid');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', credentialsEncryptionKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString('utf8');
}

function normalizeDriveAuthMode(rawMode) {
  const value = String(rawMode || '')
    .trim()
    .toLowerCase();
  if (value === 'rclone' || value === 'remote' || value === 'drive') return 'rclone';
  return 'rclone';
}

function normalizeDriveAccountStatus(rawStatus) {
  const value = String(rawStatus || '')
    .trim()
    .toLowerCase();
  if (value === 'active' || value === 'needs_oauth' || value === 'error' || value === 'pending') {
    return value;
  }
  return 'pending';
}

function normalizeStorageJobStatus(rawStatus) {
  const value = String(rawStatus || '')
    .trim()
    .toLowerCase();
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'error') {
    return value;
  }
  return 'pending';
}

function normalizeStorageJobType(rawType) {
  const value = String(rawType || '')
    .trim()
    .toLowerCase();
  if (
    value === 'drive_upload_files' ||
    value === 'deployed_backup_create' ||
    value === 'deployed_backup_restore' ||
    value === 'cleanup_residual_analyze' ||
    value === 'git_merge_branches' ||
    value === 'local_delete_paths' ||
    value === 'project_context_refresh'
  ) {
    return value;
  }
  return '';
}

function normalizeProjectContextMode(rawMode, fallback = 'mixed') {
  const mode = String(rawMode || '')
    .trim()
    .toLowerCase();
  if (projectContextModeOptions.has(mode)) {
    return mode;
  }
  const safeFallback = String(fallback || '')
    .trim()
    .toLowerCase();
  return projectContextModeOptions.has(safeFallback) ? safeFallback : 'mixed';
}

function sanitizeProjectName(rawName) {
  const compact = String(rawName || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  if (compact.length <= projectContextNameMaxChars) return compact;
  return compact.slice(0, projectContextNameMaxChars).trim();
}

function normalizeProjectContextText(rawValue, maxChars = projectContextManualMaxChars) {
  const value = String(rawValue || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!value) return '';
  const safeMax = Number.isInteger(Number(maxChars)) && Number(maxChars) > 0 ? Number(maxChars) : 4000;
  if (value.length <= safeMax) return value;
  return value.slice(0, safeMax).trimEnd();
}

function normalizeProjectAutoEnabled(rawValue, fallback = true) {
  if (typeof rawValue === 'boolean') return rawValue;
  if (rawValue === 1 || rawValue === '1') return true;
  if (rawValue === 0 || rawValue === '0') return false;
  if (typeof rawValue === 'string') {
    const lowered = rawValue.trim().toLowerCase();
    if (['true', 'yes', 'on', 'enabled'].includes(lowered)) return true;
    if (['false', 'no', 'off', 'disabled'].includes(lowered)) return false;
  }
  return Boolean(fallback);
}

function sanitizeDriveAccountAlias(rawAlias) {
  const compact = String(rawAlias || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length > 80 ? compact.slice(0, 80).trim() : compact;
}

function buildDriveAccountId() {
  return `drv_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function buildStorageJobId(prefix = 'job') {
  const safePrefix = String(prefix || 'job')
    .replace(/[^a-z0-9_-]+/gi, '')
    .slice(0, 20) || 'job';
  return `${safePrefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function appendStorageJobLogText(previousLog, message) {
  const line = String(message || '').trim();
  if (!line) return String(previousLog || '').slice(-storageJobLogMaxChars);
  const timestamp = nowIso();
  const next = `${String(previousLog || '').trim()}\n[${timestamp}] ${line}`.trim();
  if (next.length <= storageJobLogMaxChars) return next;
  return next.slice(next.length - storageJobLogMaxChars);
}

function normalizeAbsoluteStoragePath(rawPath, fallbackPath = repoRootDir) {
  const value = String(rawPath || '').trim();
  const fallback = typeof fallbackPath === 'string' ? fallbackPath.trim() : '';
  const target = value || fallback;
  if (!target) return '';
  if (!target || target.includes('\0')) return '';
  const expanded = target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : target;
  try {
    return path.resolve(expanded);
  } catch (_error) {
    return '';
  }
}

function pathExistsSyncSafe(absolutePath) {
  const target = String(absolutePath || '').trim();
  if (!target) return false;
  try {
    fs.accessSync(target, fs.constants.R_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function isPathWithin(basePath, candidatePath) {
  const base = normalizeAbsoluteStoragePath(basePath);
  const candidate = normalizeAbsoluteStoragePath(candidatePath);
  if (!base || !candidate) return false;
  if (base === candidate) return true;
  const rel = path.relative(base, candidate);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isStorageMutationPathProtected(absolutePath) {
  const target = normalizeAbsoluteStoragePath(absolutePath);
  if (!target) return true;
  if (storageProtectedMutationRoots.has(target)) return true;
  for (const root of storageProtectedMutationRoots) {
    if (root === '/' || !root) continue;
    if (isPathWithin(root, target)) return true;
  }
  if (isPathWithin(repoRootDir, target)) {
    const rel = normalizeRepoRelativePath(path.relative(repoRootDir, target).split(path.sep).join('/'));
    if (rel && !isWorkspaceFileDownloadAllowed(rel)) return true;
  }
  return false;
}

function assertStorageMutationPathAllowed(absolutePath) {
  const target = normalizeAbsoluteStoragePath(absolutePath);
  if (!target) {
    throw createClientRequestError('Ruta inválida', 400);
  }
  if (isStorageMutationPathProtected(target)) {
    throw createClientRequestError('Ruta bloqueada para acciones de escritura por seguridad', 403);
  }
  return target;
}

function resolveStorageDirectoryPathForRequest(rawPath) {
  const absolutePath = normalizeAbsoluteStoragePath(rawPath, repoRootDir);
  if (!absolutePath) {
    throw createClientRequestError('Ruta inválida', 400);
  }
  let stats = null;
  try {
    stats = fs.statSync(absolutePath);
  } catch (_error) {
    stats = null;
  }
  if (!stats || !stats.isDirectory()) {
    throw createClientRequestError('La ruta indicada no es un directorio accesible', 404);
  }
  return absolutePath;
}

function resolveStorageCleanupScanRoots(rawValue, fallback = []) {
  const requested = String(rawValue || '')
    .split(/[\r\n,]+/g)
    .map((entry) => normalizeAbsoluteStoragePath(entry, ''))
    .filter(Boolean);
  const source = requested.length > 0 ? requested : Array.isArray(fallback) ? fallback : [];
  const deduped = [];
  const seen = new Set();
  source.forEach((entry) => {
    const normalized = normalizeAbsoluteStoragePath(entry, '');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    if (isStorageMutationPathProtected(normalized) && !isPathWithin('/tmp', normalized) && !isPathWithin('/var/tmp', normalized)) {
      return;
    }
    deduped.push(normalized);
  });
  return deduped.slice(0, 20);
}

function isPathWithinAny(paths, targetPath) {
  const safeTarget = normalizeAbsoluteStoragePath(targetPath, '');
  if (!safeTarget) return false;
  const list = Array.isArray(paths) ? paths : [];
  return list.some((entry) => {
    const root = normalizeAbsoluteStoragePath(entry, '');
    if (!root) return false;
    return root === safeTarget || isPathWithin(root, safeTarget);
  });
}

function assertStorageCleanupPathAllowed(absolutePath) {
  const normalized = normalizeAbsoluteStoragePath(absolutePath, '');
  if (!normalized) {
    throw createClientRequestError('Ruta inválida para limpieza', 400);
  }
  if (!isPathWithinAny(storageResidualScanRoots, normalized)) {
    throw createClientRequestError('Ruta fuera de las raíces permitidas para limpieza', 403);
  }
  if (isStorageMutationPathProtected(normalized)) {
    throw createClientRequestError('Ruta protegida: no se permite borrar por limpieza', 403);
  }
  return normalized;
}

function normalizeStorageSortField(rawSort) {
  const value = String(rawSort || '')
    .trim()
    .toLowerCase();
  if (value === 'size' || value === 'mtime') return value;
  return 'name';
}

function normalizeStorageSortOrder(rawOrder) {
  return String(rawOrder || '')
    .trim()
    .toLowerCase() === 'asc'
    ? 'asc'
    : 'desc';
}

function getDirectorySizeWithDu(absolutePath) {
  const target = normalizeAbsoluteStoragePath(absolutePath);
  if (!target) return null;
  if (!commandExistsSync('du')) return null;
  const result = runSystemCommandSync('du', ['-sb', target], {
    allowNonZero: true,
    timeoutMs: 15000,
    maxBuffer: 1024 * 1024 * 2
  });
  if (!result || !result.ok) return null;
  const firstLine = String(result.stdout || '')
    .trim()
    .split('\n')
    .find((line) => line.trim());
  if (!firstLine) return null;
  const sizeRaw = Number.parseInt(firstLine.split(/\s+/)[0], 10);
  return Number.isFinite(sizeRaw) && sizeRaw >= 0 ? sizeRaw : null;
}

function estimateStoragePathBytes(absolutePath) {
  const target = normalizeAbsoluteStoragePath(absolutePath, '');
  if (!target || !pathExistsSyncSafe(target)) return null;
  let stats = null;
  try {
    stats = fs.statSync(target);
  } catch (_error) {
    stats = null;
  }
  if (!stats) return null;
  if (stats.isFile()) {
    return Number(stats.size || 0);
  }
  return getDirectorySizeWithDu(target);
}

function getDiskAvailableBytesForPath(absolutePath) {
  const target = normalizeAbsoluteStoragePath(absolutePath, storageJobsRootDir);
  if (!target) return null;
  const result = runSystemCommandSync('df', ['-B1', target], {
    allowNonZero: true,
    timeoutMs: 10000,
    maxBuffer: 1024 * 512
  });
  if (!result || !result.ok) return null;
  const rows = String(result.stdout || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.trim());
  if (rows.length < 2) return null;
  const cols = rows[1].trim().split(/\s+/);
  const available = Number.parseInt(String(cols[3] || ''), 10);
  return Number.isFinite(available) ? Math.max(0, available) : null;
}

function getDiskUsageSnapshotForPath(absolutePath) {
  const target = normalizeAbsoluteStoragePath(absolutePath, repoRootDir);
  if (!target) return null;
  const result = runSystemCommandSync('df', ['-B1', '-P', target], {
    allowNonZero: true,
    timeoutMs: 10000,
    maxBuffer: 1024 * 512
  });
  if (!result || Number(result.code) !== 0) return null;
  const rows = String(result.stdout || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.trim());
  if (rows.length < 2) return null;
  const cols = rows[1].trim().split(/\s+/);
  const totalBytes = Number.parseInt(String(cols[1] || ''), 10);
  const usedBytes = Number.parseInt(String(cols[2] || ''), 10);
  const availableBytes = Number.parseInt(String(cols[3] || ''), 10);
  const usedPercentText = String(cols[4] || '').trim().replace('%', '');
  const mountPoint = String(cols[5] || '').trim();
  const usagePercent = Number.parseFloat(usedPercentText);
  return {
    path: target,
    mountPoint,
    totalBytes: Number.isFinite(totalBytes) ? Math.max(0, totalBytes) : null,
    usedBytes: Number.isFinite(usedBytes) ? Math.max(0, usedBytes) : null,
    availableBytes: Number.isFinite(availableBytes) ? Math.max(0, availableBytes) : null,
    usagePercent: Number.isFinite(usagePercent) ? Number(usagePercent.toFixed(1)) : null
  };
}

function getStorageThresholds() {
  const warning = Math.max(256 * 1024 * 1024, Number(storageLowSpaceWarningBytes) || 0);
  const criticalCandidate = Number(storageLowSpaceCriticalBytes) || 0;
  const critical = Math.max(128 * 1024 * 1024, Math.min(criticalCandidate, warning - 64 * 1024 * 1024));
  return {
    warningFreeBytes: warning,
    criticalFreeBytes: critical
  };
}

function estimateAttachmentUploadRequiredBytes(payloadBytes, fileCount = 1) {
  const safeBytes = Math.max(0, Number(payloadBytes) || 0);
  const safeFileCount = Math.max(1, Number(fileCount) || 1);
  const variableHeadroom = Math.ceil(safeBytes * storageUploadHeadroomFactor);
  const perFileHeadroom = safeFileCount * storageUploadPerFileOverheadBytes;
  return safeBytes + variableHeadroom + perFileHeadroom + storageUploadReserveBytes;
}

function buildStorageHealthSnapshotForPath(absolutePath, options = {}) {
  const targetPath = normalizeAbsoluteStoragePath(absolutePath, uploadsDir) || uploadsDir;
  const snapshot = getDiskUsageSnapshotForPath(targetPath);
  const thresholds = getStorageThresholds();
  const availableBytes = Number(snapshot && snapshot.availableBytes);
  const usedPercent = Number(snapshot && snapshot.usagePercent);
  let status = 'ok';
  if (Number.isFinite(availableBytes)) {
    if (availableBytes <= thresholds.criticalFreeBytes) {
      status = 'critical';
    } else if (availableBytes <= thresholds.warningFreeBytes) {
      status = 'warning';
    }
  } else if (Number.isFinite(usedPercent)) {
    if (usedPercent >= 97) status = 'critical';
    else if (usedPercent >= 93) status = 'warning';
  }
  const requiredBytesRaw = Number(options.requiredBytes);
  const requiredBytes = Number.isFinite(requiredBytesRaw) ? Math.max(0, Math.ceil(requiredBytesRaw)) : null;
  const enoughForRequired =
    requiredBytes !== null && Number.isFinite(availableBytes) ? availableBytes >= requiredBytes : null;
  return {
    path: snapshot && snapshot.path ? snapshot.path : targetPath,
    mountPoint: snapshot && snapshot.mountPoint ? snapshot.mountPoint : '',
    totalBytes: snapshot ? snapshot.totalBytes : null,
    usedBytes: snapshot ? snapshot.usedBytes : null,
    availableBytes: snapshot ? snapshot.availableBytes : null,
    usedPercent: snapshot ? snapshot.usagePercent : null,
    status,
    thresholds,
    requiredBytes,
    enoughForRequired
  };
}

function buildStorageInsufficientMessage(health, operationLabel, requiredBytes) {
  const safeHealth = health && typeof health === 'object' ? health : {};
  const availableText = Number.isFinite(Number(safeHealth.availableBytes))
    ? `${Math.max(0, Number(safeHealth.availableBytes))} bytes`
    : 'desconocido';
  const requiredText = Number.isFinite(Number(requiredBytes))
    ? `${Math.max(0, Number(requiredBytes))} bytes`
    : 'desconocido';
  const operation = String(operationLabel || 'operación').trim() || 'operación';
  return `No hay espacio suficiente para ${operation}. Libre: ${availableText}. Requerido aprox: ${requiredText}. Libera espacio antes de continuar.`;
}

function assertStorageCapacityOrThrow(options = {}) {
  const targetPath = normalizeAbsoluteStoragePath(options.path, uploadsDir) || uploadsDir;
  const requiredBytes = Math.max(0, Math.ceil(Number(options.requiredBytes) || 0));
  const operationLabel = String(options.operationLabel || 'esta operación').trim() || 'esta operación';
  const health = buildStorageHealthSnapshotForPath(targetPath, {
    requiredBytes
  });
  const availableBytes = Number(health.availableBytes);
  if (requiredBytes > 0 && Number.isFinite(availableBytes) && availableBytes < requiredBytes) {
    const clientError = createClientRequestError(
      buildStorageInsufficientMessage(health, operationLabel, requiredBytes),
      507
    );
    clientError.code = 'INSUFFICIENT_STORAGE';
    clientError.storage = health;
    clientError.requiredBytes = requiredBytes;
    throw clientError;
  }
  return health;
}

function normalizeStorageSpaceError(error, fallbackMessage = 'No hay espacio suficiente en disco.') {
  const safeError = error && typeof error === 'object' ? error : null;
  const code = safeError && typeof safeError.code === 'string' ? String(safeError.code).toUpperCase() : '';
  if (code === 'ENOSPC' || code === 'EDQUOT') {
    const clientError = createClientRequestError(String(fallbackMessage || 'No hay espacio suficiente en disco.'), 507);
    clientError.code = 'INSUFFICIENT_STORAGE';
    clientError.originalCode = code;
    return clientError;
  }
  return error;
}

function listStorageLocalDirectory(payload = {}) {
  const directoryPath = resolveStorageDirectoryPathForRequest(payload.path);
  const sortBy = normalizeStorageSortField(payload.sortBy);
  const sortOrder = normalizeStorageSortOrder(payload.sortOrder);
  const includeDirSize = payload.includeDirSize !== false;
  const rawLimit = Number.parseInt(String(payload.limit || ''), 10);
  const limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), storageLocalListMaxItems)
    : 220;

  let entries = [];
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch (_error) {
    entries = [];
  }

  const mapped = entries.map((entry) => {
    const name = String(entry && entry.name ? entry.name : '').trim();
    const absolutePath = path.join(directoryPath, name);
    let stats = null;
    try {
      stats = fs.lstatSync(absolutePath);
    } catch (_error) {
      stats = null;
    }
    const isDir = Boolean(stats && stats.isDirectory());
    const isFile = Boolean(stats && stats.isFile());
    const isSymlink = Boolean(stats && stats.isSymbolicLink());
    return {
      name,
      path: absolutePath,
      type: isDir ? 'directory' : isFile ? 'file' : isSymlink ? 'symlink' : 'other',
      sizeBytes: isFile ? Number(stats.size || 0) : null,
      mtime: stats && stats.mtime ? stats.mtime.toISOString() : '',
      mtimeMs: stats && Number.isFinite(Number(stats.mtimeMs)) ? Number(stats.mtimeMs) : 0
    };
  });

  if (includeDirSize) {
    mapped
      .filter((entry) => entry.type === 'directory')
      .slice(0, 18)
      .forEach((entry) => {
        entry.sizeBytes = getDirectorySizeWithDu(entry.path);
      });
  }

  const compareValue = (entry) => {
    if (sortBy === 'size') return Number(entry.sizeBytes || 0);
    if (sortBy === 'mtime') return Number(entry.mtimeMs || 0);
    return String(entry.name || '').toLowerCase();
  };

  mapped.sort((a, b) => {
    const left = compareValue(a);
    const right = compareValue(b);
    if (left < right) return sortOrder === 'asc' ? -1 : 1;
    if (left > right) return sortOrder === 'asc' ? 1 : -1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const trimmed = mapped.slice(0, limit);
  const parentPath = directoryPath === path.parse(directoryPath).root ? '' : path.dirname(directoryPath);
  return {
    path: directoryPath,
    parentPath,
    sortBy,
    sortOrder,
    totalEntries: mapped.length,
    entries: trimmed.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      sizeBytes: Number.isFinite(Number(entry.sizeBytes)) ? Number(entry.sizeBytes) : null,
      modifiedAt: entry.mtime
    }))
  };
}

function scanStorageHeavyPaths(payload = {}) {
  const rootPath = resolveStorageDirectoryPathForRequest(payload.path);
  const rawLimit = Number.parseInt(String(payload.limit || ''), 10);
  const limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), storageHeavyScanMaxItems)
    : 36;
  const rawDepth = Number.parseInt(String(payload.maxDepth || ''), 10);
  const maxDepth = Number.isInteger(rawDepth)
    ? Math.min(Math.max(rawDepth, 1), storageHeavyScanMaxDepth)
    : 3;
  const entries = [];

  if (commandExistsSync('du')) {
    const args = ['-x', '-B1', '-d', String(maxDepth), rootPath];
    const result = runSystemCommandSync('du', args, {
      allowNonZero: true,
      timeoutMs: 1000 * 60 * 2,
      maxBuffer: 1024 * 1024 * 16
    });
    const rows = String(result.stdout || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    rows.forEach((line) => {
      const match = /^(\d+)\s+(.+)$/.exec(line);
      if (!match) return;
      const sizeBytes = Number.parseInt(match[1], 10);
      const absolutePath = normalizeAbsoluteStoragePath(match[2]);
      if (!absolutePath || !Number.isFinite(sizeBytes)) return;
      let isDirectory = false;
      try {
        isDirectory = fs.statSync(absolutePath).isDirectory();
      } catch (_error) {
        isDirectory = false;
      }
      entries.push({
        path: absolutePath,
        sizeBytes,
        type: isDirectory ? 'directory' : 'file'
      });
    });
  }

  if (entries.length === 0) {
    let queue = [{ absolutePath: rootPath, depth: 0 }];
    const visited = new Set();
    while (queue.length > 0 && entries.length < limit * 4) {
      const current = queue.shift();
      if (!current) continue;
      const absolutePath = current.absolutePath;
      if (!absolutePath || visited.has(absolutePath)) continue;
      visited.add(absolutePath);
      let stats = null;
      try {
        stats = fs.statSync(absolutePath);
      } catch (_error) {
        stats = null;
      }
      if (!stats) continue;
      if (stats.isFile()) {
        entries.push({
          path: absolutePath,
          sizeBytes: Number(stats.size || 0),
          type: 'file'
        });
        continue;
      }
      const dirSize = getDirectorySizeWithDu(absolutePath);
      entries.push({
        path: absolutePath,
        sizeBytes: Number.isFinite(Number(dirSize)) ? Number(dirSize) : 0,
        type: 'directory'
      });
      if (!stats.isDirectory() || current.depth >= maxDepth) continue;
      let children = [];
      try {
        children = fs.readdirSync(absolutePath, { withFileTypes: true });
      } catch (_error) {
        children = [];
      }
      children.forEach((entry) => {
        const name = String(entry && entry.name ? entry.name : '').trim();
        if (!name || name === '.' || name === '..') return;
        queue.push({
          absolutePath: path.join(absolutePath, name),
          depth: current.depth + 1
        });
      });
    }
  }

  entries.sort((a, b) => Number(b.sizeBytes || 0) - Number(a.sizeBytes || 0));
  const top = entries
    .filter((entry) => entry.path !== rootPath)
    .slice(0, limit)
    .map((entry) => ({
      path: entry.path,
      name: path.basename(entry.path),
      type: entry.type,
      sizeBytes: Number(entry.sizeBytes || 0)
    }));
  const totalBytes = top.reduce((sum, entry) => sum + Number(entry.sizeBytes || 0), 0);
  return {
    path: rootPath,
    scannedAt: nowIso(),
    maxDepth,
    limit,
    totalBytes,
    entries: top
  };
}

function normalizeResidualCandidateCategory(rawValue, fallback = 'residual') {
  const normalized = String(rawValue || '')
    .trim()
    .toLowerCase();
  if (normalized === 'temporary') return 'temporary';
  if (normalized === 'logs') return 'logs';
  if (normalized === 'cache') return 'cache';
  if (normalized === 'backup') return 'backup';
  if (normalized === 'artifact') return 'artifact';
  if (normalized === 'other') return 'other';
  if (normalized === 'residual') return 'residual';
  return String(fallback || 'residual').trim().toLowerCase() || 'residual';
}

function detectResidualCategory(entry) {
  const absolutePath = normalizeAbsoluteStoragePath(entry && entry.path ? entry.path : '', '');
  const lowerPath = String(absolutePath || '').toLowerCase();
  const baseName = path.basename(lowerPath || '');
  if (/\/(tmp|temp)\//i.test(lowerPath) || /(\.tmp|\.temp)$/i.test(baseName)) return 'temporary';
  if (/\/logs?\//i.test(lowerPath) || /\.log(\.\d+)?$/i.test(baseName)) return 'logs';
  if (/\/(cache|caches)\//i.test(lowerPath) || /(\.cache|cache\.)/i.test(baseName)) return 'cache';
  if (
    /\/(backup|backups|archives?|old)\//i.test(lowerPath) ||
    /(\.bak|\.old|\.orig|\.tar|\.tar\.gz|\.zip|\.7z|\.rar)$/i.test(baseName)
  ) {
    return 'backup';
  }
  if (
    (entry && entry.type === 'directory' && /(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.turbo)$/i.test(lowerPath)) ||
    /\.(dmp|dump)$/i.test(baseName)
  ) {
    return 'artifact';
  }
  return 'residual';
}

function summarizeResidualCandidates(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  const byCategory = {
    temporary: 0,
    logs: 0,
    cache: 0,
    backup: 0,
    artifact: 0,
    residual: 0,
    other: 0
  };
  let totalBytes = 0;
  list.forEach((entry) => {
    const category = normalizeResidualCandidateCategory(entry && entry.category ? entry.category : '');
    if (Object.prototype.hasOwnProperty.call(byCategory, category)) {
      byCategory[category] += 1;
    } else {
      byCategory.residual += 1;
    }
    totalBytes += Number(entry && entry.sizeBytes ? entry.sizeBytes : 0);
  });
  return {
    totalCandidates: list.length,
    totalBytes: Math.max(0, Math.round(totalBytes)),
    byCategory
  };
}

function buildResidualHeuristicForEntry(entry) {
  const absolutePath = normalizeAbsoluteStoragePath(entry.path, '');
  const baseName = path.basename(absolutePath || '').toLowerCase();
  const lowerPath = String(absolutePath || '').toLowerCase();
  const modifiedMs = Number(entry.modifiedMs || 0);
  const ageDays = modifiedMs > 0 ? Math.max(0, (Date.now() - modifiedMs) / (1000 * 60 * 60 * 24)) : 0;
  const sizeBytes = Number(entry.sizeBytes || 0);
  const category = detectResidualCategory(entry);
  const reasons = [];
  let score = 0;

  if (/(\.log|\.tmp|\.bak|\.old|\.cache|\.gz|\.tar|\.tar\.gz)$/i.test(baseName)) {
    score += 2;
    reasons.push('extensión típica de archivo residual');
  }
  if (/\/(tmp|temp|cache|caches|logs?|old|backup|archives?)\//i.test(lowerPath)) {
    score += 2;
    reasons.push('ubicación típica de residuales');
  }
  if (ageDays >= 7) {
    score += 1;
    reasons.push(`sin cambios recientes (${Math.round(ageDays)} días)`);
  }
  if (sizeBytes >= 250 * 1024 * 1024) {
    score += 2;
    reasons.push('muy grande (>250MB)');
  } else if (sizeBytes >= 50 * 1024 * 1024) {
    score += 1;
    reasons.push('grande (>50MB)');
  }
  if (entry.type === 'directory' && /cache|tmp|logs?|old|backup/i.test(baseName)) {
    score += 1;
    reasons.push('directorio candidato de limpieza');
  }
  if (entry.type === 'file' && baseName.startsWith('.')) {
    score += 1;
    reasons.push('archivo oculto potencialmente temporal');
  }
  if (category === 'temporary') {
    reasons.push('clasificado como temporal');
  } else if (category === 'logs') {
    reasons.push('clasificado como log');
  } else if (category === 'cache') {
    reasons.push('clasificado como caché');
  } else if (category === 'backup') {
    reasons.push('clasificado como backup/archivo antiguo');
  } else if (category === 'artifact') {
    reasons.push('clasificado como artefacto generado');
  }

  const risk = score >= 6 ? 'medium' : 'low';
  const confidence = score >= 6 ? 'high' : score >= 4 ? 'medium' : 'low';
  return {
    score,
    confidence,
    risk,
    category,
    reason: reasons.join(', ') || 'patrón residual detectado'
  };
}

function estimateResidualEtaSeconds(startedAtMs, percentValue) {
  const safeStart = Number.isFinite(Number(startedAtMs)) ? Number(startedAtMs) : 0;
  const percent = clampPercentage(percentValue);
  if (!safeStart || !Number.isFinite(percent) || percent <= 0 || percent >= 100) return null;
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - safeStart) / 1000));
  const estimatedTotalSeconds = elapsedSeconds / (Number(percent) / 100);
  const remainingSeconds = Math.ceil(estimatedTotalSeconds - elapsedSeconds);
  if (!Number.isFinite(remainingSeconds)) return null;
  return Math.max(1, remainingSeconds);
}

function scanStorageResidualCandidates(payload = {}, options = {}) {
  const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null;
  const rootsRequested = Array.isArray(payload.roots) ? payload.roots : [];
  const normalizedRootsRequested = rootsRequested
    .map((entry) => normalizeAbsoluteStoragePath(entry, ''))
    .filter(Boolean);
  const roots = normalizedRootsRequested.length > 0
    ? normalizedRootsRequested.filter((entry) => isPathWithinAny(storageResidualScanRoots, entry))
    : storageResidualScanRoots;
  const rawLimit = Number.parseInt(String(payload.limit || ''), 10);
  const limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), storageResidualScanMaxItems)
    : 80;
  const rawDepth = Number.parseInt(String(payload.maxDepth || ''), 10);
  const maxDepth = Number.isInteger(rawDepth)
    ? Math.min(Math.max(rawDepth, 1), storageResidualScanMaxDepth)
    : 3;
  const candidates = [];
  const queue = [];
  const visited = new Set();
  const startedAtMs = Date.now();
  let visitedCount = 0;
  let lastProgressAtMs = 0;
  const emitProgress = (force = false) => {
    if (!onProgress) return;
    const nowMs = Date.now();
    if (!force && nowMs - lastProgressAtMs < storageResidualProgressTickMs) {
      return;
    }
    lastProgressAtMs = nowMs;
    const processed = Math.max(visitedCount, 1);
    const totalEstimate = Math.max(processed + queue.length, processed);
    const scanPercent = Math.max(1, Math.min(88, Math.round((processed / totalEstimate) * 88)));
    onProgress({
      stage: 'scanning',
      stageLabel: 'Escaneando rutas residuales',
      processed,
      totalEstimate,
      queued: queue.length,
      candidates: candidates.length,
      percent: scanPercent,
      etaSeconds: estimateResidualEtaSeconds(startedAtMs, scanPercent)
    });
  };
  roots.forEach((root) => {
    const safeRoot = normalizeAbsoluteStoragePath(root, '');
    if (!safeRoot || visited.has(safeRoot)) return;
    queue.push({ path: safeRoot, depth: 0 });
  });
  emitProgress(true);

  while (queue.length > 0 && candidates.length < limit * 8) {
    const current = queue.shift();
    if (!current) continue;
    const absolutePath = normalizeAbsoluteStoragePath(current.path, '');
    if (!absolutePath || visited.has(absolutePath)) continue;
    visited.add(absolutePath);
    visitedCount += 1;
    if (!isPathWithinAny(storageResidualScanRoots, absolutePath)) continue;
    if (isStorageMutationPathProtected(absolutePath)) continue;
    let stats = null;
    try {
      stats = fs.lstatSync(absolutePath);
    } catch (_error) {
      stats = null;
    }
    if (!stats) continue;
    const isDirectory = stats.isDirectory();
    const isFile = stats.isFile();
    if (stats.isSymbolicLink()) continue;
    const entry = {
      path: absolutePath,
      type: isDirectory ? 'directory' : isFile ? 'file' : 'other',
      sizeBytes: isFile ? Number(stats.size || 0) : Number(getDirectorySizeWithDu(absolutePath) || 0),
      modifiedAt: stats.mtime ? stats.mtime.toISOString() : '',
      modifiedMs: Number(stats.mtimeMs || 0)
    };
    const heuristic = buildResidualHeuristicForEntry(entry);
    if (heuristic.score >= 3) {
      candidates.push({
        id: absolutePath,
        path: absolutePath,
        name: path.basename(absolutePath),
        type: entry.type,
        sizeBytes: entry.sizeBytes,
        modifiedAt: entry.modifiedAt,
        reason: heuristic.reason,
        confidence: heuristic.confidence,
        risk: heuristic.risk,
        category: heuristic.category,
        analysisSource: 'heuristic',
        score: heuristic.score
      });
    }
    if (!isDirectory || current.depth >= maxDepth) {
      emitProgress(false);
      continue;
    }
    let children = [];
    try {
      children = fs.readdirSync(absolutePath, { withFileTypes: true });
    } catch (_error) {
      children = [];
    }
    children.forEach((child) => {
      const name = String(child && child.name ? child.name : '').trim();
      if (!name || name === '.' || name === '..') return;
      queue.push({
        path: path.join(absolutePath, name),
        depth: current.depth + 1
      });
    });
    emitProgress(false);
  }
  emitProgress(true);

  const sorted = candidates
    .sort((a, b) => {
      if (Number(b.score || 0) !== Number(a.score || 0)) {
        return Number(b.score || 0) - Number(a.score || 0);
      }
      return Number(b.sizeBytes || 0) - Number(a.sizeBytes || 0);
    })
    .slice(0, limit);
  return {
    scannedAt: nowIso(),
    roots,
    maxDepth,
    limit,
    candidates: sorted
  };
}

function parseResidualAiPayload(rawText, candidatesByPath) {
  const source = String(rawText || '').trim();
  if (!source) return new Map();
  const cleaned = source
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const parseItemsFromCandidate = (candidateText) => {
    const parsed = parseRcloneJsonOutput(candidateText, null);
    if (!parsed || typeof parsed !== 'object') return [];
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.candidates)) return parsed.candidates;
    if (Array.isArray(parsed.files)) return parsed.files;
    return [];
  };
  const parseCandidates = [];
  parseCandidates.push(cleaned);
  const lines = cleaned
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (
      (line.startsWith('{') && line.endsWith('}')) ||
      (line.startsWith('[') && line.endsWith(']'))
    ) {
      parseCandidates.push(line);
    }
  }
  const itemsJsonMatches = cleaned.match(/\{"items":\[[\s\S]*?\]\}/g);
  if (Array.isArray(itemsJsonMatches)) {
    itemsJsonMatches.forEach((entry) => {
      parseCandidates.push(String(entry || '').trim());
    });
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    parseCandidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    parseCandidates.push(cleaned.slice(firstBracket, lastBracket + 1));
  }

  let items = [];
  for (let index = 0; index < parseCandidates.length; index += 1) {
    const candidateText = String(parseCandidates[index] || '').trim();
    if (!candidateText) continue;
    items = parseItemsFromCandidate(candidateText);
    if (items.length > 0) break;
  }
  const map = new Map();
  items.forEach((entry) => {
    const candidatePath = normalizeAbsoluteStoragePath(entry && entry.path ? entry.path : '', '');
    if (!candidatePath || !candidatesByPath.has(candidatePath)) return;
    const reason = truncateForNotify(entry && entry.reason ? entry.reason : '', 240);
    const confidenceRaw = String(entry && entry.confidence ? entry.confidence : '').trim().toLowerCase();
    const riskRaw = String(entry && entry.risk ? entry.risk : '').trim().toLowerCase();
    const categoryRaw = normalizeResidualCandidateCategory(entry && entry.category ? entry.category : '', '');
    const candidate = candidatesByPath.get(candidatePath);
    map.set(candidatePath, {
      reason: reason || 'clasificado por IA',
      confidence:
        confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
          ? confidenceRaw
          : 'medium',
      risk: riskRaw === 'high' || riskRaw === 'medium' || riskRaw === 'low' ? riskRaw : 'low',
      category: categoryRaw || normalizeResidualCandidateCategory(candidate && candidate.category ? candidate.category : '')
    });
  });
  return map;
}

function buildResidualAiClassificationPrompt(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const promptLines = [
    'Clasifica candidatos de limpieza de servidor.',
    'Devuelve SOLO JSON válido con esta forma:',
    '{"items":[{"path":"ABSOLUTE_PATH","reason":"texto corto","confidence":"high|medium|low","risk":"low|medium|high","category":"temporary|logs|cache|backup|artifact|residual"}]}',
    'No añadas texto adicional.',
    '',
    'CANDIDATOS:'
  ];
  list.forEach((entry, index) => {
    promptLines.push(
      `${index + 1}. path=${entry.path} | type=${entry.type} | size=${entry.sizeBytes} | modifiedAt=${entry.modifiedAt} | category_hint=${entry.category} | heuristic=${entry.reason}`
    );
  });
  return promptLines.join('\n');
}

function getResidualAiStageLabelForUser(userId) {
  const runtime = resolveChatAgentRuntimeForUser(userId);
  const providerId = normalizeSupportedAiAgentId(runtime && runtime.activeAgentId ? runtime.activeAgentId : '');
  const providerDef = getAiProviderDefinition(providerId);
  const providerName = String((providerDef && providerDef.name) || runtime.activeAgentName || 'IA').trim() || 'IA';
  return `Analizando residuos con ${providerName}`;
}

async function classifyResidualCandidatesWithAi(userId, username, candidates) {
  const list = Array.isArray(candidates) ? candidates.slice(0, storageResidualAiMaxCandidates) : [];
  if (list.length === 0) {
    return {
      used: false,
      reason: 'no_candidates',
      labels: new Map(),
      providerId: '',
      providerName: '',
      attemptedProviders: []
    };
  }

  const prompt = buildResidualAiClassificationPrompt(list);
  const candidateMap = new Map(list.map((entry) => [entry.path, entry]));
  const attemptedProviders = [];
  const runtime = resolveChatAgentRuntimeForUser(userId);
  const activeProviderId = normalizeSupportedAiAgentId(runtime && runtime.activeAgentId ? runtime.activeAgentId : '');
  const activeProviderDef = getAiProviderDefinition(activeProviderId);
  const activeProviderName =
    String((activeProviderDef && activeProviderDef.name) || runtime.activeAgentName || activeProviderId || '').trim();

  const tryHttpProvider = async (providerId, providerName) => {
    const adapter = getAiHttpProviderAdapter(providerId);
    if (!adapter || typeof adapter.buildChatRequest !== 'function') {
      return {
        used: false,
        reason: 'provider_not_http',
        labels: new Map(),
        providerId,
        providerName
      };
    }
    const integration = getUserAiAgentIntegration(userId, providerId);
    const configured = isAiAgentConfiguredForUser(
      providerId,
      integration,
      getAiAgentSerializationOptionsForUser(userId)
    );
    if (!configured) {
      return {
        used: false,
        reason: 'provider_not_configured',
        labels: new Map(),
        providerId,
        providerName
      };
    }
    const model = normalizeChatAgentModel(providerId, runtime.defaults.model || getChatAgentDefaultModel(providerId));
    const baseUrl = resolveAiProviderBaseUrl(providerId, integration) || adapter.defaultBaseUrl;
    const request = adapter.buildChatRequest({
      model,
      prompt,
      integration,
      baseUrl,
      reasoningEffort: runtime.defaults.reasoningEffort
    });
    const endpoint = String(request && request.endpoint ? request.endpoint : '').trim();
    if (!endpoint) {
      return {
        used: false,
        reason: 'provider_endpoint_missing',
        labels: new Map(),
        providerId,
        providerName
      };
    }
    const headers =
      request && request.headers && typeof request.headers === 'object'
        ? request.headers
        : { 'Content-Type': 'application/json' };
    const body =
      request && request.body && typeof request.body === 'object'
        ? { ...request.body, stream: false }
        : {
            model,
            stream: false,
            messages: [{ role: 'user', content: prompt }]
          };
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        let reason = '';
        try {
          reason = truncateForNotify(await response.text(), 220);
        } catch (_error) {
          reason = '';
        }
        return {
          used: false,
          reason: reason || `http_${response.status}`,
          labels: new Map(),
          providerId,
          providerName
        };
      }
      let output = '';
      try {
        const payload = await response.json();
        const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
        const messageObject = choice && choice.message && typeof choice.message === 'object' ? choice.message : {};
        output =
          extractTextFromProviderPayload(messageObject.content) ||
          extractTextFromProviderPayload(choice && choice.text ? choice.text : '') ||
          extractTextFromProviderPayload(payload && payload.response ? payload.response : '') ||
          extractTextFromProviderPayload(payload && payload.message ? payload.message : '');
      } catch (_jsonError) {
        try {
          output = String(await response.text()).trim();
        } catch (_textError) {
          output = '';
        }
      }
      const labels = parseResidualAiPayload(output, candidateMap);
      return {
        used: labels.size > 0,
        reason: labels.size > 0 ? '' : 'ai_parse_empty',
        labels,
        providerId,
        providerName
      };
    } catch (error) {
      return {
        used: false,
        reason: truncateForNotify(error && error.message ? error.message : 'provider_request_failed', 180),
        labels: new Map(),
        providerId,
        providerName
      };
    }
  };

  const tryCodexCli = async () => {
    let codexPath = '';
    try {
      codexPath = await resolveCodexPath();
    } catch (_error) {
      codexPath = '';
    }
    if (!codexPath) {
      return {
        used: false,
        reason: 'codex_unavailable',
        labels: new Map(),
        providerId: 'codex-cli',
        providerName: 'Codex CLI'
      };
    }
    try {
      const result = await execFileAsync(
        codexPath,
        [
          '-c',
          'shell_environment_policy.inherit=all',
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'danger-full-access',
          '--color',
          'never',
          prompt
        ],
        {
          env: getCodexEnvForUser(userId, { username }),
          cwd: process.cwd(),
          timeout: 1000 * 60,
          maxBuffer: 1024 * 1024 * 6
        }
      );
      const stdout = truncateRawText(stripAnsi(String(result && result.stdout ? result.stdout : '')).trim(), 80000);
      const stderr = truncateRawText(stripAnsi(String(result && result.stderr ? result.stderr : '')).trim(), 80000);
      const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
      const labels = parseResidualAiPayload(combined, candidateMap);
      return {
        used: labels.size > 0,
        reason: labels.size > 0 ? '' : 'ai_parse_empty',
        labels,
        providerId: 'codex-cli',
        providerName: 'Codex CLI'
      };
    } catch (error) {
      return {
        used: false,
        reason: truncateForNotify(error && error.message ? error.message : 'ai_failed', 160),
        labels: new Map(),
        providerId: 'codex-cli',
        providerName: 'Codex CLI'
      };
    }
  };

  if (activeProviderId && activeProviderId !== 'codex-cli') {
    attemptedProviders.push(activeProviderId);
    const activeAttempt = await tryHttpProvider(activeProviderId, activeProviderName || activeProviderId);
    if (activeAttempt.used) {
      return {
        ...activeAttempt,
        attemptedProviders
      };
    }
  }

  attemptedProviders.push('codex-cli');
  const codexAttempt = await tryCodexCli();
  if (codexAttempt.used) {
    return {
      ...codexAttempt,
      attemptedProviders
    };
  }

  return {
    used: false,
    reason: codexAttempt.reason || 'ai_unavailable',
    labels: new Map(),
    providerId: codexAttempt.providerId || '',
    providerName: codexAttempt.providerName || '',
    attemptedProviders
  };
}

async function analyzeStorageResidualFilesForUser(userId, username, payload = {}, options = {}) {
  const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null;
  const startedAtMs = Date.now();
  const scanned = scanStorageResidualCandidates(payload, {
    onProgress: (scanProgress) => {
      if (!onProgress) return;
      onProgress({
        stage: 'scanning',
        stageLabel: 'Escaneando rutas residuales',
        percent: Number(scanProgress && scanProgress.percent ? scanProgress.percent : 1),
        etaSeconds: scanProgress && scanProgress.etaSeconds ? scanProgress.etaSeconds : null,
        processed: Number(scanProgress && scanProgress.processed ? scanProgress.processed : 0),
        totalEstimate: Number(scanProgress && scanProgress.totalEstimate ? scanProgress.totalEstimate : 0),
        queued: Number(scanProgress && scanProgress.queued ? scanProgress.queued : 0),
        candidates: Number(scanProgress && scanProgress.candidates ? scanProgress.candidates : 0),
        startedAt: new Date(startedAtMs).toISOString()
      });
    }
  });
  const aiRequested = payload && payload.useAi !== false;
  let aiState = {
    used: false,
    reason: 'disabled',
    labels: new Map(),
    providerId: '',
    providerName: '',
    attemptedProviders: []
  };
  if (aiRequested) {
    if (onProgress) {
      const aiEtaSeconds = Math.max(
        3,
        Math.round(storageResidualAiEtaBaseSeconds + scanned.candidates.length * storageResidualAiEtaPerCandidateSeconds)
      );
      onProgress({
        stage: 'ai_classification',
        stageLabel: getResidualAiStageLabelForUser(userId),
        percent: 90,
        etaSeconds: aiEtaSeconds,
        processed: scanned.candidates.length,
        totalEstimate: scanned.candidates.length,
        queued: 0,
        candidates: scanned.candidates.length,
        startedAt: new Date(startedAtMs).toISOString()
      });
    }
    aiState = await classifyResidualCandidatesWithAi(userId, username, scanned.candidates);
  }
  const merged = scanned.candidates.map((entry) => {
    const aiLabel = aiState.labels.get(entry.path);
    if (!aiLabel) {
      return {
        ...entry,
        category: normalizeResidualCandidateCategory(entry.category, detectResidualCategory(entry)),
        analysisSource: 'heuristic'
      };
    }
    return {
      ...entry,
      reason: aiLabel.reason,
      confidence: aiLabel.confidence,
      risk: aiLabel.risk,
      category: normalizeResidualCandidateCategory(aiLabel.category, entry.category),
      analysisSource: 'ai'
    };
  });
  const summary = summarizeResidualCandidates(merged);
  const providerLabel = String(aiState.providerName || aiState.providerId || '').trim();
  const aiSummary = aiState.used
    ? `Análisis realizado con ${providerLabel || 'IA'}`
    : aiRequested
      ? `IA no disponible; fallback heurístico${aiState.reason ? ` (${aiState.reason})` : ''}`
      : 'Análisis heurístico (IA desactivada por configuración)';
  const result = {
    scannedAt: scanned.scannedAt,
    roots: scanned.roots,
    maxDepth: scanned.maxDepth,
    limit: scanned.limit,
    candidates: merged,
    ai: {
      requested: aiRequested,
      used: aiState.used,
      fallbackReason: aiState.reason,
      providerId: aiState.providerId || '',
      providerName: aiState.providerName || '',
      attemptedProviders: Array.isArray(aiState.attemptedProviders) ? aiState.attemptedProviders : []
    },
    summary: {
      ...summary,
      criteria: [
        'Patrones de nombre/extensión (tmp, log, bak, cache, archives)',
        'Ubicación típica de residuos (tmp/cache/logs/backups)',
        'Antigüedad y tamaño para priorizar impacto de limpieza'
      ],
      pipeline: aiSummary
    }
  };
  if (onProgress) {
    onProgress({
      stage: 'completed',
      stageLabel: 'Análisis completado',
      percent: 100,
      etaSeconds: 0,
      processed: merged.length,
      totalEstimate: merged.length,
      queued: 0,
      candidates: merged.length,
      startedAt: new Date(startedAtMs).toISOString()
    });
  }
  return result;
}

function deleteStorageResidualPaths(payload = {}) {
  const paths = parseStoragePathList(payload.paths, storageResidualDeleteMaxItems);
  const deleted = [];
  const deletedEntries = [];
  const failed = [];
  let freedBytes = 0;
  paths.forEach((entryPath) => {
    try {
      const target = assertStorageCleanupPathAllowed(entryPath);
      let stats = null;
      try {
        stats = fs.lstatSync(target);
      } catch (_error) {
        stats = null;
      }
      if (!stats) {
        failed.push({ path: target, error: 'no_existe' });
        return;
      }
      const targetType = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
      const sizeBytes = stats.isDirectory()
        ? Number(getDirectorySizeWithDu(target) || 0)
        : Number(stats.size || 0);
      if (targetType === 'directory') {
        fs.rmSync(target, { recursive: true, force: false });
      } else if (targetType === 'file') {
        fs.unlinkSync(target);
      } else {
        failed.push({ path: target, error: 'tipo_no_soportado' });
        return;
      }
      deleted.push(target);
      deletedEntries.push({
        path: target,
        name: path.basename(target),
        type: targetType,
        sizeBytes: Math.max(0, Math.round(sizeBytes)),
        category: detectResidualCategory({ path: target, type: targetType })
      });
      freedBytes += Math.max(0, Number(sizeBytes || 0));
    } catch (error) {
      failed.push({
        path: normalizeAbsoluteStoragePath(entryPath, ''),
        error: truncateForNotify(error && error.message ? error.message : 'delete_failed', 200)
      });
    }
  });
  return {
    requestedCount: paths.length,
    deleted,
    deletedEntries,
    failed,
    deletedCount: deleted.length,
    failedCount: failed.length,
    freedBytes: Math.max(0, Math.round(freedBytes))
  };
}

function resolveResidualAnalysisForDelete(userId, analysisJobId) {
  const safeUserId = getSafeUserId(userId);
  const safeAnalysisJobId = String(analysisJobId || '').trim();
  if (!safeUserId || !safeAnalysisJobId) {
    throw createClientRequestError(
      'Debes ejecutar y revisar un análisis antes de borrar. Falta analysisJobId.',
      400
    );
  }
  const row = getToolsBackgroundJobForUserStmt.get(safeAnalysisJobId, safeUserId);
  if (!row) {
    throw createClientRequestError('El análisis seleccionado no existe o no pertenece al usuario.', 404);
  }
  const type = normalizeStorageJobType(row.job_type);
  if (type !== 'cleanup_residual_analyze') {
    throw createClientRequestError('analysisJobId no corresponde a un análisis de limpieza IA.', 400);
  }
  const status = normalizeStorageJobStatus(row.status);
  if (status !== 'completed') {
    throw createClientRequestError('El análisis aún no terminó. Espera a que complete para borrar.', 409);
  }
  const scannedAt = String(row.finished_at || row.updated_at || row.created_at || '').trim();
  const scannedAtMs = Date.parse(scannedAt);
  if (Number.isFinite(scannedAtMs) && scannedAtMs > 0 && Date.now() - scannedAtMs > storageResidualAnalysisMaxAgeMs) {
    throw createClientRequestError(
      'El análisis seleccionado es demasiado antiguo. Ejecuta uno nuevo antes de borrar.',
      409
    );
  }
  const result = safeParseJsonObject(row.result_json);
  const candidateRows = Array.isArray(result && result.candidates) ? result.candidates : [];
  const candidatePaths = new Set(
    candidateRows
      .map((entry) => normalizeAbsoluteStoragePath(entry && entry.path ? entry.path : '', ''))
      .filter(Boolean)
  );
  return {
    analysisJobId: safeAnalysisJobId,
    scannedAt,
    candidatePaths,
    candidateCount: candidatePaths.size
  };
}

function parseStoragePathList(rawPaths, maxItems = storageUploadJobMaxFiles) {
  const values = Array.isArray(rawPaths) ? rawPaths : [];
  const unique = [];
  const seen = new Set();
  values.forEach((entry) => {
    const absolutePath = normalizeAbsoluteStoragePath(entry);
    if (!absolutePath || seen.has(absolutePath)) return;
    seen.add(absolutePath);
    unique.push(absolutePath);
  });
  return unique.slice(0, maxItems);
}

function sanitizeDriveFileName(rawName, fallbackName = 'archivo') {
  const compact = String(rawName || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback = String(fallbackName || 'archivo')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim() || 'archivo';
  if (!compact) return fallback;
  return compact.length > 120 ? compact.slice(0, 120).trim() : compact;
}

function buildAttachmentContentDisposition(rawName, fallbackName = 'archivo') {
  const normalizedName = sanitizeDriveFileName(rawName, fallbackName);
  const asciiName = normalizedName
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || sanitizeDriveFileName(fallbackName, 'archivo');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(normalizedName)}`;
}

function sanitizeDriveQueryLiteral(rawValue) {
  return String(rawValue || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function buildBackupFileName(appName, appId, createdAtIso) {
  const stamp = String(createdAtIso || nowIso()).replace(/[-:.TZ]/g, '').slice(0, 14);
  const safeName = sanitizeDriveFileName(appName || appId || 'app-backup', 'app-backup').replace(/\s+/g, '_');
  return `${safeName}_${stamp}.tar.gz`;
}

function parseIsoDateOrEmpty(rawValue) {
  if (rawValue === null || rawValue === undefined) return '';
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    const asMs = rawValue > 9999999999 ? rawValue : rawValue * 1000;
    const dt = new Date(asMs);
    return Number.isFinite(dt.getTime()) ? dt.toISOString() : '';
  }
  const text = String(rawValue || '').trim();
  if (!text) return '';
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    const asMs = numeric > 9999999999 ? numeric : numeric * 1000;
    const dt = new Date(asMs);
    return Number.isFinite(dt.getTime()) ? dt.toISOString() : '';
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString();
}

function normalizeDriveRemoteName(rawValue, fallback = '') {
  const source = String(rawValue || '').trim() || String(fallback || '').trim();
  const normalized = source
    .replace(/[^a-zA-Z0-9._-]+/g, '')
    .replace(/^\.+/, '')
    .trim();
  if (!normalized) return '';
  return normalized.slice(0, 80);
}

function normalizeDriveRemotePath(rawValue, fallback = '') {
  const source = String(rawValue || '').trim() || String(fallback || '').trim();
  if (!source || source === '/' || source === '.') return '';
  const compact = source
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .trim();
  if (!compact || compact === '.') return '';
  const normalized = path.posix.normalize(`/${compact}`).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('..')) return '';
  return normalized.slice(0, 400);
}

function joinDriveRemotePath(...segments) {
  const cleaned = segments
    .map((entry) => normalizeDriveRemotePath(entry))
    .filter(Boolean);
  if (cleaned.length === 0) return '';
  const normalized = path.posix.normalize(cleaned.join('/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.') return '';
  return normalized;
}

function buildDriveFileIdFromPath(relativePath = '') {
  const normalized = normalizeDriveRemotePath(relativePath);
  if (!normalized) return '/';
  return `/${normalized}`;
}

function parseDrivePathFromFileId(fileId = '') {
  return normalizeDriveRemotePath(fileId);
}

function resolveRcloneConfigPath(preferredConfigPath = '') {
  const fallback = path.join(os.homedir(), '.config', 'rclone', 'rclone.conf');
  const configured = String(preferredConfigPath || '').trim() || rcloneConfigPathDefault;
  return normalizeAbsoluteStoragePath(configured, fallback);
}

function buildRcloneTarget(remoteName, relativePath = '') {
  const safeRemote = normalizeDriveRemoteName(remoteName);
  if (!safeRemote) {
    throw createClientRequestError('Remote de rclone inválido.', 400);
  }
  const safePath = normalizeDriveRemotePath(relativePath);
  return safePath ? `${safeRemote}:${safePath}` : `${safeRemote}:`;
}

function ensureRcloneBinaryAvailable() {
  if (!commandExistsSync(rcloneBinary)) {
    throw createClientRequestError(
      `No se encontró rclone (${rcloneBinary}). Instálalo/configúralo en el entorno DEV.`,
      503
    );
  }
}

function runRcloneCommandSync(args, options = {}) {
  ensureRcloneBinaryAvailable();
  const safeArgs = Array.isArray(args) ? args.map((entry) => String(entry || '')) : [];
  const configPath = resolveRcloneConfigPath(options.configPath);
  const commandArgs = [];
  if (configPath) {
    commandArgs.push('--config', configPath);
  }
  if (options.transferTuning === true) {
    commandArgs.push('--checkers', '4', '--transfers', '2');
  }
  commandArgs.push(...safeArgs);
  const timeoutMs = Number.isInteger(Number(options.timeoutMs))
    ? Math.max(2000, Number(options.timeoutMs))
    : 1000 * 60 * 2;
  const maxBuffer = Number.isInteger(Number(options.maxBuffer))
    ? Math.max(1024 * 32, Number(options.maxBuffer))
    : 1024 * 1024 * 16;
  const commandResult = runSystemCommandSync(rcloneBinary, commandArgs, {
    // Always capture stdout/stderr and normalize success using exit code.
    allowNonZero: true,
    timeoutMs,
    maxBuffer
  });
  return {
    ...commandResult,
    ok: Number(commandResult.code) === 0,
    configPath
  };
}

function parseRcloneJsonOutput(rawText, fallback = null) {
  const text = String(rawText || '').trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
}

function listRcloneRemoteNames(configPath = '') {
  const result = runRcloneCommandSync(['listremotes'], {
    configPath,
    timeoutMs: 10000,
    maxBuffer: 1024 * 256
  });
  if (!result.ok) return [];
  return String(result.stdout || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((entry) => String(entry || '').trim().replace(/:$/, ''))
    .filter(Boolean);
}

function assertRcloneRemoteExists(remoteName, configPath = '') {
  const safeRemote = normalizeDriveRemoteName(remoteName);
  const remotes = listRcloneRemoteNames(configPath);
  if (!safeRemote || !remotes.includes(safeRemote)) {
    throw createClientRequestError(
      `El remote "${safeRemote || remoteName}" no existe en rclone config (${resolveRcloneConfigPath(configPath)}).`,
      400
    );
  }
}

function normalizeRcloneDriveScope(rawScope) {
  const value = String(rawScope || '').trim().toLowerCase();
  if (!value) return 'drive';
  if (
    value === 'drive' ||
    value === 'drive.readonly' ||
    value === 'drive.file' ||
    value === 'drive.appfolder' ||
    value === 'drive.metadata.readonly'
  ) {
    return value;
  }
  return 'drive';
}

function normalizeRcloneRemoteAuthMode(rawMode) {
  const value = String(rawMode || '')
    .trim()
    .toLowerCase();
  if (value === 'service_account' || value === 'service-account' || value === 'service') {
    return 'service_account';
  }
  if (value === 'oauth_token' || value === 'oauth' || value === 'token') {
    return 'oauth_token';
  }
  return 'none';
}

function normalizeRcloneTokenJson(rawValue) {
  const source = String(rawValue || '').trim();
  if (!source) return '';
  const parsed = parseRcloneJsonOutput(source, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createClientRequestError('tokenJson inválido. Debe ser un JSON de token OAuth válido.', 400);
  }
  return JSON.stringify(parsed);
}

function storeRcloneServiceAccountJson(userId, remoteName, rawJson) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    throw createClientRequestError('user_id inválido', 400);
  }
  const safeRemote = normalizeDriveRemoteName(remoteName);
  if (!safeRemote) {
    throw createClientRequestError('remoteName inválido', 400);
  }
  const source = String(rawJson || '').trim();
  if (!source) {
    throw createClientRequestError('Debes pegar el JSON de service account.', 400);
  }
  const parsed = parseRcloneJsonOutput(source, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createClientRequestError('serviceAccountJson inválido. Debe ser JSON.', 400);
  }
  const dir = path.join(storageJobsRootDir, 'rclone-service-accounts', `user_${safeUserId}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${safeRemote}.json`);
  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 });
  return filePath;
}

function getRcloneStatusPayload(configPath = '') {
  const resolvedConfig = resolveRcloneConfigPath(configPath);
  const configExists = pathExistsSyncSafe(resolvedConfig);
  const remotes = listRcloneRemoteNames(resolvedConfig);
  return {
    binary: rcloneBinary,
    configPath: resolvedConfig,
    configExists,
    remotes,
    defaultRemote: driveDefaultRemoteName || '',
    defaultRootPath: driveDefaultRootPath || ''
  };
}

function createOrUpdateRcloneDriveRemote(userId, payload = {}) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    throw createClientRequestError('user_id inválido', 400);
  }
  const remoteName = normalizeDriveRemoteName(payload.remoteName || payload.remote || payload.name || '');
  if (!remoteName) {
    throw createClientRequestError('Debes indicar remoteName.', 400);
  }
  const configPath = resolveRcloneConfigPath(payload.configPath || payload.rcloneConfigPath || '');
  const scope = normalizeRcloneDriveScope(payload.scope || payload.driveScope || 'drive');
  const rootFolderId = normalizeDriveRemotePath(payload.rootFolderId || payload.rootPath || '');
  const teamDrive = normalizeDriveRemotePath(payload.teamDrive || payload.teamDriveId || '');
  const clientId = String(payload.clientId || '').trim();
  const clientSecret = String(payload.clientSecret || '').trim();
  const authMode = normalizeRcloneRemoteAuthMode(payload.authMode || payload.credentialMode || payload.mode);
  const existingRemotes = listRcloneRemoteNames(configPath);
  const remoteAlreadyExists = existingRemotes.includes(remoteName);
  if (!remoteAlreadyExists && authMode === 'none') {
    throw createClientRequestError(
      'Para crear un remote nuevo desde CodexWeb debes usar authMode oauth_token o service_account.',
      400
    );
  }
  const args = remoteAlreadyExists
    ? ['config', 'update', remoteName, 'scope', scope]
    : ['config', 'create', remoteName, 'drive', 'scope', scope];
  if (clientId) {
    args.push('client_id', clientId);
  }
  if (clientSecret) {
    args.push('client_secret', clientSecret);
  }
  if (rootFolderId) {
    args.push('root_folder_id', rootFolderId);
  }
  if (teamDrive) {
    args.push('team_drive', teamDrive);
  }
  if (authMode === 'service_account') {
    const serviceAccountFile = storeRcloneServiceAccountJson(
      safeUserId,
      remoteName,
      payload.serviceAccountJson || payload.serviceAccountKey || ''
    );
    args.push('service_account_file', serviceAccountFile);
  } else if (authMode === 'oauth_token') {
    const tokenJson = normalizeRcloneTokenJson(payload.tokenJson || payload.oauthTokenJson || '');
    if (!tokenJson) {
      throw createClientRequestError('Debes indicar tokenJson para modo oauth_token.', 400);
    }
    args.push('token', tokenJson);
  }
  const result = runRcloneCommandSync(args, {
    configPath,
    timeoutMs: 1000 * 60,
    noCheckDest: false
  });
  if (Number(result.code) !== 0) {
    const reason = truncateForNotify(result.stderr || result.stdout || 'rclone_config_create_failed', 260);
    throw createClientRequestError(`No se pudo crear/actualizar el remote "${remoteName}": ${reason}`, 502);
  }
  assertRcloneRemoteExists(remoteName, configPath);
  const status = getRcloneStatusPayload(configPath);
  return {
    remoteName,
    configPath: status.configPath,
    authMode,
    scope,
    rootFolderId,
    teamDrive,
    remotes: status.remotes,
    existedBefore: remoteAlreadyExists
  };
}

function deleteRcloneRemote(remoteName, configPath = '') {
  const safeRemote = normalizeDriveRemoteName(remoteName);
  if (!safeRemote) {
    throw createClientRequestError('remoteName inválido', 400);
  }
  const resolvedConfigPath = resolveRcloneConfigPath(configPath);
  const result = runRcloneCommandSync(['config', 'delete', safeRemote], {
    configPath: resolvedConfigPath,
    timeoutMs: 15000
  });
  if (Number(result.code) !== 0) {
    const reason = truncateForNotify(result.stderr || result.stdout || 'rclone_config_delete_failed', 240);
    throw createClientRequestError(`No se pudo eliminar remote "${safeRemote}": ${reason}`, 502);
  }
  return {
    remoteName: safeRemote,
    ...getRcloneStatusPayload(resolvedConfigPath)
  };
}

function validateRcloneRemote(remoteName, configPath = '') {
  const safeRemote = normalizeDriveRemoteName(remoteName);
  if (!safeRemote) {
    throw createClientRequestError('remoteName inválido', 400);
  }
  const resolvedConfigPath = resolveRcloneConfigPath(configPath);
  assertRcloneRemoteExists(safeRemote, resolvedConfigPath);
  const result = runRcloneCommandSync(['about', `${safeRemote}:`, '--json'], {
    configPath: resolvedConfigPath,
    timeoutMs: 1000 * 60,
    noCheckDest: false
  });
  if (Number(result.code) !== 0) {
    const reason = truncateForNotify(result.stderr || result.stdout || 'rclone_remote_validate_failed', 260);
    throw createClientRequestError(`No se pudo validar remote "${safeRemote}": ${reason}`, 502);
  }
  const payload = parseRcloneJsonOutput(result.stdout, {});
  return {
    remoteName: safeRemote,
    configPath: resolvedConfigPath,
    about:
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {}
  };
}

function normalizeDriveCreateAccountPayload(rawValue) {
  const payload = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const remoteName = normalizeDriveRemoteName(
    payload.remoteName ||
      payload.remote ||
      payload.rcloneRemote ||
      payload.driveRemote ||
      driveDefaultRemoteName
  );
  if (!remoteName) {
    throw createClientRequestError(
      'Debes indicar el nombre del remote de rclone (ej: codexwebdev-gdrive).',
      400
    );
  }
  const configPath = resolveRcloneConfigPath(payload.configPath || payload.rcloneConfigPath || '');
  const rootPath = normalizeDriveRemotePath(
    payload.rootPath || payload.rootFolderId || payload.root_folder_id || driveDefaultRootPath
  );
  const normalized = {
    provider: 'rclone_drive',
    remote_name: remoteName,
    config_path: configPath,
    root_path: rootPath
  };
  const details = {
    credentialType: 'rclone_remote',
    provider: 'rclone',
    remoteName,
    configPath,
    rootPath,
    docs: [
      'https://rclone.org/drive/',
      'https://rclone.org/commands/rclone_config/',
      'https://developers.google.com/drive/api/guides/api-specific-auth'
    ]
  };
  return {
    authMode: 'rclone',
    normalized,
    details
  };
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

function isDirectoryEmptySync(targetPath) {
  try {
    return fs.readdirSync(targetPath).length === 0;
  } catch (_error) {
    return true;
  }
}

function ensureDirectoryWithMode(targetPath, mode) {
  fs.mkdirSync(targetPath, { recursive: true, mode });
  try {
    fs.chmodSync(targetPath, mode);
  } catch (_error) {
    // best effort
  }
}

function copyCodexHomeSeedEntry(sourcePath, targetPath) {
  if (!pathExistsSyncSafe(sourcePath) || pathExistsSyncSafe(targetPath)) {
    return false;
  }
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: false,
    errorOnExist: false
  });
  return true;
}

function migrateLegacyCodexHomeIfNeeded(safeUserId, targetPath) {
  if (legacyCodexUsersRootDir === codexUsersRootDir) {
    return false;
  }
  const legacyPath = path.join(legacyCodexUsersRootDir, `user_${safeUserId}`);
  if (!pathExistsSyncSafe(legacyPath)) {
    return false;
  }
  if (isDirectoryEmptySync(targetPath)) {
    fs.cpSync(legacyPath, targetPath, {
      recursive: true,
      force: false,
      errorOnExist: false
    });
    return true;
  }
  let copied = false;
  copied = copyCodexHomeSeedEntry(path.join(legacyPath, 'auth.json'), path.join(targetPath, 'auth.json')) || copied;
  copied =
    copyCodexHomeSeedEntry(path.join(legacyPath, 'models_cache.json'), path.join(targetPath, 'models_cache.json')) ||
    copied;
  copied = copyCodexHomeSeedEntry(path.join(legacyPath, 'sessions'), path.join(targetPath, 'sessions')) || copied;
  copied = copyCodexHomeSeedEntry(path.join(legacyPath, 'tmp'), path.join(targetPath, 'tmp')) || copied;
  return copied;
}

function chownRecursiveSync(targetPath, uid, gid) {
  if (!Number.isInteger(uid) || uid < 0 || !Number.isInteger(gid) || gid < 0) {
    return;
  }
  const pending = [targetPath];
  while (pending.length > 0) {
    const currentPath = pending.pop();
    let stats = null;
    try {
      stats = fs.lstatSync(currentPath);
    } catch (_error) {
      continue;
    }
    if (stats.isSymbolicLink()) {
      continue;
    }
    if (stats.uid !== uid || stats.gid !== gid) {
      fs.chownSync(currentPath, uid, gid);
    }
    if (!stats.isDirectory()) {
      continue;
    }
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    entries.forEach((entry) => {
      pending.push(path.join(currentPath, entry.name));
    });
  }
}

function ensureCodexHome(userId, options = {}) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    throw new Error('INVALID_USER_ID');
  }
  ensureDirectoryWithMode(codexUsersRootDir, 0o755);
  const target = path.join(codexUsersRootDir, `user_${safeUserId}`);
  ensureDirectoryWithMode(target, 0o700);
  ensureDirectoryWithMode(path.join(target, 'sessions'), 0o700);
  ensureDirectoryWithMode(path.join(target, 'tmp'), 0o700);
  ensureDirectoryWithMode(path.join(target, '.cache'), 0o700);
  const migrated = migrateLegacyCodexHomeIfNeeded(safeUserId, target);
  const ownerUid = Number(options.ownerUid);
  const ownerGid = Number(options.ownerGid);
  if (Number.isInteger(ownerUid) && ownerUid >= 0 && Number.isInteger(ownerGid) && ownerGid >= 0) {
    chownRecursiveSync(target, ownerUid, ownerGid);
  }
  if (migrated) {
    console.info(`Codex home migrado a ${target} para user_${safeUserId}`);
  }
  return target;
}

function getUserCodexHome(userId, options = {}) {
  try {
    return ensureCodexHome(userId, options);
  } catch (error) {
    const reason = error && error.message ? error.message : 'codex_home_error';
    throw new Error(`CODEX_HOME_PREP_FAILED: ${reason}`);
  }
}

function getUserCodexSessionsDir(userId, options = {}) {
  return path.join(getUserCodexHome(userId, options), 'sessions');
}

function getCodexEnvForUser(userId, options = {}) {
  const username =
    options && typeof options.username === 'string'
      ? options.username
      : '';
  const gitIdentity = buildGitIdentityFromUsername(username);
  const codexHome = getUserCodexHome(userId, options);
  return {
    ...process.env,
    CODEX_HOME: codexHome,
    HOME: codexHome,
    XDG_CACHE_HOME: path.join(codexHome, '.cache'),
    TMPDIR: path.join(codexHome, 'tmp'),
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

  const primaryQuota = normalized.primary ? {
    used: normalized.primary.usedPercent,
    limit: 100, // Representing 100% of the window
    remaining: normalized.primary.remainingPercent,
    unit: "percent_of_window",
    windowMinutes: normalized.primary.windowMinutes,
    resetAt: normalized.primary.resetAt
  } : null;

  const secondaryQuota = normalized.secondary ? {
    used: normalized.secondary.usedPercent,
    limit: 100,
    remaining: normalized.secondary.remainingPercent,
    unit: "percent_of_window",
    windowMinutes: normalized.secondary.windowMinutes,
    resetAt: normalized.secondary.resetAt
  } : null;

  const creditsQuota = normalized.credits ? {
    remaining: normalized.credits.balance,
    unit: "credits",
    hasCredits: normalized.credits.hasCredits,
    unlimited: normalized.credits.unlimited
  } : null;

  return {
    source: String(source || 'unknown'),
    observedAt: observedAtValue,
    fetchedAt: nowIso(),
    limitId: normalized.limitId,
    planType: normalized.planType,
    primary: primaryQuota,
    secondary: secondaryQuota,
    credits: creditsQuota,
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

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripOptionalFilePositionSuffix(filePath) {
  const source = String(filePath || '').trim();
  if (!source) return '';
  const noFragment = source.split('#')[0];
  const match = /^(.*):(\d+)(?::(\d+))?$/.exec(noFragment);
  if (!match) return noFragment;
  const basePath = String(match[1] || '').trim();
  if (!basePath || !basePath.startsWith('/')) return noFragment;
  return basePath;
}

function resolveWorkspaceFileCandidate(rawPath) {
  const source = String(rawPath || '')
    .replace(/\\/g, '/')
    .trim();
  if (!source || source.includes('\0')) return '';
  if (source.startsWith('/')) {
    return path.resolve(source);
  }
  return resolveRepoPathFromRelative(source);
}

function isWorkspaceFileDownloadAllowed(relativePath) {
  const normalized = normalizeRepoRelativePath(relativePath).toLowerCase();
  if (!normalized) return false;
  if (normalized === 'uploads' || normalized.startsWith('uploads/')) return false;
  if (normalized === 'tmp/task-snapshots' || normalized.startsWith('tmp/task-snapshots/')) return false;

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!segment) continue;
    if (workspaceFileBlockedDirNames.has(segment)) return false;
    if (segment.startsWith('.') && segment !== '.github') return false;
  }

  const baseName = segments[segments.length - 1];
  if (!baseName || baseName.startsWith('.')) return false;
  if (workspaceFileBlockedBaseNames.has(baseName)) return false;
  if (baseName.startsWith('.env')) return false;
  const ext = path.posix.extname(baseName);
  if (workspaceFileBlockedExtensions.has(ext)) return false;
  return true;
}

function resolveWorkspaceFileForRequest(rawPath) {
  const source = String(rawPath || '')
    .replace(/\\/g, '/')
    .trim();
  if (!source) {
    return { errorStatus: 400, error: 'path inválido' };
  }

  const candidates = [source];
  const stripped = stripOptionalFilePositionSuffix(source);
  if (stripped && stripped !== source) {
    candidates.push(stripped);
  }

  let sawPathInsideRepo = false;
  for (const candidate of candidates) {
    const absolutePath = resolveWorkspaceFileCandidate(candidate);
    if (!absolutePath) continue;

    const rel = path.relative(repoRootDir, absolutePath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      continue;
    }

    const normalizedRel = normalizeRepoRelativePath(rel.split(path.sep).join('/'));
    if (!normalizedRel) continue;
    sawPathInsideRepo = true;

    if (!isWorkspaceFileDownloadAllowed(normalizedRel)) {
      return { errorStatus: 403, error: 'Ruta de archivo bloqueada por seguridad' };
    }

    let stats = null;
    try {
      stats = fs.statSync(absolutePath);
    } catch (_error) {
      stats = null;
    }
    if (!stats || !stats.isFile()) {
      continue;
    }

    return {
      filePath: absolutePath,
      fileName: path.basename(absolutePath)
    };
  }

  if (!sawPathInsideRepo) {
    return { errorStatus: 400, error: 'Ruta fuera del workspace' };
  }
  return { errorStatus: 404, error: 'Archivo no encontrado' };
}

function serveWorkspaceFile(rawPath, res) {
  const resolved = resolveWorkspaceFileForRequest(rawPath);
  if (resolved.errorStatus) {
    return res.status(resolved.errorStatus).json({ error: resolved.error });
  }
  res.type(inferMimeTypeFromFilename(resolved.fileName));
  return res.sendFile(resolved.filePath);
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

function ensureGitBranchForRepo(repoPath, branchName, options = {}) {
  const safeRepoPath = String(repoPath || '').trim() || repoRootDir;
  const requestedBranch = normalizeGitBranchName(branchName);
  if (!requestedBranch) {
    return {
      ok: false,
      error: 'branch_invalid',
      branch: ''
    };
  }
  const createIfMissing = Boolean(options && options.createIfMissing);
  let remoteBranchRef = resolveGitRemoteBranchRef(safeRepoPath, requestedBranch);
  let localBranchName = remoteBranchRef ? remoteBranchRef.branch : requestedBranch;
  let exists = gitBranchExists(safeRepoPath, localBranchName);
  let remoteExists = remoteBranchRef
    ? gitRemoteBranchExists(safeRepoPath, remoteBranchRef.remote, remoteBranchRef.branch)
    : false;
  let defaultRemoteExists = gitRemoteBranchExists(safeRepoPath, 'origin', requestedBranch);
  let fetchErrors = [];
  if (!exists && !remoteExists && !defaultRemoteExists) {
    const preferredRemote = remoteBranchRef ? remoteBranchRef.remote : 'origin';
    const refreshResult = refreshGitRemoteRefs(safeRepoPath, preferredRemote);
    fetchErrors = Array.isArray(refreshResult.errors) ? refreshResult.errors : [];
    if (refreshResult.fetched) {
      remoteBranchRef = resolveGitRemoteBranchRef(safeRepoPath, requestedBranch);
      localBranchName = remoteBranchRef ? remoteBranchRef.branch : requestedBranch;
      exists = gitBranchExists(safeRepoPath, localBranchName);
      remoteExists = remoteBranchRef
        ? gitRemoteBranchExists(safeRepoPath, remoteBranchRef.remote, remoteBranchRef.branch)
        : false;
      defaultRemoteExists = gitRemoteBranchExists(safeRepoPath, 'origin', requestedBranch);
    }
  }
  const checkoutArgs =
    exists
      ? ['checkout', localBranchName]
      : remoteExists
        ? ['checkout', '-b', localBranchName, '--track', `${remoteBranchRef.remote}/${remoteBranchRef.branch}`]
        : !remoteBranchRef && defaultRemoteExists
          ? ['checkout', '-b', requestedBranch, '--track', `origin/${requestedBranch}`]
          : ['checkout', '-b', localBranchName];
  if (!exists && !remoteExists && !defaultRemoteExists && !createIfMissing) {
    const fetchNote = fetchErrors.length > 0 ? ` · fetch: ${fetchErrors.join(' | ')}` : '';
    return {
      ok: false,
      error: `La rama no existe (local/remota): ${requestedBranch}${fetchNote}`,
      branch: localBranchName
    };
  }
  if (!exists && (remoteExists || defaultRemoteExists) && createIfMissing) {
    // Si existe rama remota, priorizamos tracking sobre crear rama huérfana.
  }
  const checkoutResult = runGitInRepoSync(safeRepoPath, checkoutArgs, {
    allowNonZero: true
  });
  if (Number(checkoutResult.code) !== 0) {
    return {
      ok: false,
      error: normalizeGitCheckoutError(
        checkoutResult.stderr || checkoutResult.stdout || 'git_checkout_failed',
        requestedBranch
      ),
      branch: localBranchName
    };
  }
  const activeBranch = resolveCurrentGitBranchName(safeRepoPath) || localBranchName;
  return {
    ok: true,
    branch: activeBranch,
    created: !exists,
    output: String(checkoutResult.stdout || checkoutResult.stderr || '')
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

function normalizeWireGuardInterfaceName(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (!/^[A-Za-z0-9_.=-]{1,32}$/.test(value)) return '';
  return value;
}

function normalizeWireGuardPeerName(rawValue) {
  return String(rawValue || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeWireGuardAllowedIps(rawValue, fallbackValue = wireGuardAllowedIpsDefault) {
  const source = String(rawValue || fallbackValue || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 12);
  if (source.length === 0) {
    return wireGuardAllowedIpsDefault;
  }
  return source.join(',');
}

function normalizeWireGuardDns(rawValue, fallbackValue = wireGuardClientDnsDefault) {
  const source = String(rawValue || fallbackValue || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 4);
  if (source.length === 0) {
    return wireGuardClientDnsDefault;
  }
  return source.join(',');
}

function normalizeWireGuardKeepalive(rawValue, fallbackValue = wireGuardKeepaliveDefault) {
  const parsed = Number.parseInt(String(rawValue || ''), 10);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return Math.min(parsed, 120);
  }
  const fallback = Number.parseInt(String(fallbackValue || ''), 10);
  if (Number.isInteger(fallback) && fallback >= 0) {
    return Math.min(fallback, 120);
  }
  return wireGuardKeepaliveDefault;
}

function buildWireGuardPeerIdFromPublicKey(publicKey) {
  const safe = String(publicKey || '').trim();
  if (!safe) return '';
  const hash = crypto.createHash('sha1').update(safe, 'utf8').digest('hex');
  return `wgp_${hash.slice(0, 16)}`;
}

function parseWireGuardKeyValue(line) {
  const source = String(line || '');
  const idx = source.indexOf('=');
  if (idx <= 0) return null;
  const key = String(source.slice(0, idx) || '').trim();
  if (!key) return null;
  return {
    key,
    keyLower: key.toLowerCase(),
    value: String(source.slice(idx + 1) || '').trim()
  };
}

function parseWireGuardPeerBlock(lines) {
  const peer = {
    lines: Array.isArray(lines) ? lines.slice() : [],
    publicKey: '',
    allowedIps: '',
    presharedKey: '',
    endpoint: '',
    persistentKeepalive: '',
    name: '',
    createdAt: ''
  };
  peer.lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('# codexweb-name:')) {
      peer.name = normalizeWireGuardPeerName(trimmed.slice(trimmed.indexOf(':') + 1));
      return;
    }
    if (lower.startsWith('# codexweb-created-at:')) {
      peer.createdAt = String(trimmed.slice(trimmed.indexOf(':') + 1) || '').trim();
      return;
    }
    if (trimmed.startsWith('#')) return;
    const kv = parseWireGuardKeyValue(trimmed);
    if (!kv) return;
    if (kv.keyLower === 'publickey') peer.publicKey = kv.value;
    if (kv.keyLower === 'allowedips') peer.allowedIps = kv.value;
    if (kv.keyLower === 'presharedkey') peer.presharedKey = kv.value;
    if (kv.keyLower === 'endpoint') peer.endpoint = kv.value;
    if (kv.keyLower === 'persistentkeepalive') peer.persistentKeepalive = kv.value;
  });
  return peer;
}

function parseWireGuardConfigText(rawText) {
  const normalized = String(rawText || '').replace(/\r/g, '');
  const lines = normalized.split('\n');
  const interfaceLines = [];
  const peers = [];
  let currentPeerLines = null;
  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (/^\[peer\]$/i.test(trimmed)) {
      if (currentPeerLines && currentPeerLines.length > 0) {
        const parsedPeer = parseWireGuardPeerBlock(currentPeerLines);
        if (parsedPeer.publicKey) {
          peers.push(parsedPeer);
        }
      }
      currentPeerLines = ['[Peer]'];
      return;
    }
    if (currentPeerLines) {
      currentPeerLines.push(line);
      return;
    }
    interfaceLines.push(line);
  });
  if (currentPeerLines && currentPeerLines.length > 0) {
    const parsedPeer = parseWireGuardPeerBlock(currentPeerLines);
    if (parsedPeer.publicKey) {
      peers.push(parsedPeer);
    }
  }

  const interfaceData = {
    address: '',
    listenPort: '',
    dns: '',
    postUp: '',
    postDown: '',
    hasPrivateKey: false
  };
  interfaceLines.forEach((line) => {
    const kv = parseWireGuardKeyValue(line);
    if (!kv) return;
    if (kv.keyLower === 'address') interfaceData.address = kv.value;
    if (kv.keyLower === 'listenport') interfaceData.listenPort = kv.value;
    if (kv.keyLower === 'dns') interfaceData.dns = kv.value;
    if (kv.keyLower === 'postup') interfaceData.postUp = kv.value;
    if (kv.keyLower === 'postdown') interfaceData.postDown = kv.value;
    if (kv.keyLower === 'privatekey') interfaceData.hasPrivateKey = Boolean(kv.value);
  });

  return {
    interfaceLines,
    peers,
    interfaceData
  };
}

function renderWireGuardConfig(parsedConfig) {
  const source = parsedConfig && typeof parsedConfig === 'object' ? parsedConfig : {};
  const interfaceLines = Array.isArray(source.interfaceLines) ? source.interfaceLines.slice() : [];
  if (!interfaceLines.some((line) => /^\s*\[interface\]\s*$/i.test(String(line || '')))) {
    interfaceLines.unshift('[Interface]');
  }
  const peerBlocks = Array.isArray(source.peers) ? source.peers : [];
  const sections = [interfaceLines.join('\n').trimEnd()].filter(Boolean);
  peerBlocks.forEach((peer) => {
    if (!peer || !Array.isArray(peer.lines) || peer.lines.length === 0) return;
    sections.push(peer.lines.join('\n').trimEnd());
  });
  return `${sections.filter(Boolean).join('\n\n').trimEnd()}\n`;
}

function writeWireGuardConfig(runtime, parsedConfig) {
  const safeRuntime = runtime && typeof runtime === 'object' ? runtime : {};
  const configPath = String(safeRuntime.configPath || '').trim();
  if (!configPath) {
    throw createClientRequestError('Ruta de configuración WireGuard inválida.', 400);
  }
  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true });
  const nextText = renderWireGuardConfig(parsedConfig);
  const backupPath = `${configPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, backupPath);
  }
  const tmpPath = `${configPath}.tmp.${Date.now()}.${Math.random().toString(16).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmpPath, nextText, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, configPath);
    fs.chmodSync(configPath, 0o600);
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (_cleanupError) {
      // ignore temp cleanup failures.
    }
    throw error;
  }
  return {
    backupPath
  };
}

function listWireGuardInterfacesFromConfigDir() {
  try {
    const entries = fs.readdirSync(wireGuardConfigDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry && entry.isFile())
      .map((entry) => String(entry.name || '').trim())
      .filter((name) => name.endsWith('.conf'))
      .filter((name) => !name.includes('.bak.') && !name.includes('.broken.'))
      .map((name) => normalizeWireGuardInterfaceName(name.slice(0, -5)))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch (_error) {
    return [];
  }
}

function resolveWireGuardRuntime(rawInterface = '') {
  const requested = normalizeWireGuardInterfaceName(rawInterface);
  const discovered = listWireGuardInterfacesFromConfigDir();
  let interfaceName = requested || wireGuardDefaultInterface;
  if (discovered.length > 0 && !discovered.includes(interfaceName)) {
    interfaceName = discovered.includes(wireGuardDefaultInterface)
      ? wireGuardDefaultInterface
      : discovered.includes('wg0')
        ? 'wg0'
        : discovered[0];
  }
  const defaultInterfaceFromConfig = normalizeWireGuardInterfaceName(
    path.basename(String(wireGuardConfigPathDefault || ''), '.conf')
  );
  const configPath =
    defaultInterfaceFromConfig && defaultInterfaceFromConfig === interfaceName
      ? wireGuardConfigPathDefault
      : path.join(wireGuardConfigDir, `${interfaceName}.conf`);
  return {
    interfaceName,
    serviceUnit: `wg-quick@${interfaceName}`,
    configPath,
    configExists: fs.existsSync(configPath),
    availableInterfaces: discovered
  };
}

function loadWireGuardParams() {
  if (!wireGuardParamsPath || !fs.existsSync(wireGuardParamsPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(wireGuardParamsPath, 'utf8');
    return parseKeyValueOutput(raw);
  } catch (_error) {
    return {};
  }
}

function loadWireGuardConfig(runtime) {
  const safeRuntime = runtime && typeof runtime === 'object' ? runtime : {};
  const configPath = String(safeRuntime.configPath || '').trim();
  if (!configPath || !fs.existsSync(configPath)) {
    throw createClientRequestError('No se encontró archivo de configuración WireGuard.', 404);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return parseWireGuardConfigText(raw);
}

function parseWgDumpForInterface(interfaceName) {
  const safeInterface = normalizeWireGuardInterfaceName(interfaceName);
  if (!safeInterface) {
    return {
      available: false,
      interface: null,
      peers: []
    };
  }
  if (!commandExistsSync('wg')) {
    return {
      available: false,
      interface: null,
      peers: []
    };
  }
  const dumpResult = runSystemCommandSync('wg', ['show', safeInterface, 'dump'], {
    allowNonZero: true,
    timeoutMs: 8000,
    maxBuffer: 1024 * 1024 * 4
  });
  if (!dumpResult.ok || Number(dumpResult.code) !== 0) {
    return {
      available: false,
      interface: null,
      peers: [],
      error: truncateForNotify(dumpResult.stderr || dumpResult.stdout || 'wg_show_dump_failed', 220)
    };
  }
  const lines = String(dumpResult.stdout || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return {
      available: true,
      interface: null,
      peers: []
    };
  }
  const rows = lines.map((line) => line.split('\t'));
  const ifaceRow = rows[0] || [];
  const peerRows = rows.slice(1);
  const iface = {
    interfaceName: String(ifaceRow[0] || safeInterface),
    publicKey: String(ifaceRow[2] || '').trim(),
    listenPort: Number.isFinite(Number(ifaceRow[3])) ? Number(ifaceRow[3]) : null,
    fwmark: String(ifaceRow[4] || '').trim()
  };
  const peers = peerRows
    .map((columns) => ({
      interfaceName: String(columns[0] || safeInterface),
      publicKey: String(columns[1] || '').trim(),
      presharedKey: String(columns[2] || '').trim(),
      endpoint: String(columns[3] || '').trim(),
      allowedIps: String(columns[4] || '').trim(),
      latestHandshakeEpoch: Number.isFinite(Number(columns[5])) ? Number(columns[5]) : 0,
      transferRxBytes: Number.isFinite(Number(columns[6])) ? Number(columns[6]) : 0,
      transferTxBytes: Number.isFinite(Number(columns[7])) ? Number(columns[7]) : 0,
      persistentKeepalive: Number.isFinite(Number(columns[8])) ? Number(columns[8]) : null
    }))
    .filter((peer) => Boolean(peer.publicKey));
  return {
    available: true,
    interface: iface,
    peers
  };
}

function getWireGuardServiceState(runtime) {
  const safeRuntime = runtime && typeof runtime === 'object' ? runtime : {};
  const unit = String(safeRuntime.serviceUnit || '').trim();
  if (!unit) {
    return {
      unit: '',
      isActive: false,
      activeState: 'unknown',
      subState: '',
      unitFileState: '',
      loadState: ''
    };
  }
  const showResult = runSystemCommandSync(
    'systemctl',
    ['show', unit, '--property=LoadState,ActiveState,SubState,UnitFileState,Description,FragmentPath'],
    { allowNonZero: true, timeoutMs: 8000, maxBuffer: 1024 * 1024 }
  );
  const details = parseKeyValueOutput(showResult.stdout || '');
  const activeState = String(details.ActiveState || '').trim().toLowerCase() || 'unknown';
  const subState = String(details.SubState || '').trim().toLowerCase();
  const loadState = String(details.LoadState || '').trim().toLowerCase();
  const unitFileState = String(details.UnitFileState || '').trim().toLowerCase();
  return {
    unit,
    isActive: activeState === 'active',
    activeState,
    subState,
    unitFileState,
    loadState,
    description: String(details.Description || '').trim(),
    fragmentPath: String(details.FragmentPath || '').trim()
  };
}

function parseIpv4Address(rawValue) {
  const source = String(rawValue || '').trim();
  if (net.isIP(source) !== 4) return null;
  const parts = source.split('.').map((entry) => Number.parseInt(entry, 10));
  if (parts.length !== 4 || parts.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

function formatIpv4Address(value) {
  const safe = Number(value) >>> 0;
  return [
    (safe >>> 24) & 255,
    (safe >>> 16) & 255,
    (safe >>> 8) & 255,
    safe & 255
  ].join('.');
}

function parseIpv4Cidr(rawValue) {
  const source = String(rawValue || '').trim();
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(source);
  if (!match) return null;
  const ip = parseIpv4Address(match[1]);
  const prefix = Number.parseInt(match[2], 10);
  if (ip === null || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  const network = ip & mask;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return {
    ip,
    prefix,
    mask,
    network,
    broadcast,
    cidr: `${match[1]}/${prefix}`
  };
}

function extractWireGuardServerIpv4Network(interfaceAddressValue) {
  const values = String(interfaceAddressValue || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  for (const value of values) {
    const parsed = parseIpv4Cidr(value);
    if (parsed) return parsed;
  }
  return null;
}

function extractIpv4FromAllowedIps(allowedIpsValue) {
  const values = String(allowedIpsValue || '')
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  for (const value of values) {
    const parsed = parseIpv4Cidr(value);
    if (parsed && parsed.prefix === 32) {
      return formatIpv4Address(parsed.ip);
    }
  }
  return '';
}

function collectUsedWireGuardIpv4(peers) {
  const used = new Set();
  (Array.isArray(peers) ? peers : []).forEach((peer) => {
    const candidate = extractIpv4FromAllowedIps(peer && peer.allowedIps ? peer.allowedIps : '');
    const parsed = parseIpv4Address(candidate);
    if (parsed !== null) {
      used.add(parsed);
    }
  });
  return used;
}

function resolveWireGuardClientIp(parsedConfig, requestedIp = '') {
  const network = extractWireGuardServerIpv4Network(parsedConfig && parsedConfig.interfaceData ? parsedConfig.interfaceData.address : '');
  if (!network) {
    throw createClientRequestError('No se pudo determinar la red IPv4 de WireGuard desde [Interface].Address.', 400);
  }
  const used = collectUsedWireGuardIpv4(parsedConfig && parsedConfig.peers ? parsedConfig.peers : []);
  const requested = String(requestedIp || '').trim();
  if (requested) {
    const parsedRequested = parseIpv4Address(requested);
    if (parsedRequested === null) {
      throw createClientRequestError('IP cliente inválida. Usa formato IPv4 (ej: 10.8.0.9).', 400);
    }
    if ((parsedRequested & network.mask) !== network.network) {
      throw createClientRequestError('La IP cliente debe pertenecer a la subred WireGuard de la interfaz.', 400);
    }
    if (parsedRequested === network.ip) {
      throw createClientRequestError('La IP cliente no puede ser la IP del servidor WireGuard.', 400);
    }
    if (used.has(parsedRequested)) {
      throw createClientRequestError('La IP cliente ya está asignada a otro peer.', 409);
    }
    return requested;
  }
  const firstHost = Math.max(network.network + 1, network.network + 2);
  const lastHost = network.broadcast - 1;
  const maxCandidates = Math.min(Math.max(lastHost - firstHost + 1, 0), 65535);
  for (let offset = 0; offset < maxCandidates; offset += 1) {
    const candidate = firstHost + offset;
    if (candidate === network.ip) continue;
    if (candidate <= network.network || candidate >= network.broadcast) continue;
    if (used.has(candidate)) continue;
    return formatIpv4Address(candidate >>> 0);
  }
  throw createClientRequestError('No hay IP disponible para asignar a un nuevo peer WireGuard.', 409);
}

function deriveWireGuardPublicKey(privateKey) {
  const safePrivate = String(privateKey || '').trim();
  if (!safePrivate) return '';
  try {
    const output = execFileSync('wg', ['pubkey'], {
      input: `${safePrivate}\n`,
      encoding: 'utf8',
      timeout: 6000,
      maxBuffer: 1024 * 128
    });
    return String(output || '').trim();
  } catch (_error) {
    return '';
  }
}

function generateWireGuardKeyPair() {
  if (!commandExistsSync('wg')) {
    throw createClientRequestError('El binario "wg" no está disponible en el servidor.', 500);
  }
  const privateResult = runSystemCommandSync('wg', ['genkey'], {
    allowNonZero: true,
    timeoutMs: 8000,
    maxBuffer: 1024 * 128
  });
  if (!privateResult.ok || Number(privateResult.code) !== 0) {
    throw createClientRequestError(
      `No se pudo generar clave privada de WireGuard: ${truncateForNotify(privateResult.stderr || privateResult.stdout || 'wg_genkey_failed', 220)}`,
      500
    );
  }
  const privateKey = String(privateResult.stdout || '').trim();
  const publicKey = deriveWireGuardPublicKey(privateKey);
  if (!publicKey) {
    throw createClientRequestError('No se pudo derivar la clave pública del nuevo peer.', 500);
  }
  return {
    privateKey,
    publicKey
  };
}

function readWireGuardInterfacePrivateKey(interfaceLines) {
  const lines = Array.isArray(interfaceLines) ? interfaceLines : [];
  for (const line of lines) {
    const kv = parseWireGuardKeyValue(line);
    if (!kv) continue;
    if (kv.keyLower === 'privatekey') {
      return String(kv.value || '').trim();
    }
  }
  return '';
}

function getWireGuardServerPublicKey(runtime, parsedConfig, wgDump) {
  const dumpPublic = String(wgDump && wgDump.interface && wgDump.interface.publicKey ? wgDump.interface.publicKey : '').trim();
  if (dumpPublic) return dumpPublic;
  const interfacePrivate = readWireGuardInterfacePrivateKey(parsedConfig && parsedConfig.interfaceLines ? parsedConfig.interfaceLines : []);
  const derived = deriveWireGuardPublicKey(interfacePrivate);
  if (derived) return derived;
  const params = loadWireGuardParams();
  const fromParams = String(params.SERVER_PUB_KEY || '').trim();
  if (fromParams) return fromParams;
  throw createClientRequestError('No se pudo determinar la clave pública del servidor WireGuard.', 500);
}

function getWireGuardPeerProfileForUser(userId, peerId) {
  const safeUserId = getSafeUserId(userId);
  const safePeerId = String(peerId || '').trim();
  if (!safePeerId) return null;
  const row = getWireGuardPeerProfileByIdStmt.get(safePeerId);
  if (!row) return null;
  const ownerId = getSafeUserId(row.user_id);
  if (safeUserId && ownerId && safeUserId !== ownerId) {
    return {
      ...row,
      _ownerMismatch: true
    };
  }
  return row;
}

function serializeWireGuardPeerProfileRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    userId: getSafeUserId(row.user_id),
    interfaceName: normalizeWireGuardInterfaceName(row.interface_name),
    name: normalizeWireGuardPeerName(row.peer_name),
    publicKey: String(row.public_key || '').trim(),
    clientIp: String(row.client_ip || '').trim(),
    allowedIps: String(row.allowed_ips || '').trim(),
    dns: String(row.dns || '').trim(),
    endpoint: String(row.endpoint || '').trim(),
    keepaliveSeconds: Number.isFinite(Number(row.keepalive_seconds)) ? Number(row.keepalive_seconds) : wireGuardKeepaliveDefault,
    notes: String(row.notes || '').trim(),
    createdAt: String(row.created_at || '').trim(),
    updatedAt: String(row.updated_at || '').trim(),
    revokedAt: String(row.revoked_at || '').trim()
  };
}

function getWireGuardSettingsForUser(userId) {
  const safeUserId = getSafeUserId(userId);
  const row = safeUserId ? getWireGuardSettingsForUserStmt.get(safeUserId) : null;
  const params = loadWireGuardParams();
  const endpointFromParams = String(params.SERVER_PUB_IP || '').trim();
  const dnsFromParams = [String(params.CLIENT_DNS_1 || '').trim(), String(params.CLIENT_DNS_2 || '').trim()]
    .filter(Boolean)
    .join(',');
  const allowedFromParams = String(params.ALLOWED_IPS || '').trim();
  return {
    endpointHost: String(row && row.endpoint_host ? row.endpoint_host : wireGuardPublicEndpointDefault || endpointFromParams).trim(),
    defaultDns: normalizeWireGuardDns(row && row.default_dns ? row.default_dns : dnsFromParams || wireGuardClientDnsDefault),
    defaultAllowedIps: normalizeWireGuardAllowedIps(
      row && row.default_allowed_ips ? row.default_allowed_ips : allowedFromParams || wireGuardAllowedIpsDefault
    ),
    defaultKeepaliveSeconds: normalizeWireGuardKeepalive(
      row && Number.isFinite(Number(row.default_keepalive_seconds)) ? row.default_keepalive_seconds : wireGuardKeepaliveDefault
    ),
    updatedAt: String(row && row.updated_at ? row.updated_at : '').trim()
  };
}

function upsertWireGuardSettingsForUser(userId, payload = {}) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    throw createClientRequestError('user_id inválido', 400);
  }
  const current = getWireGuardSettingsForUser(safeUserId);
  const source = payload && typeof payload === 'object' ? payload : {};
  const next = {
    endpointHost: String(source.endpointHost || current.endpointHost || '')
      .replace(/\s+/g, '')
      .trim()
      .slice(0, 255),
    defaultDns: normalizeWireGuardDns(source.defaultDns, current.defaultDns),
    defaultAllowedIps: normalizeWireGuardAllowedIps(source.defaultAllowedIps, current.defaultAllowedIps),
    defaultKeepaliveSeconds: normalizeWireGuardKeepalive(source.defaultKeepaliveSeconds, current.defaultKeepaliveSeconds),
    updatedAt: nowIso()
  };
  upsertWireGuardSettingsForUserStmt.run(
    safeUserId,
    next.endpointHost,
    next.defaultDns,
    next.defaultAllowedIps,
    next.defaultKeepaliveSeconds,
    next.updatedAt
  );
  return getWireGuardSettingsForUser(safeUserId);
}

function buildWireGuardPeerBlock(peerData) {
  const source = peerData && typeof peerData === 'object' ? peerData : {};
  const alias = normalizeWireGuardPeerName(source.name || '');
  const createdAt = String(source.createdAt || nowIso()).trim();
  const lines = [];
  if (alias) {
    lines.push(`# codexweb-name: ${alias}`);
  }
  lines.push(`# codexweb-created-at: ${createdAt}`);
  lines.push('[Peer]');
  lines.push(`PublicKey = ${String(source.publicKey || '').trim()}`);
  lines.push(`AllowedIPs = ${String(source.allowedIps || '').trim()}`);
  return lines;
}

function buildWireGuardClientConfig(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const dns = normalizeWireGuardDns(source.dns || '');
  const lines = [
    '[Interface]',
    `PrivateKey = ${String(source.clientPrivateKey || '').trim()}`,
    `Address = ${String(source.clientIp || '').trim()}/32`
  ];
  if (dns) {
    lines.push(`DNS = ${dns}`);
  }
  lines.push('');
  lines.push('[Peer]');
  lines.push(`PublicKey = ${String(source.serverPublicKey || '').trim()}`);
  lines.push(`Endpoint = ${String(source.endpoint || '').trim()}`);
  lines.push(`AllowedIPs = ${normalizeWireGuardAllowedIps(source.allowedIps || '')}`);
  const keepalive = normalizeWireGuardKeepalive(source.keepaliveSeconds, wireGuardKeepaliveDefault);
  if (keepalive > 0) {
    lines.push(`PersistentKeepalive = ${keepalive}`);
  }
  return `${lines.join('\n').trim()}\n`;
}

function buildWireGuardStatusSnapshot(userId, options = {}) {
  const runtime = resolveWireGuardRuntime(options.interfaceName);
  const settings = getWireGuardSettingsForUser(userId);
  const service = getWireGuardServiceState(runtime);
  const params = loadWireGuardParams();
  let parsedConfig = {
    interfaceLines: [],
    peers: [],
    interfaceData: {
      address: '',
      listenPort: '',
      dns: '',
      postUp: '',
      postDown: '',
      hasPrivateKey: false
    }
  };
  let configError = '';
  if (runtime.configExists) {
    try {
      parsedConfig = loadWireGuardConfig(runtime);
    } catch (error) {
      configError = truncateForNotify(error && error.message ? error.message : 'wireguard_config_read_failed', 220);
    }
  } else {
    configError = 'No existe archivo de configuración WireGuard para esta interfaz.';
  }
  const wgDump = parseWgDumpForInterface(runtime.interfaceName);
  const runtimePeerByPublicKey = new Map();
  (Array.isArray(wgDump.peers) ? wgDump.peers : []).forEach((peer) => {
    const key = String(peer.publicKey || '').trim();
    if (!key) return;
    runtimePeerByPublicKey.set(key, peer);
  });
  const profileRows = listWireGuardPeerProfilesByInterfaceStmt
    .all(runtime.interfaceName)
    .filter((row) => String(row.revoked_at || '').trim() === '');
  const profileByPublicKey = new Map();
  profileRows.forEach((row) => {
    const key = String(row.public_key || '').trim();
    if (!key) return;
    if (profileByPublicKey.has(key)) return;
    profileByPublicKey.set(key, row);
  });
  const unionKeys = new Set();
  (Array.isArray(parsedConfig.peers) ? parsedConfig.peers : []).forEach((peer) => {
    if (peer.publicKey) unionKeys.add(peer.publicKey);
  });
  runtimePeerByPublicKey.forEach((_value, key) => unionKeys.add(key));
  profileByPublicKey.forEach((_value, key) => unionKeys.add(key));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const peers = Array.from(unionKeys)
    .map((publicKey) => {
      const configPeer = (parsedConfig.peers || []).find((entry) => String(entry.publicKey || '').trim() === publicKey) || null;
      const runtimePeer = runtimePeerByPublicKey.get(publicKey) || null;
      const profileRow = profileByPublicKey.get(publicKey) || null;
      const profile = serializeWireGuardPeerProfileRow(profileRow);
      const latestHandshakeEpoch =
        runtimePeer && Number.isFinite(Number(runtimePeer.latestHandshakeEpoch))
          ? Number(runtimePeer.latestHandshakeEpoch)
          : 0;
      const secondsSinceHandshake = latestHandshakeEpoch > 0 ? Math.max(0, nowSeconds - latestHandshakeEpoch) : null;
      const isActive = secondsSinceHandshake !== null && secondsSinceHandshake <= wireGuardActiveHandshakeWindowSeconds;
      const peerId = buildWireGuardPeerIdFromPublicKey(publicKey);
      const clientIp =
        String(profile && profile.clientIp ? profile.clientIp : '') ||
        extractIpv4FromAllowedIps(runtimePeer ? runtimePeer.allowedIps : configPeer ? configPeer.allowedIps : '');
      const name =
        normalizeWireGuardPeerName(profile && profile.name ? profile.name : '') ||
        normalizeWireGuardPeerName(configPeer && configPeer.name ? configPeer.name : '') ||
        `peer-${String(publicKey || '').slice(0, 8)}`;
      return {
        id: peerId,
        name,
        publicKey,
        clientIp,
        allowedIps: String(
          runtimePeer && runtimePeer.allowedIps
            ? runtimePeer.allowedIps
            : configPeer && configPeer.allowedIps
              ? configPeer.allowedIps
              : profile && profile.allowedIps
                ? profile.allowedIps
                : ''
        ).trim(),
        endpoint: String(runtimePeer && runtimePeer.endpoint ? runtimePeer.endpoint : configPeer && configPeer.endpoint ? configPeer.endpoint : '').trim(),
        latestHandshakeAt: latestHandshakeEpoch > 0 ? new Date(latestHandshakeEpoch * 1000).toISOString() : '',
        secondsSinceHandshake,
        active: Boolean(isActive),
        transferRxBytes: Number(runtimePeer && runtimePeer.transferRxBytes ? runtimePeer.transferRxBytes : 0),
        transferTxBytes: Number(runtimePeer && runtimePeer.transferTxBytes ? runtimePeer.transferTxBytes : 0),
        persistentKeepalive:
          runtimePeer && Number.isFinite(Number(runtimePeer.persistentKeepalive))
            ? Number(runtimePeer.persistentKeepalive)
            : profile && Number.isFinite(Number(profile.keepaliveSeconds))
              ? Number(profile.keepaliveSeconds)
              : null,
        createdAt: String(
          profile && profile.createdAt
            ? profile.createdAt
            : configPeer && configPeer.createdAt
              ? configPeer.createdAt
              : ''
        ).trim(),
        notes: String(profile && profile.notes ? profile.notes : '').trim(),
        hasProfile: Boolean(profileRow && String(profileRow.config_cipher || '').trim())
      };
    })
    .sort((a, b) => {
      const aTs = a.latestHandshakeAt ? Date.parse(a.latestHandshakeAt) : 0;
      const bTs = b.latestHandshakeAt ? Date.parse(b.latestHandshakeAt) : 0;
      if (aTs !== bTs) return bTs - aTs;
      return a.name.localeCompare(b.name);
    });

  const totalRxBytes = peers.reduce((sum, peer) => sum + Number(peer.transferRxBytes || 0), 0);
  const totalTxBytes = peers.reduce((sum, peer) => sum + Number(peer.transferTxBytes || 0), 0);
  const listenPortFromConfig = Number.parseInt(String(parsedConfig.interfaceData.listenPort || ''), 10);
  const listenPort =
    Number.isInteger(listenPortFromConfig) && listenPortFromConfig > 0
      ? listenPortFromConfig
      : wgDump.interface && Number.isInteger(Number(wgDump.interface.listenPort))
        ? Number(wgDump.interface.listenPort)
        : Number.parseInt(String(params.SERVER_PORT || ''), 10) || null;
  return {
    runtime: {
      interfaceName: runtime.interfaceName,
      availableInterfaces: runtime.availableInterfaces,
      configPath: runtime.configPath,
      configExists: runtime.configExists
    },
    binaries: {
      wg: commandExistsSync('wg'),
      wgQuick: commandExistsSync('wg-quick'),
      qrencode: commandExistsSync('qrencode'),
      systemctl: commandExistsSync('systemctl')
    },
    service,
    interface: {
      name: runtime.interfaceName,
      address: String(parsedConfig.interfaceData.address || '').trim(),
      listenPort,
      postUp: String(parsedConfig.interfaceData.postUp || '').trim(),
      postDown: String(parsedConfig.interfaceData.postDown || '').trim(),
      hasPrivateKey: Boolean(parsedConfig.interfaceData.hasPrivateKey),
      publicKey: String(wgDump.interface && wgDump.interface.publicKey ? wgDump.interface.publicKey : '').trim(),
      fwmark: String(wgDump.interface && wgDump.interface.fwmark ? wgDump.interface.fwmark : '').trim(),
      configError
    },
    profileDefaults: settings,
    peers,
    stats: {
      configuredPeers: peers.length,
      activePeers: peers.filter((peer) => peer.active).length,
      totalRxBytes,
      totalTxBytes,
      activeWindowSeconds: wireGuardActiveHandshakeWindowSeconds,
      updatedAt: nowIso()
    }
  };
}

function createWireGuardPeerProfile(userId, payload = {}, options = {}) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    throw createClientRequestError('user_id inválido', 400);
  }
  const runtime = resolveWireGuardRuntime(options.interfaceName || payload.interfaceName);
  if (!runtime.configExists) {
    throw createClientRequestError(
      `No existe configuración WireGuard para ${runtime.interfaceName} (${runtime.configPath}).`,
      404
    );
  }
  const parsedConfig = loadWireGuardConfig(runtime);
  const profileSettings = getWireGuardSettingsForUser(safeUserId);
  const peerName = normalizeWireGuardPeerName(payload.name || payload.alias || '');
  if (!peerName) {
    throw createClientRequestError('Indica nombre/alias del perfil WireGuard.', 400);
  }
  const clientIp = resolveWireGuardClientIp(parsedConfig, payload.clientIp || payload.clientIpv4 || '');
  const allowedIps = normalizeWireGuardAllowedIps(payload.allowedIps, profileSettings.defaultAllowedIps);
  const dns = normalizeWireGuardDns(payload.dns, profileSettings.defaultDns);
  const keepaliveSeconds = normalizeWireGuardKeepalive(payload.keepaliveSeconds, profileSettings.defaultKeepaliveSeconds);
  const notes = String(payload.notes || payload.comment || '').trim().slice(0, 280);
  const endpointHost = String(
    payload.endpointHost ||
      profileSettings.endpointHost ||
      wireGuardPublicEndpointDefault ||
      loadWireGuardParams().SERVER_PUB_IP ||
      ''
  )
    .replace(/\s+/g, '')
    .trim()
    .slice(0, 255);
  if (!endpointHost) {
    throw createClientRequestError('No se pudo resolver endpoint público para el perfil WireGuard.', 400);
  }
  const wgDump = parseWgDumpForInterface(runtime.interfaceName);
  const serverPublicKey = getWireGuardServerPublicKey(runtime, parsedConfig, wgDump);
  const listenPort =
    Number.parseInt(String(parsedConfig.interfaceData.listenPort || ''), 10) ||
    Number.parseInt(String(loadWireGuardParams().SERVER_PORT || ''), 10);
  if (!Number.isInteger(listenPort) || listenPort <= 0) {
    throw createClientRequestError('No se pudo resolver ListenPort de WireGuard.', 400);
  }
  const keyPair = generateWireGuardKeyPair();
  const peerId = buildWireGuardPeerIdFromPublicKey(keyPair.publicKey);
  if (!peerId) {
    throw createClientRequestError('No se pudo generar identificador del peer.', 500);
  }
  const existingByPublicKey = getWireGuardPeerProfileByPublicKeyStmt.get(runtime.interfaceName, keyPair.publicKey);
  if (existingByPublicKey) {
    throw createClientRequestError('Conflicto inesperado de clave pública. Reintenta crear el perfil.', 409);
  }
  const endpoint = `${endpointHost}:${listenPort}`;
  const clientConfig = buildWireGuardClientConfig({
    clientPrivateKey: keyPair.privateKey,
    clientIp,
    dns,
    serverPublicKey,
    endpoint,
    allowedIps,
    keepaliveSeconds
  });
  const createdAt = nowIso();
  const peerBlock = parseWireGuardPeerBlock(
    buildWireGuardPeerBlock({
      name: peerName,
      publicKey: keyPair.publicKey,
      allowedIps: `${clientIp}/32`,
      createdAt
    })
  );
  const nextConfig = {
    ...parsedConfig,
    peers: [...parsedConfig.peers, peerBlock]
  };
  writeWireGuardConfig(runtime, nextConfig);
  const service = getWireGuardServiceState(runtime);
  if (service.isActive) {
    const applyResult = runSystemCommandSync(
      'wg',
      ['set', runtime.interfaceName, 'peer', keyPair.publicKey, 'allowed-ips', `${clientIp}/32`],
      {
        allowNonZero: true,
        timeoutMs: 12000,
        maxBuffer: 1024 * 1024
      }
    );
    if (!applyResult.ok || Number(applyResult.code) !== 0) {
      try {
        writeWireGuardConfig(runtime, parsedConfig);
      } catch (_rollbackError) {
        // ignore rollback failure
      }
      throw createClientRequestError(
        `No se pudo aplicar peer en runtime WireGuard: ${truncateForNotify(
          applyResult.stderr || applyResult.stdout || 'wg_set_failed',
          220
        )}`,
        500
      );
    }
  }
  upsertWireGuardPeerProfileStmt.run(
    peerId,
    safeUserId,
    runtime.interfaceName,
    peerName,
    keyPair.publicKey,
    clientIp,
    allowedIps,
    dns,
    endpoint,
    keepaliveSeconds,
    notes,
    encryptSecretText(clientConfig),
    createdAt,
    createdAt
  );
  return {
    id: peerId,
    name: peerName,
    publicKey: keyPair.publicKey,
    clientIp,
    allowedIps: `${clientIp}/32`,
    profileAllowedIps: allowedIps,
    dns,
    endpoint,
    keepaliveSeconds,
    createdAt,
    hasProfile: true
  };
}

function deleteWireGuardPeer(runtime, payload = {}) {
  const safeRuntime = runtime && typeof runtime === 'object' ? runtime : resolveWireGuardRuntime();
  const parsedConfig = loadWireGuardConfig(safeRuntime);
  const requestedPeerId = String(payload.peerId || '').trim();
  const requestedPublicKey = String(payload.publicKey || '').trim();
  let targetPeer = null;
  if (requestedPublicKey) {
    targetPeer = parsedConfig.peers.find((entry) => String(entry.publicKey || '').trim() === requestedPublicKey) || null;
  }
  if (!targetPeer && requestedPeerId) {
    targetPeer =
      parsedConfig.peers.find((entry) => buildWireGuardPeerIdFromPublicKey(entry.publicKey) === requestedPeerId) || null;
  }
  if (!targetPeer || !targetPeer.publicKey) {
    throw createClientRequestError('Peer WireGuard no encontrado.', 404);
  }
  const service = getWireGuardServiceState(safeRuntime);
  if (service.isActive) {
    const removeRuntimeResult = runSystemCommandSync(
      'wg',
      ['set', safeRuntime.interfaceName, 'peer', targetPeer.publicKey, 'remove'],
      {
        allowNonZero: true,
        timeoutMs: 12000,
        maxBuffer: 1024 * 1024
      }
    );
    if (!removeRuntimeResult.ok || Number(removeRuntimeResult.code) !== 0) {
      throw createClientRequestError(
        `No se pudo revocar peer en runtime WireGuard: ${truncateForNotify(
          removeRuntimeResult.stderr || removeRuntimeResult.stdout || 'wg_peer_remove_failed',
          220
        )}`,
        500
      );
    }
  }
  const nextConfig = {
    ...parsedConfig,
    peers: parsedConfig.peers.filter((entry) => String(entry.publicKey || '').trim() !== targetPeer.publicKey)
  };
  writeWireGuardConfig(safeRuntime, nextConfig);
  return {
    publicKey: targetPeer.publicKey,
    peerId: buildWireGuardPeerIdFromPublicKey(targetPeer.publicKey),
    clientIp: extractIpv4FromAllowedIps(targetPeer.allowedIps),
    allowedIps: targetPeer.allowedIps
  };
}

function getWireGuardPeerProfileConfigById(peerId) {
  const safePeerId = String(peerId || '').trim();
  if (!safePeerId) {
    throw createClientRequestError('peer_id inválido', 400);
  }
  const row = getWireGuardPeerProfileByIdStmt.get(safePeerId);
  if (!row) {
    throw createClientRequestError('Perfil WireGuard no encontrado para este peer.', 404);
  }
  if (String(row.revoked_at || '').trim()) {
    throw createClientRequestError('El perfil WireGuard está revocado y ya no es descargable.', 404);
  }
  const cipher = String(row.config_cipher || '').trim();
  if (!cipher) {
    throw createClientRequestError('El peer no tiene perfil descargable almacenado.', 404);
  }
  let configText = '';
  try {
    configText = decryptSecretText(cipher);
  } catch (_error) {
    throw createClientRequestError('No se pudo descifrar el perfil WireGuard almacenado.', 500);
  }
  const safeName = sanitizeDriveFileName(row.peer_name || row.id || 'wireguard-peer', 'wireguard-peer')
    .replace(/\s+/g, '_')
    .toLowerCase();
  return {
    row,
    configText,
    fileName: `${safeName}.conf`
  };
}

function buildWireGuardDiagnostics(userId, options = {}) {
  const runtime = resolveWireGuardRuntime(options.interfaceName);
  const service = getWireGuardServiceState(runtime);
  const lineLimitRaw = Number.parseInt(String(options.lines || ''), 10);
  const lines = Number.isInteger(lineLimitRaw) ? Math.min(Math.max(lineLimitRaw, 10), wireGuardDiagnosticsMaxLogLines) : 120;
  const logsResult = runSystemCommandSync(
    'journalctl',
    ['-u', runtime.serviceUnit, '-n', String(lines), '--no-pager', '--output=short-iso'],
    {
      allowNonZero: true,
      timeoutMs: 12000,
      maxBuffer: 1024 * 1024 * 8
    }
  );
  const stripResult = runtime.configExists
    ? runSystemCommandSync('wg-quick', ['strip', runtime.configPath], {
        allowNonZero: true,
        timeoutMs: 12000,
        maxBuffer: 1024 * 1024 * 4
      })
    : { ok: false, code: 1, stdout: '', stderr: 'config_missing' };
  const statusSnapshot = buildWireGuardStatusSnapshot(userId, {
    interfaceName: runtime.interfaceName
  });
  return {
    runtime: statusSnapshot.runtime,
    service: statusSnapshot.service,
    checks: {
      wgBinary: commandExistsSync('wg'),
      wgQuickBinary: commandExistsSync('wg-quick'),
      systemctlBinary: commandExistsSync('systemctl'),
      configExists: runtime.configExists,
      configStripOk: Boolean(stripResult.ok && Number(stripResult.code) === 0),
      configStripError:
        stripResult.ok && Number(stripResult.code) === 0
          ? ''
          : truncateForNotify(stripResult.stderr || stripResult.stdout || 'wg_quick_strip_failed', 220)
    },
    logs: {
      lines,
      output: String(logsResult.stdout || '').trim() || String(logsResult.stderr || '').trim() || '-- No entries --'
    }
  };
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

function classifyDeployedAppCategory(source, locator, location) {
  const normalizedSource = String(source || '')
    .trim()
    .toLowerCase();
  if (normalizedSource === 'docker') {
    return { category: 'docker', isSystem: false };
  }
  if (normalizedSource === 'pm2') {
    return { category: 'user', isSystem: false };
  }
  if (normalizedSource === 'systemd') {
    const locatorValue = String(locator || '')
      .trim()
      .toLowerCase();
    const locationValue = String(location || '')
      .trim()
      .toLowerCase();
    const isUserScoped =
      locatorValue.startsWith('user@') ||
      locationValue.includes('/.config/systemd/user') ||
      locationValue.includes('/run/user/') ||
      locationValue.includes('/home/');
    return {
      category: isUserScoped ? 'user' : 'system',
      isSystem: !isUserScoped
    };
  }
  return { category: 'custom', isSystem: false };
}

function computeDeployedStatusFlags(statusValue, detailStatusValue) {
  const normalizedStatus = normalizeDeployedStatus(statusValue, 'unknown');
  const detail = String(detailStatusValue || '')
    .trim()
    .toLowerCase();
  const isRunning = normalizedStatus === 'running';
  const isStopped =
    normalizedStatus === 'stopped' ||
    normalizedStatus === 'error' ||
    /(inactive|exited|dead|failed|error|stopped|shutdown)/.test(detail);
  return {
    normalizedStatus,
    isRunning,
    isStopped
  };
}

function buildDeployedAppSearchableText(payload) {
  const safe = payload && typeof payload === 'object' ? payload : {};
  return [
    safe.name,
    safe.source,
    safe.status,
    safe.normalizedStatus,
    safe.detailStatus,
    safe.description,
    safe.location,
    safe.category,
    safe.isSystem ? 'system' : 'non-system'
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
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
  const detailStatus = String((payload && payload.detailStatus) || '').trim();
  const status = normalizeDeployedStatus(payload && payload.status ? payload.status : detailStatus || 'unknown');
  const statusFlags = computeDeployedStatusFlags(status, detailStatus);
  const categoryInfo = classifyDeployedAppCategory(
    source,
    locator,
    String((payload && payload.location) || '').trim()
  );
  const pidRaw = Number(payload && payload.pid);
  const pid = Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : null;
  const summary = {
    id,
    source,
    name,
    status,
    normalizedStatus: statusFlags.normalizedStatus,
    isRunning: statusFlags.isRunning,
    isStopped: statusFlags.isStopped,
    isSystem: categoryInfo.isSystem,
    category: categoryInfo.category,
    detailStatus,
    description: String((payload && payload.description) || '').trim(),
    pid,
    location: String((payload && payload.location) || '').trim(),
    uptime: String((payload && payload.uptime) || '').trim(),
    canStart: Boolean(payload && payload.canStart),
    canStop: Boolean(payload && payload.canStop),
    canRestart: Boolean(payload && payload.canRestart),
    hasLogs: Boolean(payload && payload.hasLogs),
    descriptionJobStatus: 'idle',
    aiDescription: '',
    aiDescriptionGeneratedAt: '',
    aiDescriptionProvider: '',
    scannedAt: scannedAtIso
  };
  summary.searchableText = buildDeployedAppSearchableText(summary);
  return summary;
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

function normalizeDeployedDescriptionJobStatus(rawStatus, fallback = 'pending') {
  const value = String(rawStatus || '')
    .trim()
    .toLowerCase();
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'error') {
    return value;
  }
  return fallback;
}

function normalizeDeployedDescriptionJobAppIds(rawValue) {
  return Array.from(
    new Set(
      safeParseJsonArray(rawValue)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  ).slice(0, deployedAppsDescribeMaxItems);
}

function normalizeDeployedDescriptionResult(rawValue) {
  const data = safeParseJsonObject(rawValue);
  const descriptionsRaw = Array.isArray(data.descriptions) ? data.descriptions : [];
  const descriptions = descriptionsRaw
    .map((entry) => {
      const appId = String(entry && entry.appId ? entry.appId : '').trim();
      const name = String(entry && entry.name ? entry.name : '').trim();
      const description = normalizeGeneratedDeployedDescription(entry && entry.description ? entry.description : '', 320);
      const generatedAt = String(entry && entry.generatedAt ? entry.generatedAt : '').trim();
      if (!appId || !description) return null;
      return {
        appId,
        name: name || appId,
        description,
        generatedAt: generatedAt || ''
      };
    })
    .filter(Boolean);
  return {
    scannedAt: String(data.scannedAt || '').trim(),
    generatedAt: String(data.generatedAt || '').trim(),
    missingAppIds: Array.from(
      new Set(
        (Array.isArray(data.missingAppIds) ? data.missingAppIds : [])
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
      )
    ),
    descriptions
  };
}

function serializeDeployedDescriptionJobRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || '').trim(),
    status: normalizeDeployedDescriptionJobStatus(row.status, 'pending'),
    provider: String(row.provider || '').trim(),
    activeAgentId: String(row.active_agent_id || '').trim(),
    appIds: normalizeDeployedDescriptionJobAppIds(row.app_ids_json),
    error: String(row.error_text || '').trim(),
    createdAt: String(row.created_at || '').trim(),
    updatedAt: String(row.updated_at || '').trim(),
    startedAt: String(row.started_at || '').trim(),
    finishedAt: String(row.finished_at || '').trim(),
    result: normalizeDeployedDescriptionResult(row.result_json)
  };
}

function getDeployedDescriptionByAppIdForUser(userId) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    return new Map();
  }
  const rows = listDeployedAppDescriptionsForUserStmt.all(safeUserId);
  const map = new Map();
  rows.forEach((row) => {
    const appId = String(row && row.app_id ? row.app_id : '').trim();
    const description = normalizeGeneratedDeployedDescription(row && row.description ? row.description : '', 320);
    if (!appId || !description) return;
    map.set(appId, {
      description,
      provider: String(row && row.provider ? row.provider : '').trim(),
      generatedAt: String(row && row.generated_at ? row.generated_at : '').trim(),
      jobId: String(row && row.job_id ? row.job_id : '').trim()
    });
  });
  return map;
}

function getDeployedDescriptionJobStatusByAppIdForUser(userId) {
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) {
    return new Map();
  }
  const rows = listRecentDeployedAppDescriptionJobsForUserStmt.all(
    safeUserId,
    Math.max(40, deployedAppsDescribeJobPollMaxItems)
  );
  const map = new Map();
  const statusPriority = (status) => {
    if (status === 'running') return 4;
    if (status === 'pending') return 3;
    if (status === 'error') return 2;
    if (status === 'completed') return 1;
    return 0;
  };

  rows.forEach((row) => {
    const serialized = serializeDeployedDescriptionJobRow(row);
    if (!serialized) return;
    const updatedMs = Date.parse(serialized.updatedAt || serialized.createdAt || '');
    serialized.appIds.forEach((appId) => {
      const previous = map.get(appId);
      if (!previous) {
        map.set(appId, {
          status: serialized.status,
          jobId: serialized.id,
          updatedMs: Number.isFinite(updatedMs) ? updatedMs : 0
        });
        return;
      }
      const nextRank = statusPriority(serialized.status);
      const prevRank = statusPriority(previous.status);
      const previousUpdated = Number.isFinite(previous.updatedMs) ? previous.updatedMs : 0;
      const nextUpdated = Number.isFinite(updatedMs) ? updatedMs : 0;
      if (nextRank > prevRank || (nextRank === prevRank && nextUpdated >= previousUpdated)) {
        map.set(appId, {
          status: serialized.status,
          jobId: serialized.id,
          updatedMs: nextUpdated
        });
      }
    });
  });

  return map;
}

function enrichDeployedAppsForUser(userId, rawApps) {
  const apps = Array.isArray(rawApps) ? rawApps : [];
  const descriptionsByAppId = getDeployedDescriptionByAppIdForUser(userId);
  const statusByAppId = getDeployedDescriptionJobStatusByAppIdForUser(userId);
  return apps.map((app) => {
    const safeApp = app && typeof app === 'object' ? { ...app } : {};
    const appId = String(safeApp.id || '').trim();
    const descriptionMeta = appId ? descriptionsByAppId.get(appId) : null;
    const statusMeta = appId ? statusByAppId.get(appId) : null;
    const next = {
      ...safeApp,
      normalizedStatus: normalizeDeployedStatus(safeApp.status || safeApp.detailStatus || 'unknown'),
      isRunning: Boolean(safeApp.status === 'running' || safeApp.normalizedStatus === 'running'),
      isStopped: Boolean(
        safeApp.status === 'stopped' ||
          safeApp.status === 'error' ||
          safeApp.isStopped ||
          /(inactive|exited|failed|error|dead)/i.test(String(safeApp.detailStatus || ''))
      ),
      isSystem: Boolean(safeApp.isSystem),
      category: ['system', 'user', 'docker', 'custom'].includes(String(safeApp.category || ''))
        ? String(safeApp.category || '')
        : 'custom',
      descriptionJobStatus:
        statusMeta && statusMeta.status
          ? normalizeDeployedDescriptionJobStatus(statusMeta.status, 'idle')
          : 'idle',
      aiDescription: descriptionMeta ? String(descriptionMeta.description || '') : '',
      aiDescriptionGeneratedAt: descriptionMeta ? String(descriptionMeta.generatedAt || '') : '',
      aiDescriptionProvider: descriptionMeta ? String(descriptionMeta.provider || '') : ''
    };
    next.searchableText = buildDeployedAppSearchableText(next);
    return next;
  });
}

function buildDeployedDescriptionJobId() {
  return `depdesc_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function scheduleDeployedDescriptionJob(jobId) {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId || activeDeployedDescriptionWorkers.has(safeJobId)) {
    return;
  }
  activeDeployedDescriptionWorkers.add(safeJobId);
  setTimeout(() => {
    void runDeployedDescriptionJobById(safeJobId).finally(() => {
      activeDeployedDescriptionWorkers.delete(safeJobId);
    });
  }, 10);
}

async function runDeployedDescriptionJobById(jobId) {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const row = getDeployedAppDescriptionJobByIdStmt.get(safeJobId);
  if (!row) return;
  const userId = getSafeUserId(row.user_id);
  if (!userId) {
    const now = nowIso();
    updateDeployedAppDescriptionJobErrorStmt.run('user_id_invalido', now, now, safeJobId);
    return;
  }

  const status = normalizeDeployedDescriptionJobStatus(row.status, 'pending');
  if (status === 'completed' || status === 'error') {
    return;
  }

  const runningAt = nowIso();
  updateDeployedAppDescriptionJobRunningStmt.run(runningAt, runningAt, safeJobId);

  const appIds = normalizeDeployedDescriptionJobAppIds(row.app_ids_json);
  if (appIds.length === 0) {
    const now = nowIso();
    const resultPayload = {
      scannedAt: now,
      generatedAt: now,
      missingAppIds: [],
      descriptions: []
    };
    updateDeployedAppDescriptionJobCompletedStmt.run(JSON.stringify(resultPayload), now, now, safeJobId);
    return;
  }

  const snapshot = collectDeployedAppsSnapshot(true);
  const appById = new Map(
    snapshot.apps.map((entry) => [String(entry && entry.id ? entry.id : '').trim(), entry])
  );
  const selectedApps = appIds.map((appId) => appById.get(appId)).filter(Boolean);
  const missingAppIds = appIds.filter((appId) => !appById.has(appId));
  const activeAgentId = String(row.active_agent_id || '').trim();
  const usernameRow = getUsernameByIdStmt.get(userId);
  const username = String((usernameRow && usernameRow.username) || '').trim();
  const generatedAt = nowIso();

  try {
    const descriptions = await generateDeployedAppsDescriptionsWithCodex({
      userId,
      username,
      activeAgentId,
      apps: selectedApps
    });

    descriptions.forEach((entry) => {
      const appId = String(entry && entry.appId ? entry.appId : '').trim();
      const description = normalizeGeneratedDeployedDescription(entry && entry.description ? entry.description : '', 320);
      if (!appId || !description) return;
      upsertDeployedAppDescriptionStmt.run(
        userId,
        appId,
        String(row.provider || '').trim() || 'codex-cli',
        description,
        generatedAt,
        safeJobId
      );
    });

    const resultPayload = {
      scannedAt: String(snapshot.scannedAt || ''),
      generatedAt,
      missingAppIds,
      descriptions: descriptions.map((entry) => ({
        appId: String(entry && entry.appId ? entry.appId : '').trim(),
        name: String(entry && entry.name ? entry.name : '').trim(),
        description: normalizeGeneratedDeployedDescription(entry && entry.description ? entry.description : '', 320),
        generatedAt
      }))
    };
    const finishedAt = nowIso();
    updateDeployedAppDescriptionJobCompletedStmt.run(
      JSON.stringify(resultPayload),
      finishedAt,
      finishedAt,
      safeJobId
    );
  } catch (error) {
    const reason = truncateForNotify(error && error.message ? error.message : 'describe_failed', 800);
    const finishedAt = nowIso();
    updateDeployedAppDescriptionJobErrorStmt.run(reason, finishedAt, finishedAt, safeJobId);
  }
}

function resumePendingDeployedDescriptionJobs() {
  const rows = listPendingDeployedAppDescriptionJobsStmt.all(deployedAppsDescribeJobPollMaxItems);
  rows.forEach((row) => {
    const jobId = String(row && row.id ? row.id : '').trim();
    if (!jobId) return;
    scheduleDeployedDescriptionJob(jobId);
  });
}

function parseDriveAccountCredentials(row) {
  if (!row || typeof row !== 'object') {
    throw new Error('drive_account_not_found');
  }
  const cipher = String(row.credentials_cipher || '').trim();
  if (!cipher) {
    throw new Error('drive_credentials_missing');
  }
  const decrypted = decryptSecretText(cipher);
  const parsed = safeParseJsonObject(decrypted);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('drive_credentials_invalid_json');
  }
  return parsed;
}

function serializeToolsBackgroundJobRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || '').trim(),
    type: normalizeStorageJobType(row.job_type),
    status: normalizeStorageJobStatus(row.status),
    payload: safeParseJsonObject(row.payload_json),
    progress: safeParseJsonObject(row.progress_json),
    result: safeParseJsonObject(row.result_json),
    error: String(row.error_text || '').trim(),
    log: String(row.log_text || '').trim(),
    createdAt: String(row.created_at || '').trim(),
    updatedAt: String(row.updated_at || '').trim(),
    startedAt: String(row.started_at || '').trim(),
    finishedAt: String(row.finished_at || '').trim()
  };
}

function setStorageJobProgress(jobId, progressPatch, logMessage = '') {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const row = getToolsBackgroundJobByIdStmt.get(safeJobId);
  if (!row) return;
  const progress = {
    ...safeParseJsonObject(row.progress_json),
    ...(progressPatch && typeof progressPatch === 'object' ? progressPatch : {}),
    updatedAt: nowIso()
  };
  const nextLog = logMessage
    ? appendStorageJobLogText(String(row.log_text || ''), logMessage)
    : String(row.log_text || '').slice(-storageJobLogMaxChars);
  updateToolsBackgroundJobProgressStmt.run(JSON.stringify(progress), nextLog, nowIso(), safeJobId);
}

function markStorageJobError(jobId, errorMessage, progressPatch = {}) {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const row = getToolsBackgroundJobByIdStmt.get(safeJobId);
  if (!row) return;
  const progress = {
    ...safeParseJsonObject(row.progress_json),
    ...(progressPatch && typeof progressPatch === 'object' ? progressPatch : {}),
    endedAt: nowIso()
  };
  const errorText = truncateForNotify(errorMessage || 'storage_job_failed', 1000);
  const nextLog = appendStorageJobLogText(String(row.log_text || ''), `ERROR: ${errorText}`);
  const finishedAt = nowIso();
  updateToolsBackgroundJobErrorStmt.run(
    JSON.stringify(progress),
    errorText,
    nextLog,
    finishedAt,
    finishedAt,
    safeJobId
  );
}

function markStorageJobCompleted(jobId, resultPayload, progressPatch = {}, logMessage = 'Job completado') {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const row = getToolsBackgroundJobByIdStmt.get(safeJobId);
  if (!row) return;
  const progress = {
    ...safeParseJsonObject(row.progress_json),
    ...(progressPatch && typeof progressPatch === 'object' ? progressPatch : {}),
    endedAt: nowIso(),
    done: true
  };
  const result = resultPayload && typeof resultPayload === 'object' ? resultPayload : {};
  const nextLog = appendStorageJobLogText(String(row.log_text || ''), logMessage);
  const finishedAt = nowIso();
  updateToolsBackgroundJobCompletedStmt.run(
    JSON.stringify(progress),
    JSON.stringify(result),
    nextLog,
    finishedAt,
    finishedAt,
    safeJobId
  );
}

function createStorageJob(userId, jobType, payload) {
  const safeUserId = getSafeUserId(userId);
  const safeType = normalizeStorageJobType(jobType);
  if (!safeUserId || !safeType) {
    throw createClientRequestError('No se pudo crear job de almacenamiento', 400);
  }
  const jobId = buildStorageJobId(safeType);
  const createdAt = nowIso();
  insertToolsBackgroundJobStmt.run(
    jobId,
    safeUserId,
    safeType,
    'pending',
    JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
    createdAt,
    createdAt
  );
  scheduleStorageJob(jobId);
  return serializeToolsBackgroundJobRow(getToolsBackgroundJobForUserStmt.get(jobId, safeUserId));
}

function findOpenProjectContextJobForUser(userId, projectId) {
  const safeUserId = getSafeUserId(userId);
  const safeProjectId = Number(projectId);
  if (!safeUserId || !Number.isInteger(safeProjectId) || safeProjectId <= 0) {
    return null;
  }
  const rows = listRecentToolsBackgroundJobsForUserStmt.all(safeUserId, 90);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const type = normalizeStorageJobType(row && row.job_type ? row.job_type : '');
    if (type !== 'project_context_refresh') continue;
    const status = normalizeStorageJobStatus(row && row.status ? row.status : '');
    if (status !== 'pending' && status !== 'running') continue;
    const payload = safeParseJsonObject(row && row.payload_json ? row.payload_json : '{}');
    const payloadProjectId = Number(payload && payload.projectId);
    if (!Number.isInteger(payloadProjectId) || payloadProjectId !== safeProjectId) continue;
    return serializeToolsBackgroundJobRow(row);
  }
  return null;
}

function clearQueuedProjectContextRefreshTimer(userId, projectId) {
  const key = `${Number(userId)}:${Number(projectId)}`;
  const timer = queuedProjectContextRefreshTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    queuedProjectContextRefreshTimers.delete(key);
  }
}

function enqueueProjectContextRefreshJob(userId, projectId, options = {}) {
  const safeUserId = getSafeUserId(userId);
  const safeProjectId = Number(projectId);
  if (!safeUserId || !Number.isInteger(safeProjectId) || safeProjectId <= 0) {
    return null;
  }
  const project = getOwnedProjectOrNull(safeProjectId, safeUserId);
  if (!project) return null;
  const force = Boolean(options.force);
  if (!force && !normalizeProjectAutoEnabled(project.auto_context_enabled, true)) {
    return null;
  }
  const openJob = findOpenProjectContextJobForUser(safeUserId, safeProjectId);
  if (openJob) return openJob;

  const trigger = normalizeProjectContextText(options.trigger || 'auto', 64) || 'auto';
  const payload = {
    projectId: safeProjectId,
    trigger,
    force
  };
  const immediate = Boolean(options.immediate);
  if (immediate) {
    return createStorageJob(safeUserId, 'project_context_refresh', payload);
  }
  const delayMs =
    Number.isFinite(Number(options.delayMs)) && Number(options.delayMs) >= 0
      ? Number(options.delayMs)
      : projectContextAutoRegenerateDebounceMs;
  const key = `${safeUserId}:${safeProjectId}`;
  clearQueuedProjectContextRefreshTimer(safeUserId, safeProjectId);
  const timer = setTimeout(() => {
    queuedProjectContextRefreshTimers.delete(key);
    const stillOpen = findOpenProjectContextJobForUser(safeUserId, safeProjectId);
    if (stillOpen) return;
    try {
      createStorageJob(safeUserId, 'project_context_refresh', payload);
    } catch (_error) {
      // best-effort async refresh
    }
  }, delayMs);
  queuedProjectContextRefreshTimers.set(key, timer);
  return null;
}

function buildAppBackupQuery(appId) {
  const safeAppId = String(appId || '').trim().slice(0, 80);
  return sanitizeDriveFileName(`app_${safeAppId}`, 'app');
}

function resolveBackupTargetFromApp(app) {
  const rawLocation = String(app && app.location ? app.location : '').trim();
  if (!rawLocation) return '';
  const location = normalizeAbsoluteStoragePath(rawLocation, '');
  if (!location || !pathExistsSyncSafe(location)) return '';
  return location;
}

function createTarGzArchive(sourcePath, archivePath) {
  const absoluteSource = normalizeAbsoluteStoragePath(sourcePath);
  const absoluteArchive = normalizeAbsoluteStoragePath(archivePath, storageJobsRootDir);
  if (!absoluteSource || !absoluteArchive) {
    throw new Error('archive_path_invalid');
  }
  let sourceStats = null;
  try {
    sourceStats = fs.statSync(absoluteSource);
  } catch (_error) {
    sourceStats = null;
  }
  if (!sourceStats) {
    throw new Error('source_path_not_found');
  }
  ensureParentDirForFile(absoluteArchive);
  const parent = path.dirname(absoluteSource);
  const base = path.basename(absoluteSource);
  const result = runSystemCommandSync('tar', ['-czf', absoluteArchive, '-C', parent, base], {
    timeoutMs: 1000 * 60 * 10,
    maxBuffer: 1024 * 1024 * 4
  });
  if (!result.ok) {
    const reason = truncateForNotify(result.stderr || result.stdout || 'tar_create_failed', 220);
    if (/no space left|enospc|disk full|quota exceeded/i.test(String(reason || ''))) {
      const clientError = createClientRequestError(
        'No hay espacio suficiente para completar la compresión.',
        507
      );
      clientError.code = 'INSUFFICIENT_STORAGE';
      clientError.storage = buildStorageHealthSnapshotForPath(path.dirname(absoluteArchive));
      throw clientError;
    }
    throw new Error(reason);
  }
  return absoluteArchive;
}

function extractTarGzArchive(archivePath, targetPath) {
  const absoluteArchive = normalizeAbsoluteStoragePath(archivePath, storageJobsRootDir);
  const absoluteTarget = normalizeAbsoluteStoragePath(targetPath);
  if (!absoluteArchive || !absoluteTarget) {
    throw new Error('restore_target_invalid');
  }
  assertStorageMutationPathAllowed(absoluteTarget);
  let stats = null;
  try {
    stats = fs.statSync(absoluteTarget);
  } catch (_error) {
    stats = null;
  }
  const extractParent =
    stats && stats.isFile() ? path.dirname(absoluteTarget) : path.dirname(absoluteTarget);
  const result = runSystemCommandSync('tar', ['-xzf', absoluteArchive, '-C', extractParent], {
    timeoutMs: 1000 * 60 * 10,
    maxBuffer: 1024 * 1024 * 4
  });
  if (!result.ok) {
    const reason = truncateForNotify(result.stderr || result.stdout || 'tar_extract_failed', 220);
    if (/no space left|enospc|disk full|quota exceeded/i.test(String(reason || ''))) {
      const clientError = createClientRequestError(
        'No hay espacio suficiente para completar la restauración.',
        507
      );
      clientError.code = 'INSUFFICIENT_STORAGE';
      clientError.storage = buildStorageHealthSnapshotForPath(extractParent);
      throw clientError;
    }
    throw new Error(reason);
  }
  return {
    targetPath: absoluteTarget,
    extractParent
  };
}

async function runStorageJobById(jobId) {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const row = getToolsBackgroundJobByIdStmt.get(safeJobId);
  if (!row) return;
  const status = normalizeStorageJobStatus(row.status);
  if (status === 'completed' || status === 'error') return;
  const runningAt = nowIso();
  updateToolsBackgroundJobRunningStmt.run(runningAt, runningAt, safeJobId);
  const freshRow = getToolsBackgroundJobByIdStmt.get(safeJobId);
  if (!freshRow) return;
  const type = normalizeStorageJobType(freshRow.job_type);
  try {
    let result = {};
    if (type === 'cleanup_residual_analyze') {
      result = await handleStorageCleanupAnalyzeJob(freshRow);
    } else if (type === 'git_merge_branches') {
      result = await handleGitMergeBranchesJob(freshRow);
    } else if (type === 'project_context_refresh') {
      result = await handleProjectContextRefreshJob(freshRow);
    } else if (type === 'local_delete_paths') {
      result = await handleLocalDeletePathsJob(freshRow);
    } else if (type === 'drive_upload_files') {
      result = await handleDriveUploadFilesJob(freshRow);
    } else if (type === 'deployed_backup_create') {
      result = await handleDeployedBackupCreateJob(freshRow);
    } else if (type === 'deployed_backup_restore') {
      result = await handleDeployedBackupRestoreJob(freshRow);
    } else {
      throw new Error('storage_job_type_not_supported');
    }
    const safeResult =
      result && typeof result === 'object'
        ? { ...result }
        : {};
    const completionStage = String(safeResult.__stage || 'completed').trim() || 'completed';
    const completionLog = String(safeResult.__logMessage || 'Job completado').trim() || 'Job completado';
    delete safeResult.__stage;
    delete safeResult.__logMessage;
    markStorageJobCompleted(safeJobId, safeResult, { stage: completionStage }, completionLog);
  } catch (error) {
    const reason = truncateForNotify(error && error.message ? error.message : 'storage_job_failed', 900);
    markStorageJobError(safeJobId, reason, { stage: 'error' });
  }
}

function scheduleStorageJob(jobId) {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId || activeStorageJobWorkers.has(safeJobId)) return;
  activeStorageJobWorkers.add(safeJobId);
  setTimeout(() => {
    void runStorageJobById(safeJobId).finally(() => {
      activeStorageJobWorkers.delete(safeJobId);
    });
  }, 15);
}

function resumePendingStorageJobs() {
  const rows = listPendingToolsBackgroundJobsStmt.all(storageJobPollMaxItems);
  rows.forEach((row) => {
    const jobId = String(row && row.id ? row.id : '').trim();
    if (!jobId) return;
    scheduleStorageJob(jobId);
  });
}

function normalizeDrivePathFromRoot(rootPath, fullPath) {
  const safeRoot = normalizeDriveRemotePath(rootPath);
  const safeFull = normalizeDriveRemotePath(fullPath);
  if (!safeFull) return '';
  if (!safeRoot) return safeFull;
  if (safeFull === safeRoot) return '';
  const rel = path.posix.relative(safeRoot, safeFull);
  if (!rel || rel === '.' || rel.startsWith('..')) {
    return safeFull;
  }
  return normalizeDriveRemotePath(rel);
}

function resolveDrivePathFromRoot(rootPath, requestedPath = '') {
  const safeRoot = normalizeDriveRemotePath(rootPath);
  const safeRequested = normalizeDriveRemotePath(requestedPath);
  if (!safeRequested) return safeRoot;
  if (!safeRoot) return safeRequested;
  if (safeRequested === safeRoot || safeRequested.startsWith(`${safeRoot}/`)) {
    return safeRequested;
  }
  return joinDriveRemotePath(safeRoot, safeRequested);
}

function buildDriveAboutFromRclonePayload(payload = {}) {
  const toBytes = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  };
  const total = toBytes(payload.total);
  const used = toBytes(payload.used);
  const free = toBytes(payload.free);
  const usage = used;
  const usageInDrive = used;
  return {
    email: '',
    displayName: '',
    quota: {
      limit: total,
      usage,
      usageInDrive,
      free
    }
  };
}

function buildDriveAccountCredentialSummary(credentials = {}, details = {}) {
  const remoteName = normalizeDriveRemoteName(
    credentials.remote_name || credentials.remoteName || details.remoteName || driveDefaultRemoteName
  );
  const configPath = resolveRcloneConfigPath(credentials.config_path || credentials.configPath || details.configPath);
  const rootPath = normalizeDriveRemotePath(credentials.root_path || credentials.rootPath || details.rootPath || '');
  return {
    remoteName,
    configPath,
    rootPath
  };
}

function serializeDriveAccountRow(row) {
  if (!row || typeof row !== 'object') return null;
  const details = safeParseJsonObject(row.details_json);
  let credentials = {};
  try {
    credentials = parseDriveAccountCredentials(row);
  } catch (_error) {
    credentials = {};
  }
  const summary = buildDriveAccountCredentialSummary(credentials, details);
  const remoteName = summary.remoteName;
  const configPath = summary.configPath;
  const rootPath = normalizeDriveRemotePath(
    String(row.root_folder_id || '').trim() || summary.rootPath || driveDefaultRootPath
  );
  const status = normalizeDriveAccountStatus(row.status);
  const validatedAt = parseIsoDateOrEmpty(details.validatedAt || '');
  const connectionState =
    status === 'active'
      ? 'active'
      : status === 'error'
        ? 'invalid'
        : status === 'pending'
          ? 'pending'
          : 'unknown';
  const about = details.about && typeof details.about === 'object' ? details.about : {};
  return {
    id: String(row.id || '').trim(),
    alias: String(row.alias || '').trim() || `Drive ${String(row.id || '').slice(-6)}`,
    authMode: 'rclone',
    rootFolderId: buildDriveFileIdFromPath(rootPath),
    status,
    lastError: String(row.last_error || '').trim(),
    details: {
      remoteName,
      configPath,
      rootPath: buildDriveFileIdFromPath(rootPath),
      provider: 'rclone',
      connectionState,
      validatedAt,
      about: {
        limit: Number.isFinite(Number(about.limit)) ? Number(about.limit) : null,
        usage: Number.isFinite(Number(about.usage)) ? Number(about.usage) : null,
        usageInDrive: Number.isFinite(Number(about.usageInDrive)) ? Number(about.usageInDrive) : null,
        free: Number.isFinite(Number(about.free)) ? Number(about.free) : null
      }
    },
    createdAt: String(row.created_at || '').trim(),
    updatedAt: String(row.updated_at || '').trim()
  };
}

async function getDriveContextForUser(userId, accountId, options = {}) {
  const safeUserId = getSafeUserId(userId);
  const safeAccountId = String(accountId || '').trim();
  if (!safeUserId || !safeAccountId) {
    throw createClientRequestError('Cuenta de Google Drive inválida.', 400);
  }
  const row = getDriveAccountByIdForUserStmt.get(safeAccountId, safeUserId);
  if (!row) {
    throw createClientRequestError('Cuenta de Google Drive no encontrada.', 404);
  }
  const account = serializeDriveAccountRow(row);
  const credentials = parseDriveAccountCredentials(row);
  const summary = buildDriveAccountCredentialSummary(credentials, safeParseJsonObject(row.details_json));
  const remoteName = normalizeDriveRemoteName(summary.remoteName || driveDefaultRemoteName);
  if (!remoteName) {
    throw createClientRequestError(
      'La cuenta no tiene remote de rclone. Reconfigúrala en Tools > Storage > Google Drive.',
      409
    );
  }
  const rootPath = normalizeDriveRemotePath(
    String(row.root_folder_id || '').trim() || summary.rootPath || driveDefaultRootPath
  );
  const configPath = resolveRcloneConfigPath(
    String(options.configPath || '').trim() || summary.configPath || ''
  );
  assertRcloneRemoteExists(remoteName, configPath);
  return {
    row,
    account,
    credentials,
    remoteName,
    rootPath,
    configPath
  };
}

async function validateDriveAccountByIdForUser(userId, accountId) {
  const safeUserId = getSafeUserId(userId);
  const context = await getDriveContextForUser(safeUserId, accountId);
  const rootTarget = buildRcloneTarget(context.remoteName, context.rootPath);
  const aboutResult = runRcloneCommandSync(['about', rootTarget, '--json'], {
    configPath: context.configPath,
    allowNonZero: true,
    timeoutMs: 1000 * 30
  });
  if (!aboutResult.ok) {
    const reason = truncateForNotify(
      aboutResult.stderr || aboutResult.stdout || 'drive_about_failed',
      220
    );
    throw createClientRequestError(`No se pudo validar cuota en Google Drive (rclone): ${reason}`, 502);
  }
  const aboutPayload = parseRcloneJsonOutput(aboutResult.stdout, {});
  const probeResult = runRcloneCommandSync(['lsjson', rootTarget, '--max-depth', '1'], {
    configPath: context.configPath,
    allowNonZero: true,
    timeoutMs: 1000 * 30
  });
  if (!probeResult.ok) {
    const mkdirResult = runRcloneCommandSync(['mkdir', rootTarget], {
      configPath: context.configPath,
      allowNonZero: true,
      timeoutMs: 1000 * 30
    });
    if (!mkdirResult.ok) {
      const reason = truncateForNotify(
        probeResult.stderr || probeResult.stdout || mkdirResult.stderr || mkdirResult.stdout || 'drive_probe_failed',
        220
      );
      throw createClientRequestError(`No se pudo acceder a Google Drive por rclone: ${reason}`, 502);
    }
  }
  const about = buildDriveAboutFromRclonePayload(aboutPayload);
  const details = safeParseJsonObject(context.row.details_json);
  details.provider = 'rclone';
  details.remoteName = context.remoteName;
  details.configPath = context.configPath;
  details.rootPath = buildDriveFileIdFromPath(context.rootPath);
  details.validatedAt = nowIso();
  details.about = {
    limit: about.quota.limit,
    usage: about.quota.usage,
    usageInDrive: about.quota.usageInDrive,
    free: about.quota.free
  };
  updateDriveAccountMetaStmt.run(
    String(context.row.alias || '').trim(),
    normalizeDriveRemotePath(context.rootPath),
    'active',
    '',
    JSON.stringify(details),
    nowIso(),
    String(context.row.id || '').trim(),
    safeUserId
  );
  const refreshed = getDriveAccountByIdForUserStmt.get(String(context.row.id || '').trim(), safeUserId);
  return {
    account: serializeDriveAccountRow(refreshed),
    about
  };
}

async function listDriveFilesForAccount(userId, accountId, options = {}) {
  const context = await getDriveContextForUser(userId, accountId);
  const requestedFolder = normalizeDriveRemotePath(options.folderId || '');
  const fullFolderPath = resolveDrivePathFromRoot(context.rootPath, requestedFolder);
  const folderTarget = buildRcloneTarget(context.remoteName, fullFolderPath);
  const result = runRcloneCommandSync(['lsjson', folderTarget, '--max-depth', '1'], {
    configPath: context.configPath,
    allowNonZero: true,
    timeoutMs: 1000 * 60
  });
  const stderrLower = String(result.stderr || '').toLowerCase();
  if (!result.ok && !stderrLower.includes('directory not found') && !stderrLower.includes('not found')) {
    const reason = truncateForNotify(result.stderr || result.stdout || 'drive_list_failed', 220);
    throw createClientRequestError(`No se pudo listar Google Drive (rclone): ${reason}`, 502);
  }
  const rawItems = result.ok ? parseRcloneJsonOutput(result.stdout, []) : [];
  const query = String(options.query || '').trim().toLowerCase();
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map((entry) => {
      const isDir = Boolean(entry && entry.IsDir);
      const name = String(
        (entry && (entry.Name || entry.Path || entry.name || entry.path)) || ''
      ).trim();
      if (!name || name === '.' || name === '..') return null;
      const fullPath = joinDriveRemotePath(fullFolderPath, name);
      const relativePath = normalizeDrivePathFromRoot(context.rootPath, fullPath);
      const parentRelative = normalizeDrivePathFromRoot(context.rootPath, fullFolderPath);
      const modifiedAt = parseIsoDateOrEmpty(entry && (entry.ModTime || entry.modTime || entry.ModifiedAt));
      const sizeRaw = Number(entry && (entry.Size ?? entry.size));
      return {
        id: buildDriveFileIdFromPath(relativePath),
        name,
        mimeType: isDir ? 'application/vnd.google-apps.folder' : inferMimeTypeFromFilename(name),
        sizeBytes: isDir ? null : Number.isFinite(sizeRaw) ? Math.max(0, sizeRaw) : null,
        createdAt: modifiedAt || '',
        modifiedAt: modifiedAt || '',
        parents: [buildDriveFileIdFromPath(parentRelative)],
        appProperties: {
          remotePath: buildDriveFileIdFromPath(relativePath)
        }
      };
    })
    .filter(Boolean)
    .filter((entry) => !query || String(entry.name || '').toLowerCase().includes(query))
    .sort((a, b) => {
      const aDir = a.mimeType === 'application/vnd.google-apps.folder' ? 0 : 1;
      const bDir = b.mimeType === 'application/vnd.google-apps.folder' ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  return {
    account: serializeDriveAccountRow(context.row),
    folderId: buildDriveFileIdFromPath(normalizeDrivePathFromRoot(context.rootPath, fullFolderPath)),
    nextPageToken: '',
    files: items
  };
}

async function deleteDriveFileForAccount(userId, accountId, fileId) {
  const context = await getDriveContextForUser(userId, accountId);
  const requestedPath = parseDrivePathFromFileId(fileId);
  if (!requestedPath) {
    throw createClientRequestError('fileId inválido para borrar en Google Drive.', 400);
  }
  const fullPath = resolveDrivePathFromRoot(context.rootPath, requestedPath);
  const target = buildRcloneTarget(context.remoteName, fullPath);
  let deleted = false;
  const deleteFileResult = runRcloneCommandSync(['deletefile', target], {
    configPath: context.configPath,
    allowNonZero: true,
    timeoutMs: 1000 * 60
  });
  if (deleteFileResult.ok) {
    deleted = true;
  } else {
    const purgeResult = runRcloneCommandSync(['purge', target], {
      configPath: context.configPath,
      allowNonZero: true,
      timeoutMs: 1000 * 60 * 2
    });
    if (purgeResult.ok) {
      deleted = true;
    } else {
      const reason = truncateForNotify(
        deleteFileResult.stderr ||
          deleteFileResult.stdout ||
          purgeResult.stderr ||
          purgeResult.stdout ||
          'drive_delete_failed',
        220
      );
      throw createClientRequestError(`No se pudo borrar en Google Drive (rclone): ${reason}`, 502);
    }
  }
  const normalizedFileId = buildDriveFileIdFromPath(normalizeDrivePathFromRoot(context.rootPath, fullPath));
  markDeployedCloudBackupDeletedByDriveFileStmt.run(nowIso(), getSafeUserId(userId), String(accountId), normalizedFileId);
  if (normalizedFileId !== String(fileId || '').trim()) {
    markDeployedCloudBackupDeletedByDriveFileStmt.run(
      nowIso(),
      getSafeUserId(userId),
      String(accountId),
      String(fileId || '').trim()
    );
  }
  return {
    deleted,
    fileId: normalizedFileId,
    account: serializeDriveAccountRow(context.row)
  };
}

async function ensureDriveBackupFolder(context, appId) {
  const codexFolderPath = joinDriveRemotePath(context.rootPath, 'CodexWebBackups');
  const appFolderPath = joinDriveRemotePath(codexFolderPath, buildAppBackupQuery(appId));
  const codexTarget = buildRcloneTarget(context.remoteName, codexFolderPath);
  const appTarget = buildRcloneTarget(context.remoteName, appFolderPath);
  runRcloneCommandSync(['mkdir', codexTarget], {
    configPath: context.configPath,
    allowNonZero: true,
    timeoutMs: 1000 * 30
  });
  runRcloneCommandSync(['mkdir', appTarget], {
    configPath: context.configPath,
    allowNonZero: true,
    timeoutMs: 1000 * 30
  });
  return {
    codexFolderId: buildDriveFileIdFromPath(normalizeDrivePathFromRoot(context.rootPath, codexFolderPath)),
    appFolderId: buildDriveFileIdFromPath(normalizeDrivePathFromRoot(context.rootPath, appFolderPath)),
    appFolderPath
  };
}

async function uploadFileToDrive(context, payload) {
  const localPath = normalizeAbsoluteStoragePath(payload.localPath);
  if (!localPath) {
    throw createClientRequestError('Ruta local inválida para subir a Google Drive.', 400);
  }
  let stats = null;
  try {
    stats = fs.statSync(localPath);
  } catch (_error) {
    stats = null;
  }
  if (!stats || !stats.isFile()) {
    throw createClientRequestError('Solo se pueden subir archivos locales existentes.', 400);
  }
  const parentPath = resolveDrivePathFromRoot(context.rootPath, payload.parentId);
  const driveName = sanitizeDriveFileName(payload.fileName || path.basename(localPath), path.basename(localPath));
  const fullRemotePath = joinDriveRemotePath(parentPath, driveName);
  const target = buildRcloneTarget(context.remoteName, fullRemotePath);
  const copyResult = runRcloneCommandSync(['copyto', localPath, target], {
    configPath: context.configPath,
    allowNonZero: true,
    timeoutMs: 1000 * 60 * 10
  });
  if (!copyResult.ok) {
    const reason = truncateForNotify(copyResult.stderr || copyResult.stdout || 'drive_upload_failed', 220);
    throw createClientRequestError(`No se pudo subir a Google Drive (rclone): ${reason}`, 502);
  }
  const relativePath = normalizeDrivePathFromRoot(context.rootPath, fullRemotePath);
  const parentRelative = normalizeDrivePathFromRoot(context.rootPath, parentPath);
  return {
    id: buildDriveFileIdFromPath(relativePath),
    name: driveName,
    sizeBytes: Number(stats.size || 0),
    mimeType: inferMimeTypeFromFilename(driveName),
    createdAt: nowIso(),
    parents: [buildDriveFileIdFromPath(parentRelative)],
    appProperties:
      payload && payload.appProperties && typeof payload.appProperties === 'object'
        ? payload.appProperties
        : {},
    localPath
  };
}

function extractJsonObjectFromFreeText(rawValue) {
  const source = String(rawValue || '').trim();
  if (!source) return null;
  const candidates = [source];
  const fencedMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    candidates.push(String(fencedMatch[1]).trim());
  }
  const firstBrace = source.indexOf('{');
  const lastBrace = source.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(source.slice(firstBrace, lastBrace + 1));
  }
  const pushBalancedObjects = (text) => {
    const raw = String(text || '');
    if (!raw) return;
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (char === '\\\\') {
          escape = true;
        } else if (char === '\"') {
          inString = false;
        }
        continue;
      }
      if (char === '\"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        if (depth === 0) {
          start = index;
        }
        depth += 1;
        continue;
      }
      if (char === '}') {
        if (depth <= 0) continue;
        depth -= 1;
        if (depth === 0 && start >= 0) {
          const segment = raw.slice(start, index + 1).trim();
          if (segment) {
            candidates.push(segment);
          }
          start = -1;
        }
      }
    }
  };
  pushBalancedObjects(source);
  if (fencedMatch && fencedMatch[1]) {
    pushBalancedObjects(String(fencedMatch[1] || ''));
  }
  let fallbackObject = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const item = String(candidates[index] || '').trim();
    if (!item) continue;
    try {
      const parsed = JSON.parse(item);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const summaryText = normalizeProjectContextText(
          parsed.summary || parsed.resumen || parsed.projectSummary || '',
          280
        );
        const listFields = [
          parsed.objectives,
          parsed.objetivos,
          parsed.decisions,
          parsed.decisiones,
          parsed.constraints,
          parsed.restricciones,
          parsed.facts,
          parsed.hechos,
          parsed.openQuestions,
          parsed.open_questions,
          parsed.nextSteps,
          parsed.next_steps
        ];
        const hasListContent = listFields.some((field) => {
          if (!Array.isArray(field)) return false;
          return field.some((entry) => {
            const text = normalizeProjectContextText(entry, 80);
            return Boolean(text && text !== '...');
          });
        });
        const hasDomainKey =
          Object.prototype.hasOwnProperty.call(parsed, 'summary') ||
          Object.prototype.hasOwnProperty.call(parsed, 'resumen') ||
          Object.prototype.hasOwnProperty.call(parsed, 'objectives') ||
          Object.prototype.hasOwnProperty.call(parsed, 'decisions') ||
          Object.prototype.hasOwnProperty.call(parsed, 'constraints') ||
          Object.prototype.hasOwnProperty.call(parsed, 'facts') ||
          Object.prototype.hasOwnProperty.call(parsed, 'nextSteps');
        const meaningfulSummary = Boolean(summaryText && summaryText !== '...');
        if (hasDomainKey && (meaningfulSummary || hasListContent)) {
          return parsed;
        }
        if (!fallbackObject) {
          fallbackObject = parsed;
        }
      }
    } catch (_error) {
      // ignore malformed candidate
    }
  }
  return fallbackObject;
}

function normalizeProjectContextList(value, maxItems = 12, maxCharsPerItem = 220) {
  const source = Array.isArray(value) ? value : [];
  const normalized = [];
  for (let index = 0; index < source.length; index += 1) {
    if (normalized.length >= maxItems) break;
    const item = normalizeProjectContextText(source[index], maxCharsPerItem);
    if (!item) continue;
    normalized.push(item);
  }
  return normalized;
}

function formatProjectContextSummaryFromPayload(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const headline = normalizeProjectContextText(
    data.summary || data.resumen || data.projectSummary || '',
    1400
  );
  const objectives = normalizeProjectContextList(data.objectives || data.objetivos, 10, 200);
  const decisions = normalizeProjectContextList(data.decisions || data.decisiones, 12, 220);
  const constraints = normalizeProjectContextList(data.constraints || data.restricciones, 10, 220);
  const openQuestions = normalizeProjectContextList(
    data.openQuestions || data.open_questions || data.preguntasAbiertas,
    10,
    220
  );
  const nextSteps = normalizeProjectContextList(
    data.nextSteps || data.next_steps || data.siguientesPasos,
    10,
    220
  );
  const facts = normalizeProjectContextList(data.facts || data.hechos, 12, 220);
  const lines = [];
  if (headline) {
    lines.push(`Resumen: ${headline}`);
  }
  if (objectives.length > 0) {
    lines.push('Objetivos:');
    objectives.forEach((entry) => lines.push(`- ${entry}`));
  }
  if (decisions.length > 0) {
    lines.push('Decisiones:');
    decisions.forEach((entry) => lines.push(`- ${entry}`));
  }
  if (constraints.length > 0) {
    lines.push('Restricciones:');
    constraints.forEach((entry) => lines.push(`- ${entry}`));
  }
  if (facts.length > 0) {
    lines.push('Hechos relevantes:');
    facts.forEach((entry) => lines.push(`- ${entry}`));
  }
  if (openQuestions.length > 0) {
    lines.push('Preguntas abiertas:');
    openQuestions.forEach((entry) => lines.push(`- ${entry}`));
  }
  if (nextSteps.length > 0) {
    lines.push('Siguientes pasos:');
    nextSteps.forEach((entry) => lines.push(`- ${entry}`));
  }
  return normalizeProjectContextText(lines.join('\n').trim(), projectContextAutoMaxChars);
}

function buildProjectContextMessageDigest(rows) {
  const list = Array.isArray(rows) ? rows.slice().reverse() : [];
  const lines = [];
  list.forEach((entry) => {
    const role = String(entry && entry.role ? entry.role : '').trim().toLowerCase();
    if (role !== 'user' && role !== 'assistant' && role !== 'system') return;
    const content = normalizeProjectContextText(entry && entry.content ? entry.content : '', projectContextPromptMessageChars);
    if (!content) return;
    const conversationId = Number(entry && entry.conversation_id);
    const conversationTitle = normalizeProjectContextText(entry && entry.conversation_title ? entry.conversation_title : '', 80);
    const label = role === 'user' ? 'Usuario' : role === 'assistant' ? 'Asistente' : 'Sistema';
    lines.push(
      `${label} [chat:${Number.isInteger(conversationId) ? conversationId : 'n/a'} ${conversationTitle}]: ${content}`
    );
  });
  return lines.join('\n');
}

function buildProjectContextAiPrompt(projectRow, messageRows) {
  const projectName = sanitizeProjectName(projectRow && projectRow.name ? projectRow.name : '') || 'Proyecto';
  const mode = normalizeProjectContextMode(projectRow && projectRow.context_mode ? projectRow.context_mode : 'mixed', 'mixed');
  const manualContext = normalizeProjectContextText(projectRow && projectRow.manual_context ? projectRow.manual_context : '', 5000);
  const existingAutoContext = normalizeProjectContextText(projectRow && projectRow.auto_context ? projectRow.auto_context : '', 5000);
  const digest = buildProjectContextMessageDigest(messageRows);
  const lines = [
    'Eres un sintetizador de memoria persistente para un proyecto con varios chats.',
    'Devuelve SOLO JSON válido (sin markdown, sin texto adicional) con esta forma:',
    '{"summary":"...", "objectives":["..."], "decisions":["..."], "constraints":["..."], "facts":["..."], "openQuestions":["..."], "nextSteps":["..."]}',
    'No inventes datos. Mantén información concreta y útil para continuar futuros chats.',
    'Evita ruido y duplicados. Si algo no es seguro, no lo afirmes como hecho.',
    '',
    `Proyecto: ${projectName}`,
    `Modo de contexto: ${mode}`,
    manualContext ? `Contexto manual base:\n${manualContext}` : 'Contexto manual base: (vacío)',
    existingAutoContext ? `Memoria automática previa:\n${existingAutoContext}` : 'Memoria automática previa: (vacía)',
    '',
    'Mensajes recientes del proyecto (multichat):',
    digest || '(sin mensajes)',
    '',
    'Genera una memoria breve y accionable para reutilizar en próximos chats.'
  ];
  return lines.join('\n');
}

function buildProjectContextHeuristicFallback(projectRow, messageRows) {
  const rows = Array.isArray(messageRows) ? messageRows.slice().reverse() : [];
  const latestUser = [];
  const latestAssistant = [];
  rows.forEach((entry) => {
    const role = String(entry && entry.role ? entry.role : '').trim().toLowerCase();
    const content = normalizeProjectContextText(entry && entry.content ? entry.content : '', 220);
    if (!content) return;
    if (role === 'user' && latestUser.length < 8) {
      latestUser.push(content);
    } else if (role === 'assistant' && latestAssistant.length < 8) {
      latestAssistant.push(content);
    }
  });
  const lines = [];
  const manual = normalizeProjectContextText(projectRow && projectRow.manual_context ? projectRow.manual_context : '', 2200);
  if (manual) {
    lines.push('Contexto manual vigente:');
    lines.push(manual);
  }
  if (latestUser.length > 0) {
    lines.push('Últimas peticiones del usuario:');
    latestUser.slice(0, 6).forEach((entry) => lines.push(`- ${entry}`));
  }
  if (latestAssistant.length > 0) {
    lines.push('Últimas respuestas útiles:');
    latestAssistant.slice(0, 6).forEach((entry) => lines.push(`- ${entry}`));
  }
  if (lines.length === 0) {
    lines.push('Aún no hay suficiente conversación para generar memoria automática.');
  }
  return normalizeProjectContextText(lines.join('\n'), projectContextAutoMaxChars);
}

async function summarizeProjectContextWithAi(userId, username, projectRow, messageRows) {
  const prompt = buildProjectContextAiPrompt(projectRow, messageRows);
  const runtime = resolveChatAgentRuntimeForUser(userId);
  const attemptedProviders = [];
  const activeProviderId = normalizeSupportedAiAgentId(runtime && runtime.activeAgentId ? runtime.activeAgentId : '');
  const activeProviderDef = getAiProviderDefinition(activeProviderId);
  const activeProviderName =
    String((activeProviderDef && activeProviderDef.name) || runtime.activeAgentName || activeProviderId || '').trim();

  const parseOutputSummary = (output) => {
    const text = normalizeProjectContextText(output, 16000);
    if (!text) return '';
    const parsed = extractJsonObjectFromFreeText(text);
    if (parsed) {
      const summarized = formatProjectContextSummaryFromPayload(parsed);
      if (summarized) return summarized;
    }
    return normalizeProjectContextText(text, projectContextAutoMaxChars);
  };

  const tryHttpProvider = async (providerId, providerName) => {
    const adapter = getAiHttpProviderAdapter(providerId);
    if (!adapter || typeof adapter.buildChatRequest !== 'function') {
      return {
        used: false,
        reason: 'provider_not_http',
        summary: '',
        providerId,
        providerName
      };
    }
    const integration = getUserAiAgentIntegration(userId, providerId);
    const configured = isAiAgentConfiguredForUser(
      providerId,
      integration,
      getAiAgentSerializationOptionsForUser(userId)
    );
    if (!configured) {
      return {
        used: false,
        reason: 'provider_not_configured',
        summary: '',
        providerId,
        providerName
      };
    }
    const model = normalizeChatAgentModel(providerId, runtime.defaults.model || getChatAgentDefaultModel(providerId));
    const baseUrl = resolveAiProviderBaseUrl(providerId, integration) || adapter.defaultBaseUrl;
    const request = adapter.buildChatRequest({
      model,
      prompt,
      integration,
      baseUrl,
      reasoningEffort: runtime.defaults.reasoningEffort
    });
    const endpoint = String(request && request.endpoint ? request.endpoint : '').trim();
    if (!endpoint) {
      return {
        used: false,
        reason: 'provider_endpoint_missing',
        summary: '',
        providerId,
        providerName
      };
    }
    const headers =
      request && request.headers && typeof request.headers === 'object'
        ? request.headers
        : { 'Content-Type': 'application/json' };
    const body =
      request && request.body && typeof request.body === 'object'
        ? { ...request.body, stream: false }
        : {
            model,
            stream: false,
            messages: [{ role: 'user', content: prompt }]
          };
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        let reason = '';
        try {
          reason = truncateForNotify(await response.text(), 220);
        } catch (_error) {
          reason = '';
        }
        return {
          used: false,
          reason: reason || `http_${response.status}`,
          summary: '',
          providerId,
          providerName
        };
      }
      let output = '';
      try {
        const payload = await response.json();
        const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
        const messageObject = choice && choice.message && typeof choice.message === 'object' ? choice.message : {};
        output =
          extractTextFromProviderPayload(messageObject.content) ||
          extractTextFromProviderPayload(choice && choice.text ? choice.text : '') ||
          extractTextFromProviderPayload(payload && payload.response ? payload.response : '') ||
          extractTextFromProviderPayload(payload && payload.message ? payload.message : '');
      } catch (_jsonError) {
        try {
          output = String(await response.text()).trim();
        } catch (_textError) {
          output = '';
        }
      }
      const summary = parseOutputSummary(output);
      return {
        used: Boolean(summary),
        reason: summary ? '' : 'ai_parse_empty',
        summary,
        providerId,
        providerName
      };
    } catch (error) {
      return {
        used: false,
        reason: truncateForNotify(error && error.message ? error.message : 'provider_request_failed', 180),
        summary: '',
        providerId,
        providerName
      };
    }
  };

  const tryCodexCli = async () => {
    let codexPath = '';
    try {
      codexPath = await resolveCodexPath();
    } catch (_error) {
      codexPath = '';
    }
    if (!codexPath) {
      return {
        used: false,
        reason: 'codex_unavailable',
        summary: '',
        providerId: 'codex-cli',
        providerName: 'Codex CLI'
      };
    }
    try {
      const result = await execFileAsync(
        codexPath,
        [
          '-c',
          'shell_environment_policy.inherit=all',
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'danger-full-access',
          '--color',
          'never',
          prompt
        ],
        {
          env: getCodexEnvForUser(userId, { username }),
          cwd: process.cwd(),
          timeout: 1000 * 90,
          maxBuffer: 1024 * 1024 * 8
        }
      );
      const stdout = truncateRawText(stripAnsi(String(result && result.stdout ? result.stdout : '')).trim(), 160000);
      const stderr = truncateRawText(stripAnsi(String(result && result.stderr ? result.stderr : '')).trim(), 160000);
      const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
      const summary = parseOutputSummary(combined);
      return {
        used: Boolean(summary),
        reason: summary ? '' : 'ai_parse_empty',
        summary,
        providerId: 'codex-cli',
        providerName: 'Codex CLI'
      };
    } catch (error) {
      return {
        used: false,
        reason: truncateForNotify(error && error.message ? error.message : 'ai_failed', 180),
        summary: '',
        providerId: 'codex-cli',
        providerName: 'Codex CLI'
      };
    }
  };

  if (activeProviderId && activeProviderId !== 'codex-cli') {
    attemptedProviders.push(activeProviderId);
    const activeAttempt = await tryHttpProvider(activeProviderId, activeProviderName || activeProviderId);
    if (activeAttempt.used) {
      return {
        ...activeAttempt,
        attemptedProviders
      };
    }
  }

  attemptedProviders.push('codex-cli');
  const codexAttempt = await tryCodexCli();
  if (codexAttempt.used) {
    return {
      ...codexAttempt,
      attemptedProviders
    };
  }

  return {
    used: false,
    reason: codexAttempt.reason || 'ai_unavailable',
    summary: '',
    providerId: codexAttempt.providerId || '',
    providerName: codexAttempt.providerName || '',
    attemptedProviders
  };
}

async function regenerateProjectAutoContext(userId, projectId, options = {}) {
  const safeUserId = getSafeUserId(userId);
  const safeProjectId = Number(projectId);
  if (!safeUserId || !Number.isInteger(safeProjectId) || safeProjectId <= 0) {
    throw createClientRequestError('Proyecto inválido para regenerar contexto.', 400);
  }
  const force = Boolean(options.force);
  const projectRow = getChatProjectByIdForUserStmt.get(safeProjectId, safeUserId);
  if (!projectRow) {
    throw createClientRequestError('Proyecto no encontrado.', 404);
  }
  const latestMessageRow = getProjectMessageMaxIdStmt.get(safeUserId, safeProjectId);
  const latestMessageId = Math.max(0, Number(latestMessageRow && latestMessageRow.max_message_id) || 0);
  const previousMessageId = Math.max(0, Number(projectRow.auto_last_message_id) || 0);
  const hasNewMessages = latestMessageId > previousMessageId;
  if (!force && !hasNewMessages) {
    return {
      updated: false,
      skipped: true,
      reason: 'no_new_messages',
      project: serializeChatProjectRow(projectRow, { includeContext: true }),
      ai: {
        used: false,
        providerId: '',
        providerName: '',
        fallbackReason: 'no_new_messages',
        attemptedProviders: []
      },
      summary: normalizeProjectContextText(projectRow.auto_context, projectContextAutoMaxChars),
      latestMessageId,
      messageCount: 0
    };
  }

  const messageRows = listRecentProjectMessagesForSummaryStmt.all(
    safeUserId,
    safeProjectId,
    projectContextPromptMessagesLimit
  );
  const usernameRow = getUsernameByIdStmt.get(safeUserId);
  const username = String((usernameRow && usernameRow.username) || '').trim();

  let aiState = {
    used: false,
    summary: '',
    reason: 'ai_unavailable',
    providerId: '',
    providerName: '',
    attemptedProviders: []
  };
  if (typeof options.onProgress === 'function') {
    options.onProgress({
      stage: 'ai',
      stageLabel: 'Sintetizando memoria de proyecto',
      percent: 72,
      messages: messageRows.length
    });
  }
  aiState = await summarizeProjectContextWithAi(safeUserId, username, projectRow, messageRows);
  const fallbackSummary = buildProjectContextHeuristicFallback(projectRow, messageRows);
  const summary = normalizeProjectContextText(
    aiState.used ? aiState.summary : fallbackSummary,
    projectContextAutoMaxChars
  );
  const generatedAt = nowIso();
  const meta = {
    generatedAt,
    messagesUsed: Array.isArray(messageRows) ? messageRows.length : 0,
    aiUsed: Boolean(aiState.used),
    providerId: String(aiState.providerId || '').trim(),
    providerName: String(aiState.providerName || '').trim(),
    fallbackReason: aiState.used ? '' : String(aiState.reason || 'heuristic_fallback'),
    attemptedProviders: Array.isArray(aiState.attemptedProviders)
      ? aiState.attemptedProviders.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []
  };
  updateChatProjectAutoContextStmt.run(
    summary,
    JSON.stringify(meta),
    latestMessageId,
    generatedAt,
    nowIso(),
    safeProjectId,
    safeUserId
  );
  const refreshed = getChatProjectByIdForUserStmt.get(safeProjectId, safeUserId);
  return {
    updated: true,
    skipped: false,
    reason: '',
    project: serializeChatProjectRow(refreshed, { includeContext: true }),
    ai: {
      used: Boolean(aiState.used),
      providerId: String(aiState.providerId || '').trim(),
      providerName: String(aiState.providerName || '').trim(),
      fallbackReason: aiState.used ? '' : String(aiState.reason || 'heuristic_fallback'),
      attemptedProviders: Array.isArray(aiState.attemptedProviders)
        ? aiState.attemptedProviders.map((entry) => String(entry || '').trim()).filter(Boolean)
        : []
    },
    summary,
    latestMessageId,
    messageCount: Array.isArray(messageRows) ? messageRows.length : 0
  };
}

async function handleProjectContextRefreshJob(row) {
  const payload = safeParseJsonObject(row.payload_json);
  const safeUserId = getSafeUserId(row.user_id);
  if (!safeUserId) {
    throw createClientRequestError('Job de contexto de proyecto inválido: user_id.', 400);
  }
  const projectId = parseProjectIdInput(payload.projectId);
  if (!projectId) {
    throw createClientRequestError('Job de contexto de proyecto inválido: projectId.', 400);
  }
  const trigger = normalizeProjectContextText(payload.trigger || 'auto', 80) || 'auto';
  const project = getOwnedProjectOrNull(projectId, safeUserId);
  if (!project) {
    throw createClientRequestError('Proyecto no encontrado para job de contexto.', 404);
  }
  setStorageJobProgress(
    row.id,
    {
      stage: 'collecting',
      stageLabel: 'Recopilando mensajes del proyecto',
      percent: 12,
      projectId,
      projectName: sanitizeProjectName(project.name)
    },
    `Actualizando contexto de proyecto (${sanitizeProjectName(project.name) || projectId})`
  );
  const result = await regenerateProjectAutoContext(safeUserId, projectId, {
    force: Boolean(payload.force),
    onProgress: (progress) => {
      setStorageJobProgress(
        row.id,
        {
          stage: String(progress && progress.stage ? progress.stage : 'running'),
          stageLabel: String(progress && progress.stageLabel ? progress.stageLabel : 'Actualizando contexto'),
          percent: Number.isFinite(Number(progress && progress.percent)) ? Number(progress.percent) : 70,
          projectId,
          projectName: sanitizeProjectName(project.name)
        },
        'Procesando memoria automática del proyecto'
      );
    }
  });
  setStorageJobProgress(
    row.id,
    {
      stage: 'completed',
      stageLabel: 'Contexto de proyecto actualizado',
      percent: 100,
      projectId,
      projectName: sanitizeProjectName(project.name)
    },
    result.ai.used
      ? `Contexto actualizado con ${result.ai.providerName || result.ai.providerId || 'IA'}`
      : `Contexto actualizado con fallback heurístico (${result.ai.fallbackReason || 'ia_unavailable'})`
  );
  return {
    __stage: 'project_context_completed',
    __logMessage: result.ai.used
      ? 'Regeneración de contexto completada con IA'
      : 'Regeneración de contexto completada con fallback heurístico',
    trigger,
    project: result.project,
    ai: result.ai,
    summary: result.summary,
    messageCount: result.messageCount,
    latestMessageId: result.latestMessageId
  };
}

async function handleGitMergeBranchesJob(row) {
  const payload = safeParseJsonObject(row.payload_json);
  const safeUserId = getSafeUserId(row.user_id);
  if (!safeUserId) {
    throw createClientRequestError('Job de merge inválido: user_id.', 400);
  }
  const repoId = String(payload.repoId || '').trim();
  const sourceBranch = normalizeGitBranchName(payload.sourceBranch);
  const targetBranch = normalizeGitBranchName(payload.targetBranch);
  const repo = findGitRepoById(repoId, { forceRefresh: true });
  if (!repo) {
    throw createClientRequestError('Repositorio Git no encontrado para merge.', 404);
  }
  if (!sourceBranch || !targetBranch) {
    throw createClientRequestError('Job de merge inválido: sourceBranch/targetBranch.', 400);
  }
  if (sourceBranch === targetBranch) {
    throw createClientRequestError('No se puede mergear la misma rama.', 400);
  }
  if (!gitBranchRefExists(repo.absolutePath, sourceBranch)) {
    throw createClientRequestError(`La rama origen no existe: ${sourceBranch}`, 404);
  }
  if (!gitBranchRefExists(repo.absolutePath, targetBranch)) {
    throw createClientRequestError(`La rama destino no existe: ${targetBranch}`, 404);
  }

  const gitIdentity = normalizeGitIdentity(payload.gitIdentity || {});
  const ensuredIdentity = ensureGitIdentityForRepo(repo.absolutePath, gitIdentity);
  if (!ensuredIdentity.ok) {
    throw createClientRequestError(
      `No se pudo preparar identidad Git: ${ensuredIdentity.error || 'git_identity_failed'}`,
      500
    );
  }
  const gitIdentityEnv = buildGitIdentityEnv(ensuredIdentity.identity);
  setStorageJobProgress(
    row.id,
    {
      stage: 'preparing',
      stageLabel: `Preparando merge ${sourceBranch} -> ${targetBranch}`,
      percent: 10,
      sourceBranch,
      targetBranch,
      repoId,
      repoPath: repo.absolutePath
    },
    `Merge en cola: ${sourceBranch} -> ${targetBranch}`
  );

  const checkoutTarget = ensureGitBranchForRepo(repo.absolutePath, targetBranch, { createIfMissing: false });
  if (!checkoutTarget.ok) {
    throw createClientRequestError(`No se pudo cambiar a rama destino: ${checkoutTarget.error}`, 400);
  }
  setStorageJobProgress(
    row.id,
    {
      stage: 'merging',
      stageLabel: `Mergeando ${sourceBranch} -> ${targetBranch}`,
      percent: 45,
      sourceBranch,
      targetBranch,
      repoId
    },
    `Checkout destino OK (${checkoutTarget.branch})`
  );

  const mergeResult = await runGitInRepoAsync(repo.absolutePath, ['merge', '--no-ff', sourceBranch], {
    allowNonZero: true,
    env: gitIdentityEnv,
    timeoutMs: gitToolsCommandTimeoutMs
  });
  const refreshed = collectGitRepoSummary(repo.absolutePath, nowIso(), repo.scanRoot);
  const output = truncateForNotify(
    [checkoutTarget.output, mergeResult.stdout, mergeResult.stderr].filter(Boolean).join('\n'),
    6000
  );
  if (Number(mergeResult.code) !== 0) {
    const hasConflicts = Boolean(refreshed && refreshed.hasConflicts);
    if (hasConflicts) {
      setStorageJobProgress(
        row.id,
        {
          stage: 'conflicts',
          stageLabel: 'Merge con conflictos',
          percent: 100,
          sourceBranch,
          targetBranch,
          hasConflicts: true
        },
        'Merge terminó con conflictos. Requiere resolución manual.'
      );
      return {
        __stage: 'conflicts',
        __logMessage: 'Merge completado con conflictos',
        repo: refreshed || repo,
        merge: {
          sourceBranch,
          targetBranch,
          status: 'conflict',
          hasConflicts: true,
          conflictFiles: refreshed && Array.isArray(refreshed.conflictFiles) ? refreshed.conflictFiles : [],
          output
        }
      };
    }
    throw createClientRequestError(
      `Merge fallido: ${truncateForNotify(mergeResult.stderr || mergeResult.stdout || 'git_merge_failed', 260)}`,
      500
    );
  }

  setStorageJobProgress(
    row.id,
    {
      stage: 'completed',
      stageLabel: 'Merge completado',
      percent: 100,
      sourceBranch,
      targetBranch,
      hasConflicts: Boolean(refreshed && refreshed.hasConflicts)
    },
    `Merge completado: ${sourceBranch} -> ${targetBranch}`
  );
  return {
    repo: refreshed || repo,
    merge: {
      sourceBranch,
      targetBranch,
      status: 'merged',
      hasConflicts: Boolean(refreshed && refreshed.hasConflicts),
      conflictFiles: refreshed && Array.isArray(refreshed.conflictFiles) ? refreshed.conflictFiles : [],
      output
    }
  };
}

async function handleLocalDeletePathsJob(row) {
  const payload = safeParseJsonObject(row.payload_json);
  const paths = parseStoragePathList(payload.paths, 160);
  if (paths.length === 0) {
    throw createClientRequestError('Job de borrado inválido: selecciona al menos una ruta.', 400);
  }
  const deleted = [];
  const failed = [];
  setStorageJobProgress(
    row.id,
    {
      stage: 'deleting',
      stageLabel: 'Borrando rutas locales',
      percent: 1,
      total: paths.length,
      done: 0,
      failed: 0
    },
    `Borrado local iniciado (${paths.length} ruta(s))`
  );
  for (let index = 0; index < paths.length; index += 1) {
    const item = paths[index];
    try {
      const target = assertStorageMutationPathAllowed(item);
      const stats = fs.lstatSync(target);
      if (stats.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: false });
      } else {
        fs.unlinkSync(target);
      }
      deleted.push(target);
    } catch (error) {
      failed.push({
        path: normalizeAbsoluteStoragePath(item, ''),
        error: truncateForNotify(error && error.message ? error.message : 'delete_failed', 260)
      });
    }
    const processed = index + 1;
    setStorageJobProgress(
      row.id,
      {
        stage: 'deleting',
        stageLabel: 'Borrando rutas locales',
        percent: Math.min(99, Math.max(1, Math.round((processed / paths.length) * 100))),
        total: paths.length,
        done: deleted.length,
        failed: failed.length
      },
      `Borrado local: ${processed}/${paths.length}`
    );
  }
  return {
    deleted,
    failed,
    total: paths.length,
    deletedCount: deleted.length,
    failedCount: failed.length,
    summary:
      failed.length > 0
        ? `Borrado parcial: ${deleted.length} eliminado(s), ${failed.length} con error.`
        : `Borrado completado: ${deleted.length} eliminado(s).`
  };
}

async function handleStorageCleanupAnalyzeJob(row) {
  const payload = safeParseJsonObject(row.payload_json);
  const safeUserId = getSafeUserId(row.user_id);
  if (!safeUserId) {
    throw createClientRequestError('Job de análisis residual inválido: user_id.', 400);
  }
  const usernameRow = getUsernameByIdStmt.get(safeUserId);
  const username = String((usernameRow && usernameRow.username) || '').trim();
  const startedAt = nowIso();
  let lastProgressTick = 0;
  setStorageJobProgress(
    row.id,
    {
      stage: 'scanning',
      stageLabel: 'Escaneando rutas residuales',
      percent: 1,
      etaSeconds: null,
      startedAt
    },
    'Análisis residual IA iniciado'
  );
  const result = await analyzeStorageResidualFilesForUser(
    safeUserId,
    username,
    payload && typeof payload === 'object' ? payload : {},
    {
      onProgress: (progress) => {
        const nowMs = Date.now();
        const stage = String(progress && progress.stage ? progress.stage : '').trim();
        if (stage !== 'completed' && nowMs - lastProgressTick < storageResidualProgressTickMs) {
          return;
        }
        lastProgressTick = nowMs;
        setStorageJobProgress(
          row.id,
          {
            ...(progress && typeof progress === 'object' ? progress : {}),
            startedAt
          },
          stage === 'completed'
            ? 'Análisis residual IA completado'
            : `Limpieza IA: ${String(progress && progress.stageLabel ? progress.stageLabel : stage || 'en progreso')}`
        );
      }
    }
  );
  return result;
}

async function handleDriveUploadFilesJob(row) {
  const payload = safeParseJsonObject(row.payload_json);
  const safeUserId = getSafeUserId(row.user_id);
  const accountId = String(payload.accountId || '').trim();
  const localPaths = parseStoragePathList(payload.paths, storageUploadJobMaxFiles);
  const parentId = String(payload.parentId || '').trim();
  if (!accountId || localPaths.length === 0) {
    throw createClientRequestError('Job de subida inválido: faltan cuenta o archivos.', 400);
  }
  const context = await getDriveContextForUser(safeUserId, accountId);
  const uploaded = [];
  const failed = [];
  setStorageJobProgress(
    row.id,
    { total: localPaths.length, done: 0, failed: 0, stage: 'uploading' },
    'Subida a Google Drive (rclone) iniciada'
  );
  for (let index = 0; index < localPaths.length; index += 1) {
    const localPath = localPaths[index];
    try {
      const item = await uploadFileToDrive(context, {
        localPath,
        parentId,
        fileName: path.basename(localPath)
      });
      uploaded.push(item);
      setStorageJobProgress(
        row.id,
        {
          total: localPaths.length,
          done: uploaded.length,
          failed: failed.length,
          stage: 'uploading'
        },
        `Subido: ${item.name}`
      );
    } catch (error) {
      failed.push({
        localPath,
        error: truncateForNotify(error && error.message ? error.message : 'drive_upload_failed', 260)
      });
      setStorageJobProgress(
        row.id,
        {
          total: localPaths.length,
          done: uploaded.length,
          failed: failed.length,
          stage: 'uploading'
        },
        `Error subiendo: ${path.basename(localPath)}`
      );
    }
  }
  if (uploaded.length === 0 && failed.length > 0) {
    throw new Error(
      `No se pudo subir ningún archivo. Primer error: ${truncateForNotify(
        failed[0] && failed[0].error ? failed[0].error : 'drive_upload_failed',
        220
      )}`
    );
  }
  return {
    accountId,
    accountAlias: context.account.alias || context.account.id,
    uploaded,
    failed
  };
}

async function listAppBackupsInDriveForAccount(userId, appId, accountId) {
  const safeUserId = getSafeUserId(userId);
  const safeAppId = String(appId || '').trim();
  if (!safeUserId || !safeAppId) {
    return [];
  }
  const context = await getDriveContextForUser(safeUserId, accountId);
  const appFolderPath = joinDriveRemotePath(context.rootPath, 'CodexWebBackups', buildAppBackupQuery(safeAppId));
  const target = buildRcloneTarget(context.remoteName, appFolderPath);
  const result = runRcloneCommandSync(['lsjson', target, '--max-depth', '1'], {
    configPath: context.configPath,
    allowNonZero: true,
    timeoutMs: 1000 * 60
  });
  const stderrLower = String(result.stderr || '').toLowerCase();
  if (!result.ok && !stderrLower.includes('directory not found') && !stderrLower.includes('not found')) {
    const reason = truncateForNotify(result.stderr || result.stdout || 'backup_list_failed', 220);
    throw createClientRequestError(`No se pudieron listar backups en Drive (rclone): ${reason}`, 502);
  }
  const rawItems = result.ok ? parseRcloneJsonOutput(result.stdout, []) : [];
  const cachedRows = listDeployedCloudBackupsForUserAndAppStmt.all(safeUserId, safeAppId, 200);
  const cachedByFileId = new Map(
    cachedRows.map((entry) => [String(entry && entry.drive_file_id ? entry.drive_file_id : '').trim(), entry])
  );
  const mapped = (Array.isArray(rawItems) ? rawItems : [])
    .filter((entry) => entry && !entry.IsDir)
    .map((entry) => {
      const name = String((entry && (entry.Name || entry.Path)) || '').trim();
      if (!name) return null;
      const fullPath = joinDriveRemotePath(appFolderPath, name);
      const relativePath = normalizeDrivePathFromRoot(context.rootPath, fullPath);
      const fileId = buildDriveFileIdFromPath(relativePath);
      const cached = cachedByFileId.get(fileId) || null;
      const modifiedAt = parseIsoDateOrEmpty(entry && (entry.ModTime || entry.modifiedAt));
      const sizeRaw = Number(entry && (entry.Size ?? entry.size));
      return {
        id: cached ? String(cached.id || '') : buildStorageJobId('backup'),
        appId: safeAppId,
        driveFileId: fileId,
        remoteFileId: fileId,
        accountId: String(accountId || ''),
        accountAlias: String(context.account.alias || context.account.id || '').trim(),
        name,
        targetPath: cached ? String(cached.target_path || '') : '',
        sizeBytes: Number.isFinite(sizeRaw) ? Math.max(0, sizeRaw) : null,
        createdAt: modifiedAt || nowIso(),
        modifiedAt: modifiedAt || '',
        appProperties: {
          remotePath: fileId
        },
        source: 'cloud'
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aTs = Date.parse(String(a.modifiedAt || a.createdAt || '')) || 0;
      const bTs = Date.parse(String(b.modifiedAt || b.createdAt || '')) || 0;
      return bTs - aTs;
    });
  return mapped;
}

async function listAppBackupsFromDrive(userId, appId, accountId = '') {
  const safeUserId = getSafeUserId(userId);
  const safeAppId = String(appId || '').trim();
  if (!safeUserId || !safeAppId) {
    return [];
  }
  const candidateAccountIds = [];
  if (String(accountId || '').trim()) {
    candidateAccountIds.push(String(accountId || '').trim());
  } else {
    const rows = listDriveAccountsForUserStmt.all(safeUserId);
    rows.forEach((row) => {
      const id = String(row && row.id ? row.id : '').trim();
      if (!id) return;
      candidateAccountIds.push(id);
    });
  }
  const deduped = Array.from(new Set(candidateAccountIds));
  const all = [];
  for (const currentAccountId of deduped) {
    try {
      const items = await listAppBackupsInDriveForAccount(safeUserId, safeAppId, currentAccountId);
      all.push(...items);
    } catch (_error) {
      // ignore broken account and continue with remaining ones
    }
  }
  return all.sort((a, b) => {
    const aTs = Date.parse(String(a.modifiedAt || a.createdAt || '')) || 0;
    const bTs = Date.parse(String(b.modifiedAt || b.createdAt || '')) || 0;
    return bTs - aTs;
  });
}

async function pruneDriveBackupsForRetention(userId, accountId, appId) {
  const cutoffMs = Date.now() - storageBackupRetentionDays * 24 * 60 * 60 * 1000;
  const items = await listAppBackupsInDriveForAccount(userId, appId, accountId);
  const removed = [];
  for (const item of items) {
    const createdMs = Date.parse(String(item.modifiedAt || item.createdAt || ''));
    if (!Number.isFinite(createdMs) || createdMs >= cutoffMs) continue;
    try {
      await deleteDriveFileForAccount(userId, accountId, item.driveFileId);
      removed.push({
        id: item.id,
        driveFileId: item.driveFileId,
        createdAt: item.createdAt
      });
    } catch (_error) {
      // keep retention best-effort.
    }
  }
  return {
    retentionDays: storageBackupRetentionDays,
    removed
  };
}

async function handleDeployedBackupCreateJob(row) {
  const payload = safeParseJsonObject(row.payload_json);
  const safeUserId = getSafeUserId(row.user_id);
  const accountId = String(payload.accountId || '').trim();
  const appId = String(payload.appId || '').trim();
  const appName = String(payload.appName || appId).trim() || appId;
  const sourcePath = normalizeAbsoluteStoragePath(payload.sourcePath);
  const targetPath = normalizeAbsoluteStoragePath(payload.targetPath || sourcePath);
  if (!safeUserId || !accountId || !appId || !sourcePath) {
    throw createClientRequestError('Backup inválido: faltan parámetros requeridos', 400);
  }
  const estimatedSourceBytes = estimateStoragePathBytes(sourcePath);
  if (Number.isFinite(Number(estimatedSourceBytes)) && Number(estimatedSourceBytes) > storageBackupMaxSourceBytes) {
    throw createClientRequestError(
      `La ruta a respaldar supera el límite de ${Math.round(storageBackupMaxSourceBytes / (1024 * 1024 * 1024))}GB.`,
      413
    );
  }
  const availableBytes = getDiskAvailableBytesForPath(storageJobsRootDir);
  if (
    Number.isFinite(Number(estimatedSourceBytes)) &&
    Number.isFinite(Number(availableBytes)) &&
    Number(estimatedSourceBytes) + storageBackupReserveBytes >= Number(availableBytes)
  ) {
    throw createClientRequestError(
      'No hay espacio temporal suficiente para generar el backup local antes de subirlo a Google Drive.',
      507
    );
  }
  const context = await getDriveContextForUser(safeUserId, accountId);
  setStorageJobProgress(row.id, { stage: 'archiving' }, `Empaquetando ${sourcePath}`);
  const tmpArchivePath = path.join(storageJobsRootDir, `${buildStorageJobId('backup')}.tar.gz`);
  try {
    createTarGzArchive(sourcePath, tmpArchivePath);
    const folders = await ensureDriveBackupFolder(context, appId);
    setStorageJobProgress(row.id, { stage: 'uploading' }, 'Subiendo backup a Google Drive (rclone)');
    const uploaded = await uploadFileToDrive(context, {
      localPath: tmpArchivePath,
      parentId: folders.appFolderPath,
      fileName: buildBackupFileName(appName, appId, nowIso()),
      appProperties: {
        codexwebType: 'app-backup',
        appId,
        targetPath: targetPath || '',
        createdAt: nowIso()
      }
    });
    const backupId = buildStorageJobId('cloudbackup');
    upsertDeployedCloudBackupStmt.run(
      backupId,
      safeUserId,
      appId,
      accountId,
      uploaded.id,
      uploaded.name,
      targetPath || '',
      Number(uploaded.sizeBytes || 0),
      uploaded.createdAt || nowIso(),
      JSON.stringify({
        appName,
        sourcePath,
        targetPath: targetPath || '',
        parentId: folders.appFolderPath
      })
    );
    const retention = await pruneDriveBackupsForRetention(safeUserId, accountId, appId);
    return {
      backup: {
        id: backupId,
        appId,
        accountId,
        accountAlias: context.account.alias || context.account.id,
        driveFileId: uploaded.id,
        name: uploaded.name,
        sizeBytes: uploaded.sizeBytes,
        createdAt: uploaded.createdAt,
        targetPath: targetPath || ''
      },
      retention
    };
  } finally {
    try {
      if (tmpArchivePath && fs.existsSync(tmpArchivePath)) {
        fs.unlinkSync(tmpArchivePath);
      }
    } catch (_error) {
      // ignore cleanup failures.
    }
  }
}

async function downloadDriveFileToPath(context, fileId, outputPath) {
  const requestedPath = parseDrivePathFromFileId(fileId);
  if (!requestedPath) {
    throw createClientRequestError('fileId de Google Drive inválido.', 400);
  }
  ensureParentDirForFile(outputPath);
  const fullPath = resolveDrivePathFromRoot(context.rootPath, requestedPath);
  const source = buildRcloneTarget(context.remoteName, fullPath);
  const copyResult = runRcloneCommandSync(['copyto', source, outputPath], {
    configPath: context.configPath,
    allowNonZero: true,
    timeoutMs: 1000 * 60 * 10
  });
  if (!copyResult.ok) {
    const reason = truncateForNotify(copyResult.stderr || copyResult.stdout || 'drive_download_failed', 220);
    if (/no space left|enospc|disk full|quota exceeded/i.test(String(reason || ''))) {
      const storage = buildStorageHealthSnapshotForPath(storageJobsRootDir);
      const clientError = createClientRequestError(
        'No hay espacio suficiente para completar la descarga de Google Drive.',
        507
      );
      clientError.code = 'INSUFFICIENT_STORAGE';
      clientError.storage = storage;
      throw clientError;
    }
    throw createClientRequestError(`No se pudo descargar desde Google Drive (rclone): ${reason}`, 502);
  }
  let fileStats = null;
  try {
    fileStats = fs.statSync(outputPath);
  } catch (_error) {
    fileStats = null;
  }
  return {
    metadata: {
      name: path.posix.basename(fullPath),
      size: fileStats ? Number(fileStats.size || 0) : null
    },
    path: buildDriveFileIdFromPath(normalizeDrivePathFromRoot(context.rootPath, fullPath))
  };
}

async function handleDeployedBackupRestoreJob(row) {
  const payload = safeParseJsonObject(row.payload_json);
  const safeUserId = getSafeUserId(row.user_id);
  const accountId = String(payload.accountId || '').trim();
  const appId = String(payload.appId || '').trim();
  const fileId = String(payload.fileId || '').trim();
  const requestedTargetPath = normalizeAbsoluteStoragePath(payload.targetPath);
  if (!safeUserId || !accountId || !appId || !fileId) {
    throw createClientRequestError('Restauración inválida: faltan datos requeridos.', 400);
  }
  const context = await getDriveContextForUser(safeUserId, accountId);
  const cachedRows = listDeployedCloudBackupsForUserAndAppStmt.all(safeUserId, appId, 200);
  const cachedByFileId = new Map(
    cachedRows.map((entry) => [String(entry && entry.drive_file_id ? entry.drive_file_id : '').trim(), entry])
  );
  const cached = cachedByFileId.get(String(fileId || '').trim()) || null;
  const targetPath =
    requestedTargetPath ||
    normalizeAbsoluteStoragePath(
      (cached && String(cached.target_path || '').trim()) ||
        ((cached && safeParseJsonObject(cached.metadata_json).targetPath) || '')
    );
  if (!targetPath) {
    throw createClientRequestError(
      'Este backup no tiene targetPath. Indica ruta de restauración manualmente.',
      400
    );
  }
  assertStorageMutationPathAllowed(targetPath);
  assertStorageCapacityOrThrow({
    path: storageJobsRootDir,
    requiredBytes: 512 * 1024 * 1024,
    operationLabel: 'restaurar backup de aplicación'
  });
  setStorageJobProgress(row.id, { stage: 'downloading' }, `Descargando backup ${fileId}`);
  const tmpArchivePath = path.join(storageJobsRootDir, `${buildStorageJobId('restore')}.tar.gz`);
  try {
    const downloaded = await downloadDriveFileToPath(context, fileId, tmpArchivePath);
    setStorageJobProgress(row.id, { stage: 'extracting' }, `Restaurando en ${targetPath}`);
    const extraction = extractTarGzArchive(tmpArchivePath, targetPath);
    const backupName =
      String((downloaded && downloaded.metadata && downloaded.metadata.name) || '').trim() ||
      path.posix.basename(String(fileId || '')) ||
      'backup.tar.gz';
    return {
      appId,
      accountId,
      accountAlias: context.account.alias || context.account.id,
      fileId,
      backupName,
      targetPath,
      extractParent: extraction.extractParent,
      restoredAt: nowIso()
    };
  } finally {
    try {
      if (tmpArchivePath && fs.existsSync(tmpArchivePath)) {
        fs.unlinkSync(tmpArchivePath);
      }
    } catch (_error) {
      // ignore cleanup failures.
    }
  }
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

function normalizeGitBranchName(rawValue, fallback = '') {
  const value = String(rawValue || '').trim();
  if (!value) return String(fallback || '').trim();
  if (value.length > 180) return String(fallback || '').trim();
  if (/\s/.test(value)) return String(fallback || '').trim();
  if (!/^[A-Za-z0-9._/\-]+$/.test(value)) return String(fallback || '').trim();
  if (value.startsWith('-') || value.endsWith('.') || value.endsWith('/')) {
    return String(fallback || '').trim();
  }
  if (value.includes('..') || value.includes('@{') || value.includes('\\')) {
    return String(fallback || '').trim();
  }
  return value;
}

function normalizeGitRemoteName(rawValue, fallback = '') {
  const value = String(rawValue || '').trim();
  if (!value) return String(fallback || '').trim();
  if (value.length > 120) return String(fallback || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return String(fallback || '').trim();
  return value;
}

function splitGitRemoteBranchRef(rawBranch) {
  const safeBranch = normalizeGitBranchName(rawBranch);
  if (!safeBranch || !safeBranch.includes('/')) return null;
  const firstSlash = safeBranch.indexOf('/');
  const remoteName = normalizeGitRemoteName(safeBranch.slice(0, firstSlash));
  const branchPart = normalizeGitBranchName(safeBranch.slice(firstSlash + 1));
  if (!remoteName || !branchPart) return null;
  return {
    remote: remoteName,
    branch: branchPart
  };
}

function gitRemoteBranchExists(repoPath, remoteName, branchName) {
  const safeRemote = normalizeGitRemoteName(remoteName);
  const safeBranch = normalizeGitBranchName(branchName);
  if (!safeRemote || !safeBranch) return false;
  const remoteCheck = runGitInRepoSync(repoPath, ['remote', 'get-url', safeRemote], {
    allowNonZero: true
  });
  if (Number(remoteCheck.code) !== 0) return false;
  const result = runGitInRepoSync(repoPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/${safeRemote}/${safeBranch}`], {
    allowNonZero: true
  });
  return Number(result.code) === 0;
}

function listGitRemotes(repoPath) {
  const result = runGitInRepoSync(repoPath, ['remote'], {
    allowNonZero: true
  });
  if (Number(result.code) !== 0) return [];
  return String(result.stdout || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((entry) => normalizeGitRemoteName(entry))
    .filter(Boolean);
}

function refreshGitRemoteRefs(repoPath, preferredRemote = 'origin') {
  const remotes = listGitRemotes(repoPath);
  if (remotes.length === 0) {
    return {
      fetched: false,
      errors: []
    };
  }
  const preferred = normalizeGitRemoteName(preferredRemote);
  const ordered = preferred
    ? [preferred, ...remotes.filter((entry) => entry !== preferred)]
    : remotes.slice();
  const uniqueOrdered = Array.from(new Set(ordered));
  const errors = [];
  let fetched = false;
  uniqueOrdered.forEach((remoteName) => {
    const fetchResult = runGitInRepoSync(repoPath, ['fetch', remoteName, '--prune'], {
      allowNonZero: true,
      timeoutMs: Math.max(gitToolsCommandTimeoutMs, 1000 * 45)
    });
    if (Number(fetchResult.code) === 0) {
      fetched = true;
      return;
    }
    errors.push(
      truncateForNotify(
        fetchResult.stderr || fetchResult.stdout || `git_fetch_${remoteName}_failed`,
        180
      )
    );
  });
  return {
    fetched,
    errors
  };
}

function resolveGitRemoteBranchRef(repoPath, rawBranch) {
  const split = splitGitRemoteBranchRef(rawBranch);
  if (!split) return null;
  if (!gitRemoteBranchExists(repoPath, split.remote, split.branch)) return null;
  return split;
}

function listGitBranchesForRepo(repoPath) {
  const result = runGitInRepoSync(
    repoPath,
    ['for-each-ref', '--format', '%(refname:short)', 'refs/heads', 'refs/remotes'],
    {
      allowNonZero: true
    }
  );
  if (Number(result.code) !== 0) return [];
  const localBranches = [];
  const remoteBranches = [];
  String(result.stdout || '')
    .replace(/\r/g, '')
    .split('\n')
    .forEach((entry) => {
      const normalized = normalizeGitBranchName(entry);
      if (!normalized) return;
      if (normalized.startsWith('refs/')) return;
      if (normalized.includes('/HEAD')) return;
      const split = splitGitRemoteBranchRef(normalized);
      if (split && gitRemoteBranchExists(repoPath, split.remote, split.branch)) {
        remoteBranches.push(`${split.remote}/${split.branch}`);
        return;
      }
      localBranches.push(normalized);
    });
  const localSet = new Set(localBranches);
  const merged = [
    ...Array.from(localSet.values()),
    ...remoteBranches.filter((entry) => {
      const split = splitGitRemoteBranchRef(entry);
      if (!split) return false;
      return !localSet.has(split.branch);
    })
  ];
  return Array.from(new Set(merged)).sort((a, b) => a.localeCompare(b));
}

function gitBranchExists(repoPath, branchName) {
  const safeName = normalizeGitBranchName(branchName);
  if (!safeName) return false;
  const result = runGitInRepoSync(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${safeName}`], {
    allowNonZero: true
  });
  return Number(result.code) === 0;
}

function gitBranchRefExists(repoPath, branchName) {
  const safeBranch = normalizeGitBranchName(branchName);
  if (!safeBranch) return false;
  if (gitBranchExists(repoPath, safeBranch)) return true;
  const split = splitGitRemoteBranchRef(safeBranch);
  if (split) {
    return gitRemoteBranchExists(repoPath, split.remote, split.branch);
  }
  return gitRemoteBranchExists(repoPath, 'origin', safeBranch);
}

function resolveCurrentGitBranchName(repoPath) {
  const result = runGitInRepoSync(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], {
    allowNonZero: true
  });
  if (Number(result.code) !== 0) return '';
  const current = normalizeGitBranchName(String(result.stdout || '').trim());
  if (!current || current === 'HEAD') return '';
  return current;
}

function normalizeGitCheckoutError(rawText, branchName = '') {
  const source = String(rawText || '').trim();
  const lower = source.toLowerCase();
  if (!source) {
    return branchName
      ? `No se pudo hacer checkout a ${branchName}.`
      : 'No se pudo hacer checkout de rama.';
  }
  if (
    lower.includes('would be overwritten by checkout') ||
    lower.includes('please commit your changes or stash them before you switch branches')
  ) {
    return 'Hay cambios locales que bloquean el checkout. Haz commit, stash o descártalos y vuelve a intentar.';
  }
  if (lower.includes('untracked working tree files would be overwritten')) {
    return 'Hay archivos sin seguimiento que serían sobreescritos por el checkout. Muévelos o elimínalos antes.';
  }
  if (lower.includes('did not match any file(s) known to git')) {
    return branchName
      ? `La rama no existe en local/remoto: ${branchName}.`
      : 'La rama solicitada no existe en local/remoto.';
  }
  if (lower.includes('you are in the middle of a merge')) {
    return 'El repositorio está en medio de un merge. Resuélvelo antes de cambiar de rama.';
  }
  return truncateForNotify(source, 220);
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
  const branches = listGitBranchesForRepo(safeRepoDir);

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
    branches: branches.slice(0, 120),
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

function shouldIncludeTaskSnapshotPath(relativePath) {
  const normalized = normalizeRepoRelativePath(relativePath).toLowerCase();
  if (!normalized) return false;
  if (normalized === 'tmp/task-snapshots' || normalized.startsWith('tmp/task-snapshots/')) return false;
  if (normalized === 'tmp/storage-jobs' || normalized.startsWith('tmp/storage-jobs/')) return false;
  if (normalized.startsWith('.runtime/')) return false;
  if (normalized.startsWith('public/assets/')) return false;
  if (normalized.startsWith('deploy/nginx/')) return false;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (taskSnapshotIgnoredRootDirs.has(segments[0])) return false;
  if (segments.includes('node_modules')) return false;
  if (segments.includes('.git')) return false;
  return true;
}

function listTrackedAndUntrackedRepoFiles() {
  const tracked = parseNullSeparatedList(runGitStdoutSync(['ls-files', '-z']));
  const untracked = parseNullSeparatedList(
    runGitStdoutSync(['ls-files', '--others', '--exclude-standard', '-z'])
  );
  const merged = [];
  const seen = new Set();
  [...tracked, ...untracked].forEach((entry) => {
    if (!entry || seen.has(entry) || !shouldIncludeTaskSnapshotPath(entry)) return;
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
  let copiedBytesTotal = 0;
  let skippedCount = 0;
  let reachedFilesCap = false;
  knownPaths.forEach((relPath) => {
    if (reachedFilesCap) {
      return;
    }
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
    const fileSize = Number(stats.size) || 0;
    if (fileSize > taskSnapshotMaxFileBytes) {
      skippedCount += 1;
      return;
    }
    if (copiedBytesTotal + fileSize > taskSnapshotMaxTotalBytes) {
      skippedCount += 1;
      return;
    }
    if (manifestFiles.length >= taskSnapshotMaxFiles) {
      reachedFilesCap = true;
      return;
    }
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
        size: fileSize,
        mode: Number(stats.mode) || 0
      });
      copiedBytesTotal += fileSize;
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
    bytesTotal: copiedBytesTotal,
    skippedTotal: skippedCount,
    partial:
      skippedCount > 0 || reachedFilesCap || copiedBytesTotal >= taskSnapshotMaxTotalBytes || knownPaths.length > manifest.files.length,
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
  const disk = getDiskUsageSnapshotForPath(repoRootDir) || getDiskUsageSnapshotForPath(storageJobsRootDir);
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
      usedMemPercent: Number(usedMemPercent.toFixed(1)),
      disk: disk
        ? {
            path: disk.path,
            mountPoint: disk.mountPoint,
            totalBytes: disk.totalBytes,
            usedBytes: disk.usedBytes,
            availableBytes: disk.availableBytes,
            usedPercent: disk.usagePercent
          }
        : null
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

function normalizeTaskSnapshotDirPath(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  try {
    return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRootDir, value);
  } catch (_error) {
    return '';
  }
}

function sumTaskSnapshotManifestBytes(manifest) {
  if (!manifest || !Array.isArray(manifest.files)) return 0;
  return manifest.files.reduce((acc, entry) => {
    const size = Number(entry && entry.size);
    return Number.isFinite(size) && size > 0 ? acc + size : acc;
  }, 0);
}

function computeDirectorySizeRecursiveBytes(rootDir) {
  const stack = [rootDir];
  let total = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    entries.forEach((entry) => {
      const absolutePath = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(absolutePath);
          return;
        }
        const stats = fs.lstatSync(absolutePath);
        if (stats.isFile()) {
          total += Math.max(0, Number(stats.size) || 0);
        }
      } catch (_error) {
        // best-effort size scan
      }
    });
  }
  return total;
}

function getTaskSnapshotDirectorySizeBytes(snapshotDir) {
  const manifest = loadTaskSnapshotManifest(snapshotDir);
  const manifestBytes = sumTaskSnapshotManifestBytes(manifest);
  if (manifestBytes > 0) return manifestBytes;
  return computeDirectorySizeRecursiveBytes(snapshotDir);
}

function listTaskSnapshotDirectoryEntries() {
  let entries = [];
  try {
    entries = fs.readdirSync(taskSnapshotsRootDir, { withFileTypes: true });
  } catch (_error) {
    return [];
  }
  return entries
    .filter((entry) => entry && entry.isDirectory && entry.isDirectory())
    .map((entry) => {
      const token = String(entry.name || '').trim();
      if (!token) return null;
      const absolutePath = path.join(taskSnapshotsRootDir, token);
      let stats = null;
      try {
        stats = fs.statSync(absolutePath);
      } catch (_error) {
        stats = null;
      }
      const runIdMatch = /^(\d+)_/.exec(token);
      const runId = runIdMatch && Number.isInteger(Number(runIdMatch[1])) ? Number(runIdMatch[1]) : null;
      return {
        token,
        runId,
        absolutePath,
        createdAtMs: stats ? Number(stats.mtimeMs || stats.ctimeMs || Date.now()) : Date.now(),
        sizeBytes: getTaskSnapshotDirectorySizeBytes(absolutePath)
      };
    })
    .filter(Boolean);
}

function pruneTaskSnapshots(options = {}) {
  const force = Boolean(options && options.force);
  const nowMs = Date.now();
  if (!force && nowMs - taskSnapshotPruneLastAtMs < taskSnapshotsPruneIntervalMs) {
    return {
      skipped: true,
      reason: 'interval'
    };
  }
  if (taskSnapshotPruneInFlight) {
    return {
      skipped: true,
      reason: 'busy'
    };
  }

  taskSnapshotPruneInFlight = true;
  try {
    const snapshotRows = listTaskRunsWithSnapshotsStmt.all();
    const refsByAbsolutePath = new Map();
    snapshotRows.forEach((row) => {
      const rawDir = String((row && row.snapshot_dir) || '').trim();
      if (!rawDir) return;
      const absolutePath = normalizeTaskSnapshotDirPath(rawDir);
      if (!absolutePath) return;
      const refs = refsByAbsolutePath.get(absolutePath) || [];
      refs.push({
        taskId: Number.isInteger(Number(row.id)) ? Number(row.id) : 0,
        status: String((row && row.status) || '').trim().toLowerCase(),
        rawDir
      });
      refsByAbsolutePath.set(absolutePath, refs);
    });

    const allEntries = listTaskSnapshotDirectoryEntries().sort((a, b) => b.createdAtMs - a.createdAtMs);
    const existingSnapshotPathSet = new Set(allEntries.map((entry) => entry.absolutePath));
    let staleDbRefCount = 0;
    refsByAbsolutePath.forEach((refs, absolutePath) => {
      if (existingSnapshotPathSet.has(absolutePath)) return;
      refs.forEach((ref) => {
        markTaskRunSnapshotUnavailableByDirStmt.run(nowIso(), String(ref.rawDir || ''));
        staleDbRefCount += 1;
      });
    });
    allEntries.forEach((entry) => {
      const refs = refsByAbsolutePath.get(entry.absolutePath) || [];
      entry.refs = refs;
      entry.protected = refs.some((ref) => ref.status === 'running');
    });

    const keepEntries = [];
    const deleteEntries = [];
    allEntries.forEach((entry) => {
      if (entry.protected) {
        keepEntries.push(entry);
        return;
      }
      if (taskSnapshotsRetentionMaxAgeMs > 0 && nowMs - entry.createdAtMs > taskSnapshotsRetentionMaxAgeMs) {
        deleteEntries.push({ ...entry, reason: 'age' });
        return;
      }
      keepEntries.push(entry);
    });

    let keepCount = keepEntries.length;
    let keepBytes = keepEntries.reduce((acc, entry) => acc + Math.max(0, Number(entry.sizeBytes) || 0), 0);
    for (let index = keepEntries.length - 1; index >= 0; index -= 1) {
      const entry = keepEntries[index];
      if (entry.protected) continue;
      const overCount = keepCount > taskSnapshotsRetentionMaxEntries;
      const overBytes = keepBytes > taskSnapshotsRetentionMaxBytes;
      if (!overCount && !overBytes) continue;
      keepEntries.splice(index, 1);
      keepCount -= 1;
      keepBytes = Math.max(0, keepBytes - Math.max(0, Number(entry.sizeBytes) || 0));
      deleteEntries.push({ ...entry, reason: overCount ? 'count' : 'bytes' });
    }

    let deletedCount = 0;
    let deletedBytes = 0;
    let failedCount = 0;
    deleteEntries.forEach((entry) => {
      try {
        fs.rmSync(entry.absolutePath, { recursive: true, force: true });
        deletedCount += 1;
        deletedBytes += Math.max(0, Number(entry.sizeBytes) || 0);
        (entry.refs || []).forEach((ref) => {
          markTaskRunSnapshotUnavailableByDirStmt.run(nowIso(), String(ref.rawDir || ''));
        });
      } catch (_error) {
        failedCount += 1;
      }
    });

    taskSnapshotPruneLastAtMs = nowMs;
    if (deletedCount > 0) {
      void notify(
        `Task snapshots limpiados: ${deletedCount} eliminados, ${(deletedBytes / (1024 * 1024)).toFixed(1)}MB liberados.`
      );
    }
    return {
      skipped: false,
      scanned: allEntries.length,
      deletedCount,
      deletedBytes,
      failedCount,
      staleDbRefCount,
      keptCount: keepEntries.length,
      keptBytes: keepBytes
    };
  } finally {
    taskSnapshotPruneInFlight = false;
  }
}

function scheduleTaskSnapshotPrune(options = {}) {
  const force = Boolean(options && options.force);
  if (force) {
    return pruneTaskSnapshots({ force: true });
  }
  if (taskSnapshotPruneScheduled) {
    return null;
  }
  taskSnapshotPruneScheduled = true;
  const timer = setTimeout(() => {
    taskSnapshotPruneScheduled = false;
    try {
      pruneTaskSnapshots();
    } catch (_error) {
      // best-effort maintenance
    }
  }, 1200);
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
  return null;
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
  for (const [uploadId, entry] of pendingChunkUploads.entries()) {
    const filePath = entry && entry.path ? String(entry.path) : '';
    if (!filePath || !fs.existsSync(filePath)) {
      pendingChunkUploads.delete(uploadId);
      continue;
    }
    const updatedAt = Number(entry && entry.updatedAt ? entry.updatedAt : entry && entry.createdAt);
    const isExpired = !Number.isFinite(updatedAt) || now - updatedAt > pendingChunkUploadTtlMs;
    if (!isExpired) continue;
    pendingChunkUploads.delete(uploadId);
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
    await pipelineAsync(
      req,
      limiter,
      fs.createWriteStream(destinationPath, { flags: 'wx', highWaterMark: 1024 * 1024 })
    );
  } catch (error) {
    const normalizedError = normalizeStorageSpaceError(
      error,
      'No hay espacio suficiente para completar la subida del adjunto.'
    );
    try {
      if (fs.existsSync(destinationPath)) {
        fs.unlinkSync(destinationPath);
      }
    } catch (_unlinkError) {
      // best-effort cleanup
    }
    throw normalizedError;
  }

  return totalBytes;
}

async function readRequestBodyBuffer(req, maxBytes) {
  const safeMaxBytes = Math.max(1, Number(maxBytes) || uploadChunkMaxBytes);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    const handleError = (error) => {
      reject(error);
    };
    req.on('error', handleError);
    req.on('data', (chunk) => {
      const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += chunkBuffer.length;
      if (totalBytes > safeMaxBytes) {
        reject(createClientRequestError('Chunk demasiado grande.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunkBuffer);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks, totalBytes));
    });
  });
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
      assertStorageCapacityOrThrow({
        path: conversationDir,
        requiredBytes: estimateAttachmentUploadRequiredBytes(size, 1),
        operationLabel: `guardar adjunto ${name}`
      });
      try {
        moveFileSync(uploaded.path, storedPath);
      } catch (error) {
        pendingUploads.delete(uploadId);
        throw normalizeStorageSpaceError(
          error,
          `No hay espacio suficiente para guardar el adjunto ${name}.`
        );
      }
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
    assertStorageCapacityOrThrow({
      path: conversationDir,
      requiredBytes: estimateAttachmentUploadRequiredBytes(dataBuffer.length, 1),
      operationLabel: `guardar adjunto ${name}`
    });
    try {
      fs.writeFileSync(storedPath, dataBuffer);
    } catch (error) {
      throw normalizeStorageSpaceError(
        error,
        `No hay espacio suficiente para guardar el adjunto ${name}.`
      );
    }

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

CREATE TABLE IF NOT EXISTS user_agent_permissions (
  user_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'full_access',
  allow_root INTEGER NOT NULL DEFAULT 1,
  run_as_user TEXT NOT NULL DEFAULT '',
  allowed_paths_json TEXT NOT NULL DEFAULT '["/"]',
  denied_paths_json TEXT NOT NULL DEFAULT '[]',
  can_write_files INTEGER NOT NULL DEFAULT 1,
  read_only INTEGER NOT NULL DEFAULT 0,
  allow_shell INTEGER NOT NULL DEFAULT 1,
  allow_sensitive_tools INTEGER NOT NULL DEFAULT 1,
  allow_network INTEGER NOT NULL DEFAULT 1,
  allow_git INTEGER NOT NULL DEFAULT 1,
  allow_backup_restore INTEGER NOT NULL DEFAULT 1,
  allowed_tools_json TEXT NOT NULL DEFAULT '["chat","git","storage","drive","backups","deployments","shell","wireguard"]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, agent_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_agent_permissions_user
ON user_agent_permissions(user_id, agent_id ASC);

CREATE TABLE IF NOT EXISTS chat_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  context_mode TEXT NOT NULL DEFAULT 'mixed',
  auto_context_enabled INTEGER NOT NULL DEFAULT 1,
  manual_context TEXT NOT NULL DEFAULT '',
  auto_context TEXT NOT NULL DEFAULT '',
  auto_context_meta_json TEXT NOT NULL DEFAULT '{}',
  auto_last_message_id INTEGER NOT NULL DEFAULT 0,
  auto_updated_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_projects_user_updated
ON chat_projects(user_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
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

CREATE TABLE IF NOT EXISTS deployed_app_description_jobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  app_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT '',
  active_agent_id TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deployed_app_description_jobs_user_created
ON deployed_app_description_jobs(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_deployed_app_description_jobs_status
ON deployed_app_description_jobs(status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS deployed_app_descriptions (
  user_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  job_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, app_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deployed_app_descriptions_user_generated
ON deployed_app_descriptions(user_id, generated_at DESC, app_id ASC);

CREATE TABLE IF NOT EXISTS drive_accounts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  auth_mode TEXT NOT NULL DEFAULT 'token',
  credentials_cipher TEXT NOT NULL DEFAULT '',
  token_cipher TEXT NOT NULL DEFAULT '',
  root_folder_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drive_accounts_user_updated
ON drive_accounts(user_id, updated_at DESC, id ASC);

CREATE TABLE IF NOT EXISTS tools_background_jobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL DEFAULT '{}',
  progress_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT NOT NULL DEFAULT '',
  log_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tools_background_jobs_user_created
ON tools_background_jobs(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tools_background_jobs_status
ON tools_background_jobs(status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS deployed_app_cloud_backups (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  backup_name TEXT NOT NULL DEFAULT '',
  target_path TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES drive_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deployed_app_cloud_backups_user_app_created
ON deployed_app_cloud_backups(user_id, app_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_deployed_app_cloud_backups_account_created
ON deployed_app_cloud_backups(account_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS wireguard_peer_profiles (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  interface_name TEXT NOT NULL,
  peer_name TEXT NOT NULL DEFAULT '',
  public_key TEXT NOT NULL,
  client_ip TEXT NOT NULL DEFAULT '',
  allowed_ips TEXT NOT NULL DEFAULT '',
  dns TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL DEFAULT '',
  keepalive_seconds INTEGER NOT NULL DEFAULT 25,
  notes TEXT NOT NULL DEFAULT '',
  config_cipher TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wireguard_peer_profiles_user_interface
ON wireguard_peer_profiles(user_id, interface_name, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_wireguard_peer_profiles_public_key
ON wireguard_peer_profiles(public_key, revoked_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS wireguard_settings (
  user_id INTEGER PRIMARY KEY,
  endpoint_host TEXT NOT NULL DEFAULT '',
  default_dns TEXT NOT NULL DEFAULT '',
  default_allowed_ips TEXT NOT NULL DEFAULT '',
  default_keepalive_seconds INTEGER NOT NULL DEFAULT 25,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

function hasConversationColumn(columnName) {
  const columns = db.prepare('PRAGMA table_info(conversations)').all();
  return columns.some((column) => String(column && column.name) === columnName);
}

function hasChatProjectColumn(columnName) {
  const columns = db.prepare('PRAGMA table_info(chat_projects)').all();
  return columns.some((column) => String(column && column.name) === columnName);
}

function hasUserColumn(columnName) {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  return columns.some((column) => String(column && column.name) === columnName);
}

function hasUserAgentPermissionsColumn(columnName) {
  const columns = db.prepare('PRAGMA table_info(user_agent_permissions)').all();
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

if (!hasConversationColumn('project_id')) {
  db.exec('ALTER TABLE conversations ADD COLUMN project_id INTEGER');
}
db.exec(`
CREATE INDEX IF NOT EXISTS idx_conversations_user_project
ON conversations(user_id, project_id, created_at DESC)
`);

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

if (!hasUserAgentPermissionsColumn('access_mode')) {
  db.exec("ALTER TABLE user_agent_permissions ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'full_access'");
}

if (!hasUserAgentPermissionsColumn('can_write_files')) {
  db.exec('ALTER TABLE user_agent_permissions ADD COLUMN can_write_files INTEGER NOT NULL DEFAULT 1');
}

if (!hasChatProjectColumn('auto_context_meta_json')) {
  db.exec("ALTER TABLE chat_projects ADD COLUMN auto_context_meta_json TEXT NOT NULL DEFAULT '{}'");
}

if (!hasChatProjectColumn('auto_last_message_id')) {
  db.exec('ALTER TABLE chat_projects ADD COLUMN auto_last_message_id INTEGER NOT NULL DEFAULT 0');
}

if (!hasChatProjectColumn('auto_updated_at')) {
  db.exec("ALTER TABLE chat_projects ADD COLUMN auto_updated_at TEXT NOT NULL DEFAULT ''");
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
db.exec(`
UPDATE user_agent_permissions
SET allowed_tools_json = REPLACE(allowed_tools_json, '"dropbox"', '"drive"')
WHERE allowed_tools_json LIKE '%"dropbox"%'
`);
db.exec(`
UPDATE user_agent_permissions
SET allowed_tools_json = CASE
  WHEN allowed_tools_json LIKE '%"wireguard"%' THEN allowed_tools_json
  WHEN TRIM(COALESCE(allowed_tools_json, '')) = '' THEN '${JSON.stringify(aiPermissionDefaultAllowedTools)}'
  WHEN SUBSTR(TRIM(allowed_tools_json), -1, 1) = ']'
    THEN SUBSTR(TRIM(allowed_tools_json), 1, LENGTH(TRIM(allowed_tools_json)) - 1) || ',"wireguard"]'
  ELSE '${JSON.stringify(aiPermissionDefaultAllowedTools)}'
END
`);
db.exec(`
UPDATE user_agent_permissions
SET
  can_write_files = CASE
    WHEN read_only = 1 THEN 0
    WHEN can_write_files IN (0, 1) THEN can_write_files
    ELSE 1
  END,
  access_mode = CASE
    WHEN read_only = 1 OR can_write_files = 0 THEN 'read_only'
    WHEN allow_root = 1
      AND COALESCE(allowed_paths_json, '[]') IN ('["/"]', '["/","${repoRootDir}"]', '["${repoRootDir}","/"]')
      AND COALESCE(denied_paths_json, '[]') = '[]' THEN 'full_access'
    WHEN COALESCE(allowed_paths_json, '[]') = '["${repoRootDir}"]'
      AND COALESCE(denied_paths_json, '[]') = '[]' THEN 'workspace_only'
    ELSE 'restricted_paths'
  END
`);
db.exec(`
UPDATE drive_accounts
SET
  auth_mode = CASE
    WHEN auth_mode = 'rclone' THEN 'rclone'
    ELSE 'legacy_remote'
  END,
  root_folder_id = CASE
    WHEN root_folder_id = 'root' THEN ''
    ELSE COALESCE(root_folder_id, '')
  END
`);
db.exec(`
UPDATE wireguard_settings
SET
  endpoint_host = COALESCE(endpoint_host, ''),
  default_dns = CASE
    WHEN TRIM(COALESCE(default_dns, '')) = '' THEN '${wireGuardClientDnsDefault}'
    ELSE default_dns
  END,
  default_allowed_ips = CASE
    WHEN TRIM(COALESCE(default_allowed_ips, '')) = '' THEN '${wireGuardAllowedIpsDefault}'
    ELSE default_allowed_ips
  END,
  default_keepalive_seconds = CASE
    WHEN default_keepalive_seconds >= 0 THEN default_keepalive_seconds
    ELSE ${wireGuardKeepaliveDefault}
  END,
  updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
`);
db.exec(`
UPDATE chat_projects
SET
  name = TRIM(COALESCE(name, '')),
  context_mode = CASE
    WHEN LOWER(COALESCE(context_mode, '')) IN ('manual', 'automatic', 'mixed') THEN LOWER(COALESCE(context_mode, ''))
    ELSE 'mixed'
  END,
  auto_context_enabled = CASE
    WHEN auto_context_enabled IN (0, 1) THEN auto_context_enabled
    ELSE 1
  END,
  manual_context = COALESCE(manual_context, ''),
  auto_context = COALESCE(auto_context, ''),
  auto_context_meta_json = CASE
    WHEN TRIM(COALESCE(auto_context_meta_json, '')) = '' THEN '{}'
    ELSE auto_context_meta_json
  END,
  auto_last_message_id = CASE
    WHEN auto_last_message_id >= 0 THEN auto_last_message_id
    ELSE 0
  END,
  auto_updated_at = COALESCE(auto_updated_at, '')
`);
db.exec(`
UPDATE conversations
SET project_id = NULL
WHERE project_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM chat_projects p
    WHERE p.id = conversations.project_id
      AND p.user_id = conversations.user_id
  )
`);

const createConversationStmt = db.prepare(
  'INSERT INTO conversations (user_id, project_id, title, model, reasoning_effort) VALUES (?, ?, ?, ?, ?)'
);
const insertMessageStmt = db.prepare(
  'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)'
);
const updateMessageContentStmt = db.prepare(
  'UPDATE messages SET content = ? WHERE id = ?'
);
const getConversationStmt = db.prepare(`
  SELECT
    c.id,
    c.user_id,
    c.project_id,
    c.title,
    c.model,
    c.reasoning_effort,
    c.created_at,
    p.name AS project_name,
    p.context_mode AS project_context_mode,
    p.auto_context_enabled AS project_auto_context_enabled
  FROM conversations c
  LEFT JOIN chat_projects p
    ON p.id = c.project_id
   AND p.user_id = c.user_id
  WHERE c.id = ?
`);
const updateConversationTitleStmt = db.prepare(
  "UPDATE conversations SET title = ? WHERE id = ? AND (title = 'Nuevo chat' OR title = '')"
);
const renameConversationTitleStmt = db.prepare(
  'UPDATE conversations SET title = ? WHERE id = ?'
);
const assignConversationProjectStmt = db.prepare(`
  UPDATE conversations
  SET project_id = ?
  WHERE id = ?
    AND user_id = ?
`);
const listConversationsStmt = db.prepare(`
  SELECT
    c.id,
    c.project_id,
    c.title,
    c.model,
    c.reasoning_effort,
    c.created_at,
    p.name AS project_name,
    p.context_mode AS project_context_mode,
    p.auto_context_enabled AS project_auto_context_enabled,
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
  LEFT JOIN chat_projects p
    ON p.id = c.project_id
   AND p.user_id = c.user_id
  WHERE c.user_id = ?
  ORDER BY COALESCE(last_message_at, c.created_at) DESC
`);
const updateConversationSettingsStmt = db.prepare(
  'UPDATE conversations SET model = ?, reasoning_effort = ? WHERE id = ?'
);
const listChatProjectsForUserStmt = db.prepare(`
  SELECT
    p.id,
    p.user_id,
    p.name,
    p.context_mode,
    p.auto_context_enabled,
    p.manual_context,
    p.auto_context,
    p.auto_context_meta_json,
    p.auto_last_message_id,
    p.auto_updated_at,
    p.created_at,
    p.updated_at,
    (
      SELECT COUNT(1)
      FROM conversations c
      WHERE c.user_id = p.user_id
        AND c.project_id = p.id
    ) AS chat_count,
    (
      SELECT MAX(COALESCE(
        (
          SELECT MAX(m.created_at)
          FROM messages m
          WHERE m.conversation_id = c.id
        ),
        c.created_at
      ))
      FROM conversations c
      WHERE c.user_id = p.user_id
        AND c.project_id = p.id
    ) AS last_message_at
  FROM chat_projects p
  WHERE p.user_id = ?
  ORDER BY p.updated_at DESC, p.id DESC
`);
const getChatProjectByIdForUserStmt = db.prepare(`
  SELECT
    p.id,
    p.user_id,
    p.name,
    p.context_mode,
    p.auto_context_enabled,
    p.manual_context,
    p.auto_context,
    p.auto_context_meta_json,
    p.auto_last_message_id,
    p.auto_updated_at,
    p.created_at,
    p.updated_at
  FROM chat_projects p
  WHERE p.id = ?
    AND p.user_id = ?
  LIMIT 1
`);
const createChatProjectStmt = db.prepare(`
  INSERT INTO chat_projects (
    user_id,
    name,
    context_mode,
    auto_context_enabled,
    manual_context,
    auto_context,
    auto_context_meta_json,
    auto_last_message_id,
    auto_updated_at,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, '{}', 0, '', ?, ?)
`);
const updateChatProjectMetaStmt = db.prepare(`
  UPDATE chat_projects
  SET
    name = ?,
    context_mode = ?,
    auto_context_enabled = ?,
    manual_context = ?,
    updated_at = ?
  WHERE id = ?
    AND user_id = ?
`);
const updateChatProjectAutoContextStmt = db.prepare(`
  UPDATE chat_projects
  SET
    auto_context = ?,
    auto_context_meta_json = ?,
    auto_last_message_id = ?,
    auto_updated_at = ?,
    updated_at = ?
  WHERE id = ?
    AND user_id = ?
`);
const deleteChatProjectForUserStmt = db.prepare(`
  DELETE FROM chat_projects
  WHERE id = ?
    AND user_id = ?
`);
const clearProjectIdFromConversationsStmt = db.prepare(`
  UPDATE conversations
  SET project_id = NULL
  WHERE user_id = ?
    AND project_id = ?
`);
const listRecentProjectMessagesForSummaryStmt = db.prepare(`
  SELECT
    m.id,
    m.role,
    m.content,
    m.created_at,
    c.id AS conversation_id,
    c.title AS conversation_title
  FROM messages m
  INNER JOIN conversations c
    ON c.id = m.conversation_id
  WHERE c.user_id = ?
    AND c.project_id = ?
  ORDER BY m.id DESC
  LIMIT ?
`);
const getProjectMessageMaxIdStmt = db.prepare(`
  SELECT MAX(m.id) AS max_message_id
  FROM messages m
  INNER JOIN conversations c
    ON c.id = m.conversation_id
  WHERE c.user_id = ?
    AND c.project_id = ?
`);
const countUnassignedConversationsForUserStmt = db.prepare(`
  SELECT COUNT(1) AS total
  FROM conversations
  WHERE user_id = ?
    AND project_id IS NULL
`);
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
const getUsernameByIdStmt = db.prepare(`
  SELECT username
  FROM users
  WHERE id = ?
  LIMIT 1
`);
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
const getUserAgentPermissionStmt = db.prepare(`
  SELECT
    user_id,
    agent_id,
    access_mode,
    allow_root,
    run_as_user,
    allowed_paths_json,
    denied_paths_json,
    can_write_files,
    read_only,
    allow_shell,
    allow_sensitive_tools,
    allow_network,
    allow_git,
    allow_backup_restore,
    allowed_tools_json,
    updated_at
  FROM user_agent_permissions
  WHERE user_id = ?
    AND agent_id = ?
  LIMIT 1
`);
const listUserAgentPermissionsStmt = db.prepare(`
  SELECT
    user_id,
    agent_id,
    access_mode,
    allow_root,
    run_as_user,
    allowed_paths_json,
    denied_paths_json,
    can_write_files,
    read_only,
    allow_shell,
    allow_sensitive_tools,
    allow_network,
    allow_git,
    allow_backup_restore,
    allowed_tools_json,
    updated_at
  FROM user_agent_permissions
  WHERE user_id = ?
  ORDER BY agent_id ASC
`);
const upsertUserAgentPermissionStmt = db.prepare(`
  INSERT INTO user_agent_permissions (
    user_id,
    agent_id,
    access_mode,
    allow_root,
    run_as_user,
    allowed_paths_json,
    denied_paths_json,
    can_write_files,
    read_only,
    allow_shell,
    allow_sensitive_tools,
    allow_network,
    allow_git,
    allow_backup_restore,
    allowed_tools_json,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, agent_id) DO UPDATE SET
    access_mode = excluded.access_mode,
    allow_root = excluded.allow_root,
    run_as_user = excluded.run_as_user,
    allowed_paths_json = excluded.allowed_paths_json,
    denied_paths_json = excluded.denied_paths_json,
    can_write_files = excluded.can_write_files,
    read_only = excluded.read_only,
    allow_shell = excluded.allow_shell,
    allow_sensitive_tools = excluded.allow_sensitive_tools,
    allow_network = excluded.allow_network,
    allow_git = excluded.allow_git,
    allow_backup_restore = excluded.allow_backup_restore,
    allowed_tools_json = excluded.allowed_tools_json,
    updated_at = excluded.updated_at
`);
const insertDeployedAppDescriptionJobStmt = db.prepare(`
  INSERT INTO deployed_app_description_jobs (
    id,
    user_id,
    app_ids_json,
    status,
    provider,
    active_agent_id,
    result_json,
    error_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  )
  VALUES (?, ?, ?, ?, ?, ?, '{}', '', ?, ?, '', '')
`);
const updateDeployedAppDescriptionJobRunningStmt = db.prepare(`
  UPDATE deployed_app_description_jobs
  SET
    status = 'running',
    started_at = CASE
      WHEN LENGTH(started_at) > 0 THEN started_at
      ELSE ?
    END,
    updated_at = ?,
    error_text = ''
  WHERE id = ?
`);
const updateDeployedAppDescriptionJobCompletedStmt = db.prepare(`
  UPDATE deployed_app_description_jobs
  SET
    status = 'completed',
    result_json = ?,
    error_text = '',
    finished_at = ?,
    updated_at = ?
  WHERE id = ?
`);
const updateDeployedAppDescriptionJobErrorStmt = db.prepare(`
  UPDATE deployed_app_description_jobs
  SET
    status = 'error',
    error_text = ?,
    finished_at = ?,
    updated_at = ?
  WHERE id = ?
`);
const getDeployedAppDescriptionJobByIdStmt = db.prepare(`
  SELECT
    id,
    user_id,
    app_ids_json,
    status,
    provider,
    active_agent_id,
    result_json,
    error_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  FROM deployed_app_description_jobs
  WHERE id = ?
  LIMIT 1
`);
const getDeployedAppDescriptionJobForUserStmt = db.prepare(`
  SELECT
    id,
    user_id,
    app_ids_json,
    status,
    provider,
    active_agent_id,
    result_json,
    error_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  FROM deployed_app_description_jobs
  WHERE id = ?
    AND user_id = ?
  LIMIT 1
`);
const listRecentDeployedAppDescriptionJobsForUserStmt = db.prepare(`
  SELECT
    id,
    user_id,
    app_ids_json,
    status,
    provider,
    active_agent_id,
    result_json,
    error_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  FROM deployed_app_description_jobs
  WHERE user_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);
const listPendingDeployedAppDescriptionJobsStmt = db.prepare(`
  SELECT
    id,
    user_id,
    app_ids_json,
    status,
    provider,
    active_agent_id,
    result_json,
    error_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  FROM deployed_app_description_jobs
  WHERE status IN ('pending', 'running')
  ORDER BY created_at ASC, id ASC
  LIMIT ?
`);
const upsertDeployedAppDescriptionStmt = db.prepare(`
  INSERT INTO deployed_app_descriptions (
    user_id,
    app_id,
    provider,
    description,
    generated_at,
    job_id
  )
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, app_id) DO UPDATE SET
    provider = excluded.provider,
    description = excluded.description,
    generated_at = excluded.generated_at,
    job_id = excluded.job_id
`);
const listDeployedAppDescriptionsForUserStmt = db.prepare(`
  SELECT
    app_id,
    provider,
    description,
    generated_at,
    job_id
  FROM deployed_app_descriptions
  WHERE user_id = ?
`);
const listDriveAccountsForUserStmt = db.prepare(`
  SELECT
    id,
    user_id,
    alias,
    auth_mode,
    token_cipher,
    root_folder_id,
    status,
    last_error,
    details_json,
    created_at,
    updated_at
  FROM drive_accounts
  WHERE user_id = ?
  ORDER BY updated_at DESC, id DESC
`);
const getDriveAccountByIdForUserStmt = db.prepare(`
  SELECT
    id,
    user_id,
    alias,
    auth_mode,
    credentials_cipher,
    token_cipher,
    root_folder_id,
    status,
    last_error,
    details_json,
    created_at,
    updated_at
  FROM drive_accounts
  WHERE id = ?
    AND user_id = ?
  LIMIT 1
`);
const getDriveAccountByIdStmt = db.prepare(`
  SELECT
    id,
    user_id,
    alias,
    auth_mode,
    credentials_cipher,
    token_cipher,
    root_folder_id,
    status,
    last_error,
    details_json,
    created_at,
    updated_at
  FROM drive_accounts
  WHERE id = ?
  LIMIT 1
`);
const insertDriveAccountStmt = db.prepare(`
  INSERT INTO drive_accounts (
    id,
    user_id,
    alias,
    auth_mode,
    credentials_cipher,
    token_cipher,
    root_folder_id,
    status,
    last_error,
    details_json,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
`);
const updateDriveAccountMetaStmt = db.prepare(`
  UPDATE drive_accounts
  SET
    alias = ?,
    root_folder_id = ?,
    status = ?,
    last_error = ?,
    details_json = ?,
    updated_at = ?
  WHERE id = ?
    AND user_id = ?
`);
const updateDriveAccountTokenStmt = db.prepare(`
  UPDATE drive_accounts
  SET
    token_cipher = ?,
    status = ?,
    last_error = ?,
    updated_at = ?
  WHERE id = ?
`);
const updateDriveAccountStatusStmt = db.prepare(`
  UPDATE drive_accounts
  SET
    status = ?,
    last_error = ?,
    updated_at = ?
  WHERE id = ?
`);
const deleteDriveAccountForUserStmt = db.prepare(`
  DELETE FROM drive_accounts
  WHERE id = ?
    AND user_id = ?
`);
const insertToolsBackgroundJobStmt = db.prepare(`
  INSERT INTO tools_background_jobs (
    id,
    user_id,
    job_type,
    status,
    payload_json,
    progress_json,
    result_json,
    error_text,
    log_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  )
  VALUES (?, ?, ?, ?, ?, '{}', '{}', '', '', ?, ?, '', '')
`);
const updateToolsBackgroundJobRunningStmt = db.prepare(`
  UPDATE tools_background_jobs
  SET
    status = 'running',
    started_at = CASE
      WHEN LENGTH(started_at) > 0 THEN started_at
      ELSE ?
    END,
    updated_at = ?,
    error_text = ''
  WHERE id = ?
`);
const updateToolsBackgroundJobProgressStmt = db.prepare(`
  UPDATE tools_background_jobs
  SET
    progress_json = ?,
    log_text = ?,
    updated_at = ?
  WHERE id = ?
`);
const updateToolsBackgroundJobCompletedStmt = db.prepare(`
  UPDATE tools_background_jobs
  SET
    status = 'completed',
    progress_json = ?,
    result_json = ?,
    error_text = '',
    log_text = ?,
    finished_at = ?,
    updated_at = ?
  WHERE id = ?
`);
const updateToolsBackgroundJobErrorStmt = db.prepare(`
  UPDATE tools_background_jobs
  SET
    status = 'error',
    progress_json = ?,
    error_text = ?,
    log_text = ?,
    finished_at = ?,
    updated_at = ?
  WHERE id = ?
`);
const getToolsBackgroundJobByIdStmt = db.prepare(`
  SELECT
    id,
    user_id,
    job_type,
    status,
    payload_json,
    progress_json,
    result_json,
    error_text,
    log_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  FROM tools_background_jobs
  WHERE id = ?
  LIMIT 1
`);
const getToolsBackgroundJobForUserStmt = db.prepare(`
  SELECT
    id,
    user_id,
    job_type,
    status,
    payload_json,
    progress_json,
    result_json,
    error_text,
    log_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  FROM tools_background_jobs
  WHERE id = ?
    AND user_id = ?
  LIMIT 1
`);
const listPendingToolsBackgroundJobsStmt = db.prepare(`
  SELECT
    id,
    user_id,
    job_type,
    status,
    payload_json,
    progress_json,
    result_json,
    error_text,
    log_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  FROM tools_background_jobs
  WHERE status IN ('pending', 'running')
  ORDER BY created_at ASC, id ASC
  LIMIT ?
`);
const listRecentToolsBackgroundJobsForUserStmt = db.prepare(`
  SELECT
    id,
    user_id,
    job_type,
    status,
    payload_json,
    progress_json,
    result_json,
    error_text,
    log_text,
    created_at,
    updated_at,
    started_at,
    finished_at
  FROM tools_background_jobs
  WHERE user_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);
const upsertDeployedCloudBackupStmt = db.prepare(`
  INSERT INTO deployed_app_cloud_backups (
    id,
    user_id,
    app_id,
    account_id,
    drive_file_id,
    backup_name,
    target_path,
    size_bytes,
    created_at,
    deleted_at,
    metadata_json
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
  ON CONFLICT(id) DO UPDATE SET
    account_id = excluded.account_id,
    drive_file_id = excluded.drive_file_id,
    backup_name = excluded.backup_name,
    target_path = excluded.target_path,
    size_bytes = excluded.size_bytes,
    created_at = excluded.created_at,
    deleted_at = '',
    metadata_json = excluded.metadata_json
`);
const markDeployedCloudBackupDeletedByDriveFileStmt = db.prepare(`
  UPDATE deployed_app_cloud_backups
  SET deleted_at = ?
  WHERE user_id = ?
    AND account_id = ?
    AND drive_file_id = ?
`);
const listDeployedCloudBackupsForUserAndAppStmt = db.prepare(`
  SELECT
    id,
    user_id,
    app_id,
    account_id,
    drive_file_id,
    backup_name,
    target_path,
    size_bytes,
    created_at,
    deleted_at,
    metadata_json
  FROM deployed_app_cloud_backups
  WHERE user_id = ?
    AND app_id = ?
    AND deleted_at = ''
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);
const getWireGuardSettingsForUserStmt = db.prepare(`
  SELECT
    user_id,
    endpoint_host,
    default_dns,
    default_allowed_ips,
    default_keepalive_seconds,
    updated_at
  FROM wireguard_settings
  WHERE user_id = ?
  LIMIT 1
`);
const upsertWireGuardSettingsForUserStmt = db.prepare(`
  INSERT INTO wireguard_settings (
    user_id,
    endpoint_host,
    default_dns,
    default_allowed_ips,
    default_keepalive_seconds,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    endpoint_host = excluded.endpoint_host,
    default_dns = excluded.default_dns,
    default_allowed_ips = excluded.default_allowed_ips,
    default_keepalive_seconds = excluded.default_keepalive_seconds,
    updated_at = excluded.updated_at
`);
const listWireGuardPeerProfilesByInterfaceStmt = db.prepare(`
  SELECT
    id,
    user_id,
    interface_name,
    peer_name,
    public_key,
    client_ip,
    allowed_ips,
    dns,
    endpoint,
    keepalive_seconds,
    notes,
    config_cipher,
    created_at,
    updated_at,
    revoked_at
  FROM wireguard_peer_profiles
  WHERE interface_name = ?
    AND revoked_at = ''
  ORDER BY created_at DESC, id DESC
`);
const getWireGuardPeerProfileByIdStmt = db.prepare(`
  SELECT
    id,
    user_id,
    interface_name,
    peer_name,
    public_key,
    client_ip,
    allowed_ips,
    dns,
    endpoint,
    keepalive_seconds,
    notes,
    config_cipher,
    created_at,
    updated_at,
    revoked_at
  FROM wireguard_peer_profiles
  WHERE id = ?
  LIMIT 1
`);
const getWireGuardPeerProfileByPublicKeyStmt = db.prepare(`
  SELECT
    id,
    user_id,
    interface_name,
    peer_name,
    public_key,
    client_ip,
    allowed_ips,
    dns,
    endpoint,
    keepalive_seconds,
    notes,
    config_cipher,
    created_at,
    updated_at,
    revoked_at
  FROM wireguard_peer_profiles
  WHERE interface_name = ?
    AND public_key = ?
    AND revoked_at = ''
  ORDER BY created_at DESC, id DESC
  LIMIT 1
`);
const upsertWireGuardPeerProfileStmt = db.prepare(`
  INSERT INTO wireguard_peer_profiles (
    id,
    user_id,
    interface_name,
    peer_name,
    public_key,
    client_ip,
    allowed_ips,
    dns,
    endpoint,
    keepalive_seconds,
    notes,
    config_cipher,
    created_at,
    updated_at,
    revoked_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
  ON CONFLICT(id) DO UPDATE SET
    user_id = excluded.user_id,
    interface_name = excluded.interface_name,
    peer_name = excluded.peer_name,
    public_key = excluded.public_key,
    client_ip = excluded.client_ip,
    allowed_ips = excluded.allowed_ips,
    dns = excluded.dns,
    endpoint = excluded.endpoint,
    keepalive_seconds = excluded.keepalive_seconds,
    notes = excluded.notes,
    config_cipher = excluded.config_cipher,
    updated_at = excluded.updated_at,
    revoked_at = ''
`);
const revokeWireGuardPeerProfileByIdStmt = db.prepare(`
  UPDATE wireguard_peer_profiles
  SET
    revoked_at = ?,
    updated_at = ?
  WHERE id = ?
`);
const revokeWireGuardPeerProfileByPublicKeyStmt = db.prepare(`
  UPDATE wireguard_peer_profiles
  SET
    revoked_at = ?,
    updated_at = ?
  WHERE interface_name = ?
    AND public_key = ?
    AND revoked_at = ''
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
const listTaskRunsWithSnapshotsStmt = db.prepare(`
  SELECT
    id,
    status,
    snapshot_dir
  FROM task_runs
  WHERE snapshot_dir <> ''
  ORDER BY id DESC
  LIMIT 5000
`);
const markTaskRunSnapshotUnavailableByDirStmt = db.prepare(`
  UPDATE task_runs
  SET
    snapshot_dir = '',
    snapshot_ready = 0,
    rollback_available = 0,
    updated_at = ?
  WHERE snapshot_dir = ?
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

app.use(express.static(staticAssetsDir));

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

app.get('/api/workspace/file', requireAuth, (req, res) => {
  const rawPath = typeof req.query.path === 'string' ? req.query.path : '';
  return serveWorkspaceFile(rawPath, res);
});

const repoRootUrlPath = repoRootDir.replace(/\\/g, '/');
if (repoRootUrlPath.startsWith('/')) {
  const repoRootRegex = new RegExp(`^${escapeRegExp(repoRootUrlPath)}(?:/.*)?$`);
  app.get(repoRootRegex, requireAuth, (req, res) => {
    return serveWorkspaceFile(req.path, res);
  });
}

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

function getAiProviderDefinition(agentId) {
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (!safeAgentId) return null;
  return aiProviderDefinitionById.get(safeAgentId) || null;
}

function buildAiProviderCacheKey(userId, providerId) {
  const safeUserId = getSafeUserId(userId);
  const safeProviderId = normalizeSupportedAiAgentId(providerId);
  if (!safeUserId || !safeProviderId) return '';
  return `${safeUserId}:${safeProviderId}`;
}

function readCachedAiProviderModels(userId, providerId) {
  const key = buildAiProviderCacheKey(userId, providerId);
  if (!key) return null;
  const cached = aiProviderModelsCache.get(key);
  if (!cached) return null;
  if (Date.now() - Number(cached.fetchedAtMs || 0) > aiProviderModelCacheTtlMs) {
    return null;
  }
  return Array.isArray(cached.models) ? cached.models.slice() : null;
}

function cacheAiProviderModels(userId, providerId, models) {
  const key = buildAiProviderCacheKey(userId, providerId);
  if (!key) return;
  const safeModels = Array.isArray(models)
    ? models
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .filter((entry, index, list) => list.indexOf(entry) === index)
        .slice(0, 120)
    : [];
  aiProviderModelsCache.set(key, {
    fetchedAtMs: Date.now(),
    models: safeModels
  });
}

function readCachedAiProviderQuota(userId, providerId) {
  const key = buildAiProviderCacheKey(userId, providerId);
  if (!key) return null;
  const cached = aiProviderQuotaCache.get(key);
  if (!cached) return null;
  if (Date.now() - Number(cached.fetchedAtMs || 0) > aiProviderQuotaCacheTtlMs) {
    return null;
  }
  return cached.quota || null;
}

function cacheAiProviderQuota(userId, providerId, quotaPayload) {
  const key = buildAiProviderCacheKey(userId, providerId);
  if (!key) return;
  aiProviderQuotaCache.set(key, {
    fetchedAtMs: Date.now(),
    quota: buildUnifiedQuotaPayload(quotaPayload)
  });
}

function getUserAiAgentIntegration(userId, agentId) {
  const safeUserId = getSafeUserId(userId);
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (!safeUserId || !safeAgentId) {
    return normalizeUserAgentIntegrationRow(null);
  }
  const row = getUserAgentIntegrationStmt.get(safeUserId, safeAgentId);
  return normalizeUserAgentIntegrationRow(row);
}

function extractOpenAiModelIdsFromPayload(payload) {
  const list = Array.isArray(payload && payload.data)
    ? payload.data
    : Array.isArray(payload && payload.models)
      ? payload.models
      : [];
  return list
    .map((entry) => String((entry && (entry.id || entry.name)) || '').trim())
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .slice(0, 120);
}

function buildOpenAiCompatibleHeaders(apiKey, options = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };
  const safeApiKey = String(apiKey || '').trim();
  if (safeApiKey) {
    headers.Authorization = `Bearer ${safeApiKey}`;
  }
  if (options && options.includeOpenRouterHeaders) {
    headers['HTTP-Referer'] = 'https://codexweb.local';
    headers['X-Title'] = 'CodexWeb';
  }
  return headers;
}

const aiHttpProviderAdapters = Object.freeze({
  openrouter: {
    id: 'openrouter',
    defaultBaseUrl: OPENROUTER_DEFAULT_BASE_URL,
    requiresApiKey: true,
    streamFormat: 'openai_sse',
    async listModels({ baseUrl, integration }) {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        headers: buildOpenAiCompatibleHeaders(integration.apiKey, {
          includeOpenRouterHeaders: true
        })
      });
      if (!response.ok) throw new Error(`openrouter_models_http_${response.status}`);
      const payload = await response.json();
      return extractOpenAiModelIdsFromPayload(payload);
    },
    async getQuota({ baseUrl, integration }) {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/credits`, {
        method: 'GET',
        headers: buildOpenAiCompatibleHeaders(integration.apiKey, {
          includeOpenRouterHeaders: true
        })
      });
      if (!response.ok) throw new Error(`openrouter_credits_http_${response.status}`);
      const payload = await response.json();
      const data = payload && typeof payload.data === 'object' ? payload.data : payload;
      const used = Number(data && (data.total_usage ?? data.totalUsage ?? data.used));
      const limit = Number(data && (data.total_credits ?? data.totalCredits ?? data.limit));
      const remainingRaw = Number(data && (data.remaining_credits ?? data.remainingCredits ?? data.remaining));
      const remaining =
        Number.isFinite(remainingRaw) ? remainingRaw : Number.isFinite(limit) && Number.isFinite(used) ? limit - used : NaN;
      return {
        used,
        limit,
        remaining,
        unit: 'credits',
        resetAt: null,
        available: Number.isFinite(used) || Number.isFinite(limit) || Number.isFinite(remaining)
      };
    },
    buildChatRequest({ model, prompt, integration, baseUrl }) {
      return {
        endpoint: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        headers: buildOpenAiCompatibleHeaders(integration.apiKey, {
          includeOpenRouterHeaders: true
        }),
        body: {
          model,
          stream: true,
          messages: [{ role: 'user', content: prompt }]
        }
      };
    }
  },
  ollama: {
    id: 'ollama',
    defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
    requiresApiKey: false,
    streamFormat: 'ollama_jsonl',
    async listModels({ baseUrl }) {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
        method: 'GET'
      });
      if (!response.ok) throw new Error(`ollama_models_http_${response.status}`);
      const payload = await response.json();
      const models = Array.isArray(payload && payload.models) ? payload.models : [];
      return models
        .map((entry) => String((entry && entry.name) || '').trim())
        .filter(Boolean)
        .filter((entry, index, all) => all.indexOf(entry) === index)
        .slice(0, 120);
    },
    buildChatRequest({ model, prompt, baseUrl }) {
      return {
        endpoint: `${baseUrl.replace(/\/+$/, '')}/api/chat`,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          model,
          stream: true,
          messages: [{ role: 'user', content: prompt }]
        }
      };
    }
  },
  groq: {
    id: 'groq',
    defaultBaseUrl: GROQ_DEFAULT_BASE_URL,
    requiresApiKey: true,
    streamFormat: 'openai_sse',
    async listModels({ baseUrl, integration }) {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        headers: buildOpenAiCompatibleHeaders(integration.apiKey)
      });
      if (!response.ok) throw new Error(`groq_models_http_${response.status}`);
      const payload = await response.json();
      return extractOpenAiModelIdsFromPayload(payload);
    },
    buildChatRequest({ model, prompt, integration, baseUrl }) {
      return {
        endpoint: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        headers: buildOpenAiCompatibleHeaders(integration.apiKey),
        body: {
          model,
          stream: true,
          messages: [{ role: 'user', content: prompt }]
        }
      };
    }
  },
  lmstudio: {
    id: 'lmstudio',
    defaultBaseUrl: LMSTUDIO_DEFAULT_BASE_URL,
    requiresApiKey: false,
    streamFormat: 'openai_sse',
    async listModels({ baseUrl, integration }) {
      const headers = buildOpenAiCompatibleHeaders(integration.apiKey);
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        method: 'GET',
        headers
      });
      if (!response.ok) throw new Error(`lmstudio_models_http_${response.status}`);
      const payload = await response.json();
      return extractOpenAiModelIdsFromPayload(payload);
    },
    buildChatRequest({ model, prompt, integration, baseUrl }) {
      return {
        endpoint: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        headers: buildOpenAiCompatibleHeaders(integration.apiKey),
        body: {
          model,
          stream: true,
          messages: [{ role: 'user', content: prompt }]
        }
      };
    }
  }
});

function getAiHttpProviderAdapter(agentId) {
  const safeProviderId = normalizeSupportedAiAgentId(agentId);
  if (!safeProviderId) return null;
  return aiHttpProviderAdapters[safeProviderId] || null;
}

function normalizeAiProviderError(error, fallbackCode = 'provider_error') {
  const message = truncateForNotify(error && error.message ? error.message : fallbackCode, 260);
  const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : null;
  return {
    code: String((error && error.code) || fallbackCode).trim() || fallbackCode,
    message,
    statusCode
  };
}

function getAiProviderAdapter(agentId) {
  const safeProviderId = normalizeSupportedAiAgentId(agentId);
  if (!safeProviderId) return null;
  const providerDefinition = getAiProviderDefinition(safeProviderId);
  if (!providerDefinition) return null;
  const httpAdapter = getAiHttpProviderAdapter(safeProviderId);
  const fallbackModel = getChatAgentDefaultModel(safeProviderId);
  const base = {
    id: safeProviderId,
    listModels: async ({ userId, integration, allowRemoteFetch = true }) => {
      if (allowRemoteFetch && httpAdapter && typeof httpAdapter.listModels === 'function') {
        const baseUrl = resolveAiProviderBaseUrl(safeProviderId, integration) || httpAdapter.defaultBaseUrl;
        return httpAdapter.listModels({
          userId,
          providerId: safeProviderId,
          integration: normalizeUserAgentIntegrationRow(integration),
          baseUrl
        });
      }
      return getAiProviderStaticModelOptions(safeProviderId);
    },
    sendMessage: async () => {
      throw createClientRequestError(`Provider ${safeProviderId} no soporta sendMessage sync`, 501);
    },
    streamMessage: async () => {
      throw createClientRequestError(`Provider ${safeProviderId} no soporta streamMessage`, 501);
    },
    checkAvailability: ({ integration, codexLinked = false } = {}) =>
      isAiAgentConfiguredForUser(safeProviderId, integration, { codexLinked }),
    getQuota: async ({ userId, integration }) => {
      if (!httpAdapter || typeof httpAdapter.getQuota !== 'function') {
        return buildUnifiedQuotaPayload({ available: false });
      }
      const normalizedIntegration = normalizeUserAgentIntegrationRow(integration);
      const baseUrl = resolveAiProviderBaseUrl(safeProviderId, normalizedIntegration) || httpAdapter.defaultBaseUrl;
      const quota = await httpAdapter.getQuota({
        userId: getSafeUserId(userId),
        providerId: safeProviderId,
        integration: normalizedIntegration,
        baseUrl
      });
      return buildUnifiedQuotaPayload(quota);
    },
    listCapabilities: () => getAiProviderCapabilities(safeProviderId),
    normalizeError: (error) => normalizeAiProviderError(error),
    normalizeMessage: (message) => String(message || '').trim(),
    normalizeModel: (model) => normalizeChatAgentModel(safeProviderId, model || fallbackModel),
    supportsReasoningVisibility: () => getAiProviderCapabilities(safeProviderId).includes('reasoning-visibility'),
    getPermissionProfile: (userId) => getAiAgentPermissionProfileForUser(userId, safeProviderId),
    executeToolCall: async () => {
      throw createClientRequestError(`Provider ${safeProviderId} no soporta executeToolCall`, 501);
    },
    checkProviderHealth: async ({ integration }) => {
      if (!httpAdapter) return { available: true, reason: '' };
      const normalizedIntegration = normalizeUserAgentIntegrationRow(integration);
      if (httpAdapter.requiresApiKey && !String(normalizedIntegration.apiKey || '').trim()) {
        return { available: false, reason: 'missing_api_key' };
      }
      return {
        available: Boolean(resolveAiProviderBaseUrl(safeProviderId, normalizedIntegration)),
        reason: ''
      };
    }
  };
  if (!httpAdapter) {
    return base;
  }
  return {
    ...base,
    streamMessage: async ({ model, prompt, integration, reasoningEffort }) => {
      const normalizedIntegration = normalizeUserAgentIntegrationRow(integration);
      const baseUrl = resolveAiProviderBaseUrl(safeProviderId, normalizedIntegration) || httpAdapter.defaultBaseUrl;
      return httpAdapter.buildChatRequest({
        model: base.normalizeModel(model || fallbackModel),
        prompt: base.normalizeMessage(prompt),
        integration: normalizedIntegration,
        baseUrl,
        reasoningEffort: sanitizeReasoningEffort(reasoningEffort, DEFAULT_REASONING_EFFORT)
      });
    }
  };
}

function resolveAiProviderBaseUrl(agentId, integrationRow) {
  const providerId = normalizeSupportedAiAgentId(agentId);
  const normalized = normalizeUserAgentIntegrationRow(integrationRow);
  const custom = sanitizeHttpUrl(normalized.baseUrl || '', '');
  if (custom) return custom;
  const adapter = getAiHttpProviderAdapter(providerId);
  if (adapter && adapter.defaultBaseUrl) {
    return String(adapter.defaultBaseUrl || '').trim();
  }
  return '';
}

function isAiAgentConfiguredForUser(agentId, integrationRow, options = {}) {
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (!safeAgentId) return false;
  const provider = getAiProviderDefinition(safeAgentId);
  if (!provider) return false;
  const normalized = normalizeUserAgentIntegrationRow(integrationRow);
  const codexLinked = Boolean(options && options.codexLinked);
  if (safeAgentId === 'codex-cli') {
    return codexLinked;
  }
  const httpAdapter = getAiHttpProviderAdapter(safeAgentId);
  if (httpAdapter) {
    if (httpAdapter.requiresApiKey && !String(normalized.apiKey || '').trim()) {
      return false;
    }
    return Boolean(resolveAiProviderBaseUrl(safeAgentId, normalized));
  }
  if (String(provider.integrationType || '').toLowerCase() === 'api_key') {
    return Boolean(String(normalized.apiKey || '').trim());
  }
  return true;
}

async function listAiProviderModelsFromRemote(userId, providerId, integrationRow) {
  const safeProviderId = normalizeSupportedAiAgentId(providerId);
  const normalizedIntegration = normalizeUserAgentIntegrationRow(integrationRow);
  if (!safeProviderId) {
    return [];
  }
  const providerAdapter = getAiProviderAdapter(safeProviderId);
  if (providerAdapter && typeof providerAdapter.listModels === 'function') {
    return providerAdapter.listModels({
      userId: getSafeUserId(userId),
      integration: normalizedIntegration,
      allowRemoteFetch: true
    });
  }
  return [];
}

function getAiProviderStaticModelOptions(providerId) {
  const safeProviderId = normalizeSupportedAiAgentId(providerId);
  if (safeProviderId === 'codex-cli') {
    const cachedModels = loadCodexModelsFromCache();
    return [...chatGptModelOptions, ...cachedModels].filter((slug, index, list) => list.indexOf(slug) === index);
  }
  if (safeProviderId === 'gemini-cli') {
    return [...geminiModelOptions];
  }
  if (safeProviderId === 'openrouter') {
    return [...openRouterFallbackModels];
  }
  if (safeProviderId === 'ollama') {
    return [...ollamaFallbackModels];
  }
  if (safeProviderId === 'groq') {
    return [...groqFallbackModels];
  }
  if (safeProviderId === 'lmstudio') {
    return [...lmStudioFallbackModels];
  }
  return [];
}

async function listAiProviderModelsForUser(userId, providerId, options = {}) {
  const safeProviderId = normalizeSupportedAiAgentId(providerId);
  if (!safeProviderId) return [];
  const allowRemote = options && options.allowRemoteFetch === true;
  if (allowRemote) {
    const integrationRow = getUserAiAgentIntegration(userId, safeProviderId);
    try {
      const remote = await listAiProviderModelsFromRemote(userId, safeProviderId, integrationRow);
      if (remote.length > 0) {
        cacheAiProviderModels(userId, safeProviderId, remote);
        return remote;
      }
    } catch (_error) {
      // fallback to cached/static model list
    }
  }
  const cached = readCachedAiProviderModels(userId, safeProviderId);
  if (cached && cached.length > 0) {
    return cached;
  }
  return getAiProviderStaticModelOptions(safeProviderId);
}

function normalizeAiPermissionPathList(rawValue, fallback = [], options = null) {
  const allowEmpty = Boolean(options && options.allowEmpty);
  const source = Array.isArray(rawValue) ? rawValue : [];
  const resolved = [];
  const seen = new Set();
  source.forEach((entry) => {
    const normalized = normalizeAbsoluteStoragePath(entry);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    resolved.push(normalized);
  });
  if (resolved.length > 0) {
    return resolved.slice(0, 40);
  }
  const fallbackValues = Array.isArray(fallback) ? fallback : [];
  const safeFallback = fallbackValues
    .map((entry) => normalizeAbsoluteStoragePath(entry))
    .filter(Boolean);
  if (safeFallback.length > 0) {
    return safeFallback.slice(0, 40);
  }
  if (allowEmpty) {
    return [];
  }
  return ['/', repoRootDir]
    .map((entry) => normalizeAbsoluteStoragePath(entry))
    .filter(Boolean)
    .slice(0, 2);
}

function normalizeAiPermissionAllowedTools(rawValue) {
  const source = Array.isArray(rawValue) ? rawValue : [];
  const seen = new Set();
  const normalized = [];
  source.forEach((entry) => {
    const rawTool = String(entry || '').trim().toLowerCase();
    if (!rawTool) return;
    if (!aiPermissionToolCatalog.includes(rawTool) || seen.has(rawTool)) return;
    seen.add(rawTool);
    normalized.push(rawTool);
  });
  if (normalized.length > 0) {
    return normalized;
  }
  return [...aiPermissionDefaultAllowedTools];
}

function normalizeAiPermissionAccessMode(rawValue, fallback = aiProviderPermissionProfileDefaults.accessMode) {
  const normalized = String(rawValue || '')
    .trim()
    .toLowerCase();
  if (aiPermissionAccessModes.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function inferAiPermissionAccessMode(rawValue) {
  const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const readOnly = parseBooleanSetting(source.readOnly, false);
  const canWriteFiles = parseBooleanSetting(source.canWriteFiles, !readOnly);
  if (readOnly || !canWriteFiles) {
    return 'read_only';
  }
  const allowedPaths = normalizeAiPermissionPathList(source.allowedPaths, aiProviderPermissionProfileDefaults.allowedPaths);
  const deniedPaths = normalizeAiPermissionPathList(source.deniedPaths, [], { allowEmpty: true });
  const hasRootScope = allowedPaths.some((entry) => normalizeAbsoluteStoragePath(entry) === '/');
  if (parseBooleanSetting(source.allowRoot, false) && hasRootScope && deniedPaths.length === 0) {
    return 'full_access';
  }
  const workspaceOnly =
    allowedPaths.length > 0 &&
    allowedPaths.every((entry) => {
      const normalized = normalizeAbsoluteStoragePath(entry);
      return Boolean(normalized) && (normalized === repoRootDir || isPathWithin(repoRootDir, normalized));
    }) &&
    deniedPaths.length === 0;
  if (workspaceOnly) {
    return 'workspace_only';
  }
  return 'restricted_paths';
}

function buildAiPermissionPresetForMode(accessMode, currentProfile = null) {
  const normalizedMode = normalizeAiPermissionAccessMode(accessMode);
  const current = currentProfile && typeof currentProfile === 'object' ? currentProfile : {};
  const common = {
    accessMode: normalizedMode,
    runAsUser: '',
    allowShell: true,
    allowSensitiveTools: true,
    allowNetwork: true,
    allowGit: true,
    allowBackupRestore: true,
    allowedTools: [...aiPermissionToolCatalog]
  };
  if (normalizedMode === 'full_access') {
    return {
      ...common,
      allowRoot: true,
      allowedPaths: ['/'],
      deniedPaths: [],
      canWriteFiles: true,
      readOnly: false
    };
  }
  if (normalizedMode === 'workspace_only') {
    return {
      ...common,
      allowRoot: false,
      allowedPaths: [repoRootDir],
      deniedPaths: [],
      canWriteFiles: true,
      readOnly: false
    };
  }
  if (normalizedMode === 'read_only') {
    const currentAllowedPaths = normalizeAiPermissionPathList(
      current.allowedPaths,
      [repoRootDir]
    );
    return {
      ...common,
      allowRoot: false,
      allowedPaths: currentAllowedPaths,
      deniedPaths: normalizeAiPermissionPathList(current.deniedPaths, [], { allowEmpty: true }),
      canWriteFiles: false,
      readOnly: true
    };
  }
  return {
    ...common,
    allowRoot: false,
    allowedPaths: normalizeAiPermissionPathList(current.allowedPaths, [repoRootDir]),
    deniedPaths: normalizeAiPermissionPathList(current.deniedPaths, [], { allowEmpty: true }),
    canWriteFiles: true,
    readOnly: false
  };
}

function normalizeAiAgentPermissionProfile(rawValue) {
  const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const inferredAccessMode = inferAiPermissionAccessMode(source);
  const readOnly = parseBooleanSetting(source.readOnly, aiProviderPermissionProfileDefaults.readOnly);
  const canWriteFiles = parseBooleanSetting(
    source.canWriteFiles,
    readOnly ? false : aiProviderPermissionProfileDefaults.canWriteFiles
  );
  return {
    accessMode: normalizeAiPermissionAccessMode(source.accessMode, inferredAccessMode),
    allowRoot: parseBooleanSetting(source.allowRoot, aiProviderPermissionProfileDefaults.allowRoot),
    runAsUser: String(source.runAsUser || '').trim().slice(0, 60),
    allowedPaths: normalizeAiPermissionPathList(
      source.allowedPaths,
      aiProviderPermissionProfileDefaults.allowedPaths
    ),
    deniedPaths: normalizeAiPermissionPathList(source.deniedPaths, [], { allowEmpty: true }),
    canWriteFiles: canWriteFiles && !readOnly,
    readOnly: readOnly || !canWriteFiles,
    allowShell: parseBooleanSetting(source.allowShell, aiProviderPermissionProfileDefaults.allowShell),
    allowSensitiveTools: parseBooleanSetting(
      source.allowSensitiveTools,
      aiProviderPermissionProfileDefaults.allowSensitiveTools
    ),
    allowNetwork: parseBooleanSetting(source.allowNetwork, aiProviderPermissionProfileDefaults.allowNetwork),
    allowGit: parseBooleanSetting(source.allowGit, aiProviderPermissionProfileDefaults.allowGit),
    allowBackupRestore: parseBooleanSetting(
      source.allowBackupRestore,
      aiProviderPermissionProfileDefaults.allowBackupRestore
    ),
    allowedTools: normalizeAiPermissionAllowedTools(source.allowedTools)
  };
}

function normalizeAiAgentPermissionRow(rawValue) {
  const row = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const safeAgentId = normalizeSupportedAiAgentId(row.agent_id ?? row.agentId ?? '');
  const parsedAllowedPaths = safeParseJsonArray(row.allowed_paths_json ?? row.allowedPathsJson);
  const parsedDeniedPaths = safeParseJsonArray(row.denied_paths_json ?? row.deniedPathsJson);
  const parsedAllowedTools = safeParseJsonArray(row.allowed_tools_json ?? row.allowedToolsJson);
  const normalized = normalizeAiAgentPermissionProfile({
    accessMode: row.access_mode ?? row.accessMode,
    allowRoot: Number(row.allow_root) === 1,
    runAsUser: row.run_as_user,
    allowedPaths: parsedAllowedPaths,
    deniedPaths: parsedDeniedPaths,
    canWriteFiles: Number(row.can_write_files) === 1,
    readOnly: Number(row.read_only) === 1,
    allowShell: Number(row.allow_shell) === 1,
    allowSensitiveTools: Number(row.allow_sensitive_tools) === 1,
    allowNetwork: Number(row.allow_network) === 1,
    allowGit: Number(row.allow_git) === 1,
    allowBackupRestore: Number(row.allow_backup_restore) === 1,
    allowedTools: parsedAllowedTools
  });
  return {
    agentId: safeAgentId,
    ...normalized,
    updatedAt: String(row.updated_at ?? row.updatedAt ?? '').trim()
  };
}

function getAiAgentPermissionProfileForUser(userId, agentId) {
  const safeUserId = getSafeUserId(userId);
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (!safeUserId || !safeAgentId) {
    return {
      agentId: safeAgentId,
      ...normalizeAiAgentPermissionProfile(aiProviderPermissionProfileDefaults),
      updatedAt: ''
    };
  }
  const row = getUserAgentPermissionStmt.get(safeUserId, safeAgentId);
  if (!row) {
    return {
      agentId: safeAgentId,
      ...normalizeAiAgentPermissionProfile(aiProviderPermissionProfileDefaults),
      updatedAt: ''
    };
  }
  return normalizeAiAgentPermissionRow(row);
}

function upsertAiAgentPermissionProfileForUser(userId, agentId, profilePatch = {}) {
  const safeUserId = getSafeUserId(userId);
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (!safeUserId || !safeAgentId) {
    throw createClientRequestError('Agente inválido', 400);
  }
  const current = getAiAgentPermissionProfileForUser(safeUserId, safeAgentId);
  const safePatch = profilePatch && typeof profilePatch === 'object' ? profilePatch : {};
  const requestedMode = normalizeAiPermissionAccessMode(safePatch.accessMode, '');
  let nextSource = {
    ...current,
    ...safePatch
  };
  if (requestedMode) {
    nextSource = {
      ...current,
      ...buildAiPermissionPresetForMode(requestedMode, current),
      ...safePatch,
      accessMode: requestedMode
    };
    if (requestedMode === 'full_access') {
      nextSource.allowRoot = true;
      nextSource.allowedPaths = ['/'];
      nextSource.deniedPaths = [];
      nextSource.canWriteFiles = true;
      nextSource.readOnly = false;
    } else if (requestedMode === 'workspace_only') {
      nextSource.allowRoot = false;
      nextSource.allowedPaths = [repoRootDir];
      nextSource.deniedPaths = [];
    } else if (requestedMode === 'read_only') {
      nextSource.allowRoot = false;
      nextSource.canWriteFiles = false;
      nextSource.readOnly = true;
    }
  }
  const next = normalizeAiAgentPermissionProfile(nextSource);
  const updatedAt = nowIso();
  upsertUserAgentPermissionStmt.run(
    safeUserId,
    safeAgentId,
    next.accessMode,
    next.allowRoot ? 1 : 0,
    next.runAsUser,
    JSON.stringify(next.allowedPaths),
    JSON.stringify(next.deniedPaths),
    next.canWriteFiles ? 1 : 0,
    next.readOnly ? 1 : 0,
    next.allowShell ? 1 : 0,
    next.allowSensitiveTools ? 1 : 0,
    next.allowNetwork ? 1 : 0,
    next.allowGit ? 1 : 0,
    next.allowBackupRestore ? 1 : 0,
    JSON.stringify(next.allowedTools),
    updatedAt
  );
  return {
    agentId: safeAgentId,
    ...next,
    updatedAt
  };
}

function buildAiPermissionFullAccessPatch() {
  return {
    accessMode: 'full_access',
    allowRoot: true,
    runAsUser: '',
    allowedPaths: ['/'],
    deniedPaths: [],
    canWriteFiles: true,
    readOnly: false,
    allowShell: true,
    allowSensitiveTools: true,
    allowNetwork: true,
    allowGit: true,
    allowBackupRestore: true,
    allowedTools: [...aiPermissionToolCatalog]
  };
}

function grantFullAccessToActiveProviderForAdminUsersOnStartup() {
  const adminUsernames = Array.from(adminUsers)
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  if (adminUsernames.length === 0) {
    return;
  }
  const placeholders = adminUsernames.map(() => '?').join(', ');
  if (!placeholders) {
    return;
  }
  const rows = db
    .prepare(
      `SELECT id, username, active_ai_agent_id
       FROM users
       WHERE LOWER(username) IN (${placeholders})`
    )
    .all(...adminUsernames);
  rows.forEach((row) => {
    const safeUserId = getSafeUserId(row && row.id);
    if (!safeUserId) return;
    const runtime = resolveChatAgentRuntimeForUser(safeUserId);
    const requestedProviderId = normalizeSupportedAiAgentId(row && row.active_ai_agent_id);
    const providerId =
      requestedProviderId || normalizeSupportedAiAgentId(runtime && runtime.activeAgentId);
    if (!providerId) return;
    try {
      upsertAiAgentPermissionProfileForUser(
        safeUserId,
        providerId,
        buildAiPermissionFullAccessPatch()
      );
      void notify(
        `PERMISSIONS startup_grant_full user=${truncateForNotify(
          (row && row.username) || String(safeUserId),
          80
        )} provider=${providerId}`
      );
    } catch (error) {
      const reason = truncateForNotify(
        error && error.message ? error.message : 'startup_grant_full_failed',
        180
      );
      console.warn(`No se pudo aplicar grant-full de arranque para admin user=${safeUserId}: ${reason}`);
      void notify(
        `PERMISSIONS startup_grant_full_failed user=${safeUserId} provider=${providerId} reason=${reason}`
      );
    }
  });
}

function isPathAllowedByPermissionProfile(profile, absolutePath) {
  const safeProfile =
    profile && typeof profile === 'object'
      ? profile
      : normalizeAiAgentPermissionProfile(aiProviderPermissionProfileDefaults);
  const target = normalizeAbsoluteStoragePath(absolutePath);
  if (!target) return false;
  const deniedPaths = normalizeAiPermissionPathList(safeProfile.deniedPaths || [], [], { allowEmpty: true });
  if (deniedPaths.some((entry) => isPathWithin(entry, target) || normalizeAbsoluteStoragePath(entry) === target)) {
    return false;
  }
  const allowedPaths = normalizeAiPermissionPathList(
    safeProfile.allowedPaths || [],
    aiProviderPermissionProfileDefaults.allowedPaths
  );
  return allowedPaths.some((entry) => isPathWithin(entry, target) || normalizeAbsoluteStoragePath(entry) === target);
}

function assertAiPermissionForAction(profile, action, options = {}) {
  const safeAction = String(action || '').trim().toLowerCase();
  const safeProfile =
    profile && typeof profile === 'object'
      ? profile
      : normalizeAiAgentPermissionProfile(aiProviderPermissionProfileDefaults);
  const readOnlyWriteIntent = Boolean(options && options.writeIntent);
  const targetPath = options && options.targetPath ? String(options.targetPath) : '';
  const requiresSensitive = Boolean(options && options.requiresSensitiveTool);
  const requiresGit = Boolean(options && options.requiresGit);
  const requiresBackupRestore = Boolean(options && options.requiresBackupRestore);
  const requiresShell = Boolean(options && options.requiresShell);
  const requiresNetwork = Boolean(options && options.requiresNetwork);

  if (safeProfile.allowedTools && Array.isArray(safeProfile.allowedTools)) {
    const allowed = safeAction ? safeProfile.allowedTools.includes(safeAction) : true;
    if (safeAction && !allowed) {
      throw createClientRequestError(`Acción bloqueada por permisos (${safeAction})`, 403);
    }
  }
  if (requiresShell && !safeProfile.allowShell) {
    throw createClientRequestError('El perfil actual no permite acceso a shell', 403);
  }
  if (requiresNetwork && !safeProfile.allowNetwork) {
    throw createClientRequestError('El perfil actual no permite acceso de red', 403);
  }
  if (requiresSensitive && !safeProfile.allowSensitiveTools) {
    throw createClientRequestError('El perfil actual bloquea herramientas sensibles', 403);
  }
  if (requiresGit && !safeProfile.allowGit) {
    throw createClientRequestError('El perfil actual no permite operaciones Git', 403);
  }
  if (requiresBackupRestore && !safeProfile.allowBackupRestore) {
    throw createClientRequestError('El perfil actual no permite backup/restauración', 403);
  }
  if (readOnlyWriteIntent && (safeProfile.readOnly || !safeProfile.canWriteFiles)) {
    throw createClientRequestError('El perfil actual no permite escribir archivos', 403);
  }
  if (targetPath) {
    const normalizedTarget = normalizeAbsoluteStoragePath(targetPath);
    if (!isPathAllowedByPermissionProfile(safeProfile, normalizedTarget)) {
      throw createClientRequestError('La ruta solicitada está fuera de los permisos del perfil activo', 403);
    }
  }
}

function getActiveAiAgentPermissionProfileForUser(userId) {
  const runtime = resolveChatAgentRuntimeForUser(userId);
  const activeAgentId = normalizeSupportedAiAgentId(runtime.activeAgentId);
  const profile = getAiAgentPermissionProfileForUser(userId, activeAgentId);
  return {
    activeAgentId,
    profile
  };
}

function assertRequestPermissionByActiveAgent(req, action, options = {}) {
  const safeUserId = getSafeUserId(req && req.session ? req.session.userId : 0);
  if (!safeUserId) {
    throw createClientRequestError('user_id inválido', 400);
  }
  const { activeAgentId, profile } = getActiveAiAgentPermissionProfileForUser(safeUserId);
  assertAiPermissionForAction(profile, action, options);
  return {
    activeAgentId,
    profile
  };
}

function guardRequestPermissionOrRespond(req, res, action, options = {}) {
  try {
    return assertRequestPermissionByActiveAgent(req, action, options);
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 403;
    res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `Operación bloqueada por permisos: ${truncateForNotify(error && error.message ? error.message : 'permission_denied', 200)}`
    });
    return null;
  }
}

function buildUnifiedQuotaPayload(rawQuota) {
  const source = rawQuota && typeof rawQuota === 'object' ? rawQuota : {};
  const used = Number(source.used);
  const limit = Number(source.limit);
  const remaining = Number(source.remaining);
  const unitRaw = String(source.unit || '').trim().toLowerCase();
  const resetAt = String(source.resetAt || '').trim();
  return {
    used: Number.isFinite(used) ? used : null,
    limit: Number.isFinite(limit) ? limit : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    unit: aiProviderQuotaUnits.has(unitRaw) ? unitRaw : null,
    resetAt: resetAt || null,
    available: Boolean(source.available)
  };
}

function getAiProviderQuotaForUser(userId, agentId) {
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (safeAgentId === 'codex-cli') {
    const snapshot = getCodexQuotaSnapshotForUser(userId);
    if (snapshot && snapshot.primary) {
      return buildUnifiedQuotaPayload({
        used: snapshot.primary.used,
        limit: snapshot.primary.limit,
        remaining: snapshot.primary.remaining,
        unit: 'requests',
        resetAt: snapshot.primary.resetAt,
        available: true
      });
    }
    const cachedCodex = buildUnifiedQuotaPayload({ available: false });
    cacheAiProviderQuota(userId, safeAgentId, cachedCodex);
    return cachedCodex;
  }
  const cached = readCachedAiProviderQuota(userId, safeAgentId);
  if (cached) {
    return buildUnifiedQuotaPayload(cached);
  }
  return buildUnifiedQuotaPayload({ available: false });
}

async function refreshAiProviderQuotaForUser(userId, agentId) {
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (!safeAgentId) {
    return buildUnifiedQuotaPayload({ available: false });
  }
  if (safeAgentId === 'codex-cli') {
    const quota = getAiProviderQuotaForUser(userId, safeAgentId);
    cacheAiProviderQuota(userId, safeAgentId, quota);
    return quota;
  }
  const integration = getUserAiAgentIntegration(userId, safeAgentId);
  const providerAdapter = getAiProviderAdapter(safeAgentId);
  if (!providerAdapter || typeof providerAdapter.getQuota !== 'function') {
    const unavailable = buildUnifiedQuotaPayload({ available: false });
    cacheAiProviderQuota(userId, safeAgentId, unavailable);
    return unavailable;
  }
  const httpAdapter = getAiHttpProviderAdapter(safeAgentId);
  if (httpAdapter && httpAdapter.requiresApiKey && !String(integration.apiKey || '').trim()) {
    const unavailable = buildUnifiedQuotaPayload({ available: false });
    cacheAiProviderQuota(userId, safeAgentId, unavailable);
    return unavailable;
  }
  try {
    const quota = await providerAdapter.getQuota({
      userId: getSafeUserId(userId),
      integration
    });
    const normalizedQuota = buildUnifiedQuotaPayload(quota);
    cacheAiProviderQuota(userId, safeAgentId, normalizedQuota);
    return normalizedQuota;
  } catch (_error) {
    const fallback = getAiProviderQuotaForUser(userId, safeAgentId);
    return buildUnifiedQuotaPayload(fallback);
  }
}

function getAiProviderCapabilities(agentId) {
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  const list = aiProviderCapabilitiesById[safeAgentId];
  return Array.isArray(list) ? list.slice() : [];
}

function serializeAiProviderInfoForUser(userId, agentId, options = null) {
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (!safeAgentId) return null;
  const agent = supportedAiAgentsById.get(safeAgentId);
  if (!agent) return null;
  const serializationOptions = options || getAiAgentSerializationOptionsForUser(userId);
  const integrationRow = getUserAgentIntegrationStmt.get(userId, safeAgentId);
  const setting = serializeAiAgentSetting(agent, integrationRow, serializationOptions);
  const models = getChatAgentModelOptions(safeAgentId, userId);
  const providerAdapter = getAiProviderAdapter(safeAgentId);
  const profile =
    providerAdapter && typeof providerAdapter.getPermissionProfile === 'function'
      ? providerAdapter.getPermissionProfile(userId)
      : getAiAgentPermissionProfileForUser(userId, safeAgentId);
  const hasChatCapability = getAiProviderCapabilities(safeAgentId).includes('chat');
  return {
    id: safeAgentId,
    name: setting.name,
    vendor: setting.vendor,
    description: setting.description,
    pricing: setting.pricing,
    integrationType: setting.integrationType,
    authModes: aiProviderAuthModesById[safeAgentId] || [setting.integrationType],
    docsUrl: setting.docsUrl,
    integration: setting.integration,
    capabilities: getAiProviderCapabilities(safeAgentId),
    models,
    defaults: {
      model: getChatAgentDefaultModel(safeAgentId),
      reasoningEffort: DEFAULT_REASONING_EFFORT
    },
    quota: getAiProviderQuotaForUser(userId, safeAgentId),
    permissions: profile,
    supportsReasoningVisibility: Boolean(
      providerAdapter &&
        typeof providerAdapter.supportsReasoningVisibility === 'function' &&
        providerAdapter.supportsReasoningVisibility()
    ),
    availability: {
      chat: supportedChatRuntimeAgentIds.has(safeAgentId) && hasChatCapability,
      configured: Boolean(setting.integration && setting.integration.configured),
      enabled: Boolean(setting.integration && setting.integration.enabled)
    }
  };
}

function listAiProvidersForUser(userId) {
  const serializationOptions = getAiAgentSerializationOptionsForUser(userId);
  return supportedAiAgents
    .map((agent) => serializeAiProviderInfoForUser(userId, agent.id, serializationOptions))
    .filter(Boolean);
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
  const hasApiKey = Boolean(normalized.apiKey);
  const configured = isAiAgentConfiguredForUser(agent && agent.id, normalized, options);
  const resolvedBaseUrl = resolveAiProviderBaseUrl(agent && agent.id, normalized);
  return {
    enabled: forceEnabled ? true : normalized.enabled,
    configured,
    hasApiKey,
    apiKeyMasked: hasApiKey ? maskSecretValue(normalized.apiKey) : '',
    baseUrl: resolvedBaseUrl,
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
    authModes: aiProviderAuthModesById[agent.id] || [agent.integrationType],
    docsUrl: agent.docsUrl,
    supportsBaseUrl: Boolean(agent.supportsBaseUrl),
    capabilities: getAiProviderCapabilities(agent.id),
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

function getChatAgentModelOptions(agentId, userId = 0) {
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  if (!safeAgentId) return [];
  const cached = readCachedAiProviderModels(userId, safeAgentId);
  if (cached && cached.length > 0) {
    return cached;
  }
  return getAiProviderStaticModelOptions(safeAgentId);
}

function getChatAgentDefaultModel(agentId) {
  const safeAgentId = normalizeSupportedAiAgentId(agentId);
  const provider = getAiProviderDefinition(safeAgentId);
  return String((provider && provider.defaultModel) || DEFAULT_CHAT_MODEL).trim() || DEFAULT_CHAT_MODEL;
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
  const selectableRuntimeIds = payload.agents
    .filter((entry) => supportedChatRuntimeAgentIds.has(String(entry && entry.id ? entry.id : '')))
    .filter((entry) => isSerializedAiAgentSelectable(entry))
    .map((entry) => String(entry.id || '').trim())
    .filter(Boolean);
  const defaultRuntimeId = supportedChatRuntimeAgentIds.has('codex-cli')
    ? 'codex-cli'
    : Array.from(supportedChatRuntimeAgentIds.values())[0] || '';
  const requestedIsSelectable = selectableRuntimeIds.includes(requestedAgentId);
  let effectiveAgentId = requestedIsSelectable
    ? requestedAgentId
    : selectableRuntimeIds[0] || requestedAgentId || defaultRuntimeId;
  if (!effectiveAgentId || !supportedChatRuntimeAgentIds.has(effectiveAgentId)) {
    effectiveAgentId = defaultRuntimeId;
  }
  if (!effectiveAgentId) {
    effectiveAgentId = 'codex-cli';
  }
  const effectiveAgent = supportedAiAgentsById.get(effectiveAgentId);
  const providerDefinition = getAiProviderDefinition(effectiveAgentId);
  const models = getChatAgentModelOptions(effectiveAgentId, userId);
  const defaultModel = getChatAgentDefaultModel(effectiveAgentId);
  const permissionProfile = getAiAgentPermissionProfileForUser(userId, effectiveAgentId);
  const capabilities = getAiProviderCapabilities(effectiveAgentId);
  return {
    requestedAgentId,
    activeAgentId: effectiveAgentId,
    activeAgentName:
      String((effectiveAgent && effectiveAgent.name) || '').trim() || effectiveAgentId || 'Codex CLI',
    providerId: effectiveAgentId,
    runtimeProvider:
      String((providerDefinition && providerDefinition.runtimeProvider) || '').trim() || effectiveAgentId,
    models,
    capabilities,
    permissionProfile,
    quota: getAiProviderQuotaForUser(userId, effectiveAgentId),
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

const unixUserIdentityCache = new Map();

function resolveUnixUserIdentity(username) {
  const safeName = String(username || '').trim();
  if (!safeName) return null;
  if (unixUserIdentityCache.has(safeName)) {
    return unixUserIdentityCache.get(safeName);
  }
  try {
    const uidRaw = execFileSync('id', ['-u', safeName], { encoding: 'utf8', timeout: 4000 }).trim();
    const gidRaw = execFileSync('id', ['-g', safeName], { encoding: 'utf8', timeout: 4000 }).trim();
    const uid = Number(uidRaw);
    const gid = Number(gidRaw);
    if (!Number.isInteger(uid) || uid < 0 || !Number.isInteger(gid) || gid < 0) {
      return null;
    }
    const identity = { user: safeName, uid, gid };
    unixUserIdentityCache.set(safeName, identity);
    return identity;
  } catch (_error) {
    return null;
  }
}

function getModeMaskForIdentity(stats, identity) {
  if (!stats || !identity) return 0;
  if (identity.uid === 0) {
    return 0o7;
  }
  if (Number(stats.uid) === Number(identity.uid)) {
    return (stats.mode >> 6) & 0o7;
  }
  if (Number(stats.gid) === Number(identity.gid)) {
    return (stats.mode >> 3) & 0o7;
  }
  return stats.mode & 0o7;
}

function hasDirectoryAccessForIdentity(directoryPath, identity, writeRequired = false) {
  if (!identity || identity.uid === 0) return true;
  try {
    const stats = fs.statSync(directoryPath);
    if (!stats.isDirectory()) {
      return false;
    }
    const mask = getModeMaskForIdentity(stats, identity);
    const requiredBits = writeRequired ? 0o7 : 0o5;
    return (mask & requiredBits) === requiredBits;
  } catch (_error) {
    return false;
  }
}

function isPathAccessibleForIdentity(targetPath, identity, options = {}) {
  if (!identity || identity.uid === 0) return true;
  const normalized = normalizeAbsoluteStoragePath(targetPath);
  if (!normalized) return false;
  const writeRequired = Boolean(options.writeRequired);
  const segments = [];
  let cursor = normalized;
  while (cursor) {
    segments.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  segments.reverse();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isFinal = index === segments.length - 1;
    if (!hasDirectoryAccessForIdentity(segment, identity, isFinal && writeRequired)) {
      return false;
    }
  }
  return true;
}

function resolveChatRuntimeExecutionPolicy(userId, chatRuntime) {
  const providerId = normalizeSupportedAiAgentId(chatRuntime && chatRuntime.activeAgentId);
  const profile = getAiAgentPermissionProfileForUser(userId, providerId);
  const accessMode = normalizeAiPermissionAccessMode(profile.accessMode, inferAiPermissionAccessMode(profile));
  const allowedPaths = normalizeAiPermissionPathList(
    profile.allowedPaths,
    aiProviderPermissionProfileDefaults.allowedPaths
  ).filter((entry) => pathExistsSyncSafe(entry));
  const deniedPaths = normalizeAiPermissionPathList(profile.deniedPaths, [], { allowEmpty: true });
  const safeAllowedPaths = allowedPaths.length > 0 ? allowedPaths : [repoRootDir];

  const firstAllowed = safeAllowedPaths.find((entry) => {
    const normalized = normalizeAbsoluteStoragePath(entry);
    if (!normalized || !pathExistsSyncSafe(normalized)) return false;
    if (deniedPaths.some((blocked) => isPathWithin(blocked, normalized) || blocked === normalized)) return false;
    try {
      const stats = fs.statSync(normalized);
      return stats.isDirectory();
    } catch (_error) {
      return false;
    }
  });
  const cwd = accessMode === 'full_access' ? process.cwd() : firstAllowed || repoRootDir;

  let runAsIdentity = null;
  let identityFallbackReason = '';
  const canSwitchUser = typeof process.getuid === 'function' && process.getuid() === 0;
  if (canSwitchUser) {
    if (profile.runAsUser) {
      runAsIdentity = resolveUnixUserIdentity(profile.runAsUser);
      if (!runAsIdentity) {
        throw createClientRequestError(
          `El usuario del sistema configurado no existe: ${profile.runAsUser}`,
          400
        );
      }
    } else if (!profile.allowRoot) {
      runAsIdentity = resolveUnixUserIdentity('nobody') || { user: 'nobody', uid: 65534, gid: 65534 };
    }
  }
  if (runAsIdentity) {
    const writeRequired = Boolean(profile.canWriteFiles) && !profile.readOnly;
    const inaccessiblePaths = safeAllowedPaths.filter(
      (entry) => !isPathAccessibleForIdentity(entry, runAsIdentity, { writeRequired })
    );
    if (!isPathAccessibleForIdentity(cwd, runAsIdentity, { writeRequired })) {
      inaccessiblePaths.unshift(cwd);
    }
    if (inaccessiblePaths.length > 0) {
      const samplePath = normalizeAbsoluteStoragePath(inaccessiblePaths[0]) || inaccessiblePaths[0];
      identityFallbackReason = `runAsUser=${runAsIdentity.user} sin acceso a ${samplePath}`;
      console.warn(`Codex runtime fallback a root: ${identityFallbackReason}`);
      runAsIdentity = null;
    }
  }

  const hasRootScope = safeAllowedPaths.some((entry) => normalizeAbsoluteStoragePath(entry) === '/');
  const codexSandbox = profile.readOnly || !profile.canWriteFiles
    ? 'read-only'
    : accessMode === 'full_access' && profile.allowRoot && hasRootScope && deniedPaths.length === 0
      ? 'danger-full-access'
      : 'workspace-write';

  return {
    providerId,
    accessMode,
    profile,
    cwd,
    allowedPaths: safeAllowedPaths,
    deniedPaths,
    runAsIdentity,
    identityFallbackReason,
    codexSandbox
  };
}

function getOwnedConversationOrNull(conversationId, userId) {
  const conversation = getConversationStmt.get(conversationId);
  if (!conversation || conversation.user_id !== userId) {
    return null;
  }
  return conversation;
}

function getOwnedProjectOrNull(projectId, userId) {
  const parsedProjectId = Number(projectId);
  if (!Number.isInteger(parsedProjectId) || parsedProjectId <= 0) {
    return null;
  }
  const safeUserId = getSafeUserId(userId);
  if (!safeUserId) return null;
  const row = getChatProjectByIdForUserStmt.get(parsedProjectId, safeUserId);
  return row || null;
}

function parseProjectIdInput(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  if (rawValue === 'null') return null;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function serializeChatProjectRow(row, options = {}) {
  if (!row || typeof row !== 'object') return null;
  const includeContext = Boolean(options.includeContext);
  const includePreview = Boolean(options.includePreview);
  const autoMeta = safeParseJsonObject(row.auto_context_meta_json);
  const manualContext = normalizeProjectContextText(row.manual_context, projectContextManualMaxChars);
  const autoContext = normalizeProjectContextText(row.auto_context, projectContextAutoMaxChars);
  const payload = {
    id: Number(row.id),
    name: sanitizeProjectName(row.name) || 'Proyecto',
    contextMode: normalizeProjectContextMode(row.context_mode, 'mixed'),
    autoContextEnabled: normalizeProjectAutoEnabled(row.auto_context_enabled, true),
    autoUpdatedAt: String(row.auto_updated_at || '').trim(),
    createdAt: String(row.created_at || '').trim(),
    updatedAt: String(row.updated_at || '').trim(),
    autoLastMessageId: Math.max(0, Number(row.auto_last_message_id) || 0),
    autoMeta: autoMeta && typeof autoMeta === 'object' ? autoMeta : {},
    stats: {
      chatCount: Math.max(0, Number(row.chat_count) || 0),
      lastMessageAt: String(row.last_message_at || '').trim()
    }
  };
  if (includeContext) {
    payload.manualContext = manualContext;
    payload.autoContext = autoContext;
  } else if (includePreview) {
    payload.manualContextPreview = manualContext ? normalizeProjectContextText(manualContext, 240) : '';
    payload.autoContextPreview = autoContext ? normalizeProjectContextText(autoContext, 240) : '';
  }
  return payload;
}

function buildEffectiveProjectContext(projectRow) {
  if (!projectRow || typeof projectRow !== 'object') {
    return {
      used: false,
      mode: 'mixed',
      manualUsed: false,
      autoUsed: false,
      text: '',
      sections: []
    };
  }
  const mode = normalizeProjectContextMode(projectRow.context_mode, 'mixed');
  const autoEnabled = normalizeProjectAutoEnabled(projectRow.auto_context_enabled, true);
  const manualContext = normalizeProjectContextText(projectRow.manual_context, projectContextManualMaxChars);
  const autoContext = normalizeProjectContextText(projectRow.auto_context, projectContextAutoMaxChars);
  const useManual = (mode === 'manual' || mode === 'mixed') && Boolean(manualContext);
  const useAuto = autoEnabled && (mode === 'automatic' || mode === 'mixed') && Boolean(autoContext);
  const sections = [];
  if (useManual) {
    sections.push({
      source: 'manual',
      title: 'Contexto manual del proyecto',
      text: manualContext
    });
  }
  if (useAuto) {
    sections.push({
      source: 'automatic',
      title: 'Memoria automática del proyecto',
      text: autoContext
    });
  }
  const combinedText = sections
    .map((entry) => `${entry.title}:\n${entry.text}`)
    .join('\n\n')
    .trim();
  return {
    used: combinedText.length > 0,
    mode,
    manualUsed: useManual,
    autoUsed: useAuto,
    autoEnabled,
    text: combinedText,
    sections
  };
}

function buildPromptWithProjectContext(currentPrompt, projectRow) {
  const projectName = sanitizeProjectName(projectRow && projectRow.name ? projectRow.name : '');
  const context = buildEffectiveProjectContext(projectRow);
  if (!context.used) {
    return currentPrompt;
  }
  const lines = [
    'Contexto compartido del proyecto activo. Debes respetarlo en toda la respuesta.',
    projectName ? `Proyecto: ${projectName}` : '',
    ...context.sections.map((entry) => `${entry.title}:\n${entry.text}`),
    '',
    'Responde manteniendo coherencia con este contexto de proyecto.',
    '',
    currentPrompt
  ].filter(Boolean);
  return lines.join('\n');
}

function serializeConversationProjectRef(conversationRow) {
  const projectId = Number(conversationRow && conversationRow.project_id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return null;
  }
  return {
    id: projectId,
    name: sanitizeProjectName(conversationRow && conversationRow.project_name ? conversationRow.project_name : '') || '',
    contextMode: normalizeProjectContextMode(
      conversationRow && conversationRow.project_context_mode ? conversationRow.project_context_mode : 'mixed',
      'mixed'
    ),
    autoContextEnabled: normalizeProjectAutoEnabled(
      conversationRow && conversationRow.project_auto_context_enabled,
      true
    )
  };
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
  for (const [uploadId, upload] of pendingChunkUploads.entries()) {
    if (!upload || upload.conversationId !== conversationId) continue;
    try {
      if (upload.path && fs.existsSync(upload.path)) {
        fs.unlinkSync(upload.path);
      }
    } catch (_error) {
      // best-effort cleanup
    }
    pendingChunkUploads.delete(uploadId);
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

function extractTextFromProviderPayload(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (!entry || typeof entry !== 'object') return '';
        if (typeof entry.text === 'string') return entry.text;
        if (typeof entry.content === 'string') return entry.content;
        if (entry.type === 'text' && typeof entry.value === 'string') return entry.value;
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
  }
  return '';
}

function buildAbortableRunHandle(abortController) {
  const state = {
    exitCode: null,
    killed: false,
    pid: null,
    kill(signal = 'SIGTERM') {
      if (state.killed || state.exitCode !== null) return false;
      state.killed = true;
      state.exitCode = signal === 'SIGKILL' ? 137 : 143;
      try {
        abortController.abort();
      } catch (_error) {
        // no-op
      }
      return true;
    }
  };
  return state;
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

app.get('/api/ai/providers', requireAuth, (req, res) => {
  const providers = listAiProvidersForUser(req.session.userId);
  const runtime = resolveChatAgentRuntimeForUser(req.session.userId);
  return res.json({
    ok: true,
    fetchedAt: nowIso(),
    activeProviderId: runtime.providerId,
    providers
  });
});

app.get('/api/ai/providers/:providerId/models', requireAuth, async (req, res) => {
  const providerId = normalizeSupportedAiAgentId(req.params && req.params.providerId);
  if (!providerId) {
    return res.status(404).json({ error: 'Provider no soportado' });
  }
  let models = [];
  try {
    models = await listAiProviderModelsForUser(req.session.userId, providerId, {
      allowRemoteFetch: true
    });
  } catch (_error) {
    models = getChatAgentModelOptions(providerId, req.session.userId);
  }
  return res.json({
    ok: true,
    providerId,
    models,
    defaultModel: getChatAgentDefaultModel(providerId)
  });
});

app.get('/api/ai/providers/:providerId/capabilities', requireAuth, (req, res) => {
  const providerId = normalizeSupportedAiAgentId(req.params && req.params.providerId);
  if (!providerId) {
    return res.status(404).json({ error: 'Provider no soportado' });
  }
  return res.json({
    ok: true,
    providerId,
    capabilities: getAiProviderCapabilities(providerId)
  });
});

app.get('/api/ai/providers/:providerId/availability', requireAuth, async (req, res) => {
  const providerId = normalizeSupportedAiAgentId(req.params && req.params.providerId);
  if (!providerId) {
    return res.status(404).json({ error: 'Provider no soportado' });
  }
  const providerAdapter = getAiProviderAdapter(providerId);
  const integration = getUserAiAgentIntegration(req.session.userId, providerId);
  const serializationOptions = getAiAgentSerializationOptionsForUser(req.session.userId);
  const configured = isAiAgentConfiguredForUser(providerId, integration, serializationOptions);
  let health = {
    available: configured,
    reason: configured ? '' : 'not_configured'
  };
  if (providerAdapter && typeof providerAdapter.checkProviderHealth === 'function') {
    try {
      health = await providerAdapter.checkProviderHealth({
        userId: req.session.userId,
        integration
      });
    } catch (error) {
      const normalized = providerAdapter.normalizeError(error);
      health = {
        available: false,
        reason: normalized.code || 'provider_health_failed'
      };
    }
  }
  return res.json({
    ok: true,
    providerId,
    availability: {
      configured,
      available: Boolean(health.available),
      reason: String(health.reason || '').trim()
    }
  });
});

app.get('/api/ai/providers/:providerId/quota', requireAuth, async (req, res) => {
  const providerId = normalizeSupportedAiAgentId(req.params && req.params.providerId);
  if (!providerId) {
    return res.status(404).json({ error: 'Provider no soportado' });
  }
  let quota = getAiProviderQuotaForUser(req.session.userId, providerId);
  try {
    quota = await refreshAiProviderQuotaForUser(req.session.userId, providerId);
  } catch (_error) {
    quota = getAiProviderQuotaForUser(req.session.userId, providerId);
  }
  return res.json({
    ok: true,
    providerId,
    quota
  });
});

app.get('/api/ai/providers/:providerId/permissions', requireAuth, (req, res) => {
  const providerId = normalizeSupportedAiAgentId(req.params && req.params.providerId);
  if (!providerId) {
    return res.status(404).json({ error: 'Provider no soportado' });
  }
  const permissions = getAiAgentPermissionProfileForUser(req.session.userId, providerId);
  return res.json({
    ok: true,
    providerId,
    permissions
  });
});

app.put('/api/ai/providers/:providerId/permissions', requireAuth, (req, res) => {
  const providerId = normalizeSupportedAiAgentId(req.params && req.params.providerId);
  if (!providerId) {
    return res.status(404).json({ error: 'Provider no soportado' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : null;
  if (!body) {
    return res.status(400).json({ error: 'Payload inválido' });
  }
  try {
    const permissions = upsertAiAgentPermissionProfileForUser(req.session.userId, providerId, body);
    return res.json({
      ok: true,
      providerId,
      permissions
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error: error && error.exposeToClient
        ? error.message
        : `No se pudieron guardar permisos: ${truncateForNotify(error && error.message ? error.message : 'permissions_update_failed', 220)}`
    });
  }
});

app.post('/api/ai/providers/:providerId/permissions/grant-full', requireAuth, (req, res) => {
  const providerId = normalizeSupportedAiAgentId(req.params && req.params.providerId);
  if (!providerId) {
    return res.status(404).json({ error: 'Provider no soportado' });
  }
  try {
    const permissions = upsertAiAgentPermissionProfileForUser(
      req.session.userId,
      providerId,
      buildAiPermissionFullAccessPatch()
    );
    return res.json({
      ok: true,
      providerId,
      permissions
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudieron conceder permisos completos: ${truncateForNotify(
              error && error.message ? error.message : 'permissions_grant_full_failed',
              220
            )}`
    });
  }
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

app.get('/api/projects', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const rows = listChatProjectsForUserStmt.all(safeUserId);
  const unassignedRow = countUnassignedConversationsForUserStmt.get(safeUserId);
  return res.json({
    ok: true,
    projects: rows
      .map((row) => serializeChatProjectRow(row, { includeContext: true }))
      .filter(Boolean),
    unassignedCount: Math.max(0, Number(unassignedRow && unassignedRow.total) || 0)
  });
});

app.post('/api/projects', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const name = sanitizeProjectName(req.body && req.body.name);
  if (!name) {
    return res.status(400).json({ error: 'Nombre de proyecto inválido' });
  }
  const contextMode = normalizeProjectContextMode(req.body && req.body.contextMode, 'mixed');
  const autoContextEnabled = normalizeProjectAutoEnabled(
    req.body && req.body.autoContextEnabled,
    contextMode !== 'manual'
  );
  const manualContext = normalizeProjectContextText(
    req.body && req.body.manualContext,
    projectContextManualMaxChars
  );
  const autoContext = normalizeProjectContextText(req.body && req.body.autoContext, projectContextAutoMaxChars);
  const createdAt = nowIso();
  const insertResult = createChatProjectStmt.run(
    safeUserId,
    name,
    contextMode,
    autoContextEnabled ? 1 : 0,
    manualContext,
    autoContext,
    createdAt,
    createdAt
  );
  const projectId = Number(insertResult && insertResult.lastInsertRowid);
  const project = getOwnedProjectOrNull(projectId, safeUserId);
  return res.json({
    ok: true,
    project: serializeChatProjectRow(project, { includeContext: true })
  });
});

app.patch('/api/projects/:id', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'project_id inválido' });
  }
  const project = getOwnedProjectOrNull(projectId, safeUserId);
  if (!project) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  const nameProvided = req.body && Object.prototype.hasOwnProperty.call(req.body, 'name');
  const modeProvided = req.body && Object.prototype.hasOwnProperty.call(req.body, 'contextMode');
  const autoEnabledProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'autoContextEnabled');
  const manualContextProvided =
    req.body && Object.prototype.hasOwnProperty.call(req.body, 'manualContext');

  const nextName = nameProvided ? sanitizeProjectName(req.body && req.body.name) : sanitizeProjectName(project.name);
  if (!nextName) {
    return res.status(400).json({ error: 'Nombre de proyecto inválido' });
  }
  const nextMode = modeProvided
    ? normalizeProjectContextMode(req.body && req.body.contextMode, project.context_mode)
    : normalizeProjectContextMode(project.context_mode, 'mixed');
  const nextAutoEnabled = autoEnabledProvided
    ? normalizeProjectAutoEnabled(req.body && req.body.autoContextEnabled, project.auto_context_enabled !== 0)
    : normalizeProjectAutoEnabled(project.auto_context_enabled, true);
  const nextManualContext = manualContextProvided
    ? normalizeProjectContextText(req.body && req.body.manualContext, projectContextManualMaxChars)
    : normalizeProjectContextText(project.manual_context, projectContextManualMaxChars);
  updateChatProjectMetaStmt.run(
    nextName,
    nextMode,
    nextAutoEnabled ? 1 : 0,
    nextManualContext,
    nowIso(),
    projectId,
    safeUserId
  );
  const refreshed = getOwnedProjectOrNull(projectId, safeUserId);
  return res.json({
    ok: true,
    project: serializeChatProjectRow(refreshed, { includeContext: true })
  });
});

app.post('/api/projects/:id/regenerate-context', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'project_id inválido' });
  }
  const project = getOwnedProjectOrNull(projectId, safeUserId);
  if (!project) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }
  const job = enqueueProjectContextRefreshJob(safeUserId, projectId, {
    immediate: true,
    force: true,
    trigger: 'manual'
  });
  const refreshed = getOwnedProjectOrNull(projectId, safeUserId);
  return res.json({
    ok: true,
    project: serializeChatProjectRow(refreshed, { includeContext: true }),
    job
  });
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'project_id inválido' });
  }
  const project = getOwnedProjectOrNull(projectId, safeUserId);
  if (!project) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }
  clearQueuedProjectContextRefreshTimer(safeUserId, projectId);
  const detached = clearProjectIdFromConversationsStmt.run(safeUserId, projectId);
  deleteChatProjectForUserStmt.run(projectId, safeUserId);
  return res.json({
    ok: true,
    deleted: {
      projectId,
      detachedChats: Number(detached && detached.changes) || 0
    }
  });
});

app.patch('/api/conversations/:id/project', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'conversation_id inválido' });
  }
  const conversation = getOwnedConversationOrNull(conversationId, safeUserId);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversación no encontrada' });
  }
  const requestedProjectId = parseProjectIdInput(req.body && req.body.projectId);
  let project = null;
  if (requestedProjectId !== null) {
    project = getOwnedProjectOrNull(requestedProjectId, safeUserId);
    if (!project) {
      return res.status(404).json({ error: 'Proyecto no encontrado para mover el chat.' });
    }
  }
  assignConversationProjectStmt.run(requestedProjectId, conversationId, safeUserId);
  if (project && normalizeProjectAutoEnabled(project.auto_context_enabled, true)) {
    enqueueProjectContextRefreshJob(safeUserId, Number(project.id), {
      immediate: false,
      force: false,
      trigger: 'conversation_moved'
    });
  }
  const updatedConversation = getOwnedConversationOrNull(conversationId, safeUserId);
  return res.json({
    ok: true,
    conversation: {
      id: Number(updatedConversation.id),
      projectId:
        Number.isInteger(Number(updatedConversation.project_id)) && Number(updatedConversation.project_id) > 0
          ? Number(updatedConversation.project_id)
          : null,
      project: serializeConversationProjectRef(updatedConversation)
    }
  });
});

app.get('/api/conversations', requireAuth, (req, res) => {
  const scope = String(req.query.scope || '').trim().toLowerCase();
  if (scope && scope !== 'all' && scope !== 'unassigned' && scope !== 'project') {
    return res.status(400).json({ error: 'scope inválido. Usa all, unassigned o project.' });
  }

  const hasProjectQuery = Object.prototype.hasOwnProperty.call(req.query || {}, 'projectId');
  const rawProjectId = hasProjectQuery ? String(req.query.projectId || '').trim() : '';
  let requestedProjectId = null;
  if (hasProjectQuery && rawProjectId) {
    requestedProjectId = parseProjectIdInput(rawProjectId);
    if (!requestedProjectId) {
      return res.status(400).json({ error: 'projectId inválido.' });
    }
  }

  if (scope === 'project' && !requestedProjectId) {
    return res.status(400).json({ error: 'scope=project requiere projectId válido.' });
  }
  if (requestedProjectId !== null) {
    const project = getOwnedProjectOrNull(requestedProjectId, req.session.userId);
    if (!project) {
      return res.status(404).json({ error: 'Proyecto no encontrado.' });
    }
  }

  let conversations = listConversationsStmt.all(req.session.userId);
  if (scope === 'unassigned') {
    conversations = conversations.filter((conversation) => {
      const conversationProjectId = Number(conversation.project_id);
      return !Number.isInteger(conversationProjectId) || conversationProjectId <= 0;
    });
  } else if (requestedProjectId !== null) {
    conversations = conversations.filter((conversation) => Number(conversation.project_id) === requestedProjectId);
  }
  return res.json({
    ok: true,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      projectId: Number.isInteger(Number(conversation.project_id)) ? Number(conversation.project_id) : null,
      project: serializeConversationProjectRef(conversation),
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
  const requestedProjectId = parseProjectIdInput(req.body && req.body.projectId);
  let projectRow = null;
  if (requestedProjectId !== null) {
    projectRow = getOwnedProjectOrNull(requestedProjectId, req.session.userId);
    if (!projectRow) {
      return res.status(404).json({ error: 'Proyecto no encontrado para crear el chat.' });
    }
  }
  const selectedReasoningEffort = sanitizeReasoningEffort(
    req.body && req.body.reasoningEffort,
    DEFAULT_REASONING_EFFORT
  );
  const result = createConversationStmt.run(
    req.session.userId,
    requestedProjectId,
    title,
    selectedModel,
    selectedReasoningEffort
  );
  return res.json({
    ok: true,
    conversation: {
      id: result.lastInsertRowid,
      projectId: requestedProjectId,
      project: projectRow ? serializeChatProjectRow(projectRow, { includePreview: true }) : null,
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
  const projectRow =
    Number.isInteger(Number(conversation.project_id)) && Number(conversation.project_id) > 0
      ? getOwnedProjectOrNull(Number(conversation.project_id), req.session.userId)
      : null;
  const effectiveProjectContext = buildEffectiveProjectContext(projectRow);
  const projectAutoMeta = projectRow ? safeParseJsonObject(projectRow.auto_context_meta_json) : {};
  return res.json({
    ok: true,
    conversation: {
      id: conversation.id,
      projectId: projectRow ? Number(projectRow.id) : null,
      project: projectRow ? serializeChatProjectRow(projectRow, { includePreview: true }) : null,
      title: conversation.title,
      model: conversation.model || '',
      reasoningEffort: sanitizeReasoningEffort(conversation.reasoning_effort, DEFAULT_REASONING_EFFORT)
    },
    projectContext: projectRow
      ? {
          projectId: Number(projectRow.id),
          projectName: sanitizeProjectName(projectRow.name),
          mode: normalizeProjectContextMode(projectRow.context_mode, 'mixed'),
          autoEnabled: normalizeProjectAutoEnabled(projectRow.auto_context_enabled, true),
          manualContext: normalizeProjectContextText(projectRow.manual_context, projectContextManualMaxChars),
          autoContext: normalizeProjectContextText(projectRow.auto_context, projectContextAutoMaxChars),
          effectiveContext: effectiveProjectContext.text,
          manualUsed: effectiveProjectContext.manualUsed,
          autoUsed: effectiveProjectContext.autoUsed,
          autoUpdatedAt: String(projectRow.auto_updated_at || ''),
          autoMeta: projectAutoMeta
        }
      : null,
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

app.get('/api/chat/options', requireAuth, async (req, res) => {
  const runtime = resolveChatAgentRuntimeForUser(req.session.userId);
  let models = Array.isArray(runtime.models) ? runtime.models.slice() : [];
  let quota = runtime.quota;
  try {
    const remoteModels = await listAiProviderModelsForUser(req.session.userId, runtime.activeAgentId, {
      allowRemoteFetch: true
    });
    if (remoteModels.length > 0) {
      models = remoteModels;
    }
  } catch (_error) {
    // fallback to cached/static model list
  }
  try {
    quota = await refreshAiProviderQuotaForUser(req.session.userId, runtime.activeAgentId);
  } catch (_error) {
    quota = runtime.quota;
  }
  const normalizedDefaultModel = models.includes(runtime.defaults.model)
    ? runtime.defaults.model
    : models[0] || runtime.defaults.model;
  return res.json({
    ok: true,
    providerId: runtime.providerId,
    activeAgentId: runtime.activeAgentId,
    activeAgentName: runtime.activeAgentName,
    runtimeProvider: runtime.runtimeProvider,
    models,
    capabilities: runtime.capabilities,
    quota,
    permissions: runtime.permissionProfile,
    reasoningEfforts: runtime.reasoningEfforts,
    defaults: {
      ...runtime.defaults,
      model: normalizedDefaultModel
    }
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
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const forceRefresh = String(req.query.refresh || '').trim() === '1';
  const snapshot = collectDeployedAppsSnapshot(forceRefresh);
  const apps = enrichDeployedAppsForUser(safeUserId, snapshot.apps);
  return res.json({
    ok: true,
    scannedAt: snapshot.scannedAt,
    apps
  });
});

app.post('/api/tools/deployed-apps/describe', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
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
  const activeAgentId = getUserActiveAiAgentId(req.session.userId) || '';
  const provider = 'codex-cli';
  const createdAt = nowIso();
  const jobId = buildDeployedDescriptionJobId();
  insertDeployedAppDescriptionJobStmt.run(
    jobId,
    safeUserId,
    JSON.stringify(requestedIds),
    'pending',
    provider,
    activeAgentId,
    createdAt,
    createdAt
  );
  scheduleDeployedDescriptionJob(jobId);
  const jobRow = getDeployedAppDescriptionJobForUserStmt.get(jobId, safeUserId);
  const serialized = serializeDeployedDescriptionJobRow(jobRow) || {
    id: jobId,
    status: 'pending',
    provider,
    activeAgentId,
    appIds: requestedIds,
    error: '',
    createdAt,
    updatedAt: createdAt,
    startedAt: '',
    finishedAt: '',
    result: {
      scannedAt: snapshot.scannedAt,
      generatedAt: '',
      missingAppIds: [],
      descriptions: []
    }
  };
  return res.json({
    ok: true,
    scannedAt: snapshot.scannedAt,
    job: serialized
  });
});

app.get('/api/tools/deployed-apps/describe/:jobId', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const jobId = String(req.params.jobId || '').trim();
  if (!jobId) {
    return res.status(400).json({ error: 'job_id inválido' });
  }
  const row = getDeployedAppDescriptionJobForUserStmt.get(jobId, safeUserId);
  if (!row) {
    return res.status(404).json({ error: 'Job no encontrado' });
  }
  return res.json({
    ok: true,
    job: serializeDeployedDescriptionJobRow(row)
  });
});

app.post('/api/tools/deployed-apps/:appId/action', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'deployments', {
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
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
  const enrichedApps = enrichDeployedAppsForUser(safeUserId, refreshedSnapshot.apps);
  const refreshedApp = enrichedApps.find((entry) => entry.id === appSummary.id) || appSummary;
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
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
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

  const enrichedApp =
    enrichDeployedAppsForUser(safeUserId, [appSummary])[0] ||
    appSummary;
  return res.json({
    ok: true,
    app: enrichedApp,
    lines: logsPayload.lines,
    logs: logsPayload.logs,
    fetchedAt: nowIso()
  });
});

app.get('/api/tools/wireguard/status', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: false,
    requiresShell: true
  });
  if (!permission) return;
  try {
    const status = buildWireGuardStatusSnapshot(safeUserId, {
      interfaceName: req.query.interfaceName
    });
    return res.json({
      ok: true,
      wireguard: status
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo leer estado de WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_status_failed',
              220
            )}`
    });
  }
});

app.post('/api/tools/wireguard/service', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: true,
    requiresShell: true,
    writeIntent: true
  });
  if (!permission) return;
  const action = String(req.body && req.body.action ? req.body.action : '')
    .trim()
    .toLowerCase();
  if (!['start', 'stop', 'restart', 'reload'].includes(action)) {
    return res.status(400).json({ error: 'Acción inválida. Usa start, stop, restart o reload.' });
  }
  const confirmText = String(req.body && req.body.confirm ? req.body.confirm : '')
    .trim()
    .toUpperCase();
  if (action === 'stop' && confirmText !== 'STOP') {
    return res.status(400).json({ error: 'Confirmación requerida para stop. Envía confirm=STOP.' });
  }
  if ((action === 'restart' || action === 'reload') && confirmText !== 'RESTART') {
    return res.status(400).json({ error: 'Confirmación requerida para restart/reload. Envía confirm=RESTART.' });
  }
  try {
    const runtime = resolveWireGuardRuntime(req.body && req.body.interfaceName);
    const currentService = getWireGuardServiceState(runtime);
    const effectiveAction =
      action === 'reload'
        ? currentService.isActive
          ? 'restart'
          : 'start'
        : action;
    const result = runSystemCommandSync('systemctl', [effectiveAction, runtime.serviceUnit, '--no-pager'], {
      allowNonZero: true,
      timeoutMs: 20000,
      maxBuffer: 1024 * 1024 * 2
    });
    if (!result.ok || Number(result.code) !== 0) {
      const status = buildWireGuardStatusSnapshot(safeUserId, { interfaceName: runtime.interfaceName });
      return res.status(500).json({
        error: `No se pudo ejecutar ${action} en ${runtime.serviceUnit}: ${truncateForNotify(
          result.stderr || result.stdout || 'wireguard_service_action_failed',
          220
        )}`,
        wireguard: status
      });
    }
    const status = buildWireGuardStatusSnapshot(safeUserId, { interfaceName: runtime.interfaceName });
    return res.json({
      ok: true,
      action,
      effectiveAction,
      output: truncateRawText(
        stripAnsi([result.stdout, result.stderr].filter(Boolean).join('\n')).trim(),
        8000
      ),
      wireguard: status
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo controlar WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_service_control_failed',
              220
            )}`
    });
  }
});

app.get('/api/tools/wireguard/config', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: false,
    requiresShell: true
  });
  if (!permission) return;
  try {
    const status = buildWireGuardStatusSnapshot(safeUserId, {
      interfaceName: req.query.interfaceName
    });
    return res.json({
      ok: true,
      config: {
        runtime: status.runtime,
        service: status.service,
        interface: status.interface,
        profileDefaults: status.profileDefaults,
        editable: {
          profileDefaultsOnly: true
        }
      }
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo leer configuración de WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_config_fetch_failed',
              220
            )}`
    });
  }
});

app.patch('/api/tools/wireguard/config', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: true,
    requiresShell: true,
    writeIntent: true
  });
  if (!permission) return;
  try {
    const settings = upsertWireGuardSettingsForUser(safeUserId, req.body || {});
    const status = buildWireGuardStatusSnapshot(safeUserId, {
      interfaceName: req.body && req.body.interfaceName
    });
    return res.json({
      ok: true,
      settings,
      wireguard: status
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo actualizar configuración WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_config_update_failed',
              220
            )}`
    });
  }
});

app.get('/api/tools/wireguard/diagnostics', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: false,
    requiresShell: true
  });
  if (!permission) return;
  try {
    const diagnostics = buildWireGuardDiagnostics(safeUserId, {
      interfaceName: req.query.interfaceName,
      lines: req.query.lines
    });
    return res.json({
      ok: true,
      diagnostics
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo generar diagnóstico WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_diagnostics_failed',
              220
            )}`
    });
  }
});

app.post('/api/tools/wireguard/peers', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: true,
    requiresShell: true,
    writeIntent: true
  });
  if (!permission) return;
  try {
    const created = createWireGuardPeerProfile(safeUserId, req.body || {}, {
      interfaceName: req.body && req.body.interfaceName
    });
    const status = buildWireGuardStatusSnapshot(safeUserId, {
      interfaceName: req.body && req.body.interfaceName
    });
    const createdPeer =
      status.peers.find((entry) => entry.id === created.id) || {
        id: created.id,
        name: created.name,
        publicKey: created.publicKey,
        clientIp: created.clientIp,
        allowedIps: created.allowedIps,
        endpoint: created.endpoint,
        latestHandshakeAt: '',
        secondsSinceHandshake: null,
        active: false,
        transferRxBytes: 0,
        transferTxBytes: 0,
        persistentKeepalive: created.keepaliveSeconds,
        createdAt: created.createdAt,
        notes: '',
        hasProfile: true
      };
    return res.json({
      ok: true,
      peer: createdPeer,
      profile: {
        peerId: created.id,
        downloadPath: `/api/tools/wireguard/peers/${encodeURIComponent(created.id)}/profile/download`,
        qrPath: `/api/tools/wireguard/peers/${encodeURIComponent(created.id)}/profile/qr`
      },
      wireguard: status
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo crear peer WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_create_peer_failed',
              220
            )}`
    });
  }
});

app.delete('/api/tools/wireguard/peers/:peerId', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: true,
    requiresShell: true,
    writeIntent: true
  });
  if (!permission) return;
  const confirmDelete = String(req.query.confirm || req.body && req.body.confirm || '').trim().toUpperCase();
  if (confirmDelete !== 'DELETE') {
    return res.status(400).json({ error: 'Confirmación requerida. Envía confirm=DELETE.' });
  }
  try {
    const runtime = resolveWireGuardRuntime(req.body && req.body.interfaceName);
    const result = deleteWireGuardPeer(runtime, {
      peerId: req.params.peerId,
      publicKey: req.body && req.body.publicKey
    });
    const revokedAt = nowIso();
    if (result.peerId) {
      revokeWireGuardPeerProfileByIdStmt.run(revokedAt, revokedAt, result.peerId);
    }
    if (result.publicKey) {
      revokeWireGuardPeerProfileByPublicKeyStmt.run(revokedAt, revokedAt, runtime.interfaceName, result.publicKey);
    }
    const status = buildWireGuardStatusSnapshot(safeUserId, {
      interfaceName: runtime.interfaceName
    });
    return res.json({
      ok: true,
      deleted: true,
      peerId: result.peerId,
      publicKey: result.publicKey,
      wireguard: status
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo eliminar/revocar peer WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_delete_peer_failed',
              220
            )}`
    });
  }
});

app.get('/api/tools/wireguard/peers/:peerId/profile', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: false,
    requiresShell: true
  });
  if (!permission) return;
  try {
    const profile = getWireGuardPeerProfileConfigById(req.params.peerId);
    const ownerId = getSafeUserId(profile.row && profile.row.user_id);
    if (ownerId && ownerId !== safeUserId && !isAdmin(req)) {
      return res.status(403).json({ error: 'No autorizado para ver este perfil WireGuard.' });
    }
    return res.json({
      ok: true,
      peerId: String(profile.row.id || ''),
      interfaceName: normalizeWireGuardInterfaceName(profile.row.interface_name),
      name: normalizeWireGuardPeerName(profile.row.peer_name),
      publicKey: String(profile.row.public_key || '').trim(),
      fileName: profile.fileName,
      config: profile.configText
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo obtener perfil WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_profile_fetch_failed',
              220
            )}`
    });
  }
});

app.get('/api/tools/wireguard/peers/:peerId/profile/download', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: false,
    requiresShell: true
  });
  if (!permission) return;
  try {
    const profile = getWireGuardPeerProfileConfigById(req.params.peerId);
    const ownerId = getSafeUserId(profile.row && profile.row.user_id);
    if (ownerId && ownerId !== safeUserId && !isAdmin(req)) {
      return res.status(403).json({ error: 'No autorizado para descargar este perfil WireGuard.' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', buildAttachmentContentDisposition(profile.fileName, 'wireguard-peer'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(profile.configText);
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo descargar perfil WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_profile_download_failed',
              220
            )}`
    });
  }
});

app.get('/api/tools/wireguard/peers/:peerId/profile/qr', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'wireguard', {
    requiresSensitiveTool: false,
    requiresShell: true
  });
  if (!permission) return;
  if (!commandExistsSync('qrencode')) {
    return res.status(503).json({ error: 'qrencode no está disponible en este servidor.' });
  }
  try {
    const profile = getWireGuardPeerProfileConfigById(req.params.peerId);
    const ownerId = getSafeUserId(profile.row && profile.row.user_id);
    if (ownerId && ownerId !== safeUserId && !isAdmin(req)) {
      return res.status(403).json({ error: 'No autorizado para generar QR de este perfil WireGuard.' });
    }
    const pngBuffer = execFileSync('qrencode', ['-t', 'PNG', '-o', '-'], {
      input: profile.configText,
      encoding: null,
      timeout: 8000,
      maxBuffer: 1024 * 1024 * 8
    });
    return res.json({
      ok: true,
      peerId: String(profile.row.id || ''),
      fileName: profile.fileName,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${Buffer.from(pngBuffer).toString('base64')}`,
      generatedAt: nowIso()
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo generar QR WireGuard: ${truncateForNotify(
              error && error.message ? error.message : 'wireguard_qr_failed',
              220
            )}`
    });
  }
});

app.get('/api/tools/storage/local/list', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const requestedPath = normalizeAbsoluteStoragePath(req.query.path, repoRootDir);
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: false,
    targetPath: requestedPath
  });
  if (!permission) return;
  try {
    const payload = listStorageLocalDirectory({
      path: req.query.path,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder,
      limit: req.query.limit,
      includeDirSize: String(req.query.includeDirSize || '1') !== '0'
    });
    return res.json({
      ok: true,
      ...payload
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    const message =
      error && error.exposeToClient
        ? error.message
        : `No se pudo listar ruta local: ${truncateForNotify(error && error.message ? error.message : 'storage_local_list_failed', 220)}`;
    return res.status(statusCode).json({ error: message });
  }
});

app.get('/api/tools/storage/local/heavy', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const requestedPath = normalizeAbsoluteStoragePath(req.query.path, repoRootDir);
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: false,
    targetPath: requestedPath
  });
  if (!permission) return;
  try {
    const payload = scanStorageHeavyPaths({
      path: req.query.path,
      limit: req.query.limit,
      maxDepth: req.query.maxDepth
    });
    return res.json({
      ok: true,
      ...payload
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    const message =
      error && error.exposeToClient
        ? error.message
        : `No se pudo escanear uso de disco: ${truncateForNotify(error && error.message ? error.message : 'storage_heavy_scan_failed', 220)}`;
    return res.status(statusCode).json({ error: message });
  }
});

app.post('/api/tools/storage/local/move', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const sourcePaths = parseStoragePathList(req.body && req.body.paths, 80);
  const destinationDir = normalizeAbsoluteStoragePath(req.body && req.body.destinationDir);
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: true,
    writeIntent: true,
    targetPath: destinationDir
  });
  if (!permission) return;
  if (sourcePaths.length === 0 || !destinationDir) {
    return res.status(400).json({ error: 'Selecciona archivos/rutas y destino para mover.' });
  }
  try {
    assertStorageMutationPathAllowed(destinationDir);
    if (!fs.existsSync(destinationDir)) {
      fs.mkdirSync(destinationDir, { recursive: true });
    }
    const destinationStats = fs.statSync(destinationDir);
    if (!destinationStats.isDirectory()) {
      return res.status(400).json({ error: 'El destino debe ser un directorio.' });
    }
    const moved = [];
    const failed = [];
    sourcePaths.forEach((sourcePath) => {
      try {
        assertAiPermissionForAction(permission.profile, 'storage', {
          requiresSensitiveTool: true,
          writeIntent: true,
          targetPath: sourcePath
        });
        assertStorageMutationPathAllowed(sourcePath);
        const targetPath = path.join(destinationDir, path.basename(sourcePath));
        const result = runSystemCommandSync('mv', ['--', sourcePath, targetPath], {
          allowNonZero: true,
          timeoutMs: 60000
        });
        if (!result.ok) {
          throw new Error(result.stderr || result.stdout || 'move_failed');
        }
        moved.push({
          sourcePath,
          targetPath
        });
      } catch (error) {
        failed.push({
          sourcePath,
          error: truncateForNotify(error && error.message ? error.message : 'move_failed', 220)
        });
      }
    });
    return res.json({
      ok: true,
      destinationDir,
      moved,
      failed
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    const message =
      error && error.exposeToClient
        ? error.message
        : `No se pudieron mover rutas: ${truncateForNotify(error && error.message ? error.message : 'storage_move_failed', 220)}`;
    return res.status(statusCode).json({ error: message });
  }
});

app.post('/api/tools/storage/local/compress', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const sourcePaths = parseStoragePathList(req.body && req.body.paths, 80);
  if (sourcePaths.length === 0) {
    return res.status(400).json({ error: 'Selecciona al menos una ruta para comprimir.' });
  }
  const archiveName = sanitizeDriveFileName(
    req.body && req.body.archiveName ? req.body.archiveName : `cleanup_${Date.now()}`,
    `cleanup_${Date.now()}`
  );
  const destinationDir = normalizeAbsoluteStoragePath(
    req.body && req.body.destinationDir ? req.body.destinationDir : path.join(storageJobsRootDir, 'archives'),
    path.join(storageJobsRootDir, 'archives')
  );
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: true,
    writeIntent: true,
    targetPath: destinationDir
  });
  if (!permission) return;
  if (!destinationDir) {
    return res.status(400).json({ error: 'Destino de compresión inválido.' });
  }

  try {
    assertStorageMutationPathAllowed(destinationDir);
    fs.mkdirSync(destinationDir, { recursive: true });
    sourcePaths.forEach((sourcePath) => {
      assertAiPermissionForAction(permission.profile, 'storage', {
        requiresSensitiveTool: true,
        targetPath: sourcePath
      });
      if (!pathExistsSyncSafe(sourcePath)) {
        throw createClientRequestError(`Ruta no encontrada: ${sourcePath}`, 404);
      }
    });
    const estimatedInputBytes = sourcePaths.reduce((sum, sourcePath) => {
      const estimated = estimateStoragePathBytes(sourcePath);
      return sum + (Number.isFinite(Number(estimated)) ? Math.max(0, Number(estimated)) : 0);
    }, 0);
    const estimatedRequiredBytes =
      estimatedInputBytes > 0
        ? Math.ceil(estimatedInputBytes * 0.35) + storageUploadReserveBytes
        : 384 * 1024 * 1024;
    assertStorageCapacityOrThrow({
      path: destinationDir,
      requiredBytes: estimatedRequiredBytes,
      operationLabel: 'comprimir archivos locales'
    });
    const archivePath = path.join(destinationDir, `${archiveName}.tar.gz`);
    const tarArgs = ['-czf', archivePath];
    sourcePaths.forEach((item) => {
      tarArgs.push(item);
    });
    const result = runSystemCommandSync('tar', tarArgs, {
      allowNonZero: true,
      timeoutMs: 1000 * 60 * 10,
      maxBuffer: 1024 * 1024 * 8
    });
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || 'compress_failed');
    }
    const archiveStats = fs.statSync(archivePath);
    return res.json({
      ok: true,
      archive: {
        path: archivePath,
        name: path.basename(archivePath),
        sizeBytes: Number(archiveStats.size || 0),
        createdAt: nowIso()
      }
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    const message =
      error && error.exposeToClient
        ? error.message
        : `No se pudo comprimir selección: ${truncateForNotify(error && error.message ? error.message : 'storage_compress_failed', 220)}`;
    return res.status(statusCode).json({ error: message });
  }
});

app.post('/api/tools/storage/local/delete', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const sourcePaths = parseStoragePathList(req.body && req.body.paths, 160);
  const confirmation = String(req.body && req.body.confirmText ? req.body.confirmText : '').trim().toUpperCase();
  if (sourcePaths.length === 0) {
    return res.status(400).json({ error: 'Selecciona al menos una ruta para borrar.' });
  }
  if (confirmation !== 'ELIMINAR') {
    return res.status(400).json({ error: 'Confirmación inválida. Escribe ELIMINAR para continuar.' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: true,
    writeIntent: true,
    targetPath: sourcePaths[0]
  });
  if (!permission) return;
  try {
    sourcePaths.forEach((entryPath) => {
      assertAiPermissionForAction(permission.profile, 'storage', {
        requiresSensitiveTool: true,
        writeIntent: true,
        targetPath: entryPath
      });
      assertStorageMutationPathAllowed(entryPath);
    });
    const job = createStorageJob(safeUserId, 'local_delete_paths', {
      paths: sourcePaths,
      requestedAt: nowIso(),
      requestedBy: String((req.session && req.session.username) || '')
    });
    return res.json({
      ok: true,
      job
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo iniciar borrado local: ${truncateForNotify(error && error.message ? error.message : 'storage_local_delete_failed', 220)}`
    });
  }
});

app.post('/api/tools/storage/cleanup/analyze', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: false
  });
  if (!permission) return;
  try {
    const requestPayload = req.body && typeof req.body === 'object' ? req.body : {};
    const job = createStorageJob(safeUserId, 'cleanup_residual_analyze', requestPayload);
    return res.json({
      ok: true,
      job
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo analizar residuos: ${truncateForNotify(
              error && error.message ? error.message : 'storage_cleanup_analyze_failed',
              220
            )}`
    });
  }
});

app.post('/api/tools/storage/cleanup/delete', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
  const requestPayload = req.body && typeof req.body === 'object' ? req.body : {};
  const sourcePaths = parseStoragePathList(requestPayload.paths, storageResidualDeleteMaxItems);
  if (sourcePaths.length === 0) {
    return res.status(400).json({ error: 'Selecciona al menos un candidato para borrar.' });
  }
  const analysisJobId = String(requestPayload.analysisJobId || '').trim();
  if (!analysisJobId) {
    return res.status(400).json({
      error: 'Primero analiza y revisa la lista. Falta analysisJobId para confirmar borrado.'
    });
  }
  const confirmDelete = String(req.body && req.body.confirm ? req.body.confirm : '')
    .trim()
    .toUpperCase() === 'DELETE';
  if (!confirmDelete) {
    return res.status(400).json({ error: 'Confirmación requerida. Envía confirm=DELETE.' });
  }
  try {
    sourcePaths.forEach((entryPath) => {
      assertAiPermissionForAction(permission.profile, 'storage', {
        requiresSensitiveTool: true,
        writeIntent: true,
        targetPath: entryPath
      });
    });
    const analysis = resolveResidualAnalysisForDelete(safeUserId, analysisJobId);
    if (analysis.candidateCount <= 0) {
      return res.status(409).json({
        error: 'El análisis seleccionado no contiene candidatos. Ejecuta un nuevo análisis.'
      });
    }
    const invalidPaths = sourcePaths.filter((entryPath) => !analysis.candidatePaths.has(entryPath));
    if (invalidPaths.length > 0) {
      return res.status(400).json({
        error: `Hay rutas fuera del análisis revisado: ${invalidPaths.slice(0, 3).join(', ')}`
      });
    }
    const result = deleteStorageResidualPaths({ paths: sourcePaths });
    return res.json({
      ok: true,
      analysisJobId: analysis.analysisJobId,
      analysisScannedAt: analysis.scannedAt,
      ...result
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo borrar residuales: ${truncateForNotify(
              error && error.message ? error.message : 'storage_cleanup_delete_failed',
              220
            )}`
    });
  }
});

app.get('/api/tools/storage/overview', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const accountId = String(req.query.accountId || '').trim();
  const localPath = normalizeAbsoluteStoragePath(req.query.path, repoRootDir);
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: false,
    targetPath: localPath
  });
  if (!permission) return;
  const localDiskHealth = buildStorageHealthSnapshotForPath(localPath || repoRootDir);
  const localDisk = {
    path: String(localDiskHealth.path || localPath || ''),
    totalBytes: localDiskHealth.totalBytes,
    usedBytes: localDiskHealth.usedBytes,
    availableBytes: localDiskHealth.availableBytes,
    usagePercent:
      Number.isFinite(Number(localDiskHealth.usedPercent)) && Number(localDiskHealth.usedPercent) >= 0
        ? `${Number(localDiskHealth.usedPercent)}%`
        : '',
    status: localDiskHealth.status,
    thresholds: localDiskHealth.thresholds
  };

  let cloud = {
    accountId: accountId || '',
    available: false,
    quota: {
      limit: null,
      usage: null,
      usageInDrive: null
    }
  };
  if (accountId) {
    try {
      const validation = await validateDriveAccountByIdForUser(safeUserId, accountId);
      cloud = {
        accountId,
        available: true,
        quota: validation.about.quota
      };
    } catch (error) {
      cloud = {
        accountId,
        available: false,
        error: truncateForNotify(error && error.message ? error.message : 'drive_quota_unavailable', 220),
        quota: {
          limit: null,
          usage: null,
          usageInDrive: null
        }
      };
    }
  }
  const recentJobs = listRecentToolsBackgroundJobsForUserStmt
    .all(safeUserId, 20)
    .map((row) => serializeToolsBackgroundJobRow(row))
    .filter(Boolean);
  return res.json({
    ok: true,
    localDisk,
    cloud,
    jobs: recentJobs
  });
});

app.get('/api/tools/storage/jobs', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: false
  });
  if (!permission) return;
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 120) : 40;
  const rows = listRecentToolsBackgroundJobsForUserStmt.all(safeUserId, limit);
  return res.json({
    ok: true,
    jobs: rows.map((row) => serializeToolsBackgroundJobRow(row)).filter(Boolean)
  });
});

app.get('/api/tools/storage/jobs/:jobId', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'storage', {
    requiresSensitiveTool: false
  });
  if (!permission) return;
  const jobId = String(req.params.jobId || '').trim();
  if (!jobId) {
    return res.status(400).json({ error: 'job_id inválido' });
  }
  const row = getToolsBackgroundJobForUserStmt.get(jobId, safeUserId);
  if (!row) {
    return res.status(404).json({ error: 'Job no encontrado.' });
  }
  return res.json({
    ok: true,
    job: serializeToolsBackgroundJobRow(row)
  });
});

app.get('/api/tools/storage/:cloudProvider(drive)/rclone/status', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: false
  });
  if (!permission) return;
  try {
    const status = getRcloneStatusPayload(String(req.query.configPath || '').trim());
    return res.json({
      ok: true,
      rclone: status
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo leer estado de rclone: ${truncateForNotify(error && error.message ? error.message : 'rclone_status_failed', 220)}`
    });
  }
});

app.post('/api/tools/storage/:cloudProvider(drive)/rclone/remotes', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
  try {
    const remote = createOrUpdateRcloneDriveRemote(safeUserId, req.body && typeof req.body === 'object' ? req.body : {});
    return res.json({
      ok: true,
      remote
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo guardar remote rclone: ${truncateForNotify(error && error.message ? error.message : 'rclone_remote_create_failed', 220)}`
    });
  }
});

app.post('/api/tools/storage/:cloudProvider(drive)/rclone/remotes/:remoteName/validate', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: false
  });
  if (!permission) return;
  const remoteName = normalizeDriveRemoteName(req.params.remoteName);
  if (!remoteName) {
    return res.status(400).json({ error: 'remoteName inválido' });
  }
  try {
    const validation = validateRcloneRemote(remoteName, String(req.query.configPath || '').trim());
    return res.json({
      ok: true,
      validation
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo validar remote rclone: ${truncateForNotify(error && error.message ? error.message : 'rclone_remote_validate_failed', 220)}`
    });
  }
});

app.delete('/api/tools/storage/:cloudProvider(drive)/rclone/remotes/:remoteName', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
  const remoteName = normalizeDriveRemoteName(req.params.remoteName);
  if (!remoteName) {
    return res.status(400).json({ error: 'remoteName inválido' });
  }
  const safeUserRows = listDriveAccountsForUserStmt
    .all(safeUserId)
    .map((row) => serializeDriveAccountRow(row))
    .filter(Boolean);
  const inUse = safeUserRows.find((entry) => String(entry.details && entry.details.remoteName ? entry.details.remoteName : '') === remoteName);
  if (inUse) {
    return res.status(409).json({
      error: `El remote "${remoteName}" está en uso por la cuenta "${inUse.alias}". Elíminala o cámbiala primero.`
    });
  }
  try {
    const result = deleteRcloneRemote(remoteName, String(req.query.configPath || '').trim());
    return res.json({
      ok: true,
      deleted: true,
      remoteName: result.remoteName,
      rclone: {
        binary: result.binary,
        configPath: result.configPath,
        configExists: result.configExists,
        remotes: result.remotes,
        defaultRemote: result.defaultRemote,
        defaultRootPath: result.defaultRootPath
      }
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo eliminar remote rclone: ${truncateForNotify(error && error.message ? error.message : 'rclone_remote_delete_failed', 220)}`
    });
  }
});

app.get('/api/tools/storage/:cloudProvider(drive)/accounts', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: false
  });
  if (!permission) return;
  const rows = listDriveAccountsForUserStmt
    .all(safeUserId)
    .filter((row) => normalizeDriveAuthMode(row && row.auth_mode) === 'rclone');
  return res.json({
    ok: true,
    accounts: rows.map((row) => serializeDriveAccountRow(row)).filter(Boolean)
  });
});

app.post('/api/tools/storage/:cloudProvider(drive)/accounts', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
  const alias = sanitizeDriveAccountAlias(req.body && req.body.alias);
  try {
    const normalizedCredential = normalizeDriveCreateAccountPayload(req.body);
    const rootFolderId = normalizeDriveRemotePath(normalizedCredential.normalized.root_path || driveDefaultRootPath);
    const accountId = buildDriveAccountId();
    const now = nowIso();
    insertDriveAccountStmt.run(
      accountId,
      safeUserId,
      alias || `Drive ${accountId.slice(-6)}`,
      'rclone',
      encryptSecretText(JSON.stringify(normalizedCredential.normalized)),
      '',
      rootFolderId,
      'pending',
      JSON.stringify(normalizedCredential.details),
      now,
      now
    );
    try {
      await validateDriveAccountByIdForUser(safeUserId, accountId);
    } catch (error) {
      updateDriveAccountStatusStmt.run(
        'error',
        truncateForNotify(error && error.message ? error.message : 'drive_validation_failed', 220),
        nowIso(),
        accountId
      );
    }
    const row = getDriveAccountByIdForUserStmt.get(accountId, safeUserId);
    return res.json({
      ok: true,
      account: serializeDriveAccountRow(row)
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    const message =
      error && error.exposeToClient
        ? error.message
        : `No se pudo guardar cuenta de Google Drive (rclone): ${truncateForNotify(
            error && error.message ? error.message : 'drive_account_create_failed',
            220
          )}`;
    return res.status(statusCode).json({ error: message });
  }
});

app.post('/api/tools/storage/:cloudProvider(drive)/accounts/:accountId/validate', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: false
  });
  if (!permission) return;
  const accountId = String(req.params.accountId || '').trim();
  if (!accountId) {
    return res.status(400).json({ error: 'account_id inválido' });
  }
  try {
    const payload = await validateDriveAccountByIdForUser(safeUserId, accountId);
    return res.json({
      ok: true,
      ...payload
    });
  } catch (error) {
    updateDriveAccountStatusStmt.run(
      'error',
      truncateForNotify(error && error.message ? error.message : 'drive_validation_failed', 220),
      nowIso(),
      accountId
    );
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo validar cuenta de Google Drive (rclone): ${truncateForNotify(
              error && error.message ? error.message : 'drive_validation_failed',
              220
            )}`
    });
  }
});

app.delete('/api/tools/storage/:cloudProvider(drive)/accounts/:accountId', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
  const accountId = String(req.params.accountId || '').trim();
  if (!accountId) {
    return res.status(400).json({ error: 'account_id inválido' });
  }
  const row = getDriveAccountByIdForUserStmt.get(accountId, safeUserId);
  if (!row) {
    return res.status(404).json({ error: 'Cuenta de Google Drive no encontrada.' });
  }
  deleteDriveAccountForUserStmt.run(accountId, safeUserId);
  return res.json({
    ok: true,
    deleted: true,
    accountId
  });
});

app.get('/api/tools/storage/:cloudProvider(drive)/files', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: false
  });
  if (!permission) return;
  const accountId = String(req.query.accountId || '').trim();
  if (!accountId) {
    return res.status(400).json({ error: 'Selecciona una cuenta de Google Drive.' });
  }
  try {
    const payload = await listDriveFilesForAccount(safeUserId, accountId, {
      folderId: req.query.folderId,
      pageToken: req.query.pageToken,
      pageSize: req.query.pageSize,
      query: req.query.query
    });
    return res.json({
      ok: true,
      ...payload
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudieron listar archivos de Google Drive (rclone): ${truncateForNotify(
              error && error.message ? error.message : 'drive_files_list_failed',
              220
            )}`
    });
  }
});

app.get('/api/tools/storage/:cloudProvider(drive)/files/:fileId/download', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: false
  });
  if (!permission) return;
  const accountId = String(req.query.accountId || '').trim();
  const fileId = String(req.params.fileId || '').trim();
  if (!accountId || !fileId) {
    return res.status(400).json({ error: 'Indica accountId y fileId para descargar desde Google Drive.' });
  }
  let tmpFilePath = '';
  try {
    assertStorageCapacityOrThrow({
      path: storageJobsRootDir,
      requiredBytes: 256 * 1024 * 1024,
      operationLabel: 'descargar archivo desde Google Drive'
    });
    const context = await getDriveContextForUser(safeUserId, accountId);
    tmpFilePath = path.join(storageJobsRootDir, `${buildStorageJobId('drive_dl')}.bin`);
    const downloaded = await downloadDriveFileToPath(context, fileId, tmpFilePath);
    const resolvedName = sanitizeDriveFileName(
      downloaded &&
        downloaded.metadata &&
        downloaded.metadata.name
        ? downloaded.metadata.name
        : path.posix.basename(String(fileId || '').replace(/%2F/gi, '/')),
      'drive-file'
    );
    const stats = fs.statSync(tmpFilePath);
    const sizeHeader = Number.isFinite(Number(stats.size)) ? Number(stats.size) : null;
    const contentType = inferMimeTypeFromFilename(resolvedName) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', buildAttachmentContentDisposition(resolvedName, 'drive-file'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (Number.isFinite(Number(sizeHeader)) && Number(sizeHeader) >= 0) {
      res.setHeader('Content-Length', String(sizeHeader));
    }
    await pipelineAsync(fs.createReadStream(tmpFilePath, { highWaterMark: 1024 * 1024 }), res);
  } catch (error) {
    if (res.headersSent) {
      return res.end();
    }
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo descargar archivo de Google Drive (rclone): ${truncateForNotify(
              error && error.message ? error.message : 'drive_download_failed',
              220
            )}`,
      code: error && error.exposeToClient && error.code ? String(error.code) : undefined,
      storage: error && error.exposeToClient && error.storage ? error.storage : undefined
    });
  } finally {
    try {
      if (tmpFilePath && fs.existsSync(tmpFilePath)) {
        fs.unlinkSync(tmpFilePath);
      }
    } catch (_error) {
      // ignore tmp cleanup failures.
    }
  }
});

app.post('/api/tools/storage/:cloudProvider(drive)/upload', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
  const accountId = String(req.body && req.body.accountId ? req.body.accountId : '').trim();
  const paths = parseStoragePathList(req.body && req.body.paths, storageUploadJobMaxFiles);
  const parentId = String(req.body && req.body.parentId ? req.body.parentId : '').trim();
  if (!accountId || paths.length === 0) {
    return res.status(400).json({ error: 'Selecciona cuenta de Google Drive y archivos locales para subir.' });
  }
  try {
    await getDriveContextForUser(safeUserId, accountId);
    paths.forEach((sourcePath) => {
      assertAiPermissionForAction(permission.profile, 'drive', {
        requiresSensitiveTool: true,
        writeIntent: true,
        targetPath: sourcePath
      });
    });
    const job = createStorageJob(safeUserId, 'drive_upload_files', {
      accountId,
      paths,
      parentId
    });
    return res.json({
      ok: true,
      job
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo crear job de subida a Google Drive: ${truncateForNotify(
              error && error.message ? error.message : 'drive_upload_job_create_failed',
              220
            )}`
    });
  }
});

app.delete('/api/tools/storage/:cloudProvider(drive)/files/:fileId', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'drive', {
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
  const accountId = String(req.query.accountId || req.body && req.body.accountId || '').trim();
  const fileId = String(req.params.fileId || '').trim();
  const confirmDelete = String(req.query.confirm || req.body && req.body.confirm || '').trim().toUpperCase() === 'DELETE';
  if (!accountId || !fileId) {
    return res.status(400).json({ error: 'Indica accountId y fileId para borrar en Google Drive.' });
  }
  if (!confirmDelete) {
    return res.status(400).json({ error: 'Confirmación requerida. Envía confirm=DELETE.' });
  }
  try {
    const payload = await deleteDriveFileForAccount(safeUserId, accountId, fileId);
    return res.json({
      ok: true,
      ...payload
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo borrar archivo de Google Drive: ${truncateForNotify(
              error && error.message ? error.message : 'drive_delete_failed',
              220
            )}`
    });
  }
});

app.get('/api/tools/deployed-apps/:appId/backups', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'backups', {
    requiresSensitiveTool: false,
    requiresBackupRestore: true
  });
  if (!permission) return;
  const appId = String(req.params.appId || '').trim();
  const accountId = String(req.query.accountId || '').trim();
  if (!appId) {
    return res.status(400).json({ error: 'app_id inválido' });
  }
  try {
    const backups = await listAppBackupsFromDrive(safeUserId, appId, accountId);
    return res.json({
      ok: true,
      appId,
      accountId,
      retentionDays: storageBackupRetentionDays,
      backups
    });
  } catch (error) {
    const cached = listDeployedCloudBackupsForUserAndAppStmt
      .all(safeUserId, appId, 120)
      .map((row) => ({
        id: String(row.id || ''),
        appId: String(row.app_id || ''),
        accountId: String(row.account_id || ''),
        driveFileId: String(row.drive_file_id || ''),
        name: String(row.backup_name || ''),
        targetPath: String(row.target_path || ''),
        sizeBytes: Number.isFinite(Number(row.size_bytes)) ? Number(row.size_bytes) : null,
        createdAt: String(row.created_at || ''),
        source: 'cache'
      }));
    if (cached.length > 0) {
      return res.json({
        ok: true,
        appId,
        accountId,
        retentionDays: storageBackupRetentionDays,
        backups: cached,
        warning: 'Se devolvió caché local porque Google Drive (rclone) no respondió correctamente.'
      });
    }
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudieron listar backups en nube: ${truncateForNotify(error && error.message ? error.message : 'app_backups_list_failed', 220)}`
    });
  }
});

app.post('/api/tools/deployed-apps/:appId/backups', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'backups', {
    requiresSensitiveTool: true,
    requiresBackupRestore: true,
    writeIntent: true
  });
  if (!permission) return;
  const appId = String(req.params.appId || '').trim();
  const accountId = String(req.body && req.body.accountId ? req.body.accountId : '').trim();
  if (!appId || !accountId) {
    return res.status(400).json({ error: 'appId y accountId son obligatorios para backup.' });
  }
  const deployedApp = findDeployedAppById(appId, { forceRefresh: true });
  if (!deployedApp) {
    return res.status(404).json({ error: 'App desplegada no encontrada.' });
  }
  const requestedPath = normalizeAbsoluteStoragePath(req.body && req.body.sourcePath);
  const inferredPath = resolveBackupTargetFromApp(deployedApp);
  const sourcePath = requestedPath || inferredPath;
  if (!sourcePath || !pathExistsSyncSafe(sourcePath)) {
    return res.status(400).json({
      error:
        'No se pudo inferir ruta de backup de la app. Indica sourcePath manualmente desde la UI.'
    });
  }
  try {
    await getDriveContextForUser(safeUserId, accountId);
    assertAiPermissionForAction(permission.profile, 'backups', {
      requiresBackupRestore: true,
      requiresSensitiveTool: true,
      writeIntent: true,
      targetPath: sourcePath
    });
    const job = createStorageJob(safeUserId, 'deployed_backup_create', {
      appId,
      appName: String(deployedApp.name || appId),
      accountId,
      sourcePath,
      targetPath: normalizeAbsoluteStoragePath(req.body && req.body.targetPath) || sourcePath
    });
    return res.json({
      ok: true,
      appId,
      job
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo crear backup en nube: ${truncateForNotify(error && error.message ? error.message : 'app_backup_create_failed', 220)}`
    });
  }
});

app.post('/api/tools/deployed-apps/:appId/restore', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'backups', {
    requiresSensitiveTool: true,
    requiresBackupRestore: true,
    writeIntent: true
  });
  if (!permission) return;
  const appId = String(req.params.appId || '').trim();
  const accountId = String(req.body && req.body.accountId ? req.body.accountId : '').trim();
  const fileId = String(
    (req.body && (req.body.fileId || req.body.driveFileId || req.body.backupFileId)) || ''
  ).trim();
  const confirmRestore = String(req.body && req.body.confirm ? req.body.confirm : '')
    .trim()
    .toUpperCase() === 'RESTORE';
  if (!appId || !accountId || !fileId) {
    return res.status(400).json({ error: 'appId, accountId y fileId son obligatorios para restaurar.' });
  }
  if (!confirmRestore) {
    return res.status(400).json({ error: 'Confirmación requerida. Envía confirm=RESTORE.' });
  }
  const deployedApp = findDeployedAppById(appId, { forceRefresh: true });
  if (!deployedApp) {
    return res.status(404).json({ error: 'App desplegada no encontrada.' });
  }
  const targetPath =
    normalizeAbsoluteStoragePath(req.body && req.body.targetPath) ||
    resolveBackupTargetFromApp(deployedApp);
  if (!targetPath) {
    return res.status(400).json({ error: 'No se pudo inferir targetPath. Envíalo manualmente.' });
  }
  try {
    await getDriveContextForUser(safeUserId, accountId);
    assertAiPermissionForAction(permission.profile, 'backups', {
      requiresBackupRestore: true,
      requiresSensitiveTool: true,
      writeIntent: true,
      targetPath
    });
    assertStorageMutationPathAllowed(targetPath);
    const job = createStorageJob(safeUserId, 'deployed_backup_restore', {
      appId,
      appName: String(deployedApp.name || appId),
      accountId,
      fileId,
      targetPath
    });
    return res.json({
      ok: true,
      appId,
      job
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `No se pudo crear job de restauración: ${truncateForNotify(error && error.message ? error.message : 'app_restore_job_create_failed', 220)}`
    });
  }
});

app.get('/api/tools/git/repos', requireAuth, (req, res) => {
  const permission = guardRequestPermissionOrRespond(req, res, 'git', {
    requiresGit: true
  });
  if (!permission) return;
  const forceRefresh = String(req.query.refresh || '').trim() === '1';
  const snapshot = collectGitToolsReposSnapshot(forceRefresh);
  return res.json({
    ok: true,
    scannedAt: snapshot.scannedAt,
    scanRoots: gitToolsScanRoots,
    repos: snapshot.repos
  });
});

app.get('/api/tools/git/repos/:repoId/branches', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'git', {
    requiresGit: true
  });
  if (!permission) return;
  const repo = findGitRepoById(req.params.repoId, { forceRefresh: true });
  if (!repo) {
    return res.status(404).json({ error: 'Repositorio no encontrado' });
  }
  const branches = listGitBranchesForRepo(repo.absolutePath);
  const refreshed = collectGitRepoSummary(repo.absolutePath, nowIso(), repo.scanRoot);
  return res.json({
    ok: true,
    repo: refreshed || repo,
    branches
  });
});

app.post('/api/tools/git/repos/:repoId/branches/checkout', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'git', {
    requiresGit: true,
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
  const repo = findGitRepoById(req.params.repoId, { forceRefresh: true });
  if (!repo) {
    return res.status(404).json({ error: 'Repositorio no encontrado' });
  }
  const branch = normalizeGitBranchName(req.body && req.body.branch);
  const create = parseBooleanSetting(req.body && req.body.create, false);
  if (!branch) {
    return res.status(400).json({ error: 'Indica una rama válida para checkout.' });
  }
  const result = ensureGitBranchForRepo(repo.absolutePath, branch, { createIfMissing: create });
  if (!result.ok) {
    return res.status(400).json({ error: result.error || 'No se pudo cambiar de rama.' });
  }
  const refreshed = collectGitRepoSummary(repo.absolutePath, nowIso(), repo.scanRoot);
  return res.json({
    ok: true,
    branch: result.branch,
    created: Boolean(result.created),
    output: truncateForNotify(result.output || '', 1200),
    repo: refreshed || repo
  });
});

app.post('/api/tools/git/repos/:repoId/merge', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'git', {
    requiresGit: true,
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;
  const repo = findGitRepoById(req.params.repoId, { forceRefresh: true });
  if (!repo) {
    return res.status(404).json({ error: 'Repositorio no encontrado' });
  }
  const sourceBranch = normalizeGitBranchName(req.body && req.body.sourceBranch);
  const targetBranch = normalizeGitBranchName(req.body && req.body.targetBranch);
  if (!sourceBranch || !targetBranch) {
    return res.status(400).json({ error: 'Indica sourceBranch y targetBranch válidas.' });
  }
  if (sourceBranch === targetBranch) {
    return res.status(400).json({ error: 'sourceBranch y targetBranch deben ser diferentes.' });
  }
  if (!gitBranchRefExists(repo.absolutePath, sourceBranch)) {
    return res.status(404).json({ error: `La rama origen no existe: ${sourceBranch}` });
  }
  if (!gitBranchRefExists(repo.absolutePath, targetBranch)) {
    return res.status(404).json({ error: `La rama destino no existe: ${targetBranch}` });
  }
  if (repo.hasConflicts) {
    return res.status(409).json({
      error: 'El repositorio tiene conflictos pendientes. Resuélvelos antes de lanzar un merge.'
    });
  }
  const gitIdentity = buildGitIdentityFromRequest(req);
  const job = createStorageJob(safeUserId, 'git_merge_branches', {
    repoId: repo.id,
    repoPath: repo.absolutePath,
    sourceBranch,
    targetBranch,
    gitIdentity,
    requestedAt: nowIso(),
    requestedBy: String((req.session && req.session.username) || '')
  });
  return res.json({
    ok: true,
    repo,
    job,
    merge: {
      sourceBranch,
      targetBranch,
      status: 'queued'
    }
  });
});

app.post('/api/tools/git/repos/:repoId/push', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'git', {
    requiresGit: true,
    requiresSensitiveTool: true,
    writeIntent: true
  });
  if (!permission) return;

  const repo = findGitRepoById(req.params.repoId, { forceRefresh: true });
  if (!repo) {
    return res.status(404).json({ error: 'Repositorio no encontrado' });
  }
  if (repo.hasConflicts) {
    return res.status(409).json({ error: 'Este repositorio tiene conflictos. Resuelvelos antes de subir.' });
  }

  const commitMessage = normalizeGitCommitMessage(req.body && req.body.commitMessage, repo.name);
  const requestedBranch = normalizeGitBranchName(req.body && req.body.branch);
  const createBranch = parseBooleanSetting(req.body && req.body.createBranch, false);
  const requestedRemote = normalizeGitRemoteName(req.body && req.body.remote);
  const gitIdentity = buildGitIdentityFromRequest(req);
  const ensuredIdentity = ensureGitIdentityForRepo(repo.absolutePath, gitIdentity);
  if (!ensuredIdentity.ok) {
    return res.status(500).json({
      error: `No se pudo preparar identidad Git del repo: ${ensuredIdentity.error || 'git_identity_failed'}`
    });
  }
  const gitIdentityEnv = buildGitIdentityEnv(ensuredIdentity.identity);

  let branchSwitched = false;
  let branchCreated = false;
  let branchSwitchOutput = '';
  let repoState = collectGitRepoSummary(repo.absolutePath, nowIso());
  if (!repoState) {
    return res.status(500).json({ error: 'No se pudo leer estado actual del repositorio.' });
  }
  if (repoState.detached && !requestedBranch) {
    return res.status(409).json({
      error:
        'Repositorio en HEAD detached. Selecciona una rama destino o crea una rama nueva antes de hacer push.'
    });
  }
  if (requestedBranch && requestedBranch !== repoState.branch) {
    const branchResult = ensureGitBranchForRepo(repo.absolutePath, requestedBranch, {
      createIfMissing: createBranch
    });
    if (!branchResult.ok) {
      return res.status(400).json({
        error: `No se pudo cambiar/crear rama: ${branchResult.error || 'git_branch_checkout_failed'}`
      });
    }
    branchSwitched = true;
    branchCreated = Boolean(branchResult.created);
    branchSwitchOutput = String(branchResult.output || '');
    repoState = collectGitRepoSummary(repo.absolutePath, nowIso());
    if (!repoState) {
      return res.status(500).json({ error: 'No se pudo refrescar estado del repositorio tras checkout.' });
    }
  }
  if (!repoState.branch || repoState.branch === 'HEAD') {
    return res.status(409).json({
      error: 'No se puede hacer push desde HEAD detached. Selecciona una rama válida.'
    });
  }

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
  if (refreshedBeforePush.detached || !refreshedBeforePush.branch || refreshedBeforePush.branch === 'HEAD') {
    return res.status(409).json({ error: 'No se puede subir desde HEAD detached.' });
  }
  if (!refreshedBeforePush.hasRemote || refreshedBeforePush.remotes.length === 0) {
    return res.status(409).json({ error: 'Este repositorio no tiene remotos configurados.' });
  }

  if (!commitCreated && refreshedBeforePush.ahead <= 0) {
    return res.status(409).json({ error: 'No hay cambios para subir al remoto.' });
  }

  const pushArgs = ['push'];
  const defaultRemote = refreshedBeforePush.remotes.includes('origin')
    ? 'origin'
    : refreshedBeforePush.remotes[0];
  const upstreamRemote =
    refreshedBeforePush.upstream && refreshedBeforePush.upstream.includes('/')
      ? refreshedBeforePush.upstream.split('/')[0]
      : '';
  const remoteToUse = normalizeGitRemoteName(
    requestedRemote || upstreamRemote || defaultRemote
  );
  if (!remoteToUse) {
    return res.status(409).json({ error: 'No se encontró remoto para hacer push.' });
  }
  const needsSetUpstream =
    Boolean(requestedBranch) || Boolean(requestedRemote) || !refreshedBeforePush.upstream;
  if (needsSetUpstream) {
    pushArgs.push('-u', remoteToUse, refreshedBeforePush.branch);
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
    [branchSwitchOutput, commitOutput, pushResult.stdout, pushResult.stderr].filter(Boolean).join('\n').trim(),
    1800
  );

  return res.json({
    ok: true,
    repo: refreshedRepo,
    push: {
      commitCreated,
      commitMessage,
      commitHash,
      targetBranch: refreshedBeforePush.branch,
      remote: remoteToUse,
      branchSwitched,
      branchCreated,
      output
    }
  });
});

app.post('/api/tools/git/repos/:repoId/resolve-conflicts', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const permission = guardRequestPermissionOrRespond(req, res, 'git', {
    requiresGit: true,
    requiresSensitiveTool: true
  });
  if (!permission) return;

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
    null,
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

app.get('/api/storage/health', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const requestedPath =
    typeof req.query.path === 'string'
      ? normalizeAbsoluteStoragePath(req.query.path, uploadsDir) || uploadsDir
      : uploadsDir;
  const storage = buildStorageHealthSnapshotForPath(requestedPath);
  return res.json({
    ok: true,
    storage
  });
});

app.post('/api/uploads/preflight', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const rawFiles = req.body && Array.isArray(req.body.files) ? req.body.files : [];
  if (rawFiles.length === 0) {
    return res.status(400).json({ error: 'Selecciona al menos un archivo.' });
  }
  if (rawFiles.length > maxAttachments) {
    return res.status(413).json({ error: `Demasiados adjuntos (maximo ${maxAttachments}).` });
  }

  const conversationIdRaw = Number(req.body && req.body.conversationId);
  const conversationId =
    Number.isInteger(conversationIdRaw) && conversationIdRaw > 0 ? conversationIdRaw : null;
  if (conversationId !== null) {
    const ownedConversation = getOwnedConversationOrNull(conversationId, safeUserId);
    if (!ownedConversation) {
      return res.status(404).json({ error: 'Conversación no encontrada para estos adjuntos.' });
    }
  }

  let totalBytes = 0;
  const files = [];
  try {
    rawFiles.forEach((entry, index) => {
      const name = sanitizeFilename(entry && entry.name ? entry.name : `file_${index + 1}`);
      const size = Number(entry && entry.size);
      if (!Number.isFinite(size) || size <= 0) {
        throw createClientRequestError(`Adjunto invalido: ${name}`, 400);
      }
      if (size > maxAttachmentSizeBytes) {
        throw createClientRequestError(`Adjunto demasiado grande: ${name} (maximo ${maxAttachmentSizeMb}MB)`, 413);
      }
      totalBytes += Math.max(0, Math.round(size));
      files.push({
        name,
        size: Math.max(0, Math.round(size))
      });
    });
    const requiredBytes = estimateAttachmentUploadRequiredBytes(totalBytes, files.length || 1);
    const storage = assertStorageCapacityOrThrow({
      path: pendingUploadsDir,
      requiredBytes,
      operationLabel: 'subir adjuntos al chat'
    });
    return res.json({
      ok: true,
      accepted: true,
      files,
      estimate: {
        payloadBytes: totalBytes,
        requiredBytes
      },
      limits: {
        maxAttachments,
        maxAttachmentSizeBytes,
        maxAttachmentSizeMb
      },
      storage
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    if (error && error.exposeToClient) {
      return res.status(statusCode).json({
        error: error.message || 'No se pudo validar la subida.',
        code: String(error.code || '').trim() || undefined,
        storage: error && error.storage ? error.storage : undefined
      });
    }
    return res.status(statusCode).json({
      error: `No se pudo validar subida de adjuntos: ${truncateForNotify(
        error && error.message ? error.message : 'upload_preflight_failed',
        220
      )}`
    });
  }
});

app.post('/api/uploads/chunked/start', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const decodedName = String(req.body && req.body.fileName ? req.body.fileName : '');
  const name = sanitizeFilename(decodedName || 'file');
  const mimeType = String(req.body && req.body.fileType ? req.body.fileType : 'application/octet-stream').trim() || 'application/octet-stream';
  const totalSize = Number(req.body && req.body.totalSize);
  const conversationIdRaw = Number(req.body && req.body.conversationId);
  const conversationId =
    Number.isInteger(conversationIdRaw) && conversationIdRaw > 0 ? conversationIdRaw : null;
  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    return res.status(400).json({ error: `Adjunto invalido: ${name}` });
  }
  if (totalSize > maxAttachmentSizeBytes) {
    return res.status(413).json({ error: `Adjunto demasiado grande: ${name} (maximo ${maxAttachmentSizeMb}MB)` });
  }
  if (conversationId !== null) {
    const ownedConversation = getOwnedConversationOrNull(conversationId, safeUserId);
    if (!ownedConversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
  }
  cleanupPendingUploads();
  const uploadId = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const pendingDir = path.join(pendingUploadsDir, String(safeUserId));
  fs.mkdirSync(pendingDir, { recursive: true });
  const storedPath = path.join(pendingDir, `${uploadId}_${name}.part`);
  try {
    const requiredBytes = estimateAttachmentUploadRequiredBytes(totalSize, 1);
    const storage = assertStorageCapacityOrThrow({
      path: pendingDir,
      requiredBytes,
      operationLabel: `subir adjunto ${name}`
    });
    fs.writeFileSync(storedPath, '', { flag: 'wx' });
    pendingChunkUploads.set(uploadId, {
      uploadId,
      userId: safeUserId,
      conversationId,
      name,
      mimeType,
      totalSize: Math.round(totalSize),
      receivedBytes: 0,
      nextChunkIndex: 0,
      path: storedPath,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return res.json({
      ok: true,
      uploadId,
      chunkSizeBytes: uploadChunkSizeBytes,
      storage,
      attachment: {
        uploadId,
        name,
        mimeType,
        size: Math.round(totalSize)
      }
    });
  } catch (error) {
    try {
      if (fs.existsSync(storedPath)) {
        fs.unlinkSync(storedPath);
      }
    } catch (_cleanupError) {
      // best-effort cleanup
    }
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 500;
    if (error && error.exposeToClient) {
      return res.status(statusCode).json({
        error: error.message || 'No se pudo iniciar subida por chunks.',
        code: String(error.code || '').trim() || undefined,
        storage: error && error.storage ? error.storage : undefined
      });
    }
    return res.status(statusCode).json({
      error: `No se pudo iniciar subida por chunks: ${truncateForNotify(
        error && error.message ? error.message : 'chunk_start_failed',
        220
      )}`
    });
  }
});

app.put('/api/uploads/chunked/:uploadId/chunk', requireAuth, async (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const uploadId = String(req.params.uploadId || '').trim();
  if (!uploadId) {
    return res.status(400).json({ error: 'upload_id inválido' });
  }
  cleanupPendingUploads();
  const session = pendingChunkUploads.get(uploadId);
  if (!session || Number(session.userId) !== Number(safeUserId)) {
    return res.status(404).json({ error: 'Subida por chunks no encontrada o expirada.' });
  }
  const chunkIndexRaw = Number(req.query.index);
  const chunkIndex = Number.isInteger(chunkIndexRaw) && chunkIndexRaw >= 0 ? chunkIndexRaw : null;
  if (chunkIndex === null) {
    return res.status(400).json({ error: 'index de chunk inválido.' });
  }
  if (chunkIndex !== Number(session.nextChunkIndex)) {
    return res.status(409).json({
      error: `Orden de chunk inválido. Esperado ${session.nextChunkIndex}, recibido ${chunkIndex}.`
    });
  }
  req.setTimeout(0);
  res.setTimeout(0);
  try {
    const chunkBuffer = await readRequestBodyBuffer(req, uploadChunkMaxBytes);
    if (!chunkBuffer || chunkBuffer.length === 0) {
      return res.status(400).json({ error: 'Chunk vacío.' });
    }
    const nextBytes = Number(session.receivedBytes || 0) + chunkBuffer.length;
    if (nextBytes > Number(session.totalSize || 0)) {
      return res.status(400).json({ error: 'Chunk excede el tamaño total declarado.' });
    }
    assertStorageCapacityOrThrow({
      path: session.path,
      requiredBytes: Math.max(chunkBuffer.length + storageUploadReserveBytes, 64 * 1024 * 1024),
      operationLabel: `subir chunk de ${session.name}`
    });
    fs.appendFileSync(session.path, chunkBuffer);
    session.receivedBytes = nextBytes;
    session.nextChunkIndex = Number(session.nextChunkIndex || 0) + 1;
    session.updatedAt = Date.now();
    pendingChunkUploads.set(uploadId, session);
    const percent =
      Number(session.totalSize) > 0
        ? Math.min(100, Math.round((Number(session.receivedBytes) / Number(session.totalSize)) * 100))
        : 0;
    return res.json({
      ok: true,
      uploadId,
      chunkIndex,
      receivedBytes: Number(session.receivedBytes),
      totalSize: Number(session.totalSize),
      percent
    });
  } catch (error) {
    const normalized = normalizeStorageSpaceError(
      error,
      'No hay espacio suficiente para seguir subiendo el archivo.'
    );
    const statusCode = Number.isInteger(normalized && normalized.statusCode)
      ? normalized.statusCode
      : Number.isInteger(error && error.statusCode)
        ? error.statusCode
        : 500;
    if (normalized && normalized.exposeToClient) {
      return res.status(statusCode).json({
        error: normalized.message || 'No se pudo guardar chunk.',
        code: String(normalized.code || '').trim() || undefined,
        storage: normalized && normalized.storage ? normalized.storage : undefined
      });
    }
    return res.status(statusCode).json({
      error: `No se pudo guardar chunk: ${truncateForNotify(
        normalized && normalized.message ? normalized.message : error && error.message ? error.message : 'chunk_upload_failed',
        220
      )}`
    });
  }
});

app.post('/api/uploads/chunked/:uploadId/complete', requireAuth, (req, res) => {
  const safeUserId = getSafeUserId(req.session.userId);
  if (!safeUserId) {
    return res.status(400).json({ error: 'user_id inválido' });
  }
  const uploadId = String(req.params.uploadId || '').trim();
  if (!uploadId) {
    return res.status(400).json({ error: 'upload_id inválido' });
  }
  cleanupPendingUploads();
  const session = pendingChunkUploads.get(uploadId);
  if (!session || Number(session.userId) !== Number(safeUserId)) {
    return res.status(404).json({ error: 'Subida por chunks no encontrada o expirada.' });
  }
  const receivedBytes = Number(session.receivedBytes || 0);
  const totalSize = Number(session.totalSize || 0);
  if (!Number.isFinite(totalSize) || totalSize <= 0 || receivedBytes !== totalSize) {
    return res.status(409).json({
      error: `Subida incompleta. Recibido ${receivedBytes} de ${totalSize} bytes.`
    });
  }
  if (!session.path || !fs.existsSync(session.path)) {
    pendingChunkUploads.delete(uploadId);
    return res.status(404).json({ error: 'Archivo temporal de subida no disponible.' });
  }
  pendingChunkUploads.delete(uploadId);
  pendingUploads.set(uploadId, {
    uploadId,
    userId: safeUserId,
    conversationId: session.conversationId,
    name: session.name,
    mimeType: session.mimeType,
    size: totalSize,
    path: session.path,
    createdAt: Date.now()
  });
  return res.json({
    ok: true,
    attachment: {
      uploadId,
      name: session.name,
      mimeType: session.mimeType,
      size: totalSize
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
  req.setTimeout(0);
  res.setTimeout(0);
  const uploadId = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const pendingDir = path.join(pendingUploadsDir, String(req.session.userId));
  fs.mkdirSync(pendingDir, { recursive: true });
  const storedPath = path.join(pendingDir, `${uploadId}_${name}`);

  try {
    const expectedIncomingBytes =
      Number.isFinite(declaredSize) && declaredSize > 0
        ? Math.min(Math.max(1, Math.round(declaredSize)), maxAttachmentSizeBytes)
        : Math.min(maxAttachmentSizeBytes, 128 * 1024 * 1024);
    assertStorageCapacityOrThrow({
      path: pendingDir,
      requiredBytes: estimateAttachmentUploadRequiredBytes(expectedIncomingBytes, 1),
      operationLabel: `subir adjunto ${name}`
    });
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
      return res.status(error.statusCode || 400).json({
        error: error.message || 'Adjunto invalido',
        code: String(error.code || '').trim() || undefined,
        storage: error && error.storage ? error.storage : undefined
      });
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
  const requestedProjectId = parseProjectIdInput(req.body && req.body.projectId);
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
  const providerDefinition = getAiProviderDefinition(chatRuntime.activeAgentId);
  const providerCapabilities = Array.isArray(chatRuntime.capabilities) ? chatRuntime.capabilities : [];
  const providerNeedsShell = providerCapabilities.includes('shell');
  const providerNeedsSensitiveTools = providerCapabilities.includes('tool-calling') || providerNeedsShell;
  const providerNeedsNetwork = !['ollama', 'lmstudio'].includes(chatRuntime.activeAgentId);
  let runtimePolicy = null;
  try {
    runtimePolicy = resolveChatRuntimeExecutionPolicy(req.session.userId, chatRuntime);
    assertAiPermissionForAction(runtimePolicy.profile, 'chat', {
      requiresShell: providerNeedsShell,
      requiresSensitiveTool: providerNeedsSensitiveTools,
      requiresNetwork: providerNeedsNetwork
    });
  } catch (error) {
    const statusCode = Number.isInteger(error && error.statusCode) ? error.statusCode : 403;
    return res.status(statusCode).json({
      error:
        error && error.exposeToClient
          ? error.message
          : `Permisos insuficientes para ejecutar el chat: ${truncateForNotify(error && error.message ? error.message : 'permission_denied', 180)}`
    });
  }
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
  let conversationProjectId = null;
  let conversationProjectRow = null;
  let conversationCreatedForRequest = false;
  let liveDraftId = null;
  const liveDraftRequestId = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  let taskRunId = null;
  let taskSnapshot = null;
  let taskCommandSeq = 0;
  const taskCommandStateByItem = new Map();
  const taskTestCommands = new Set();
  let taskCompletionWritten = false;

  const scheduleProjectContextRefreshAfterChat = (trigger, force = false) => {
    if (!conversationProjectId) return;
    const project =
      conversationProjectRow || getOwnedProjectOrNull(conversationProjectId, req.session.userId);
    if (!project) return;
    if (!force && !normalizeProjectAutoEnabled(project.auto_context_enabled, true)) return;
    enqueueProjectContextRefreshJob(req.session.userId, conversationProjectId, {
      immediate: false,
      force,
      trigger: normalizeProjectContextText(trigger || 'chat', 64) || 'chat'
    });
  };

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
    conversationProjectId =
      Number.isInteger(Number(ownedConversation.project_id)) && Number(ownedConversation.project_id) > 0
        ? Number(ownedConversation.project_id)
        : null;
    conversationProjectRow = conversationProjectId
      ? getOwnedProjectOrNull(conversationProjectId, req.session.userId)
      : null;
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
    if (requestedProjectId !== null) {
      conversationProjectRow = getOwnedProjectOrNull(requestedProjectId, req.session.userId);
      if (!conversationProjectRow) {
        return res.status(404).json({ error: 'Proyecto no encontrado para iniciar chat.' });
      }
      conversationProjectId = Number(conversationProjectRow.id);
    }
    const title = buildConversationTitle(prompt);
    const created = createConversationStmt.run(
      req.session.userId,
      conversationProjectId,
      title,
      selectedModel,
      selectedReasoningEffort
    );
    conversationId = Number(created.lastInsertRowid);
    conversationCreatedForRequest = true;
  }

  try {
    persistedAttachments = persistAttachments(rawAttachments, conversationId, req.session.userId);
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
      scheduleTaskSnapshotPrune();
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
    const promptWithProjectContext = buildPromptWithProjectContext(promptWithHistory, conversationProjectRow);
    const promptWithRepoContext = buildPromptWithRepoContext(promptWithProjectContext, prompt);
    const executionPrompt = buildPromptWithAttachments(promptWithRepoContext, persistedAttachments);
    const httpProviderAdapter = getAiHttpProviderAdapter(chatRuntime.activeAgentId);
    if (httpProviderAdapter && typeof httpProviderAdapter.buildChatRequest === 'function') {
      const selectedProviderId = chatRuntime.activeAgentId;
      const providerIntegration = getUserAiAgentIntegration(req.session.userId, selectedProviderId);
      const providerLabel =
        (providerDefinition && providerDefinition.name) ||
        chatRuntime.activeAgentName ||
        selectedProviderId;
      if (httpProviderAdapter.requiresApiKey && !String(providerIntegration.apiKey || '').trim()) {
        throw createClientRequestError(
          `${providerLabel} está seleccionado pero falta API key en Integraciones IA.`,
          400
        );
      }
      const providerBaseUrl =
        resolveAiProviderBaseUrl(selectedProviderId, providerIntegration) ||
        httpProviderAdapter.defaultBaseUrl;

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
      const handleHttpProviderClientDisconnect = () => {
        clientDisconnected = true;
      };
      req.on('aborted', handleHttpProviderClientDisconnect);
      req.on('close', handleHttpProviderClientDisconnect);
      res.on('close', handleHttpProviderClientDisconnect);
      res.on('error', handleHttpProviderClientDisconnect);

      sendSseComment(res, 'ok');
      sendSse(res, 'conversation', { conversationId });
      sendSse(res, 'chat_agent', {
        id: chatRuntime.activeAgentId,
        name: chatRuntime.activeAgentName,
        provider: chatRuntime.runtimeProvider
      });
      sendSse(res, 'reasoning_step', {
        itemId: 'agent_runtime',
        text: `Agente activo: ${chatRuntime.activeAgentName}`
      });
      sendSse(res, 'reasoning_step', {
        itemId: 'permission_profile',
        text: `Permisos: root=${runtimePolicy.profile.allowRoot ? 'si' : 'no'}, shell=${
          runtimePolicy.profile.allowShell ? 'si' : 'no'
        }, red=${runtimePolicy.profile.allowNetwork ? 'si' : 'no'}, git=${
          runtimePolicy.profile.allowGit ? 'si' : 'no'
        }, escritura=${runtimePolicy.profile.canWriteFiles ? 'si' : 'no'}, modo=${runtimePolicy.accessMode}`
      });
      if (runtimePolicy.identityFallbackReason) {
        sendSse(res, 'system_notice', {
          text: `Ejecucion forzada como root para evitar fallo de permisos: ${runtimePolicy.identityFallbackReason}`
        });
      }

      const permissionHints = [];
      if (runtimePolicy.profile.readOnly || !runtimePolicy.profile.canWriteFiles) {
        permissionHints.push('Perfil activo: solo lectura. No modifiques archivos.');
      }
      if (!runtimePolicy.profile.allowNetwork) {
        permissionHints.push('Perfil activo: red bloqueada. No hagas llamadas de red.');
      }
      if (!runtimePolicy.profile.allowGit) {
        permissionHints.push('Perfil activo: operaciones Git bloqueadas.');
      }
      const selectedReasoning = sanitizeReasoningEffort(selectedReasoningEffort, DEFAULT_REASONING_EFFORT);
      const reasoningGuidance =
        geminiReasoningInstructionsByEffort[selectedReasoning] ||
        geminiReasoningInstructionsByEffort[DEFAULT_REASONING_EFFORT];
      const providerPrompt = [
        `Instruccion de razonamiento (${selectedReasoning}): ${reasoningGuidance}`,
        executionPrompt,
        permissionHints.length > 0 ? `\n[POLITICA]\n${permissionHints.join('\n')}` : ''
      ]
        .filter(Boolean)
        .join('\n');

      const providerAbortController = new AbortController();
      const abortableHandle = buildAbortableRunHandle(providerAbortController);
      let activeRun = registerActiveChatRun(req.session.userId, conversationId, abortableHandle);
      let usageSummary = null;
      let structuredOutput = true;
      let finalized = false;
      let streamedAssistantOutput = false;

      const finalizeHttpProviderRequest = ({ ok, closeReason, output }) => {
        if (finalized) return;
        finalized = true;
        const safeOutput = String(output || '').trim() || `(Sin salida de ${providerLabel})`;
        const runWasKilled = Boolean(activeRun && activeRun.killRequested);
        const success = Boolean(ok) && !runWasKilled;
        const safeExitCode = runWasKilled ? 130 : success ? 0 : 1;
        const effectiveCloseReason = runWasKilled
          ? String(activeRun && activeRun.killReason ? activeRun.killReason : 'killed_by_user')
          : String(closeReason || (success ? 'completed' : 'provider_error'));
        abortableHandle.exitCode = safeExitCode;
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
          if (!streamedAssistantOutput) {
            const chunkSize = 1600;
            for (let index = 0; index < safeOutput.length; index += chunkSize) {
              const chunk = safeOutput.slice(index, index + chunkSize);
              if (!chunk) continue;
              if (!sendSse(res, 'assistant_delta', { text: chunk })) {
                clientDisconnected = true;
                break;
              }
            }
          }
          if (!clientDisconnected) {
            sendSse(res, 'done', {
              ok: success,
              conversationId,
              exitCode: safeExitCode,
              closeReason: effectiveCloseReason,
              usage: usageSummary,
              structured: structuredOutput
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
          usage: usageSummary,
          structured: structuredOutput,
          clientDisconnected
        });
        scheduleProjectContextRefreshAfterChat(success ? 'chat_completed' : 'chat_failed');
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

      const providerRequest = httpProviderAdapter.buildChatRequest({
        model: selectedModel || getChatAgentDefaultModel(selectedProviderId),
        prompt: providerPrompt,
        integration: providerIntegration,
        baseUrl: providerBaseUrl,
        reasoningEffort: selectedReasoningEffort
      });
      const providerEndpoint = String(providerRequest && providerRequest.endpoint ? providerRequest.endpoint : '').trim();
      const providerHeaders =
        providerRequest && providerRequest.headers && typeof providerRequest.headers === 'object'
          ? providerRequest.headers
          : { 'Content-Type': 'application/json' };
      const providerBody =
        providerRequest && providerRequest.body && typeof providerRequest.body === 'object'
          ? providerRequest.body
          : {
              model: selectedModel || getChatAgentDefaultModel(selectedProviderId),
              stream: true,
              messages: [{ role: 'user', content: providerPrompt }]
            };
      const providerStreamFormat =
        providerRequest && typeof providerRequest.streamFormat === 'string'
          ? providerRequest.streamFormat
          : httpProviderAdapter.streamFormat || 'openai_sse';
      if (!providerEndpoint) {
        throw createClientRequestError(`Provider ${providerLabel} no tiene endpoint de chat configurado.`, 400);
      }

      let response = null;
      try {
        response = await fetch(providerEndpoint, {
          method: 'POST',
          headers: providerHeaders,
          body: JSON.stringify(providerBody),
          signal: providerAbortController.signal
        });
      } catch (error) {
        const wasKilled = Boolean(activeRun && activeRun.killRequested);
        const reason = truncateForNotify(error && error.message ? error.message : 'provider_request_failed', 220);
        finalizeHttpProviderRequest({
          ok: false,
          closeReason: wasKilled ? 'killed_by_user' : 'provider_unreachable',
          output: wasKilled
            ? `${providerLabel} detenido por usuario.`
            : `No se pudo conectar con ${providerLabel}: ${reason}`
        });
        return;
      }

      if (!response.ok) {
        let errorDetails = '';
        try {
          const payload = await response.json();
          const message =
            payload && payload.error && typeof payload.error === 'object'
              ? payload.error.message
              : payload && payload.error
                ? payload.error
                : payload && payload.message;
          errorDetails = String(message || '').trim();
        } catch (_error) {
          try {
            errorDetails = String(await response.text()).trim();
          } catch (_fallbackError) {
            errorDetails = '';
          }
        }
        finalizeHttpProviderRequest({
          ok: false,
          closeReason: 'provider_error',
          output:
            errorDetails ||
            `${providerLabel} respondió HTTP ${response.status}. Revisa credenciales, modelo y disponibilidad.`
        });
        return;
      }

      if (!response.body || typeof response.body.getReader !== 'function') {
        let plainOutput = '';
        try {
          plainOutput = String(await response.text()).trim();
        } catch (_error) {
          plainOutput = '';
        }
        finalizeHttpProviderRequest({
          ok: Boolean(plainOutput),
          closeReason: plainOutput ? 'completed' : 'provider_error',
          output: plainOutput || `${providerLabel} no devolvió stream válido.`
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let pending = '';
      let assistantOutput = '';
      let finishReason = '';

      const emitAssistantDelta = (text) => {
        const delta = String(text || '');
        if (!delta) return;
        streamedAssistantOutput = true;
        assistantOutput += delta;
        if (!clientDisconnected) {
          sendSse(res, 'assistant_delta', { text: delta });
        }
      };

      const emitReasoningDelta = (text) => {
        const delta = String(text || '');
        if (!delta) return;
        if (!clientDisconnected) {
          sendSse(res, 'reasoning_delta', {
            itemId: `${selectedProviderId}_thinking`,
            text: delta
          });
        }
      };

      const consumeOpenAiSseLine = (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed || !trimmed.startsWith('data:')) return;
        const payloadText = trimmed.slice(5).trim();
        if (!payloadText || payloadText === '[DONE]') return;
        let parsed = null;
        try {
          parsed = JSON.parse(payloadText);
        } catch (_error) {
          return;
        }
        if (parsed && parsed.usage && typeof parsed.usage === 'object') {
          usageSummary = parsed.usage;
        }
        const choice = parsed && Array.isArray(parsed.choices) ? parsed.choices[0] : null;
        if (!choice || typeof choice !== 'object') return;
        const deltaObject = choice.delta && typeof choice.delta === 'object' ? choice.delta : {};
        const messageObject = choice.message && typeof choice.message === 'object' ? choice.message : {};
        const contentDelta =
          extractTextFromProviderPayload(deltaObject.content) ||
          extractTextFromProviderPayload(messageObject.content);
        const reasoningDelta =
          extractTextFromProviderPayload(
            deltaObject.reasoning ||
              deltaObject.reasoning_content ||
              deltaObject.thinking ||
              deltaObject.analysis ||
              messageObject.reasoning ||
              messageObject.thinking
          ) || '';
        if (reasoningDelta) {
          emitReasoningDelta(reasoningDelta);
        }
        if (contentDelta) {
          emitAssistantDelta(contentDelta);
        }
        if (choice.finish_reason) {
          finishReason = String(choice.finish_reason || '').trim();
        }
      };

      const consumeOllamaLine = (line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        let parsed = null;
        try {
          parsed = JSON.parse(trimmed);
        } catch (_error) {
          return;
        }
        if (!parsed || typeof parsed !== 'object') return;
        if (parsed.done && parsed.done_reason) {
          finishReason = String(parsed.done_reason || '').trim();
        }
        if (parsed.done) {
          const usageCandidate = {};
          if (Number.isFinite(Number(parsed.prompt_eval_count))) {
            usageCandidate.promptEvalCount = Number(parsed.prompt_eval_count);
          }
          if (Number.isFinite(Number(parsed.eval_count))) {
            usageCandidate.evalCount = Number(parsed.eval_count);
          }
          if (Object.keys(usageCandidate).length > 0) {
            usageSummary = usageCandidate;
          }
        }
        const messageObject = parsed.message && typeof parsed.message === 'object' ? parsed.message : {};
        const contentDelta =
          extractTextFromProviderPayload(messageObject.content) || extractTextFromProviderPayload(parsed.response);
        const reasoningDelta =
          extractTextFromProviderPayload(
            messageObject.thinking || messageObject.reasoning || parsed.thinking || parsed.reasoning
          ) || '';
        if (reasoningDelta) {
          emitReasoningDelta(reasoningDelta);
        }
        if (contentDelta) {
          emitAssistantDelta(contentDelta);
        }
      };

      try {
        let streamDone = false;
        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) {
            streamDone = true;
          } else {
            pending += decoder.decode(value, { stream: true });
          }
          const normalized = pending.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const lines = normalized.split('\n');
          pending = lines.pop() || '';
          lines.forEach((line) => {
            if (providerStreamFormat === 'ollama_jsonl') {
              consumeOllamaLine(line);
            } else {
              consumeOpenAiSseLine(line);
            }
          });
        }
        if (pending && pending.trim()) {
          if (providerStreamFormat === 'ollama_jsonl') {
            consumeOllamaLine(pending.trim());
          } else {
            consumeOpenAiSseLine(pending.trim());
          }
        }
      } catch (error) {
        const wasKilled = Boolean(activeRun && activeRun.killRequested);
        const reason = truncateForNotify(error && error.message ? error.message : 'provider_stream_failed', 220);
        finalizeHttpProviderRequest({
          ok: false,
          closeReason: wasKilled ? 'killed_by_user' : 'stream_error',
          output: wasKilled
            ? `${providerLabel} detenido por usuario.`
            : `Fallo de streaming en ${providerLabel}: ${reason}`
        });
        return;
      }

      finalizeHttpProviderRequest({
        ok: true,
        closeReason: finishReason || 'completed',
        output: assistantOutput
      });
      return;
    }

    if (chatRuntime.activeAgentId === 'gemini-cli') {
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
      sendSse(res, 'reasoning_step', {
        itemId: 'permission_profile',
        text: `Permisos: root=${runtimePolicy.profile.allowRoot ? 'si' : 'no'}, shell=${
          runtimePolicy.profile.allowShell ? 'si' : 'no'
        }, red=${runtimePolicy.profile.allowNetwork ? 'si' : 'no'}, git=${
          runtimePolicy.profile.allowGit ? 'si' : 'no'
        }, escritura=${runtimePolicy.profile.canWriteFiles ? 'si' : 'no'}, modo=${runtimePolicy.accessMode}`
      });

      const permissionHints = [];
      if (runtimePolicy.profile.readOnly || !runtimePolicy.profile.canWriteFiles) {
        permissionHints.push('Perfil activo: solo lectura. No modifiques archivos.');
      }
      if (!runtimePolicy.profile.allowNetwork) {
        permissionHints.push('Perfil activo: red bloqueada. No hagas llamadas de red.');
      }
      if (!runtimePolicy.profile.allowGit) {
        permissionHints.push('Perfil activo: operaciones Git bloqueadas.');
      }
      const geminiPrompt = [
        buildGeminiPromptWithReasoning(executionPrompt, selectedReasoningEffort),
        permissionHints.length > 0 ? `\n[POLITICA]\n${permissionHints.join('\n')}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      const geminiArgs = ['-p', geminiPrompt];
      if (selectedModel) {
        geminiArgs.push('-m', selectedModel);
      }
      geminiArgs.push(
        '--approval-mode',
        'yolo',
        '--sandbox',
        runtimePolicy.profile.readOnly ? 'true' : 'false'
      );
      runtimePolicy.allowedPaths.forEach((directory) => {
        geminiArgs.push('--include-directories', directory);
      });
      const geminiEnv = {
        ...process.env,
        GEMINI_API_KEY: String(geminiIntegration.apiKey || '').trim(),
        CODEXWEB_ACTIVE_PROVIDER: chatRuntime.providerId,
        CODEXWEB_PERMISSION_PROFILE: JSON.stringify({
          agentId: chatRuntime.providerId,
          accessMode: runtimePolicy.accessMode,
          allowRoot: runtimePolicy.profile.allowRoot,
          canWriteFiles: runtimePolicy.profile.canWriteFiles,
          readOnly: runtimePolicy.profile.readOnly,
          allowNetwork: runtimePolicy.profile.allowNetwork,
          allowGit: runtimePolicy.profile.allowGit,
          allowedPaths: runtimePolicy.allowedPaths
        })
      };

      let geminiProcess = null;
      let activeRun = null;
      let finished = false;
      let stdoutText = '';
      let stderrText = '';
      const getGeminiFailureSummary = (stdoutValue, stderrValue) => {
        const cleanStdout = stripAnsi(String(stdoutValue || '')).trim();
        const cleanStderr = stripAnsi(String(stderrValue || '')).trim();
        const combined = `${cleanStdout}\n${cleanStderr}`.trim();
        if (!combined) return null;

        const hasUnexpectedObjectError = /an unexpected critical error occurred:\s*\[object object\]/i.test(combined);
        const hasApiError = /error when talking to gemini api|error generating content via api|apierror:/i.test(combined);
        const hasMissingAuth = /please set an auth method/i.test(combined);

        if (!hasUnexpectedObjectError && !hasApiError && !hasMissingAuth) {
          return null;
        }

        if (/api key not valid|api_key_invalid|invalid api key/i.test(combined)) {
          return {
            closeReason: 'invalid_api_key',
            message:
              'Gemini rechazo la API key configurada. Revisa la clave en Settings > Integraciones IA > Gemini CLI.'
          };
        }

        if (
          /please set an auth method|GEMINI_API_KEY|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_GENAI_USE_GCA/i.test(combined)
        ) {
          return {
            closeReason: 'auth_missing',
            message:
              'Gemini no tiene autenticacion configurada en el servidor. Configura la API key en Settings > Integraciones IA.'
          };
        }

        if (/resource_exhausted|quota|rate limit|too many requests|429/i.test(combined)) {
          return {
            closeReason: 'quota_exhausted',
            message:
              'Gemini reporto limite de cuota o rate limit alcanzado. Espera el reset de cuota o cambia de proyecto/API key.'
          };
        }

        const summaryLine = cleanStderr
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean)
          .find((entry) => /error when talking to gemini api|error generating content via api|apierror:/i.test(entry));

        if (summaryLine) {
          return {
            closeReason: 'provider_error',
            message: truncateForNotify(summaryLine, 260)
          };
        }

        return {
          closeReason: 'provider_error',
          message: 'Gemini devolvio un error interno inesperado. Revisa API key y cuota de Gemini.'
        };
      };

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
        scheduleProjectContextRefreshAfterChat(success ? 'chat_completed' : 'chat_failed');
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
        const spawnOptions = {
          cwd: runtimePolicy.cwd,
          env: geminiEnv,
          stdio: ['ignore', 'pipe', 'pipe']
        };
        if (runtimePolicy.runAsIdentity) {
          spawnOptions.uid = runtimePolicy.runAsIdentity.uid;
          spawnOptions.gid = runtimePolicy.runAsIdentity.gid;
        }
        geminiProcess = spawn(geminiPath, geminiArgs, {
          ...spawnOptions
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

      const emitGeminiReasoningChunk = (chunk, source = 'stderr') => {
        const raw = stripAnsi(String(chunk || ''));
        if (!raw) return;
        const lines = raw
          .replace(/\r/g, '\n')
          .split('\n')
          .map((entry) => String(entry || '').trim())
          .filter(Boolean);
        if (lines.length === 0) return;
        lines.forEach((line) => {
          const looksLikeReasoning = /thinking|pensando|analysis|analizando|plan|step|paso|reason/i.test(line);
          const looksLikeNoise = /^(\d+%|warning:|error:)/i.test(line);
          if (source === 'stderr' || looksLikeReasoning || looksLikeNoise) {
            sendSse(res, 'reasoning_delta', {
              itemId: source === 'stderr' ? 'gemini_stderr' : 'gemini_thinking',
              text: `${line}\n`
            });
          }
        });
      };

      geminiProcess.stdout.on('data', (chunk) => {
        stdoutText += String(chunk || '');
        emitGeminiReasoningChunk(chunk, 'stdout');
      });
      geminiProcess.stderr.on('data', (chunk) => {
        stderrText += String(chunk || '');
        emitGeminiReasoningChunk(chunk, 'stderr');
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
        const inferredFailure = runWasKilled ? null : getGeminiFailureSummary(cleanStdout, cleanStderr);
        const success = normalizedExitCode === 0 && !runWasKilled && !inferredFailure;
        let output = cleanStdout;
        let closeReason = success
          ? 'completed'
          : inferredFailure && inferredFailure.closeReason
            ? inferredFailure.closeReason
            : 'provider_error';

        if (runWasKilled) {
          closeReason = String(activeRun && activeRun.killReason ? activeRun.killReason : 'killed_by_user');
        }
        if (!success) {
          output =
            (inferredFailure && inferredFailure.message) ||
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
      runtimePolicy.codexSandbox,
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
    const codexPermissionHints = [];
    if (runtimePolicy.profile.readOnly || !runtimePolicy.profile.canWriteFiles) {
      codexPermissionHints.push('Perfil activo: solo lectura. No escribas archivos.');
    }
    if (!runtimePolicy.profile.allowNetwork) {
      codexPermissionHints.push('Perfil activo: red bloqueada. No ejecutes llamadas de red.');
    }
    if (!runtimePolicy.profile.allowGit) {
      codexPermissionHints.push('Perfil activo: operaciones Git bloqueadas.');
    }
    if (runtimePolicy.allowedPaths.length > 0) {
      codexPermissionHints.push(`Rutas permitidas: ${runtimePolicy.allowedPaths.join(', ')}`);
    }
    if (runtimePolicy.deniedPaths.length > 0) {
      codexPermissionHints.push(`Rutas bloqueadas: ${runtimePolicy.deniedPaths.join(', ')}`);
    }
    const codexPrompt =
      codexPermissionHints.length > 0
        ? `${executionPrompt}\n\n[POLITICA]\n${codexPermissionHints.join('\n')}`
        : executionPrompt;
    args.push(codexPrompt);

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
    sendSseSafe('reasoning_step', {
      itemId: 'permission_profile',
      text: `Permisos: root=${runtimePolicy.profile.allowRoot ? 'si' : 'no'}, shell=${
        runtimePolicy.profile.allowShell ? 'si' : 'no'
      }, red=${runtimePolicy.profile.allowNetwork ? 'si' : 'no'}, git=${
        runtimePolicy.profile.allowGit ? 'si' : 'no'
      }, escritura=${runtimePolicy.profile.canWriteFiles ? 'si' : 'no'}, modo=${runtimePolicy.accessMode}`
    });
    if (runtimePolicy.identityFallbackReason) {
      sendSseSafe('system_notice', {
        text: `Ejecucion forzada como root para evitar fallo de permisos: ${runtimePolicy.identityFallbackReason}`
      });
    }
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

    const codexExecOptions = {
      env: {
        ...getCodexEnvForUser(req.session.userId, {
          username: req.session && typeof req.session.username === 'string' ? req.session.username : '',
          ownerUid: runtimePolicy.runAsIdentity ? runtimePolicy.runAsIdentity.uid : undefined,
          ownerGid: runtimePolicy.runAsIdentity ? runtimePolicy.runAsIdentity.gid : undefined
        }),
        CODEXWEB_ACTIVE_PROVIDER: chatRuntime.providerId,
        CODEXWEB_PERMISSION_PROFILE: JSON.stringify({
          agentId: chatRuntime.providerId,
          allowRoot: runtimePolicy.profile.allowRoot,
          readOnly: runtimePolicy.profile.readOnly,
          allowNetwork: runtimePolicy.profile.allowNetwork,
          allowGit: runtimePolicy.profile.allowGit,
          allowedPaths: runtimePolicy.allowedPaths
        })
      },
      cwd: runtimePolicy.cwd
    };
    if (runtimePolicy.runAsIdentity) {
      codexExecOptions.uid = runtimePolicy.runAsIdentity.uid;
      codexExecOptions.gid = runtimePolicy.runAsIdentity.gid;
    }
    codexProcess = execFile(codexPath, args, codexExecOptions);
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
      scheduleProjectContextRefreshAfterChat(exitCode === 0 ? 'chat_completed' : 'chat_failed');
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
      const shouldPersistConversationError =
        Number.isInteger(Number(userMessageId)) && Number(userMessageId) > 0;
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
      if (shouldPersistConversationError) {
        scheduleProjectContextRefreshAfterChat('chat_client_error');
      }
      if (shouldPersistConversationError && userNotificationSettings.notifyOnFinish) {
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
      if (shouldPersistConversationError) {
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
      } else if (conversationCreatedForRequest && Number.isInteger(Number(conversationId)) && Number(conversationId) > 0) {
        try {
          deleteConversationStmt.run(conversationId);
          removePendingUploadsForConversation(conversationId);
        } catch (_cleanupError) {
          // best-effort rollback for empty conversation created in this request
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

    const providerLabel =
      String((providerDefinition && providerDefinition.name) || chatRuntime.activeAgentName || 'Provider IA').trim() ||
      'Provider IA';
    const codeNotFound =
      chatRuntime.activeAgentId === 'codex-cli' && Boolean(error && error.message === 'CODEX_NOT_FOUND');
    const shortError = codeNotFound
      ? 'codex no encontrado'
      : truncateForNotify(error && error.message ? error.message : 'exec_error', 120);
    void notify(`Error en chat user=${username}: ${shortError}`);
    const details = codeNotFound
      ? 'No se encontró el binario codex en el servidor.'
      : `No se pudo ejecutar ${providerLabel} en el servidor.`;
    const errorMessage = `Error ejecutando ${providerLabel}: ${details}`;
    const shouldPersistConversationError =
      Number.isInteger(Number(userMessageId)) && Number(userMessageId) > 0;
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
    if (shouldPersistConversationError) {
      scheduleProjectContextRefreshAfterChat('chat_exec_error');
    }
    if (shouldPersistConversationError && userNotificationSettings.notifyOnFinish) {
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
    if (shouldPersistConversationError) {
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
    } else if (conversationCreatedForRequest && Number.isInteger(Number(conversationId)) && Number(conversationId) > 0) {
      try {
        deleteConversationStmt.run(conversationId);
        removePendingUploadsForConversation(conversationId);
      } catch (_cleanupError) {
        // best-effort rollback for empty conversation created in this request
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
try {
  pruneTaskSnapshots({ force: true });
} catch (error) {
  const reason = truncateForNotify(error && error.message ? error.message : 'task_snapshot_prune_startup_failed', 180);
  void notify(`WARN task_snapshot_prune_startup_failed reason=${reason}`);
}
const taskSnapshotPruneTimer = setInterval(() => {
  try {
    pruneTaskSnapshots({ force: true });
  } catch (_error) {
    // best-effort maintenance
  }
}, taskSnapshotsPruneIntervalMs);
if (taskSnapshotPruneTimer && typeof taskSnapshotPruneTimer.unref === 'function') {
  taskSnapshotPruneTimer.unref();
}
resumePendingDeployedDescriptionJobs();
resumePendingStorageJobs();
grantFullAccessToActiveProviderForAdminUsersOnStartup();
if (process.env.CODEXWEB_NO_LISTEN === '1') {
  module.exports = {
    app,
    db,
    assertAiPermissionForAction,
    buildAiPermissionPresetForMode,
    buildAiPermissionFullAccessPatch,
    buildAbortableRunHandle,
    getAiAgentPermissionProfileForUser,
    getAiProviderCapabilities,
    getAiProviderQuotaForUser,
    getChatAgentModelOptions,
    listAiProviderModelsForUser,
    listAiProvidersForUser,
    normalizeChatAgentModel,
    refreshAiProviderQuotaForUser,
    resolveAiProviderBaseUrl,
    resolveChatAgentRuntimeForUser,
    supportedAiAgents,
    upsertAiAgentPermissionProfileForUser,
    grantFullAccessToActiveProviderForAdminUsersOnStartup
  };
} else {
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
    notifyMilestone('codex_permissions_root_default_started', 'codex_permissions_root_default_started');
    notifyMilestone('codex_permissions_migration_done', 'codex_permissions_migration_done');
    notifyMilestone('codex_permissions_backend_done', 'codex_permissions_backend_done');
    notifyMilestone('codex_permissions_ui_done', 'codex_permissions_ui_done');
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
}
