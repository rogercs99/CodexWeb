import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';

let portCursor = 4500 + Math.floor(Math.random() * 200);
let userCursor = 0;

function nextPort() {
  portCursor += 1;
  return portCursor;
}

function makeUsername(prefix = 'u') {
  userCursor += 1;
  const base = `${prefix}${(Date.now() + userCursor).toString(36)}${userCursor.toString(36)}`;
  return base.slice(0, 20);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = predicate();
    if (result) return result;
    await delay(20);
  }
  throw new Error(`Timeout after ${timeoutMs}ms`);
}

async function startServerProcess({ port, roomsFile, dbPath }) {
  const server = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ROOMS_FILE: roomsFile,
      DIXIT_DB_PATH: dbPath,
      ROOM_DELETE_PASSWORD: 'test-master-pass',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitFor(() => stdout.includes('Servidor listo') || server.exitCode !== null, 7000);
  if (!stdout.includes('Servidor listo')) {
    throw new Error(`Server did not boot correctly.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return {
    port,
    async stop() {
      if (server.exitCode !== null) return;
      server.kill('SIGTERM');
      try {
        await waitFor(() => server.exitCode !== null, 3000);
      } catch {
        server.kill('SIGKILL');
        await waitFor(() => server.exitCode !== null, 3000);
      }
    },
  };
}

async function startServer(t) {
  const port = nextPort();
  const roomsFile = path.join(
    os.tmpdir(),
    `dixit-rooms-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  await fs.writeFile(roomsFile, '[]', 'utf8');
  const dbPath = path.join(
    os.tmpdir(),
    `dixit-db-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  );

  const instance = await startServerProcess({ port, roomsFile, dbPath });

  t.after(async () => {
    await instance.stop();
    await fs.rm(roomsFile, { force: true });
    await fs.rm(dbPath, { force: true });
    await fs.rm(`${dbPath}-wal`, { force: true });
    await fs.rm(`${dbPath}-shm`, { force: true });
  });

  return { port };
}

async function createAuthSession(port, username, displayName = username) {
  const password = 'secret123';
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      password,
      displayName,
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    throw new Error(`Failed to create auth session: ${payload?.error || response.status}`);
  }
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('No auth cookie received');
  }
  return {
    cookie: setCookie.split(';')[0],
    user: payload.user,
  };
}

async function createClient(t, port, cookie) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
  const messages = [];

  ws.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // ignore malformed frames
    }
  });

  await once(ws, 'open');

  t.after(() => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  });

  return {
    ws,
    messages,
    send(payload) {
      ws.send(JSON.stringify(payload));
    },
    latestState() {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].type === 'state') return messages[i];
      }
      return null;
    },
  };
}

async function waitForMessage(client, predicate, label, timeoutMs = 5000) {
  return waitFor(() => {
    const message = client.messages.find(predicate);
    if (message) return message;
    return null;
  }, timeoutMs).catch(() => {
    const last = client.messages.at(-1);
    throw new Error(`Timeout waiting for "${label}". Last message: ${JSON.stringify(last)}`);
  });
}

test('join acepta código sin guion y normaliza al formato AAA-111', async (t) => {
  const { port } = await startServer(t);
  const hostAuth = await createAuthSession(port, makeUsername('host1'), 'Host');
  const host = await createClient(t, port, hostAuth.cookie);
  host.send({ type: 'join', name: 'Host' });

  const hostJoined = await waitForMessage(host, (m) => m.type === 'joined', 'host joined');
  const rawCode = hostJoined.roomCode.replace('-', '');

  const guestAuth = await createAuthSession(port, makeUsername('guest1'), 'Guest');
  const guest = await createClient(t, port, guestAuth.cookie);
  guest.send({ type: 'join', name: 'Guest', roomCode: rawCode });
  const guestJoined = await waitForMessage(guest, (m) => m.type === 'joined', 'guest joined');

  assert.equal(guestJoined.roomCode, hostJoined.roomCode);
  const guestState = await waitForMessage(
    guest,
    (m) => m.type === 'state' && m.players.length === 2,
    'guest state with 2 players'
  );
  assert.equal(guestState.roomCode, hostJoined.roomCode);
});

test('leave elimina al jugador y transfiere host al siguiente conectado', async (t) => {
  const { port } = await startServer(t);
  const hostAuth = await createAuthSession(port, makeUsername('host2'), 'Ana');
  const host = await createClient(t, port, hostAuth.cookie);
  host.send({ type: 'join', name: 'Ana' });
  const joined = await waitForMessage(host, (m) => m.type === 'joined', 'host joined');

  const guestAuth = await createAuthSession(port, makeUsername('guest2'), 'Beto');
  const guest = await createClient(t, port, guestAuth.cookie);
  guest.send({ type: 'join', name: 'Beto', roomCode: joined.roomCode });
  await waitForMessage(guest, (m) => m.type === 'state' && m.players.length === 2, 'guest joined state');

  host.send({ type: 'leave' });

  const guestAfterLeave = await waitForMessage(
    guest,
    (m) => m.type === 'state' && m.players.length === 1,
    'guest sees host removed'
  );

  assert.equal(guestAfterLeave.hostId, guestAfterLeave.you.id);
  assert.equal(guestAfterLeave.players[0].name, 'Beto');
  assert.equal(guestAfterLeave.players[0].connected, true);
});

test('solo el host puede cambiar timer/modo y añadir bots', async (t) => {
  const { port } = await startServer(t);
  const hostAuth = await createAuthSession(port, makeUsername('host3'), 'Host');
  const host = await createClient(t, port, hostAuth.cookie);
  host.send({ type: 'join', name: 'Host' });
  const joined = await waitForMessage(host, (m) => m.type === 'joined', 'host joined');
  await waitForMessage(host, (m) => m.type === 'state', 'host state');

  const guestAuth = await createAuthSession(port, makeUsername('guest3'), 'Guest');
  const guest = await createClient(t, port, guestAuth.cookie);
  guest.send({ type: 'join', name: 'Guest', roomCode: joined.roomCode });
  await waitForMessage(guest, (m) => m.type === 'state' && m.players.length === 2, 'guest state');
  await waitForMessage(host, (m) => m.type === 'state' && m.players.length === 2, 'host sees guest');

  guest.send({ type: 'set_timer', seconds: 20 });
  guest.send({ type: 'set_mode', mode: 'party', drinkLevel: 'heavy' });
  guest.send({ type: 'add_bot' });
  await delay(200);

  const hostBefore = host.latestState();
  assert.equal(hostBefore.turnSeconds, 60);
  assert.equal(hostBefore.mode, 'classic');
  assert.equal(hostBefore.players.length, 2);

  host.send({ type: 'set_timer', seconds: 45 });
  await waitForMessage(host, (m) => m.type === 'state' && m.turnSeconds === 45, 'timer updated');

  host.send({ type: 'set_mode', mode: 'party', drinkLevel: 'heavy' });
  await waitForMessage(
    host,
    (m) => m.type === 'state' && m.mode === 'party' && m.drinkLevel === 'heavy',
    'mode updated'
  );

  host.send({ type: 'add_bot', difficulty: 'smart' });
  const withBot = await waitForMessage(
    host,
    (m) => m.type === 'state' && m.players.length === 3,
    'bot added'
  );
  assert.equal(withBot.players.length, 3);
});

test('solo con bots completa una ronda y permite pasar a la siguiente', async (t) => {
  const { port } = await startServer(t);
  const hostAuth = await createAuthSession(port, makeUsername('host4'), 'Solo');
  const host = await createClient(t, port, hostAuth.cookie);
  host.send({ type: 'join', name: 'Solo' });
  await waitForMessage(host, (m) => m.type === 'joined', 'solo joined');

  host.send({ type: 'start_with_bots', difficulty: 'normal' });
  const roundStart = await waitForMessage(
    host,
    (m) => m.type === 'state' && ['clue', 'submit'].includes(m.phase) && m.hand?.length >= 1,
    'first playable state'
  );

  if (roundStart.phase === 'clue' && roundStart.you?.isStoryteller) {
    host.send({ type: 'submit_clue', clue: 'pista test', card: roundStart.hand[0] });
  } else {
    host.send({ type: 'submit_card', card: roundStart.hand[0] });
    const voteState = await waitForMessage(
      host,
      (m) => m.type === 'state' && m.phase === 'vote' && Array.isArray(m.board) && m.board.length >= 3,
      'vote phase after submit',
      8000
    );
    const choice = voteState.board.find((card) => !card.isYours);
    assert.ok(choice?.id);
    host.send({ type: 'vote', submissionId: choice.id });
  }

  const revealState = await waitForMessage(
    host,
    (m) => m.type === 'state' && m.phase === 'reveal' && m.summary?.results?.length >= 3,
    'reveal phase'
  );
  assert.equal(revealState.summary.votes.length, revealState.players.length - 1);

  host.send({ type: 'next_round' });
  const nextRound = await waitForMessage(
    host,
    (m) => m.type === 'state'
      && m.round === revealState.round + 1
      && m.phase !== 'reveal',
    'next round started'
  );
  assert.ok(['clue', 'submit', 'vote'].includes(nextRound.phase));
});

test('cuando el narrador es bot genera pista realista con motivo y se identifica como bot', async (t) => {
  const { port } = await startServer(t);
  const hostAuth = await createAuthSession(port, makeUsername('host5'), 'Solo');
  const host = await createClient(t, port, hostAuth.cookie);
  host.send({ type: 'join', name: 'Solo' });
  await waitForMessage(host, (m) => m.type === 'joined', 'solo joined');

  host.send({ type: 'start_with_bots', difficulty: 'smart' });
  const botNarratorSubmit = await waitForMessage(
    host,
    (m) => m.type === 'state'
      && m.storytellerId !== m.you?.id
      && typeof m.clue === 'string'
      && m.clue.trim().split(/\s+/).length >= 2
      && m.phase === 'submit'
      && Array.isArray(m.hand)
      && m.hand.length >= 1,
    'bot storyteller submit state',
    8000
  );

  const botNarrator = botNarratorSubmit.players.find((player) => player.id === botNarratorSubmit.storytellerId);
  assert.ok(botNarrator?.isBot);
  assert.ok(botNarratorSubmit.clue.length >= 8);
  assert.notEqual(botNarratorSubmit.clue.toLowerCase(), 'pista test');

  host.send({ type: 'submit_card', card: botNarratorSubmit.hand[0] });
  const voteState = await waitForMessage(
    host,
    (m) => m.type === 'state' && m.phase === 'vote' && Array.isArray(m.board) && m.board.length === 3,
    'bot narrator vote phase'
  );
  const choice = voteState.board.find((card) => !card.isYours);
  assert.ok(choice?.id);
  host.send({ type: 'vote', submissionId: choice.id });

  const botNarratorReveal = await waitForMessage(
    host,
    (m) => m.type === 'state' && m.phase === 'reveal' && m.summary?.storytellerId === botNarratorSubmit.storytellerId,
    'bot narrator reveal'
  );
  assert.ok((botNarratorReveal.summary?.clueReason || '').trim().length >= 20);
});

test('flujo multijugador: start, submit, vote, reveal y rotación de narrador', async (t) => {
  const { port } = await startServer(t);
  const authA = await createAuthSession(port, makeUsername('p6a'), 'A');
  const authB = await createAuthSession(port, makeUsername('p6b'), 'B');
  const authC = await createAuthSession(port, makeUsername('p6c'), 'C');
  const a = await createClient(t, port, authA.cookie);
  a.send({ type: 'join', name: 'A' });
  const joined = await waitForMessage(a, (m) => m.type === 'joined', 'A joined');
  const roomCode = joined.roomCode;

  const b = await createClient(t, port, authB.cookie);
  const c = await createClient(t, port, authC.cookie);
  b.send({ type: 'join', name: 'B', roomCode });
  c.send({ type: 'join', name: 'C', roomCode });

  await waitForMessage(a, (m) => m.type === 'state' && m.players.length === 3, 'A sees 3 players');
  await waitForMessage(b, (m) => m.type === 'state' && m.players.length === 3, 'B sees 3 players');
  await waitForMessage(c, (m) => m.type === 'state' && m.players.length === 3, 'C sees 3 players');

  a.send({ type: 'set_ready', ready: true });
  b.send({ type: 'set_ready', ready: true });
  c.send({ type: 'set_ready', ready: true });
  await waitForMessage(
    a,
    (m) => m.type === 'state' && m.players.filter((player) => player.ready).length === 3,
    'all ready'
  );

  a.send({ type: 'start' });
  const clueA = await waitForMessage(
    a,
    (m) => m.type === 'state' && m.phase === 'clue' && m.hand?.length >= 1,
    'A receives clue state'
  );
  const clueB = await waitForMessage(b, (m) => m.type === 'state' && m.phase === 'clue' && m.hand?.length >= 1, 'B in clue');
  const clueC = await waitForMessage(c, (m) => m.type === 'state' && m.phase === 'clue' && m.hand?.length >= 1, 'C in clue');

  const clueByPlayerId = new Map([
    [clueA.you.id, clueA],
    [clueB.you.id, clueB],
    [clueC.you.id, clueC],
  ]);
  const clientByPlayerId = new Map([
    [clueA.you.id, a],
    [clueB.you.id, b],
    [clueC.you.id, c],
  ]);
  const storytellerId = clueA.storytellerId;
  const storytellerState = clueByPlayerId.get(storytellerId);
  const storytellerClient = clientByPlayerId.get(storytellerId);
  assert.ok(storytellerState?.hand?.length >= 1);
  assert.ok(storytellerClient);

  storytellerClient.send({ type: 'submit_clue', clue: 'misterio', card: storytellerState.hand[0] });

  const nonStorytellerClients = [a, b, c].filter((client) => {
    const lastState = client.latestState();
    return lastState?.you?.id && lastState.you.id !== storytellerId;
  });
  assert.equal(nonStorytellerClients.length, 2);

  const submitStates = await Promise.all(nonStorytellerClients.map((client, idx) => waitForMessage(
    client,
    (m) => m.type === 'state' && m.phase === 'submit' && m.you?.id !== storytellerId && m.hand?.length >= 1,
    `submit phase ${idx + 1}`
  )));

  nonStorytellerClients[0].send({ type: 'submit_card', card: submitStates[0].hand[0] });
  nonStorytellerClients[1].send({ type: 'submit_card', card: submitStates[1].hand[0] });

  const voteStates = await Promise.all(nonStorytellerClients.map((client, idx) => waitForMessage(
    client,
    (m) => m.type === 'state' && m.phase === 'vote' && m.you?.id !== storytellerId && Array.isArray(m.board) && m.board.length === 3,
    `vote phase ${idx + 1}`
  )));

  const choiceB = voteStates[0].board.find((card) => !card.isYours);
  const choiceC = voteStates[1].board.find((card) => !card.isYours);
  assert.ok(choiceB?.id);
  assert.ok(choiceC?.id);

  nonStorytellerClients[0].send({ type: 'vote', submissionId: choiceB.id });
  nonStorytellerClients[1].send({ type: 'vote', submissionId: choiceC.id });

  const revealA = await waitForMessage(
    a,
    (m) => m.type === 'state' && m.phase === 'reveal' && m.summary?.results?.length === 3,
    'A reveal phase'
  );
  assert.equal(revealA.summary.votes.length, 2);

  const revealPlayers = revealA.players.map((p) => p.id);
  const storytellerIndex = revealPlayers.indexOf(revealA.storytellerId);
  const expectedNextStoryteller = revealPlayers[(storytellerIndex + 1) % revealPlayers.length];

  a.send({ type: 'next_round' });
  const nextState = await waitForMessage(
    b,
    (m) => m.type === 'state' && m.round >= revealA.round + 1 && m.storytellerId === expectedNextStoryteller,
    'storyteller rotated'
  );
  assert.equal(nextState.storytellerId, expectedNextStoryteller);
});

test('end_room elimina la sala y notifica a los jugadores', async (t) => {
  const { port } = await startServer(t);
  const hostAuth = await createAuthSession(port, makeUsername('host7'), 'Host');
  const guestAuth = await createAuthSession(port, makeUsername('guest7'), 'Guest');
  const host = await createClient(t, port, hostAuth.cookie);
  host.send({ type: 'join', name: 'Host' });
  const joined = await waitForMessage(host, (m) => m.type === 'joined', 'host joined');

  const guest = await createClient(t, port, guestAuth.cookie);
  guest.send({ type: 'join', name: 'Guest', roomCode: joined.roomCode });
  await waitForMessage(guest, (m) => m.type === 'state' && m.players.length === 2, 'guest joined');

  host.send({ type: 'end_room' });
  await waitForMessage(guest, (m) => m.type === 'ended' && m.roomCode === joined.roomCode, 'ended event');

  const roomsPayload = await fetch(`http://127.0.0.1:${port}/api/rooms`, {
    headers: { Cookie: hostAuth.cookie },
  }).then((response) => response.json());
  assert.equal((roomsPayload.rooms || []).find((room) => room.code === joined.roomCode), undefined);
});

