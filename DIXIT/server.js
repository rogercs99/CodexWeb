import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DIXIT_DB_PATH || path.join(__dirname, 'dixit.db');
const SESSION_COOKIE_NAME = 'dixit_sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const DEFAULT_POINT_LIMIT = 30;
const MIN_POINT_LIMIT = 10;
const MAX_POINT_LIMIT = 80;
const REVEAL_AUTO_ADVANCE_SECONDS = 12;
const ROOM_TICK_MS = 1000;
const MASTER_DELETE_PASSWORD = String(process.env.ROOM_DELETE_PASSWORD || '').trim();

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  host_id TEXT,
  storyteller_id TEXT,
  phase TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 0,
  clue TEXT NOT NULL DEFAULT '',
  clue_reason TEXT NOT NULL DEFAULT '',
  turn_seconds INTEGER NOT NULL DEFAULT 60,
  phase_started_at INTEGER NOT NULL,
  deadline_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'classic',
  drink_level TEXT NOT NULL DEFAULT 'light',
  point_limit INTEGER NOT NULL DEFAULT ${DEFAULT_POINT_LIMIT},
  finished INTEGER NOT NULL DEFAULT 0,
  winner_ids_json TEXT NOT NULL DEFAULT '[]',
  order_json TEXT NOT NULL DEFAULT '[]',
  deck_json TEXT NOT NULL DEFAULT '[]',
  discard_json TEXT NOT NULL DEFAULT '[]',
  shuffled_submissions_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT,
  bot_brain_json TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_players (
  room_code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  ready INTEGER NOT NULL DEFAULT 0,
  hand_json TEXT NOT NULL DEFAULT '[]',
  submitted_card_id TEXT,
  voted_for TEXT,
  connected INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0,
  difficulty TEXT NOT NULL DEFAULT 'normal',
  persona TEXT,
  joined_at TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(room_code, player_id),
  FOREIGN KEY(room_code) REFERENCES rooms(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_submissions (
  room_code TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  card TEXT NOT NULL,
  PRIMARY KEY(room_code, submission_id),
  FOREIGN KEY(room_code) REFERENCES rooms(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_votes (
  room_code TEXT NOT NULL,
  voter_player_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(room_code, voter_player_id),
  FOREIGN KEY(room_code) REFERENCES rooms(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  round INTEGER NOT NULL,
  phase TEXT NOT NULL,
  storyteller_id TEXT,
  clue TEXT,
  summary_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(room_code) REFERENCES rooms(code) ON DELETE CASCADE
);
`);

const getSessionUserStmt = db.prepare(`
  SELECT u.id, u.username, u.display_name, s.expires_at
  FROM user_sessions s
  INNER JOIN users u ON u.id = s.user_id
  WHERE s.token = ?
`);
const deleteSessionStmt = db.prepare(`DELETE FROM user_sessions WHERE token = ?`);
const insertSessionStmt = db.prepare(`
  INSERT INTO user_sessions (token, user_id, created_at, expires_at)
  VALUES (?, ?, ?, ?)
`);
const getUserByUsernameStmt = db.prepare(`
  SELECT id, username, display_name, password_hash, password_salt
  FROM users
  WHERE username = ?
`);
const getUserByIdStmt = db.prepare(`
  SELECT id, username, display_name
  FROM users
  WHERE id = ?
`);
const insertUserStmt = db.prepare(`
  INSERT INTO users (id, username, display_name, password_hash, password_salt, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function nowIso() {
  return new Date().toISOString();
}

function parseCookies(header = '') {
  if (!header || typeof header !== 'string') return {};
  const out = {};
  for (const pair of header.split(';')) {
    const [rawKey, ...rest] = pair.trim().split('=');
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

function setSessionCookie(res, token, expiresAt) {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = Math.max(0, expiresAt - Date.now());
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAge / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
  };
}

function normalizeUsername(input = '') {
  return String(input || '').trim().toLowerCase();
}

function validateUsername(username) {
  if (!username || username.length < 3 || username.length > 20) {
    throw new Error('El usuario debe tener entre 3 y 20 caracteres.');
  }
  if (!/^[a-z0-9._-]+$/i.test(username)) {
    throw new Error('El usuario solo puede contener letras, números, punto, guion o guion bajo.');
  }
}

function validatePassword(password) {
  if (String(password || '').length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, expectedHashHex, salt) {
  const computed = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = nowIso();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  insertSessionStmt.run(token, userId, createdAt, expiresAt);
  return { token, expiresAt };
}

function getUserBySessionToken(token) {
  if (!token) return null;
  const row = getSessionUserStmt.get(token);
  if (!row) return null;
  if (Number(row.expires_at) <= Date.now()) {
    deleteSessionStmt.run(token);
    return null;
  }
  return toPublicUser(row);
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie || '');
  req.cookies = cookies;
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    const authUser = getUserBySessionToken(token);
    if (authUser) {
      req.authUser = authUser;
      req.authToken = token;
    }
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.authUser || !req.authToken) {
    res.status(401).json({ ok: false, error: 'Autenticación requerida.' });
    return;
  }
  next();
}

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
const playerRoomIndex = new Map();
const roomLocks = new Set();
const ROOMS_FILE = process.env.ROOMS_FILE || path.join(__dirname, 'rooms.json');

const MAX_HAND = 6;
const MIN_PLAYERS = 3;
const BOT_NOUNS = ['sueño', 'isla', 'bosque', 'espejo', 'torre', 'puente', 'luz', 'lluvia', 'silencio', 'laberinto', 'cometa', 'oleaje', 'teatro', 'círculo', 'jardín'];
const BOT_ADJ = ['eterno', 'roto', 'brillante', 'suspendido', 'secreto', 'infinito', 'oculto', 'violeta', 'cálido', 'helado', 'eléctrico', 'sombrío', 'lúcido', 'flotante', 'quieto'];
const BOT_TWIST = ['sin salida', 'que respira', 'invertido', 'que recuerda', 'que canta', 'a contraluz', 'al revés', 'que espera', 'en espiral', 'bajo el agua'];
const BOT_SCENES = ['domingo sin reloj', 'pasillo de museo vacío', 'fiesta que ya terminó', 'cuento antes de dormir', 'fotograma perdido', 'postal sin remitente'];
const BOT_LINKERS = ['entre', 'bajo', 'tras', 'contra', 'sobre'];
const BOT_NAMES = ['Iris', 'Lumen', 'Atlas', 'Vela', 'Echo', 'Nova', 'Pixel', 'Sombra', 'Lago', 'Bruma', 'Cobalto', 'Arcilla', 'Aura', 'Cometa', 'Niebla'];
const BOT_LEVELS = ['easy', 'normal', 'smart'];
const MAX_ROUNDS = 10;
const DRINK_LEVELS = ['light', 'medium', 'heavy'];

// Pseudo-semantic tags to give bots/context more coherent reasons.
const CARD_THEMES = ['bosque', 'océano', 'cielo', 'ciudad', 'desierto', 'montaña', 'invierno', 'verano', 'sueño', 'espacio'];
const CARD_MOODS = ['sereno', 'caótico', 'melancólico', 'luminoso', 'oscuro', 'festivo', 'dramático', 'surreal', 'juguetón', 'épico'];
const CARD_ELEMENTS = ['animales', 'personas', 'puentes', 'torres', 'nubes', 'olas', 'escaleras', 'relojes', 'máscaras', 'flores'];
const CARD_COLORS = ['azules', 'dorados', 'rojos', 'violetas', 'verdes', 'cálidos', 'fríos', 'pastel', 'contrastados', 'monocromáticos'];
const CARD_WEATHER = ['niebla', 'lluvia', 'brisa', 'tormenta', 'sequía', 'rocío', 'viento', 'calma'];
const CARD_LIGHT = ['amanecer', 'mediodía', 'atardecer', 'noche', 'crepúsculo', 'luz de luna'];
const CARD_RHYTHM = ['quieto', 'en fuga', 'suspendido', 'circular', 'frágil', 'eléctrico', 'lento', 'nervioso'];

const BOT_PERSONALITIES = [
  { id: 'poeta', openers: ['huele a', 'me suena a', 'parece un'], cadence: ['a media voz', 'sin avisar', 'como un recuerdo'], riskBias: 0.55 },
  { id: 'cineasta', openers: ['si fuera una película sería', 'fotograma de', 'escena de'], cadence: ['con cámara lenta', 'con zoom al fondo', 'sin diálogo'], riskBias: 0.45 },
  { id: 'narrador', openers: ['me recuerda a', 'es casi', 'diría que es'], cadence: ['al final del cuento', 'justo antes del giro', 'en el capítulo dos'], riskBias: 0.35 },
];
const BOT_PERSONALITY_BY_ID = Object.fromEntries(BOT_PERSONALITIES.map((persona) => [persona.id, persona]));

const BOT_DIFFICULTY_PROFILE = {
  easy: {
    storyTemperature: 1.35,
    submitTemperature: 1.6,
    voteTemperature: 1.5,
    randomSubmitChance: 0.45,
    randomVoteChance: 0.4,
    targetAmbiguity: 0.25,
    desiredLead: 0.42,
    minOwnScore: 0.8,
    decoyThreshold: 0.62,
  },
  normal: {
    storyTemperature: 0.85,
    submitTemperature: 1.0,
    voteTemperature: 0.95,
    randomSubmitChance: 0.14,
    randomVoteChance: 0.18,
    targetAmbiguity: 0.5,
    desiredLead: 0.24,
    minOwnScore: 1.05,
    decoyThreshold: 0.72,
  },
  smart: {
    storyTemperature: 0.45,
    submitTemperature: 0.55,
    voteTemperature: 0.5,
    randomSubmitChance: 0.05,
    randomVoteChance: 0.08,
    targetAmbiguity: 0.65,
    desiredLead: 0.12,
    minOwnScore: 1.15,
    decoyThreshold: 0.78,
  },
};

const BOT_THEME_LEXICON = {
  bosque: ['arboleda', 'raíces', 'hojarasca'],
  océano: ['marea', 'sal', 'profundidad'],
  cielo: ['altura', 'nubes', 'horizonte'],
  ciudad: ['asfalto', 'ventanas', 'semáforo'],
  desierto: ['arena', 'sed', 'duna'],
  montaña: ['cumbre', 'piedra', 'eco'],
  invierno: ['escarcha', 'frío', 'aliento'],
  verano: ['calor', 'siesta', 'sol'],
  sueño: ['insomnio', 'fantasía', 'subconsciente'],
  espacio: ['órbita', 'vacío', 'gravedad'],
};
const BOT_MOOD_LEXICON = {
  sereno: ['calma', 'susurro', 'pausa'],
  caótico: ['ruido', 'choque', 'vértigo'],
  melancólico: ['nostalgia', 'ausencia', 'distancia'],
  luminoso: ['resplandor', 'destello', 'brillo'],
  oscuro: ['sombra', 'noche', 'secreto'],
  festivo: ['baile', 'brindis', 'fuegos'],
  dramático: ['tensión', 'teatro', 'final'],
  surreal: ['extraño', 'imposible', 'onírico'],
  juguetón: ['travieso', 'risa', 'juego'],
  épico: ['hazaña', 'leyenda', 'proeza'],
};
const BOT_ELEMENT_LEXICON = {
  animales: ['bestias', 'plumas', 'huellas'],
  personas: ['rostros', 'miradas', 'sombras humanas'],
  puentes: ['arcos', 'tránsito', 'pasarela'],
  torres: ['altura', 'vigilancia', 'aguja'],
  nubes: ['niebla alta', 'algodón', 'vapor'],
  olas: ['espuma', 'oleaje', 'marejada'],
  escaleras: ['peldaños', 'ascenso', 'bajada'],
  relojes: ['tiempo', 'tic tac', 'minutos'],
  máscaras: ['identidad', 'disfraz', 'teatro'],
  flores: ['pétalos', 'perfume', 'jardín'],
};
const BOT_COLOR_LEXICON = {
  azules: ['azul', 'cobalto', 'ultramar'],
  dorados: ['oro', 'ámbar', 'latón'],
  rojos: ['carmesí', 'granate', 'escarlata'],
  violetas: ['malva', 'lila', 'púrpura'],
  verdes: ['esmeralda', 'musgo', 'jade'],
  cálidos: ['fuego', 'brasas', 'ocre'],
  fríos: ['hielo', 'acero', 'gris'],
  pastel: ['algodón', 'crema', 'tiza'],
  contrastados: ['choque', 'duelo', 'contraluz'],
  monocromáticos: ['sombra única', 'escala', 'tono plano'],
};

const SPANISH_STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'en', 'con',
  'por', 'para', 'del', 'al', 'que', 'se', 'es', 'como', 'sin', 'sobre', 'entre', 'tras',
  'muy', 'más', 'menos', 'mi', 'tu', 'su', 'sus', 'nos', 'os', 'lo', 'le', 'les',
]);

const CARD_PROFILE_CACHE = new Map();

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pickRandom(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] || null;
}

function stripAccents(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeText(value = '') {
  return stripAccents(value.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !SPANISH_STOPWORDS.has(token));
}

function uniqueByNormalized(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }
  return result;
}

function cleanClue(value = '') {
  const compact = value.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!compact) return '';
  return compact.charAt(0).toUpperCase() + compact.slice(1);
}

function singularize(value = '') {
  if (value.endsWith('es')) return value.slice(0, -2);
  if (value.endsWith('s')) return value.slice(0, -1);
  return value;
}

function createBotBrain() {
  return {
    usedClues: [],
    botPersonaById: {},
    recentVotesByOwner: {},
    recentCardsByBot: {},
  };
}

function getBotDifficulty(level = 'normal') {
  return BOT_DIFFICULTY_PROFILE[level] || BOT_DIFFICULTY_PROFILE.normal;
}

function ensureBotBrain(room) {
  if (!room.botBrain || typeof room.botBrain !== 'object') {
    room.botBrain = createBotBrain();
  }
  if (!room.botBrain.usedClues) room.botBrain.usedClues = [];
  if (!room.botBrain.botPersonaById) room.botBrain.botPersonaById = {};
  if (!room.botBrain.recentVotesByOwner) room.botBrain.recentVotesByOwner = {};
  if (!room.botBrain.recentCardsByBot) room.botBrain.recentCardsByBot = {};
  return room.botBrain;
}

function resolveBotPersona(room, player) {
  const brain = ensureBotBrain(room);
  const predefined = player?.persona;
  if (predefined && BOT_PERSONALITY_BY_ID[predefined]) return BOT_PERSONALITY_BY_ID[predefined];

  const current = brain.botPersonaById[player?.id];
  if (current && BOT_PERSONALITY_BY_ID[current]) {
    if (player) player.persona = current;
    return BOT_PERSONALITY_BY_ID[current];
  }

  const index = hashString(`${room.code}:${player?.id || 'bot'}`) % BOT_PERSONALITIES.length;
  const selected = BOT_PERSONALITIES[index];
  brain.botPersonaById[player?.id] = selected.id;
  if (player) player.persona = selected.id;
  return selected;
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

function getCardProfile(card) {
  const key = card || 'card';
  if (CARD_PROFILE_CACHE.has(key)) return CARD_PROFILE_CACHE.get(key);

  const base = card ? path.basename(card) : 'card';
  const h = hashString(base);
  const tags = getCardTags(card);
  const profile = {
    ...tags,
    weather: CARD_WEATHER[(h >>> 12) % CARD_WEATHER.length],
    light: CARD_LIGHT[(h >>> 15) % CARD_LIGHT.length],
    rhythm: CARD_RHYTHM[(h >>> 18) % CARD_RHYTHM.length],
  };

  const concepts = uniqueByNormalized([
    profile.theme,
    profile.mood,
    profile.element,
    singularize(profile.element),
    profile.colors,
    profile.weather,
    profile.light,
    profile.rhythm,
    ...(BOT_THEME_LEXICON[profile.theme] || []),
    ...(BOT_MOOD_LEXICON[profile.mood] || []),
    ...(BOT_ELEMENT_LEXICON[profile.element] || []),
    ...(BOT_COLOR_LEXICON[profile.colors] || []),
  ]);
  const tokens = new Set(concepts.flatMap((concept) => tokenize(concept)));
  const data = { ...profile, concepts, tokens };
  CARD_PROFILE_CACHE.set(key, data);
  return data;
}

function tokenOverlapScore(clueTokens, profileTokens) {
  let total = 0;
  for (const clueToken of clueTokens) {
    if (profileTokens.has(clueToken)) {
      total += 1;
      continue;
    }
    for (const profileToken of profileTokens) {
      if (profileToken.startsWith(clueToken) || clueToken.startsWith(profileToken)) {
        total += 0.55;
        break;
      }
    }
  }
  return total;
}

function scoreCardForClue(clue, cardPath) {
  const clueTokens = tokenize(clue);
  if (clueTokens.length === 0) return 0;
  const profile = getCardProfile(cardPath);
  const overlap = tokenOverlapScore(clueTokens, profile.tokens);
  const normalizedClue = normalizeText(clue);

  let semantic = 0;
  if (normalizedClue.includes(normalizeText(profile.theme))) semantic += 0.45;
  if (normalizedClue.includes(normalizeText(profile.mood))) semantic += 0.4;
  if (normalizedClue.includes(normalizeText(singularize(profile.element)))) semantic += 0.3;

  const lengthFactor = clamp(1 - Math.abs(clueTokens.length - 4) * 0.08, 0.72, 1.08);
  return (overlap + semantic) * lengthFactor;
}

function clueNoveltyPenalty(room, clue) {
  const brain = ensureBotBrain(room);
  const normalized = normalizeText(clue);
  if (!normalized) return 0;
  if (brain.usedClues.includes(normalized)) return 2.4;

  const clueTokens = new Set(tokenize(normalized));
  if (clueTokens.size === 0) return 0;

  let penalty = 0;
  for (let i = brain.usedClues.length - 1, age = 0; i >= 0 && age < 14; i -= 1, age += 1) {
    const prev = brain.usedClues[i];
    const prevTokens = tokenize(prev);
    if (prevTokens.length === 0) continue;
    let shared = 0;
    for (const token of prevTokens) {
      if (clueTokens.has(token)) shared += 1;
    }
    const overlap = shared / Math.max(clueTokens.size, prevTokens.length);
    penalty = Math.max(penalty, overlap * (1 - age * 0.06));
  }
  return penalty;
}

function softmaxPick(items, scoreSelector, temperature = 1) {
  if (!items || items.length === 0) return null;
  const safeTemp = Math.max(0.05, temperature);
  const maxScore = Math.max(...items.map(scoreSelector));

  const weighted = [];
  let total = 0;
  for (const item of items) {
    const score = scoreSelector(item);
    const weight = Math.exp((score - maxScore) / safeTemp);
    total += weight;
    weighted.push({ item, weight });
  }
  if (total <= 0) return items[0];

  let cursor = Math.random() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.item;
  }
  return weighted[weighted.length - 1].item;
}

function buildBotReason(profile, persona, clue) {
  const templates = [
    `La elegí por el contraste ${profile.mood} y el aire de ${profile.theme}; suena clara sin ser obvia.`,
    `Me apoyé en ${profile.element}, tonos ${profile.colors} y ritmo ${profile.rhythm} para dejar una duda razonable.`,
    `La pista "${clue}" apunta a ${profile.theme}, pero también permite que otra carta compita.`,
    `Con estilo ${persona.id}, busqué sugerir ${profile.mood} y ${profile.light} sin regalar la respuesta.`,
  ];
  return pickRandom(templates) || templates[0];
}

function buildBotClueCandidates(room, storyteller, cardPath) {
  const profile = getCardProfile(cardPath);
  const persona = storyteller?.isBot ? resolveBotPersona(room, storyteller) : BOT_PERSONALITIES[2];
  const themeWords = [profile.theme, ...(BOT_THEME_LEXICON[profile.theme] || [])];
  const moodWords = [profile.mood, ...(BOT_MOOD_LEXICON[profile.mood] || [])];
  const elementWords = [singularize(profile.element), ...(BOT_ELEMENT_LEXICON[profile.element] || [])];
  const colorWords = [profile.colors, ...(BOT_COLOR_LEXICON[profile.colors] || [])];
  const opener = pickRandom(persona.openers) || 'me recuerda a';
  const cadence = pickRandom(persona.cadence) || 'sin aviso';
  const noun = pickRandom(BOT_NOUNS) || profile.theme;
  const adj = pickRandom(BOT_ADJ) || profile.mood;
  const twist = pickRandom(BOT_TWIST) || 'a contraluz';
  const scene = pickRandom(BOT_SCENES) || `${profile.light} sin reloj`;
  const anchorTheme = pickRandom(themeWords) || profile.theme;
  const anchorMood = pickRandom(moodWords) || profile.mood;
  const anchorElement = pickRandom(elementWords) || singularize(profile.element);
  const anchorColor = pickRandom(colorWords) || profile.colors;
  const linker = pickRandom(BOT_LINKERS) || 'entre';

  const clues = uniqueByNormalized([
    cleanClue(`${anchorTheme} ${anchorMood} ${twist}`),
    cleanClue(`${opener} ${anchorElement} ${cadence}`),
    cleanClue(`${scene}: ${anchorTheme} ${twist}`),
    cleanClue(`${anchorElement} ${linker} ${anchorMood}`),
    cleanClue(`${anchorColor} y ${anchorMood}`),
    cleanClue(`${noun} ${adj} ${twist}`),
    cleanClue(`${profile.light} ${linker} ${anchorTheme}`),
    cleanClue(`${opener} ${noun} ${pickRandom(['sin mapa', 'en cámara lenta', 'sin final'])}`),
  ]).filter((clue) => clue.length >= 8 && clue.split(' ').length >= 2 && clue.length <= 80);

  if (clues.length === 0) {
    clues.push(cleanClue(`${profile.theme} ${profile.mood} ${twist}`));
  }

  return clues.map((clue) => ({
    clue,
    reason: buildBotReason(profile, persona, clue),
    profile,
  }));
}

function evaluateStoryCandidate(room, storyteller, cardPath, clue, level = 'normal') {
  const config = getBotDifficulty(level);
  const ownScore = scoreCardForClue(clue, cardPath);
  const opponents = Array.from(room.players.values()).filter((player) => player.id !== storyteller.id);

  let bestOpponentScore = -Infinity;
  let strongOpponents = 0;

  for (const opponent of opponents) {
    let bestForOpponent = -Infinity;
    for (const card of opponent.hand || []) {
      bestForOpponent = Math.max(bestForOpponent, scoreCardForClue(clue, card));
    }
    if (bestForOpponent !== -Infinity) {
      bestOpponentScore = Math.max(bestOpponentScore, bestForOpponent);
      if (bestForOpponent >= ownScore * config.decoyThreshold) {
        strongOpponents += 1;
      }
    }
  }
  if (bestOpponentScore === -Infinity) bestOpponentScore = 0;

  const targetAmbiguity = clamp(
    Math.round(opponents.length * config.targetAmbiguity),
    opponents.length > 1 ? 1 : 0,
    Math.max(opponents.length - 1, 0),
  );
  const ambiguityPenalty = Math.abs(strongOpponents - targetAmbiguity) * 1.25;

  const lead = ownScore - bestOpponentScore;
  const leadPenalty = Math.abs(lead - config.desiredLead) * 1.85;

  const noveltyPenalty = clueNoveltyPenalty(room, clue);
  const clarityPenalty = ownScore < config.minOwnScore ? (config.minOwnScore - ownScore) * 2.3 : 0;

  const wordCount = tokenize(clue).length;
  let naturalBonus = 0.15;
  if (wordCount >= 2 && wordCount <= 6) naturalBonus += 0.35;
  if (clue.length >= 12 && clue.length <= 46) naturalBonus += 0.2;

  const quality = ownScore * 2.2
    - ambiguityPenalty
    - leadPenalty
    - noveltyPenalty
    - clarityPenalty
    + naturalBonus
    + Math.random() * 0.04;

  return { quality };
}

function selectStorytellerPlan(room, storyteller, level = storyteller?.difficulty || 'normal') {
  if (!storyteller || !Array.isArray(storyteller.hand) || storyteller.hand.length === 0) return null;

  const options = [];
  for (const card of storyteller.hand) {
    const candidates = buildBotClueCandidates(room, storyteller, card);
    for (const candidate of candidates) {
      const { quality } = evaluateStoryCandidate(room, storyteller, card, candidate.clue, level);
      options.push({
        card,
        clue: candidate.clue,
        reason: candidate.reason,
        quality,
      });
    }
  }
  if (options.length === 0) return null;

  const config = getBotDifficulty(level);
  const shortlist = options
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 8);
  return softmaxPick(shortlist, (option) => option.quality, config.storyTemperature) || shortlist[0];
}

function chooseBotSubmissionCard(room, bot, level = bot?.difficulty || 'normal') {
  if (!bot || !Array.isArray(bot.hand) || bot.hand.length === 0) return null;
  const config = getBotDifficulty(level);
  const brain = ensureBotBrain(room);
  const recentCards = brain.recentCardsByBot[bot.id] || [];

  const scored = bot.hand.map((card) => {
    const similarity = scoreCardForClue(room.clue, card);
    const repeatPenalty = recentCards.includes(card) ? 0.45 : 0;
    return {
      card,
      score: similarity - repeatPenalty + Math.random() * 0.05,
    };
  });

  if (Math.random() < config.randomSubmitChance) {
    return pickRandom(bot.hand) || bot.hand[0];
  }

  const selected = softmaxPick(scored, (entry) => entry.score, config.submitTemperature) || scored[0];
  return selected.card;
}

function chooseBotVote(room, bot, level = bot?.difficulty || 'normal') {
  const choices = room.shuffledSubmissions.filter((submission) => submission.playerId !== bot.id);
  if (choices.length === 0) return null;
  const config = getBotDifficulty(level);

  if (Math.random() < config.randomVoteChance) {
    return pickRandom(choices) || choices[0];
  }

  const scored = choices.map((choice) => ({
    choice,
    score: scoreCardForClue(room.clue, choice.card) + Math.random() * 0.05,
  }));
  const selected = softmaxPick(scored, (entry) => entry.score, config.voteTemperature) || scored[0];
  return selected.choice;
}

function rememberClueMemory(room, storytellerId, clue) {
  const normalized = normalizeText(clue);
  if (!normalized) return;
  const brain = ensureBotBrain(room);
  const last = brain.usedClues[brain.usedClues.length - 1];
  if (last === normalized) return;
  brain.usedClues.push(normalized);
  if (brain.usedClues.length > 60) {
    brain.usedClues = brain.usedClues.slice(-60);
  }
  if (storytellerId && brain.botPersonaById[storytellerId] === undefined) {
    brain.botPersonaById[storytellerId] = null;
  }
}

function rememberRoundOutcome(room) {
  const brain = ensureBotBrain(room);
  const votesBySubmission = new Map();
  for (const vote of room.votes) {
    votesBySubmission.set(vote.submissionId, (votesBySubmission.get(vote.submissionId) || 0) + 1);
  }
  for (const submission of room.submissions) {
    const votes = votesBySubmission.get(submission.id) || 0;
    const current = brain.recentVotesByOwner[submission.playerId];
    const next = current === undefined ? votes : current * 0.65 + votes * 0.35;
    brain.recentVotesByOwner[submission.playerId] = next;
  }
}

function applyStorytellerPlan(room, storyteller, plan) {
  if (!storyteller || !plan?.card || !plan?.clue) return false;
  if (!storyteller.hand.includes(plan.card)) return false;

  storyteller.hand = storyteller.hand.filter((card) => card !== plan.card);
  const submissionId = crypto.randomUUID();
  storyteller.submittedCardId = submissionId;
  room.clue = cleanClue(plan.clue);
  room.clueReason = plan.reason || '';
  room.submissions = [{ id: submissionId, playerId: storyteller.id, card: plan.card }];
  room.shuffledSubmissions = [];
  room.votes = [];
  setRoomPhase(room, 'submit', room.turnSeconds);
  rememberClueMemory(room, storyteller.id, room.clue);
  return true;
}

function moveToVotePhase(room) {
  const expected = room.players.size;
  if (expected <= 0 || room.submissions.length < expected) return false;
  room.shuffledSubmissions = shuffle(room.submissions);
  setRoomPhase(room, 'vote', room.turnSeconds);
  for (const player of room.players.values()) player.votedFor = null;
  return true;
}

function moveToRevealPhase(room) {
  const votesNeeded = room.players.size - 1;
  if (votesNeeded <= 0 || room.votes.length < votesNeeded) return false;
  computeScores(room);
  setRoomPhase(room, 'reveal', REVEAL_AUTO_ADVANCE_SECONDS);
  room.discard.push(...room.submissions.map((submission) => submission.card));
  if (room.summary) {
    room.summary.votesDetail = room.votes.map((vote) => ({ playerId: vote.playerId, submissionId: vote.submissionId }));
  }
  persistRoomHistory(room);
  return true;
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
      userId: p.userId || null,
      name: p.name,
      score: p.score,
      ready: p.ready,
      hand: p.hand,
      submittedCardId: p.submittedCardId,
      votedFor: p.votedFor,
      connected: p.connected,
      isBot: p.isBot || false,
      difficulty: p.difficulty || 'normal',
      persona: p.persona || null,
      joinedAt: p.joinedAt || nowIso(),
      lastSeenAt: Number(p.lastSeenAt || Date.now()),
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
    deadlineAt: room.deadlineAt || null,
    active: room.active,
    mode: room.mode,
    drinkLevel: room.drinkLevel,
    pointLimit: room.pointLimit || DEFAULT_POINT_LIMIT,
    finished: Boolean(room.finished),
    winnerIds: room.winnerIds || [],
    version: room.version || 0,
    createdAt: room.createdAt || nowIso(),
    updatedAt: room.updatedAt || nowIso(),
    botBrain: room.botBrain || createBotBrain(),
  };
}

