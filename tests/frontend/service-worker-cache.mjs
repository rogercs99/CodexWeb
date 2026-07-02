import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const publicDir = process.env.STATIC_ASSETS_DIR || path.resolve('.runtime/local/public');
const swPath = path.join(publicDir, 'sw.js');
const indexPath = path.join(publicDir, 'index.html');
const sw = fs.readFileSync(swPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const assets = [...index.matchAll(/(?:src|href)=["']\/(assets\/[^"']+\.(?:js|css))["']/g)].map((m) => `/${m[1]}`);
assert.ok(assets.length >= 2, `expected multiple built assets after chunk split, got ${assets.length}`);
assert.match(sw, /codexweb-v\d+-\d{8}/, 'service worker cache name must be versioned');
assert.ok(sw.includes('/\\/assets\\/[A-Za-z0-9_.-]+\\.(js|css)$/'), 'service worker must cache all hashed JS/CSS assets, not just index-*');
assert.equal(sw.includes('/\\/assets\\/index-'), false, 'service worker should not limit cache to index-* assets');
const matcher = /\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/;
for (const asset of assets) assert.equal(matcher.test(asset), true, `asset not covered by service-worker regex: ${asset}`);
console.log(JSON.stringify({ ok: true, checkedAssets: assets }, null, 2));
