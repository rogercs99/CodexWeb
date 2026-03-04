import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import BottomNav from './BottomNav';
import { getCodexQuota } from '../lib/api';
import type { Capabilities, ChatOptions, CodexQuota, CodexQuotaWindow, Screen } from '../lib/types';

export default function SettingsScreen({
  options,
  model,
  reasoningEffort,
  caps,
  onModelChange,
  onReasoningChange,
  onCapsChange,
  onNavigate
}: {
  options: ChatOptions;
  model: string;
  reasoningEffort: string;
  caps: Capabilities;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onCapsChange: (value: Capabilities) => void;
  onNavigate: (screen: Screen) => void;
}) {
  const [quota, setQuota] = useState<CodexQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [quotaError, setQuotaError] = useState('');

  const loadQuota = useCallback(async () => {
    setQuotaLoading(true);
    setQuotaError('');
    try {
      const nextQuota = await getCodexQuota();
      setQuota(nextQuota);
    } catch (error) {
      setQuotaError(error instanceof Error ? error.message : 'No se pudo leer quota de Codex');
    } finally {
      setQuotaLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuota();
  }, [loadQuota]);

  const formatPercent = (value: number) => `${Math.max(0, Math.round(Number(value || 0)))}%`;
  const formatDate = (value: string) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatWindowLabel = (windowData: CodexQuotaWindow | null, fallback: string) => {
    if (!windowData) return fallback;
    const minutes = Number(windowData.windowMinutes || 0);
    if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
    if (minutes >= 7 * 24 * 60) return 'Weekly';
    if (minutes >= 24 * 60 && minutes % (24 * 60) === 0) return `${Math.round(minutes / (24 * 60))}d`;
    if (minutes >= 60 && minutes % 60 === 0) return `${Math.round(minutes / 60)}h`;
    if (minutes >= 60) return `${(minutes / 60).toFixed(1)}h`;
    return `${Math.round(minutes)}m`;
  };

  const formatResetCompact = (value: string, windowData: CodexQuotaWindow | null) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    const minutes = Number(windowData?.windowMinutes || 0);
    if (Number.isFinite(minutes) && minutes >= 24 * 60) {
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const quotaRows: Array<{
    id: string;
    label: string;
    remainingPercent: number;
    resetAt: string;
    windowData: CodexQuotaWindow | null;
  }> = [];
  if (quota?.primary) {
    quotaRows.push({
      id: 'primary',
      label: formatWindowLabel(quota.primary, 'Primary'),
      remainingPercent: quota.primary.remainingPercent,
      resetAt: quota.primary.resetAt,
      windowData: quota.primary
    });
  }
  if (quota?.secondary) {
    quotaRows.push({
      id: 'secondary',
      label: formatWindowLabel(quota.secondary, 'Secondary'),
      remainingPercent: quota.secondary.remainingPercent,
      resetAt: quota.secondary.resetAt,
      windowData: quota.secondary
    });
  }

  const getRemainingColorClass = (remainingPercent: number) => {
    if (remainingPercent <= 20) return 'text-red-300';
    if (remainingPercent <= 50) return 'text-amber-300';
    return 'text-emerald-300';
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="bg-black px-4 py-3 border-b border-zinc-900 flex items-center justify-between sticky top-0 z-40 backdrop-blur-xl">
        <button onClick={() => onNavigate('hub')} className="text-zinc-400 hover:text-white" type="button">Cancel</button>
        <h1 className="text-base font-semibold tracking-tight">Settings</h1>
        <button onClick={() => onNavigate('hub')} className="text-blue-500 font-medium" type="button">Done</button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-28 space-y-6">
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs uppercase text-zinc-500">Modelo por defecto (chats nuevos)</h3>
          <select
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5"
          >
            <option value="">Automatico (default CLI)</option>
            {options.models.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs uppercase text-zinc-500">Razonamiento por defecto (chats nuevos)</h3>
          <select
            value={reasoningEffort}
            onChange={(event) => onReasoningChange(event.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5"
          >
            {options.reasoningEfforts.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-4">
          <h3 className="text-xs uppercase text-zinc-500">Capabilities</h3>

          <label className="flex items-center justify-between text-sm">
            <span>Web Browsing</span>
            <input
              type="checkbox"
              checked={caps.web}
              onChange={(event) => onCapsChange({ ...caps, web: event.target.checked })}
            />
          </label>

          <label className="flex items-center justify-between text-sm">
            <span>Code Interpreter</span>
            <input
              type="checkbox"
              checked={caps.code}
              onChange={(event) => onCapsChange({ ...caps, code: event.target.checked })}
            />
          </label>

          <label className="flex items-center justify-between text-sm">
            <span>Long Term Memory</span>
            <input
              type="checkbox"
              checked={caps.memory}
              onChange={(event) => onCapsChange({ ...caps, memory: event.target.checked })}
            />
          </label>
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase text-zinc-500">Codex quota</h3>
            <button
              type="button"
              onClick={loadQuota}
              disabled={quotaLoading}
              className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
            >
              {quotaLoading ? 'Cargando...' : 'Recargar'}
            </button>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-800">
              <p className="text-sm text-zinc-200">Rate limits remaining</p>
            </div>

            {quotaError ? (
              <p className="px-3 py-3 text-sm text-red-300">{quotaError}</p>
            ) : null}

            {!quotaLoading && !quotaError && quotaRows.length === 0 ? (
              <p className="px-3 py-3 text-sm text-zinc-400">
                Sin datos de quota todavia. Envia un mensaje a Codex para generar `token_count`.
              </p>
            ) : null}

            {quotaRows.map((row, index) => (
              <div
                key={row.id}
                className={`px-3 py-2 flex items-center justify-between gap-3 ${
                  index < quotaRows.length - 1 ? 'border-b border-zinc-800' : ''
                }`}
              >
                <span className="text-sm text-zinc-200">{row.label}</span>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${getRemainingColorClass(row.remainingPercent)}`}>
                    {formatPercent(row.remainingPercent)}
                  </span>
                  <span className="text-sm text-zinc-400 min-w-[4.5rem] text-right">
                    {formatResetCompact(row.resetAt, row.windowData)}
                  </span>
                </div>
              </div>
            ))}

            <a
              href="https://openai.com/chatgpt/pricing/"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 border-t border-zinc-800 flex items-center justify-between text-sm text-zinc-300 hover:text-white"
            >
              <span>Upgrade to Pro</span>
              <ExternalLink size={14} />
            </a>

            <a
              href="https://platform.openai.com/docs/guides/rate-limits"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 border-t border-zinc-800 flex items-center justify-between text-sm text-zinc-300 hover:text-white"
            >
              <span>Learn more</span>
              <ExternalLink size={14} />
            </a>
          </div>

          {quota ? (
            <p className="text-xs text-zinc-500">
              Fuente: {quota.source || '-'} · Actualizado: {formatDate(quota.fetchedAt)}
            </p>
          ) : null}
          {quota && quota.planType ? (
            <p className="text-xs text-zinc-500">
              Plan: {quota.planType}
            </p>
          ) : null}
        </section>
      </main>

      <BottomNav active="settings" onNavigate={onNavigate} />
    </div>
  );
}
