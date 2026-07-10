import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexweb-kaggle-studio-'));
process.env.KAGGLE_STUDIO_RUNTIME_DIR = runtimeDir;
process.env.KAGGLE_STUDIO_TEMPLATE_PATH = path.resolve('scripts/kaggle_codex_studio_v21.py');

const require = createRequire(import.meta.url);
const kaggleService = require('../../kaggleService.js');
let capturedCode = '';
let capturedOptions = null;
kaggleService.submitJob = async (code, options) => {
  capturedCode = code;
  capturedOptions = options;
  return {
    success: true,
    jobId: 'mock-kernel-123',
    kaggleRef: 'audit/codexweb-mock-kernel-123',
    message: 'mock submitted'
  };
};

const service = require('../../kaggleStudioService.js');

try {
  const sanitized = service.sanitizeStudioOptions({
    gpuPreference: 'P100',
    tunnelProvider: 'PINGGY',
    enableInternet: true,
    persistenceEnabled: true,
    backupIntervalMinutes: 1,
    maxBackupMb: 9999,
    maxParallel: 99,
    datasetSources: ['owner/data', 'invalid source', 'owner/data', 'x/y'],
    title: '  Audit Studio  '
  });
  assert.equal(sanitized.gpuPreference, 'p100');
  assert.equal(sanitized.tunnelProvider, 'pinggy');
  assert.equal(sanitized.backupIntervalMinutes, 3);
  assert.equal(sanitized.maxBackupMb, 1024);
  assert.equal(sanitized.maxParallel, 4);
  assert.deepEqual(sanitized.datasetSources, ['owner/data', 'x/y']);
  assert.equal(sanitized.title, 'Audit Studio');

  const session = await service.startSession({
    ...sanitized,
    publicBaseUrl: 'https://dev.example.test/'
  }, 'https://ignored.example.test', 42);

  assert.equal(session.status, 'queued');
  assert.equal(session.jobId, 'mock-kernel-123');
  assert.equal(session.kaggleRef, 'audit/codexweb-mock-kernel-123');
  assert.equal('ownerUserId' in session, false, 'The browser payload must not expose the internal owner key');
  assert.equal('tokenHash' in session, false, 'The browser payload must never expose the token hash');
  assert.equal(capturedOptions.enableGpu, true);
  assert.equal(capturedOptions.enableInternet, true);
  assert.deepEqual(capturedOptions.datasetSources, ['owner/data', 'x/y']);
  assert.match(capturedCode, /Kaggle Codex Studio v21/);
  assert.match(capturedCode, /CODEXWEB_STUDIO_CALLBACK_URL/);
  assert.match(capturedCode, /CODEXWEB_STUDIO_CONTROL_URL/);
  assert.match(capturedCode, /CODEXWEB_STUDIO_BACKUP_URL/);
  assert.match(capturedCode, /KAGGLE_TUNNEL_PROVIDER[^_]/);
  assert.match(capturedCode, /KAGGLE_TUNNEL_PROVIDER_FORCE.*, os\.environ\.get\(\"KAGGLE_TUNNEL_PROVIDER\", \"auto\"\)/);
  assert.match(capturedCode, /while True:/);
  assert.match(capturedCode, /stopRequested/);
  assert.match(capturedCode, /_cw_backup_workspace/);

  const tokenMatch = capturedCode.match(/os\.environ\["CODEXWEB_STUDIO_TOKEN"\] = "([a-f0-9]+)"/);
  assert.ok(tokenMatch, 'Generated kernel must contain a private callback token');
  const token = tokenMatch[1];

  const ready = service.applyCallback(session.id, token, {
    event: 'ready',
    publicUrl: 'https://demo.a.pinggy.link',
    tunnelProvider: 'pinggy',
    actualGpu: 'Tesla P100-PCIE-16GB',
    localUrl: 'http://127.0.0.1:8000'
  });
  assert.equal(ready.status, 'running');
  assert.equal(ready.publicUrl, 'https://demo.a.pinggy.link');
  assert.equal(ready.actualGpu, 'Tesla P100-PCIE-16GB');
  assert.ok(ready.lastHeartbeatAt);

  assert.throws(() => service.getControl(session.id, 'wrong-token'), /Invalid studio token/);
  const controlBefore = service.getControl(session.id, token);
  assert.equal(controlBefore.stopRequested, false);

  const backupResult = service.saveBackup(session.id, token, Buffer.from('PK\u0003\u0004mock-backup'));
  assert.equal(backupResult.ok, true);
  assert.ok(service.getBackup(session.id, token));

  assert.equal(service.listSessions(999).length, 0, 'A different user must not see this session');
  assert.equal(await service.refreshSession(session.id, 999), null, 'A different user must not read this session');
  assert.equal(service.requestStop(session.id, 'forbidden', 999), null, 'A different user must not stop this session');

  const stopping = service.requestStop(session.id, 'unit_test', 42);
  assert.equal(stopping.status, 'stopping');
  const controlAfter = service.getControl(session.id, token);
  assert.equal(controlAfter.stopRequested, true);
  assert.equal(controlAfter.reason, 'unit_test');

  const stopped = service.applyCallback(session.id, token, { event: 'stopped', message: 'done' });
  assert.equal(stopped.status, 'stopped');
  assert.ok(stopped.stoppedAt);

  console.log(JSON.stringify({
    ok: true,
    sessionId: session.id,
    generatedBytes: Buffer.byteLength(capturedCode),
    datasetSources: capturedOptions.datasetSources,
    callbackLifecycle: ['queued', 'running', 'stopping', 'stopped']
  }, null, 2));
} finally {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
