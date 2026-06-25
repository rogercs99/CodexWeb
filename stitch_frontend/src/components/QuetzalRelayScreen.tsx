import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Copy,
  LoaderCircle,
  RadioTower,
  RefreshCw,
  Save,
  ServerCog,
  Shield,
  TerminalSquare
} from 'lucide-react';
import BottomNav from './BottomNav';
import {
  getQuetzalRelayCommands,
  getQuetzalRelayDiagnostics,
  getQuetzalRelayStatus,
  prepareQuetzalRelay,
  updateQuetzalRelayConfig
} from '../lib/api';
import type {
  QuetzalRelayCommandsPayload,
  QuetzalRelayConfig,
  QuetzalRelayDiagnosticsPayload,
  QuetzalRelayStatusPayload,
  Screen
} from '../lib/types';

function StatusPill({
  ok,
  activeText,
  inactiveText
}: {
  ok: boolean;
  activeText: string;
  inactiveText: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
        ok
          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          : 'border border-amber-500/30 bg-amber-500/10 text-amber-100'
      }`}
    >
      {ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {ok ? activeText : inactiveText}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder = ''
}: {
  label: string;
  value: string | number;
  onChange: (next: string) => void;
  type?: 'text' | 'number';
  placeholder?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <input
        type={type}
        inputMode={type === 'number' ? 'numeric' : 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
      />
    </label>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

function buildFriendText(commands: QuetzalRelayCommandsPayload | null) {
  return commands?.commands.friendInstructions || '';
}

export default function QuetzalRelayScreen({
  onNavigate
}: {
  onNavigate: (screen: Screen) => void;
}) {
  const [status, setStatus] = useState<QuetzalRelayStatusPayload | null>(null);
  const [commands, setCommands] = useState<QuetzalRelayCommandsPayload | null>(null);
  const [diagnostics, setDiagnostics] = useState<QuetzalRelayDiagnosticsPayload | null>(null);
  const [draft, setDraft] = useState<QuetzalRelayConfig>({
    port: 57321,
    publicHost: 'quetzal.gamemodai.pro',
    localTargetHost: '127.0.0.1',
    localTargetPort: 57321,
    sshUser: 'root'
  });
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<'refresh' | 'save' | 'prepare' | 'diagnostics' | ''>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const refreshAll = async (includeDiagnostics = false) => {
    setBusyAction(includeDiagnostics ? 'diagnostics' : 'refresh');
    setError('');
    try {
      const [nextStatus, nextCommands, nextDiagnostics] = await Promise.all([
        getQuetzalRelayStatus(),
        getQuetzalRelayCommands(),
        includeDiagnostics ? getQuetzalRelayDiagnostics() : Promise.resolve(null)
      ]);
      setStatus(nextStatus);
      setCommands(nextCommands);
      setDraft(nextStatus.config);
      if (nextDiagnostics) {
        setDiagnostics(nextDiagnostics);
        setShowAdvanced(true);
      }
      setNotice('Estado actualizado.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo cargar Quetzal Relay.');
    } finally {
      setLoading(false);
      setBusyAction('');
    }
  };

  useEffect(() => {
    void refreshAll(false);
  }, []);

  const cards = useMemo(() => {
    if (!status) return [];
    return [
      {
        title: 'Estado de SSHD',
        ok: Boolean(status.sshd.active),
        detail: `Servicio ${status.sshd.serviceName}: ${status.sshd.active ? 'activo' : 'inactivo'}`
      },
      {
        title: 'AllowTcpForwarding',
        ok: status.summary.allowTcpForwardingOk,
        detail: status.sshd.allowTcpForwarding
      },
      {
        title: 'GatewayPorts',
        ok: status.summary.gatewayPortsOk,
        detail: status.sshd.gatewayPorts
      },
      {
        title: 'Puerto elegido',
        ok: true,
        detail: String(status.config.port)
      },
      {
        title: 'Host público',
        ok: true,
        detail: status.config.publicHost
      },
      {
        title: 'Escucha en el VPS',
        ok: status.summary.portListening,
        detail: status.summary.portListening ? 'Hay un listener en el puerto.' : 'No hay listener aún.'
      },
      {
        title: 'Túnel activo',
        ok: status.summary.tunnelActive,
        detail: status.summary.tunnelActive
          ? 'Parece haber un reverse SSH activo.'
          : 'Falta iniciar el túnel desde tu máquina.'
      },
      {
        title: 'Firewall',
        ok: status.summary.firewallOpen,
        detail: status.firewall.active
          ? status.firewall.portAllowed
            ? 'UFW permite el puerto.'
            : 'UFW activo, pero el puerto aún no figura permitido.'
          : 'UFW no está activo.'
      }
    ];
  }, [status]);

  const saveConfig = async () => {
    setBusyAction('save');
    setError('');
    try {
      const payload = await updateQuetzalRelayConfig(draft);
      setDraft(payload.config);
      setStatus(payload.status);
      setCommands(await getQuetzalRelayCommands());
      setNotice('Configuración guardada.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo guardar la configuración.');
    } finally {
      setBusyAction('');
    }
  };

  const runPrepare = async () => {
    setBusyAction('prepare');
    setError('');
    try {
      const payload = await prepareQuetzalRelay();
      setStatus(payload.status);
      setCommands(await getQuetzalRelayCommands());
      setNotice(
        payload.ok
          ? `VPS preparado. Backup: ${payload.backupPath}`
          : payload.error || 'La preparación devolvió error.'
      );
      if (!payload.ok) {
        setError(payload.error || 'No se pudo preparar el VPS.');
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo preparar el VPS.');
    } finally {
      setBusyAction('');
    }
  };

  const primaryCommand = commands?.commands.mainCommand || '';
  const friendText = buildFriendText(commands);

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-40 border-b border-zinc-900 bg-black/80 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-200"
          >
            <ChevronLeft size={18} />
            Volver
          </button>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-400">Relay TCP público</p>
            <h1 className="text-lg font-semibold tracking-tight">Quetzal Relay</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 pb-32">
        <section className="overflow-hidden rounded-[28px] border border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(9,9,11,0.92))] p-5 shadow-[0_0_0_1px_rgba(34,211,238,0.05),0_24px_80px_rgba(8,47,73,0.32)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-100">
                <RadioTower size={14} />
                El VPS solo actúa como relay
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Preparar túnel reverse SSH para Pokémon Quetzal</h2>
              <p className="max-w-2xl text-sm leading-6 text-zinc-300">
                El servidor no emula ni ejecuta el juego. Solo expone un puerto TCP público para que tu amigo entre a
                `quetzal.gamemodai.pro:puerto`.
              </p>
            </div>
            {status && (
              <StatusPill
                ok={status.summary.vpsPrepared}
                activeText="VPS preparado"
                inactiveText="Falta preparar SSHD"
              />
            )}
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {notice}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {loading ? (
            <div className="col-span-full flex items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-950/70 px-4 py-10 text-zinc-400">
              <LoaderCircle className="mr-3 animate-spin" size={18} />
              Cargando estado...
            </div>
          ) : (
            cards.map((card) => (
              <article key={card.title} className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-zinc-100">{card.title}</p>
                  <StatusPill ok={card.ok} activeText="OK" inactiveText="Revisar" />
                </div>
                <p className="text-sm leading-6 text-zinc-300">{card.detail}</p>
              </article>
            ))
          )}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
            <div className="mb-4 flex items-center gap-3">
              <ServerCog className="text-cyan-300" size={18} />
              <div>
                <h2 className="text-lg font-semibold">Configuración persistente</h2>
                <p className="text-sm text-zinc-400">Se guarda en `data/quetzal-relay.json`.</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Puerto público" value={draft.port} type="number" onChange={(value) => setDraft((prev) => ({ ...prev, port: Number(value || 0) }))} />
              <Field label="Host público" value={draft.publicHost} onChange={(value) => setDraft((prev) => ({ ...prev, publicHost: value }))} />
              <Field label="Local target host" value={draft.localTargetHost} onChange={(value) => setDraft((prev) => ({ ...prev, localTargetHost: value }))} />
              <Field label="Local target port" value={draft.localTargetPort} type="number" onChange={(value) => setDraft((prev) => ({ ...prev, localTargetPort: Number(value || 0) }))} />
              <Field label="Usuario SSH" value={draft.sshUser} onChange={(value) => setDraft((prev) => ({ ...prev, sshUser: value }))} />
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={saveConfig}
                disabled={busyAction !== ''}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === 'save' ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}
                Guardar configuración
              </button>
              <button
                type="button"
                onClick={() => void refreshAll(false)}
                disabled={busyAction !== ''}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900/80 px-5 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === 'refresh' ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                Comprobar estado
              </button>
              <button
                type="button"
                onClick={runPrepare}
                disabled={busyAction !== ''}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 px-5 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === 'prepare' ? <LoaderCircle className="animate-spin" size={16} /> : <Shield size={16} />}
                Preparar VPS
              </button>
            </div>
          </article>

          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
            <div className="mb-4 flex items-center gap-3">
              <TerminalSquare className="text-cyan-300" size={18} />
              <div>
                <h2 className="text-lg font-semibold">Comando SSH exacto</h2>
                <p className="text-sm text-zinc-400">La terminal del túnel debe quedar abierta mientras jugáis.</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-zinc-800 bg-black/60 p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Principal</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all text-sm leading-6 text-cyan-100">{primaryCommand}</pre>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black/60 p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Alternativo</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all text-sm leading-6 text-zinc-200">
                  {commands?.commands.alternativeCommand || ''}
                </pre>
              </div>
              <button
                type="button"
                onClick={() => {
                  void copyText(primaryCommand).then(() => setNotice('Comando SSH copiado.'));
                }}
                disabled={!primaryCommand}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy size={16} />
                Copiar comando SSH
              </button>
            </div>
          </article>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
            <h2 className="mb-4 text-lg font-semibold">Instrucciones para ti</h2>
            <ol className="space-y-2 text-sm leading-6 text-zinc-200">
              {(commands?.commands.myInstructions || []).map((line) => (
                <li key={line} className="rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3">
                  {line}
                </li>
              ))}
            </ol>
          </article>

          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Instrucciones para tu amigo</h2>
              <button
                type="button"
                onClick={() => {
                  void copyText(friendText).then(() => setNotice('Instrucciones para tu amigo copiadas.'));
                }}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-100"
              >
                <Copy size={16} />
                Copiar
              </button>
            </div>
            <pre className="rounded-2xl border border-zinc-800 bg-black/50 p-4 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
              {friendText}
            </pre>
          </article>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
            <h2 className="mb-4 text-lg font-semibold">Qué significa el comando</h2>
            <ul className="space-y-2 text-sm leading-6 text-zinc-200">
              {(commands?.commands.explanations || []).map((line) => (
                <li key={line} className="rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3">
                  {line}
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-5">
            <h2 className="mb-4 text-lg font-semibold text-amber-50">Advertencias</h2>
            <ul className="space-y-2 text-sm leading-6 text-amber-50/90">
              <li>Esto está pensado principalmente para My Boy! en Android.</li>
              <li>Debe funcionar solo si el modo Wi-Fi del emulador usa TCP/IP normal con host y puerto.</li>
              <li>Si el emulador usa UDP, broadcast o descubrimiento LAN raro, este método puede fallar.</li>
              <li>Si falla, el futuro Plan B sería implementar FRP o rathole TCP+UDP en el VPS.</li>
              <li>El servidor no ejecuta el juego.</li>
              <li>La calidad depende de latencia y estabilidad de red, no de potencia del VPS.</li>
            </ul>
          </article>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Diagnóstico avanzado</h2>
              <p className="text-sm text-zinc-400">Incluye `sshd -T`, `ss -ltnp`, `lsof` y `ufw status`.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (showAdvanced) {
                  setShowAdvanced(false);
                  return;
                }
                void refreshAll(true);
              }}
              disabled={busyAction !== '' && busyAction !== 'diagnostics'}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-5 text-sm font-semibold text-zinc-100"
            >
              {busyAction === 'diagnostics' ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              Ver diagnóstico avanzado
            </button>
          </div>
          {showAdvanced && diagnostics ? (
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {Object.entries(diagnostics.diagnostics).map(([key, value]) => (
                <div key={key} className="rounded-2xl border border-zinc-800 bg-black/50 p-4">
                  <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{key}</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-200">
                    {String(value || '').trim() || 'sin salida'}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </main>

      <BottomNav active="tools" onNavigate={onNavigate} />
    </div>
  );
}
