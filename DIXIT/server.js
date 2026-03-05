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
const ROOM_ADMIN_PASSWORD = process.env.ROOM_ADMIN_PASSWORD || 'hola123';

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
const MAX_CLUE_AUDIO_DATA_URL_LENGTH = 900000;
const CLUE_AUDIO_FALLBACK_TEXT = 'Pista por audio';

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
  { id: 'estratega', openers: ['la clave está en', 'pista corta:', 'piensa en'], cadence: ['sin ser literal', 'con doble lectura', 'dejando margen'], riskBias: 0.2 },
  { id: 'surrealista', openers: ['esto parece', 'sueña con', 'imagina'], cadence: ['flotando en silencio', 'como un glitch bonito', 'fuera de contexto'], riskBias: 0.65 },
];
const BOT_PERSONALITY_BY_ID = Object.fromEntries(BOT_PERSONALITIES.map((persona) => [persona.id, persona]));
const BOT_PERSONA_REASON_STYLE = {
  poeta: 'La formulé como una imagen sensorial para sugerir más de lo que describe.',
  cineasta: 'La pensé como una escena visual concreta para que se entienda rápido.',
  narrador: 'La armé como mini-historia para unir bien los elementos de la carta.',
  estratega: 'Usé una frase corta y jugable para equilibrar claridad y engaño.',
  surrealista: 'Le di un giro extraño, pero manteniendo una base coherente con la carta.',
};

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
    creativityWeight: 0.62,
    discriminationWeight: 0.38,
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
    creativityWeight: 0.5,
    discriminationWeight: 0.5,
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
    creativityWeight: 0.42,
    discriminationWeight: 0.58,
  },
};

const BOT_METAPHOR_SPARKS = [
  'sin mapa',
  'con eco',
  'a contratiempo',
  'de madrugada',
  'sin gravedad',
  'en bucle',
  'con olor a lluvia',
  'en cámara lenta',
];

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

function roomAllowsAudioClue(room) {
  if (!room || room.players.size < 2) return false;
  for (const participant of room.players.values()) {
    if (participant.isBot) return false;
  }
  return true;
}

function sanitizeClueAudioDataUrl(value = '') {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CLUE_AUDIO_DATA_URL_LENGTH) return '';
  if (!trimmed.startsWith('data:audio/')) return '';
  const commaIndex = trimmed.indexOf(',');
  if (commaIndex <= 0) return '';
  const meta = trimmed.slice(0, commaIndex).toLowerCase();
  if (!meta.includes(';base64')) return '';
  const payload = trimmed.slice(commaIndex + 1);
  if (!payload || !/^[a-z0-9+/=\s]+$/i.test(payload)) return '';
  return trimmed;
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
    storyGuessRateByPlayer: {},
    storyTokensByPlayer: {},
    globalTokenUse: {},
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
  if (!room.botBrain.storyGuessRateByPlayer) room.botBrain.storyGuessRateByPlayer = {};
  if (!room.botBrain.storyTokensByPlayer) room.botBrain.storyTokensByPlayer = {};
  if (!room.botBrain.globalTokenUse) room.botBrain.globalTokenUse = {};
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

function getScorePressure(room, playerId) {
  const players = Array.from(room.players.values());
  if (players.length === 0) return { relative: 0.5, isLeading: false, gapToLead: 0 };

  const scores = players.map((player) => player.score || 0);
  const topScore = Math.max(...scores);
  const bottomScore = Math.min(...scores);
  const me = room.players.get(playerId);
  const myScore = me?.score || 0;
  const span = Math.max(topScore - bottomScore, 1);
  const relative = (myScore - bottomScore) / span;
  const gapToLead = topScore - myScore;
  return {
    relative,
    isLeading: gapToLead <= 0,
    gapToLead,
  };
}

function weightedProfileAffinity(profileTokens, tokenWeights = {}) {
  let score = 0;
  for (const [token, weight] of Object.entries(tokenWeights || {})) {
    if (!weight || weight <= 0) continue;
    if (!profileTokens.has(token)) continue;
    score += weight;
  }
  return score;
}

