import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3099';
const username = `audit_${Date.now()}`;
const password = 'audit_password_123';
let cookie = '';

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
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

for (const path of ['/api/me', '/api/chat/options', '/api/conversations', '/api/tools/observability', '/']) {
  const r = await request(path);
  assert.ok(r.res.status >= 200 && r.res.status < 400, `${path} -> ${r.res.status}: ${r.text.slice(0, 200)}`);
}

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
assert.ok(events.some((e) => e.event === 'session'), 'missing session event');
assert.ok(events.some((e) => e.event === 'stdout' && e.data?.text?.includes('terminal-live-ok')), 'missing stdout');
const done = events.find((e) => e.event === 'done');
assert.ok(done, 'missing done event');
assert.equal(done.data.ok, true, JSON.stringify(done.data));

console.log(JSON.stringify({ ok: true, username, checked: ['auth', 'core api', 'terminal danger guard', 'terminal SSE'] }, null, 2));
