'use strict';

// TokenSaverEngine - Context Budget Engine for CodexWeb
// Reduces token usage across all providers via configurable context windowing,
// tool output compression, and compact chat memory.

const TOKEN_SAVER_VERSION = '1.0.0';

// ─── Presets ─────────────────────────────────────────────────────────────────

const PRESETS = {
  off: {
    enabled: false,
    mode: 'off',
    recentMessagesCount: 200,
    recentMessagesMaxChars: 200000,
    maxContextTokens: 100000,
    maxOutputTokens: null,
    brevityInstruction: false,
    autoSummarizeEnabled: false,
    autoSummarizeThreshold: 0,
    chatMemoryEnabled: false,
    chatMemoryMaxChars: 0,
    projectContextEnabled: true,
    projectContextMaxChars: 12000,
    toolOutputCompressionEnabled: false,
    toolOutputMaxChars: 50000,
    toolOutputKeepHeadChars: 10000,
    toolOutputKeepTailChars: 10000,
    retrievalEnabled: false,
    maxRetrievedSnippets: 0,
    maxSnippetChars: 0,
    showTokenStatsInChat: false,
    description: 'Sin optimización. Solo para debugging.'
  },
  balanced: {
    enabled: true,
    mode: 'balanced',
    recentMessagesCount: 20,
    recentMessagesMaxChars: 24000,
    maxContextTokens: 12000,
    maxOutputTokens: 2048,
    brevityInstruction: true,
    autoSummarizeEnabled: false,
    autoSummarizeThreshold: 30,
    chatMemoryEnabled: true,
    chatMemoryMaxChars: 6000,
    projectContextEnabled: true,
    projectContextMaxChars: 8000,
    toolOutputCompressionEnabled: true,
    toolOutputMaxChars: 8000,
    toolOutputKeepHeadChars: 2000,
    toolOutputKeepTailChars: 4000,
    retrievalEnabled: false,
    maxRetrievedSnippets: 4,
    maxSnippetChars: 1200,
    showTokenStatsInChat: false,
    description: 'Balance entre contexto completo y ahorro de tokens.'
  },
  aggressive: {
    enabled: true,
    mode: 'aggressive',
    recentMessagesCount: 12,
    recentMessagesMaxChars: 12000,
    maxContextTokens: 6000,
    maxOutputTokens: 1024,
    brevityInstruction: true,
    autoSummarizeEnabled: true,
    autoSummarizeThreshold: 20,
    chatMemoryEnabled: true,
    chatMemoryMaxChars: 4000,
    projectContextEnabled: true,
    projectContextMaxChars: 3000,
    toolOutputCompressionEnabled: true,
    toolOutputMaxChars: 3000,
    toolOutputKeepHeadChars: 800,
    toolOutputKeepTailChars: 1800,
    retrievalEnabled: false,
    maxRetrievedSnippets: 8,
    maxSnippetChars: 1200,
    showTokenStatsInChat: true,
    description: 'Ahorro agresivo. Recomendado por defecto.'
  },
  extreme: {
    enabled: true,
    mode: 'extreme',
    recentMessagesCount: 6,
    recentMessagesMaxChars: 5000,
    maxContextTokens: 3000,
    maxOutputTokens: 512,
    brevityInstruction: true,
    autoSummarizeEnabled: true,
    autoSummarizeThreshold: 10,
    chatMemoryEnabled: true,
    chatMemoryMaxChars: 2000,
    projectContextEnabled: true,
    projectContextMaxChars: 1500,
    toolOutputCompressionEnabled: true,
    toolOutputMaxChars: 1500,
    toolOutputKeepHeadChars: 400,
    toolOutputKeepTailChars: 800,
    retrievalEnabled: false,
    maxRetrievedSnippets: 3,
    maxSnippetChars: 600,
    showTokenStatsInChat: true,
    description: 'Ahorro extremo. Solo contexto crítico + petición actual.'
  }
};

const DEFAULT_PRESET = 'aggressive';
const VALID_MODES = new Set(['off', 'balanced', 'aggressive', 'extreme', 'custom']);

// ─── Token estimation ─────────────────────────────────────────────────────────

// Rough estimate: ~4 chars per token for Spanish/English mixed content
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

// ─── Text utilities ───────────────────────────────────────────────────────────

// Phase 2 — Normalización de texto
// Colapsa whitespace redundante sin perder información semántica.
function normalizeMessageText(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\n{3,}/g, '\n\n')          // 3+ líneas vacías → 2
    .replace(/[ \t]{2,}/g, ' ')           // espacios/tabs múltiples → 1
    .split('\n').map(l => l.trimEnd()).join('\n')  // trim trailing por línea
    .trim();
}

