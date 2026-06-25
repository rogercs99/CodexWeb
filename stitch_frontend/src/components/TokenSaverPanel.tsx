import {
  BarChart2,
  ChevronDown,
  ChevronUp,
  Eye,
  HelpCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Sliders,
  X,
  Zap
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  clearTokenSaverCache,
  getTokenSaverPresets,
  getTokenSaverSettings,
  getTokenSaverStatus,
  getTokenSaverPreview,
  putTokenSaverSettings,
  resetTokenSaverPreset
} from '../lib/api';

const PRESET_COLORS: Record<string, string> = {
  off: 'bg-zinc-600 text-zinc-100',
  balanced: 'bg-blue-500/80 text-blue-50',
  aggressive: 'bg-amber-500/80 text-amber-50',
  extreme: 'bg-red-500/80 text-red-50',
  custom: 'bg-purple-500/80 text-purple-50'
};

const PRESET_LABELS: Record<string, string> = {
  off: 'Off',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
  extreme: 'Extreme',
  custom: 'Custom'
};

interface TokenSaverStatus {
  enabled: boolean;
  mode: string;
  version: string;
  metrics: {
    totalRequests: number;
    totalTokensBefore: number;
    totalTokensAfter: number;
    totalSavings: number;
    savingsPercent: number;
    lastRequestAt: string | null;
  };
}

interface TokenSaverSettings {
  mode: string;
  enabled: boolean;
  recentMessagesCount?: number;
  recentMessagesMaxChars?: number;
  maxContextTokens?: number;
  chatMemoryEnabled?: boolean;
  chatMemoryMaxChars?: number;
  projectContextEnabled?: boolean;
  projectContextMaxChars?: number;
  toolOutputCompressionEnabled?: boolean;
  toolOutputMaxChars?: number;
  toolOutputKeepHeadChars?: number;
  toolOutputKeepTailChars?: number;
  showTokenStatsInChat?: boolean;
}

interface PreviewBreakdown {
  mode: string;
  enabled: boolean;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  estimatedSavings: number;
  savingsPercent: number;
  messagesTotal: number;
  messagesIncluded: number;
  messagesSkipped: number;
}

interface Props {
  chatId?: number | null;
  onClose: () => void;
}

