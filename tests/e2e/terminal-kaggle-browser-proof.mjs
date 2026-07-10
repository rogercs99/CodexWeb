import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { startTestServer } from '../helpers/test-server.mjs';

const projectRoot = path.resolve('.');
const publicDir = path.join(projectRoot, 'public');
const outDir = path.resolve(process.env.PROOF_OUT_DIR || 'artifacts/proof');
fs.mkdirSync(outDir, { recursive: true });
const managed = await startTestServer({ prefix: 'codexweb-browser-proof-' });
const { baseUrl, runtime } = managed;
const kernelRoot = path.join(runtime, 'kernels');
let browser;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickExact(page, text) {
  const clicked = await page.evaluate((wanted) => {
    const button = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent || '').trim() === wanted);
    button?.click();
    return Boolean(button);
  }, text);
  assert.equal(clicked, true, `Button not found: ${text}`);
}

async function waitForGeneratedKernel() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(kernelRoot)) {
      const jobs = fs.readdirSync(kernelRoot).filter((entry) => fs.existsSync(path.join(kernelRoot, entry, 'script.py')));
      if (jobs.length > 0) {
        const jobId = jobs.at(-1);
        const scriptPath = path.join(kernelRoot, jobId, 'script.py');
        const script = fs.readFileSync(scriptPath, 'utf8');
        const token = script.match(/os\.environ\["CODEXWEB_STUDIO_TOKEN"\] = "([a-f0-9]+)"/)?.[1];
        const sessionId = script.match(/os\.environ\["CODEXWEB_STUDIO_SESSION_ID"\] = "([^"]+)"/)?.[1];
        if (token && sessionId) return { jobId, token, sessionId };
      }
    }
    await sleep(100);
  }
  throw new Error('Generated Kaggle kernel/token not found');
}

async function snapshot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

