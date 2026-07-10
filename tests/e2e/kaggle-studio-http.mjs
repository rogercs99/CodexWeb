import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve('.');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'codexweb-kaggle-http-'));
const kernelDir = path.join(runtime, 'kernels');
const studioDir = path.join(runtime, 'studio');
const publicDir = path.join(projectRoot, 'public');
const fakeCli = path.join(projectRoot, 'tests', 'fixtures', 'fake-kaggle-cli.sh');
const preload = path.join(projectRoot, 'tests', 'mocks', 'better-sqlite3-preload.cjs');

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

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const logs = [];
const child = spawn(process.execPath, ['server.js'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    CODEXWEB_ENV: 'dev',
    HOST: '127.0.0.1',
    PORT: String(port),
    SESSION_COOKIE_SECURE: 'false',
    SESSION_SECRET: 'kaggle-http-test-session',
    ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef',
    DB_PATH: path.join(runtime, 'test.db'),
    UPLOADS_DIR: path.join(runtime, 'uploads'),
    TASK_SNAPSHOTS_DIR: path.join(runtime, 'snapshots'),
    STORAGE_JOBS_DIR: path.join(runtime, 'storage'),
    STATIC_ASSETS_DIR: publicDir,
    KAGGLE_STUDIO_RUNTIME_DIR: studioDir,
    KAGGLE_KERNELS_DIR: kernelDir,
    KAGGLE_CLI_PATH: fakeCli,
    KAGGLE_USERNAME: 'audit',
    KAGGLE_KEY: 'fake-key',
    CODEX_CMD: '/bin/echo',
    GEMINI_CMD: '/bin/echo',
    CLAUDE_CODE_BIN: '/bin/echo',
    NODE_OPTIONS: `--require ${preload}`
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', (chunk) => logs.push(String(chunk)));
child.stderr.on('data', (chunk) => logs.push(String(chunk)));

async function waitReady() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${base}/api/me`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Server did not start:\n${logs.join('').slice(-5000)}`);
}

async function request(urlPath, options = {}, cookie = '') {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${urlPath}`, { ...options, headers });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  const setCookie = res.headers.get('set-cookie') || '';
  return { res, text, body, cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

try {
  await waitReady();
  let owner = await request('/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: `studio_owner_${Date.now()}`, password: 'audit_password_123' })
  });
  assert.ok([200, 201].includes(owner.res.status), owner.text);
  const ownerCookie = owner.cookie;

  const started = await request('/api/kaggle/studio/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gpuPreference: 't4', enableInternet: true, persistenceEnabled: true,
      backupIntervalMinutes: 5, maxBackupMb: 25, maxParallel: 2,
      tunnelProvider: 'pinggy', datasetSources: ['owner/dataset'], publicBaseUrl: base
    })
  }, ownerCookie);
  assert.equal(started.res.status, 201, started.text);
  assert.equal(started.body.session.status, 'queued');
  const sessionId = started.body.session.id;
  const jobId = started.body.session.jobId;
  assert.match(sessionId, /^studio-[a-f0-9]{12}$/);

  const scriptPath = path.join(kernelDir, jobId, 'script.py');
  assert.ok(fs.existsSync(scriptPath), `Generated kernel missing at ${scriptPath}`);
  const generated = fs.readFileSync(scriptPath, 'utf8');
  const token = generated.match(/os\.environ\["CODEXWEB_STUDIO_TOKEN"\] = "([a-f0-9]+)"/)?.[1];
  assert.ok(token, 'Callback token not found in generated kernel');
  const metadata = JSON.parse(fs.readFileSync(path.join(kernelDir, jobId, 'kernel-metadata.json'), 'utf8'));
  assert.equal(metadata.enable_gpu, true);
  assert.equal(metadata.enable_internet, true);
  assert.deepEqual(metadata.dataset_sources, ['owner/dataset']);
  assert.match(metadata.title, /Codex Studio/);

  const noToken = await request(`/api/kaggle/studio/control/${sessionId}`);
  assert.equal(noToken.res.status, 401);
  const queryToken = await request(`/api/kaggle/studio/control/${sessionId}?token=${token}`);
  assert.equal(queryToken.res.status, 401, 'Tokens in query strings must be rejected');

  const ready = await request(`/api/kaggle/studio/callback/${sessionId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'ready', publicUrl: 'https://proof.a.pinggy.link', tunnelProvider: 'pinggy', actualGpu: 'Tesla T4', localUrl: 'http://127.0.0.1:8000' })
  });
  assert.equal(ready.res.status, 200, ready.text);
  assert.equal(ready.body.session.status, 'running');

  const listed = await request('/api/kaggle/studio/sessions', {}, ownerCookie);
  assert.equal(listed.res.status, 200, listed.text);
  assert.equal(listed.body.active.id, sessionId);
  assert.equal(listed.body.active.publicUrl, 'https://proof.a.pinggy.link');

  const backupBytes = Buffer.from('PK\u0003\u0004http-backup-proof');
  const backup = await request(`/api/kaggle/studio/backup/${sessionId}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' }, body: backupBytes
  });
  assert.equal(backup.res.status, 200, backup.text);
  assert.equal(backup.body.bytes, backupBytes.length);
  const backupGet = await fetch(`${base}/api/kaggle/studio/backup/${sessionId}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(backupGet.status, 200);
  assert.deepEqual(Buffer.from(await backupGet.arrayBuffer()), backupBytes);

  const second = await request('/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: `studio_other_${Date.now()}`, password: 'audit_password_123' })
  });
  const otherCookie = second.cookie;
  const hidden = await request(`/api/kaggle/studio/sessions/${sessionId}`, {}, otherCookie);
  assert.equal(hidden.res.status, 404, hidden.text);
  const forbiddenStop = await request(`/api/kaggle/studio/sessions/${sessionId}/stop`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'not-owner' })
  }, otherCookie);
  assert.equal(forbiddenStop.res.status, 404, forbiddenStop.text);

  const stopping = await request(`/api/kaggle/studio/sessions/${sessionId}/stop`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'http_test' })
  }, ownerCookie);
  assert.equal(stopping.res.status, 200, stopping.text);
  assert.equal(stopping.body.session.status, 'stopping');
  const control = await request(`/api/kaggle/studio/control/${sessionId}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(control.body.stopRequested, true);
  assert.equal(control.body.reason, 'http_test');

  const stopped = await request(`/api/kaggle/studio/callback/${sessionId}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'stopped', message: 'done' })
  });
  assert.equal(stopped.body.session.status, 'stopped');

  console.log(JSON.stringify({
    ok: true,
    checked: ['HTTP launch', 'kernel metadata', 'token security', 'callback URL', 'backup roundtrip', 'owner isolation', 'cooperative stop'],
    sessionId,
    jobId
  }, null, 2));
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  fs.rmSync(runtime, { recursive: true, force: true });
}