function Toggle({
  checked,
  onChange
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-emerald-500/70' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function TokenSaverPanel({ chatId, onClose }: Props) {
  const [status, setStatus] = useState<TokenSaverStatus | null>(null);
  const [settings, setSettings] = useState<TokenSaverSettings | null>(null);
  const [draft, setDraft] = useState<TokenSaverSettings | null>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [preview, setPreview] = useState<PreviewBreakdown | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const successTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoadingStatus(true);
    setError(null);
    try {
      const [statusData, settingsData, presetsData] = await Promise.all([
        getTokenSaverStatus(),
        getTokenSaverSettings(),
        getTokenSaverPresets()
      ]);
      setStatus(statusData);
      const s = settingsData.settings || {};
      setSettings(s);
      setDraft({ ...s });
      setPresets(presetsData.presets || []);
    } catch (e: any) {
      setError(e?.message || 'Error cargando configuración');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    if (successTimeout.current) clearTimeout(successTimeout.current);
    successTimeout.current = setTimeout(() => setSuccessMsg(null), 3000);
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await putTokenSaverSettings(draft);
      showSuccess('Configuración guardada');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Error guardando');
    } finally {
      setSaving(false);
    }
  }

  async function handlePreset(modeId: string) {
    if (!draft) return;
    const preset = presets.find((p) => p.id === modeId);
    if (!preset) return;
    setDraft({ ...preset.settings, mode: modeId });
  }

  async function handleResetToPreset() {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await resetTokenSaverPreset(draft.mode);
      setSettings(result.settings);
      setDraft({ ...result.settings });
      showSuccess('Restaurado a defaults del preset');
    } catch (e: any) {
      setError(e?.message || 'Error restaurando');
    } finally {
      setSaving(false);
    }
  }

  async function handleClearCache() {
    try {
      await clearTokenSaverCache();
      showSuccess('Métricas antiguas purgadas');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Error limpiando');
    }
  }

  async function handlePreview() {
    if (!chatId) return;
    setLoadingPreview(true);
    try {
      const result = await getTokenSaverPreview(chatId, '');
      setPreview(result.breakdown || null);
    } catch (e: any) {
      setError(e?.message || 'Error en preview');
    } finally {
      setLoadingPreview(false);
    }
  }

  function updateDraft(key: keyof TokenSaverSettings, value: any) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  const currentMode = draft?.mode || 'aggressive';
  const modeBadge = PRESET_COLORS[currentMode] || 'bg-zinc-600 text-zinc-100';
  const m = status?.metrics;

  return (
    <>
      {/*
        Backdrop: only renders visually on desktop (sm+) where the panel is a
        right-side drawer and there is space outside the panel.
        On mobile the panel is inset-0 (fullscreen) so the backdrop is
        completely behind the panel and invisible — but the element is still
        in the DOM so clicking anywhere outside a focused element closes safely.
      */}
      <div
        className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm hidden sm:block"
        onClick={onClose}
        aria-hidden="true"
      />

      {/*
        Panel:
          Mobile  (< sm / < 640px): inset-0, width 100%, no border → true fullscreen
          Desktop (≥ sm / ≥ 640px): right drawer, max-w-sm, left border
        Using 100dvh via min-h-0 + flex so iOS Safari doesn't cut the footer.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Token Saver"
        className={[
          // base — shared
          'fixed z-[210] flex flex-col bg-zinc-950 overflow-hidden',
          // mobile — fullscreen, no lateral gap
          'inset-0',
          // desktop — right drawer
          'sm:inset-y-0 sm:right-0 sm:left-auto sm:w-full sm:max-w-sm',
          'sm:border-l sm:border-zinc-800 sm:shadow-2xl'
        ].join(' ')}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* ── Header ── */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Zap size={15} className="text-amber-400 shrink-0" />
            <span className="text-sm font-semibold text-zinc-100 truncate">Token Saver</span>
            {!loadingStatus && (
              <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${modeBadge}`}>
                {PRESET_LABELS[currentMode] || currentMode}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            type="button"
            aria-label="Cerrar Token Saver"
            className="p-2 -mr-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </header>

        {/*
          ── Scrollable body ──
          flex-1 + min-h-0 ensures it shrinks and scrolls instead of
          pushing the footer off-screen on short viewports.
          padding-bottom covers the sticky footer height + Safari home bar.
        */}
        <main
          className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5"
          style={{
            WebkitOverflowScrolling: 'touch',
            paddingBottom: 'calc(96px + env(safe-area-inset-bottom))'
          }}
        >
          {loadingStatus ? (
            <p className="text-zinc-500 text-sm text-center py-8">Cargando…</p>
          ) : (
            <>
              {/* Alerts */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-red-400 text-xs">
                  {error}
                </div>
              )}
              {successMsg && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 text-emerald-400 text-xs">
                  {successMsg}
                </div>
              )}

              {/* Stats */}
              {m && (
                <section className="grid grid-cols-3 gap-2">
                  <StatCard label="Peticiones" value={String(m.totalRequests)} />
                  <StatCard label="Tokens ahorro" value={m.totalSavings.toLocaleString()} accent="amber" />
                  <StatCard label="Ahorro %" value={`${m.savingsPercent}%`} accent="emerald" />
                </section>
              )}

              {/* Presets */}
              <section>
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">Preset</p>
                <div className="grid grid-cols-2 gap-2">
                  {['off', 'balanced', 'aggressive', 'extreme'].map((modeId) => (
                    <button
                      key={modeId}
                      type="button"
                      onClick={() => handlePreset(modeId)}
                      className={`py-2.5 px-3 rounded-xl text-xs font-medium border transition-all text-left min-h-[44px] ${
                        currentMode === modeId
                          ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      {PRESET_LABELS[modeId]}
                    </button>
                  ))}
                </div>
                {draft && presets.find((p) => p.id === currentMode) && (
                  <p className="text-zinc-600 text-xs mt-1.5">
                    {presets.find((p) => p.id === currentMode)?.description}
                  </p>
                )}
              </section>

              {/* Core settings */}
              <section className="space-y-3">
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Configuración</p>

                <Row label="Token Saver activo">
                  <Toggle
                    checked={draft?.enabled ?? true}
                    onChange={(v) => updateDraft('enabled', v)}
                  />
                </Row>

                <Row label="Mensajes recientes">
                  <NumberInput
                    value={draft?.recentMessagesCount ?? 12}
                    min={1}
                    max={200}
                    onChange={(v) => updateDraft('recentMessagesCount', v)}
                  />
                </Row>

                <Row label="Max tokens contexto">
                  <NumberInput
                    value={draft?.maxContextTokens ?? 6000}
                    min={500}
                    max={200000}
                    step={500}
                    onChange={(v) => updateDraft('maxContextTokens', v)}
                  />
                </Row>

                <Row label="Comprimir salidas">
                  <Toggle
                    checked={draft?.toolOutputCompressionEnabled ?? true}
                    onChange={(v) => updateDraft('toolOutputCompressionEnabled', v)}
                  />
                </Row>

                <Row label="Stats en chat">
                  <Toggle
                    checked={draft?.showTokenStatsInChat ?? true}
                    onChange={(v) => updateDraft('showTokenStatsInChat', v)}
                  />
                </Row>
              </section>

              {/* Advanced settings */}
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-zinc-500 text-xs hover:text-zinc-300 transition-colors py-1"
              >
                <Sliders size={12} />
                Ajustes avanzados
                {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showAdvanced && (
                <section className="space-y-3 border border-zinc-800 rounded-xl p-3 bg-zinc-900/50">
                  <Row label="Max chars por mensaje">
                    <NumberInput
                      value={draft?.recentMessagesMaxChars ?? 12000}
                      min={200}
                      max={50000}
                      step={200}
                      onChange={(v) => updateDraft('recentMessagesMaxChars', v)}
                    />
                  </Row>
                  <Row label="Max chars tool output">
                    <NumberInput
                      value={draft?.toolOutputMaxChars ?? 3000}
                      min={500}
                      max={50000}
                      step={500}
                      onChange={(v) => updateDraft('toolOutputMaxChars', v)}
                    />
                  </Row>
                  <Row label="Head chars (salidas)">
                    <NumberInput
                      value={draft?.toolOutputKeepHeadChars ?? 800}
                      min={100}
                      max={20000}
                      step={100}
                      onChange={(v) => updateDraft('toolOutputKeepHeadChars', v)}
                    />
                  </Row>
                  <Row label="Tail chars (salidas)">
                    <NumberInput
                      value={draft?.toolOutputKeepTailChars ?? 1800}
                      min={100}
                      max={20000}
                      step={100}
                      onChange={(v) => updateDraft('toolOutputKeepTailChars', v)}
                    />
                  </Row>
                  <Row label="Max chars contexto proyecto">
                    <NumberInput
                      value={draft?.projectContextMaxChars ?? 3000}
                      min={200}
                      max={20000}
                      step={200}
                      onChange={(v) => updateDraft('projectContextMaxChars', v)}
                    />
                  </Row>
                </section>
              )}

              {/* Preview breakdown */}
              {chatId && (
                <section>
                  <button
                    type="button"
                    onClick={handlePreview}
                    disabled={loadingPreview}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-50 py-1"
                  >
                    <Eye size={12} />
                    {loadingPreview ? 'Calculando…' : 'Ver desglose del chat actual'}
                  </button>
                  {preview && (
                    <div className="mt-2 bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">Desglose prompt</p>
                      <BreakdownRow label="Mensajes totales" value={String(preview.messagesTotal)} />
                      <BreakdownRow label="Mensajes enviados" value={String(preview.messagesIncluded)} />
                      <BreakdownRow label="Mensajes omitidos" value={String(preview.messagesSkipped)} />
                      <div className="border-t border-zinc-800 pt-1.5 mt-1.5" />
                      <BreakdownRow label="Tokens sin optimizar" value={preview.estimatedTokensBefore.toLocaleString()} />
                      <BreakdownRow label="Tokens optimizados" value={preview.estimatedTokensAfter.toLocaleString()} />
                      <BreakdownRow
                        label="Ahorro estimado"
                        value={`${preview.estimatedSavings.toLocaleString()} (${preview.savingsPercent}%)`}
                        highlight
                      />
                    </div>
                  )}
                </section>
              )}

              {/* ── Explicación sencilla ── */}
              <section>
                <button
                  type="button"
                  onClick={() => setShowHelp(!showHelp)}
                  className="flex items-center gap-1.5 text-zinc-500 text-xs hover:text-zinc-300 transition-colors py-1"
                >
                  <HelpCircle size={12} />
                  ¿Cómo funciona?
                  {showHelp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>

                {showHelp && (
                  <div className="mt-3 space-y-3 text-xs text-zinc-400">
                    <HelpBlock title="¿Qué son los tokens?">
                      Los tokens son trozos de texto. Cuanto más texto le mandas a la IA, más tokens gasta
                      y más tarda en responder.
                    </HelpBlock>

                    <HelpBlock title="¿Por qué ahorrar?">
                      Si mandas toda la conversación siempre, la IA gasta más, tarda más y puede volverse
                      más lenta con chats muy largos. Token Saver envía solo lo necesario.
                    </HelpBlock>

                    <HelpBlock title="Mensajes recientes">
                      Cuántos últimos mensajes se mandan completos. Los anteriores se resumen
                      automáticamente para ocupar mucho menos espacio.
                    </HelpBlock>

                    <HelpBlock title="Max tokens contexto">
                      El límite de información que se envía a la IA en cada pregunta. Más alto = más
                      contexto pero más gasto. Más bajo = más ahorro pero puede olvidar cosas antiguas.
                    </HelpBlock>

                    <HelpBlock title="Comprimir salidas">
                      Los resultados largos (logs, código, listas) se recortan para no mandar miles de
                      líneas innecesarias a la IA.
                    </HelpBlock>

                    <div className="border border-zinc-800 rounded-xl p-3 bg-zinc-900/60 space-y-1.5">
                      <p className="font-semibold text-zinc-300">Qué hace cada preset</p>
                      <p><span className="text-zinc-300 font-medium">Off —</span> sin ahorro, solo para depurar.</p>
                      <p><span className="text-blue-400 font-medium">Balanced —</span> equilibrio entre contexto y gasto.</p>
                      <p><span className="text-amber-400 font-medium">Aggressive —</span> recomendado. Ahorra bastante sin perder lo importante.</p>
                      <p><span className="text-red-400 font-medium">Extreme —</span> ahorro máximo. Puede olvidar detalles del chat.</p>
                    </div>

                    <div className="border border-emerald-800/40 rounded-xl p-3 bg-emerald-900/10">
                      <p className="font-semibold text-emerald-300 mb-1">Recomendación</p>
                      <p className="text-zinc-400">
                        Deja <span className="text-amber-400 font-medium">Aggressive</span> con 12 mensajes y 6000 tokens para uso normal.
                        Si la IA se olvida de cosas, sube esos números. Si quieres gastar menos, baja a <span className="text-red-400 font-medium">Extreme</span>.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </main>

        {/*
          ── Footer ──
          shrink-0 so it never gets squeezed.
          On mobile: 2×2 grid so buttons don't wrap chaotically.
          On desktop: flex row.
          padding-bottom respects the Safari home indicator.
        */}
        <footer
          className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 pt-3"
          style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}
        >
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loadingStatus}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-zinc-100 hover:bg-white text-black text-xs font-semibold rounded-xl transition-colors disabled:opacity-40 min-h-[44px]"
            >
              <Save size={12} />
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={handleResetToPreset}
              disabled={saving || loadingStatus}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-xl transition-colors disabled:opacity-40 min-h-[44px]"
            >
              <RotateCcw size={12} />
              Restaurar
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loadingStatus}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-xl transition-colors disabled:opacity-40 min-h-[44px]"
            >
              <RefreshCw size={12} />
              Refrescar
            </button>
            <button
              type="button"
              onClick={handleClearCache}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-xl transition-colors min-h-[44px]"
            >
              <BarChart2 size={12} />
              Métricas
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: 'amber' | 'emerald';
}) {
  const valueClass =
    accent === 'amber'
      ? 'text-amber-400'
      : accent === 'emerald'
        ? 'text-emerald-400'
        : 'text-zinc-100';
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-center">
      <p className="text-zinc-500 text-[10px] mb-1 truncate">{label}</p>
      <p className={`font-semibold text-sm ${valueClass}`}>{value}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-[44px]">
      <span className="text-zinc-400 text-xs">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-100 text-xs text-right focus:outline-none focus:border-zinc-500"
    />
  );
}

function BreakdownRow({
  label,
  value,
  highlight
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-500 text-xs truncate">{label}</span>
      <span className={`text-xs font-medium shrink-0 ${highlight ? 'text-emerald-400' : 'text-zinc-300'}`}>
        {value}
      </span>
    </div>
  );
}

function HelpBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-zinc-800 rounded-xl p-3 bg-zinc-900/40 space-y-1">
      <p className="font-semibold text-zinc-300">{title}</p>
      <p>{children}</p>
    </div>
  );
}
