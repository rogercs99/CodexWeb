# Safe GET route timings

Generated: 2026-07-02T20:06:14.776Z
Base: http://127.0.0.1:3099
Scope: GET routes without path params. Some endpoints are mocked/empty in sandbox; this is still useful to catch startup/runtime explosions, not to pretend it is production physics.

| Route | Samples | Median ms | Max ms | HTTP | Result |
|---|---:|---:|---:|---:|---|
| `/diag` | 3 | 3.2 | 4.9 | 200 | OK |
| `/d` | 3 | 4 | 4.6 | 200 | OK |
| `/dbg` | 3 | 3.3 | 3.4 | 200 | OK |
| `/sf` | 3 | 3 | 3.3 | 200 | OK |
| `/boot-monitor.js` | 3 | 1.9 | 2.2 | 200 | OK |
| `/sw.js` | 3 | 1.7 | 1.8 | 200 | OK |
| `/manifest.json` | 3 | 1.8 | 2 | 200 | OK |
| `/icon.svg` | 3 | 1.6 | 1.9 | 200 | OK |
| `/` | 3 | 1.7 | 1.8 | 200 | OK |
| `/quetzal-relay` | 3 | 1.8 | 2.5 | 200 | OK |
| `/health` | 3 | 1.5 | 1.5 | 200 | OK |
| `/ok` | 3 | 1.6 | 2 | 200 | OK |
| `/api/health` | 3 | 1.4 | 1.4 | 200 | OK |
| `/api/claude/health` | 3 | 13.9 | 14.7 | 200 | OK |
| `/api/version` | 3 | 1.6 | 1.8 | 200 | OK |
| `/api/frontend/diag-reports/recent` | 3 | 1.4 | 1.5 | 200 | OK |
| `/api/quetzal-relay/status` | 3 | 106.8 | 114.5 | 200 | OK |
| `/api/quetzal-relay/commands` | 3 | 1.9 | 2.2 | 200 | OK |
| `/api/quetzal-relay/diagnostics` | 3 | 113.9 | 117.4 | 200 | OK |
| `/api/workspace/file` | 3 | 1.6 | 1.6 | 400 | EXPECTED_400 |
| `/api/devices/steamdeck/config` | 3 | 1.5 | 1.8 | 200 | OK |
| `/api/devices/steamdeck/jobs` | 3 | 1.5 | 1.5 | 403 | EXPECTED_403 |
| `/api/devices/steamdeck/setup-link` | 3 | 1.5 | 1.7 | 403 | EXPECTED_403 |
| `/api/settings/ai-agents` | 3 | 1.6 | 1.9 | 200 | OK |
| `/api/ai/providers` | 3 | 3.2 | 3.7 | 200 | OK |
| `/api/projects` | 3 | 1.5 | 1.5 | 200 | OK |
| `/api/conversations` | 3 | 1.4 | 1.5 | 200 | OK |
| `/api/chat/options` | 3 | 2.5 | 2.8 | 200 | OK |
| `/api/codex/quota` | 3 | 1.6 | 1.7 | 200 | OK |
| `/api/codex/runs` | 3 | 1.4 | 1.4 | 200 | OK |
| `/api/tasks` | 3 | 1.4 | 1.5 | 200 | OK |
| `/api/tools/search` | 3 | 1.4 | 1.4 | 200 | OK |
| `/api/tools/observability` | 3 | 26.1 | 28.9 | 200 | OK |
| `/api/tools/deployed-apps` | 3 | 2 | 162.2 | 200 | OK |
| `/api/tools/storage/local/list` | 3 | 3.6 | 3.6 | 200 | OK |
| `/api/tools/storage/local/heavy` | 3 | 159.7 | 161 | 200 | OK |
| `/api/tools/storage/overview` | 3 | 17.2 | 18 | 200 | OK |
| `/api/tools/storage/jobs` | 3 | 3 | 4 | 200 | OK |
| `/api/kaggle/jobs` | 3 | 1.5 | 1.6 | 200 | OK |
| `/api/tools/git/repos` | 3 | 2.5 | 2.9 | 200 | OK |
| `/api/codex/auth/status` | 3 | 16.2 | 16.3 | 200 | OK |
| `/api/claude-code/auth/status` | 3 | 14.9 | 16 | 200 | OK |
| `/api/attachments` | 3 | 1.7 | 1.8 | 200 | OK |
| `/api/storage/health` | 3 | 15.9 | 16.3 | 200 | OK |
| `/api/restart/status` | 3 | 1.8 | 1.8 | 200 | OK |
| `/api/me` | 3 | 1.4 | 1.5 | 200 | OK |
| `/api/settings/notifications` | 3 | 1.3 | 1.3 | 200 | OK |
| `/api/token-saver/presets` | 3 | 1.5 | 1.8 | 200 | OK |
| `/api/token-saver/settings` | 3 | 1.8 | 1.9 | 200 | OK |
| `/api/token-saver/settings/effective` | 3 | 1.6 | 1.6 | 200 | OK |
| `/api/token-saver/status` | 3 | 1.4 | 1.7 | 200 | OK |
| `/api/token-saver/usage` | 3 | 1.6 | 1.6 | 200 | OK |
| `/api/projects/recent` | 3 | 1.5 | 1.6 | 200 | OK |
