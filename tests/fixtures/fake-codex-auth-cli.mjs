#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const home = process.env.CODEX_HOME || process.env.HOME || process.cwd();
const authPath = path.join(home, 'auth.json');
fs.mkdirSync(home, { recursive: true });

function writeAuth(extra = {}) {
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { access_token: 'fake-access', refresh_token: 'fake-refresh' },
    account_id: 'acct-test',
    email: 'test@example.com',
    refreshed_at: new Date().toISOString(),
    ...extra
  }, null, 2));
}

if (args[0] === 'login' && args[1] === 'status') {
  if (fs.existsSync(authPath)) {
    console.log('Logged in using ChatGPT');
    process.exit(0);
  }
  console.error('Not logged in');
  process.exit(1);
} else if (args[0] === 'login' && args[1] === '--device-auth') {
  console.log('Open https://auth.openai.com/device');
  console.log('Enter code TEST-CODE');
  writeAuth();
  console.log('Logged in using ChatGPT');
  process.exit(0);
} else if (args[0] === 'logout') {
  fs.rmSync(authPath, { force: true });
  console.log('Logged out');
  process.exit(0);
} else if (args[0] === 'app-server') {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
      if (!line) continue;
      let request;
      try { request = JSON.parse(line); } catch { continue; }
      if (request.id === 1 && request.method === 'initialize') {
        console.log(JSON.stringify({ id: 1, result: { serverInfo: { name: 'fake-codex' } } }));
      } else if (request.id === 2 && request.method === 'model/list') {
        console.log(JSON.stringify({ id: 2, result: { data: [
          { id: 'gpt-latest-from-cli', priority: 1, hidden: false },
          { id: 'gpt-codex-current', priority: 2, hidden: false },
          { id: 'hidden-model', hidden: true }
        ] } }));
      } else if (request.id === 2 && request.method === 'account/read') {
        if (process.env.FAKE_CODEX_REFRESH_FAIL === '1' || !fs.existsSync(authPath)) {
          console.log(JSON.stringify({ id: 2, error: { code: -32001, message: 'refresh token expired' } }));
        } else {
          writeAuth({ refreshed_by_app_server: true });
          console.log(JSON.stringify({ id: 2, result: { account: { type: 'chatgpt', email: 'test@example.com' } } }));
        }
      }
    }
  });
  process.stdin.resume();
} else {
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'fake response' } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
}
