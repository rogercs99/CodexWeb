import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/test-server.mjs';

const managed = process.env.BASE_URL ? null : await startTestServer({ prefix: 'codexweb-security-' });
const BASE = process.env.BASE_URL || managed.baseUrl;
let cookie = '';

async function request(route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + route, { ...options, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(',').map((part) => part.split(';')[0]).join('; ');
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { res, text, body };
}
function postJson(route, payload) {
  return request(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

try {
  const reg = await postJson('/api/register', { username: `security_${Date.now()}`, password: 'audit_password_123' });
  assert.ok([200, 201].includes(reg.res.status), reg.text);
  assert.ok(cookie.includes('connect.sid'), 'session cookie missing');

  const dangerousCommands = [
    'rm -rf /',
    'rm -fr /',
    'sudo rm -fr /',
    'rm --no-preserve-root -rf /',
    'rm -rf --no-preserve-root /',
    'dd if=/dev/zero of=/dev/sda',
    'mkfs.ext4 /dev/sda1',
    'systemctl stop sshd'
  ];
  for (const command of dangerousCommands) {
    const out = await postJson('/api/tools/terminal-live/stream', { command });
    assert.equal(out.res.status, 409, `${command} was not blocked: ${out.res.status} ${out.text}`);
    assert.equal(out.body?.dangerousDetected, true, `${command} missing dangerousDetected`);
    assert.ok(Array.isArray(out.body?.warnings) && out.body.warnings.length > 0, `${command} missing warnings`);
  }

  const safe = await postJson('/api/tools/terminal-live/stream', { command: "printf 'safe-ok\\n'", timeoutMs: 10000 });
  assert.equal(safe.res.status, 200, safe.text);
  assert.match(safe.text, /safe-ok/);

  console.log(JSON.stringify({ ok: true, checked: dangerousCommands.length, guard: 'terminal dangerous command variants' }, null, 2));
} finally {
  if (managed) await managed.stop();
}
