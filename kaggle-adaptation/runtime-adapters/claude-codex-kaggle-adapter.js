/**
 * Claude Code & Codex CLI Kaggle Adapter
 * Configura modos headless y preflights para entorno efímero Kaggle
 */

const { spawn } = require('child_process');
const { isKaggleEnvironment } = require('./kaggle-env-detector');

/**
 * Opciones de configuración para Claude Code en Kaggle
 */
const CLAUDE_KAGGLE_CONFIG = {
  // Modo headless: sin interacción de usuario
  headless: true,
  // Timeout reducido para kernels efímeros
  timeout: 600000, // 10 minutos (vs 15 min en VPS)
  // Working directory por defecto
  defaultCwd: '/kaggle/working/workspace',
  // Modelos permitidos (solo los más rápidos para optimizar créditos)
  allowedModels: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  defaultModel: 'claude-haiku-4-5',
  // Reasoning effort reducido para velocidad
  defaultReasoningEffort: 'low'
};

/**
 * Opciones de configuración para Codex CLI en Kaggle
 */
const CODEX_KAGGLE_CONFIG = {
  headless: true,
  timeout: 600000,
  defaultCwd: '/kaggle/working/workspace',
  // Modelos Codex optimizados para tareas de código
  allowedModels: ['gpt-5.3-codex', 'gpt-5.1-codex'],
  defaultModel: 'gpt-5.3-codex',
  defaultReasoningEffort: 'high'
};

/**
 * Verifica si Claude Code está instalado y accesible
 * @param {string} bin - Binario de Claude Code (default: 'claude')
 * @returns {Promise<Object>} - { available: boolean, version?: string, error?: string }
 */
async function preflightClaudeCode(bin = 'claude') {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });

    child.on('close', (code) => {
      resolve({
        available: code === 0,
        version: code === 0 ? output.trim() : null,
        error: code !== 0 ? `Exit code ${code}` : null
      });
    });

    child.on('error', (err) => {
      resolve({
        available: false,
        error: err.message
      });
    });
  });
}

/**
 * Verifica si Codex CLI está instalado y accesible
 * @returns {Promise<Object>} - { available: boolean, version?: string, error?: string }
 */
async function preflightCodexCLI() {
  return new Promise((resolve) => {
    const child = spawn('codex', ['--version'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });

    child.on('close', (code) => {
      resolve({
        available: code === 0,
        version: code === 0 ? output.trim() : null,
        error: code !== 0 ? `Exit code ${code}` : null
      });
    });

    child.on('error', (err) => {
      resolve({
        available: false,
        error: err.message
      });
    });
  });
}

/**
 * Obtiene configuración de Claude Code según el entorno
 * @returns {Object} - Configuración adaptada
 */
function getClaudeCodeConfig() {
  if (isKaggleEnvironment()) {
    return {
      ...CLAUDE_KAGGLE_CONFIG,
      environment: 'kaggle'
    };
  }

  // Configuración VPS (por defecto)
  return {
    headless: false,
    timeout: 900000, // 15 min
    defaultCwd: process.env.CLAUDE_CODE_DEFAULT_CWD || '/root/CodexWeb',
    allowedModels: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
    defaultModel: process.env.CLAUDE_CODE_DEFAULT_MODEL || 'claude-sonnet-4-5',
    defaultReasoningEffort: process.env.CLAUDE_CODE_DEFAULT_REASONING_EFFORT || 'low',
    environment: 'vps'
  };
}

/**
 * Obtiene configuración de Codex CLI según el entorno
 * @returns {Object} - Configuración adaptada
 */
function getCodexCLIConfig() {
  if (isKaggleEnvironment()) {
    return {
      ...CODEX_KAGGLE_CONFIG,
      environment: 'kaggle'
    };
  }

  // Configuración VPS (por defecto)
  return {
    headless: false,
    timeout: 900000,
    defaultCwd: '/root/CodexWeb',
    allowedModels: ['gpt-5.3-codex', 'gpt-5.1-codex'],
    defaultModel: 'gpt-5.3-codex',
    defaultReasoningEffort: 'xhigh',
    environment: 'vps'
  };
}

/**
 * Configura variables de entorno para Claude Code en Kaggle
 * Debe llamarse antes de arrancar el servidor
 */
function configureClaudeCodeForKaggle() {
  if (!isKaggleEnvironment()) return;

  const config = getClaudeCodeConfig();

  // Sobrescribir env vars
  process.env.CLAUDE_CODE_DEFAULT_CWD = config.defaultCwd;
  process.env.CLAUDE_CODE_ALLOWED_CWDS = config.defaultCwd;
  process.env.CLAUDE_CODE_DEFAULT_MODEL = config.defaultModel;
  process.env.CLAUDE_CODE_DEFAULT_REASONING_EFFORT = config.defaultReasoningEffort;
  process.env.CLAUDE_CODE_TIMEOUT_MS = String(config.timeout);

  console.log('[Claude Code] Configured for Kaggle:', config);
}

/**
 * Configura variables de entorno para Codex CLI en Kaggle
 */
function configureCodexCLIForKaggle() {
  if (!isKaggleEnvironment()) return;

  const config = getCodexCLIConfig();

  console.log('[Codex CLI] Configured for Kaggle:', config);
}

/**
 * Ejecuta preflights de todos los agentes y retorna status
 * @returns {Promise<Object>} - { claude: {...}, codex: {...} }
 */
async function runAllPreflights() {
  const [claudeResult, codexResult] = await Promise.all([
    preflightClaudeCode(process.env.CLAUDE_CODE_BIN || 'claude'),
    preflightCodexCLI()
  ]);

  return {
    claude: {
      ...claudeResult,
      config: getClaudeCodeConfig()
    },
    codex: {
      ...codexResult,
      config: getCodexCLIConfig()
    },
    environment: isKaggleEnvironment() ? 'kaggle' : 'vps',
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  CLAUDE_KAGGLE_CONFIG,
  CODEX_KAGGLE_CONFIG,
  preflightClaudeCode,
  preflightCodexCLI,
  getClaudeCodeConfig,
  getCodexCLIConfig,
  configureClaudeCodeForKaggle,
  configureCodexCLIForKaggle,
  runAllPreflights
};
