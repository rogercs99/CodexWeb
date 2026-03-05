import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';

let portCursor = 4500 + Math.floor(Math.random() * 200);

function nextPort() {
  portCursor += 1;
  return portCursor;
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

async function startServer(t) {
  const port = nextPort();
  const roomsFile = path.join(
    os.tmpdir(),
    `dixit-rooms-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  await fs.writeFile(roomsFile, '[]', 'utf8');

  const server = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ROOMS_FILE: roomsFile,
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

  t.after(async () => {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit').catch(() => {});
    }
    await fs.rm(roomsFile, { force: true });
  });

  return { port };
}

async function createClient(t, port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
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
  const host = await createClient(t, port);
  host.send({ type: 'join', name: 'Host' });

  const hostJoined = await waitForMessage(host, (m) => m.type === 'joined', 'host joined');
  const rawCode = hostJoined.roomCode.replace('-', '');

  const guest = await createClient(t, port);
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
  const host = await createClient(t, port);
  host.send({ type: 'join', name: 'Ana' });
  const joined = await waitForMessage(host, (m) => m.type === 'joined', 'host joined');

  const guest = await createClient(t, port);
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
  const host = await createClient(t, port);
  host.send({ type: 'join', name: 'Host' });
  const joined = await waitForMessage(host, (m) => m.type === 'joined', 'host joined');
  await waitForMessage(host, (m) => m.type === 'state', 'host state');

  const guest = await createClient(t, port);
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
  const host = await createClient(t, port);
  host.send({ type: 'join', name: 'Solo' });
  await waitForMessage(host, (m) => m.type === 'joined', 'solo joined');

  host.send({ type: 'start_with_bots', difficulty: 'normal' });
  const clueState = await waitForMessage(
    host,
    (m) => m.type === 'state' && m.phase === 'clue' && m.you?.isStoryteller === true && m.hand?.length >= 1,
    'clue phase storyteller'
  );

  host.send({ type: 'submit_clue', clue: 'pista test', card: clueState.hand[0] });

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

test('flujo multijugador: start, submit, vote, reveal y rotación de narrador', async (t) => {
  const { port } = await startServer(t);
  const a = await createClient(t, port);
  a.send({ type: 'join', name: 'A' });
  const joined = await waitForMessage(a, (m) => m.type === 'joined', 'A joined');
  const roomCode = joined.roomCode;

  const b = await createClient(t, port);
  const c = await createClient(t, port);
  b.send({ type: 'join', name: 'B', roomCode });
  c.send({ type: 'join', name: 'C', roomCode });

  await waitForMessage(a, (m) => m.type === 'state' && m.players.length === 3, 'A sees 3 players');
  await waitForMessage(b, (m) => m.type === 'state' && m.players.length === 3, 'B sees 3 players');
  await waitForMessage(c, (m) => m.type === 'state' && m.players.length === 3, 'C sees 3 players');

  a.send({ type: 'start' });
  const clueA = await waitForMessage(
    a,
    (m) => m.type === 'state' && m.phase === 'clue' && m.you?.isStoryteller === true && m.hand?.length >= 1,
    'A clue'
  );
  await waitForMessage(b, (m) => m.type === 'state' && m.phase === 'clue', 'B in clue wait');
  await waitForMessage(c, (m) => m.type === 'state' && m.phase === 'clue', 'C in clue wait');

  a.send({ type: 'submit_clue', clue: 'misterio', card: clueA.hand[0] });

  const submitB = await waitForMessage(
    b,
    (m) => m.type === 'state' && m.phase === 'submit' && m.hand?.length >= 1,
    'B submit phase'
  );
  const submitC = await waitForMessage(
    c,
    (m) => m.type === 'state' && m.phase === 'submit' && m.hand?.length >= 1,
    'C submit phase'
  );

  b.send({ type: 'submit_card', card: submitB.hand[0] });
  c.send({ type: 'submit_card', card: submitC.hand[0] });

  const voteB = await waitForMessage(
    b,
    (m) => m.type === 'state' && m.phase === 'vote' && Array.isArray(m.board) && m.board.length === 3,
    'B vote phase'
  );
  const voteC = await waitForMessage(
    c,
    (m) => m.type === 'state' && m.phase === 'vote' && Array.isArray(m.board) && m.board.length === 3,
    'C vote phase'
  );

  const choiceB = voteB.board.find((card) => !card.isYours);
  const choiceC = voteC.board.find((card) => !card.isYours);
  assert.ok(choiceB?.id);
  assert.ok(choiceC?.id);

  b.send({ type: 'vote', submissionId: choiceB.id });
  c.send({ type: 'vote', submissionId: choiceC.id });

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

test('pista por audio: se comparte en salas solo humanas y se bloquea con bots', async (t) => {
  const sampleAudio = 'data:audio/webm;base64,AAAAAA==';

  const { port } = await startServer(t);
  const a = await createClient(t, port);
  a.send({ type: 'join', name: 'A' });
  const joined = await waitForMessage(a, (m) => m.type === 'joined', 'A joined');
  const roomCode = joined.roomCode;

  const b = await createClient(t, port);
  const c = await createClient(t, port);
  b.send({ type: 'join', name: 'B', roomCode });
  c.send({ type: 'join', name: 'C', roomCode });

  await waitForMessage(a, (m) => m.type === 'state' && m.players.length === 3, 'room with 3 humans');
  a.send({ type: 'start' });

  const clueA = await waitForMessage(
    a,
    (m) => m.type === 'state' && m.phase === 'clue' && m.you?.isStoryteller === true && m.hand?.length >= 1,
    'A storyteller clue phase'
  );
  a.send({ type: 'submit_clue', card: clueA.hand[0], clue: '', clueAudio: sampleAudio });

  const submitB = await waitForMessage(
    b,
    (m) => m.type === 'state' && m.phase === 'submit' && typeof m.clueAudio === 'string',
    'B receives submit phase with clue audio'
  );
  assert.equal(submitB.clue, 'Pista por audio');
  assert.equal(submitB.clueAudio, sampleAudio);

  const withBotsHost = await createClient(t, port);
  withBotsHost.send({ type: 'join', name: 'Host2' });
  const withBotsJoined = await waitForMessage(withBotsHost, (m) => m.type === 'joined', 'host2 joined');
  const withBotsCode = withBotsJoined.roomCode;
  const withBotsGuest = await createClient(t, port);
  withBotsGuest.send({ type: 'join', name: 'Guest2', roomCode: withBotsCode });
  await waitForMessage(withBotsHost, (m) => m.type === 'state' && m.players.length === 2, 'room with 2 humans');
  withBotsHost.send({ type: 'add_bot' });
  await waitForMessage(withBotsHost, (m) => m.type === 'state' && m.players.length === 3, 'room with bot');
  withBotsHost.send({ type: 'start' });

  const withBotClue = await waitForMessage(
    withBotsHost,
    (m) => m.type === 'state' && m.phase === 'clue' && m.you?.isStoryteller === true && m.hand?.length >= 1,
    'host2 storyteller clue phase'
  );
  withBotsHost.send({ type: 'submit_clue', card: withBotClue.hand[0], clue: 'texto normal', clueAudio: sampleAudio });

  const withBotSubmit = await waitForMessage(
    withBotsGuest,
    (m) => m.type === 'state' && m.phase === 'submit',
    'guest2 submit phase'
  );
  assert.equal(withBotSubmit.clueAudio, '');
  assert.equal(withBotSubmit.clue, 'Texto normal');
});

test('end_room elimina la sala y notifica a los jugadores', async (t) => {
  const { port } = await startServer(t);
  const host = await createClient(t, port);
  host.send({ type: 'join', name: 'Host' });
  const joined = await waitForMessage(host, (m) => m.type === 'joined', 'host joined');

  const guest = await createClient(t, port);
  guest.send({ type: 'join', name: 'Guest', roomCode: joined.roomCode });
  await waitForMessage(guest, (m) => m.type === 'state' && m.players.length === 2, 'guest joined');

  host.send({ type: 'end_room' });
  await waitForMessage(guest, (m) => m.type === 'ended' && m.roomCode === joined.roomCode, 'ended event');

  const rooms = await fetch(`http://127.0.0.1:${port}/api/rooms`).then((r) => r.json());
  assert.equal(rooms.find((room) => room.code === joined.roomCode), undefined);
});

test('reconexión con playerId recupera el mismo jugador', async (t) => {
  const { port } = await startServer(t);
  const first = await createClient(t, port);
  first.send({ type: 'join', name: 'Reconnect' });
  const joined = await waitForMessage(first, (m) => m.type === 'joined', 'first join');
  await waitForMessage(first, (m) => m.type === 'state', 'first state');

  first.ws.close();
  await delay(150);

  const second = await createClient(t, port);
  second.send({ type: 'join', name: 'Reconnect', roomCode: joined.roomCode, playerId: joined.playerId });
  const rejoined = await waitForMessage(second, (m) => m.type === 'joined', 'rejoined');
  assert.equal(rejoined.playerId, joined.playerId);

  const rejoinedState = await waitForMessage(
    second,
    (m) => m.type === 'state' && m.you?.id === joined.playerId,
    'rejoined state'
  );
  assert.equal(rejoinedState.you.id, joined.playerId);
});

test('narrador bot genera un motivo coherente con la pista', async (t) => {
  const { port } = await startServer(t);
  const host = await createClient(t, port);
  host.send({ type: 'join', name: 'Solo' });
  await waitForMessage(host, (m) => m.type === 'joined', 'host joined');

  host.send({ type: 'start_with_bots', difficulty: 'normal' });
  const humanClueState = await waitForMessage(
    host,
    (m) => m.type === 'state' && m.phase === 'clue' && m.you?.isStoryteller === true && m.hand?.length >= 1,
    'human storyteller clue phase'
  );

  host.send({ type: 'submit_clue', clue: 'pista inicial', card: humanClueState.hand[0] });
  const firstReveal = await waitForMessage(
    host,
    (m) => m.type === 'state' && m.phase === 'reveal' && m.summary?.results?.length >= 3,
    'first reveal'
  );

  host.send({ type: 'next_round' });
  const botSubmitState = await waitForMessage(
    host,
    (m) => m.type === 'state'
      && m.round >= firstReveal.round + 1
      && m.phase === 'submit'
      && m.you?.isStoryteller === false
      && typeof m.clue === 'string'
      && m.clue.length > 0
      && Array.isArray(m.hand)
      && m.hand.length > 0,
    'bot storyteller reason'
  );

  host.send({ type: 'submit_card', card: botSubmitState.hand[0] });
  const botVoteState = await waitForMessage(
    host,
    (m) => m.type === 'state' && m.phase === 'vote' && Array.isArray(m.board) && m.board.length >= 3,
    'bot storyteller vote phase'
  );
  const voteChoice = botVoteState.board.find((card) => !card.isYours);
  assert.ok(voteChoice?.id);
  host.send({ type: 'vote', submissionId: voteChoice.id });

  const botRevealState = await waitForMessage(
    host,
    (m) => m.type === 'state'
      && m.phase === 'reveal'
      && m.round >= firstReveal.round + 1
      && typeof m.summary?.clueReason === 'string'
      && m.summary.clueReason.length > 0,
    'bot storyteller reveal'
  );

  assert.ok(botRevealState.summary.clueReason.includes(`"${botRevealState.summary.clue}"`));
  assert.match(botRevealState.summary.clueReason, /porque mi carta encajaba con/i);
  assert.match(botRevealState.summary.clueReason, /Como iba|Busqu[eé] un punto medio/i);
  assert.match(botRevealState.summary.clueReason, /Intent[eé] que|Buscaba que/i);
});
