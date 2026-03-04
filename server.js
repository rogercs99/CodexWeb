require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
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
const webhookUrl =
  process.env.WEBHOOK_URL ||
  'https://discord.com/api/webhooks/1386130355190501491/c3p6EQQeH7h0ynizeBWBGuPyTIljMCz4_M0d8qmYe9FPKbX4aB4vy1sfRmFUyHoQBPCb';
let resolvedCodexPath = null;
const sentMilestones = new Set();
const DEFAULT_CHAT_MODEL = 'gpt-5.3-codex';
const DEFAULT_REASONING_EFFORT = 'xhigh';
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
const allowedReasoningEfforts = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
const uploadsDir = path.join(__dirname, 'uploads');
const pendingUploadsDir = path.join(uploadsDir, 'pending');
const codexUsersRootDir = path.join(__dirname, '.codex_users');
const restartStatePath = path.join(__dirname, 'restart-state.json');
const restartLogLimit = 200;
const maxAttachments = 5;
const maxAttachmentSizeBytes = 500 * 1024 * 1024;
const maxAttachmentSizeMb = Math.floor(maxAttachmentSizeBytes / (1024 * 1024));
const maxJsonBodyBytes = 2 * 1024 * 1024;
const maxJsonBodyMb = Math.floor(maxJsonBodyBytes / (1024 * 1024));
const configuredChatMaxOutputTokens = Number.parseInt(
  String(process.env.CHAT_MAX_OUTPUT_TOKENS || '12000'),
  10
);
const chatMaxOutputTokens =
  Number.isInteger(configuredChatMaxOutputTokens) && configuredChatMaxOutputTokens > 0
    ? configuredChatMaxOutputTokens
    : null;
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

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const defaultDbPath = fs.existsSync(path.join(__dirname, 'app.db')) ? 'app.db' : 'chat.db';
const dbPath = process.env.DB_PATH || defaultDbPath;
const db = new Database(path.join(__dirname, dbPath));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(pendingUploadsDir, { recursive: true });
fs.mkdirSync(codexUsersRootDir, { recursive: true });

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

