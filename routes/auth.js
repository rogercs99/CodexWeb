'use strict';
const bcrypt = require('bcryptjs');

module.exports = function setupAuthRoutes(app, {
  db,
  notify,
  truncateForNotify,
  requireAuth,
  getUserNotificationSettings,
  getRestartStatusPayload,
  updateUserNotificationSettingsStmt,
  sanitizeDiscordWebhookUrl,
  defaultWebhookUrl,
  parseBooleanSetting,
}) {
  app.post('/api/register', async (req, res) => {
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const username = rawUsername.trim();
    const password = rawPassword;
    const safeUsername = truncateForNotify(username || rawUsername);

    if (!username || !password) {
      void notify(`REGISTER failed username=${safeUsername} reason=missing_fields`);
      return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });
    }
    if (username.length < 3 || username.length > 48) {
      void notify(`REGISTER failed username=${safeUsername} reason=invalid_username_length`);
      return res.status(400).json({ error: 'El usuario debe tener entre 3 y 48 caracteres' });
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      void notify(`REGISTER failed username=${safeUsername} reason=invalid_username_chars`);
      return res.status(400).json({ error: 'Usuario inválido (usa letras, números, punto, guion o guion bajo)' });
    }
    if (password.length < 8) {
      void notify(`REGISTER failed username=${safeUsername} reason=weak_password`);
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    try {
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        void notify(`REGISTER failed username=${safeUsername} reason=already_exists`);
        return res.status(409).json({ error: 'Ese usuario ya existe' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const created = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
      const userId = Number(created.lastInsertRowid);
      req.session.userId = userId;
      req.session.username = username;
      void notify(`REGISTER ok username=${safeUsername}`);
      return res.status(201).json({ ok: true, username });
    } catch (error) {
      const reason = truncateForNotify(error && error.message ? error.message : 'register_error', 180);
      void notify(`REGISTER failed username=${safeUsername} reason=${reason}`);
      return res.status(500).json({ error: 'No se pudo crear la cuenta' });
    }
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const requestedUsername = truncateForNotify(username);
    if (!username || !password) {
      void notify(`LOGIN failed username=${requestedUsername} reason=missing_fields`);
      return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });
    }

    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username.trim());
    if (!user) {
      void notify(`LOGIN failed username=${requestedUsername} reason=invalid_credentials`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      void notify(`LOGIN failed username=${requestedUsername} reason=invalid_credentials`);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    void notify(`LOGIN ok username=${truncateForNotify(user.username)}`);
    return res.json({ ok: true, username: user.username });
  });

  app.post('/api/logout', (req, res) => {
    const username = truncateForNotify(req.session && req.session.username ? req.session.username : 'anon');
    req.session.destroy(() => {
      void notify(`LOGOUT ok username=${username}`);
      res.json({ ok: true });
    });
  });

  app.get('/api/restart/status', (_req, res) => {
    return res.json({
      ok: true,
      restart: getRestartStatusPayload(),
      pid: process.pid
    });
  });

  app.get('/api/me', (req, res) => {
    if (!req.session.userId) {
      return res.json({ authenticated: false, user: null });
    }
    return res.json({
      authenticated: true,
      user: {
        id: req.session.userId,
        username: req.session.username
      }
    });
  });

  app.get('/api/settings/notifications', requireAuth, (req, res) => {
    const notifications = getUserNotificationSettings(req.session.userId);
    return res.json({ ok: true, notifications });
  });

  app.patch('/api/settings/notifications', requireAuth, (req, res) => {
    const currentSettings = getUserNotificationSettings(req.session.userId);
    const webhookWasProvided =
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'discordWebhookUrl');
    const notifyWasProvided =
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'notifyOnFinish');
    const includeWasProvided =
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'includeResult');

    const rawWebhookUrl = webhookWasProvided ? req.body.discordWebhookUrl : currentSettings.discordWebhookUrl;
    if (webhookWasProvided && typeof rawWebhookUrl !== 'string') {
      return res.status(400).json({ error: 'Webhook de Discord inválido' });
    }
    const normalizedWebhook = sanitizeDiscordWebhookUrl(rawWebhookUrl, '');
    if (webhookWasProvided && String(rawWebhookUrl || '').trim() && !normalizedWebhook) {
      return res.status(400).json({ error: 'Webhook de Discord inválido' });
    }

    let notifyOnFinish = currentSettings.notifyOnFinish;
    if (notifyWasProvided) {
      const rawNotify = req.body.notifyOnFinish;
      const rawType = typeof rawNotify;
      if (
        !(
          rawType === 'boolean' ||
          rawNotify === 0 ||
          rawNotify === 1 ||
          rawNotify === '0' ||
          rawNotify === '1'
        )
      ) {
        return res.status(400).json({ error: 'Valor inválido para notifyOnFinish' });
      }
      notifyOnFinish = parseBooleanSetting(rawNotify, currentSettings.notifyOnFinish);
    }

    let includeResult = currentSettings.includeResult;
    if (includeWasProvided) {
      const rawInclude = req.body.includeResult;
      const rawType = typeof rawInclude;
      if (
        !(
          rawType === 'boolean' ||
          rawInclude === 0 ||
          rawInclude === 1 ||
          rawInclude === '0' ||
          rawInclude === '1'
        )
      ) {
        return res.status(400).json({ error: 'Valor inválido para includeResult' });
      }
      includeResult = parseBooleanSetting(rawInclude, currentSettings.includeResult);
    }

    if (notifyOnFinish && !sanitizeDiscordWebhookUrl(normalizedWebhook, defaultWebhookUrl)) {
      return res.status(400).json({ error: 'Configura un webhook de Discord antes de habilitar notificaciones' });
    }

    updateUserNotificationSettingsStmt.run(
      normalizedWebhook,
      notifyOnFinish ? 1 : 0,
      includeResult ? 1 : 0,
      req.session.userId
    );
    const notifications = getUserNotificationSettings(req.session.userId);
    return res.json({ ok: true, notifications });
  });
};
