import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import BottomNav from './BottomNav';
import {
  getAiAgentSettings,
  cancelCodexDeviceLogin,
  getCodexAuthStatus,
  getNotificationSettings,
  getCodexQuota,
  logoutCodexAuth,
  startCodexDeviceLogin,
  updateActiveAiAgentSetting,
  updateAiAgentSetting,
  updateNotificationSettings
} from '../lib/api';
import type {
  AiAgentSettingsItem,
  Capabilities,
  ChatOptions,
  CodexAuthStatus,
  CodexQuota,
  CodexQuotaWindow,
  NotificationSettings,
  Screen
} from '../lib/types';

function ToggleSwitch({
  checked,
  disabled,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (nextValue: boolean) => void;
}) {
  const isDisabled = Boolean(disabled);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={isDisabled}
      onClick={() => {
        if (isDisabled) return;
        onChange(!checked);
      }}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
        checked ? 'bg-emerald-500/70' : 'bg-zinc-700'
      } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

type SettingsSectionId =
  | 'defaultModel'
  | 'reasoning'
  | 'capabilities'
  | 'discordWebhook'
  | 'codexAccount'
  | 'aiAgents'
  | 'codexQuota';

const DEFAULT_EXPANDED_SECTIONS: Record<SettingsSectionId, boolean> = {
  defaultModel: false,
  reasoning: false,
  capabilities: false,
  discordWebhook: false,
  codexAccount: false,
  aiAgents: false,
  codexQuota: false
};

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
  const [agents, setAgents] = useState<AiAgentSettingsItem[]>([]);
  const [agentsDrafts, setAgentsDrafts] = useState<
    Record<string, { enabled: boolean; apiKey: string; apiKeyDirty: boolean; baseUrl: string }>
  >({});
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsSavingId, setAgentsSavingId] = useState('');
  const [agentsError, setAgentsError] = useState('');
  const [agentsSavedId, setAgentsSavedId] = useState('');
  const [activeAgentId, setActiveAgentId] = useState('');
  const [activeAgentDraft, setActiveAgentDraft] = useState('');
  const [activeAgentSaving, setActiveAgentSaving] = useState(false);
  const [activeAgentSavedMessage, setActiveAgentSavedMessage] = useState('');
  const [expandedAgentIds, setExpandedAgentIds] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<SettingsSectionId, boolean>>(
    DEFAULT_EXPANDED_SECTIONS
  );

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

  const loadAiAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError('');
    try {
      const payload = await getAiAgentSettings();
      const nextAgents = Array.isArray(payload.agents) ? payload.agents : [];
      setAgents(nextAgents);
      setExpandedAgentIds((current) => {
        const nextExpanded: Record<string, boolean> = {};
        nextAgents.forEach((agent) => {
          if (current[agent.id]) {
            nextExpanded[agent.id] = true;
          }
        });
        return nextExpanded;
      });
      const nextActive = String(payload.activeAgentId || '');
      setActiveAgentId(nextActive);
      setActiveAgentDraft(nextActive);
      setAgentsDrafts((current) => {
        const nextDrafts: Record<
          string,
          { enabled: boolean; apiKey: string; apiKeyDirty: boolean; baseUrl: string }
        > = {};
        nextAgents.forEach((agent) => {
          const previous = current[agent.id];
          nextDrafts[agent.id] = {
            enabled: previous ? previous.enabled : agent.integration.enabled,
            apiKey: previous && previous.apiKeyDirty ? previous.apiKey : '',
            apiKeyDirty: previous ? previous.apiKeyDirty : false,
            baseUrl: previous ? previous.baseUrl : agent.integration.baseUrl || ''
          };
        });
        return nextDrafts;
      });
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : 'No se pudo leer integraciones de agentes');
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuota();
    loadAuth();
    loadNotifications();
    loadAiAgents();
  }, [loadAiAgents, loadAuth, loadNotifications, loadQuota]);

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

  const saveAiAgent = useCallback(
    async (agentId: string) => {
      const draft = agentsDrafts[agentId];
      if (!draft) return;
      const agent = agents.find((entry) => entry.id === agentId);
      setAgentsSavingId(agentId);
      setAgentsError('');
      setAgentsSavedId('');
      try {
        const payload: { enabled?: boolean; apiKey?: string; baseUrl?: string } = { enabled: draft.enabled };
        if (draft.apiKeyDirty) {
          payload.apiKey = draft.apiKey;
        }
        if (agent && agent.supportsBaseUrl) {
          payload.baseUrl = draft.baseUrl;
        }
        const response = await updateAiAgentSetting(agentId, payload);
        const updated = response.agent;
        setAgents((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
        setAgentsDrafts((current) => ({
          ...current,
          [agentId]: {
            enabled: updated.integration.enabled,
            apiKey: '',
            apiKeyDirty: false,
            baseUrl: updated.integration.baseUrl || ''
          }
        }));
        const nextActiveAgentId = String(response.activeAgentId || '');
        setActiveAgentId(nextActiveAgentId);
        setActiveAgentDraft(nextActiveAgentId);
        setAgentsSavedId(agentId);
        window.setTimeout(() => {
          setAgentsSavedId((current) => (current === agentId ? '' : current));
        }, 1800);
      } catch (error) {
        setAgentsError(error instanceof Error ? error.message : 'No se pudo guardar integracion del agente');
      } finally {
        setAgentsSavingId('');
      }
    },
    [agents, agentsDrafts]
  );

  const saveActiveAiAgent = useCallback(async () => {
    setActiveAgentSaving(true);
    setAgentsError('');
    setActiveAgentSavedMessage('');
    try {
      const response = await updateActiveAiAgentSetting(activeAgentDraft);
      const nextActive = String(response.activeAgentId || '');
      setActiveAgentId(nextActive);
      setActiveAgentDraft(nextActive);
      setActiveAgentSavedMessage('Guardado');
      window.setTimeout(() => {
        setActiveAgentSavedMessage((current) => (current === 'Guardado' ? '' : current));
      }, 1800);
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : 'No se pudo guardar el agente activo');
    } finally {
      setActiveAgentSaving(false);
    }
  }, [activeAgentDraft]);

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

  const formatAuthMethodLabel = (value: string) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '-';
    if (normalized === 'chatgpt') return 'ChatGPT';
    if (normalized === 'api_key' || normalized === 'api-key') return 'API key';
    if (normalized === 'session') return 'Sesion';
    return normalized;
  };

  const formatAgentPricingLabel = (value: string) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'free') return 'Gratis';
    if (normalized === 'freemium') return 'Freemium';
    return 'Pago';
  };

  const formatAgentIntegrationLabel = (value: string) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'api_key') return 'API key';
    if (normalized === 'oauth') return 'OAuth';
    if (normalized === 'local_cli') return 'CLI local';
    return normalized || '-';
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
        details: prev?.details || null,
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
  const authDetails = auth?.details || null;
  const showAuthDetails = Boolean(
    authDetails &&
      (auth?.loggedIn ||
        authDetails.email ||
        authDetails.accountId ||
        authDetails.authMode ||
        authDetails.authMethod ||
        authDetails.hasApiKey ||
        authDetails.hasRefreshToken)
  );
  const freeAgentsCount = agents.filter((agent) => agent.isFree).length;
  const selectableIntegratedAgents = agents.filter(
    (agent) => agent.integration.enabled && agent.integration.configured
  );
  const activeAgentHasChanges = activeAgentDraft !== activeAgentId;

  const getRemainingColorClass = (remainingPercent: number) => {
    if (remainingPercent <= 20) return 'text-red-300';
    if (remainingPercent <= 50) return 'text-amber-300';
    return 'text-emerald-300';
  };

  const toggleSection = useCallback((sectionId: SettingsSectionId) => {
    setExpandedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId]
    }));
  }, []);

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="bg-black px-4 py-3 border-b border-zinc-900 flex items-center justify-between sticky top-0 z-40 backdrop-blur-xl">
        <button onClick={() => onNavigate('hub')} className="text-zinc-400 hover:text-white" type="button">Cancel</button>
        <h1 className="text-base font-semibold tracking-tight">Settings</h1>
        <button onClick={() => onNavigate('hub')} className="text-blue-500 font-medium" type="button">Done</button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-28 space-y-6">
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <button
            type="button"
            onClick={() => toggleSection('defaultModel')}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <h3 className="text-xs uppercase text-zinc-500">Modelo por defecto (chats nuevos)</h3>
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              {expandedSections.defaultModel ? 'Ocultar' : 'Abrir'}
              <ChevronDown
                size={14}
                className={`transition-transform ${expandedSections.defaultModel ? 'rotate-180' : ''}`}
              />
            </span>
          </button>
          {expandedSections.defaultModel ? (
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
          ) : null}
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <button
            type="button"
            onClick={() => toggleSection('reasoning')}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <h3 className="text-xs uppercase text-zinc-500">Razonamiento por defecto (chats nuevos)</h3>
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              {expandedSections.reasoning ? 'Ocultar' : 'Abrir'}
              <ChevronDown
                size={14}
                className={`transition-transform ${expandedSections.reasoning ? 'rotate-180' : ''}`}
              />
            </span>
          </button>
          {expandedSections.reasoning ? (
            <select
              value={reasoningEffort}
              onChange={(event) => onReasoningChange(event.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5"
            >
              {options.reasoningEfforts.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          ) : null}
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-4">
          <button
            type="button"
            onClick={() => toggleSection('capabilities')}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <h3 className="text-xs uppercase text-zinc-500">Capabilities</h3>
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              {expandedSections.capabilities ? 'Ocultar' : 'Abrir'}
              <ChevronDown
                size={14}
                className={`transition-transform ${expandedSections.capabilities ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {expandedSections.capabilities ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span>Web Browsing</span>
                <ToggleSwitch
                  checked={caps.web}
                  onChange={(nextValue) => onCapsChange({ ...caps, web: nextValue })}
                />
              </div>

              <div className="flex items-center justify-between text-sm">
                <span>Code Interpreter</span>
                <ToggleSwitch
                  checked={caps.code}
                  onChange={(nextValue) => onCapsChange({ ...caps, code: nextValue })}
                />
              </div>

              <div className="flex items-center justify-between text-sm">
                <span>Long Term Memory</span>
                <ToggleSwitch
                  checked={caps.memory}
                  onChange={(nextValue) => onCapsChange({ ...caps, memory: nextValue })}
                />
              </div>
            </>
          ) : null}
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-4">
          <button
            type="button"
            onClick={() => toggleSection('discordWebhook')}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <h3 className="text-xs uppercase text-zinc-500">Discord webhook</h3>
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              {expandedSections.discordWebhook ? 'Ocultar' : 'Abrir'}
              <ChevronDown
                size={14}
                className={`transition-transform ${expandedSections.discordWebhook ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {expandedSections.discordWebhook ? (
            <>
              <div className="flex items-center justify-end">
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

              <div className="flex items-center justify-between text-sm">
                <span>Notificar al finalizar respuesta</span>
                <ToggleSwitch
                  checked={notifications.notifyOnFinish}
                  disabled={notificationsLoading || notificationsSaving}
                  onChange={(nextValue) => {
                    void saveNotifications({ notifyOnFinish: nextValue });
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-sm">
                <span>Incluir resultado en el aviso</span>
                <ToggleSwitch
                  checked={notifications.includeResult}
                  disabled={notificationsLoading || notificationsSaving}
                  onChange={(nextValue) => {
                    void saveNotifications({ includeResult: nextValue });
                  }}
                />
              </div>

              {notificationsError ? <p className="text-xs text-red-300">{notificationsError}</p> : null}
            </>
          ) : null}
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <button
            type="button"
            onClick={() => toggleSection('codexAccount')}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <h3 className="text-xs uppercase text-zinc-500">Codex CLI (cuenta por usuario)</h3>
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              {expandedSections.codexAccount ? 'Ocultar' : 'Abrir'}
              <ChevronDown
                size={14}
                className={`transition-transform ${expandedSections.codexAccount ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {expandedSections.codexAccount ? (
            <>
              <div className="flex items-center justify-end">
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

                {showAuthDetails ? (
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3 space-y-2">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">Cuenta asociada</p>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-zinc-500">Cuenta ChatGPT</span>
                        <span className="text-zinc-200 text-right break-all">{authDetails?.email || '-'}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-zinc-500">Account ID</span>
                        <span className="text-zinc-200 text-right break-all">{authDetails?.accountId || '-'}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-zinc-500">Metodo</span>
                        <span className="text-zinc-200 text-right">
                          {formatAuthMethodLabel(authDetails?.authMethod || authDetails?.authMode || '')}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-zinc-500">Email verificado</span>
                        <span className="text-zinc-200 text-right">
                          {authDetails?.email
                            ? authDetails?.emailVerified
                              ? 'Si'
                              : 'No'
                            : '-'}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-zinc-500">Auth provider</span>
                        <span className="text-zinc-200 text-right break-all">{authDetails?.authProvider || '-'}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-zinc-500">Ultimo refresh</span>
                        <span className="text-zinc-200 text-right">{formatDate(authDetails?.lastRefresh || '')}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-zinc-500">Token expira</span>
                        <span className="text-zinc-200 text-right">{formatDate(authDetails?.tokenExpiresAt || '')}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-zinc-500">Comprobado</span>
                        <span className="text-zinc-200 text-right">{formatDate(authDetails?.checkedAt || '')}</span>
                      </div>
                    </div>
                  </div>
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
            </>
          ) : null}
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <button
            type="button"
            onClick={() => toggleSection('aiAgents')}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <h3 className="text-xs uppercase text-zinc-500">Agentes IA compatibles</h3>
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              {expandedSections.aiAgents ? 'Ocultar' : 'Abrir'}
              <ChevronDown
                size={14}
                className={`transition-transform ${expandedSections.aiAgents ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {expandedSections.aiAgents ? (
            <>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => {
                    void loadAiAgents();
                  }}
                  disabled={agentsLoading || Boolean(agentsSavingId)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                >
                  {agentsLoading ? 'Cargando...' : 'Refrescar'}
                </button>
              </div>

              <p className="text-xs text-zinc-500">
                Configura integraciones por agente desde Settings. Gratis: {freeAgentsCount}/{agents.length}
              </p>

              {agentsError ? <p className="text-xs text-red-300">{agentsError}</p> : null}

              {agentsLoading ? (
                <p className="text-sm text-zinc-400">Cargando agentes...</p>
              ) : null}

              {!agentsLoading && agents.length === 0 ? (
                <p className="text-sm text-zinc-400">No hay agentes disponibles.</p>
              ) : null}

              {!agentsLoading && agents.length > 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
                  <p className="text-xs text-zinc-400">Seleccion de agente a usar</p>
                  {selectableIntegratedAgents.length === 0 ? (
                    <p className="text-xs text-amber-300">
                      No hay agentes listos. Activa y configura al menos uno para poder seleccionarlo.
                    </p>
                  ) : (
                    <>
                      <select
                        value={activeAgentDraft}
                        onChange={(event) => {
                          setActiveAgentDraft(event.target.value);
                          if (agentsError) setAgentsError('');
                        }}
                        disabled={activeAgentSaving || Boolean(agentsSavingId)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
                      >
                        <option value="">Seleccionar agente...</option>
                        {selectableIntegratedAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void saveActiveAiAgent();
                          }}
                          disabled={activeAgentSaving || !activeAgentHasChanges}
                          className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                        >
                          {activeAgentSaving ? 'Guardando...' : 'Guardar agente activo'}
                        </button>
                        {activeAgentSavedMessage ? (
                          <span className="text-xs text-emerald-300">{activeAgentSavedMessage}</span>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {!agentsLoading && agents.length > 0 ? (
                <div className="space-y-3">
                  {agents.map((agent) => {
                    const fallbackDraft = {
                      enabled: agent.integration.enabled,
                      apiKey: '',
                      apiKeyDirty: false,
                      baseUrl: agent.integration.baseUrl || ''
                    };
                    const draft = agentsDrafts[agent.id] || fallbackDraft;
                    const isExpanded = Boolean(expandedAgentIds[agent.id]);
                    const showApiKey = agent.integrationType === 'api_key';
                    const enabledChanged = draft.enabled !== agent.integration.enabled;
                    const baseUrlChanged = (draft.baseUrl || '').trim() !== (agent.integration.baseUrl || '').trim();
                    const hasChanges = enabledChanged || baseUrlChanged || draft.apiKeyDirty;
                    const isSaving = agentsSavingId === agent.id;
                    const statusText = !draft.enabled
                      ? 'Desactivado'
                      : agent.integration.configured || !showApiKey
                        ? 'Listo'
                        : 'Falta API key';
                    const statusClass =
                      !draft.enabled
                        ? 'text-zinc-400'
                        : agent.integration.configured || !showApiKey
                          ? 'text-emerald-300'
                          : 'text-amber-300';
                    return (
                      <div key={agent.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedAgentIds((current) => ({
                                ...current,
                                [agent.id]: !current[agent.id]
                              }));
                            }}
                            className="text-left flex-1 space-y-1"
                          >
                            <p className="text-sm text-zinc-100">{agent.name}</p>
                            <p className="text-[11px] text-zinc-500">
                              {agent.vendor} · {formatAgentIntegrationLabel(agent.integrationType)}
                            </p>
                            <p className="text-xs text-zinc-400">
                              {isExpanded ? 'Ocultar detalles' : 'Ver detalles'}
                            </p>
                          </button>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                agent.isFree
                                  ? 'border-emerald-500/50 text-emerald-300'
                                  : agent.pricing === 'freemium'
                                    ? 'border-blue-500/50 text-blue-300'
                                    : 'border-zinc-600 text-zinc-300'
                              }`}
                            >
                              {formatAgentPricingLabel(agent.pricing)}
                            </span>
                            <a
                              href={agent.docsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-zinc-400 hover:text-white"
                              title="Abrir documentación"
                            >
                              <ExternalLink size={14} />
                            </a>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-zinc-500">
                            Estado: <span className={statusClass}>{statusText}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            {activeAgentId === agent.id ? (
                              <span className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-300">
                                En uso
                              </span>
                            ) : null}
                            {agent.integration.updatedAt ? (
                              <span className="text-zinc-500">Actualizado: {formatDate(agent.integration.updatedAt)}</span>
                            ) : null}
                          </div>
                        </div>

                        {isExpanded ? (
                          <>
                            <p className="text-xs text-zinc-400">{agent.description}</p>

                            <div className="flex items-center justify-between text-sm">
                              <span>Activar integracion</span>
                              <ToggleSwitch
                                checked={draft.enabled}
                                onChange={(nextValue) => {
                                  setAgentsDrafts((current) => ({
                                    ...current,
                                    [agent.id]: {
                                      ...(current[agent.id] || fallbackDraft),
                                      enabled: nextValue
                                    }
                                  }));
                                  if (agentsError) setAgentsError('');
                                }}
                              />
                            </div>

                            <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 space-y-2">
                              <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                                {agent.tutorial?.title || `Integracion ${agent.name}`}
                              </p>
                              <ol className="list-decimal pl-5 space-y-1 text-xs text-zinc-300">
                                {(Array.isArray(agent.tutorial?.steps) ? agent.tutorial.steps : []).map((step, index) => (
                                  <li key={`${agent.id}-tutorial-${index}`}>{step}</li>
                                ))}
                              </ol>
                              {Array.isArray(agent.tutorial?.notes) && agent.tutorial.notes.length > 0 ? (
                                <div className="space-y-1">
                                  {agent.tutorial.notes.map((note, index) => (
                                    <p key={`${agent.id}-note-${index}`} className="text-[11px] text-zinc-500">
                                      Nota: {note}
                                    </p>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            {showApiKey ? (
                              <div className="space-y-2">
                                <input
                                  type="password"
                                  autoComplete="off"
                                  placeholder="API key (deja vacio para mantener la actual)"
                                  value={draft.apiKey}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setAgentsDrafts((current) => ({
                                      ...current,
                                      [agent.id]: {
                                        ...(current[agent.id] || fallbackDraft),
                                        apiKey: value,
                                        apiKeyDirty: true
                                      }
                                    }));
                                    if (agentsError) setAgentsError('');
                                  }}
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
                                />
                                <p className="text-[11px] text-zinc-500">
                                  API key guardada: {agent.integration.hasApiKey ? agent.integration.apiKeyMasked : 'No'}
                                </p>
                              </div>
                            ) : null}

                            {agent.supportsBaseUrl ? (
                              <div className="space-y-2">
                                <input
                                  type="url"
                                  inputMode="url"
                                  placeholder="Base URL opcional (https://...)"
                                  value={draft.baseUrl}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setAgentsDrafts((current) => ({
                                      ...current,
                                      [agent.id]: {
                                        ...(current[agent.id] || fallbackDraft),
                                        baseUrl: value
                                      }
                                    }));
                                    if (agentsError) setAgentsError('');
                                  }}
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
                                />
                              </div>
                            ) : null}

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  void saveAiAgent(agent.id);
                                }}
                                disabled={isSaving || !hasChanges}
                                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                              >
                                {isSaving ? 'Guardando...' : 'Guardar'}
                              </button>
                              {agentsSavedId === agent.id ? (
                                <span className="text-xs text-emerald-300">Guardado</span>
                              ) : null}
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <button
            type="button"
            onClick={() => toggleSection('codexQuota')}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <h3 className="text-xs uppercase text-zinc-500">Codex quota</h3>
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              {expandedSections.codexQuota ? 'Ocultar' : 'Abrir'}
              <ChevronDown
                size={14}
                className={`transition-transform ${expandedSections.codexQuota ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {expandedSections.codexQuota ? (
            <>
              <div className="flex items-center justify-end">
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
            </>
          ) : null}
        </section>
      </main>

      <BottomNav active="settings" onNavigate={onNavigate} />
    </div>
  );
}
