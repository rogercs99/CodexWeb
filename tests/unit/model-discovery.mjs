import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { CLAUDE_CODE_EVERGREEN_MODELS, extractCodexModelIds, readCodexModelsCache, discoverCodexModelsViaAppServer, discoverClaudeCodeModels, isRecognizedClaudeCodeModel } = require('../../modelDiscovery.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../fixtures/fake-codex-app-server.mjs');
assert.deepEqual(extractCodexModelIds({ result: { data: [
  { model: 'one', hidden: false }, { id: 'two', hidden: false }, { model: 'secret', hidden: true }, { model: 'one' }
] } }), ['one', 'two']);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codexweb-models-'));
try {
  fs.writeFileSync(path.join(tmp, 'models_cache.json'), JSON.stringify({ models: [
    { slug: 'priority-two', priority: 2, visibility: 'list' },
    { slug: 'priority-one', priority: 1, visibility: 'list' },
    { slug: 'hidden-cache', priority: 0, visibility: 'hidden' }
  ] }));
  assert.deepEqual(readCodexModelsCache(tmp), ['priority-one', 'priority-two']);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
const dynamicModels = await discoverCodexModelsViaAppServer({ codexPath: fixture, env: process.env, timeoutMs: 5000 });
assert.deepEqual(dynamicModels, ['latest-codex-test-model', 'second-test-model']);
await assert.rejects(
  discoverCodexModelsViaAppServer({ codexPath: '/bin/echo', env: process.env, timeoutMs: 5000 }),
  /codex_app_server_(pipe_closed|closed_0:)/
);
const claudeModels = await discoverClaudeCodeModels({ apiKey: 'test-key', fetchImpl: async () => ({ ok: true, async json() { return { data: [{ id: 'claude-future-test-model' }, { id: 'not-claude-model' }] }; } }) });
assert.equal(claudeModels[0], CLAUDE_CODE_EVERGREEN_MODELS[0]);
assert.ok(claudeModels.includes('claude-future-test-model'));
assert.ok(isRecognizedClaudeCodeModel('sonnet'));
assert.ok(isRecognizedClaudeCodeModel('claude-future-test-model'));
assert.ok(isRecognizedClaudeCodeModel('anthropic.claude-custom'));
assert.equal(isRecognizedClaudeCodeModel(''), false);
console.log('model-discovery: OK');
