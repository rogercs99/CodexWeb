import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, 'public');
const clientDir = path.join(__dirname, 'client', 'dist');
const cardsDir = path.join(__dirname, 'cards');
const cardFiles = fs.existsSync(cardsDir)
  ? fs.readdirSync(cardsDir).filter(f => f.match(/\.(png|webp|jpg|jpeg)$/i)).sort()
  : [];
if (cardFiles.length === 0) {
  console.warn(`No se encontraron cartas en ${cardsDir}.`);
}

app.use('/cards', express.static(cardsDir, { maxAge: '7d' }));
// Serve React build first, then legacy static for assets if needed
app.use(express.static(clientDir));
app.use(express.static(publicDir));

// serve SPA fallback
app.get('*', (req, res, next) => {
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    return res.sendFile(path.join(clientDir, 'index.html'));
  }
  return next();
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map();
const ROOMS_FILE = process.env.ROOMS_FILE || path.join(__dirname, 'rooms.json');

const MAX_HAND = 6;
const MIN_PLAYERS = 3;
const BOT_NOUNS = ['sueño', 'isla', 'bosque', 'espejo', 'torre', 'puente', 'luz', 'lluvia', 'silencio', 'laberinto', 'cometa', 'oleaje', 'teatro', 'círculo', 'jardín'];
const BOT_ADJ = ['eterno', 'roto', 'brillante', 'suspendido', 'secreto', 'infinito', 'oculto', 'violeta', 'cálido', 'helado', 'eléctrico', 'sombrío', 'lúcido', 'flotante', 'quieto'];
const BOT_TWIST = ['sin salida', 'que respira', 'invertido', 'que recuerda', 'que canta', 'a contraluz', 'al revés', 'que espera', 'en espiral', 'bajo el agua'];
const BOT_REASONS = [
  'por el tono onírico de la ilustración',
  'porque se ve un personaje que encaja',
  'por el contraste de luces y sombras',
  'porque transmite calma y misterio',
  'por el movimiento que sugiere la imagen',
  'ya que tiene elementos repetidos',
  'por el detalle central destacado',
  'porque parece una escena de teatro',
  'por la geometría que recuerda a un laberinto',
  'por los colores fríos y el ambiente húmedo'
];
const BOT_NAMES = ['Iris', 'Lumen', 'Atlas', 'Vela', 'Echo', 'Nova', 'Pixel', 'Sombra', 'Lago', 'Bruma', 'Cobalto', 'Arcilla', 'Aura', 'Cometa', 'Niebla'];
const BOT_LEVELS = ['easy', 'normal', 'smart'];
const MAX_ROUNDS = 10;
const DRINK_LEVELS = ['light', 'medium', 'heavy'];

// Pseudo-semantic tags to give bots/context more coherent reasons
const CARD_THEMES = ['bosque', 'océano', 'cielo', 'ciudad', 'desierto', 'montaña', 'invierno', 'verano', 'sueño', 'espacio'];
const CARD_MOODS = ['sereno', 'caótico', 'melancólico', 'luminoso', 'oscuro', 'festivo', 'dramático', 'surreal', 'juguetón', 'épico'];
const CARD_ELEMENTS = ['animales', 'personas', 'puentes', 'torres', 'nubes', 'olas', 'escaleras', 'relojes', 'máscaras', 'flores'];
const CARD_COLORS = ['azules', 'dorados', 'rojos', 'violetas', 'verdes', 'cálidos', 'fríos', 'pastel', 'contrastados', 'monocromáticos'];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function getCardTags(card) {
  const base = card ? path.basename(card) : 'card';
  const h = hashString(base);
  return {
    theme: CARD_THEMES[h % CARD_THEMES.length],
    mood: CARD_MOODS[(h >>> 3) % CARD_MOODS.length],
    element: CARD_ELEMENTS[(h >>> 6) % CARD_ELEMENTS.length],
    colors: CARD_COLORS[(h >>> 9) % CARD_COLORS.length],
  };
}

function buildBotClue(tags) {
  const twist = BOT_TWIST[Math.floor(Math.random() * BOT_TWIST.length)];
  const noun = tags.element || 'escena';
  const clue = `${tags.theme} ${tags.mood} ${twist}`;
  const reason = `La carta muestra ${noun} con tonos ${tags.colors}, vibra ${tags.mood} y un fondo que recuerda a ${tags.theme}.`;
  return { clue, reason };
}

function buildDrinkPrompt(tags, level = 'light') {
  const sips = level === 'heavy' ? 3 : level === 'medium' ? 2 : 1;
  const shots = level === 'heavy' ? 1 : 0;
  const templates = [
    `Beben ${sips} sorbo(s) quienes hayan visto ${tags.element} hoy.`,
    `Elige a alguien que se parezca al ambiente ${tags.mood}; esa persona bebe ${sips} y reparte ${sips} más.`,
    `Si has estado en un lugar tipo ${tags.theme}, bebe ${sips}.`,
    `Quien lleve ropa con tonos ${tags.colors} bebe ${sips}.`,
    `El narrador reparte ${sips} sorbo(s) a los que acertaron su carta.`,
    `Si tu carta tenía ${tags.element}, brinda con quien la votó y ambos beben ${sips}.`,
    `Reto rápido: imita el ${tags.mood} de la escena; si el grupo no lo compra, toma ${sips} extra.`,
    shots ? `Todos beben ${shots} chupito si creen que la carta transmite ${tags.theme}.` : `Quien no votó bebe ${sips}.`,
  ];
  return templates[hashString(tags.theme + tags.mood) % templates.length];
}

function roomToJSON(room) {
  return {
    code: room.code,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      ready: p.ready,
      hand: p.hand,
      submittedCardId: p.submittedCardId,
      votedFor: p.votedFor,
      connected: p.connected,
      isBot: p.isBot || false,
      difficulty: p.difficulty || 'normal'
    })),
    order: room.order,
    hostId: room.hostId,
    storytellerId: room.storytellerId,
    phase: room.phase,
    round: room.round,
    clue: room.clue,
    clueReason: room.clueReason,
    submissions: room.submissions,
    shuffledSubmissions: room.shuffledSubmissions,
    votes: room.votes,
    summary: room.summary,
    deck: room.deck,
    discard: room.discard,
    turnSeconds: room.turnSeconds,
    phaseStartedAt: room.phaseStartedAt,
    active: room.active,
    mode: room.mode,
    drinkLevel: room.drinkLevel
  };
}

