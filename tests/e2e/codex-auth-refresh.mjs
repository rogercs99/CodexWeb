import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer } from '../helpers/test-server.mjs';

const external = fs.mkdtempSync(path.join(os.tmpdir(), 'codexweb-auth-e2e-'));
const templateDir = path.join(external, 'template');
const homesRoot = path.join(external, 'homes');
fs.mkdirSync(templateDir, { recursive: true });
fs.writeFileSync(path.join(templateDir, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'seed', refresh_token: 'seed-refresh' }, email: 'seed@example.com' }));
fs.writeFileSync(path.join(templateDir, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'cache-model', priority: 1 }] }));
const fakeCli = path.resolve('tests/fixtures/fake-codex-auth-cli.mjs');
const managed = await startTestServer({
  prefix: 'codexweb-auth-refresh-',
  env: { CODEX_CMD: fakeCli, CODEX_HOME_ROOT: homesRoot, CODEX_AUTH_TEMPLATE_DIR: templateDir }
});

try {
  const registration = await fetch(`${managed.baseUrl}/api/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: `auth_${Date.now()}`, password: 'password_12345' })
  });
  assert.ok([200, 201].includes(registration.status), await registration.text());
  const cookie = (registration.headers.get('set-cookie') || '').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json' };

  const initial = await fetch(`${managed.baseUrl}/api/codex/auth/status`, { headers });
  const initialJson = await initial.json();
  assert.equal(initialJson.auth.loggedIn, true, JSON.stringify(initialJson));

  const modelResponse = await fetch(`${managed.baseUrl}/api/ai/providers/codex-cli/models?refresh=1`, { headers });
  const modelJson = await modelResponse.json();
  assert.equal(modelResponse.status, 200, JSON.stringify(modelJson));
  assert.deepEqual(modelJson.models, ['gpt-latest-from-cli', 'gpt-codex-current']);
  assert.equal(modelJson.metadata.source, 'codex-app-server');

  const refresh = await fetch(`${managed.baseUrl}/api/codex/auth/refresh`, { method: 'POST', headers, body: '{}' });
  const refreshJson = await refresh.json();
  assert.equal(refresh.status, 200, JSON.stringify(refreshJson));
  assert.equal(refreshJson.refreshed, true);
  assert.equal(refreshJson.auth.loggedIn, true);

  const logout = await fetch(`${managed.baseUrl}/api/codex/auth/logout`, { method: 'POST', headers, body: '{}' });
  const logoutJson = await logout.json();
  assert.equal(logout.status, 200, JSON.stringify(logoutJson));
  assert.equal(logoutJson.unlinked, true);
  assert.equal(logoutJson.auth.loggedIn, false);

  const userDirs = fs.readdirSync(homesRoot).filter((name) => name.startsWith('user_'));
  assert.equal(userDirs.length, 1);
  const userHome = path.join(homesRoot, userDirs[0]);
  assert.equal(fs.existsSync(path.join(userHome, 'auth.json')), false, 'auth.json must remain removed after unlink');
  assert.equal(fs.existsSync(path.join(userHome, '.codexweb-auth-unlinked')), true, 'unlink marker missing');

  const statusAfter = await fetch(`${managed.baseUrl}/api/codex/auth/status`, { headers });
  const statusAfterJson = await statusAfter.json();
  assert.equal(statusAfterJson.auth.loggedIn, false, JSON.stringify(statusAfterJson));
  assert.equal(fs.existsSync(path.join(userHome, 'auth.json')), false, 'status check re-seeded auth.json');

  const start = await fetch(`${managed.baseUrl}/api/codex/auth/device/start`, { method: 'POST', headers, body: '{}' });
  assert.equal(start.status, 200, await start.text());
  for (let i = 0; i < 30 && fs.existsSync(path.join(userHome, '.codexweb-auth-unlinked')); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const relinked = await fetch(`${managed.baseUrl}/api/codex/auth/status`, { headers });
  const relinkedJson = await relinked.json();
  assert.equal(relinkedJson.auth.loggedIn, true, JSON.stringify(relinkedJson));
  assert.equal(fs.existsSync(path.join(userHome, '.codexweb-auth-unlinked')), false, 'marker not cleared after successful login');

  console.log(JSON.stringify({ ok: true, models: modelJson.models, lifecycle: ['seeded', 'refreshed', 'unlinked', 'relinked'] }, null, 2));
} finally {
  await managed.stop();
  fs.rmSync(external, { recursive: true, force: true });
}