// Phase 2 — Colapsado de roles consecutivos
// Fusiona mensajes seguidos del mismo rol en uno. Elimina tokens de header duplicados.
function collapseConsecutiveRoles(messages) {
  if (!messages || messages.length === 0) return messages;
  const out = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (last && last.role === msg.role) {
      last.content = last.content + '\n\n' + msg.content;
    } else {
      out.push({ ...msg });
    }
  }
  return out;
}

function truncateMiddle(text, maxChars, headChars, tailChars) {
  if (!text || text.length <= maxChars) return text;
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const skipped = text.length - headChars - tailChars;
  return `${head}\n... [${skipped} caracteres omitidos] ...\n${tail}`;
}

function compressToolOutput(content, settings) {
  if (!settings.toolOutputCompressionEnabled) return content;
  const max = settings.toolOutputMaxChars || 3000;
  const head = settings.toolOutputKeepHeadChars || 800;
  const tail = settings.toolOutputKeepTailChars || 1800;
  return truncateMiddle(content, max, head, tail);
}

function isToolLikeMessage(content) {
  if (!content) return false;
  const lower = content.toLowerCase();
  return (
    (lower.includes('```') && lower.length > 2000) ||
    lower.includes('stdout:') ||
    lower.includes('stderr:') ||
    lower.includes('output:') ||
    (lower.startsWith('[') && lower.includes('\n') && lower.length > 1500)
  );
}

// ─── Settings validation ──────────────────────────────────────────────────────

function mergeWithPreset(mode, customSettings) {
  const base = PRESETS[mode] || PRESETS[DEFAULT_PRESET];
  if (!customSettings || typeof customSettings !== 'object') return { ...base };
  const merged = { ...base };
  const numericFields = [
    'recentMessagesCount', 'recentMessagesMaxChars', 'maxContextTokens',
    'maxOutputTokens', 'autoSummarizeThreshold',
    'chatMemoryMaxChars', 'projectContextMaxChars', 'toolOutputMaxChars',
    'toolOutputKeepHeadChars', 'toolOutputKeepTailChars',
    'maxRetrievedSnippets', 'maxSnippetChars'
  ];
  const boolFields = [
    'enabled', 'brevityInstruction', 'autoSummarizeEnabled',
    'chatMemoryEnabled', 'projectContextEnabled',
    'toolOutputCompressionEnabled', 'retrievalEnabled', 'showTokenStatsInChat'
  ];
  for (const key of numericFields) {
    if (typeof customSettings[key] === 'number' && customSettings[key] >= 0) {
      merged[key] = customSettings[key];
    }
  }
  for (const key of boolFields) {
    if (typeof customSettings[key] === 'boolean') {
      merged[key] = customSettings[key];
    }
  }
  return merged;
}

function normalizeMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : DEFAULT_PRESET;
}

function resolveEffectiveSettings(globalSettings, chatSettings) {
  const globalMode = normalizeMode(globalSettings && globalSettings.mode);
  const globalBase = mergeWithPreset(globalMode, globalSettings);
  if (!globalBase.enabled) return { ...PRESETS.off, mode: 'off' };
  if (!chatSettings || typeof chatSettings !== 'object') return globalBase;
  const chatMode = chatSettings.mode ? normalizeMode(chatSettings.mode) : globalMode;
  return mergeWithPreset(chatMode, { ...globalBase, ...chatSettings });
}

// ─── Core: build optimized prompt context ─────────────────────────────────────

/**
 * Takes full conversation messages and returns an optimized subset
 * based on the effective settings. Returns an object with:
 *  - messages: optimized message array
 *  - sections: breakdown of what was included
 *  - estimatedTokensBefore: rough estimate without optimization
 *  - estimatedTokensAfter: rough estimate with optimization
 *  - estimatedSavings: difference
 *  - savingsPercent: 0-100
 */
