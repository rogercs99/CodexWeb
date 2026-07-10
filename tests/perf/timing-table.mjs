import fs from 'node:fs';
import path from 'node:path';
import { startTestServer } from '../helpers/test-server.mjs';

const managed = process.env.BASE_URL ? null : await startTestServer({ prefix: 'codexweb-perf-' });
const BASE = process.env.BASE_URL || managed.baseUrl;
const OUT = path.resolve('artifacts/perf');
fs.mkdirSync(OUT, { recursive: true });
let cookie = '';

async function request(label, url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const started = performance.now();
  const res = await fetch(`${BASE}${url}`, { ...options, headers });
  const text = await res.text();
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(',').map((part) => part.split(';')[0]).join('; ');
  const ms = performance.now() - started;
  if (!res.ok) throw new Error(`${label} ${url} -> ${res.status}: ${text.slice(0, 200)}`);
  return ms;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] || 0;
}
function status(p95) {
  if (p95 <= 100) return 'OK';
  if (p95 <= 300) return 'WATCH';
  return 'SLOW';
}

try {
  await request('register', '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: `perf_${Date.now()}`, password: 'audit_password_123' })
  });

  const targets = [
    { label: 'GET /api/me', run: () => request('me', '/api/me') },
    { label: 'GET /api/chat/options', run: () => request('options', '/api/chat/options') },
    { label: 'GET /api/conversations', run: () => request('conversations', '/api/conversations') },
    { label: 'GET /api/tools/observability', run: () => request('observability', '/api/tools/observability') },
    { label: 'POST /api/tools/terminal-live/stream', run: () => request('terminal', '/api/tools/terminal-live/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: "printf 'timing-ok\\n'", timeoutMs: 10000 }) }) }
  ];

  const rows = [];
  for (const target of targets) {
    const samples = [];
    for (let index = 0; index < 8; index += 1) samples.push(await target.run());
    const median = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const max = Math.max(...samples);
    rows.push({ endpoint: target.label, samples: samples.length, medianMs: Number(median.toFixed(1)), p95Ms: Number(p95.toFixed(1)), maxMs: Number(max.toFixed(1)), status: status(p95) });
  }

  let md = `# CodexWeb timing table\n\nGenerated: ${new Date().toISOString()}\nBase: ${BASE}\nDB/external calls: mocked in sandbox. VPS/pro timings must be measured without mocks, porque si no nos mentimos con bata blanca.\n\n`;
  md += '| Endpoint | Samples | Median ms | P95 ms | Max ms | Status |\n|---|---:|---:|---:|---:|---|\n';
  for (const row of rows) md += `| ${row.endpoint} | ${row.samples} | ${row.medianMs} | ${row.p95Ms} | ${row.maxMs} | ${row.status} |\n`;
  fs.writeFileSync(path.join(OUT, 'timing-table.md'), md);
  fs.writeFileSync(path.join(OUT, 'timing-table.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  console.log(md);
} finally {
  if (managed) await managed.stop();
}
