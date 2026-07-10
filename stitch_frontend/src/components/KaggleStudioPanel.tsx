import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Cpu,
  Database,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  kaggleStudioGet,
  kaggleStudioList,
  kaggleStudioStart,
  kaggleStudioStop,
  type KaggleStudioOptions,
  type KaggleStudioSession
} from '../lib/api';

const DEFAULT_OPTIONS: KaggleStudioOptions = {
  title: 'Codex Studio',
  gpuPreference: 't4',
  enableInternet: true,
  persistenceEnabled: true,
  backupIntervalMinutes: 10,
  maxBackupMb: 300,
  maxParallel: 1,
  tunnelProvider: 'pinggy',
  datasetSources: [],
  publicBaseUrl: ''
};

function isActive(status?: string) {
  return ['launching', 'queued', 'pending', 'running', 'stopping'].includes(String(status || ''));
}

function formatDate(value?: string) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('es-ES');
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusTone(status?: string) {
  switch (status) {
    case 'running': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    case 'queued':
    case 'pending':
    case 'launching': return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300';
    case 'stopping': return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'stopped':
    case 'complete': return 'border-zinc-700 bg-zinc-900 text-zinc-300';
    case 'error': return 'border-red-500/40 bg-red-500/10 text-red-300';
    default: return 'border-zinc-700 bg-zinc-900 text-zinc-400';
  }
}