function saveRooms() {
  const data = Array.from(rooms.values()).map(roomToJSON);
  try {
    fs.mkdirSync(path.dirname(ROOMS_FILE), { recursive: true });
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(data));
  } catch (e) {
    console.error('Error saving rooms', e);
  }
}

function loadRooms() {
  if (!fs.existsSync(ROOMS_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf-8'));
    parsed.forEach(r => {
      const room = {
        ...r,
        players: new Map(),
        mode: r.mode || 'classic',
        drinkLevel: r.drinkLevel || 'light'
      };
      r.players.forEach(p => {
        room.players.set(p.id, { ...p, ws: null });
      });
      rooms.set(room.code, room);
    });
  } catch (e) {
    console.error('Error loading rooms', e);
  }
}

loadRooms();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateRoomCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = Math.floor(Math.random() * 900 + 100);
  const prefix = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  return `${prefix}-${digits}`;
}

function normalizeRoomCode(rawCode) {
  if (!rawCode) return null;
  const compact = rawCode.toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length < 6) return null;
  const letters = compact.slice(0, 3).replace(/[^A-Z]/g, '');
  const digits = compact.slice(3, 6).replace(/[^0-9]/g, '');
  if (letters.length !== 3 || digits.length !== 3) return null;
  return `${letters}-${digits}`;
}

