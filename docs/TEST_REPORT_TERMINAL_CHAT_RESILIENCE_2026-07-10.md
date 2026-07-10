# Test report: terminal/chat resilience

Date: 2026-07-10

## Passed locally
- `node --check server.js`.
- Python compile for `scripts/deferred-dev-restart.py`.
- Shell syntax for `deploy/request-dev-restart.sh` and `deploy/full-deploy-dev.sh`.
- TypeScript `tsc --noEmit`.
- Vite production build and HTTP loading of the compiled frontend.
- Mobile browser run at 390x844 using the real compiled frontend and real Express backend.
- Terminal and chat textareas compute to `16px`; viewport stayed at width `390` and scale `1` before/after focus in the mobile browser run.
- Terminal autoscroll after four result cards: final marker `FIN-4` bottom `619.5px`, fixed composer top `707px`, leaving about `87.5px` visible clearance. This caught and corrected the earlier `scrollIntoView()` implementation, which still placed the marker below the composer.
- Actual `/api/tools/terminal-live/stream` execution with streaming output and successful completion.
- Actual `/api/chat` SSE run against the deterministic fake Codex CLI: first run returned partial output, backend detected `truncated_ellipsis`, launched continuation `1/6`, received a final response, and emitted `done` with `ok=true` and `continuationCount=1`.
- Deferred-restart integration with a temporary SQLite database: helper waited while one `task_runs` row was `running`, proceeded only after it changed to `completed`, and reported the dry-run restart. Elapsed time was about 3.8 seconds.
- A 22.7-second MP4 was recorded from the local mobile browser run showing the compiled UI, terminal focus, autoscroll, the auto-continuation proof, and the deferred-restart proof.

## Test environment
- Frontend: real compiled React/Vite application.
- Backend: real `server.js` Express process.
- Database: test preload used because the sandbox could not build/download the native `better-sqlite3` binary.
- Codex provider: deterministic fake CLI fixture to make the incomplete-output and continuation sequence repeatable.

## Not proven in this sandbox
- Safari's native focus zoom itself was not executed because no iOS/Safari runtime is available. The prevention condition was verified through the computed `16px` input size and stable mobile viewport. Confirm once on the physical iPhone after DEV deployment.
- A live Codex or Claude account was not used because provider credentials are not included in the backup. The real backend orchestration was exercised with the repository's deterministic provider fixture. Confirm both authenticated providers on DEV.
- A real `systemctl restart codexwebdev.service` was intentionally not performed locally. The coordinator was tested in dry-run mode so the sandbox service state was not touched.

## DEV acceptance checks
1. Open Terminal on the iPhone. Execute at least four short commands. The latest result must remain above the composer and bottom navigation.
2. Focus Terminal and Chat textareas. Safari must not zoom.
3. Start a long Codex and Claude chat, background Safari briefly, return, and verify completion without manually sending “sigue”.
4. From a chat, run `deploy/full-deploy-dev.sh`. It must queue the restart, allow that chat to emit its final answer, and restart only after active `task_runs` reach zero.
5. Confirm `systemctl is-active codexwebdev.service`, the public DEV URL, and `.runtime/dev/logs/deferred-restart.log` or transient-unit logs.
