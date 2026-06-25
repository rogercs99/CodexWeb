'use strict';
const tokenSaver = require('../tokenSaver');

module.exports = function setupTokenSaverRoutes(app, {
  requireAuth,
  tsStmts,
  getTsGlobalSettings,
  getTsChatSettings,
  getEffectiveTsSettings,
  nowIso,
  getConversationStmt,
  listMessagesStmt,
  getRecentProjectsStmt,
  sanitizePreview,
  getSafeUserId,
}) {
  app.get('/api/token-saver/presets', requireAuth, (req, res) => {
    const presets = Object.entries(tokenSaver.PRESETS).map(([key, val]) => ({
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      description: val.description || '',
      settings: { ...val }
    }));
    return res.json({ ok: true, presets });
  });

  app.get('/api/token-saver/settings', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const global = getTsGlobalSettings(userId);
    const effective = tokenSaver.resolveEffectiveSettings(global, null);
    return res.json({ ok: true, settings: global, effective });
  });

  app.put('/api/token-saver/settings', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const body = req.body || {};
    const mode = tokenSaver.normalizeMode(body.mode);
    const { mode: _m, ...rest } = body;
    const settingsJson = JSON.stringify(rest);
    tsStmts.upsertGlobal.run(userId, mode, settingsJson, nowIso());
    const updated = getTsGlobalSettings(userId);
    return res.json({ ok: true, settings: updated });
  });

  app.get('/api/token-saver/settings/effective', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const chatId = req.query.chatId ? Number(req.query.chatId) : null;
    const effective = getEffectiveTsSettings(userId, chatId);
    return res.json({ ok: true, effective, chatId });
  });

  app.put('/api/token-saver/chats/:chatId/settings', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const chatId = Number(req.params.chatId);
    if (!Number.isInteger(chatId) || chatId <= 0) {
      return res.status(400).json({ error: 'chatId inválido' });
    }
    const body = req.body || {};
    const mode = tokenSaver.normalizeMode(body.mode);
    const { mode: _m, ...rest } = body;
    tsStmts.upsertChat.run(userId, chatId, mode, JSON.stringify(rest), nowIso());
    const effective = getEffectiveTsSettings(userId, chatId);
    return res.json({ ok: true, effective });
  });

  app.delete('/api/token-saver/chats/:chatId/settings', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const chatId = Number(req.params.chatId);
    if (!Number.isInteger(chatId) || chatId <= 0) {
      return res.status(400).json({ error: 'chatId inválido' });
    }
    tsStmts.deleteChat.run(userId, chatId);
    return res.json({ ok: true });
  });

  app.get('/api/token-saver/status', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const settings = getTsGlobalSettings(userId);
    const metrics = tsStmts.getMetrics.get(userId);
    const totalBefore = Number((metrics && metrics.total_tokens_before) || 0);
    const totalAfter = Number((metrics && metrics.total_tokens_after) || 0);
    const savings = Math.max(0, totalBefore - totalAfter);
    const savingsPercent = totalBefore > 0 ? Math.round((savings / totalBefore) * 100) : 0;
    return res.json({
      ok: true,
      enabled: settings.enabled !== false,
      mode: settings.mode || tokenSaver.DEFAULT_PRESET,
      version: tokenSaver.VERSION,
      metrics: {
        totalRequests: Number((metrics && metrics.total_requests) || 0),
        totalTokensBefore: totalBefore,
        totalTokensAfter: totalAfter,
        totalSavings: savings,
        savingsPercent,
        lastRequestAt: (metrics && metrics.last_request_at) || null
      }
    });
  });

  app.get('/api/token-saver/usage', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const metrics = tsStmts.getMetrics.get(userId);
    const totalBefore = Number((metrics && metrics.total_tokens_before) || 0);
    const totalAfter = Number((metrics && metrics.total_tokens_after) || 0);
    const savings = Math.max(0, totalBefore - totalAfter);
    const savingsPercent = totalBefore > 0 ? Math.round((savings / totalBefore) * 100) : 0;
    return res.json({
      ok: true,
      totalRequests: Number((metrics && metrics.total_requests) || 0),
      totalTokensBefore: totalBefore,
      totalTokensAfter: totalAfter,
      totalSavings: savings,
      savingsPercent,
      lastRequestAt: (metrics && metrics.last_request_at) || null
    });
  });

  app.get('/api/token-saver/chats/:chatId/stats', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const chatId = Number(req.params.chatId);
    if (!Number.isInteger(chatId) || chatId <= 0) {
      return res.status(400).json({ error: 'chatId inválido' });
    }
    const metrics = tsStmts.getMetricsForChat.get(userId, chatId);
    const settings = getEffectiveTsSettings(userId, chatId);
    const totalBefore = Number((metrics && metrics.total_tokens_before) || 0);
    const totalAfter = Number((metrics && metrics.total_tokens_after) || 0);
    const savings = Math.max(0, totalBefore - totalAfter);
    const savingsPercent = totalBefore > 0 ? Math.round((savings / totalBefore) * 100) : 0;
    return res.json({
      ok: true,
      chatId,
      effectiveSettings: settings,
      metrics: {
        totalRequests: Number((metrics && metrics.total_requests) || 0),
        totalTokensBefore: totalBefore,
        totalTokensAfter: totalAfter,
        totalSavings: savings,
        savingsPercent,
        lastRequestAt: (metrics && metrics.last_request_at) || null
      }
    });
  });

  app.post('/api/token-saver/preview', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const body = req.body || {};
    const chatId = body.chatId ? Number(body.chatId) : null;
    const currentPrompt = String(body.prompt || '').slice(0, 4000);
    if (!chatId || !Number.isInteger(chatId) || chatId <= 0) {
      return res.status(400).json({ error: 'chatId requerido' });
    }
    const conversation = getConversationStmt.get(chatId);
    if (!conversation) {
      return res.status(404).json({ error: 'Chat no encontrado' });
    }
    if (Number(conversation.user_id) !== Number(userId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const messages = listMessagesStmt.all(chatId);
    const settings = getEffectiveTsSettings(userId, chatId);
    const result = tokenSaver.buildOptimizedContext(messages, settings, currentPrompt);
    const breakdown = {
      mode: settings.mode,
      enabled: settings.enabled,
      sections: result.sections,
      estimatedTokensBefore: result.estimatedTokensBefore,
      estimatedTokensAfter: result.estimatedTokensAfter,
      estimatedSavings: result.estimatedSavings,
      savingsPercent: result.savingsPercent,
      messagesTotal: messages.length,
      messagesIncluded: result.messages.length,
      messagesSkipped: messages.length - result.messages.length
    };
    return res.json({ ok: true, breakdown });
  });

  app.post('/api/token-saver/presets/reset', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const mode = tokenSaver.normalizeMode((req.body && req.body.mode) || tokenSaver.DEFAULT_PRESET);
    const preset = tokenSaver.PRESETS[mode] || tokenSaver.PRESETS[tokenSaver.DEFAULT_PRESET];
    const { description: _d, ...settingsOnly } = preset;
    tsStmts.upsertGlobal.run(userId, mode, JSON.stringify(settingsOnly), nowIso());
    const updated = getTsGlobalSettings(userId);
    return res.json({ ok: true, settings: updated });
  });

  app.post('/api/token-saver/cache/clear', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const cutoff = new Date(Date.now() - 86400 * 1000).toISOString();
    tsStmts.pruneMetrics.run(userId, cutoff);
    return res.json({ ok: true, message: 'Métricas antiguas purgadas' });
  });

  // GET /api/projects/recent?limit=10
  app.get('/api/projects/recent', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const safeUserId = getSafeUserId(userId);
    if (!safeUserId) {
      return res.status(400).json({ error: 'user_id inválido' });
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 50 ? limitRaw : 10;
    const rows = getRecentProjectsStmt.all(safeUserId, limit);
    const globalSettings = getTsGlobalSettings(safeUserId);
    const projects = rows.map((row) => {
      const projectId = Number(row.project_id);
      const chatSettings = getTsChatSettings(safeUserId, row.last_chat_id);
      const effectiveTs = tokenSaver.resolveEffectiveSettings(globalSettings, chatSettings);
      return {
        projectId,
        name: String(row.project_name || ''),
        lastChatId: row.last_chat_id ? Number(row.last_chat_id) : null,
        lastChatTitle: String(row.last_chat_title || ''),
        lastMessagePreview: sanitizePreview(row.last_message_raw),
        lastActivityAt: row.last_activity_at || row.project_updated_at || '',
        chatCount: Number(row.chat_count || 0),
        tokenSaverMode: effectiveTs.mode || tokenSaver.DEFAULT_PRESET,
        tokenSaverEnabled: effectiveTs.enabled !== false,
        status: 'idle'
      };
    });
    return res.json({ ok: true, projects });
  });
};
