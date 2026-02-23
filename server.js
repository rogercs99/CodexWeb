require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const execFileAsync = util.promisify(execFile);
const app = express();
const port = process.env.PORT || 3000;
const codexCmd = process.env.CODEX_CMD || 'codex';

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const encryptionSecret = process.env.ENCRYPTION_SECRET || crypto.randomBytes(32).toString('hex');

const db = new Database('app.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_secrets (
  user_id INTEGER PRIMARY KEY,
  openai_key_enc TEXT NOT NULL,
  anthropic_key_enc TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

function deriveKey() {
  return crypto.createHash('sha256').update(encryptionSecret).digest();
}

function encryptText(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptText(payload) {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"]
      }
    }
  })
);

app.use(express.json());
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Usuario y contraseña (mínimo 8) son obligatorios' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    const result = stmt.run(username.trim(), passwordHash);
    req.session.userId = result.lastInsertRowid;
    req.session.username = username.trim();
    return res.json({ ok: true, username: req.session.username });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'El usuario ya existe' });
    }
    return res.status(500).json({ error: 'No se pudo registrar' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username.trim());
  if (!user) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  return res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }
  const secret = db.prepare('SELECT user_id FROM user_secrets WHERE user_id = ?').get(req.session.userId);
  return res.json({
    authenticated: true,
    username: req.session.username,
    hasKeys: Boolean(secret)
  });
});

app.post('/api/keys', requireAuth, (req, res) => {
  const { openaiKey, anthropicKey } = req.body;
  if (!openaiKey) {
    return res.status(400).json({ error: 'Debes introducir al menos OPENAI_API_KEY' });
  }

  const openaiEnc = encryptText(openaiKey);
  const anthropicEnc = anthropicKey ? encryptText(anthropicKey) : null;

  const upsert = db.prepare(`
    INSERT INTO user_secrets (user_id, openai_key_enc, anthropic_key_enc, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      openai_key_enc = excluded.openai_key_enc,
      anthropic_key_enc = excluded.anthropic_key_enc,
      updated_at = CURRENT_TIMESTAMP
  `);

  upsert.run(req.session.userId, openaiEnc, anthropicEnc);
  return res.json({ ok: true });
});

app.post('/api/chat', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }

  const secretRow = db
    .prepare('SELECT openai_key_enc, anthropic_key_enc FROM user_secrets WHERE user_id = ?')
    .get(req.session.userId);

  if (!secretRow) {
    return res.status(400).json({ error: 'Configura tus API keys antes de usar el chat' });
  }

  const env = {
    ...process.env,
    OPENAI_API_KEY: decryptText(secretRow.openai_key_enc)
  };

  if (secretRow.anthropic_key_enc) {
    env.ANTHROPIC_API_KEY = decryptText(secretRow.anthropic_key_enc);
  }

  try {
    const { stdout, stderr } = await execFileAsync(codexCmd, ['--prompt', message.trim()], {
      env,
      timeout: 120000,
      maxBuffer: 1024 * 1024
    });

    if (stderr && stderr.trim()) {
      return res.json({ reply: stdout.trim(), warning: stderr.trim() });
    }

    return res.json({ reply: stdout.trim() || 'Codex no devolvió contenido.' });
  } catch (error) {
    return res.status(500).json({
      error: 'Error ejecutando Codex local',
      details: error.stderr?.toString() || error.message
    });
  }
});

app.listen(port, () => {
  console.log(`CodexWeb escuchando en http://localhost:${port}`);
});
