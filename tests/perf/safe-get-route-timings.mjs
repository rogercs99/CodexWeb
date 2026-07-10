import fs from 'node:fs';
import { startTestServer } from '../helpers/test-server.mjs';

const managed = process.env.BASE_URL ? null : await startTestServer({ prefix: 'codexweb-routes-' });
const BASE = process.env.BASE_URL || managed.baseUrl;
const routes = JSON.parse(fs.readFileSync('artifacts/perf/route-inventory.json', 'utf8'));
let cookie = '';

async function req(routePath, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const start = performance.now();
  let status = 0;
  let text = '';
  let error = '';
  try {
    const res = await fetch(BASE + routePath, { ...options, headers, signal: AbortSignal.timeout(8000) });
    status = res.status;
    text = await res.text();
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(',').map((part) => part.split(';')[0]).join('; ');
  } catch (caught) {
    error = caught?.message || String(caught);
  }
  return { ms: performance.now() - start, status, error, sample: text.slice(0, 120).replace(/\s+/g, ' ') };
}

try {
  await req('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `routes_${Date.now()}`, password: 'audit_password_123' }) });

  const skip = new Set(['/__clear-site-data', '/api/export/source']);
  const candidates = routes
    .filter((route) => route.method === 'GET')
    .map((route) => route.path)
    .filter((routePath, index, all) => all.indexOf(routePath) === index)
    .filter((routePath) => !routePath.includes(':') && !routePath.startsWith('/^') && !skip.has(routePath));

  const rows = [];
  for (const routePath of candidates) {
    const samples = [];
    let last;
    for (let index = 0; index < 3; index += 1) {
      last = await req(routePath);
      samples.push(last.ms);
    }
    samples.sort((left, right) => left - right);
    const median = samples[1] ?? samples[0] ?? 0;
    const ok = !last.error && last.status >= 200 && last.status < 500;
    const result = last.error ? last.error : last.status >= 200 && last.status < 400 ? 'OK' : `EXPECTED_${last.status}`;
    rows.push({ path: routePath, samples: samples.length, medianMs: +median.toFixed(1), maxMs: +Math.max(...samples).toFixed(1), statusCode: last.status, ok, result, error: last.error, sample: last.sample });
  }
  const out = { generatedAt: new Date().toISOString(), base: BASE, count: rows.length, rows };
  fs.writeFileSync('artifacts/perf/safe-get-route-timings.json', JSON.stringify(out, null, 2));
  let md = `# Safe GET route timings\n\nGenerated: ${out.generatedAt}\nBase: ${BASE}\nScope: GET routes without path params. Some endpoints are mocked/empty in sandbox; this is still useful to catch startup/runtime explosions, not to pretend it is production physics.\n\n`;
  md += '| Route | Samples | Median ms | Max ms | HTTP | Result |\n|---|---:|---:|---:|---:|---|\n';
  for (const row of rows) md += `| \`${row.path}\` | ${row.samples} | ${row.medianMs} | ${row.maxMs} | ${row.statusCode || '-'} | ${row.result || (row.ok ? 'OK' : (row.error || 'ERR'))} |\n`;
  fs.writeFileSync('artifacts/perf/safe-get-route-timings.md', md);
  const failures = rows.filter((row) => row.error || Number(row.statusCode || 0) >= 500);
  if (failures.length > 0) throw new Error(`Safe GET route failures: ${JSON.stringify(failures.slice(0, 5))}`);
  console.log(md);
} finally {
  if (managed) await managed.stop();
}
