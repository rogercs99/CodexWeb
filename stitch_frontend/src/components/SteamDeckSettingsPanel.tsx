import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelSteamDeckJob,
  detectSteamDeckEnvironment,
  generateSteamDeckKey,
  getSteamDeckConfig,
  getSteamDeckJob,
  getSteamDeckJobs,
  getSteamDeckSetupLink,
  runSteamDeckCodex,
  runSteamDeckCommand,
  saveSteamDeckConfig,
  testSteamDeckConnection
} from '../lib/api';
import type { SteamDeckSetupLink } from '../lib/api';
import type { SteamDeckConfig, SteamDeckDetectResult, SteamDeckJob } from '../lib/types';

const EMPTY_CONFIG: SteamDeckConfig = {
  enabled: false,
  configured: false,
  status: 'not_configured',
  deviceName: 'Steam Deck',
  host: '',
  port: 22,
  user: 'deck',
  authMethod: 'key',
  remoteWorkdir: '/home/deck',
  codexBin: 'codex',
  networkMode: 'auto',
  allowDangerousCommands: false,
  notifyDiscord: false,
  keyPath: '',
  hasPassword: false,
  hasPrivateKey: false,
  keyPathExists: false,
  keyFileMode: '',
  keyFileModeSafe: false,
  warningPublicHost: false,
  createdAt: '',
  updatedAt: ''
};

interface SteamDeckDraft {
  deviceName: string;
  host: string;
  port: string;
  user: string;
  authMethod: 'key' | 'password';
  remoteWorkdir: string;
  codexBin: string;
  networkMode: 'auto' | 'tailscale' | 'wireguard' | 'lan';
  allowDangerousCommands: boolean;
  notifyDiscord: boolean;
  keyPath: string;
  password: string;
  privateKey: string;
}

function configToDraft(config: SteamDeckConfig): SteamDeckDraft {
  return {
    deviceName: config.deviceName,
    host: config.host,
    port: String(config.port || 22),
    user: config.user,
    authMethod: config.authMethod,
    remoteWorkdir: config.remoteWorkdir,
    codexBin: config.codexBin,
    networkMode: config.networkMode,
    allowDangerousCommands: Boolean(config.allowDangerousCommands),
    notifyDiscord: Boolean(config.notifyDiscord),
    keyPath: config.keyPath,
    password: '',
    privateKey: ''
  };
}

function formatDate(value: string): string {
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
}