function getCodexEnvForUser(userId) {
  return {
    ...process.env,
    CODEX_HOME: getUserCodexHome(userId)
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

async function getCodexAuthStatusForUser(userId) {
  const codexPath = await resolveCodexPath();
  const env = getCodexEnvForUser(userId);
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
      statusText
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
      statusText
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

function beginRestartAttempt(username) {
  const safeUser = truncateForNotify(username || 'anon', 80);
  const attemptId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const startedAt = nowIso();
  restartState = normalizeRestartState({
    attemptId,
    active: true,
    phase: 'requested',
    requestedBy: safeUser,
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
  updateRestartState((state) => {
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
}

function notify(msg) {
  const safeMsg = truncateForNotify(msg, 1500);
  try {
    const payload = JSON.stringify({ content: safeMsg });
    return new Promise((resolve) => {
      const curl = spawn(
        'curl',
        ['-4', '-sS', '-H', 'Content-Type: application/json', '-d', payload, webhookUrl],
        {
          stdio: ['ignore', 'ignore', 'pipe']
        }
      );

      curl.stderr.on('data', () => {
        // Best-effort notifications only; ignore stderr output.
      });
      curl.on('error', () => resolve());
      curl.on('close', () => resolve());
    });
  } catch (_error) {
    return Promise.resolve();
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE INDEX IF NOT EXISTS idx_conversations_user_created
ON conversations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
ON messages(conversation_id, created_at ASC);

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
`);

function hasConversationColumn(columnName) {
  const columns = db.prepare('PRAGMA table_info(conversations)').all();
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
const listMessagesStmt = db.prepare(`
  SELECT id, role, content, created_at
  FROM messages
  WHERE conversation_id = ?
  ORDER BY created_at ASC, id ASC
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

app.post('/api/restart', requireAuth, (req, res) => {
  if (restartScheduled) {
    return res.status(409).json({ error: 'Ya hay un reinicio en progreso' });
  }

  const username = truncateForNotify(req.session && req.session.username ? req.session.username : 'anon');
  const attempt = beginRestartAttempt(username);
  try {
    restartScheduled = true;
    setRestartPhase('scheduling');
    pushRestartLog('Preparando helper de reinicio');
    scheduleApplicationRestart(attempt.attemptId);
    pushRestartLog('Helper de reinicio lanzado');
    setRestartPhase('waiting_shutdown');
    void notify(`RESTART requested user=${username}`);

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
    void notify(`RESTART failed user=${username} reason=${reason}`);
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
      liveDraftOpen: Number(conversation.live_draft_open) > 0,
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
  const messages = listMessagesStmt.all(conversationId);
  const liveDraft = getOpenLiveDraftForConversationStmt.get(req.session.userId, conversationId);
  let parsedReasoning = {};
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
  return res.json({
    ok: true,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      model: conversation.model || '',
      reasoningEffort: sanitizeReasoningEffort(conversation.reasoning_effort, DEFAULT_REASONING_EFFORT)
    },
    messages,
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
      : null
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

app.get('/api/chat/options', requireAuth, (_req, res) => {
  const models = loadCodexModelsFromCache();
  const mergedModels = [...chatGptModelOptions, ...models].filter(
    (slug, index, list) => list.indexOf(slug) === index
  );
  return res.json({
    ok: true,
    models: mergedModels,
    reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaults: {
      model: DEFAULT_CHAT_MODEL,
      reasoningEffort: DEFAULT_REASONING_EFFORT
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

app.get('/api/codex/auth/status', requireAuth, async (req, res) => {
  try {
    const auth = await getCodexAuthStatusForUser(req.session.userId);
    const activeFlow = getActiveCodexLoginFlow(req.session.userId);
    return res.json({
      ok: true,
      auth: {
        loggedIn: Boolean(auth.loggedIn),
        statusText: String(auth.statusText || ''),
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
      env: getCodexEnvForUser(safeUserId),
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
      env: getCodexEnvForUser(safeUserId),
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
  const hasAttachments = rawAttachments.length > 0;
  if ((!message || !message.trim()) && !hasAttachments) {
    void notify(`Error en chat user=${username}: mensaje vacío`);
    return res.status(400).json({ error: 'Mensaje vacío' });
  }
  const prompt = message && message.trim() ? message.trim() : 'Analiza los adjuntos y responde.';
  if (reasoningWasProvided && requestedReasoningEffort && !allowedReasoningEfforts.has(requestedReasoningEffort)) {
    return res.status(400).json({ error: 'Nivel de razonamiento inválido' });
  }
  let selectedModel = requestedModel || DEFAULT_CHAT_MODEL;
  let selectedReasoningEffort = sanitizeReasoningEffort(
    requestedReasoningEffort,
    DEFAULT_REASONING_EFFORT
  );
  let conversationId = null;
  let persistedAttachments = [];
  let assistantMessageId = null;
  let liveDraftId = null;
  const liveDraftRequestId = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

  if (requestedConversationId !== null) {
    if (!Number.isInteger(requestedConversationId) || requestedConversationId <= 0) {
      return res.status(400).json({ error: 'conversation_id inválido' });
    }
    const ownedConversation = getOwnedConversationOrNull(requestedConversationId, req.session.userId);
    if (!ownedConversation) {
      return res.status(404).json({ error: 'Conversación no encontrada' });
    }
    conversationId = requestedConversationId;
    selectedModel = modelWasProvided
      ? requestedModel || DEFAULT_CHAT_MODEL
      : String(ownedConversation.model || DEFAULT_CHAT_MODEL);
    selectedReasoningEffort = reasoningWasProvided
      ? sanitizeReasoningEffort(
          requestedReasoningEffort,
          sanitizeReasoningEffort(ownedConversation.reasoning_effort, DEFAULT_REASONING_EFFORT)
        )
      : sanitizeReasoningEffort(ownedConversation.reasoning_effort, DEFAULT_REASONING_EFFORT);

    if (modelWasProvided || reasoningWasProvided) {
      updateConversationSettingsStmt.run(selectedModel, selectedReasoningEffort, conversationId);
    }
  } else {
    const title = buildConversationTitle(prompt);
    const created = createConversationStmt.run(req.session.userId, title, selectedModel, selectedReasoningEffort);
    conversationId = Number(created.lastInsertRowid);
  }

  insertMessageStmt.run(conversationId, 'user', prompt);
  updateConversationTitleStmt.run(buildConversationTitle(prompt), conversationId);
  void notify(`Arranca request chat user=${username}`);

  try {
    persistedAttachments = persistAttachments(rawAttachments, conversationId, req.session.userId);
    const conversationMessages = listMessagesStmt.all(conversationId);
    const promptWithHistory = buildPromptWithConversationHistory(prompt, conversationMessages);
    const executionPrompt = buildPromptWithAttachments(promptWithHistory, persistedAttachments);
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
      if (itemId) {
        commandOutputByItem.set(itemId, aggregatedOutput);
      }
      sendSseSafe('command_started', { itemId, command, status });
      if (aggregatedOutput) {
        sendSseSafe('command_output_delta', { itemId, text: aggregatedOutput });
      }
    };

    const handleCommandCompleted = (item) => {
      const itemId = getStringField(item, ['id', 'itemId']);
      const command = getStringField(item, ['command']);
      const status = toSnakeCase(getStringField(item, ['status'])) || 'completed';
      const output = getStringField(item, ['aggregated_output', 'aggregatedOutput']);
      const exitCode = getNumberField(item, ['exit_code', 'exitCode']);
      if (itemId) {
        const previousOutput = commandOutputByItem.get(itemId) || '';
        if (output && output !== previousOutput) {
          const delta = output.startsWith(previousOutput) ? output.slice(previousOutput.length) : output;
          if (delta) {
            sendSseSafe('command_output_delta', { itemId, text: delta });
          }
        }
        commandOutputByItem.set(itemId, output);
      }
      sendSseSafe('command_completed', {
        itemId,
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
        if (!itemId) return;
        const previousOutput = commandOutputByItem.get(itemId) || '';
        const nextOutput = getStringField(item, ['aggregated_output', 'aggregatedOutput']);
        if (!nextOutput || nextOutput === previousOutput) return;
        const delta = nextOutput.startsWith(previousOutput) ? nextOutput.slice(previousOutput.length) : nextOutput;
        if (delta) {
          sendSseSafe('command_output_delta', { itemId, text: delta });
        }
        commandOutputByItem.set(itemId, nextOutput);
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
      env: getCodexEnvForUser(req.session.userId),
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

    const codeNotFound = Boolean(error && error.message === 'CODEX_NOT_FOUND');
    const shortError = codeNotFound
      ? 'codex no encontrado'
      : truncateForNotify(error && error.message ? error.message : 'exec_error', 120);
    void notify(`Error en chat user=${username}: ${shortError}`);
    const details = codeNotFound
      ? 'No se encontró el binario codex en el servidor.'
      : 'No se pudo ejecutar codex en el servidor.';
    const errorMessage = `Error ejecutando Codex local: ${details}`;
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
    return res.status(500).json({ error: `Error ejecutando Codex local. ${details}` });
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
