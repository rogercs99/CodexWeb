import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const OUT = path.resolve('artifacts/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const publicDir = path.resolve('public');
const jsFile = fs.readdirSync(path.join(publicDir, 'assets')).find((f) => /^index-.*\.js$/.test(f));
const cssFile = fs.readdirSync(path.join(publicDir, 'assets')).find((f) => /^index-.*\.css$/.test(f));

function json(body, status = 200) {
  return {
    status,
    headers: {
      'Access-Control-Allow-Origin': 'null',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function mockApi(url, method) {
  const u = new URL(url);
  const p = u.pathname;
  if (method === 'OPTIONS') return json({ ok: true });
  if (p === '/api/me') return json({ authenticated: true, user: { id: 1, username: 'audit' } });
  if (p === '/api/chat/options') return json({
    models: ['gpt-5.5-thinking'],
    reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    defaults: { model: 'gpt-5.5-thinking', reasoningEffort: 'medium' },
    providerId: 'codex-cli', activeAgentId: 'codex-cli', activeAgentName: 'Codex CLI', runtimeProvider: 'codex', capabilities: ['code', 'web'],
    quota: { used: 0, limit: 100, remaining: 100, unit: 'requests', resetAt: null, available: true },
    permissions: { agentId: 'codex-cli', accessMode: 'full_access', allowRoot: true, runAsUser: 'root', allowedPaths: ['/mnt/data/CodexWeb-work/CodexWeb-main'], deniedPaths: [], canWriteFiles: true, readOnly: false, allowShell: true }
  });
  if (p === '/api/conversations') return json({ conversations: [
    { id: 1, title: 'Audit local', model: 'gpt-5.5-thinking', reasoningEffort: 'medium', created_at: new Date().toISOString(), last_message_at: new Date().toISOString() }
  ]});
  if (p === '/api/projects') return json({ projects: [{ id: 1, name: 'CodexWeb', contextMode: 'automatic', autoContextEnabled: true, manualContext: '', generatedContext: 'Proyecto auditado', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), chatCount: 1 }], unassignedCount: 0 });
  if (p === '/api/attachments') return json({ attachments: [] });
  if (p === '/api/codex/runs') return json({ runs: [] });
  if (p === '/api/tasks') return json({ tasks: [] });
  if (p === '/api/settings/notifications') return json({ notifications: { discordWebhookUrl: '', notifyOnFinish: false, includeResult: true } });
  if (p === '/api/codex/quota') return json({ quota: null });
  if (p === '/api/restart/status') return json({ ok: true, restart: { active: false, phase: 'idle' }, pid: 123 });
  if (p === '/api/tools/terminal-live/stream') return {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': 'null', 'Content-Type': 'text/event-stream' },
    body: 'event: session\ndata: {"id":"mock","command":"echo ok"}\n\nevent: stdout\ndata: {"text":"ok\\n"}\n\nevent: done\ndata: {"ok":true,"exitCode":0}\n\n'
  };
  if (p.startsWith('/api/')) return json({ ok: true, conversations: [], projects: [], attachments: [], runs: [], tasks: [] });
  return null;
}

async function snapshot(page, label) {
  await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true });
  return await page.evaluate((label) => {
    const doc = document.documentElement;
    const fixed = [...document.querySelectorAll('*')].map((el) => {
      const style = getComputedStyle(el);
      if (style.position !== 'fixed') return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { tag: el.tagName.toLowerCase(), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, zIndex: style.zIndex };
    }).filter(Boolean);
    const overlaps = [];
    for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i], b = fixed[j];
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (x * y > 800) overlaps.push({ a: a.text || a.tag, b: b.text || b.tag, area: Math.round(x * y) });
    }
    return { label, title: document.title, viewport: { width: innerWidth, height: innerHeight }, scrollWidth: doc.scrollWidth, scrollHeight: doc.scrollHeight, horizontalOverflow: doc.scrollWidth > innerWidth + 2, fixed, overlaps, sample: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400) };
  }, label);
}

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = new URL(req.url());
  const mocked = mockApi(req.url(), req.method());
  if (mocked) return req.respond(mocked).catch(() => {});
  if (url.hostname === 'mock.local') {
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.join(publicDir, pathname.replace(/^\/+/, ''));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.json' ? 'application/json; charset=utf-8' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
      return req.respond({ status: 200, headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(filePath) }).catch(() => {});
    }
  }
  return req.respond({ status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'not found' }).catch(() => {});
});
const browserErrors = [];
page.on('console', (msg) => console.log(`browser:${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => {
  browserErrors.push(err.message);
  console.log(`browser:pageerror: ${err.message}`);
});
await page.setContent(`<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"><base href="http://mock.local/"><title>CodexWeb</title><link rel="stylesheet" href="/assets/${cssFile}"></head><body><div id="root"></div><script type="module" src="/assets/${jsFile}"></script></body></html>`, { waitUntil: 'load' });
await new Promise((resolve) => setTimeout(resolve, 2500));
const home = await snapshot(page, 'mobile-home-390x844');
await page.evaluate(() => {
  const terminalButton = [...document.querySelectorAll('button')].find((button) => /terminal/i.test(button.textContent || ''));
  terminalButton?.click();
});
await new Promise((resolve) => setTimeout(resolve, 1500));
const terminal = await snapshot(page, 'mobile-terminal-390x844');
await browser.close();
assert.equal(browserErrors.length, 0, browserErrors.join('\n'));
assert.match(home.sample, /CodexWeb|Chats|Terminal/i, JSON.stringify(home));
assert.match(terminal.sample, /Terminal|Ejecutar comando/i, JSON.stringify(terminal));
assert.equal(home.horizontalOverflow, false, JSON.stringify(home));
assert.equal(terminal.horizontalOverflow, false, JSON.stringify(terminal));
console.log(JSON.stringify({ ok: true, jsFile, cssFile, screenshots: ['mobile-home-390x844.png', 'mobile-terminal-390x844.png'], home, terminal }, null, 2));