export default function KaggleStudioPanel() {
  const [options, setOptions] = useState<KaggleStudioOptions>(DEFAULT_OPTIONS);
  const [datasetText, setDatasetText] = useState('');
  const [active, setActive] = useState<KaggleStudioSession | null>(null);
  const [sessions, setSessions] = useState<KaggleStudioSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canStart = !starting && !isActive(active?.status);
  const callbackWarning = !options.enableInternet
    ? 'Sin internet no habrá Pinggy, callback, heartbeat ni parada remota. El job podrá ejecutarse, pero CodexWeb quedará prácticamente ciego.'
    : '';

  async function loadSessions(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await kaggleStudioList();
      setSessions(result.sessions);
      setActive(result.active);
      setError('');
    } catch (err: any) {
      if (!silent) setError(err?.message || 'No se pudieron cargar las sesiones de Codex Studio');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    if (!active || !isActive(active.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const refreshed = await kaggleStudioGet(active.id);
        setActive(refreshed);
        setSessions((prev) => [refreshed, ...prev.filter((entry) => entry.id !== refreshed.id)]);
      } catch (_error) {
        // The general refresh button remains available; transient polling failures are not fatal.
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.status]);

  async function startStudio() {
    setStarting(true);
    setError('');
    setNotice('Enviando Codex Studio a Kaggle...');
    try {
      const session = await kaggleStudioStart({
        ...options,
        datasetSources: datasetText.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean)
      });
      setActive(session);
      setSessions((prev) => [session, ...prev.filter((entry) => entry.id !== session.id)]);
      setNotice('Job enviado. El enlace Pinggy aparecerá en cuanto Kaggle termine el arranque.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo iniciar Codex Studio');
      setNotice('');
    } finally {
      setStarting(false);
    }
  }

  async function stopStudio() {
    if (!active) return;
    setStopping(true);
    setError('');
    try {
      const session = await kaggleStudioStop(active.id);
      setActive(session);
      setSessions((prev) => [session, ...prev.filter((entry) => entry.id !== session.id)]);
      setNotice('Parada solicitada. El kernel la recogerá en el siguiente heartbeat.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo solicitar la parada');
    } finally {
      setStopping(false);
    }
  }

  async function copyLink() {
    if (!active?.publicUrl) return;
    try {
      await navigator.clipboard.writeText(active.publicUrl);
      setNotice('Enlace copiado. Milagro menor de la ingeniería moderna.');
    } catch (_error) {
      setError('No se pudo copiar el enlace');
    }
  }

  const actualGpuMismatch = useMemo(() => {
    if (!active?.actualGpu || ['none', 'any'].includes(active.options?.gpuPreference)) return false;
    return !active.actualGpu.toLowerCase().includes(active.options.gpuPreference.toLowerCase());
  }, [active]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-zinc-950 to-purple-500/10 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-2 text-cyan-300"><Cpu size={20} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-white">Codex Studio en Kaggle</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Lanza tu script v21 como kernel privado, recupera el enlace Pinggy por callback y mantén el proceso vivo hasta que pulses Parar o Kaggle agote su sesión.
            </p>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm text-cyan-200">{notice}</div> : null}

      {active ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(active.status)}`}>{active.status}</span>
            <span className="text-xs font-mono text-zinc-500">{active.id}</span>
            <button type="button" onClick={() => void loadSessions()} className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800 text-zinc-400 hover:text-white" title="Actualizar">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-zinc-900 p-3"><div className="text-zinc-500">Kaggle job</div><div className="mt-1 break-all font-mono text-zinc-200">{active.kaggleRef || active.jobId || 'pendiente'}</div></div>
            <div className="rounded-xl bg-zinc-900 p-3"><div className="text-zinc-500">Último heartbeat</div><div className="mt-1 text-zinc-200">{formatDate(active.lastHeartbeatAt)}</div></div>
            <div className="rounded-xl bg-zinc-900 p-3"><div className="text-zinc-500">GPU solicitada</div><div className="mt-1 uppercase text-zinc-200">{active.options?.gpuPreference || 'any'}</div></div>
            <div className="rounded-xl bg-zinc-900 p-3"><div className="text-zinc-500">GPU real</div><div className={`mt-1 ${actualGpuMismatch ? 'text-amber-300' : 'text-zinc-200'}`}>{active.actualGpu || 'todavía desconocida'}</div></div>
            <div className="rounded-xl bg-zinc-900 p-3"><div className="text-zinc-500">Túnel</div><div className="mt-1 text-zinc-200">{active.tunnelProvider || active.options?.tunnelProvider || '--'}</div></div>
            <div className="rounded-xl bg-zinc-900 p-3"><div className="text-zinc-500">Backup</div><div className="mt-1 text-zinc-200">{active.backupAvailable ? `${formatBytes(active.backupBytes)} · ${formatDate(active.lastBackupAt)}` : 'aún no disponible'}</div></div>
          </div>

          {actualGpuMismatch ? (
            <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle size={16} className="shrink-0" />
              Kaggle asignó otra GPU. La preferencia T4/P100 es orientativa; la disponibilidad real la decide el scheduler.
            </div>
          ) : null}

          {active.error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{active.error}</div> : null}

          <div className="flex flex-wrap gap-2">
            {active.publicUrl ? (
              <>
                <a href={active.publicUrl} target="_blank" rel="noreferrer" className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-black hover:bg-cyan-400">
                  <ExternalLink size={16} /> Abrir Studio
                </a>
                <button type="button" onClick={copyLink} className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-900">
                  <Clipboard size={16} /> Copiar
                </button>
              </>
            ) : (
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-400">
                <Loader2 size={16} className="animate-spin" /> Esperando enlace Pinggy...
              </div>
            )}
            {isActive(active.status) ? (
              <button type="button" onClick={stopStudio} disabled={stopping} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-300 hover:bg-red-500/20 disabled:opacity-50">
                {stopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={15} />} Parar
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-4">
        <div>
          <h3 className="font-medium text-white">Configuración de lanzamiento</h3>
          <p className="mt-1 text-xs text-zinc-500">Los secretos de Kaggle permanecen en el VPS. El kernel recibe solo un token efímero para callbacks y backups.</p>
        </div>

        <label className="block space-y-1.5 text-xs text-zinc-400">
          <span>Nombre de la sesión</span>
          <input value={options.title || ''} onChange={(event) => setOptions((prev) => ({ ...prev, title: event.target.value }))} maxLength={80} placeholder="Codex Studio" className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600" />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs text-zinc-400">
            <span className="flex items-center gap-1.5"><Cpu size={14} /> GPU</span>
            <select value={options.gpuPreference} onChange={(event) => setOptions((prev) => ({ ...prev, gpuPreference: event.target.value as KaggleStudioOptions['gpuPreference'] }))} className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white">
              <option value="t4">T4 preferida</option>
              <option value="p100">P100 preferida</option>
              <option value="any">Cualquier GPU</option>
              <option value="none">Sin GPU</option>
            </select>
          </label>

          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>Túnel público</span>
            <select value={options.tunnelProvider} onChange={(event) => setOptions((prev) => ({ ...prev, tunnelProvider: event.target.value as KaggleStudioOptions['tunnelProvider'] }))} className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white">
              <option value="pinggy">Pinggy</option>
              <option value="auto">Automático</option>
              <option value="localhostrun">localhost.run</option>
              <option value="ngrok">ngrok</option>
              <option value="none">Sin túnel</option>
            </select>
          </label>

          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>Procesos Codex paralelos</span>
            <input type="number" min={1} max={4} value={options.maxParallel} onChange={(event) => setOptions((prev) => ({ ...prev, maxParallel: Math.max(1, Math.min(4, Number(event.target.value) || 1)) }))} className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white" />
          </label>

          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>Backup cada</span>
            <select value={options.backupIntervalMinutes} onChange={(event) => setOptions((prev) => ({ ...prev, backupIntervalMinutes: Number(event.target.value) }))} className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white">
              <option value={5}>5 minutos</option>
              <option value={10}>10 minutos</option>
              <option value={20}>20 minutos</option>
              <option value={30}>30 minutos</option>
              <option value={60}>60 minutos</option>
            </select>
          </label>

          <label className="space-y-1.5 text-xs text-zinc-400">
            <span>Tamaño máximo de backup</span>
            <select value={options.maxBackupMb} onChange={(event) => setOptions((prev) => ({ ...prev, maxBackupMb: Number(event.target.value) }))} className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white">
              <option value={100}>100 MB</option>
              <option value={300}>300 MB</option>
              <option value={500}>500 MB</option>
              <option value={750}>750 MB</option>
              <option value={1024}>1 GB</option>
            </select>
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm text-zinc-200">
            <span className="flex items-center gap-2">{options.enableInternet ? <Wifi size={16} className="text-emerald-400" /> : <WifiOff size={16} className="text-zinc-500" />} Internet</span>
            <input type="checkbox" checked={options.enableInternet} onChange={(event) => setOptions((prev) => ({ ...prev, enableInternet: event.target.checked }))} className="h-4 w-4 accent-cyan-500" />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm text-zinc-200">
            <span className="flex items-center gap-2"><Database size={16} className="text-purple-400" /> Persistir workspace</span>
            <input type="checkbox" checked={options.persistenceEnabled} onChange={(event) => setOptions((prev) => ({ ...prev, persistenceEnabled: event.target.checked }))} className="h-4 w-4 accent-cyan-500" />
          </label>
        </div>

        {callbackWarning ? <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{callbackWarning}</div> : null}

        <label className="block space-y-1.5 text-xs text-zinc-400">
          <span>Datasets persistentes opcionales (owner/dataset, uno por línea)</span>
          <textarea value={datasetText} onChange={(event) => setDatasetText(event.target.value)} rows={3} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="miusuario/mi-dataset" className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 font-mono text-sm text-white placeholder:text-zinc-600" />
        </label>

        <label className="block space-y-1.5 text-xs text-zinc-400">
          <span>URL pública de CodexWeb para callbacks (opcional)</span>
          <input value={options.publicBaseUrl || ''} onChange={(event) => setOptions((prev) => ({ ...prev, publicBaseUrl: event.target.value }))} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://codexweb-dev.tudominio.com" className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600" />
        </label>

        <button type="button" onClick={startStudio} disabled={!canStart} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500">
          {starting ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />} {isActive(active?.status) ? 'Ya hay una sesión activa' : 'Lanzar Codex Studio'}
        </button>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium text-white">Sesiones recientes</h3>
          <button type="button" onClick={() => void loadSessions()} className="text-xs text-cyan-300 hover:text-cyan-200">Actualizar</button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin" /> Cargando...</div>
        ) : sessions.length === 0 ? (
          <div className="py-4 text-sm text-zinc-500">Todavía no hay sesiones.</div>
        ) : (
          <div className="space-y-2">
            {sessions.slice(0, 8).map((session) => (
              <button key={session.id} type="button" onClick={() => setActive(session)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-left hover:border-zinc-700">
                {session.status === 'running' ? <CheckCircle2 size={16} className="text-emerald-400" /> : session.status === 'error' ? <AlertTriangle size={16} className="text-red-400" /> : <Cpu size={16} className="text-zinc-500" />}
                <div className="min-w-0 flex-1"><div className="truncate font-mono text-xs text-zinc-200">{session.id}</div><div className="mt-0.5 text-[11px] text-zinc-500">{formatDate(session.createdAt)} · {session.actualGpu || session.options?.gpuPreference || 'sin GPU'}</div></div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone(session.status)}`}>{session.status}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