test('end_room desde fuera de la sala funciona con roomCode + password', async (t) => {
  const { port } = await startServer(t);
  const hostAuth = await createAuthSession(port, makeUsername('host8'), 'Host');
  const outsiderAuth = await createAuthSession(port, makeUsername('out8'), 'Outsider');
  const host = await createClient(t, port, hostAuth.cookie);
  host.send({ type: 'join', name: 'Host' });
  const joined = await waitForMessage(host, (m) => m.type === 'joined', 'host joined');

  const outsider = await createClient(t, port, outsiderAuth.cookie);
  outsider.send({ type: 'end_room', roomCode: joined.roomCode, password: 'test-master-pass' });

  await waitForMessage(host, (m) => m.type === 'ended' && m.roomCode === joined.roomCode, 'ended event on host');
  const roomsPayload = await fetch(`http://127.0.0.1:${port}/api/rooms`, {
    headers: { Cookie: hostAuth.cookie },
  }).then((response) => response.json());
  assert.equal((roomsPayload.rooms || []).find((room) => room.code === joined.roomCode), undefined);
});

test('reconexión con playerId recupera el mismo jugador', async (t) => {
  const { port } = await startServer(t);
  const auth = await createAuthSession(port, makeUsername('re9'), 'Reconnect');
  const first = await createClient(t, port, auth.cookie);
  first.send({ type: 'join', name: 'Reconnect' });
  const joined = await waitForMessage(first, (m) => m.type === 'joined', 'first join');
  await waitForMessage(first, (m) => m.type === 'state', 'first state');

  first.ws.close();
  await delay(150);

  const second = await createClient(t, port, auth.cookie);
  second.send({ type: 'join', name: 'Reconnect', roomCode: joined.roomCode });
  const rejoined = await waitForMessage(second, (m) => m.type === 'joined', 'rejoined');
  assert.equal(rejoined.playerId, joined.playerId);

  const rejoinedState = await waitForMessage(
    second,
    (m) => m.type === 'state' && m.you?.id === joined.playerId,
    'rejoined state'
  );
  assert.equal(rejoinedState.you.id, joined.playerId);
});