function createRoom(code) {
  let roomCode = code || generateRoomCode();
  while (!code && rooms.has(roomCode)) {
    roomCode = generateRoomCode();
  }
  const room = {
    code: roomCode,
    players: new Map(),
    order: [],
    hostId: null,
    storytellerId: null,
    phase: 'lobby',
    round: 0,
    clue: '',
    clueReason: '',
    submissions: [],
    shuffledSubmissions: [],
    votes: [],
    summary: null,
    deck: shuffle(cardFiles).map(f => `cards/${f}`),
    discard: [],
    turnSeconds: 60,
    phaseStartedAt: Date.now(),
    active: true,
    mode: 'classic',
    drinkLevel: 'light'
  };
  rooms.set(roomCode, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code);
}

function drawCard(room) {
  if (room.deck.length === 0) {
    // recycle discard
    room.deck = shuffle(room.discard);
    room.discard = [];
  }
  return room.deck.pop();
}

function refillHands(room) {
  for (const player of room.players.values()) {
    while (player.hand.length < MAX_HAND) {
      const card = drawCard(room);
      if (!card) break;
      player.hand.push(card);
    }
  }
}

function rotateStoryteller(room) {
  if (room.order.length === 0) return null;
  if (!room.storytellerId) return room.order[0];
  const idx = room.order.indexOf(room.storytellerId);
  return room.order[(idx + 1) % room.order.length];
}

function resetRound(room) {
  room.phase = 'clue';
  room.clue = '';
  room.clueReason = '';
  room.submissions = [];
  room.shuffledSubmissions = [];
  room.votes = [];
  room.summary = null;
  room.storytellerId = rotateStoryteller(room);
  room.round += 1;
  room.phaseStartedAt = Date.now();
  refillHands(room);
  // clear per-player markers
  for (const p of room.players.values()) {
    p.submittedCardId = null;
    p.votedFor = null;
  }
}

function startGame(room) {
  room.round = 0;
  resetRound(room);
  room.phase = 'clue';
  room.phaseStartedAt = Date.now();
}

