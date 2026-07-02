# CodexWeb audit context

Generated: 2026-07-02

## Goal
Local audit from uploaded `CodexWeb-main 2.zip`: boot the app with external calls mocked, validate backend/frontend/mobile, add repeatable tests, measure timings, reduce obvious runtime/security/performance bugs, and leave a deployable ZIP for VPS/CodexWeb.

## Local sandbox constraints
- GitHub clone/download was unavailable earlier because DNS/network to GitHub failed, so the uploaded ZIP was used as source of truth.
- `better-sqlite3` native binding is mocked in local sandbox tests via `tests/mocks/better-sqlite3-preload.cjs`. On VPS/prod use the real package.
- External CLIs/providers are mocked in tests with `CODEX_CMD=echo`, `GEMINI_CMD=echo`, `CLAUDE_CODE_BIN=echo`, `RCLONE_BIN=/bin/false`.
- Sandbox timings are regression signals, not production capacity numbers. Humanos midiendo física falsa con mocks, precioso pero limitado.

## Fixes applied in the previous prompt
1. `server.js` `/api/tools/terminal-live/stream`
   - Replaced `req.on('close')` cleanup with `res.on('close')` and `res.writableEnded` guard.
   - On child process `close`, only clears timeout instead of calling cleanup that can kill an already-finished process.
2. `stitch_frontend/src/components/SettingsScreen.tsx`
   - Uses `quota.primary.remaining` / `quota.secondary.remaining`, matching backend payload.
3. `stitch_frontend/src/components/TerminalLogScreen.tsx`
   - Types residual cleanup delete history item explicitly as `ResidualCleanupHistoryItem`.
   - Requests directory sizes only when sorting by size.
4. `server.js` storage local list
   - Avoids expensive directory-size calculation by default; only computes sizes when `includeDirSize=1` or sorting by size.
5. `stitch_frontend/src/components/TerminalLivePanel.tsx`
   - Increased bottom padding and moved fixed command composer from `bottom-[74px]` to `bottom-[96px]` to avoid BottomNav overlap.
6. `public/`
   - Rebuilt Vite frontend and copied fresh assets so `public/index.html` references existing JS/CSS bundles.

## Fixes applied in this prompt
1. Terminal dangerous-command guard hardened
   - `rm -fr /`, `sudo rm -fr /`, and `rm -rf --no-preserve-root /` are now blocked before execution, not merely left to GNU rm's failsafe.
   - Added `tests/e2e/security-guards.mjs`.
2. Perf route tooling fixed
   - Added `tests/perf/route-inventory.mjs` to generate `artifacts/perf/route-inventory.json/md` automatically.
   - Updated `tests/perf/safe-get-route-timings.mjs` to skip regex/path-param routes, classify expected 4xx responses as `EXPECTED_*`, and fail on 5xx/fetch errors.
3. Frontend bundle split
   - Added Vite `build.rollupOptions.output.manualChunks` for `vendor-react`, `vendor-icons`, and shared `vendor` chunks.
   - Main JS chunk dropped from ~833 KB to ~452 KB in sandbox build.
4. Service worker fixed for split bundles
   - Bumped cache name to `codexweb-v4-20260702-audit`.
   - Changed asset cache regex from `assets/index-*` only to all hashed JS/CSS assets.
   - Added `tests/frontend/service-worker-cache.mjs`.
5. Mobile bundle test fixed after code-splitting
   - `tests/frontend/mobile-layout-bundle.mjs` now serves built module assets via request interception instead of injecting a module as classic JS.
   - It asserts non-empty rendered UI, no horizontal overflow, and no fixed-element overlap.
6. Dependency audit cleanup
   - Removed unused root dependency `googleapis`.
   - Removed unused frontend dependencies `@google/genai`, `better-sqlite3`, `dotenv`, `express`, and `motion`.
   - Updated lockfiles. Final `npm audit` is 0 vulnerabilities in root and frontend.

## Validation commands used
Start mocked backend in sandbox:

```bash
cd /root/CodexWeb
NODE_OPTIONS="--require=$PWD/tests/mocks/better-sqlite3-preload.cjs" \
PORT=3099 HOST=127.0.0.1 NODE_ENV=test CODEXWEB_ENV=dev \
SESSION_SECRET=test_secret_please_ignore \
ENCRYPTION_SECRET=0123456789abcdef0123456789abcdef \
CODEX_CMD=echo GEMINI_CMD=echo CLAUDE_CODE_BIN=echo RCLONE_BIN=/bin/false \
DB_PATH=/tmp/codexweb-audit.db STATIC_ASSETS_DIR=$PWD/public \
node server.js
```

Build and validate:

```bash
cd /root/CodexWeb/stitch_frontend
npm install
npm run lint
npm run build
cd /root/CodexWeb
rm -rf public/assets
cp -a stitch_frontend/dist/. public/
npm install
npm run test:audit
npm audit
cd stitch_frontend && npm audit
```

## Current test suite
- `npm run test:syntax`
- `npm run test:e2e:local`
- `npm run test:e2e:security`
- `npm run test:frontend:assets`
- `npm run test:frontend:sw`
- `npm run test:frontend:mobile`
- `npm run test:routes`
- `npm run test:perf`
- `npm run test:audit`

## Result files
- `artifacts/screenshots/mobile-home-390x844.png`
- `artifacts/screenshots/mobile-terminal-390x844.png`
- `artifacts/perf/timing-table.md`
- `artifacts/perf/safe-get-route-timings.md`
- `artifacts/perf/route-inventory.md`
- `artifacts/npm-audit-root-all-final.json`
- `artifacts/npm-audit-frontend-all-final.json`

## Latest measured timings in sandbox with mocks
See `artifacts/perf/timing-table.md` and `artifacts/perf/safe-get-route-timings.md`.
Important measured improvement from previous prompt: `/api/tools/storage/local/list` went from about 417 ms to ~3-4 ms when directory sizes are not requested.

Latest main timing table observed:
- `GET /api/me`: median ~2.7 ms, p95 ~5.1 ms.
- `GET /api/chat/options`: median ~2.7 ms, p95 ~3.6 ms.
- `GET /api/conversations`: median ~1.4 ms, p95 ~1.5 ms.
- `GET /api/tools/observability`: median ~25.5 ms, p95 ~32.4 ms.
- `POST /api/tools/terminal-live/stream`: median ~18 ms, p95 ~19.8 ms.

## Notes for VPS/prod
- On VPS/prod, run tests with real `better-sqlite3`, real filesystem, and real CLIs after normal `npm ci` or `npm install`.
- Do not deploy solely from sandbox mock success. Run the same tests on VPS before git commit/push.
- The final ZIP intentionally excludes `node_modules` and `.runtime`; install dependencies on the target machine.