function getStoryGuessRate(room, storytellerId) {
  const brain = ensureBotBrain(room);
  const value = brain.storyGuessRateByPlayer?.[storytellerId];
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  return clamp(value, 0, 1);
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
  let tokenReusePenalty = 0;
  for (const token of clueTokens) {
    tokenReusePenalty += Math.min((brain.globalTokenUse?.[token] || 0) * 0.025, 0.3);
  }
  return penalty + tokenReusePenalty;
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

function formatNaturalList(items = []) {
  const clean = uniqueByNormalized((items || []).filter(Boolean));
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} y ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} y ${clean[clean.length - 1]}`;
}

function buildReasonSignals(clue, profile) {
  const normalizedClue = normalizeText(clue);
  const clueTokens = tokenize(clue);
  const buckets = [
    {
      phrase: `tema de ${profile.theme}`,
      terms: [profile.theme, ...(BOT_THEME_LEXICON[profile.theme] || [])],
    },
    {
      phrase: `ambiente ${profile.mood}`,
      terms: [profile.mood, ...(BOT_MOOD_LEXICON[profile.mood] || [])],
    },
    {
      phrase: `elementos de ${singularize(profile.element)}`,
      terms: [singularize(profile.element), profile.element, ...(BOT_ELEMENT_LEXICON[profile.element] || [])],
    },
    {
      phrase: `paleta ${profile.colors}`,
      terms: [profile.colors, ...(BOT_COLOR_LEXICON[profile.colors] || [])],
    },
    {
      phrase: `clima de ${profile.weather}`,
      terms: [profile.weather],
    },
    {
      phrase: `luz de ${profile.light}`,
      terms: [profile.light],
    },
    {
      phrase: `ritmo ${profile.rhythm}`,
      terms: [profile.rhythm],
    },
  ];

  const scored = buckets
    .map((bucket, index) => {
      const terms = uniqueByNormalized(bucket.terms);
      const profileTokens = new Set(terms.flatMap((term) => tokenize(term)));
      let score = tokenOverlapScore(clueTokens, profileTokens);
      for (const term of terms) {
        const normalizedTerm = normalizeText(term);
        if (normalizedTerm && normalizedClue.includes(normalizedTerm)) score += 1;
      }
      return { ...bucket, score, index };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const positive = scored.filter((entry) => entry.score > 0.15).slice(0, 2);
  if (positive.length === 2) return positive.map((entry) => entry.phrase);
  if (positive.length === 1) {
    const fallback = scored.find((entry) => entry.phrase !== positive[0].phrase);
    return fallback ? [positive[0].phrase, fallback.phrase] : [positive[0].phrase];
  }
  return [`tema de ${profile.theme}`, `ambiente ${profile.mood}`];
}

function buildStrategyHint(meta = {}) {
  if (meta?.isLeading) return 'Como iba arriba en el marcador, forcé un poco más de ambigüedad.';
  if (meta?.isBehind) return 'Como iba por detrás, prioricé una lectura más clara.';
  return 'Busqué un punto medio: entendible, pero no totalmente obvia.';
}

function buildTargetHint(meta = {}) {
  if (typeof meta?.targetAmbiguity !== 'number' || Number.isNaN(meta.targetAmbiguity)) {
    return 'La intención era que no fuera ni regalada ni imposible.';
  }
  const target = Math.max(0, Math.round(meta.targetAmbiguity));
  if (target <= 0) return 'Intenté que casi todos pudieran reconocerla.';
  if (target === 1) return 'Buscaba que dudara justo 1 rival.';
  return `Buscaba que dudaran aproximadamente ${target} rivales.`;
}

function buildSharpnessHint(meta = {}) {
  if (typeof meta?.ownScore !== 'number' || Number.isNaN(meta.ownScore)) return '';
  if (meta.ownScore >= 1.8) return 'Por eso la pista quedó bastante directa.';
  if (meta.ownScore >= 1.2) return 'La dejé reconocible, pero sin ser literal.';
  return 'La mantuve más abstracta para que no señalara la carta de forma evidente.';
}

function buildBotReason(profile, persona, clue, meta = {}) {
  const signals = buildReasonSignals(clue, profile);
  const focus = formatNaturalList(signals) || `tema de ${profile.theme}`;
  const styleHint = BOT_PERSONA_REASON_STYLE[persona?.id] || 'Intenté que sonara natural y jugable.';
  const strategyHint = buildStrategyHint(meta);
  const targetHint = buildTargetHint(meta);
  const sharpnessHint = buildSharpnessHint(meta);
  return [
    `Elegí "${clue}" porque mi carta encajaba con ${focus}.`,
    styleHint,
    strategyHint,
    sharpnessHint,
    targetHint,
  ].filter(Boolean).join(' ');
}

function buildBotClueCandidates(room, storyteller, cardPath) {
  const profile = getCardProfile(cardPath);
  const persona = storyteller?.isBot ? resolveBotPersona(room, storyteller) : BOT_PERSONALITIES[2];
  const brain = ensureBotBrain(room);
  const themeWords = [profile.theme, ...(BOT_THEME_LEXICON[profile.theme] || [])];
  const moodWords = [profile.mood, ...(BOT_MOOD_LEXICON[profile.mood] || [])];
  const elementWords = [singularize(profile.element), ...(BOT_ELEMENT_LEXICON[profile.element] || [])];
  const colorWords = [profile.colors, ...(BOT_COLOR_LEXICON[profile.colors] || [])];
  const contrastThemes = CARD_THEMES.filter((value) => value !== profile.theme);
  const contrastMoods = CARD_MOODS.filter((value) => value !== profile.mood);
  const contrastTheme = pickRandom(contrastThemes) || profile.theme;
  const contrastMood = pickRandom(contrastMoods) || profile.mood;
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
  const metaphor = pickRandom(BOT_METAPHOR_SPARKS) || 'sin mapa';
  const frequentTokens = Object.entries(brain.globalTokenUse || {})
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, 10)
    .map(([token]) => token);
  const antiRepeatTheme = themeWords.find((word) => !frequentTokens.includes(normalizeText(word))) || anchorTheme;
  const riskyAnchor = persona.riskBias >= 0.5 ? contrastTheme : anchorTheme;

  const clues = uniqueByNormalized([
    cleanClue(`${anchorTheme} ${anchorMood} ${twist}`),
    cleanClue(`${riskyAnchor} ${anchorMood} ${metaphor}`),
    cleanClue(`${opener} ${anchorElement} ${cadence}`),
    cleanClue(`${scene}: ${anchorTheme} ${twist}`),
    cleanClue(`${anchorElement} ${linker} ${anchorMood}`),
    cleanClue(`${anchorColor} y ${anchorMood}`),
    cleanClue(`${anchorTheme} pero ${contrastMood}`),
    cleanClue(`${anchorElement} en ${contrastTheme}`),
    cleanClue(`${antiRepeatTheme} ${linker} ${anchorColor}`),
    cleanClue(`${noun} ${adj} ${twist}`),
    cleanClue(`${profile.light} ${linker} ${anchorTheme}`),
    cleanClue(`${opener} ${noun} ${pickRandom(['sin final', 'sin aviso', 'sin gravedad'])}`),
    cleanClue(`${anchorTheme} ${linker} ${profile.weather}`),
    cleanClue(`${anchorMood} ${linker} ${profile.rhythm}`),
  ]).filter((clue) => clue.length >= 8 && clue.split(' ').length >= 2 && clue.length <= 80);

  if (clues.length === 0) {
    clues.push(cleanClue(`${profile.theme} ${profile.mood} ${metaphor}`));
  }

  return clues.map((clue) => ({
    clue,
    profile,
    persona,
  }));
}

function evaluateStoryCandidate(room, storyteller, cardPath, clue, level = 'normal') {
  const config = getBotDifficulty(level);
  const brain = ensureBotBrain(room);
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

  const pressure = getScorePressure(room, storyteller.id);
  const guessRate = getStoryGuessRate(room, storyteller.id);

  const adaptiveTargetRatio = clamp(
    config.targetAmbiguity
      + (pressure.isLeading ? 0.12 : -0.08)
      + (guessRate > 0.68 ? 0.12 : guessRate < 0.32 ? -0.08 : 0),
    0.1,
    0.92,
  );
  const targetAmbiguity = clamp(
    Math.round(opponents.length * adaptiveTargetRatio),
    opponents.length > 1 ? 1 : 0,
    Math.max(opponents.length - 1, 0),
  );
  const ambiguityPenalty = Math.abs(strongOpponents - targetAmbiguity) * 1.25;

  const adaptiveDesiredLead = clamp(
    config.desiredLead
      + (pressure.isLeading ? -0.08 : 0.1)
      + (guessRate > 0.68 ? -0.05 : guessRate < 0.32 ? 0.07 : 0),
    -0.22,
    0.9,
  );
  const lead = ownScore - bestOpponentScore;
  const leadPenalty = Math.abs(lead - adaptiveDesiredLead) * 1.85;

  const noveltyPenalty = clueNoveltyPenalty(room, clue);
  const clarityPenalty = ownScore < config.minOwnScore ? (config.minOwnScore - ownScore) * 2.3 : 0;

  const clueTokens = tokenize(clue);
  const wordCount = clueTokens.length;
  let naturalBonus = 0.15;
  if (wordCount >= 2 && wordCount <= 6) naturalBonus += 0.35;
  if (clue.length >= 12 && clue.length <= 46) naturalBonus += 0.2;
  if (clue.includes(':') || clue.includes(',')) naturalBonus += 0.07;

  const profile = getCardProfile(cardPath);
  let coherenceBonus = 0;
  const normalizedClue = normalizeText(clue);
  if (normalizedClue.includes(normalizeText(profile.theme))) coherenceBonus += 0.24;
  if (normalizedClue.includes(normalizeText(profile.mood))) coherenceBonus += 0.2;
  if (normalizedClue.includes(normalizeText(singularize(profile.element)))) coherenceBonus += 0.16;

  let rareTokenBonus = 0;
  for (const token of clueTokens) {
    const usage = brain.globalTokenUse?.[token] || 0;
    if (usage <= 1) rareTokenBonus += 0.1;
    else if (usage <= 3) rareTokenBonus += 0.04;
    else rareTokenBonus -= 0.03;
  }
  rareTokenBonus = clamp(rareTokenBonus, -0.2, 0.35);

  const creativityDiscriminationBalance =
    rareTokenBonus * config.creativityWeight + coherenceBonus * config.discriminationWeight;

  const quality = ownScore * 2.2
    - ambiguityPenalty
    - leadPenalty
    - noveltyPenalty
    - clarityPenalty
    + naturalBonus
    + creativityDiscriminationBalance
    + Math.random() * 0.04;

  return {
    quality,
    ownScore,
    targetAmbiguity,
    isLeading: pressure.isLeading,
    isBehind: pressure.gapToLead > 0,
  };
}

function selectStorytellerPlan(room, storyteller, level = storyteller?.difficulty || 'normal') {
  if (!storyteller || !Array.isArray(storyteller.hand) || storyteller.hand.length === 0) return null;

  const options = [];
  for (const card of storyteller.hand) {
    const candidates = buildBotClueCandidates(room, storyteller, card);
    for (const candidate of candidates) {
      const evaluated = evaluateStoryCandidate(room, storyteller, card, candidate.clue, level);
      options.push({
        card,
        clue: candidate.clue,
        quality: evaluated.quality,
        profile: candidate.profile,
        persona: candidate.persona,
        meta: evaluated,
      });
    }
  }
  if (options.length === 0) return null;

  const config = getBotDifficulty(level);
  const shortlist = options
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 8);
  const selected = softmaxPick(shortlist, (option) => option.quality, config.storyTemperature) || shortlist[0];
  return {
    card: selected.card,
    clue: selected.clue,
    reason: buildBotReason(selected.profile, selected.persona, selected.clue, selected.meta),
  };
}

function chooseBotSubmissionCard(room, bot, level = bot?.difficulty || 'normal') {
  if (!bot || !Array.isArray(bot.hand) || bot.hand.length === 0) return null;
  const config = getBotDifficulty(level);
  const brain = ensureBotBrain(room);
  const recentCards = brain.recentCardsByBot[bot.id] || [];
  const pressure = getScorePressure(room, bot.id);
  const storytellerTokens = brain.storyTokensByPlayer?.[room.storytellerId] || {};

  const scoredRaw = bot.hand.map((card) => {
    const similarity = scoreCardForClue(room.clue, card);
    const profile = getCardProfile(card);
    const styleAffinity = weightedProfileAffinity(profile.tokens, storytellerTokens);
    const repeatPenalty = recentCards.includes(card) ? 0.45 : 0;
    return {
      card,
      score: similarity + styleAffinity * 0.06 - repeatPenalty,
    };
  });

  if (Math.random() < config.randomSubmitChance) {
    return pickRandom(bot.hand) || bot.hand[0];
  }

  const rawValues = scoredRaw.map((entry) => entry.score);
  const minRaw = Math.min(...rawValues);
  const maxRaw = Math.max(...rawValues);
  const span = Math.max(maxRaw - minRaw, 0.01);
  const targetPosition = pressure.isLeading
    ? 0.62
    : pressure.gapToLead >= 3
      ? 0.9
      : 0.78;
  const tacticalWeight = pressure.isLeading ? 0.45 : 0.22;
  const scored = scoredRaw.map((entry) => {
    const normalized = (entry.score - minRaw) / span;
    const tacticalPenalty = Math.abs(normalized - targetPosition) * tacticalWeight;
    return {
      card: entry.card,
      score: entry.score - tacticalPenalty + Math.random() * 0.04,
    };
  });

  const adaptiveTemp = clamp(
    config.submitTemperature + (pressure.isLeading ? 0.12 : -0.08),
    0.18,
    1.9,
  );
  const selected = softmaxPick(scored, (entry) => entry.score, adaptiveTemp) || scored[0];
  return selected.card;
}

function chooseBotVote(room, bot, level = bot?.difficulty || 'normal') {
  const choices = room.shuffledSubmissions.filter((submission) => submission.playerId !== bot.id);
  if (choices.length === 0) return null;
  const config = getBotDifficulty(level);
  const brain = ensureBotBrain(room);
  const pressure = getScorePressure(room, bot.id);
  const storytellerTokens = brain.storyTokensByPlayer?.[room.storytellerId] || {};

  if (Math.random() < config.randomVoteChance) {
    return pickRandom(choices) || choices[0];
  }

  const scored = choices.map((choice) => ({
    choice,
    score: (() => {
      const similarity = scoreCardForClue(room.clue, choice.card);
      const profile = getCardProfile(choice.card);
      const styleAffinity = weightedProfileAffinity(profile.tokens, storytellerTokens) * 0.05;
      const ownerVoteTrend = brain.recentVotesByOwner?.[choice.playerId] || 0;
      const storytellerBoost = choice.playerId === room.storytellerId ? 0.32 : 0;
      const decoyPenalty = choice.playerId === room.storytellerId ? 0 : Math.min(ownerVoteTrend * 0.12, 0.45);
      const comebackBias = pressure.gapToLead >= 3 && choice.playerId === room.storytellerId ? 0.06 : 0;
      return similarity + storytellerBoost + styleAffinity - decoyPenalty + comebackBias + Math.random() * 0.03;
    })(),
  }));
  const adaptiveTemp = clamp(
    config.voteTemperature + (pressure.isLeading ? 0.2 : -0.12),
    0.15,
    2.1,
  );
  const selected = softmaxPick(scored, (entry) => entry.score, adaptiveTemp) || scored[0];
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
  const tokens = tokenize(normalized);
  for (const token of tokens) {
    brain.globalTokenUse[token] = Math.min((brain.globalTokenUse[token] || 0) + 0.35, 400);
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

  const storytellerId = room.storytellerId;
  const storytellerSubmission = room.submissions.find((submission) => submission.playerId === storytellerId);
  if (storytellerId && storytellerSubmission) {
    const votesToStoryteller = votesBySubmission.get(storytellerSubmission.id) || 0;
    const totalVoters = Math.max(room.players.size - 1, 1);
    const guessRate = clamp(votesToStoryteller / totalVoters, 0, 1);
    const current = brain.storyGuessRateByPlayer[storytellerId];
    brain.storyGuessRateByPlayer[storytellerId] = typeof current === 'number'
      ? current * 0.7 + guessRate * 0.3
      : guessRate;
  }

  const clueTokens = tokenize(room.clue || '');
  if (storytellerId && clueTokens.length > 0) {
    const tokenMap = brain.storyTokensByPlayer[storytellerId] || {};

    for (const token of Object.keys(tokenMap)) {
      tokenMap[token] *= 0.9;
      if (tokenMap[token] < 0.08) delete tokenMap[token];
    }
    for (const token of clueTokens) {
      tokenMap[token] = Math.min((tokenMap[token] || 0) + 1, 8);
      brain.globalTokenUse[token] = Math.min((brain.globalTokenUse[token] || 0) + 1, 400);
    }
    brain.storyTokensByPlayer[storytellerId] = tokenMap;
  }

  if (Object.keys(brain.globalTokenUse).length > 220) {
    for (const token of Object.keys(brain.globalTokenUse)) {
      brain.globalTokenUse[token] *= 0.96;
      if (brain.globalTokenUse[token] < 0.25) delete brain.globalTokenUse[token];
    }
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
  room.clueAudio = '';
  room.submissions = [{ id: submissionId, playerId: storyteller.id, card: plan.card }];
  room.shuffledSubmissions = [];
  room.votes = [];
  room.phase = 'submit';
  room.phaseStartedAt = Date.now();
  rememberClueMemory(room, storyteller.id, room.clue);
  return true;
}

function moveToVotePhase(room) {
  const expected = room.players.size;
  if (expected <= 0 || room.submissions.length < expected) return false;
  room.shuffledSubmissions = shuffle(room.submissions);
  room.phase = 'vote';
  room.phaseStartedAt = Date.now();
  for (const player of room.players.values()) player.votedFor = null;
  return true;
}

function moveToRevealPhase(room) {
  const votesNeeded = room.players.size - 1;
  if (votesNeeded <= 0 || room.votes.length < votesNeeded) return false;
  computeScores(room);
  room.phase = 'reveal';
  room.phaseStartedAt = Date.now();
  room.discard.push(...room.submissions.map((submission) => submission.card));
  if (room.summary) {
    room.summary.votesDetail = room.votes.map((vote) => ({ playerId: vote.playerId, submissionId: vote.submissionId }));
  }
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
    })),
    order: room.order,
    hostId: room.hostId,
    storytellerId: room.storytellerId,
    phase: room.phase,
    round: room.round,
    clue: room.clue,
    clueReason: room.clueReason,
    clueAudio: room.clueAudio || '',
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

function isPlayerConnected(player) {
  if (!player || !player.connected || player.isBot) return false;
  if (!player.ws) return false;
  return player.ws.readyState === player.ws.OPEN;
}

function pickConnectedHost(room) {
  if (!room || !Array.isArray(room.order)) return null;
  for (const id of room.order) {
    const candidate = room.players.get(id);
    if (isPlayerConnected(candidate)) return id;
  }
  return null;
}

function ensureHostId(room) {
  if (!room) return null;
  const currentHost = room.players.get(room.hostId);
  if (isPlayerConnected(currentHost)) {
    return room.hostId;
  }
  const nextHost = pickConnectedHost(room);
  room.hostId = nextHost;
  return nextHost;
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
        clueAudio: r.clueAudio || '',
        summary: r.summary ? { ...r.summary, clueAudio: r.summary.clueAudio || '' } : null,
        mode: r.mode || 'classic',
        drinkLevel: r.drinkLevel || 'light',
        botBrain: createBotBrain(),
      };
      r.players.forEach(p => {
        room.players.set(p.id, { ...p, ws: null, connected: false });
      });
      ensureHostId(room);
      for (const player of room.players.values()) {
        if (player.isBot) resolveBotPersona(room, player);
      }
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
    clueAudio: '',
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
    drinkLevel: 'light',
    botBrain: createBotBrain(),
  };
  rooms.set(roomCode, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code);
}

function endRoom(room, endedBy = 'host') {
  if (!room || !rooms.has(room.code)) return false;
  room.active = false;
  const payload = { type: 'ended', roomCode: room.code, endedBy };
  for (const participant of room.players.values()) {
    if (participant.ws) {
      send(participant.ws, payload);
    }
    participant.connected = false;
    participant.ws = null;
  }
  rooms.delete(room.code);
  saveRooms();
  return true;
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
  room.clueAudio = '';
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
  room.botBrain = createBotBrain();
  resetRound(room);
  room.phase = 'clue';
  room.phaseStartedAt = Date.now();
}

function ensureBotActions(room) {
  if (room.players.size === 0) return;
  ensureBotBrain(room);
  if (!room.storytellerId || !room.players.has(room.storytellerId)) {
    room.storytellerId = rotateStoryteller(room);
  }

  const elapsed = Date.now() - (room.phaseStartedAt || Date.now());
  const expired = elapsed > room.turnSeconds * 1000;

  // Storyteller bot submits clue automatically.
  const storyteller = room.players.get(room.storytellerId);
  if (room.phase === 'clue' && storyteller?.isBot) {
    const plan = selectStorytellerPlan(room, storyteller, storyteller.difficulty || 'normal');
    if (plan) {
      applyStorytellerPlan(room, storyteller, plan);
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
        }
      }
    }
    moveToVotePhase(room);
  }

  // Bots vote in vote phase.
  if (room.phase === 'vote') {
    for (const p of room.players.values()) {
      if (p.isBot && p.id !== room.storytellerId && !p.votedFor) {
        const choice = chooseBotVote(room, p, p.difficulty || 'normal');
        if (choice) {
          p.votedFor = choice.id;
          room.votes.push({ playerId: p.id, submissionId: choice.id });
        }
      }
    }
    moveToRevealPhase(room);
  }

  // Auto-advance on timer expiry.
  if (expired) {
    if (room.phase === 'clue' && room.submissions.length === 0) {
      const st = room.players.get(room.storytellerId);
      if (st && st.hand.length > 0) {
        const timeoutLevel = st.isBot ? (st.difficulty || 'normal') : 'normal';
        const plan = selectStorytellerPlan(room, st, timeoutLevel);
        if (plan) {
          applyStorytellerPlan(room, st, plan);
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
        }
      }
      moveToVotePhase(room);
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
        }
      }
      moveToRevealPhase(room);
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
  const persona = BOT_PERSONALITIES[hashString(`${room.code}:${id}`) % BOT_PERSONALITIES.length].id;
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
    difficulty: BOT_LEVELS.includes(difficulty) ? difficulty : 'normal',
    persona,
  };
  room.players.set(id, player);
  room.order.push(id);
  ensureBotBrain(room).botPersonaById[id] = persona;
  if (!room.hostId) room.hostId = id;
  return player;
}

function pickNextHost(room) {
  return pickConnectedHost(room);
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
  if (room.botBrain) {
    delete room.botBrain.botPersonaById?.[playerId];
    delete room.botBrain.recentVotesByOwner?.[playerId];
    delete room.botBrain.recentCardsByBot?.[playerId];
    delete room.botBrain.storyGuessRateByPlayer?.[playerId];
    delete room.botBrain.storyTokensByPlayer?.[playerId];
  }

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
    room.clueAudio = '';
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
    clueAudio: room.clueAudio || '',
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
    clueAudio: room.clueAudio || '',
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
      connected: isPlayerConnected(p),
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
  ensureHostId(room);
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
        if (!room.hostId) room.hostId = existing.id;
        ensureHostId(room);
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

    if (type === 'end_room' || type === 'delete_room') {
      const targetCode = msg.roomCode ? normalizeRoomCode(msg.roomCode) : currentRoom?.code || null;
      const target = targetCode ? rooms.get(targetCode) : null;
      if (!target) {
        send(ws, { type: 'error', message: 'Sala no encontrada.' });
        return;
      }
      ensureHostId(target);

      const player = currentRoom && currentPlayerId ? currentRoom.players.get(currentPlayerId) : null;
      const canEndAsHost = Boolean(player && target.hostId === player.id);
      const canEndAsAdmin = msg.password?.toString() === ROOM_ADMIN_PASSWORD;
      const canEnd = canEndAsHost || canEndAsAdmin;
      if (!canEnd) {
        send(ws, { type: 'error', message: 'No autorizado para eliminar la sala.' });
        return;
      }

      endRoom(target, canEndAsHost ? 'host' : 'admin');

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
    ensureHostId(room);

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
        room.clueAudio = '';
        room.phaseStartedAt = Date.now();
        room.botBrain = createBotBrain();
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
        room.clueAudio = '';
        room.phaseStartedAt = Date.now();
        room.botBrain = createBotBrain();
        for (const participant of room.players.values()) {
          if (participant.isBot) {
            resolveBotPersona(room, participant);
          }
        }
        refillHands(room);
        broadcast(room);
        break;
      }
      case 'submit_clue': {
        if (room.phase !== 'clue' || room.storytellerId !== player.id) return;
        const card = msg.card;
        const clue = (msg.clue || '').toString().trim().slice(0, 80);
        const clueAudio = roomAllowsAudioClue(room) ? sanitizeClueAudioDataUrl(msg.clueAudio || '') : '';
        if (!card || !player.hand.includes(card)) return;
        if (!clue && !clueAudio) return;
        // remove card from hand
        player.hand = player.hand.filter(c => c !== card);
        const submissionId = crypto.randomUUID();
        player.submittedCardId = submissionId;
        room.clue = cleanClue(clue || CLUE_AUDIO_FALLBACK_TEXT);
        room.clueReason = '';
        room.clueAudio = clueAudio;
        room.submissions = [{ id: submissionId, playerId: player.id, card }];
        room.shuffledSubmissions = [];
        room.votes = [];
        room.phase = 'submit';
        room.phaseStartedAt = Date.now();
        rememberClueMemory(room, player.id, room.clue);
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
        moveToVotePhase(room);
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
        moveToRevealPhase(room);
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
    players: Array.from(r.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: isPlayerConnected(p)
    }))
  }));
  res.json(list);
});

app.delete('/api/rooms/:roomCode', (req, res) => {
  const roomCode = normalizeRoomCode(req.params.roomCode);
  if (!roomCode) {
    return res.status(400).json({ error: 'Código de sala inválido.' });
  }

  const room = rooms.get(roomCode);
  if (!room) {
    return res.status(404).json({ error: 'Sala no encontrada.' });
  }

  const bodyPassword = typeof req.body?.password === 'string' ? req.body.password : null;
  const queryPassword = typeof req.query?.password === 'string' ? req.query.password : null;
  const headerPassword = typeof req.headers['x-room-password'] === 'string' ? req.headers['x-room-password'] : null;
  const providedPassword = bodyPassword || queryPassword || headerPassword;

  if (providedPassword !== ROOM_ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'No autorizado para eliminar la sala.' });
  }

  endRoom(room, 'admin_api');
  return res.json({ ok: true, roomCode });
});