function ensureBotActions(room) {
  if (room.players.size === 0) return;
  if (!room.storytellerId || !room.players.has(room.storytellerId)) {
    room.storytellerId = rotateStoryteller(room);
  }

  const elapsed = Date.now() - (room.phaseStartedAt || Date.now());
  const expired = elapsed > room.turnSeconds * 1000;

  // storyteller bot submits clue automatically
  const storyteller = room.players.get(room.storytellerId);
  if (room.phase === 'clue' && storyteller?.isBot) {
    const pickCardForClue = () => {
      if (storyteller.hand.length === 0) return null;
      const scores = storyteller.hand.map((c) => {
        const tags = getCardTags(c);
        const entropy = Math.random() * 0.2;
        const thematic = tags.theme.length * 0.01;
        return { card: c, score: thematic + entropy };
      });
      return scores.sort((a, b) => a.score - b.score)[0].card;
    };
    const card = pickCardForClue();
    if (card) {
      storyteller.hand = storyteller.hand.filter(c => c !== card);
      const submissionId = crypto.randomUUID();
      storyteller.submittedCardId = submissionId;
      const tags = getCardTags(card);
      const { clue, reason } = buildBotClue(tags);
      room.clue = clue;
      room.clueReason = reason;
      room.submissions = [{ id: submissionId, playerId: storyteller.id, card }];
      room.shuffledSubmissions = [];
      room.votes = [];
      room.phase = 'submit';
    }
  }

  // bots submit cards in submit phase
  if (room.phase === 'submit') {
    for (const p of room.players.values()) {
      if (p.isBot && p.id !== room.storytellerId && !p.submittedCardId) {
        const card = p.hand[0];
        if (card) {
          p.hand = p.hand.filter(c => c !== card);
          const submissionId = crypto.randomUUID();
          p.submittedCardId = submissionId;
          room.submissions.push({ id: submissionId, playerId: p.id, card });
        }
      }
    }
    const submittedPlayers = room.submissions.length;
    const expected = room.players.size;
    if (submittedPlayers >= expected && expected > 0) {
      room.shuffledSubmissions = shuffle(room.submissions);
      room.phase = 'vote';
      room.phaseStartedAt = Date.now();
      for (const p of room.players.values()) p.votedFor = null;
    }
  }

  // bots vote in vote phase
  if (room.phase === 'vote') {
    for (const p of room.players.values()) {
      if (p.isBot && p.id !== room.storytellerId && !p.votedFor) {
        const choices = room.shuffledSubmissions.filter(s => s.playerId !== p.id);
        let choice = choices[0];
        const clueWords = room.clue.split(/\s+/);
        const scoreCard = (cardPath) => {
          const tags = getCardTags(cardPath);
          const text = `${tags.theme} ${tags.mood} ${tags.element} ${tags.colors}`.toLowerCase();
          const match = clueWords.reduce((acc, w) => acc + (text.includes(w.toLowerCase()) ? 1 : 0), 0);
          return -(match * 2) + Math.random() * 0.2;
        };
        if (p.difficulty === 'easy') {
          choice = choices[Math.floor(Math.random() * choices.length)] || choice;
        } else if (p.difficulty === 'smart' && choices.length > 1) {
          choice = choices.sort((a, b) => scoreCard(a.card) - scoreCard(b.card))[0];
        } else if (choices.length > 1) {
          choice = choices.sort((a, b) => scoreCard(a.card) - scoreCard(b.card))[0];
        }
        if (choice) {
          p.votedFor = choice.id;
          room.votes.push({ playerId: p.id, submissionId: choice.id });
        }
      }
    }
    const votesNeeded = room.players.size - 1;
    if (room.votes.length >= votesNeeded && votesNeeded > 0) {
      computeScores(room);
      room.phase = 'reveal';
      room.phaseStartedAt = Date.now();
      room.discard.push(...room.submissions.map(s => s.card));
      // enrich summary with who voted what for UI
      if (room.summary) {
        room.summary.votesDetail = room.votes.map(v => ({ playerId: v.playerId, submissionId: v.submissionId }));
      }
    }
  }

  // auto-advance on timer expiry
  if (expired) {
    if (room.phase === 'clue' && room.submissions.length === 0) {
      // force bot-like clue for storyteller
      const st = room.players.get(room.storytellerId);
      if (st && st.hand.length > 0) {
        const card = st.hand[0];
        st.hand = st.hand.filter(c => c !== card);
        const submissionId = crypto.randomUUID();
        st.submittedCardId = submissionId;
        const tags = getCardTags(card);
        const { clue, reason } = buildBotClue(tags);
        room.clue = clue;
        room.clueReason = reason;
        room.submissions = [{ id: submissionId, playerId: st.id, card }];
        room.phase = 'submit';
        room.phaseStartedAt = Date.now();
      }
    } else if (room.phase === 'submit') {
      // auto-submit random for pending humans
      for (const p of room.players.values()) {
        if (!p.submittedCardId) {
          const card = p.hand[0];
          if (card) {
            p.hand = p.hand.filter(c => c !== card);
            const submissionId = crypto.randomUUID();
            p.submittedCardId = submissionId;
            room.submissions.push({ id: submissionId, playerId: p.id, card });
          }
        }
      }
      room.shuffledSubmissions = shuffle(room.submissions);
      room.phase = 'vote';
      room.phaseStartedAt = Date.now();
      for (const p of room.players.values()) p.votedFor = null;
    } else if (room.phase === 'vote') {
      for (const p of room.players.values()) {
        if (!p.votedFor) {
          const choices = room.shuffledSubmissions.filter(s => s.playerId !== p.id);
          const choice = choices[Math.floor(Math.random() * choices.length)];
          if (choice) {
            p.votedFor = choice.id;
            room.votes.push({ playerId: p.id, submissionId: choice.id });
          }
        }
      }
      computeScores(room);
      room.phase = 'reveal';
      room.phaseStartedAt = Date.now();
      room.discard.push(...room.submissions.map(s => s.card));
      if (room.summary) {
        room.summary.votesDetail = room.votes.map(v => ({ playerId: v.playerId, submissionId: v.submissionId }));
      }
    }
  }
}

