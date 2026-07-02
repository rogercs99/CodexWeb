import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('artifacts/perf');
fs.mkdirSync(OUT, { recursive: true });

const files = ['server.js', 'routes/auth.js', 'routes/tokenSaver.js'].filter((file) => fs.existsSync(file));
const routes = [];
const methodPattern = /\bapp\.(get|post|put|patch|delete)\s*\(\s*([^,\n]+)/g;

function stripQuotes(value) {
  const text = String(value || '').trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1);
  }
  return text;
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = methodPattern.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const raw = match[2].trim();
    if (raw.startsWith('[')) {
      const inside = raw.slice(1);
      for (const q of inside.matchAll(/['"]([^'"]+)['"]/g)) {
        routes.push({ method, path: q[1], source: file });
      }
      continue;
    }
    if (raw.startsWith('/') && raw.endsWith('/')) {
      routes.push({ method, path: raw, source: file, regex: true });
      continue;
    }
    routes.push({ method, path: stripQuotes(raw), source: file });
  }
}

const normalized = routes
  .filter((route) => route.path && route.path !== '*' && route.path.startsWith('/'))
  .map((route) => ({ ...route, path: route.path.replace(/\\\//g, '/') }));

const seen = new Set();
const deduped = [];
for (const route of normalized) {
  const key = `${route.method} ${route.path}`;
  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(route);
}

fs.writeFileSync(path.join(OUT, 'route-inventory.json'), JSON.stringify(deduped, null, 2));
let md = `# CodexWeb route inventory\n\nGenerated: ${new Date().toISOString()}\n\n`;
md += '| Method | Path | Source |\n|---|---|---|\n';
for (const route of deduped) md += `| ${route.method} | \`${route.path}\` | ${route.source} |\n`;
fs.writeFileSync(path.join(OUT, 'route-inventory.md'), md);
console.log(JSON.stringify({ ok: true, count: deduped.length, output: 'artifacts/perf/route-inventory.json' }, null, 2));