test('continue repetido no duplica transiciones de fase', async (t) => {
  const { port } = await startServer(t);
  const hostAuth = await createAuthSession(port, makeUsername('cont1'), 'Host');
  const host = await createClient(t, port, hostAuth.cookie);
  host.send({ type: 'join', name: 'Host' });
  await waitForMessage(host, (m) => m.type === 'joined', 'host joined');

  host.send({ type: 'start_with_bots', difficulty: 'normal' });

  let revealState = null;
  for (let step = 0; step < 12; step += 1) {
    const current = host.latestState();
    if (!current) {
      await delay(100);
      continue;
    }
    if (current.phase === 'reveal' && current.summary?.results?.length >= 3) {
      revealState = current;
      break;
    }
    if (current.phase === 'submit' && !current.you?.isStoryteller && !current.you?.submitted && current.hand?.length) {
      host.send({ type: 'submit_card', card: current.hand[0] });
    }
    if (current.phase === 'vote' && !current.you?.isStoryteller && !current.you?.votedFor && Array.isArray(current.board)) {
      const choice = current.board.find((card) => !card.isYours);
      if (choice?.id) host.send({ type: 'vote', submissionId: choice.id });
    }
    await delay(120);
  }

  if (!revealState) {
    revealState = await waitForMessage(
      host,
      (m) => m.type === 'state' && m.phase === 'reveal' && m.summary?.results?.length >= 3,
      'reveal before continue'
    );
  }

  const roundBefore = revealState.round;
  host.send({ type: 'continue' });
  host.send({ type: 'continue' });
  host.send({ type: 'continue' });

  await waitForMessage(
    host,
    (m) => m.type === 'state' && m.round === roundBefore + 1 && m.phase !== 'reveal',
    'single transition to next round'
  );
  await delay(250);
  const finalState = host.latestState();
  assert.equal(finalState.round, roundBefore + 1);
});