function addPlayer(room, name, ws, difficulty = 'normal') {
  const id = crypto.randomUUID();
  const player = {
    id,
    name: name?.trim() || 'Jugador',
    score: 0,
    ready: false,
    hand: [],
    submittedCardId: null,
    votedFor: null,
    ws,
    connected: true,
    difficulty: BOT_LEVELS.includes(difficulty) ? difficulty : 'normal'
  };
  room.players.set(id, player);
  room.order.push(id);
  if (!room.hostId) room.hostId = id;
  return player;
}

function addBot(room, name = 'Bot', difficulty = 'normal') {
  const id = `bot-${crypto.randomBytes(4).toString('hex')}`;
  const player = {
    id,
    name: `${name} (bot)`,
    score: 0,
    ready: true,
    hand: [],
    submittedCardId: null,
    votedFor: null,
    ws: null,
    connected: false,
    isBot: true,
    difficulty: BOT_LEVELS.includes(difficulty) ? difficulty : 'normal'
  };
  room.players.set(id, player);
  room.order.push(id);
  if (!room.hostId) room.hostId = id;
  return player;
}

function pickNextHost(room) {
  const connected = room.order.find((id) => {
    const candidate = room.players.get(id);
    return candidate && (candidate.connected || candidate.isBot);
  });
  return connected || room.order[0] || null;
}

function removePlayer(room, playerId, reason = 'left') {
  const leaving = room.players.get(playerId);
  if (!leaving) return;

  const removedSubmissions = room.submissions.filter((s) => s.playerId === playerId);
  const removedSubmissionIds = new Set(removedSubmissions.map((s) => s.id));
  if (removedSubmissions.length > 0) {
    room.discard.push(...removedSubmissions.map((s) => s.card));
  }

  room.players.delete(playerId);
  room.order = room.order.filter(id => id !== playerId);
  room.submissions = room.submissions.filter((s) => s.playerId !== playerId);
  room.shuffledSubmissions = room.shuffledSubmissions.filter((s) => s.playerId !== playerId);
  room.votes = room.votes.filter((v) => v.playerId !== playerId && !removedSubmissionIds.has(v.submissionId));

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === playerId || !room.players.has(room.hostId)) {
    room.hostId = pickNextHost(room);
  }
  if (room.storytellerId === playerId || !room.players.has(room.storytellerId)) {
    room.storytellerId = room.order[0] || null;
  }

  if (room.phase !== 'lobby') {
    room.phase = 'lobby';
    room.clue = '';
    room.clueReason = '';
    room.submissions = [];
    room.shuffledSubmissions = [];
    room.votes = [];
    room.summary = {
      message: reason === 'left'
        ? `${leaving.name} salió de la partida. El anfitrión puede reiniciar.`
        : 'Partida pausada por cambios de conexión.'
    };
    room.phaseStartedAt = Date.now();
    for (const p of room.players.values()) {
      p.submittedCardId = null;
      p.votedFor = null;
    }
  }
}

