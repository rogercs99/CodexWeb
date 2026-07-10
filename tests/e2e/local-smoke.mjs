import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve('.');
const preload = path.join(projectRoot, 'tests', 'mocks', 'better-sqlite3-preload.cjs');
let child = null;
let runtime = null;

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

let BASE = process.env.BASE_URL || '';
const logs = [];
if (!BASE) {
  runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'codexweb-local-smoke-'));
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CODEXWEB_ENV: 'dev',
      HOST: '127.0.0.1',
      PORT: String(port),
      SESSION_COOKIE_SECURE: 'false',
      SESSION_SECRET: 'local-smoke-session',
      ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef',
      DB_PATH: path.join(runtime, 'test.db'),
      UPLOADS_DIR: path.join(runtime, 'uploads'),
      TASK_SNAPSHOTS_DIR: path.join(runtime, 'snapshots'),
      STORAGE_JOBS_DIR: path.join(runtime, 'storage'),
      KAGGLE_STUDIO_RUNTIME_DIR: path.join(runtime, 'studio'),
      KAGGLE_KERNELS_DIR: path.join(runtime, 'kernels'),
      STATIC_ASSETS_DIR: path.join(projectRoot, 'public'),
      CODEX_CMD: '/bin/echo',
      GEMINI_CMD: '/bin/echo',
      CLAUDE_CODE_BIN: '/bin/echo',
      NODE_OPTIONS: `--require ${preload}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const ready = await fetch(`${BASE}/api/me`);
      if (ready.ok) break;
    } catch {}
    if (attempt === 99) throw new Error(`Server did not start:\n${logs.join('').slice(-5000)}`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

const username = `audit_${Date.now()}`;
const password = 'audit_password_123';
let cookie = '';

async function request(route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${route}`, { ...options, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(',').map((part) => part.split(';')[0]).join('; ');
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { res, body, text };
}

function parseSse(text) {
  const events = [];
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    let event = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    let data = dataLines.join('\n');
    try { data = JSON.parse(data); } catch {}
    events.push({ event, data });
  }
  return events;
}

try {
  const unauth = await request('/api/me');
  assert.equal(unauth.res.status, 200);
  assert.equal(unauth.body.authenticated, false);

  const reg = await request('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.ok([200, 201].includes(reg.res.status), reg.text);
  assert.ok(cookie.includes('connect.sid'), 'session cookie missing');

  for (const route of ['/api/me', '/api/chat/options', '/api/conversations', '/api/tools/observability', '/api/kaggle/studio/sessions', '/']) {
    const response = await request(route);
    assert.ok(response.res.status >= 200 && response.res.status < 400, `${route} -> ${response.res.status}: ${response.text.slice(0, 200)}`);
  }

  const refreshedModels = await request('/api/chat/options?refresh=1');
  assert.equal(refreshedModels.res.status, 200, refreshedModels.text);
  assert.ok(Array.isArray(refreshedModels.body.models) && refreshedModels.body.models.length > 0, 'model catalog missing');
  assert.ok(refreshedModels.body.modelCatalog && refreshedModels.body.modelCatalog.source, 'model catalog metadata missing');

  const dangerous = await request('/api/tools/terminal-live/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'rm -rf /' })
  });
  assert.equal(dangerous.res.status, 409, dangerous.text);
  assert.equal(dangerous.body.dangerousDetected, true);

  const terminal = await request('/api/tools/terminal-live/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: "printf 'terminal-live-ok\\n'", timeoutMs: 10000 })
  });
  assert.equal(terminal.res.status, 200, terminal.text);
  assert.match(terminal.res.headers.get('content-type') || '', /text\/event-stream/);
  const events = parseSse(terminal.text);
  assert.ok(events.some((event) => event.event === 'session'), 'missing session event');
  assert.ok(events.some((event) => event.event === 'stdout' && event.data?.text?.includes('terminal-live-ok')), 'missing stdout');
  const done = events.find((event) => event.event === 'done');
  assert.ok(done, 'missing done event');
  assert.equal(done.data.ok, true, JSON.stringify(done.data));

  console.log(JSON.stringify({ ok: true, username, checked: ['auth', 'core api', 'terminal danger guard', 'terminal SSE'] }, null, 2));
} finally {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  if (runtime) fs.rmSync(runtime, { recursive: true, force: true });
}
