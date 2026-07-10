#!/usr/bin/env node
import readline from 'node:readline';
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request?.method === 'initialize' && request?.id != null) {
    process.stdout.write(`${JSON.stringify({ id: request.id, result: { codexHome: '/tmp/fake-codex' } })}\n`);
    return;
  }
  if (request?.method === 'model/list' && request?.id != null) {
    process.stdout.write(`${JSON.stringify({ id: request.id, result: { data: [
      { id: 'latest-codex-test-model', model: 'latest-codex-test-model', hidden: false },
      { id: 'hidden-test-model', model: 'hidden-test-model', hidden: true },
      { id: 'second-test-model', model: 'second-test-model', hidden: false }
    ], nextCursor: null } })}\n`);
  }
});