function computeScores(room) {
  const storytellerId = room.storytellerId;
  const totalVoters = room.players.size - 1; // storyteller no vota
  const storytellerSubmission = room.submissions.find(s => s.playerId === storytellerId);
  const votes = room.votes;
  const votesToStoryteller = votes.filter(v => v.submissionId === storytellerSubmission?.id).length;
  const everyoneGuessed = votesToStoryteller === totalVoters;
  const nobodyGuessed = votesToStoryteller === 0;

  const results = [];

  for (const player of room.players.values()) {
    let delta = 0;
    if (player.id === storytellerId) {
      if (!everyoneGuessed && !nobodyGuessed) delta += 3;
    }
    // guessed right
    const votedFor = votes.find(v => v.playerId === player.id)?.submissionId;
    if (votedFor && storytellerSubmission && votedFor === storytellerSubmission.id && player.id !== storytellerId) {
      if (!everyoneGuessed && !nobodyGuessed) delta += 3;
      else delta += 2; // si todos o ninguno acertaron
    }
    // bonus por votos a tu carta (no narrador)
    const votesToPlayerCards = votes.filter(v => {
      const sub = room.submissions.find(s => s.id === v.submissionId);
      return sub && sub.playerId === player.id && player.id !== storytellerId;
    }).length;
    delta += votesToPlayerCards;

    player.score += delta;
    results.push({ playerId: player.id, delta, votesToPlayerCards });
  }

  room.summary = {
    clue: room.clue,
    clueReason: room.clueReason || '',
    storytellerId,
    votes,
    votesDetail: votes.map(v => {
      const submission = room.submissions.find(s => s.id === v.submissionId);
      return { playerId: v.playerId, submissionId: v.submissionId, ownerId: submission?.playerId || null };
    }),
    submissions: room.submissions.map(s => ({ id: s.id, card: s.card, playerId: s.playerId })),
    everyoneGuessed,
    nobodyGuessed,
    results,
    round: room.round
  };
  if (room.mode === 'party') {
    const storytellerCard = room.submissions.find(s => s.playerId === storytellerId)?.card;
    const tags = getCardTags(storytellerCard);
    room.summary.drinkPrompt = buildDrinkPrompt(tags, room.drinkLevel);
    room.summary.tags = tags;
  }
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function toClientState(room, playerId) {
  const player = room.players.get(playerId);
  const isStoryteller = room.storytellerId === playerId;
  const votesCount = room.votes.length;
  const expectedVotes = Math.max(room.players.size - 1, 0);
  const submittedCount = room.submissions.length;
  const expectedSubmissions = Math.max(room.players.size - 1 + 1, 0); // incluyendo narrador

  const state = {
    type: 'state',
    roomCode: room.code,
    mode: room.mode || 'classic',
    drinkLevel: room.drinkLevel || 'light',
    phase: room.phase,
    round: room.round,
    hostId: room.hostId,
    storytellerId: room.storytellerId,
    clue: room.clue,
    you: player ? {
      id: player.id,
      name: player.name,
      isHost: room.hostId === player.id,
      isStoryteller,
      ready: player.ready,
      score: player.score,
      submitted: Boolean(player.submittedCardId),
      votedFor: player.votedFor || null
    } : null,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      ready: p.ready,
      connected: p.connected,
      isHost: room.hostId === p.id,
      isStoryteller: room.storytellerId === p.id
    })),
    counts: {
      submitted: submittedCount,
      expectedSubmissions,
      votes: votesCount,
      expectedVotes
    }
  };

  if (player) state.hand = player.hand;

  state.turnSeconds = room.turnSeconds;
  state.phaseStartedAt = room.phaseStartedAt;


  if (room.phase === 'submit') {
    state.submittedCardId = player?.submittedCardId || null;
  }

  if (room.phase === 'vote') {
    state.board = room.shuffledSubmissions.map(s => ({ id: s.id, card: s.card, isYours: s.playerId === playerId }));
  }

  if (room.phase === 'reveal') {
    state.board = room.shuffledSubmissions.map(s => ({
      id: s.id,
      card: s.card,
      ownerId: s.playerId,
      votes: room.votes.filter(v => v.submissionId === s.id).map(v => v.playerId)
    }));
    state.summary = room.summary;
  }

  if (room.phase === 'lobby') {
    state.canStart = room.players.size >= MIN_PLAYERS;
  }

  return state;
}