function buildOptimizedContext(allMessages, settings, currentPrompt) {
  const s = settings || PRESETS[DEFAULT_PRESET];

  // Normalize messages (Phase 2: apply text normalization here)
  const normalized = Array.isArray(allMessages)
    ? allMessages
        .map((m) => ({
          role: String(m && m.role || '').trim().toLowerCase(),
          content: s.enabled && s.mode !== 'off'
            ? normalizeMessageText(String(m && m.content || '').trim())
            : String(m && m.content || '').trim()
        }))
        .filter((m) => ['user', 'assistant', 'system'].includes(m.role) && m.content)
    : [];

  // Estimate before
  const fullText = normalized.map((m) => `${m.role}: ${m.content}`).join('\n');
  const tokensBefore = estimateTokens(fullText);

  if (!s.enabled || s.mode === 'off') {
    return {
      messages: normalized,
      sections: { type: 'off', messageCount: normalized.length },
      estimatedTokensBefore: tokensBefore,
      estimatedTokensAfter: tokensBefore,
      estimatedSavings: 0,
      savingsPercent: 0
    };
  }

  // Apply window: take last N messages
  const windowSize = Math.max(1, s.recentMessagesCount || 12);
  const windowed = normalized.slice(-windowSize);

  // Compress tool-like outputs
  const compressed = windowed.map((m) => {
    if (m.role === 'assistant' && isToolLikeMessage(m.content)) {
      return { ...m, content: compressToolOutput(m.content, s) };
    }
    return m;
  });

  // Apply per-message char limit
  const maxPerMsg = s.recentMessagesMaxChars
    ? Math.floor(s.recentMessagesMaxChars / Math.max(1, compressed.length))
    : 4000;

  const capped = compressed.map((m) => {
    if (m.content.length > maxPerMsg) {
      return {
        ...m,
        content: truncateMiddle(m.content, maxPerMsg, Math.floor(maxPerMsg * 0.4), Math.floor(maxPerMsg * 0.5))
      };
    }
    return m;
  });

  // Phase 2 — Colapsado de roles consecutivos
  const collapsed = collapseConsecutiveRoles(capped);
  const rolesMerged = capped.length - collapsed.length;

  const finalText = collapsed.map((m) => `${m.role}: ${m.content}`).join('\n');
  const tokensAfter = estimateTokens(finalText);
  const savings = Math.max(0, tokensBefore - tokensAfter);
  const savingsPercent = tokensBefore > 0 ? Math.round((savings / tokensBefore) * 100) : 0;

  const skippedCount = normalized.length - windowed.length;

  // Phase 3 — Auto-summarization: emit summarizeRequest when there are skipped old messages
  const oldMessages = skippedCount > 0 ? normalized.slice(0, -windowSize) : [];
  const shouldSummarize =
    s.autoSummarizeEnabled &&
    s.autoSummarizeThreshold > 0 &&
    normalized.length >= s.autoSummarizeThreshold &&
    oldMessages.length > 0;

  return {
    messages: collapsed,
    summarizeRequest: shouldSummarize ? { oldMessages } : null,
    sections: {
      type: 'optimized',
      mode: s.mode,
      totalMessages: normalized.length,
      messageCount: collapsed.length,
      skippedOldMessages: skippedCount,
      toolOutputsCompressed: compressed.filter((m, i) => m.content !== windowed[i].content).length,
      rolesMerged
    },
    estimatedTokensBefore: tokensBefore,
    estimatedTokensAfter: tokensAfter,
    estimatedSavings: savings,
    savingsPercent
  };
}

// ─── Settings CRUD helpers (work with a better-sqlite3 db instance) ───────────