function parseJsonArray(raw, fallback = []) {
  if (!raw) return [...fallback];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...fallback];
  } catch {
    return [...fallback];
  }
}

const upsertRoomStmt = db.prepare(`
  INSERT INTO rooms (
    code, host_id, storyteller_id, phase, round, clue, clue_reason, turn_seconds, phase_started_at, deadline_at,
    active, mode, drink_level, point_limit, finished, winner_ids_json, order_json, deck_json, discard_json,
    shuffled_submissions_json, summary_json, bot_brain_json, version, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET
    host_id = excluded.host_id,
    storyteller_id = excluded.storyteller_id,
    phase = excluded.phase,
    round = excluded.round,
    clue = excluded.clue,
    clue_reason = excluded.clue_reason,
    turn_seconds = excluded.turn_seconds,
    phase_started_at = excluded.phase_started_at,
    deadline_at = excluded.deadline_at,
    active = excluded.active,
    mode = excluded.mode,
    drink_level = excluded.drink_level,
    point_limit = excluded.point_limit,
    finished = excluded.finished,
    winner_ids_json = excluded.winner_ids_json,
    order_json = excluded.order_json,
    deck_json = excluded.deck_json,
    discard_json = excluded.discard_json,
    shuffled_submissions_json = excluded.shuffled_submissions_json,
    summary_json = excluded.summary_json,
    bot_brain_json = excluded.bot_brain_json,
    version = excluded.version,
    updated_at = excluded.updated_at
`);
const clearRoomPlayersStmt = db.prepare(`DELETE FROM room_players WHERE room_code = ?`);
const clearRoomSubmissionsStmt = db.prepare(`DELETE FROM room_submissions WHERE room_code = ?`);
const clearRoomVotesStmt = db.prepare(`DELETE FROM room_votes WHERE room_code = ?`);
const insertRoomPlayerStmt = db.prepare(`
  INSERT INTO room_players (
    room_code, player_id, user_id, name, score, ready, hand_json, submitted_card_id, voted_for, connected,
    is_bot, difficulty, persona, joined_at, last_seen_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertRoomSubmissionStmt = db.prepare(`
  INSERT INTO room_submissions (room_code, submission_id, player_id, card)
  VALUES (?, ?, ?, ?)
`);
const insertRoomVoteStmt = db.prepare(`
  INSERT INTO room_votes (room_code, voter_player_id, submission_id, created_at)
  VALUES (?, ?, ?, ?)
`);
const deleteRoomRowStmt = db.prepare(`DELETE FROM rooms WHERE code = ?`);
const deleteRoomHistoryStmt = db.prepare(`DELETE FROM room_history WHERE room_code = ?`);
const insertRoomHistoryStmt = db.prepare(`
  INSERT INTO room_history (room_code, round, phase, storyteller_id, clue, summary_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const persistRoomTx = db.transaction((room) => {
  const now = nowIso();
  const serialized = roomToJSON(room);
  upsertRoomStmt.run(
    serialized.code,
    serialized.hostId || null,
    serialized.storytellerId || null,
    serialized.phase || 'lobby',
    Number(serialized.round || 0),
    serialized.clue || '',
    serialized.clueReason || '',
    Number(serialized.turnSeconds || 60),
    Number(serialized.phaseStartedAt || Date.now()),
    serialized.deadlineAt || null,
    serialized.active === false ? 0 : 1,
    serialized.mode || 'classic',
    serialized.drinkLevel || 'light',
    Number(serialized.pointLimit || DEFAULT_POINT_LIMIT),
    serialized.finished ? 1 : 0,
    JSON.stringify(serialized.winnerIds || []),
    JSON.stringify(serialized.order || []),
    JSON.stringify(serialized.deck || []),
    JSON.stringify(serialized.discard || []),
    JSON.stringify(serialized.shuffledSubmissions || []),
    serialized.summary ? JSON.stringify(serialized.summary) : null,
    JSON.stringify(serialized.botBrain || createBotBrain()),
    Number(serialized.version || 0),
    serialized.createdAt || now,
    now,
  );

  clearRoomPlayersStmt.run(serialized.code);
  clearRoomSubmissionsStmt.run(serialized.code);
  clearRoomVotesStmt.run(serialized.code);

  for (const player of serialized.players || []) {
    insertRoomPlayerStmt.run(
      serialized.code,
      player.id,
      player.userId || null,
      player.name || 'Jugador',
      Number(player.score || 0),
      player.ready ? 1 : 0,
      JSON.stringify(player.hand || []),
      player.submittedCardId || null,
      player.votedFor || null,
      player.connected ? 1 : 0,
      player.isBot ? 1 : 0,
      player.difficulty || 'normal',
      player.persona || null,
      player.joinedAt || now,
      Number(player.lastSeenAt || Date.now()),
    );
  }

  for (const submission of serialized.submissions || []) {
    insertRoomSubmissionStmt.run(serialized.code, submission.id, submission.playerId, submission.card);
  }

  for (const vote of serialized.votes || []) {
    insertRoomVoteStmt.run(serialized.code, vote.playerId, vote.submissionId, now);
  }
});

function persistRoom(room) {
  try {
    persistRoomTx(room);
  } catch (error) {
    console.error('Error persisting room', room?.code, error);
  }
}

function persistRoomHistory(room) {
  if (!room?.summary) return;
  try {
    insertRoomHistoryStmt.run(
      room.code,
      Number(room.round || 0),
      room.phase || 'reveal',
      room.storytellerId || null,
      room.clue || '',
      JSON.stringify(room.summary),
      nowIso(),
    );
  } catch (error) {
    console.error('Error persisting room history', room?.code, error);
  }
}

function deleteRoomPersisted(roomCode) {
  const tx = db.transaction(() => {
    deleteRoomHistoryStmt.run(roomCode);
    deleteRoomRowStmt.run(roomCode);
  });
  try {
    tx();
  } catch (error) {
    console.error('Error deleting room from DB', roomCode, error);
  }
}

function loadRoomsFromLegacyFile() {
  if (!fs.existsSync(ROOMS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Error loading legacy rooms file', error);
    return [];
  }
}

function hydrateRoomFromJson(raw) {
  const room = {
    ...raw,
    players: new Map(),
    mode: raw.mode || 'classic',
    drinkLevel: raw.drinkLevel || 'light',
    pointLimit: Number(raw.pointLimit || DEFAULT_POINT_LIMIT),
    deadlineAt: raw.deadlineAt || null,
    finished: Boolean(raw.finished),
    winnerIds: parseJsonArray(JSON.stringify(raw.winnerIds || []), []),
    version: Number(raw.version || 0),
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || nowIso(),
    botBrain: raw.botBrain || createBotBrain(),
  };
  const rawPlayers = Array.isArray(raw.players) ? raw.players : [];
  rawPlayers.forEach((player) => {
    room.players.set(player.id, { ...player, ws: null });
    if (!player.isBot) {
      playerRoomIndex.set(player.id, room.code);
    }
  });
  for (const player of room.players.values()) {
    if (player.isBot) resolveBotPersona(room, player);
  }
  rooms.set(room.code, room);
  persistRoom(room);
}

function loadRooms() {
  rooms.clear();
  playerRoomIndex.clear();
  const dbRoomRows = db.prepare(`SELECT * FROM rooms WHERE active = 1`).all();

  if (dbRoomRows.length === 0) {
    for (const legacyRoom of loadRoomsFromLegacyFile()) {
      hydrateRoomFromJson(legacyRoom);
    }
    return;
  }

  for (const row of dbRoomRows) {
    const room = {
      code: row.code,
      players: new Map(),
      order: parseJsonArray(row.order_json),
      hostId: row.host_id || null,
      storytellerId: row.storyteller_id || null,
      phase: row.phase || 'lobby',
      round: Number(row.round || 0),
      clue: row.clue || '',
      clueReason: row.clue_reason || '',
      submissions: [],
      shuffledSubmissions: parseJsonArray(row.shuffled_submissions_json),
      votes: [],
      summary: row.summary_json ? JSON.parse(row.summary_json) : null,
      deck: parseJsonArray(row.deck_json),
      discard: parseJsonArray(row.discard_json),
      turnSeconds: Number(row.turn_seconds || 60),
      phaseStartedAt: Number(row.phase_started_at || Date.now()),
      deadlineAt: row.deadline_at ? Number(row.deadline_at) : null,
      active: Number(row.active) !== 0,
      mode: row.mode || 'classic',
      drinkLevel: row.drink_level || 'light',
      pointLimit: Number(row.point_limit || DEFAULT_POINT_LIMIT),
      finished: Number(row.finished) === 1,
      winnerIds: parseJsonArray(row.winner_ids_json),
      version: Number(row.version || 0),
      createdAt: row.created_at || nowIso(),
      updatedAt: row.updated_at || nowIso(),
      botBrain: row.bot_brain_json ? JSON.parse(row.bot_brain_json) : createBotBrain(),
    };

    const players = db
      .prepare(`SELECT * FROM room_players WHERE room_code = ?`)
      .all(row.code);
    for (const player of players) {
      const hydrated = {
        id: player.player_id,
        userId: player.user_id || null,
        name: player.name,
        score: Number(player.score || 0),
        ready: Number(player.ready) === 1,
        hand: parseJsonArray(player.hand_json),
        submittedCardId: player.submitted_card_id || null,
        votedFor: player.voted_for || null,
        connected: Number(player.connected) === 1,
        isBot: Number(player.is_bot) === 1,
        difficulty: player.difficulty || 'normal',
        persona: player.persona || null,
        ws: null,
        joinedAt: player.joined_at || nowIso(),
        lastSeenAt: Number(player.last_seen_at || Date.now()),
      };
      room.players.set(hydrated.id, hydrated);
      if (!hydrated.isBot) {
        playerRoomIndex.set(hydrated.id, room.code);
      }
      if (hydrated.isBot) {
        resolveBotPersona(room, hydrated);
      }
    }

    room.submissions = db
      .prepare(`SELECT submission_id, player_id, card FROM room_submissions WHERE room_code = ?`)
      .all(row.code)
      .map((entry) => ({
        id: entry.submission_id,
        playerId: entry.player_id,
        card: entry.card,
      }));

    room.votes = db
      .prepare(`SELECT voter_player_id, submission_id FROM room_votes WHERE room_code = ?`)
      .all(row.code)
      .map((entry) => ({
        playerId: entry.voter_player_id,
        submissionId: entry.submission_id,
      }));

    rooms.set(room.code, room);
  }
}

loadRooms();

function bumpRoomVersion(room) {
  room.version = Number(room.version || 0) + 1;
  room.updatedAt = nowIso();
}

function withRoomLock(roomCode, mutator) {
  if (!roomCode) return false;
  if (roomLocks.has(roomCode)) return false;
  roomLocks.add(roomCode);
  try {
    const changed = mutator();
    if (changed) {
      const room = rooms.get(roomCode);
      if (room) {
        bumpRoomVersion(room);
        persistRoom(room);
      }
    }
    return changed;
  } finally {
    roomLocks.delete(roomCode);
  }
}

function setRoomPhase(room, phase, seconds = room.turnSeconds) {
  room.phase = phase;
  room.phaseStartedAt = Date.now();
  if (phase === 'lobby' || phase === 'finished') {
    room.deadlineAt = null;
    return;
  }
  const boundedSeconds = Math.max(3, Number(seconds || room.turnSeconds || 60));
  room.deadlineAt = Date.now() + boundedSeconds * 1000;
}

function getPhaseDeadlineSeconds(room) {
  if (room.phase === 'reveal') return REVEAL_AUTO_ADVANCE_SECONDS;
  return room.turnSeconds;
}

function getPendingPlayers(room) {
  if (!room || room.phase === 'lobby' || room.phase === 'finished') return [];
  if (room.phase === 'clue') {
    return room.clue ? [] : [room.storytellerId].filter(Boolean);
  }
  if (room.phase === 'submit') {
    return Array.from(room.players.values())
      .filter((player) => player.id !== room.storytellerId && !player.submittedCardId)
      .map((player) => player.id);
  }
  if (room.phase === 'vote') {
    return Array.from(room.players.values())
      .filter((player) => player.id !== room.storytellerId && !player.votedFor)
      .map((player) => player.id);
  }
  return [];
}

function getActiveRoomForPlayer(playerId) {
  const code = playerRoomIndex.get(playerId);
  if (!code) return null;
  const room = rooms.get(code);
  if (!room || room.active === false) {
    playerRoomIndex.delete(playerId);
    return null;
  }
  return room;
}

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
    deadlineAt: null,
    active: true,
    mode: 'classic',
    drinkLevel: 'light',
    pointLimit: DEFAULT_POINT_LIMIT,
    finished: false,
    winnerIds: [],
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    botBrain: createBotBrain(),
  };
  rooms.set(roomCode, room);
  persistRoom(room);
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
  setRoomPhase(room, 'clue', room.turnSeconds);
  room.clue = '';
  room.clueReason = '';
  room.submissions = [];
  room.shuffledSubmissions = [];
  room.votes = [];
  room.summary = null;
  room.storytellerId = rotateStoryteller(room);
  room.round += 1;
  refillHands(room);
  // clear per-player markers
  for (const p of room.players.values()) {
    p.submittedCardId = null;
    p.votedFor = null;
  }
}

function startGame(room) {
  room.round = 0;
  room.finished = false;
  room.winnerIds = [];
  room.botBrain = createBotBrain();
  resetRound(room);
  setRoomPhase(room, 'clue', room.turnSeconds);
}

function canContinueRoom(room) {
  if (!room || room.phase === 'lobby') return false;
  if (room.finished) return false;
  if (room.phase === 'finished') return false;
  if (room.phase === 'clue') return Boolean(room.clue && room.submissions.length > 0);
  if (room.phase === 'submit') return room.submissions.length >= room.players.size;
  if (room.phase === 'vote') return room.votes.length >= Math.max(room.players.size - 1, 0);
  if (room.phase === 'reveal') return true;
  return false;
}

function startNextRound(room, source = 'manual') {
  if (!room) return false;
  if (room.phase !== 'reveal') return false;
  if (room.finished) return false;

  if (room.round >= MAX_ROUNDS) {
    room.finished = true;
    room.winnerIds = room.winnerIds || [];
    room.summary = {
      ...(room.summary || {}),
      gameOver: true,
      winReason: 'round_limit',
      winnerIds: room.winnerIds,
      endedBy: source,
    };
    setRoomPhase(room, 'finished', 0);
    return true;
  }

  resetRound(room);
  setRoomPhase(room, 'clue', room.turnSeconds);
  return true;
}

function ensureBotActions(room) {
  if (!room || room.players.size === 0) return false;
  if (room.phase === 'lobby' || room.phase === 'finished' || room.finished) return false;

  let changed = false;
  ensureBotBrain(room);
  if (!room.storytellerId || !room.players.has(room.storytellerId)) {
    room.storytellerId = rotateStoryteller(room);
    changed = true;
  }

  const expired = room.deadlineAt ? Date.now() >= room.deadlineAt : false;

  // Storyteller bot submits clue automatically.
  const storyteller = room.players.get(room.storytellerId);
  if (room.phase === 'clue' && storyteller?.isBot) {
    const plan = selectStorytellerPlan(room, storyteller, storyteller.difficulty || 'normal');
    if (plan && applyStorytellerPlan(room, storyteller, plan)) {
      changed = true;
    }
  }

  // Bots submit cards in submit phase.
  if (room.phase === 'submit') {
    for (const p of room.players.values()) {
      if (p.isBot && p.id !== room.storytellerId && !p.submittedCardId) {
        const card = chooseBotSubmissionCard(room, p, p.difficulty || 'normal');
        if (card) {
          p.hand = p.hand.filter(c => c !== card);
          const submissionId = crypto.randomUUID();
          p.submittedCardId = submissionId;
          room.submissions.push({ id: submissionId, playerId: p.id, card });
          const brain = ensureBotBrain(room);
          const history = brain.recentCardsByBot[p.id] || [];
          history.push(card);
          brain.recentCardsByBot[p.id] = history.slice(-8);
          changed = true;
        }
      }
    }
    if (moveToVotePhase(room)) {
      changed = true;
    }
  }

  // Bots vote in vote phase.
  if (room.phase === 'vote') {
    for (const p of room.players.values()) {
      if (p.isBot && p.id !== room.storytellerId && !p.votedFor) {
        const choice = chooseBotVote(room, p, p.difficulty || 'normal');
        if (choice) {
          p.votedFor = choice.id;
          room.votes.push({ playerId: p.id, submissionId: choice.id });
          changed = true;
        }
      }
    }
    if (moveToRevealPhase(room)) {
      changed = true;
    }
  }

  if (!expired) {
    return changed;
  }

  // Timer expiry policy:
  // - clue: auto-generates clue/card for storyteller
  // - submit: auto-submits missing cards
  // - vote: auto-votes missing players
  // - reveal: auto-continues to next round
  if (room.phase === 'clue' && room.submissions.length === 0) {
    const st = room.players.get(room.storytellerId);
    if (st && st.hand.length > 0) {
      const timeoutLevel = st.isBot ? (st.difficulty || 'normal') : 'normal';
      const plan = selectStorytellerPlan(room, st, timeoutLevel);
      if (plan && applyStorytellerPlan(room, st, plan)) {
        changed = true;
      }
    }
  } else if (room.phase === 'submit') {
    for (const p of room.players.values()) {
      if (p.id === room.storytellerId || p.submittedCardId) continue;
      let card = null;
      if (p.isBot) {
        card = chooseBotSubmissionCard(room, p, p.difficulty || 'normal');
      } else if (p.hand.length > 0) {
        const scored = p.hand
          .map((candidate) => ({ card: candidate, score: scoreCardForClue(room.clue, candidate) }))
          .sort((a, b) => b.score - a.score);
        card = scored[0]?.card || p.hand[0];
      }
      if (card) {
        p.hand = p.hand.filter((candidate) => candidate !== card);
        const submissionId = crypto.randomUUID();
        p.submittedCardId = submissionId;
        room.submissions.push({ id: submissionId, playerId: p.id, card });
        changed = true;
      }
    }
    if (moveToVotePhase(room)) {
      changed = true;
    }
  } else if (room.phase === 'vote') {
    for (const p of room.players.values()) {
      if (p.id === room.storytellerId || p.votedFor) continue;
      let choice = null;
      if (p.isBot) {
        choice = chooseBotVote(room, p, p.difficulty || 'normal');
      } else {
        const choices = room.shuffledSubmissions.filter(s => s.playerId !== p.id);
        const scored = choices.map((candidate) => ({
          choice: candidate,
          score: scoreCardForClue(room.clue, candidate.card),
        }));
        choice = softmaxPick(scored, (entry) => entry.score, 1.2)?.choice || pickRandom(choices);
      }
      if (choice) {
        p.votedFor = choice.id;
        room.votes.push({ playerId: p.id, submissionId: choice.id });
        changed = true;
      }
    }
    if (moveToRevealPhase(room)) {
      changed = true;
    }
  } else if (room.phase === 'reveal') {
    if (startNextRound(room, 'timer')) {
      changed = true;
    }
  }

  return changed;
}

function addPlayer(room, user, ws, name, difficulty = 'normal') {
  const id = user.id;
  const existing = room.players.get(id);
  if (existing) {
    existing.ws = ws;
    existing.connected = true;
    existing.name = name?.trim() || existing.name || user.displayName || user.username || 'Jugador';
    existing.difficulty = BOT_LEVELS.includes(difficulty) ? difficulty : (existing.difficulty || 'normal');
    existing.userId = user.id;
    existing.lastSeenAt = Date.now();
    if (!existing.joinedAt) existing.joinedAt = nowIso();
    playerRoomIndex.set(id, room.code);
    return existing;
  }
  const player = {
    id,
    userId: user.id,
    name: name?.trim() || user.displayName || user.username || 'Jugador',
    score: 0,
    ready: false,
    hand: [],
    submittedCardId: null,
    votedFor: null,
    ws,
    connected: true,
    difficulty: BOT_LEVELS.includes(difficulty) ? difficulty : 'normal',
    joinedAt: nowIso(),
    lastSeenAt: Date.now(),
  };
  room.players.set(id, player);
  if (!room.order.includes(id)) {
    room.order.push(id);
  }
  playerRoomIndex.set(id, room.code);
  if (!room.hostId) room.hostId = id;
  return player;
}

function addBot(room, name = 'Bot', difficulty = 'normal') {
  const id = `bot-${crypto.randomBytes(4).toString('hex')}`;
  const persona = BOT_PERSONALITIES[hashString(`${room.code}:${id}`) % BOT_PERSONALITIES.length].id;
  const player = {
    id,
    userId: null,
    name: `${name} (bot)`,
    score: 0,
    ready: true,
    hand: [],
    submittedCardId: null,
    votedFor: null,
    ws: null,
    connected: false,
    isBot: true,
    difficulty: BOT_LEVELS.includes(difficulty) ? difficulty : 'normal',
    persona,
    joinedAt: nowIso(),
    lastSeenAt: Date.now(),
  };
  room.players.set(id, player);
  room.order.push(id);
  ensureBotBrain(room).botPersonaById[id] = persona;
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
  if (!leaving.isBot) {
    playerRoomIndex.delete(playerId);
  }
  room.order = room.order.filter(id => id !== playerId);
  room.submissions = room.submissions.filter((s) => s.playerId !== playerId);
  room.shuffledSubmissions = room.shuffledSubmissions.filter((s) => s.playerId !== playerId);
  room.votes = room.votes.filter((v) => v.playerId !== playerId && !removedSubmissionIds.has(v.submissionId));
  if (room.botBrain) {
    delete room.botBrain.botPersonaById?.[playerId];
    delete room.botBrain.recentVotesByOwner?.[playerId];
    delete room.botBrain.recentCardsByBot?.[playerId];
  }

  if (room.players.size === 0) {
    rooms.delete(room.code);
    deleteRoomPersisted(room.code);
    return;
  }

  if (room.hostId === playerId || !room.players.has(room.hostId)) {
    room.hostId = pickNextHost(room);
  }
  if (room.storytellerId === playerId || !room.players.has(room.storytellerId)) {
    room.storytellerId = room.order[0] || null;
  }

  if (room.phase !== 'lobby' && room.phase !== 'finished') {
    setRoomPhase(room, 'lobby', 0);
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
    round: room.round,
    pointLimit: room.pointLimit || DEFAULT_POINT_LIMIT,
  };
  if (room.mode === 'party') {
    const storytellerCard = room.submissions.find(s => s.playerId === storytellerId)?.card;
    const tags = getCardTags(storytellerCard);
    room.summary.drinkPrompt = buildDrinkPrompt(tags, room.drinkLevel);
    room.summary.tags = tags;
  }

  const scores = Array.from(room.players.values()).map((player) => ({
    id: player.id,
    score: Number(player.score || 0),
  }));
  const topScore = scores.length > 0 ? Math.max(...scores.map((entry) => entry.score)) : 0;
  const winners = scores.filter((entry) => entry.score === topScore).map((entry) => entry.id);
  const pointLimit = Math.max(MIN_POINT_LIMIT, Math.min(MAX_POINT_LIMIT, Number(room.pointLimit || DEFAULT_POINT_LIMIT)));
  const reachedLimit = topScore >= pointLimit;
  const reachedRoundCap = room.round >= MAX_ROUNDS;

  room.summary.topScore = topScore;
  room.summary.winnerIds = winners;
  room.summary.gameOver = reachedLimit || reachedRoundCap;
  room.summary.winReason = reachedLimit ? 'point_limit' : reachedRoundCap ? 'round_limit' : null;

  if (reachedLimit || reachedRoundCap) {
    room.finished = true;
    room.winnerIds = winners;
  }

  rememberClueMemory(room, storytellerId, room.clue);
  rememberRoundOutcome(room);
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
  const pendingPlayerIds = getPendingPlayers(room);
  const pendingPlayers = pendingPlayerIds
    .map((id) => {
      const candidate = room.players.get(id);
      if (!candidate) return null;
      return { id: candidate.id, name: candidate.name };
    })
    .filter(Boolean);
  const serverNow = Date.now();
  const remainingMs = room.deadlineAt ? Math.max(0, Number(room.deadlineAt) - serverNow) : 0;
  const sortedByScore = Array.from(room.players.values()).sort((a, b) => (b.score || 0) - (a.score || 0));
  const topScore = sortedByScore.length > 0 ? Number(sortedByScore[0].score || 0) : 0;
  const leaderIds = sortedByScore.filter((entry) => Number(entry.score || 0) === topScore).map((entry) => entry.id);

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
    clueReason: room.clueReason || '',
    pointLimit: room.pointLimit || DEFAULT_POINT_LIMIT,
    finished: Boolean(room.finished),
    winnerIds: room.winnerIds || [],
    leaderIds,
    topScore,
    pendingPlayers,
    pendingPlayerIds,
    canContinue: canContinueRoom(room),
    phaseStatus: room.finished
      ? 'finished'
      : pendingPlayers.length > 0
        ? 'waiting_players'
        : room.phase === 'reveal'
          ? 'resolving'
          : 'ready',
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
      isBot: p.isBot || false,
      difficulty: p.difficulty || 'normal',
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
  state.deadlineAt = room.deadlineAt || null;
  state.timer = {
    active: Boolean(room.deadlineAt && !room.finished && room.phase !== 'lobby'),
    deadlineAt: room.deadlineAt || null,
    remainingMs,
    turnSeconds: room.phase === 'reveal' ? REVEAL_AUTO_ADVANCE_SECONDS : room.turnSeconds,
    serverNow,
  };


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

  if (room.finished && room.summary) {
    state.summary = {
      ...room.summary,
      gameOver: true,
      winnerIds: room.winnerIds || room.summary.winnerIds || [],
      pointLimit: room.pointLimit || DEFAULT_POINT_LIMIT,
    };
  }

  if (room.phase === 'lobby') {
    state.canStart = room.players.size >= MIN_PLAYERS;
  }

  return state;
}

function broadcast(room, options = {}) {
  if (!room || room.active === false) return;
  if (!options.skipAutomation) {
    const changed = ensureBotActions(room);
    if (changed) {
      bumpRoomVersion(room);
      persistRoom(room);
    }
  }
  for (const p of room.players.values()) {
    if (p.ws && p.ws.readyState === p.ws.OPEN) {
      send(p.ws, toClientState(room, p.id));
    }
  }
}

wss.on('connection', (ws, req) => {
  const cookies = parseCookies(req?.headers?.cookie || '');
  const authToken = cookies[SESSION_COOKIE_NAME];
  const authUser = getUserBySessionToken(authToken);
  if (!authUser) {
    send(ws, { type: 'error', code: 'AUTH_REQUIRED', message: 'Debes iniciar sesión para jugar.' });
    ws.close(4401, 'auth_required');
    return;
  }

  let currentRoom = null;
  let currentPlayerId = authUser.id;

  const mutateAndBroadcast = (room, mutator, { skipAutomation = false } = {}) => {
    if (!room) return false;
    const changed = withRoomLock(room.code, mutator);
    if (changed) {
      broadcast(room, { skipAutomation });
    }
    return changed;
  };

  const attachToRoom = (room, player) => {
    currentRoom = room;
    currentPlayerId = player.id;
    send(ws, { type: 'joined', roomCode: room.code, playerId: player.id });
  };

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const type = msg?.type;

    if (type === 'join') {
      const requestedCode = msg.roomCode?.toString().trim() || null;
      const name = msg.name?.toString().trim().slice(0, 20) || authUser.displayName || authUser.username || 'Jugador';
      const code = requestedCode ? normalizeRoomCode(requestedCode) : null;
      if (requestedCode && !code) {
        send(ws, { type: 'error', message: 'Código de sala inválido.' });
        return;
      }

      let room = null;
      const activeRoom = getActiveRoomForPlayer(authUser.id);
      if (!code && activeRoom) {
        room = activeRoom;
      } else if (code) {
        room = getRoom(code);
      }

      if (activeRoom && room && activeRoom.code !== room.code) {
        mutateAndBroadcast(activeRoom, () => {
          removePlayer(activeRoom, authUser.id, 'moved_room');
          return true;
        });
      }

      if (!room) {
        room = createRoom(code);
      }

      if (room.phase !== 'lobby' && !room.players.has(authUser.id)) {
        send(ws, { type: 'error', message: 'La partida ya inició. Solo puedes reconectar si ya estabas dentro.' });
        return;
      }

      mutateAndBroadcast(room, () => {
        const existed = room.players.has(authUser.id);
        const player = addPlayer(room, authUser, ws, name, msg.difficulty || 'normal');
        player.connected = true;
        player.ws = ws;
        player.lastSeenAt = Date.now();
        if (!existed && room.phase === 'lobby' && !player.isBot) {
          player.ready = false;
        }
        attachToRoom(room, player);
        return true;
      }, { skipAutomation: true });
      return;
    }

    if (type === 'end_room') {
      const targetCode = msg.roomCode ? normalizeRoomCode(msg.roomCode) : currentRoom?.code || null;
      const target = targetCode ? rooms.get(targetCode) : null;
      if (!target) {
        send(ws, { type: 'error', message: 'Sala no encontrada.' });
        return;
      }

      const requester = target.players.get(authUser.id);
      const hasMasterPassword = MASTER_DELETE_PASSWORD.length > 0;
      const masterPasswordValid = hasMasterPassword && String(msg.password || '') === MASTER_DELETE_PASSWORD;
      const canEnd = (requester && target.hostId === requester.id) || masterPasswordValid;
      if (!canEnd) {
        send(ws, { type: 'error', message: 'No autorizado para eliminar la sala.' });
        return;
      }

      target.active = false;
      for (const participant of target.players.values()) {
        if (participant.ws && participant.ws.readyState === participant.ws.OPEN) {
          participant.ws.send(JSON.stringify({ type: 'ended', roomCode: target.code }));
        }
        if (!participant.isBot) {
          playerRoomIndex.delete(participant.id);
        }
      }
      rooms.delete(target.code);
      deleteRoomPersisted(target.code);

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
        mutateAndBroadcast(room, () => {
          if (room.phase !== 'lobby') return false;
          player.ready = Boolean(msg.ready);
          player.lastSeenAt = Date.now();
          return true;
        });
        break;
      }
      case 'set_timer': {
        mutateAndBroadcast(room, () => {
          if (player.id !== room.hostId || room.phase !== 'lobby') return false;
          room.turnSeconds = Math.max(15, Math.min(180, Number(msg.seconds) || 60));
          if (room.deadlineAt) {
            room.deadlineAt = Date.now() + room.turnSeconds * 1000;
          }
          return true;
        });
        break;
      }
      case 'set_point_limit': {
        mutateAndBroadcast(room, () => {
          if (player.id !== room.hostId || room.phase !== 'lobby') return false;
          const nextLimit = Math.max(MIN_POINT_LIMIT, Math.min(MAX_POINT_LIMIT, Number(msg.pointLimit) || DEFAULT_POINT_LIMIT));
          room.pointLimit = nextLimit;
          return true;
        });
        break;
      }
      case 'set_mode': {
        mutateAndBroadcast(room, () => {
          if (player.id !== room.hostId || room.phase !== 'lobby') return false;
          const mode = msg.mode === 'party' ? 'party' : 'classic';
          const level = DRINK_LEVELS.includes(msg.drinkLevel) ? msg.drinkLevel : room.drinkLevel;
          room.mode = mode;
          room.drinkLevel = level;
          return true;
        });
        break;
      }
      case 'start': {
        mutateAndBroadcast(room, () => {
          if (player.id !== room.hostId || room.phase !== 'lobby') return false;
          if (room.players.size < MIN_PLAYERS) {
            send(ws, { type: 'error', message: 'Se requieren al menos 3 jugadores.' });
            return false;
          }
          const allHumansReady = Array.from(room.players.values()).every((participant) => participant.isBot || participant.ready);
          if (!allHumansReady) {
            send(ws, { type: 'error', message: 'Todos los jugadores humanos deben estar listos.' });
            return false;
          }

          if (msg.mode) room.mode = msg.mode === 'party' ? 'party' : 'classic';
          if (msg.drinkLevel && DRINK_LEVELS.includes(msg.drinkLevel)) room.drinkLevel = msg.drinkLevel;
          if (msg.pointLimit) {
            room.pointLimit = Math.max(MIN_POINT_LIMIT, Math.min(MAX_POINT_LIMIT, Number(msg.pointLimit) || room.pointLimit));
          }

          for (const participant of room.players.values()) {
            participant.score = 0;
            participant.hand = [];
            participant.submittedCardId = null;
            participant.votedFor = null;
          }
          room.deck = shuffle(cardFiles).map((file) => `cards/${file}`);
          room.discard = [];
          room.storytellerId = room.order[0] || null;
          startGame(room);
          return true;
        });
        break;
      }
      case 'add_bot': {
        mutateAndBroadcast(room, () => {
          if (player.id !== room.hostId || room.phase !== 'lobby') return false;
          const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
          addBot(room, `Bot ${botName}`, msg.difficulty || 'normal');
          refillHands(room);
          return true;
        });
        break;
      }
      case 'start_with_bots': {
        mutateAndBroadcast(room, () => {
          if (player.id !== room.hostId || room.phase !== 'lobby') return false;
          if (msg.mode) room.mode = msg.mode === 'party' ? 'party' : 'classic';
          if (msg.drinkLevel && DRINK_LEVELS.includes(msg.drinkLevel)) room.drinkLevel = msg.drinkLevel;
          if (msg.pointLimit) {
            room.pointLimit = Math.max(MIN_POINT_LIMIT, Math.min(MAX_POINT_LIMIT, Number(msg.pointLimit) || room.pointLimit));
          }
          while (room.players.size < MIN_PLAYERS) {
            const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
            addBot(room, `Bot ${botName}`, msg.difficulty || 'normal');
          }
          for (const participant of room.players.values()) {
            participant.score = 0;
            participant.hand = [];
            participant.submittedCardId = null;
            participant.votedFor = null;
            participant.ready = true;
          }
          room.deck = shuffle(cardFiles).map((file) => `cards/${file}`);
          room.discard = [];
          room.storytellerId = room.order[0] || null;
          startGame(room);
          return true;
        });
        break;
      }
      case 'submit_clue': {
        mutateAndBroadcast(room, () => {
          if (room.phase !== 'clue' || room.storytellerId !== player.id || room.finished) return false;
          const card = msg.card;
          const clue = (msg.clue || '').toString().trim().slice(0, 80);
          if (!card || !player.hand.includes(card) || !clue) return false;
          player.hand = player.hand.filter((candidate) => candidate !== card);
          const submissionId = crypto.randomUUID();
          player.submittedCardId = submissionId;
          room.clue = cleanClue(clue);
          room.clueReason = '';
          room.submissions = [{ id: submissionId, playerId: player.id, card }];
          room.shuffledSubmissions = [];
          room.votes = [];
          setRoomPhase(room, 'submit', room.turnSeconds);
          rememberClueMemory(room, player.id, room.clue);
          return true;
        });
        break;
      }
      case 'submit_card': {
        mutateAndBroadcast(room, () => {
          if (room.phase !== 'submit' || room.finished) return false;
          if (player.id === room.storytellerId || player.submittedCardId) return false;
          const card = msg.card;
          if (!card || !player.hand.includes(card)) return false;
          player.hand = player.hand.filter((candidate) => candidate !== card);
          const submissionId = crypto.randomUUID();
          player.submittedCardId = submissionId;
          room.submissions.push({ id: submissionId, playerId: player.id, card });
          moveToVotePhase(room);
          return true;
        });
        break;
      }
      case 'vote': {
        mutateAndBroadcast(room, () => {
          if (room.phase !== 'vote' || room.finished) return false;
          if (player.id === room.storytellerId || player.votedFor) return false;
          const submissionId = msg.submissionId;
          const submission = room.submissions.find((entry) => entry.id === submissionId);
          if (!submission || submission.playerId === player.id) return false;
          player.votedFor = submissionId;
          room.votes.push({ playerId: player.id, submissionId });
          moveToRevealPhase(room);
          return true;
        });
        break;
      }
      case 'next_round':
      case 'continue': {
        mutateAndBroadcast(room, () => {
          if (room.finished) return false;
          if (room.phase === 'submit') return moveToVotePhase(room);
          if (room.phase === 'vote') return moveToRevealPhase(room);
          if (room.phase === 'reveal') return startNextRound(room, 'manual');
          return false;
        });
        break;
      }
      case 'leave': {
        mutateAndBroadcast(room, () => {
          removePlayer(room, player.id, 'left');
          return true;
        });
        currentRoom = null;
        currentPlayerId = null;
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!currentRoom || !currentPlayerId) return;
    const room = currentRoom;
    mutateAndBroadcast(room, () => {
      const player = room.players.get(currentPlayerId);
      if (!player) return false;
      player.connected = false;
      player.ws = null;
      player.lastSeenAt = Date.now();
      if (room.hostId === player.id) {
        room.hostId = pickNextHost(room);
      }
      return true;
    }, { skipAutomation: true });
  });
});

