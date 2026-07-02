import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3099';
const routes = JSON.parse(fs.readFileSync('artifacts/perf/route-inventory.json', 'utf8'));
let cookie = '';
async function req(routePath, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const start = performance.now();
  let status = 0, text = '', error = '';
  try {
    const res = await fetch(BASE + routePath, { ...options, headers, signal: AbortSignal.timeout(8000) });
    status = res.status;
    text = await res.text();
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(',').map((part) => part.split(';')[0]).join('; ');
  } catch (e) { error = e?.message || String(e); }
  return { ms: performance.now() - start, status, error, sample: text.slice(0, 120).replace(/\s+/g, ' ') };
}
await req('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `routes_${Date.now()}`, password: 'audit_password_123' }) });

const skip = new Set(['/__clear-site-data']);
const candidates = routes
  .filter((r) => r.method === 'GET')
  .map((r) => r.path)
  .filter((p, i, arr) => arr.indexOf(p) === i)
  .filter((p) => !p.includes(':') && !p.startsWith('/^') && !skip.has(p));

const rows = [];
for (const p of candidates) {
  const samples = [];
  let last;
  for (let i = 0; i < 3; i++) { last = await req(p); samples.push(last.ms); }
  samples.sort((a, b) => a - b);
  const median = samples[1] ?? samples[0] ?? 0;
  const ok = !last.error && last.status >= 200 && last.status < 500;
  const result = last.error ? last.error : last.status >= 200 && last.status < 400 ? 'OK' : `EXPECTED_${last.status}`;
  rows.push({ path: p, samples: samples.length, medianMs: +median.toFixed(1), maxMs: +Math.max(...samples).toFixed(1), statusCode: last.status, ok, result, error: last.error, sample: last.sample });
}
const out = { generatedAt: new Date().toISOString(), base: BASE, count: rows.length, rows };
fs.writeFileSync('artifacts/perf/safe-get-route-timings.json', JSON.stringify(out, null, 2));
let md = `# Safe GET route timings\n\nGenerated: ${out.generatedAt}\nBase: ${BASE}\nScope: GET routes without path params. Some endpoints are mocked/empty in sandbox; this is still useful to catch startup/runtime explosions, not to pretend it is production physics.\n\n`;
md += '| Route | Samples | Median ms | Max ms | HTTP | Result |\n|---|---:|---:|---:|---:|---|\n';
for (const r of rows) md += `| \`${r.path}\` | ${r.samples} | ${r.medianMs} | ${r.maxMs} | ${r.statusCode || '-'} | ${r.result || (r.ok ? 'OK' : (r.error || 'ERR'))} |\n`;
fs.writeFileSync('artifacts/perf/safe-get-route-timings.md', md);
const failures = rows.filter((row) => row.error || Number(row.statusCode || 0) >= 500);
if (failures.length > 0) {
  throw new Error(`Safe GET route failures: ${JSON.stringify(failures.slice(0, 5))}`);
}

console.log(md);
