import { useCallback, useEffect, useState } from 'react';
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

  const formatPercent = (value: number) => `${Number(value || 0).toFixed(1)}%`;
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

  const renderQuotaWindow = (title: string, windowData: CodexQuotaWindow | null) => {
    if (!windowData) return null;
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-1">
        <p className="text-xs uppercase text-zinc-500">{title}</p>
        <p className="text-sm text-zinc-300">Quota total: {formatPercent(windowData.totalPercent)}</p>
        <p className="text-sm text-zinc-300">Quota usada: {formatPercent(windowData.usedPercent)}</p>
        <p className="text-sm text-zinc-300">Quota restante: {formatPercent(windowData.remainingPercent)}</p>
        <p className="text-sm text-zinc-300">Fecha de reseteo: {formatDate(windowData.resetAt)}</p>
      </div>
    );
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

          {quotaError ? (
            <p className="text-sm text-red-300">{quotaError}</p>
          ) : null}

          {!quotaLoading && !quotaError && !quota ? (
            <p className="text-sm text-zinc-400">
              Sin datos de quota todavia. Envia un mensaje a Codex para generar `token_count`.
            </p>
          ) : null}

          {quota ? (
            <div className="space-y-2">
              {renderQuotaWindow('Ventana primaria', quota.primary)}
              {renderQuotaWindow('Ventana secundaria', quota.secondary)}
              <p className="text-xs text-zinc-500">
                Fuente: {quota.source || '-'} · Actualizado: {formatDate(quota.fetchedAt)}
              </p>
            </div>
          ) : null}
        </section>
      </main>

      <BottomNav active="settings" onNavigate={onNavigate} />
    </div>
  );
}
