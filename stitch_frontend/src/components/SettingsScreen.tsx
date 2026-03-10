import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import BottomNav from './BottomNav';
import {
  getAiAgentSettings,
  listAiProviders,
  cancelCodexDeviceLogin,
  getCodexAuthStatus,
  getNotificationSettings,
  getCodexQuota,
  logoutCodexAuth,
  startCodexDeviceLogin,
  updateActiveAiAgentSetting,
  updateAiAgentSetting,
  updateAiProviderPermissions,
  updateNotificationSettings
} from '../lib/api';
import type {
  AiAgentSettingsItem,
  AiProviderInfo,
  AiProviderPermissionProfile,
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

type SettingsView =
  | 'menu'
  | 'chatDefaults'
  | 'aiIntegrations'
  | 'activeAgent'
  | 'agentQuotas'
  | 'agentPermissions'
  | 'webhook';

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
  const [activeView, setActiveView] = useState<SettingsView>('menu');
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
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState('');
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, AiProviderPermissionProfile>>({});
  const [savingPermissionProviderId, setSavingPermissionProviderId] = useState('');

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

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProvidersError('');
    try {
      const payload = await listAiProviders();
      const nextProviders = Array.isArray(payload.providers) ? payload.providers : [];
      setProviders(nextProviders);
      setPermissionDrafts((prev) => {
        const next: Record<string, AiProviderPermissionProfile> = { ...prev };
        nextProviders.forEach((provider) => {
          if (!provider?.id) return;
          if (!next[provider.id]) {
            next[provider.id] = provider.permissions;
          }
        });
        return next;
      });
    } catch (error) {
      setProvidersError(error instanceof Error ? error.message : 'No se pudo cargar catálogo de providers');
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuota();
    loadAuth();
    loadNotifications();
    loadAiAgents();
    loadProviders();
  }, [loadAiAgents, loadAuth, loadNotifications, loadProviders, loadQuota]);

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
        setAgents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
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
        void loadProviders();
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
    [agents, agentsDrafts, loadProviders]
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
      void loadProviders();
      setActiveAgentSavedMessage('Guardado');
      window.setTimeout(() => {
        setActiveAgentSavedMessage((current) => (current === 'Guardado' ? '' : current));
      }, 1800);
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : 'No se pudo guardar el agente activo');
    } finally {
      setActiveAgentSaving(false);
    }
  }, [activeAgentDraft, loadProviders]);

  const saveProviderPermissions = useCallback(async (providerId: string) => {
    const draft = permissionDrafts[providerId];
    if (!draft) return;
    setSavingPermissionProviderId(providerId);
    setProvidersError('');
    try {
      const saved = await updateAiProviderPermissions(providerId, draft);
      setPermissionDrafts((prev) => ({
        ...prev,
        [providerId]: saved
      }));
      setProviders((prev) =>
        prev.map((provider) =>
          provider.id === providerId ? { ...provider, permissions: saved } : provider
        )
      );
    } catch (error) {
      setProvidersError(error instanceof Error ? error.message : 'No se pudieron guardar permisos del provider');
    } finally {
      setSavingPermissionProviderId('');
    }
  }, [permissionDrafts]);

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
      await loadAiAgents();
      await loadProviders();
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
      await loadAiAgents();
      await loadQuota();
      await loadProviders();
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
  const integratedAgents = agents.filter((agent) => agent.integration.enabled);
  const selectableIntegratedAgents = integratedAgents.filter((agent) => agent.integration.configured);
  const activeAgentHasChanges = activeAgentDraft !== activeAgentId;
  const activeAgentName =
    agents.find((entry) => entry.id === activeAgentId)?.name ||
    (activeAgentId ? activeAgentId : 'Sin seleccionar');
  const codexAgentEnabled = Boolean(
    agents.find((entry) => entry.id === 'codex-cli')?.integration.enabled
  );

  const quotaAgents = useMemo(
    () =>
      providers.filter(
        (provider) => provider.integration.enabled && provider.integration.configured
      ),
    [providers]
  );
  const connectedWithoutQuotaAgents = useMemo(
    () => quotaAgents.filter((provider) => !provider.quota.available),
    [quotaAgents]
  );

  const getRemainingColorClass = (remainingPercent: number) => {
    if (remainingPercent <= 20) return 'text-red-300';
    if (remainingPercent <= 50) return 'text-amber-300';
    return 'text-emerald-300';
  };

  const viewTitle =
    activeView === 'menu'
      ? 'Settings'
      : activeView === 'chatDefaults'
        ? 'Settings · Chat por defecto'
        : activeView === 'aiIntegrations'
          ? 'Settings · Integraciones IA'
          : activeView === 'activeAgent'
            ? 'Settings · Agente en uso'
            : activeView === 'agentQuotas'
              ? 'Settings · Cuotas de agentes'
              : activeView === 'agentPermissions'
                ? 'Settings · Permisos por IA'
              : 'Settings · Webhook';

  const handleBack = () => {
    if (activeView === 'menu') {
      onNavigate('hub');
      return;
    }
    setActiveView('menu');
  };

  const refreshCurrentView = () => {
    if (activeView === 'chatDefaults') {
      return;
    }
    if (activeView === 'aiIntegrations') {
      void loadAiAgents();
      void loadAuth();
      void loadProviders();
      return;
    }
    if (activeView === 'activeAgent') {
      void loadAiAgents();
      void loadProviders();
      return;
    }
    if (activeView === 'agentQuotas') {
      void loadProviders();
      void loadQuota();
      return;
    }
    if (activeView === 'agentPermissions') {
      void loadProviders();
      return;
    }
    if (activeView === 'webhook') {
      void loadNotifications();
      return;
    }
    void loadAiAgents();
    void loadProviders();
    void loadAuth();
    void loadQuota();
    void loadNotifications();
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <button onClick={handleBack} className="p-2 -ml-2 text-zinc-400 hover:text-white" type="button">
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-base font-semibold tracking-tight">{viewTitle}</h1>
        <button
          onClick={refreshCurrentView}
          className="p-2 -mr-2 text-zinc-400 hover:text-white"
          type="button"
          aria-label="Refrescar ajustes"
        >
          <RefreshCw size={18} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-6">
        {activeView === 'menu' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Menu de ajustes</h2>
              <p className="text-xs text-zinc-500">Cada bloque se abre en su propia vista, igual que en Tools.</p>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setActiveView('chatDefaults')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100">Chat por defecto</p>
                    <p className="text-xs text-zinc-500 truncate">Modelo, razonamiento y capabilities.</p>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('aiIntegrations')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100">Integraciones IA</p>
                    <p className="text-xs text-zinc-500 truncate">
                      {integratedAgents.length}/{agents.length} activas · gratis {freeAgentsCount}/{agents.length}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('activeAgent')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100">Seleccion de agente en uso</p>
                    <p className="text-xs text-zinc-500 truncate">Actual: {activeAgentName}</p>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('agentQuotas')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100">Cuotas por agente</p>
                    <p className="text-xs text-zinc-500 truncate">
                      {quotaAgents.length} provider(s) conectado(s)
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('agentPermissions')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100">Permisos por IA</p>
                    <p className="text-xs text-zinc-500 truncate">
                      Control granular de root, rutas, shell, red, git y backups.
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('webhook')}
                className="w-full text-left rounded-xl border border-zinc-800 bg-black/40 p-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100">Webhook y notificaciones</p>
                    <p className="text-xs text-zinc-500 truncate">
                      {notifications.notifyOnFinish ? 'Avisos activados' : 'Avisos desactivados'}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </button>
            </div>
          </section>
        ) : null}

        {activeView === 'chatDefaults' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Configuracion base para chats nuevos</h2>
              <p className="text-xs text-zinc-500">Estas dos primeras opciones se aplican al crear chats nuevos.</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase text-zinc-500">Modelo por defecto</p>
              <select
                value={model}
                onChange={(event) => onModelChange(event.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5"
              >
                <option value="">Automatico (default CLI)</option>
                {options.models.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase text-zinc-500">Razonamiento por defecto</p>
              <select
                value={reasoningEffort}
                onChange={(event) => onReasoningChange(event.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5"
              >
                {options.reasoningEfforts.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 space-y-3">
              <p className="text-xs uppercase text-zinc-500">Capabilities</p>

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
            </div>
          </section>
        ) : null}

        {activeView === 'aiIntegrations' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Integraciones de agentes IA</h2>
                <p className="text-xs text-zinc-500">
                  Codex CLI ya va como una integracion mas dentro del listado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void loadAiAgents();
                  void loadAuth();
                }}
                disabled={agentsLoading || Boolean(agentsSavingId)}
                className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
              >
                {agentsLoading ? 'Cargando...' : 'Refrescar'}
              </button>
            </div>

            <p className="text-xs text-zinc-500">
              Integradas: {integratedAgents.length}/{agents.length} · Gratis: {freeAgentsCount}/{agents.length}
            </p>

            {agentsError ? <p className="text-xs text-red-300">{agentsError}</p> : null}
            {authError ? <p className="text-xs text-red-300">{authError}</p> : null}

            {agentsLoading ? <p className="text-sm text-zinc-400">Cargando agentes...</p> : null}
            {!agentsLoading && agents.length === 0 ? (
              <p className="text-sm text-zinc-400">No hay agentes disponibles.</p>
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
                  const isCodexAgent = agent.id === 'codex-cli';
                  const showApiKey = agent.integrationType === 'api_key';
                  const enabledChanged = draft.enabled !== agent.integration.enabled;
                  const baseUrlChanged = (draft.baseUrl || '').trim() !== (agent.integration.baseUrl || '').trim();
                  const hasChanges = enabledChanged || baseUrlChanged || draft.apiKeyDirty;
                  const isSaving = agentsSavingId === agent.id;
                  const codexReady = Boolean(auth?.loggedIn);
                  const statusText = !draft.enabled
                    ? 'Desactivado'
                    : isCodexAgent
                      ? codexReady
                        ? 'Listo'
                        : 'Falta iniciar sesion'
                      : agent.integration.configured || !showApiKey
                        ? 'Listo'
                        : 'Falta API key';
                  const statusClass =
                    !draft.enabled
                      ? 'text-zinc-400'
                      : statusText === 'Listo'
                        ? 'text-emerald-300'
                        : 'text-amber-300';
                  const toggleDisabled = isCodexAgent && codexReady;

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
                          <p className="text-xs text-zinc-400">{isExpanded ? 'Ocultar detalles' : 'Ver detalles'}</p>
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
                              disabled={toggleDisabled}
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

                          {isCodexAgent ? (
                            <div className="rounded-lg border border-zinc-800 bg-black/40 p-3 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-zinc-300">Cuenta Codex CLI</p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void loadAuth();
                                    void loadAiAgents();
                                  }}
                                  disabled={authLoading || authActionBusy}
                                  className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white disabled:opacity-50"
                                >
                                  {authLoading ? 'Cargando...' : 'Refrescar estado'}
                                </button>
                              </div>

                              <p className="text-xs text-zinc-500">
                                Estado:{' '}
                                {auth?.loggedIn ? (
                                  <span className="text-emerald-300">Conectado</span>
                                ) : auth?.loginInProgress ? (
                                  <span className="text-amber-300">Esperando verificacion</span>
                                ) : (
                                  <span className="text-zinc-400">Sin conectar</span>
                                )}
                              </p>

                              {toggleDisabled ? (
                                <p className="text-[11px] text-zinc-500">
                                  Codex CLI queda activado automaticamente mientras la cuenta ChatGPT este vinculada.
                                </p>
                              ) : null}

                              {auth?.statusText ? (
                                <p className="text-xs text-zinc-500 whitespace-pre-wrap break-words">{auth.statusText}</p>
                              ) : null}

                              {showAuthDetails ? (
                                <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 space-y-2">
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
                                        {authDetails?.email ? (authDetails?.emailVerified ? 'Si' : 'No') : '-'}
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
                                  </div>
                                </div>
                              ) : null}

                              {auth?.loginInProgress && auth.login ? (
                                <div className="space-y-2 rounded-lg border border-zinc-800 bg-black/30 p-3">
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
                                    Iniciar sesion con ChatGPT
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
                          ) : null}

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
          </section>
        ) : null}

        {activeView === 'activeAgent' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Agente que se esta utilizando</h2>
                <p className="text-xs text-zinc-500">Solo aparecen agentes integrados y configurados.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void loadAiAgents();
                }}
                disabled={agentsLoading || activeAgentSaving}
                className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
              >
                {agentsLoading ? 'Cargando...' : 'Refrescar'}
              </button>
            </div>

            {agentsError ? <p className="text-xs text-red-300">{agentsError}</p> : null}

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
              <p className="text-xs text-zinc-400">Agente actual: {activeAgentName}</p>

              {selectableIntegratedAgents.length === 0 ? (
                <p className="text-xs text-amber-300">
                  No hay agentes listos. Activa y configura al menos uno desde Integraciones IA.
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
          </section>
        ) : null}

        {activeView === 'agentQuotas' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Cuotas de agentes conectados</h2>
                <p className="text-xs text-zinc-500">
                  Se muestran cuotas solo de agentes conectados con datos disponibles.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void loadProviders();
                  void loadQuota();
                }}
                disabled={quotaLoading || providersLoading}
                className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
              >
                {quotaLoading || providersLoading ? 'Cargando...' : 'Recargar'}
              </button>
            </div>

            {providersError ? <p className="text-xs text-red-300">{providersError}</p> : null}
            {quotaError ? <p className="text-xs text-red-300">{quotaError}</p> : null}

            {providersLoading ? (
              <p className="text-sm text-zinc-400">Cargando providers...</p>
            ) : null}

            {!providersLoading && quotaAgents.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No hay agentes conectados y configurados. Activa integraciones para ver cuotas.
              </p>
            ) : null}

            {quotaAgents.length > 0 ? (
              <div className="space-y-3">
                {quotaAgents.map((provider) => {
                  const quotaInfo = provider.quota;
                  const hasNumericQuota =
                    Number.isFinite(Number(quotaInfo?.limit)) &&
                    Number.isFinite(Number(quotaInfo?.remaining));
                  const remainingPercent = hasNumericQuota
                    ? Math.max(
                        0,
                        Math.min(
                          100,
                          (Number(quotaInfo?.remaining || 0) / Math.max(1, Number(quotaInfo?.limit || 1))) * 100
                        )
                      )
                    : null;
                  return (
                  <div key={provider.id} className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
                    <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
                      <p className="text-sm text-zinc-200">{provider.name}</p>
                      {provider.integration.configured ? (
                        <span className="text-[11px] text-emerald-300">Conectado</span>
                      ) : (
                        <span className="text-[11px] text-zinc-500">Sin conectar</span>
                      )}
                    </div>

                    {!quotaInfo?.available ? (
                      <p className="px-3 py-3 text-sm text-zinc-400">
                        Cuota no disponible para este provider.
                      </p>
                    ) : (
                      <div className="px-3 py-3 space-y-1">
                        <p className="text-xs text-zinc-300">
                          usado {quotaInfo.used ?? 'n/a'} · límite {quotaInfo.limit ?? 'n/a'} · restante{' '}
                          {quotaInfo.remaining ?? 'n/a'} {quotaInfo.unit || ''}
                        </p>
                        {remainingPercent !== null ? (
                          <p className={`text-xs ${getRemainingColorClass(remainingPercent)}`}>
                            restante {formatPercent(remainingPercent)}
                          </p>
                        ) : null}
                        {quotaInfo.resetAt ? (
                          <p className="text-xs text-zinc-500">reset: {formatDate(quotaInfo.resetAt)}</p>
                        ) : null}
                      </div>
                    )}

                    {provider.id === 'codex-cli' && quota ? (
                      <div className="px-3 py-2 border-t border-zinc-800 space-y-1">
                        <p className="text-xs text-zinc-500">Fuente: {quota.source || '-'}</p>
                        <p className="text-xs text-zinc-500">Actualizado: {formatDate(quota.fetchedAt)}</p>
                        {quota.planType ? <p className="text-xs text-zinc-500">Plan: {quota.planType}</p> : null}
                      </div>
                    ) : null}
                  </div>
                )})}
              </div>
            ) : null}

            {connectedWithoutQuotaAgents.length > 0 ? (
              <p className="text-xs text-zinc-500">
                Sin datos de cuota para: {connectedWithoutQuotaAgents.map((agent) => agent.name).join(', ')}.
              </p>
            ) : null}
          </section>
        ) : null}

        {activeView === 'agentPermissions' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Permisos granulares por provider</h2>
                <p className="text-xs text-zinc-500">
                  Enforcement real en backend para shell, git, backups, rutas y modo solo lectura.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void loadProviders();
                }}
                disabled={providersLoading}
                className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
              >
                {providersLoading ? 'Cargando...' : 'Refrescar'}
              </button>
            </div>

            {providersError ? <p className="text-xs text-red-300">{providersError}</p> : null}

            {providersLoading ? <p className="text-sm text-zinc-400">Cargando providers...</p> : null}

            {!providersLoading && providers.length === 0 ? (
              <p className="text-sm text-zinc-400">No hay providers disponibles.</p>
            ) : null}

            <div className="space-y-3">
              {providers.map((provider) => {
                const draft = permissionDrafts[provider.id] || provider.permissions;
                const saving = savingPermissionProviderId === provider.id;
                return (
                  <article key={provider.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-zinc-100">{provider.name}</p>
                      <span className="text-[11px] text-zinc-500">{provider.id}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-2 py-1.5">
                        root
                        <ToggleSwitch
                          checked={Boolean(draft.allowRoot)}
                          onChange={(nextValue) => {
                            setPermissionDrafts((prev) => ({
                              ...prev,
                              [provider.id]: { ...draft, allowRoot: nextValue }
                            }));
                          }}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-2 py-1.5">
                        solo lectura
                        <ToggleSwitch
                          checked={Boolean(draft.readOnly)}
                          onChange={(nextValue) => {
                            setPermissionDrafts((prev) => ({
                              ...prev,
                              [provider.id]: { ...draft, readOnly: nextValue }
                            }));
                          }}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-2 py-1.5">
                        shell
                        <ToggleSwitch
                          checked={Boolean(draft.allowShell)}
                          onChange={(nextValue) => {
                            setPermissionDrafts((prev) => ({
                              ...prev,
                              [provider.id]: { ...draft, allowShell: nextValue }
                            }));
                          }}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-2 py-1.5">
                        red
                        <ToggleSwitch
                          checked={Boolean(draft.allowNetwork)}
                          onChange={(nextValue) => {
                            setPermissionDrafts((prev) => ({
                              ...prev,
                              [provider.id]: { ...draft, allowNetwork: nextValue }
                            }));
                          }}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-2 py-1.5">
                        git
                        <ToggleSwitch
                          checked={Boolean(draft.allowGit)}
                          onChange={(nextValue) => {
                            setPermissionDrafts((prev) => ({
                              ...prev,
                              [provider.id]: { ...draft, allowGit: nextValue }
                            }));
                          }}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-2 py-1.5">
                        backup/restore
                        <ToggleSwitch
                          checked={Boolean(draft.allowBackupRestore)}
                          onChange={(nextValue) => {
                            setPermissionDrafts((prev) => ({
                              ...prev,
                              [provider.id]: { ...draft, allowBackupRestore: nextValue }
                            }));
                          }}
                        />
                      </label>
                    </div>

                    <div className="space-y-2">
                      <input
                        value={draft.runAsUser || ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          setPermissionDrafts((prev) => ({
                            ...prev,
                            [provider.id]: { ...draft, runAsUser: value }
                          }));
                        }}
                        placeholder="usuario sistema (vacío = por defecto)"
                        className="w-full rounded-lg border border-zinc-800 bg-black/60 px-2 py-1.5 text-xs text-zinc-200"
                      />
                      <input
                        value={(draft.allowedPaths || []).join(', ')}
                        onChange={(event) => {
                          const values = event.target.value
                            .split(',')
                            .map((entry) => entry.trim())
                            .filter(Boolean);
                          setPermissionDrafts((prev) => ({
                            ...prev,
                            [provider.id]: { ...draft, allowedPaths: values.length > 0 ? values : ['/'] }
                          }));
                        }}
                        placeholder="/root/CodexWeb,/home,/opt"
                        className="w-full rounded-lg border border-zinc-800 bg-black/60 px-2 py-1.5 text-xs text-zinc-200"
                      />
                      <input
                        value={(draft.deniedPaths || []).join(', ')}
                        onChange={(event) => {
                          const values = event.target.value
                            .split(',')
                            .map((entry) => entry.trim())
                            .filter(Boolean);
                          setPermissionDrafts((prev) => ({
                            ...prev,
                            [provider.id]: { ...draft, deniedPaths: values }
                          }));
                        }}
                        placeholder="rutas bloqueadas separadas por coma"
                        className="w-full rounded-lg border border-zinc-800 bg-black/60 px-2 py-1.5 text-xs text-zinc-200"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-zinc-500">
                        actualizado: {draft.updatedAt ? formatDate(draft.updatedAt) : '-'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void saveProviderPermissions(provider.id);
                        }}
                        disabled={saving}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                      >
                        {saving ? 'Guardando...' : 'Guardar permisos'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeView === 'webhook' ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Discord webhook</h2>
                <p className="text-xs text-zinc-500">
                  Recibe aviso cuando termina una respuesta (estado, hora, duración y resultado opcional).
                </p>
              </div>
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
          </section>
        ) : null}
      </main>

      <BottomNav active="settings" onNavigate={onNavigate} />
    </div>
  );
}
