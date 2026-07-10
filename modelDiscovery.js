'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CLAUDE_CODE_EVERGREEN_MODELS = Object.freeze([
  'default',
  'best',
  'fable',
  'opus',
  'sonnet',
  'haiku',
  'sonnet[1m]',
  'opus[1m]'
]);

// Kept as an empty export for backwards compatibility. Aliases and dynamic discovery
// avoid shipping model IDs that become stale or were never valid for this account.
const CLAUDE_CODE_PINNED_FALLBACK_MODELS = Object.freeze([]);
const CODEX_STATIC_FALLBACK_MODELS = Object.freeze(['gpt-5']);

function uniqueStrings(values, limit = 160) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function extractCodexModelIds(payload) {
  const result = payload && typeof payload === 'object' ? payload.result : null;
  const source =
    (result && Array.isArray(result.data) && result.data) ||
    (payload && Array.isArray(payload.data) && payload.data) ||
    (payload && Array.isArray(payload.models) && payload.models) ||
    [];
  return uniqueStrings(
    source
      .filter((entry) => !entry || typeof entry !== 'object' || entry.hidden !== true)
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (!entry || typeof entry !== 'object') return '';
        return entry.model || entry.id || entry.slug || entry.name || '';
      })
  );
}

function readCodexModelsCache(codexHome) {
  const safeHome = String(codexHome || '').trim();
  if (!safeHome) return [];
  try {
    const cachePath = path.join(safeHome, 'models_cache.json');
    if (!fs.existsSync(cachePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const models = Array.isArray(parsed && parsed.models) ? parsed.models.slice() : [];
    models.sort((a, b) => Number(a && a.priority) - Number(b && b.priority));
    return uniqueStrings(
      models
        .filter((entry) => {
          if (!entry || typeof entry !== 'object') return true;
          if (entry.show_in_picker === false || entry.hidden === true) return false;
          const visibility = String(entry.visibility || '').trim().toLowerCase();
          return visibility !== 'hide' && visibility !== 'hidden';
        })
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          return entry && (entry.slug || entry.model || entry.id || entry.name);
        })
    );
  } catch (_error) {
    return [];
  }
}

function discoverCodexModelsViaAppServer(options = {}) {
  const codexPath = String(options.codexPath || 'codex').trim() || 'codex';
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const timeoutMs = Math.max(2000, Math.min(30000, Number(options.timeoutMs) || 10000));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let initialized = false;
    const child = spawn(codexPath, ['app-server'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    });

    const finish = (error, models = []) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch (_error) {}
      if (error) reject(error);
      else resolve(uniqueStrings(models));
    };

    const send = (payload) => {
      try {
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        finish(error);
      }
    };

    const processLine = (line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      let payload;
      try { payload = JSON.parse(trimmed); } catch (_error) { return; }
      if (payload && payload.id === 1 && !initialized) {
        if (payload.error) {
          finish(new Error(`codex_app_server_initialize_failed:${payload.error.message || 'unknown'}`));
          return;
        }
        initialized = true;
        send({ method: 'initialized', params: {} });
        send({ method: 'model/list', id: 2, params: { limit: 160, cursor: null, includeHidden: false } });
        return;
      }
      if (payload && payload.id === 2) {
        if (payload.error) {
          finish(new Error(`codex_model_list_failed:${payload.error.message || 'unknown'}`));
          return;
        }
        const models = extractCodexModelIds(payload);
        if (models.length === 0) {
          finish(new Error('codex_model_list_empty'));
          return;
        }
        finish(null, models);
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        processLine(stdoutBuffer.slice(0, newlineIndex));
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderrBuffer = `${stderrBuffer}${chunk}`.slice(-4000); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (!settled) finish(new Error(`codex_app_server_closed_${code}:${stderrBuffer.slice(-500)}`));
    });

    timer = setTimeout(() => finish(new Error(`codex_model_list_timeout_${timeoutMs}`)), timeoutMs);
    send({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'codexweb', title: 'CodexWeb', version: '1.0.0' } }
    });
  });
}


function refreshCodexAccountViaAppServer(options = {}) {
  const codexPath = String(options.codexPath || 'codex').trim() || 'codex';
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const timeoutMs = Math.max(2000, Math.min(30000, Number(options.timeoutMs) || 10000));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let buffer = '';
    let stderr = '';
    let initialized = false;
    const child = spawn(codexPath, ['app-server'], { env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const finish = (error, result = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { child.stdin.end(); } catch (_error) {}
      try { child.kill('SIGTERM'); } catch (_error) {}
      if (error) reject(error);
      else resolve(result && typeof result === 'object' ? result : {});
    };
    const send = (payload) => {
      try { child.stdin.write(`${JSON.stringify(payload)}\n`); } catch (error) { finish(error); }
    };
    const processLine = (line) => {
      const text = String(line || '').trim();
      if (!text) return;
      let payload;
      try { payload = JSON.parse(text); } catch (_error) { return; }
      if (payload.id === 1 && !initialized) {
        if (payload.error) return finish(new Error(`codex_app_server_initialize_failed:${payload.error.message || 'unknown'}`));
        initialized = true;
        send({ method: 'initialized', params: {} });
        send({ method: 'account/read', id: 2, params: { refreshToken: true } });
        return;
      }
      if (payload.id === 2) {
        if (payload.error) return finish(new Error(`codex_account_refresh_failed:${payload.error.message || 'unknown'}`));
        finish(null, payload.result || {});
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        processLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (!settled) finish(new Error(`codex_app_server_closed_${code}:${stderr.slice(-500)}`));
    });
    timer = setTimeout(() => finish(new Error(`codex_account_refresh_timeout_${timeoutMs}`)), timeoutMs);
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'codexweb', title: 'CodexWeb', version: '1.0.0' } } });
  });
}

async function fetchAnthropicModels(options = {}) {
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) return [];
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return [];
  const baseUrl = String(options.baseUrl || 'https://api.anthropic.com').trim().replace(/\/+$/, '');
  const controller = new AbortController();
  const timeoutMs = Math.max(2000, Math.min(30000, Number(options.timeoutMs) || 8000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/v1/models?limit=1000`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: controller.signal
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return uniqueStrings(
      (Array.isArray(payload && payload.data) ? payload.data : [])
        .map((entry) => String((entry && (entry.id || entry.name)) || '').trim())
        .filter((entry) => entry.startsWith('claude-'))
    );
  } catch (_error) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function discoverClaudeCodeModels(options = {}) {
  const remote = await fetchAnthropicModels(options);
  return uniqueStrings([...CLAUDE_CODE_EVERGREEN_MODELS, ...remote]);
}

function isRecognizedClaudeCodeModel(value) {
  const model = String(value || '').trim();
  if (!model) return false;
  if (CLAUDE_CODE_EVERGREEN_MODELS.includes(model)) return true;
  if (model.startsWith('claude-')) return true;
  return model.startsWith('anthropic.') || model.startsWith('arn:') || model.includes('/');
}

module.exports = {
  CLAUDE_CODE_EVERGREEN_MODELS,
  CLAUDE_CODE_PINNED_FALLBACK_MODELS,
  CODEX_STATIC_FALLBACK_MODELS,
  uniqueStrings,
  extractCodexModelIds,
  readCodexModelsCache,
  discoverCodexModelsViaAppServer,
  refreshCodexAccountViaAppServer,
  fetchAnthropicModels,
  discoverClaudeCodeModels,
  isRecognizedClaudeCodeModel
};