try {
  const registrationResponse = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: `browser_proof_${Date.now()}`, password: 'audit_password_123' })
  });
  const registrationText = await registrationResponse.text();
  assert.ok([200, 201].includes(registrationResponse.status), registrationText);
  const sessionCookie = (registrationResponse.headers.get('set-cookie') || '').split(';')[0];
  assert.match(sessionCookie, /connect\.sid=/, 'Server session cookie missing');
  const prefetchedApi = new Map();
  for (const apiPath of [
    '/api/settings/ai-agents',
    '/api/codex/auth/status',
    '/api/codex/quota',
    '/api/settings/notifications',
    '/api/ai/providers',
    '/api/claude-code/auth/status'
  ]) {
    const response = await fetch(`${baseUrl}${apiPath}`, { headers: { cookie: sessionCookie } });
    prefetchedApi.set(apiPath, {
      status: response.status,
      contentType: response.headers.get('content-type') || 'application/json',
      body: Buffer.from(await response.arrayBuffer())
    });
  }

  browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on('pageerror', (error) => { pageErrors.push(error.message); console.error('pageerror:', error.message); });
  page.on('console', (message) => console.log(`browser:${message.type()}: ${message.text()}`));
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      const url = new URL(request.url());
      if (url.hostname !== 'mock.local') {
        await request.abort();
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const corsHeaders = {
          'access-control-allow-origin': 'null',
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'Content-Type, Accept, Authorization',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS'
        };
        if (request.method() === 'OPTIONS') {
          await request.respond({ status: 204, headers: corsHeaders, body: '' });
          return;
        }
        const prefetched = request.method() === 'GET' ? prefetchedApi.get(`${url.pathname}${url.search}`) || prefetchedApi.get(url.pathname) : null;
        if (prefetched) {
          await request.respond({
            status: prefetched.status,
            headers: { 'content-type': prefetched.contentType, 'cache-control': 'no-store', ...corsHeaders },
            body: prefetched.body
          });
          return;
        }
        const requestHeaders = { ...request.headers(), cookie: sessionCookie };
        delete requestHeaders.host;
        delete requestHeaders['content-length'];
        const body = ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postData();
        const upstream = await fetch(`${baseUrl}${url.pathname}${url.search}`, {
          method: request.method(),
          headers: requestHeaders,
          body
        });
        const upstreamBody = Buffer.from(await upstream.arrayBuffer());
        await request.respond({
          status: upstream.status,
          headers: {
            'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
            'cache-control': 'no-store',
            ...corsHeaders
          },
          body: upstreamBody
        });
        return;
      }
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const filePath = path.join(publicDir, relative);
      if (filePath.startsWith(publicDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        await request.respond({ status: 200, headers: { 'content-type': mimeType(filePath), 'cache-control': 'no-store', 'access-control-allow-origin': '*' }, body: fs.readFileSync(filePath) });
        return;
      }
      await request.respond({ status: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' });
    } catch (error) {
      try { await request.respond({ status: 500, body: String(error) }); } catch {}
    }
  });

  const assets = fs.readdirSync(path.join(publicDir, 'assets'));
  const jsFile = assets.find((entry) => /^index-.*\.js$/.test(entry));
  const cssFile = assets.find((entry) => /^index-.*\.css$/.test(entry));
  assert.ok(jsFile && cssFile, 'Built frontend assets missing');
  await page.setContent(`<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><base href="http://mock.local/"><title>CodexWeb Proof</title><link rel="stylesheet" href="/assets/${cssFile}"></head><body><div id="root"></div><script type="module" src="/assets/${jsFile}"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForFunction(() => /Terminal/i.test(document.body.textContent || ''), { timeout: 15000 });
  await snapshot(page, '01-home');

  await clickExact(page, 'Terminal');
  await page.waitForSelector('[data-testid="terminal-command-input"]', { timeout: 10000 });
  await snapshot(page, '02-terminal-ready');
  const input = await page.$('[data-testid="terminal-command-input"]');
  await input.type("printf 'terminal-proof-ok\\n'");
  await input.press('Enter');
  await page.waitForFunction(() => /terminal-proof-ok/i.test(document.body.textContent || '') && /Comando completado/i.test(document.body.textContent || ''), { timeout: 15000 });
  await sleep(400);
  const terminalMetrics = await page.evaluate(() => {
    const composer = document.querySelector('[data-testid="terminal-composer-shell"]')?.getBoundingClientRect();
    const inputRect = document.querySelector('[data-testid="terminal-command-input"]')?.getBoundingClientRect();
    const cards = [...document.querySelectorAll('article')];
    const last = cards.at(-1)?.getBoundingClientRect();
    return {
      inputHeight: inputRect?.height || 0,
      composerTop: composer?.top || 0,
      lastMessageBottom: last?.bottom || 0,
      overlapPx: composer && last ? Math.max(0, last.bottom - composer.top) : null,
      text: (document.body.textContent || '').replace(/\s+/g, ' ').trim()
    };
  });
  assert.match(terminalMetrics.text, /terminal-proof-ok/i);
  assert.match(terminalMetrics.text, /success/i);
  assert.equal(terminalMetrics.overlapPx, 0, JSON.stringify(terminalMetrics));
  assert.ok(terminalMetrics.inputHeight <= 56, JSON.stringify(terminalMetrics));
  await snapshot(page, '03-terminal-success');

  await clickExact(page, 'Kaggle');
  await page.waitForFunction(() => /Remote Execution/i.test(document.body.textContent || ''), { timeout: 10000 });
  await clickExact(page, 'Codex Studio');
  await page.waitForFunction(() => /Lanzar Codex Studio/i.test(document.body.textContent || ''), { timeout: 10000 });
  await snapshot(page, '04-kaggle-config');
  await clickExact(page, 'Lanzar Codex Studio');
  const generated = await waitForGeneratedKernel();
  await page.waitForFunction(() => /Esperando enlace Pinggy/i.test(document.body.textContent || ''), { timeout: 10000 });
  await snapshot(page, '05-kaggle-queued');

  const ready = await fetch(`${baseUrl}/api/kaggle/studio/callback/${generated.sessionId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${generated.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'ready', publicUrl: 'https://codex-studio-proof.a.pinggy.link', tunnelProvider: 'pinggy', actualGpu: 'Tesla T4', localUrl: 'http://127.0.0.1:8000' })
  });
  assert.equal(ready.status, 200, await ready.text());
  await page.waitForFunction(() => /Abrir Studio/i.test(document.body.textContent || '') && /Tesla T4/i.test(document.body.textContent || ''), { timeout: 15000, polling: 250 });
  await snapshot(page, '06-kaggle-running');

  await clickExact(page, 'Parar');
  await page.waitForFunction(() => /Parada solicitada|stopping/i.test(document.body.textContent || ''), { timeout: 10000 });
  await snapshot(page, '07-kaggle-stopping');
  const stopped = await fetch(`${baseUrl}/api/kaggle/studio/callback/${generated.sessionId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${generated.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'stopped', message: 'proof complete' })
  });
  assert.equal(stopped.status, 200, await stopped.text());
  await sleep(4500);
  await snapshot(page, '08-kaggle-stopped');

  await clickExact(page, 'Settings');
  await page.waitForFunction(() => /Integraciones IA/i.test(document.body.textContent || ''), { timeout: 10000 });
  const integrationsClicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /Integraciones IA/i.test(candidate.textContent || ''));
    button?.click();
    return Boolean(button);
  });
  assert.equal(integrationsClicked, true, 'No se encontró el acceso a Integraciones IA');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((candidate) => /Codex/i.test(candidate.textContent || '') && /Ver detalles/i.test(candidate.textContent || '')), { timeout: 10000 });
  const expandedCodex = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => /Codex/i.test(candidate.textContent || '') && /Ver detalles/i.test(candidate.textContent || ''));
    button?.click();
    return Boolean(button);
  });
  assert.equal(expandedCodex, true, 'Codex integration card not found');
  await page.waitForFunction(() => /Renovar token/i.test(document.body.textContent || '') && /Actualizar modelos/i.test(document.body.textContent || ''), { timeout: 10000 });
  const integrationText = await page.evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' ').trim());
  assert.match(integrationText, /Desvincular cuenta/i);
  assert.match(integrationText, /Modelos detectados automáticamente/i);
  await snapshot(page, '09-settings-codex-models-auth');

  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  const result = {
    ok: true,
    terminal: terminalMetrics,
    kaggle: { jobId: generated.jobId, sessionId: generated.sessionId, publicUrl: 'https://codex-studio-proof.a.pinggy.link', actualGpu: 'Tesla T4', lifecycle: ['queued', 'running', 'stopping', 'stopped'], simulatedKaggleCli: true },
    settings: { renewToken: true, unlink: true, dynamicModels: true },
    frames: fs.readdirSync(outDir).filter((entry) => entry.endsWith('.png')).sort()
  };
  fs.writeFileSync(path.join(outDir, 'proof-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await managed.stop();
}