function broadcast(room) {
  ensureBotActions(room);
  for (const p of room.players.values()) {
    if (p.ws && p.ws.readyState === p.ws.OPEN) {
      send(p.ws, toClientState(room, p.id));
    }
  }
  saveRooms();
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentPlayerId = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    const type = msg.type;

    if (type === 'join') {
      const name = msg.name?.toString().slice(0, 20) || 'Jugador';
      const requestedCode = msg.roomCode?.toString().trim() || null;
      const code = requestedCode ? normalizeRoomCode(requestedCode) : null;
      if (requestedCode && !code) {
        send(ws, { type: 'error', message: 'Código de sala inválido.' });
        return;
      }
      let room = code ? getRoom(code) : null;
      if (!room) room = createRoom(code);

      // reconnect path
      if (msg.playerId && room.players.has(msg.playerId)) {
        const existing = room.players.get(msg.playerId);
        existing.ws = ws;
        existing.connected = true;
        currentRoom = room;
        currentPlayerId = existing.id;
        send(ws, { type: 'joined', roomCode: room.code, playerId: existing.id });
        broadcast(room);
        return;
      }

      const player = addPlayer(room, name, ws, msg.difficulty || 'normal');
      currentRoom = room;
      currentPlayerId = player.id;
      send(ws, { type: 'joined', roomCode: room.code, playerId: player.id });
      if (room.phase === 'lobby') {
        player.ready = false;
      }
      broadcast(room);
      return;
    }

    if (type === 'end_room') {
      const targetCode = msg.roomCode ? normalizeRoomCode(msg.roomCode) : currentRoom?.code || null;
      const target = targetCode ? rooms.get(targetCode) : null;
      if (!target) {
        send(ws, { type: 'error', message: 'Sala no encontrada.' });
        return;
      }

      const player = currentRoom && currentPlayerId ? currentRoom.players.get(currentPlayerId) : null;
      const canEnd = (player && target.hostId === player.id) || msg.password === 'hola123';
      if (!canEnd) {
        send(ws, { type: 'error', message: 'No autorizado para eliminar la sala.' });
        return;
      }

      target.active = false;
      for (const p of target.players.values()) {
        if (p.ws && p.ws.readyState === p.ws.OPEN) {
          p.ws.send(JSON.stringify({ type: 'ended', roomCode: target.code }));
        }
      }
      rooms.delete(target.code);
      saveRooms();

      if (currentRoom?.code === target.code) {
        currentRoom = null;
        currentPlayerId = null;
      }
      return;
    }

    if (!currentRoom || !currentPlayerId) return;
    const room = currentRoom;
    const player = room.players.get(currentPlayerId);
    if (!player) return;

    switch (type) {
      case 'set_ready': {
        player.ready = Boolean(msg.ready);
        broadcast(room);
        break;
      }
      case 'set_timer': {
        if (player.id !== room.hostId) return;
        const sec = Math.max(15, Math.min(180, Number(msg.seconds) || 60));
        room.turnSeconds = sec;
        broadcast(room);
        break;
      }
      case 'set_mode': {
        if (player.id !== room.hostId) return;
        const mode = msg.mode === 'party' ? 'party' : 'classic';
        const level = DRINK_LEVELS.includes(msg.drinkLevel) ? msg.drinkLevel : room.drinkLevel;
        room.mode = mode;
        room.drinkLevel = level;
        broadcast(room);
        break;
      }
      case 'start': {
        if (player.id !== room.hostId) return;
        if (room.players.size < MIN_PLAYERS) {
          send(ws, { type: 'error', message: 'Se requieren al menos 3 jugadores.' });
          return;
        }
        if (msg.mode) room.mode = msg.mode === 'party' ? 'party' : 'classic';
        if (msg.drinkLevel && DRINK_LEVELS.includes(msg.drinkLevel)) room.drinkLevel = msg.drinkLevel;
        // reset scores
        for (const p of room.players.values()) {
          p.score = 0;
          p.hand = [];
          p.submittedCardId = null;
          p.votedFor = null;
        }
        room.deck = shuffle(cardFiles).map(f => `cards/${f}`);
        room.discard = [];
        room.round = 0;
        room.storytellerId = room.order[0];
        room.phase = 'clue';
        room.phaseStartedAt = Date.now();
        refillHands(room);
        broadcast(room);
        break;
      }
      case 'add_bot': {
        if (player.id !== room.hostId) return;
        const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
        addBot(room, `Bot ${botName}`, msg.difficulty || 'normal');
        refillHands(room);
        broadcast(room);
        break;
      }
      case 'start_with_bots': {
        if (player.id !== room.hostId) return;
        if (msg.mode) room.mode = msg.mode === 'party' ? 'party' : 'classic';
        if (msg.drinkLevel && DRINK_LEVELS.includes(msg.drinkLevel)) room.drinkLevel = msg.drinkLevel;
        while (room.players.size < MIN_PLAYERS) {
          const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
          addBot(room, `Bot ${botName}`, msg.difficulty || 'normal');
        }
        // reset scores and hands
        for (const p of room.players.values()) {
          p.score = 0;
          p.hand = [];
          p.submittedCardId = null;
          p.votedFor = null;
          p.ready = true;
        }
        room.deck = shuffle(cardFiles).map(f => `cards/${f}`);
        room.discard = [];
        room.round = 0;
        room.storytellerId = room.order[0];
        room.phase = 'clue';
        room.phaseStartedAt = Date.now();
        refillHands(room);
        broadcast(room);
        break;
      }
      case 'submit_clue': {
        if (room.phase !== 'clue' || room.storytellerId !== player.id) return;
        const card = msg.card;
        const clue = (msg.clue || '').toString().trim().slice(0, 80);
        if (!card || !player.hand.includes(card) || !clue) return;
        // remove card from hand
        player.hand = player.hand.filter(c => c !== card);
        const submissionId = crypto.randomUUID();
        player.submittedCardId = submissionId;
        room.clue = clue;
        room.submissions = [{ id: submissionId, playerId: player.id, card }];
        room.shuffledSubmissions = [];
        room.votes = [];
        room.phase = 'submit';
        broadcast(room);
        break;
      }
      case 'submit_card': {
        if (room.phase !== 'submit') return;
        if (player.id === room.storytellerId) return;
        if (player.submittedCardId) return;
        const card = msg.card;
        if (!card || !player.hand.includes(card)) return;
        player.hand = player.hand.filter(c => c !== card);
        const submissionId = crypto.randomUUID();
        player.submittedCardId = submissionId;
        room.submissions.push({ id: submissionId, playerId: player.id, card });
        // move to vote if all submitted
        const submittedPlayers = room.submissions.length;
        const expected = room.players.size; // storyteller + resto
        if (submittedPlayers >= expected) {
          room.shuffledSubmissions = shuffle(room.submissions);
          room.phase = 'vote';
          for (const p of room.players.values()) p.votedFor = null;
        }
        broadcast(room);
        break;
      }
      case 'vote': {
        if (room.phase !== 'vote') return;
        if (player.id === room.storytellerId) return;
        if (player.votedFor) return;
        const submissionId = msg.submissionId;
        const submission = room.submissions.find(s => s.id === submissionId);
        if (!submission) return;
        if (submission.playerId === player.id) return; // no votar propia
        player.votedFor = submissionId;
        room.votes.push({ playerId: player.id, submissionId });
        const votesNeeded = room.players.size - 1;
        if (room.votes.length >= votesNeeded) {
          computeScores(room);
          room.phase = 'reveal';
          // submitted cards go to discard
          room.discard.push(...room.submissions.map(s => s.card));
        }
        broadcast(room);
        break;
      }
      case 'next_round': {
        if (room.phase !== 'reveal') return;
        resetRound(room);
        room.phase = 'clue';
        broadcast(room);
        break;
      }
      case 'leave': {
        removePlayer(room, player.id, 'left');
        if (rooms.has(room.code)) {
          broadcast(room);
        }
        currentRoom = null;
        currentPlayerId = null;
        ws.close();
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (currentRoom && currentPlayerId) {
      const room = currentRoom;
      const player = room.players.get(currentPlayerId);
      if (player) {
        player.connected = false;
        player.ws = null;
        if (room.hostId === player.id) {
          room.hostId = pickNextHost(room);
        }
      }
      if (rooms.has(room.code)) {
        broadcast(room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
});

app.get('/api/rooms', (req, res) => {
  const list = Array.from(rooms.values()).filter(r => r.active !== false).map(r => ({
    code: r.code,
    phase: r.phase,
    turnSeconds: r.turnSeconds,
    mode: r.mode || 'classic',
    drinkLevel: r.drinkLevel || 'light',
    players: Array.from(r.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }))
  }));
  res.json(list);
});
