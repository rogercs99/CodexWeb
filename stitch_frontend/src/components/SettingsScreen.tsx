import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import BottomNav from './BottomNav';
import {
  cancelCodexDeviceLogin,
  getCodexAuthStatus,
  getNotificationSettings,
  getCodexQuota,
  logoutCodexAuth,
  startCodexDeviceLogin,
  updateNotificationSettings
} from '../lib/api';
import type {
  Capabilities,
  ChatOptions,
  CodexAuthStatus,
  CodexQuota,
  CodexQuotaWindow,
  NotificationSettings,
  Screen
} from '../lib/types';

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
  const [auth, setAuth] = useState<CodexAuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authActionBusy, setAuthActionBusy] = useState(false);
  const [notifications, setNotifications] = useState<NotificationSettings>({
    discordWebhookUrl: '',
    notifyOnFinish: false,
    includeResult: false
  });
  const [discordWebhookDraft, setDiscordWebhookDraft] = useState('');
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const [notificationsSavedMessage, setNotificationsSavedMessage] = useState('');

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

  const loadAuth = useCallback(async (silent = false) => {
    if (!silent) {
      setAuthLoading(true);
    }
    setAuthError('');
    try {
      const nextAuth = await getCodexAuthStatus();
      setAuth(nextAuth);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo leer estado de Codex CLI');
    } finally {
      if (!silent) {
        setAuthLoading(false);
      }
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    setNotificationsError('');
    try {
      const next = await getNotificationSettings();
      setNotifications(next);
      setDiscordWebhookDraft(next.discordWebhookUrl || '');
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : 'No se pudo leer configuración de Discord');
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuota();
    loadAuth();
    loadNotifications();
  }, [loadAuth, loadNotifications, loadQuota]);

  useEffect(() => {
    if (!auth?.loginInProgress) return undefined;
    const pollId = window.setInterval(() => {
      void loadAuth(true);
    }, 3000);
    return () => {
      window.clearInterval(pollId);
    };
  }, [auth?.loginInProgress, loadAuth]);

  const saveNotifications = useCallback(
    async (patch: Partial<NotificationSettings>) => {
      setNotificationsSaving(true);
      setNotificationsError('');
      setNotificationsSavedMessage('');
      try {
        const next = await updateNotificationSettings(patch);
        setNotifications(next);
        setDiscordWebhookDraft(next.discordWebhookUrl || '');
        setNotificationsSavedMessage('Guardado');
        window.setTimeout(() => {
          setNotificationsSavedMessage((prev) => (prev === 'Guardado' ? '' : prev));
        }, 1800);
      } catch (error) {
        setNotificationsError(
          error instanceof Error ? error.message : 'No se pudo guardar configuración de Discord'
        );
      } finally {
        setNotificationsSaving(false);
      }
    },
    []
  );

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

  const copyText = async (value: string) => {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      // ignore clipboard errors
    }
  };

  const startDeviceAuth = async () => {
    setAuthActionBusy(true);
    setAuthError('');
    try {
      const login = await startCodexDeviceLogin();
      setAuth((prev) => ({
        loggedIn: prev?.loggedIn || false,
        statusText: prev?.statusText || '',
        loginInProgress: Boolean(login && login.inProgress),
        login: login || null
      }));
      await loadAuth(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo iniciar login de Codex');
    } finally {
      setAuthActionBusy(false);
    }
  };

  const cancelDeviceAuth = async () => {
    setAuthActionBusy(true);
    setAuthError('');
    try {
      await cancelCodexDeviceLogin();
      await loadAuth(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo cancelar login de Codex');
    } finally {
      setAuthActionBusy(false);
    }
  };

  const logoutDeviceAuth = async () => {
    setAuthActionBusy(true);
    setAuthError('');
    try {
      await logoutCodexAuth();
      await loadAuth(true);
      await loadQuota();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo cerrar sesión de Codex');
    } finally {
      setAuthActionBusy(false);
    }
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

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs uppercase text-zinc-500">Discord webhook</h3>
            <button
              type="button"
              onClick={() => {
                void loadNotifications();
              }}
              disabled={notificationsLoading || notificationsSaving}
              className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
            >
              {notificationsLoading ? 'Cargando...' : 'Refrescar'}
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-zinc-500">
              Recibe aviso cuando termina una respuesta (estado, hora, duración y resultado opcional).
            </p>
            <input
              type="url"
              inputMode="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={discordWebhookDraft}
              onChange={(event) => {
                setDiscordWebhookDraft(event.target.value);
                if (notificationsError) setNotificationsError('');
              }}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void saveNotifications({ discordWebhookUrl: discordWebhookDraft });
                }}
                disabled={
                  notificationsLoading ||
                  notificationsSaving ||
                  discordWebhookDraft.trim() === notifications.discordWebhookUrl.trim()
                }
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
              >
                {notificationsSaving ? 'Guardando...' : 'Guardar webhook'}
              </button>
              {notificationsSavedMessage ? (
                <span className="text-xs text-emerald-300">{notificationsSavedMessage}</span>
              ) : null}
            </div>
          </div>

          <label className="flex items-center justify-between text-sm">
            <span>Notificar al finalizar respuesta</span>
            <input
              type="checkbox"
              checked={notifications.notifyOnFinish}
              disabled={notificationsLoading || notificationsSaving}
              onChange={(event) => {
                void saveNotifications({ notifyOnFinish: event.target.checked });
              }}
            />
          </label>

          <label className="flex items-center justify-between text-sm">
            <span>Incluir resultado en el aviso</span>
            <input
              type="checkbox"
              checked={notifications.includeResult}
              disabled={notificationsLoading || notificationsSaving}
              onChange={(event) => {
                void saveNotifications({ includeResult: event.target.checked });
              }}
            />
          </label>

          {notificationsError ? <p className="text-xs text-red-300">{notificationsError}</p> : null}
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs uppercase text-zinc-500">Codex CLI (cuenta por usuario)</h3>
            <button
              type="button"
              onClick={() => loadAuth()}
              disabled={authLoading || authActionBusy}
              className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
            >
              {authLoading ? 'Cargando...' : 'Refrescar'}
            </button>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-3">
            <p className="text-sm text-zinc-200">
              Estado:{' '}
              {auth?.loggedIn ? (
                <span className="text-emerald-300">Conectado</span>
              ) : auth?.loginInProgress ? (
                <span className="text-amber-300">Esperando verificación</span>
              ) : (
                <span className="text-zinc-400">Sin conectar</span>
              )}
            </p>

            {auth?.statusText ? (
              <p className="text-xs text-zinc-500 whitespace-pre-wrap break-words">{auth.statusText}</p>
            ) : null}

            {authError ? <p className="text-xs text-red-300">{authError}</p> : null}

            {auth?.loginInProgress && auth.login ? (
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-black/40 p-3">
                <p className="text-xs text-zinc-400">1) Abre este enlace y autentícate con ChatGPT:</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-blue-300 break-all flex-1">{auth.login.verificationUri || '-'}</p>
                  <button
                    type="button"
                    onClick={() => copyText(auth.login?.verificationUri || '')}
                    className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white"
                  >
                    Copiar
                  </button>
                </div>
                <p className="text-xs text-zinc-400">2) Introduce este código:</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold tracking-wide text-amber-200 flex-1">{auth.login.userCode || '-'}</p>
                  <button
                    type="button"
                    onClick={() => copyText(auth.login?.userCode || '')}
                    className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white"
                  >
                    Copiar
                  </button>
                </div>
                {auth.login.expiresAt ? (
                  <p className="text-[11px] text-zinc-500">Expira: {formatDate(auth.login.expiresAt)}</p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {!auth?.loggedIn ? (
                <button
                  type="button"
                  onClick={startDeviceAuth}
                  disabled={authActionBusy || authLoading}
                  className="text-xs px-3 py-1.5 rounded-lg border border-blue-500/40 bg-blue-600/20 text-blue-200 hover:bg-blue-600/30 disabled:opacity-50"
                >
                  Iniciar sesión con ChatGPT
                </button>
              ) : (
                <button
                  type="button"
                  onClick={logoutDeviceAuth}
                  disabled={authActionBusy || authLoading}
                  className="text-xs px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-600/20 text-red-200 hover:bg-red-600/30 disabled:opacity-50"
                >
                  Desvincular cuenta
                </button>
              )}

              {auth?.loginInProgress ? (
                <button
                  type="button"
                  onClick={cancelDeviceAuth}
                  disabled={authActionBusy}
                  className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                >
                  Cancelar login
                </button>
              ) : null}
            </div>
          </div>
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
