import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

export async function startTestServer(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || '.');
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix || 'codexweb-test-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const preload = path.join(projectRoot, 'tests', 'mocks', 'better-sqlite3-preload.cjs');
  const fakeKaggleCli = path.join(projectRoot, 'tests', 'fixtures', 'fake-kaggle-cli.sh');
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
      SESSION_SECRET: options.sessionSecret || 'codexweb-test-session',
      ENCRYPTION_SECRET: '0123456789abcdef0123456789abcdef',
      DB_PATH: path.join(runtime, 'test.db'),
      UPLOADS_DIR: path.join(runtime, 'uploads'),
      TASK_SNAPSHOTS_DIR: path.join(runtime, 'snapshots'),
      STORAGE_JOBS_DIR: path.join(runtime, 'storage'),
      STATIC_ASSETS_DIR: path.join(projectRoot, 'public'),
      KAGGLE_STUDIO_RUNTIME_DIR: path.join(runtime, 'studio'),
      KAGGLE_KERNELS_DIR: path.join(runtime, 'kernels'),
      KAGGLE_CLI_PATH: fakeKaggleCli,
      KAGGLE_USERNAME: 'audit',
      KAGGLE_KEY: 'fake-key',
      CODEX_CMD: '/bin/echo',
      GEMINI_CMD: '/bin/echo',
      CLAUDE_CODE_BIN: '/bin/echo',
      NODE_OPTIONS: `--require ${preload}`,
      ...(options.env || {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early (${child.exitCode}):\n${logs.join('').slice(-5000)}`);
    try {
      const response = await fetch(`${baseUrl}/api/me`);
      if (response.ok) break;
    } catch {}
    if (attempt === 99) throw new Error(`Server did not start:\n${logs.join('').slice(-5000)}`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  async function stop() {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
          resolve();
        }, 1500);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    fs.rmSync(runtime, { recursive: true, force: true });
  }

  return { baseUrl, child, runtime, logs, stop };
}