test('rehidrata partida activa desde BD tras reinicio de servidor', async (t) => {
  const roomsFile = path.join(
    os.tmpdir(),
    `dixit-rooms-restart-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  const dbPath = path.join(
    os.tmpdir(),
    `dixit-db-restart-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  );
  await fs.writeFile(roomsFile, '[]', 'utf8');

  const firstPort = nextPort();
  const first = await startServerProcess({ port: firstPort, roomsFile, dbPath });
  t.after(async () => {
    await first.stop().catch(() => {});
    await fs.rm(roomsFile, { force: true });
    await fs.rm(dbPath, { force: true });
    await fs.rm(`${dbPath}-wal`, { force: true });
    await fs.rm(`${dbPath}-shm`, { force: true });
  });

  const auth = await createAuthSession(firstPort, makeUsername('rest1'), 'Persist');
  const client1 = await createClient(t, firstPort, auth.cookie);
  client1.send({ type: 'join', name: 'Persist' });
  const joined1 = await waitForMessage(client1, (m) => m.type === 'joined', 'first join');
  await waitForMessage(client1, (m) => m.type === 'state' && m.roomCode === joined1.roomCode, 'first state');

  client1.send({ type: 'start_with_bots', difficulty: 'normal' });
  const started = await waitForMessage(
    client1,
    (m) => m.type === 'state' && ['clue', 'submit', 'vote', 'reveal'].includes(m.phase),
    'state after start'
  );

  await first.stop();

  const secondPort = nextPort();
  const second = await startServerProcess({ port: secondPort, roomsFile, dbPath });
  t.after(async () => {
    await second.stop().catch(() => {});
  });

  const client2 = await createClient(t, secondPort, auth.cookie);
  client2.send({ type: 'join', name: 'Persist', roomCode: joined1.roomCode });
  const joined2 = await waitForMessage(client2, (m) => m.type === 'joined', 'second join');
  assert.equal(joined2.roomCode, joined1.roomCode);

  const stateAfterRestart = await waitForMessage(
    client2,
    (m) => m.type === 'state' && m.roomCode === joined1.roomCode && m.round >= started.round,
    'rehydrated state'
  );
  assert.equal(stateAfterRestart.roomCode, joined1.roomCode);
  assert.ok(['clue', 'submit', 'vote', 'reveal', 'finished'].includes(stateAfterRestart.phase));
});