function truncateText(value: string, maxLen = 140): string {
  const text = String(value || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function formatDurationMs(value: number | null | undefined): string {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${String(rem).padStart(2, '0')}s`;
}

function statusClass(status: string): string {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'succeeded') return 'text-emerald-300';
  if (normalized === 'failed' || normalized === 'cancelled') return 'text-red-300';
  if (normalized === 'running') return 'text-blue-300';
  return 'text-zinc-400';
}

export default function SteamDeckSettingsPanel() {
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [config, setConfig] = useState<SteamDeckConfig>(EMPTY_CONFIG);
  const [draft, setDraft] = useState<SteamDeckDraft>(configToDraft(EMPTY_CONFIG));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [keygenBusy, setKeygenBusy] = useState(false);
  const [publicKey, setPublicKey] = useState('');

  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState('');

  const [detectBusy, setDetectBusy] = useState(false);
  const [detectResult, setDetectResult] = useState<SteamDeckDetectResult | null>(null);

  const [commandText, setCommandText] = useState('');
  const [commandOutput, setCommandOutput] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandBackground, setCommandBackground] = useState(false);
  const [confirmDangerous, setConfirmDangerous] = useState(false);
  const [dangerWarnings, setDangerWarnings] = useState<Array<{ id: string; label: string }>>([]);

  const [codexPrompt, setCodexPrompt] = useState('');
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexInheritEnv, setCodexInheritEnv] = useState(true);
  const [codexDangerSandbox, setCodexDangerSandbox] = useState(true);

  const [setupLink, setSetupLink] = useState<SteamDeckSetupLink | null>(null);
  const [setupLinkBusy, setSetupLinkBusy] = useState(false);
  const [setupLinkCopied, setSetupLinkCopied] = useState(false);
  const [setupLinkCmdCopied, setSetupLinkCmdCopied] = useState(false);

  const [jobs, setJobs] = useState<SteamDeckJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [jobBusyId, setJobBusyId] = useState('');

  const selectedJob = useMemo(() => jobs.find((entry) => entry.id === selectedJobId) || null, [jobs, selectedJobId]);
  const selectedLogRef = useRef<HTMLTextAreaElement | null>(null);

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(String(value || ''));
    } catch (_error) {
      // ignore clipboard errors
    }
  };

  const loadJobs = useCallback(async (silent = false) => {
    if (!silent) {
      setJobsLoading(true);
    }
    try {
      const listed = await getSteamDeckJobs(80);
      setJobs(listed);
      setSelectedJobId((current) => {
        if (current && listed.some((entry) => entry.id === current)) return current;
        return listed[0]?.id || '';
      });
    } catch (err) {
      const status = Number((err as any)?.status || 0);
      if (status === 403) {
        setJobs([]);
        return;
      }
      if (!silent) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar jobs');
      }
    } finally {
      if (!silent) {
        setJobsLoading(false);
      }
    }
  }, []);

  const loadConfig = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError('');
    try {
      const payload = await getSteamDeckConfig();
      setFeatureEnabled(Boolean(payload.enabled));
      setConfig(payload.config);
      setDraft(configToDraft(payload.config));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar configuración Steam Deck');
    } finally {
      if (!silent) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadJobs();
  }, [loadConfig, loadJobs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadJobs(true);
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadJobs]);

  useEffect(() => {
    if (!selectedLogRef.current) return;
    const el = selectedLogRef.current;
    el.scrollTop = el.scrollHeight;
  }, [selectedJob?.log, selectedJob?.stdout, selectedJob?.stderr]);

  const saveConfigHandler = async () => {
    setSaving(true);
    setError('');
    setInfo('');
    try {
      const payload: any = {
        deviceName: draft.deviceName,
        host: draft.host,
        port: Number.parseInt(draft.port, 10),
        user: draft.user,
        authMethod: draft.authMethod,
        remoteWorkdir: draft.remoteWorkdir,
        codexBin: draft.codexBin,
        networkMode: draft.networkMode,
        allowDangerousCommands: draft.allowDangerousCommands,
        notifyDiscord: draft.notifyDiscord,
        keyPath: draft.keyPath
      };
      if (draft.password.trim()) payload.password = draft.password;
      if (draft.privateKey.trim()) payload.privateKey = draft.privateKey;
      const next = await saveSteamDeckConfig(payload);
      setConfig(next);
      setDraft((current) => ({ ...configToDraft(next), password: '', privateKey: '' }));
      setInfo('Configuración Steam Deck guardada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar configuración');
    } finally {
      setSaving(false);
    }
  };

  const generateKeyHandler = async () => {
    setKeygenBusy(true);
    setError('');
    setInfo('');
    try {
      const result = await generateSteamDeckKey({ keyPath: draft.keyPath, force: false });
      setPublicKey(result.publicKey);
      setConfig(result.config);
      setDraft((current) => ({ ...current, keyPath: result.keyPath }));
      setInfo('Clave SSH generada en backend. Copia la pública en authorized_keys de la Deck.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar clave SSH');
    } finally {
      setKeygenBusy(false);
    }
  };

  const generateSetupLinkHandler = async () => {
    setSetupLinkBusy(true);
    setError('');
    setSetupLink(null);
    try {
      const result = await getSteamDeckSetupLink();
      setSetupLink(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el link de configuración');
    } finally {
      setSetupLinkBusy(false);
    }
  };

  const testConnectionHandler = async () => {
    setTestBusy(true);
    setError('');
    setTestResult('');
    try {
      const result = await testSteamDeckConnection();
      setTestResult(`OK · ${result.host} · ${result.user} · ${formatDurationMs(result.durationMs)}`);
    } catch (err: any) {
      setTestResult('');
      setError(err instanceof Error ? err.message : 'Test de conexión fallido');
    } finally {
      setTestBusy(false);
    }
  };

  const detectEnvironmentHandler = async () => {
    setDetectBusy(true);
    setError('');
    try {
      const result = await detectSteamDeckEnvironment();
      setDetectResult(result);
      setInfo('Entorno detectado correctamente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo detectar entorno');
    } finally {
      setDetectBusy(false);
    }
  };

  const runCommandHandler = async () => {
    if (!commandText.trim()) {
      setError('Escribe un comando antes de ejecutar.');
      return;
    }
    setCommandBusy(true);
    setError('');
    setInfo('');
    setDangerWarnings([]);
    setCommandOutput('');
    try {
      const result = await runSteamDeckCommand({
        command: commandText,
        background: commandBackground,
        confirmDangerous
      });
      if (result.warnings.length > 0) {
        setDangerWarnings(result.warnings);
      }
      if (result.queued && result.job) {
        setInfo(`Job encolado: ${result.job.id}`);
        setSelectedJobId(result.job.id);
        await loadJobs(true);
      } else if (result.result) {
        setCommandOutput([
          `exitCode: ${String(result.result.exitCode ?? '-')}`,
          `duration: ${formatDurationMs(result.result.durationMs)}`,
          '',
          'stdout:',
          result.result.stdout || '(vacío)',
          '',
          'stderr:',
          result.result.stderr || '(vacío)'
        ].join('\n'));
      }
    } catch (err: any) {
      const data = err?.data && typeof err.data === 'object' ? err.data : null;
      if (Array.isArray(data?.warnings)) {
        setDangerWarnings(
          data.warnings
            .map((entry: any) => ({ id: String(entry?.id || ''), label: String(entry?.label || '') }))
            .filter((entry: { id: string; label: string }) => Boolean(entry.id))
        );
      }
      const detailResult = data?.result;
      if (detailResult && typeof detailResult === 'object') {
        setCommandOutput([
          `exitCode: ${String(detailResult.exitCode ?? '-')}`,
          `duration: ${formatDurationMs(Number(detailResult.durationMs) || 0)}`,
          '',
          'stdout:',
          String(detailResult.stdout || '(vacío)'),
          '',
          'stderr:',
          String(detailResult.stderr || '(vacío)')
        ].join('\n'));
      }
      setError(err instanceof Error ? err.message : 'No se pudo ejecutar comando');
    } finally {
      setCommandBusy(false);
    }
  };

  const runCodexHandler = async () => {
    if (!codexPrompt.trim()) {
      setError('Escribe un prompt para Codex remoto.');
      return;
    }
    setCodexBusy(true);
    setError('');
    setInfo('');
    try {
      const result = await runSteamDeckCodex({
        prompt: codexPrompt,
        remoteWorkdir: draft.remoteWorkdir,
        codexBin: draft.codexBin,
        inheritEnvironment: codexInheritEnv,
        dangerSandbox: codexDangerSandbox
      });
      if (result.job) {
        setInfo(`Tarea Codex encolada: ${result.job.id}`);
        setSelectedJobId(result.job.id);
        await loadJobs(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar tarea Codex remota');
    } finally {
      setCodexBusy(false);
    }
  };

  const refreshSelectedJob = async () => {
    if (!selectedJobId) return;
    try {
      const refreshed = await getSteamDeckJob(selectedJobId);
      setJobs((current) => {
        const idx = current.findIndex((entry) => entry.id === refreshed.id);
        if (idx < 0) return [refreshed, ...current];
        const next = [...current];
        next[idx] = refreshed;
        return next;
      });
    } catch (_error) {
      // best effort
    }
  };

  const cancelJobHandler = async (jobId: string) => {
    if (!jobId) return;
    setJobBusyId(jobId);
    setError('');
    try {
      const updated = await cancelSteamDeckJob(jobId);
      setJobs((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setInfo(`Cancelación solicitada para ${jobId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar job');
    } finally {
      setJobBusyId('');
    }
  };

  if (loading) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <p className="text-sm text-zinc-400">Cargando Steam Deck SSH...</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">

      {/* ─── Configuración Rápida ─── */}
      <div className="rounded-2xl border border-violet-700/50 bg-violet-950/20 p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-violet-300">Configuración rápida</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Genera un link de un solo uso y ábrelo en la Steam Deck para conectarla automáticamente.
          </p>
        </div>

        <button
          type="button"
          onClick={() => { void generateSetupLinkHandler(); }}
          disabled={!featureEnabled || setupLinkBusy}
          className="text-xs px-3 py-1.5 rounded-lg border border-violet-600/70 text-violet-300 hover:text-violet-200 hover:border-violet-500 disabled:opacity-50"
        >
          {setupLinkBusy ? 'Generando...' : 'Obtener link de configuración'}
        </button>

        {setupLink ? (
          <div className="space-y-2.5">
            <div className="rounded-xl border border-zinc-700 bg-black/40 p-3 space-y-2">
              <p className="text-[11px] text-zinc-400 font-medium">Opción A — Abre esta URL en el navegador de la Steam Deck</p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 text-[11px] text-violet-300 whitespace-pre-wrap break-all leading-relaxed">{setupLink.setupPageUrl}</pre>
                <button
                  type="button"
                  onClick={() => {
                    void copyText(setupLink.setupPageUrl);
                    setSetupLinkCopied(true);
                    setTimeout(() => setSetupLinkCopied(false), 2000);
                  }}
                  className="shrink-0 text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white"
                >
                  {setupLinkCopied ? '✓' : 'Copiar'}
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-black/40 p-3 space-y-2">
              <p className="text-[11px] text-zinc-400 font-medium">Opción B — Ejecuta en Konsole de la Steam Deck</p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 text-[11px] text-emerald-300 whitespace-pre-wrap break-all leading-relaxed font-mono">{setupLink.curlCommand}</pre>
                <button
                  type="button"
                  onClick={() => {
                    void copyText(setupLink.curlCommand);
                    setSetupLinkCmdCopied(true);
                    setTimeout(() => setSetupLinkCmdCopied(false), 2000);
                  }}
                  className="shrink-0 text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white"
                >
                  {setupLinkCmdCopied ? '✓' : 'Copiar'}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-amber-400">
              Expira: {new Date(setupLink.expiresAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
              {' '}— Al ejecutar el script, la Deck se registra y la configuración se actualiza aquí.
            </p>
          </div>
        ) : null}

        {!featureEnabled ? (
          <p className="text-xs text-amber-300">Activa STEAMDECK_SSH_ENABLED=true en el entorno para usar esta función.</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Steam Deck SSH</h2>
            <p className="text-xs text-zinc-500">Control remoto seguro desde CodexWeb DEV.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadConfig({ silent: true });
              void loadJobs(true);
            }}
            disabled={refreshing || jobsLoading}
            className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
          >
            {refreshing || jobsLoading ? 'Actualizando...' : 'Refrescar'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <p className="text-xs text-zinc-500">
            Estado feature: <span className={featureEnabled ? 'text-emerald-300' : 'text-amber-300'}>{featureEnabled ? 'Habilitada' : 'Deshabilitada'}</span>
          </p>
          <p className="text-xs text-zinc-500">
            Configuración: <span className={config.configured ? 'text-emerald-300' : 'text-zinc-300'}>{config.status}</span>
          </p>
          <p className="text-xs text-zinc-500">Clave SSH: {config.hasPrivateKey ? 'presente' : 'ausente'}</p>
          <p className="text-xs text-zinc-500">Password SSH: {config.hasPassword ? 'guardado' : 'no guardado'}</p>
        </div>

        {!featureEnabled ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-600/10 p-3 text-xs text-amber-200">
            Steam Deck SSH está desactivado por entorno (`STEAMDECK_SSH_ENABLED=false`).
          </div>
        ) : null}
        {config.warningPublicHost ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-600/10 p-3 text-xs text-amber-200">
            El host parece público. Recomendado: Tailscale/WireGuard/LAN/Cloudflare Tunnel TCP en vez de exponer puerto 22.
          </div>
        ) : null}
        {config.keyPathExists && !config.keyFileModeSafe ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-600/10 p-3 text-xs text-amber-200">
            Permiso de clave detectado: {config.keyFileMode || 'desconocido'}. Recomendado: 600.
          </div>
        ) : null}
        {error ? <p className="text-xs text-red-300 whitespace-pre-wrap break-words">{error}</p> : null}
        {info ? <p className="text-xs text-emerald-300 whitespace-pre-wrap break-words">{info}</p> : null}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-100">Configuración</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={draft.deviceName}
            onChange={(event) => setDraft((current) => ({ ...current, deviceName: event.target.value }))}
            placeholder="Nombre dispositivo"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
          />
          <input
            value={draft.host}
            onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
            placeholder="Host/IP"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
          />
          <input
            value={draft.port}
            onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))}
            placeholder="Puerto SSH"
            inputMode="numeric"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
          />
          <input
            value={draft.user}
            onChange={(event) => setDraft((current) => ({ ...current, user: event.target.value }))}
            placeholder="Usuario SSH"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
          />
          <select
            value={draft.authMethod}
            onChange={(event) => setDraft((current) => ({ ...current, authMethod: event.target.value === 'password' ? 'password' : 'key' }))}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
          >
            <option value="key">Auth por clave privada (recomendado)</option>
            <option value="password">Auth por password (fallback)</option>
          </select>
          <select
            value={draft.networkMode}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) => ({
                ...current,
                networkMode: value === 'tailscale' || value === 'wireguard' || value === 'lan' ? value : 'auto'
              }));
            }}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
          >
            <option value="auto">Red: Auto</option>
            <option value="tailscale">Red: Tailscale</option>
            <option value="wireguard">Red: WireGuard</option>
            <option value="lan">Red: LAN</option>
          </select>
          <input
            value={draft.remoteWorkdir}
            onChange={(event) => setDraft((current) => ({ ...current, remoteWorkdir: event.target.value }))}
            placeholder="Ruta remota"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
          />
          <input
            value={draft.codexBin}
            onChange={(event) => setDraft((current) => ({ ...current, codexBin: event.target.value }))}
            placeholder="Ruta Codex remoto"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
          />
          <input
            value={draft.keyPath}
            onChange={(event) => setDraft((current) => ({ ...current, keyPath: event.target.value }))}
            placeholder="Ruta clave privada en backend"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm sm:col-span-2"
          />
        </div>

        <input
          type="password"
          autoComplete="new-password"
          value={draft.password}
          onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
          placeholder="Password SSH (opcional, no se expone al frontend una vez guardado)"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
        />

        <textarea
          value={draft.privateKey}
          onChange={(event) => setDraft((current) => ({ ...current, privateKey: event.target.value }))}
          rows={5}
          placeholder="Pega aquí clave privada SSH (opcional). Nunca se devuelve al frontend."
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs font-mono"
        />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
            <input
              type="checkbox"
              checked={draft.allowDangerousCommands}
              onChange={(event) => setDraft((current) => ({ ...current, allowDangerousCommands: event.target.checked }))}
            />
            permitir comandos peligrosos
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
            <input
              type="checkbox"
              checked={draft.notifyDiscord}
              onChange={(event) => setDraft((current) => ({ ...current, notifyDiscord: event.target.checked }))}
            />
            notificar a Discord
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveConfigHandler}
            disabled={!featureEnabled || saving}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <button
            type="button"
            onClick={generateKeyHandler}
            disabled={!featureEnabled || keygenBusy}
            className="text-xs px-3 py-1.5 rounded-lg border border-emerald-700/70 text-emerald-300 hover:text-emerald-200 hover:border-emerald-500 disabled:opacity-50"
          >
            {keygenBusy ? 'Generando...' : 'Generate key'}
          </button>
          <button
            type="button"
            onClick={testConnectionHandler}
            disabled={!featureEnabled || testBusy}
            className="text-xs px-3 py-1.5 rounded-lg border border-blue-700/70 text-blue-300 hover:text-blue-200 hover:border-blue-500 disabled:opacity-50"
          >
            {testBusy ? 'Probando...' : 'Test connection'}
          </button>
          <button
            type="button"
            onClick={detectEnvironmentHandler}
            disabled={!featureEnabled || detectBusy}
            className="text-xs px-3 py-1.5 rounded-lg border border-amber-700/70 text-amber-300 hover:text-amber-200 hover:border-amber-500 disabled:opacity-50"
          >
            {detectBusy ? 'Detectando...' : 'Detect environment'}
          </button>
        </div>

        {testResult ? <p className="text-xs text-emerald-300">{testResult}</p> : null}

        {publicKey ? (
          <div className="rounded-xl border border-zinc-800 bg-black/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-zinc-400">Clave pública para authorized_keys</p>
              <button
                type="button"
                onClick={() => {
                  void copyText(publicKey);
                }}
                className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white"
              >
                Copiar
              </button>
            </div>
            <pre className="text-[11px] whitespace-pre-wrap break-all text-zinc-200">{publicKey}</pre>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-100">Command</h3>
        <textarea
          value={commandText}
          onChange={(event) => setCommandText(event.target.value)}
          rows={4}
          placeholder="Ejemplo: uname -a"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs font-mono"
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
            <input
              type="checkbox"
              checked={commandBackground}
              onChange={(event) => setCommandBackground(event.target.checked)}
            />
            ejecutar en background
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
            <input
              type="checkbox"
              checked={confirmDangerous}
              onChange={(event) => setConfirmDangerous(event.target.checked)}
            />
            confirmo comando peligroso
          </label>
        </div>
        {dangerWarnings.length > 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            {dangerWarnings.map((entry) => entry.label).join(' · ')}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runCommandHandler}
            disabled={!featureEnabled || commandBusy}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
          >
            {commandBusy ? 'Ejecutando...' : 'Run command'}
          </button>
        </div>
        {commandOutput ? (
          <textarea
            value={commandOutput}
            readOnly
            rows={10}
            className="w-full bg-black/60 border border-zinc-800 rounded-xl px-3 py-2 text-[11px] font-mono text-zinc-200"
          />
        ) : null}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-100">Run Codex on Steam Deck</h3>
        <textarea
          value={codexPrompt}
          onChange={(event) => setCodexPrompt(event.target.value)}
          rows={5}
          placeholder="Prompt para ejecutar codex exec remoto"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm"
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
            <input
              type="checkbox"
              checked={codexInheritEnv}
              onChange={(event) => setCodexInheritEnv(event.target.checked)}
            />
            heredar entorno
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
            <input
              type="checkbox"
              checked={codexDangerSandbox}
              onChange={(event) => setCodexDangerSandbox(event.target.checked)}
            />
            sandbox danger-full-access
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runCodexHandler}
            disabled={!featureEnabled || codexBusy}
            className="text-xs px-3 py-1.5 rounded-lg border border-blue-700/70 text-blue-300 hover:text-blue-200 hover:border-blue-500 disabled:opacity-50"
          >
            {codexBusy ? 'Encolando...' : 'Run Codex on Steam Deck'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">Jobs & History</h3>
          <button
            type="button"
            onClick={() => {
              void loadJobs();
              void refreshSelectedJob();
            }}
            disabled={jobsLoading}
            className="text-xs px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
          >
            {jobsLoading ? 'Cargando...' : 'Refrescar'}
          </button>
        </div>

        {jobs.length === 0 ? <p className="text-xs text-zinc-500">Sin jobs todavía.</p> : null}

        {jobs.length > 0 ? (
          <div className="space-y-2">
            {jobs.map((job) => {
              const running = job.status === 'queued' || job.status === 'running';
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className={`w-full text-left rounded-xl border p-3 transition ${
                    selectedJobId === job.id
                      ? 'border-blue-600/70 bg-blue-600/10'
                      : 'border-zinc-800 bg-black/30 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-100 truncate">{job.id}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{truncateText(job.payload?.rawCommand || job.command || job.kind, 90)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs ${statusClass(job.status)}`}>{job.status}</p>
                      <p className="text-[10px] text-zinc-500">{formatDate(job.updatedAt || job.createdAt)}</p>
                    </div>
                  </div>
                  {running ? (
                    <div className="mt-2 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void cancelJobHandler(job.id);
                        }}
                        disabled={jobBusyId === job.id}
                        className="text-[11px] px-2 py-1 rounded border border-red-600/40 text-red-300 hover:text-red-200 disabled:opacity-50"
                      >
                        {jobBusyId === job.id ? 'Cancelando...' : 'Cancelar'}
                      </button>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {selectedJob ? (
          <div className="rounded-xl border border-zinc-800 bg-black/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-zinc-300">Job seleccionado: {selectedJob.id}</p>
              <button
                type="button"
                onClick={() => {
                  void copyText([selectedJob.log, selectedJob.stdout, selectedJob.stderr].filter(Boolean).join('\n\n'));
                }}
                className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white"
              >
                Copiar logs
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              tipo: {selectedJob.kind} · estado: <span className={statusClass(selectedJob.status)}>{selectedJob.status}</span> · duración: {formatDurationMs(
                Date.parse(selectedJob.finishedAt || selectedJob.updatedAt || '') - Date.parse(selectedJob.startedAt || selectedJob.createdAt || '')
              )}
            </p>
            {selectedJob.error ? <p className="text-xs text-red-300">{selectedJob.error}</p> : null}
            <textarea
              ref={selectedLogRef}
              value={[
                '[LOG]',
                selectedJob.log || '(vacío)',
                '',
                '[STDOUT]',
                selectedJob.stdout || '(vacío)',
                '',
                '[STDERR]',
                selectedJob.stderr || '(vacío)'
              ].join('\n')}
              readOnly
              rows={16}
              className="w-full bg-black/70 border border-zinc-800 rounded-xl px-3 py-2 text-[11px] font-mono text-zinc-200"
            />
          </div>
        ) : null}
      </div>

      {detectResult ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-100">Detect Environment</h3>
          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <p className="text-zinc-300">hostname: {detectResult.hostname || '-'}</p>
            <p className="text-zinc-300">usuario: {detectResult.user || '-'}</p>
            <p className="text-zinc-300">SteamOS: {detectResult.steamOsLikely ? 'sí' : 'no/indeterminado'}</p>
            <p className="text-zinc-300">Codex CLI: {detectResult.codexInstalled ? 'instalado' : 'no encontrado'}</p>
            <p className="text-zinc-300">codex path: {detectResult.codexPath || '-'}</p>
            <p className="text-zinc-300">codex version: {detectResult.codexVersion || '-'}</p>
            <p className="text-zinc-300">SSH estado: {detectResult.sshStatus || '-'}</p>
          </div>
          <textarea
            value={[
              '[uname]',
              detectResult.uname || '-',
              '',
              '[/etc/os-release]',
              detectResult.osRelease || '-',
              '',
              '[df -h /]',
              detectResult.diskRoot || '-',
              '',
              '[free -h]',
              detectResult.memory || '-',
              '',
              '[uptime]',
              detectResult.uptime || '-',
              '',
              '[ips]',
              detectResult.ipAddresses.join('\n') || '-',
              '',
              '[raw stderr]',
              detectResult.raw.stderr || '(vacío)'
            ].join('\n')}
            readOnly
            rows={14}
            className="w-full bg-black/70 border border-zinc-800 rounded-xl px-3 py-2 text-[11px] font-mono text-zinc-200"
          />
        </div>
      ) : null}
    </section>
  );
}