function createSettingsStatementsFor(db) {
  const getGlobal = db.prepare(`
    SELECT settings_json, mode FROM token_saver_settings
    WHERE user_id = ? AND scope = 'global' AND scope_id = 0
    LIMIT 1
  `);
  const getChat = db.prepare(`
    SELECT settings_json, mode FROM token_saver_settings
    WHERE user_id = ? AND scope = 'chat' AND scope_id = ?
    LIMIT 1
  `);
  const upsertGlobal = db.prepare(`
    INSERT INTO token_saver_settings (user_id, scope, scope_id, mode, settings_json, updated_at)
    VALUES (?, 'global', 0, ?, ?, ?)
    ON CONFLICT(user_id, scope, scope_id) DO UPDATE SET
      mode = excluded.mode,
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `);
  const upsertChat = db.prepare(`
    INSERT INTO token_saver_settings (user_id, scope, scope_id, mode, settings_json, updated_at)
    VALUES (?, 'chat', ?, ?, ?, ?)
    ON CONFLICT(user_id, scope, scope_id) DO UPDATE SET
      mode = excluded.mode,
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `);
  const deleteChat = db.prepare(`
    DELETE FROM token_saver_settings
    WHERE user_id = ? AND scope = 'chat' AND scope_id = ?
  `);
  const getMetrics = db.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      COALESCE(SUM(estimated_tokens_before), 0) AS total_tokens_before,
      COALESCE(SUM(estimated_tokens_after), 0) AS total_tokens_after,
      COALESCE(SUM(estimated_savings), 0) AS total_savings,
      MAX(created_at) AS last_request_at
    FROM token_saver_metrics
    WHERE user_id = ?
  `);
  const getMetricsForChat = db.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      COALESCE(SUM(estimated_tokens_before), 0) AS total_tokens_before,
      COALESCE(SUM(estimated_tokens_after), 0) AS total_tokens_after,
      COALESCE(SUM(estimated_savings), 0) AS total_savings,
      MAX(created_at) AS last_request_at
    FROM token_saver_metrics
    WHERE user_id = ? AND conversation_id = ?
  `);
  const insertMetric = db.prepare(`
    INSERT INTO token_saver_metrics
      (user_id, conversation_id, estimated_tokens_before, estimated_tokens_after, estimated_savings, sections_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const pruneMetrics = db.prepare(`
    DELETE FROM token_saver_metrics
    WHERE user_id = ? AND created_at < ?
  `);

  return {
    getGlobal,
    getChat,
    upsertGlobal,
    upsertChat,
    deleteChat,
    getMetrics,
    getMetricsForChat,
    insertMetric,
    pruneMetrics
  };
}

function parseSettingsRow(row, fallbackMode) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.settings_json || '{}');
    return { mode: row.mode || fallbackMode || DEFAULT_PRESET, ...parsed };
  } catch (_e) {
    return { mode: row.mode || fallbackMode || DEFAULT_PRESET };
  }
}

// ─── Schema SQL ───────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS token_saver_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  scope_id INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'aggressive',
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, scope, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_token_saver_settings_user
ON token_saver_settings(user_id, scope, scope_id);

CREATE TABLE IF NOT EXISTS token_saver_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  conversation_id INTEGER,
  estimated_tokens_before INTEGER NOT NULL DEFAULT 0,
  estimated_tokens_after INTEGER NOT NULL DEFAULT 0,
  estimated_savings INTEGER NOT NULL DEFAULT 0,
  sections_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_saver_metrics_user_created
ON token_saver_metrics(user_id, created_at DESC);
`;

// ─── Phase 3: Auto-summarization ─────────────────────────────────────────────

// Builds the messages array for a one-shot summarization API call.
// The caller should POST this to any OpenAI-compatible /chat/completions endpoint.
function buildSummaryRequestMessages(oldMessages) {
  const lines = oldMessages
    .map((m) => {
      const label = m.role === 'user' ? 'Usuario' : m.role === 'assistant' ? 'Asistente' : 'Sistema';
      const text = String(m.content || '').slice(0, 1200);
      return `${label}: ${text}`;
    })
    .join('\n\n');

  return [
    {
      role: 'user',
      content:
        'Resume el siguiente historial de conversación en máximo 5 oraciones. ' +
        'Conserva decisiones técnicas, nombres de archivos, errores y datos clave. ' +
        'Responde SOLO con el resumen, sin introducción ni conclusión.\n\n' +
        'HISTORIAL:\n' +
        lines +
        '\n\nRESUMEN:'
    }
  ];
}

// ─── Brevity instruction ──────────────────────────────────────────────────────

const BREVITY_INSTRUCTION_BY_MODE = {
  balanced: 'Responde de forma concisa. Usa listas cuando sea posible. Omite explicaciones innecesarias.',
  aggressive: 'Responde en el menor número de palabras posible. Ve directo al punto. Sin preámbulos ni resúmenes finales.',
  extreme: 'MÁXIMA BREVEDAD. Solo lo esencial. Sin introducción ni conclusión.'
};

function getBrevityInstruction(settings) {
  if (!settings || !settings.brevityInstruction || !settings.enabled || settings.mode === 'off') {
    return null;
  }
  return BREVITY_INSTRUCTION_BY_MODE[settings.mode] || BREVITY_INSTRUCTION_BY_MODE.aggressive;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  VERSION: TOKEN_SAVER_VERSION,
  PRESETS,
  DEFAULT_PRESET,
  VALID_MODES,
  SCHEMA_SQL,
  estimateTokens,
  normalizeMessageText,
  collapseConsecutiveRoles,
  normalizeMode,
  mergeWithPreset,
  resolveEffectiveSettings,
  buildOptimizedContext,
  getBrevityInstruction,
  buildSummaryRequestMessages,
  createSettingsStatementsFor,
  parseSettingsRow
};
