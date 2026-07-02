import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const publicDir = process.env.STATIC_ASSETS_DIR || path.resolve('.runtime/local/public');
const indexPath = path.join(publicDir, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const refs = [...html.matchAll(/(?:src|href)=["']\/([^"']+)["']/g)]
  .map((m) => m[1])
  .filter((ref) => /\.(js|css|svg|json|png|webp|ico)$/i.test(ref));
const missing = refs.filter((ref) => !fs.existsSync(path.join(publicDir, ref)));
assert.equal(missing.length, 0, `Missing static assets: ${missing.join(', ')}`);
console.log(JSON.stringify({ ok: true, publicDir, checked: refs.length, refs }, null, 2));