app.post('/api/auth/register', (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username || '');
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.displayName || '').trim().slice(0, 28);
    validateUsername(username);
    validatePassword(password);

    const existing = getUserByUsernameStmt.get(username);
    if (existing) {
      res.status(400).json({ ok: false, error: 'Ese usuario ya existe.' });
      return;
    }

    const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const now = nowIso();
    insertUserStmt.run(
      userId,
      username,
      displayName || username,
      passwordHash,
      salt,
      now,
      now,
    );

    const session = createSession(userId);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({
      ok: true,
      user: {
        id: userId,
        username,
        displayName: displayName || username,
      },
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error?.message || 'No se pudo registrar.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username || '');
    const password = String(req.body?.password || '');
    validateUsername(username);
    validatePassword(password);

    const row = getUserByUsernameStmt.get(username);
    if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
      res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
      return;
    }

    const session = createSession(row.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({
      ok: true,
      user: toPublicUser(row),
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error?.message || 'No se pudo iniciar sesión.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (req.authToken) {
    deleteSessionStmt.run(req.authToken);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.authUser) {
    res.json({ ok: true, authenticated: false, user: null, activeRoom: null });
    return;
  }
  const activeRoom = getActiveRoomForPlayer(req.authUser.id);
  res.json({
    ok: true,
    authenticated: true,
    user: req.authUser,
    activeRoom: activeRoom
      ? {
          code: activeRoom.code,
          phase: activeRoom.phase,
          round: activeRoom.round,
          pointLimit: activeRoom.pointLimit || DEFAULT_POINT_LIMIT,
          playerId: req.authUser.id,
        }
      : null,
  });
});

app.get('/api/rooms', requireAuth, (req, res) => {
  const list = Array.from(rooms.values())
    .filter((room) => room.active !== false)
    .map((room) => ({
      code: room.code,
      phase: room.phase,
      turnSeconds: room.turnSeconds,
      pointLimit: room.pointLimit || DEFAULT_POINT_LIMIT,
      mode: room.mode || 'classic',
      drinkLevel: room.drinkLevel || 'light',
      finished: Boolean(room.finished),
      winnerIds: room.winnerIds || [],
      players: Array.from(room.players.values()).map((player) => ({
        id: player.id,
        name: player.name,
        score: player.score,
        connected: player.connected,
        isBot: Boolean(player.isBot),
      })),
    }));
  res.json({ ok: true, rooms: list });
});

app.get('/api/rooms/:code/history', requireAuth, (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  if (!code) {
    res.status(400).json({ ok: false, error: 'Código inválido.' });
    return;
  }
  const rows = db
    .prepare(`
      SELECT id, room_code, round, phase, storyteller_id, clue, summary_json, created_at
      FROM room_history
      WHERE room_code = ?
      ORDER BY id DESC
      LIMIT 30
    `)
    .all(code);
  res.json({
    ok: true,
    history: rows.map((row) => ({
      id: row.id,
      roomCode: row.room_code,
      round: row.round,
      phase: row.phase,
      storytellerId: row.storyteller_id,
      clue: row.clue,
      summary: row.summary_json ? JSON.parse(row.summary_json) : null,
      createdAt: row.created_at,
    })),
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    const changed = withRoomLock(room.code, () => ensureBotActions(room));
    if (changed) {
      broadcast(room, { skipAutomation: true });
    }
  }
}, ROOM_TICK_MS).unref();

setInterval(() => {
  db.prepare(`DELETE FROM user_sessions WHERE expires_at <= ?`).run(Date.now());
}, 60_000).unref();

let shuttingDown = false;
function closeDatabaseQuietly() {
  try {
    db.close();
  } catch {
    // ignore shutdown close errors
  }
}

function shutdownGracefully(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] señal ${signal}, cerrando servidor...`);

  const forceExitTimer = setTimeout(() => {
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // ignore ws termination errors
      }
    }
    if (typeof server.closeAllConnections === 'function') {
      try {
        server.closeAllConnections();
      } catch {
        // ignore forced close errors
      }
    }
    closeDatabaseQuietly();
    process.exit(1);
  }, 2500);
  forceExitTimer.unref?.();

  for (const client of wss.clients) {
    try {
      client.terminate();
    } catch {
      // ignore ws termination errors
    }
  }

  const finish = (exitCode = 0) => {
    clearTimeout(forceExitTimer);
    closeDatabaseQuietly();
    process.exit(exitCode);
  };

  try {
    wss.close(() => {
      try {
        server.close((error) => {
          if (error) {
            finish(1);
            return;
          }
          finish(0);
        });
      } catch {
        finish(1);
      }
    });
  } catch {
    finish(1);
  }
}

process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
});
