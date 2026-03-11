import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import './index.css';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${window.location.host}/ws`;

const phases = {
  LOBBY: 'lobby',
  CLUE: 'clue',
  SUBMIT: 'submit',
  VOTE: 'vote',
  REVEAL: 'reveal',
};

const formatTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

const DEBUG_FLAG_KEY = 'dixit:debug';
const debugLog = (...args) => {
  try {
    if (window.localStorage.getItem(DEBUG_FLAG_KEY) === '1') {
      console.debug('[dixit]', ...args);
    }
  } catch {
    // ignore debug logger failures
  }
};

const dedupePlayers = (players = []) => {
  const unique = new Map();
  for (const entry of players) {
    if (!entry || !entry.id || unique.has(entry.id)) continue;
    unique.set(entry.id, entry);
  }
  return Array.from(unique.values());
};

const dedupeBoardEntries = (board = []) => {
  const unique = new Map();
  for (const entry of board) {
    if (!entry || !entry.id || unique.has(entry.id)) continue;
    unique.set(entry.id, entry);
  }
  return Array.from(unique.values());
};

const sanitizeStatePayload = (payload) => {
  if (!payload || payload.type !== 'state') return payload;
  const players = dedupePlayers(payload.players || []);
  const playerIds = new Set(players.map((player) => player.id));
  const pendingPlayers = (payload.pendingPlayers || []).filter((entry) => entry?.id && playerIds.has(entry.id));
  const pendingPlayerIds = (payload.pendingPlayerIds || []).filter((id) => playerIds.has(id));
  const you = payload.you && playerIds.has(payload.you.id) ? payload.you : null;
  const board = dedupeBoardEntries(Array.isArray(payload.board) ? payload.board : []);
  return {
    ...payload,
    players,
    pendingPlayers,
    pendingPlayerIds,
    you,
    board,
  };
};

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.error || `Error ${response.status}`);
  }
  return json;
}

function useWs(enabled) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [serverError, setServerError] = useState('');
  const socketRef = useRef(null);
  const queuedMessagesRef = useRef([]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setState(null);
      setServerError('');
      queuedMessagesRef.current = [];
      socketRef.current?.close();
      socketRef.current = null;
      return undefined;
    }

    let disposed = false;
    let retry = 0;
    let reconnectTimer = null;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        if (queuedMessagesRef.current.length > 0) {
          const pending = queuedMessagesRef.current.splice(0);
          for (const payload of pending) {
            try {
              ws.send(JSON.stringify(payload));
            } catch {
              break;
            }
          }
        }
      };

      ws.onmessage = (e) => {
        let data;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        if (data.type === 'state') {
          setState(sanitizeStatePayload(data));
          setServerError('');
        }
        if (data.type === 'error') {
          setServerError(data.message || 'Error de comunicación con el servidor.');
        }
        if (data.type === 'ended') {
          setState(null);
          alert('La partida ha sido eliminada.');
        }
      };

      ws.onclose = (event) => {
        setConnected(false);
        if (disposed) return;
        if (event?.code === 4401) {
          setState(null);
          setServerError('Tu sesión expiró. Inicia sesión de nuevo.');
          queuedMessagesRef.current = [];
          return;
        }
        const waitMs = Math.min(5000, 500 * (2 ** retry));
        retry += 1;
        reconnectTimer = window.setTimeout(connect, waitMs);
      };
    };

    connect();

    return () => {
      disposed = true;
      setConnected(false);
      setServerError('');
      queuedMessagesRef.current = [];
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled]);

  const send = useCallback((payload) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return;
    }
    if (!enabled) return;
    queuedMessagesRef.current.push(payload);
    if (queuedMessagesRef.current.length > 40) {
      queuedMessagesRef.current = queuedMessagesRef.current.slice(-40);
    }
  }, [enabled]);

  return { state, setState, send, connected, serverError, setServerError };
}

const Pill = ({ children, className = '' }) => (
  <div className={`px-3 py-1 rounded-full text-xs font-semibold ${className}`}>{children}</div>
);

const formatRoomCode = (value) => {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length <= 3) return cleaned;
  const withDash = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}`;
  return withDash.slice(0, 7);
};

const extractReason = (clue = '') => {
  const match = clue.match(/\(([^)]+)\)/);
  return match ? match[1] : null;
};

function GameActions({ onLeave, onProgress, onToggleMusic, musicLabel }) {
  return (
    <div className="fixed bottom-4 right-4 z-30 flex flex-col gap-2 items-end pointer-events-none">
      <button onClick={onProgress} className="action-btn ghost bg-white/10 border border-white/20 text-white text-xs pointer-events-auto">
        Progreso
      </button>
      <button onClick={onToggleMusic} className="action-btn ghost bg-white/10 border border-white/20 text-white text-xs pointer-events-auto">
        {musicLabel}
      </button>
      <button onClick={onLeave} className="h-11 px-4 rounded-full bg-white/10 border border-white/30 text-white font-semibold hover:bg-white/20 transition pointer-events-auto">
        Salir
      </button>
    </div>
  );
}

const MAX_ROUNDS = 10;

function ProgressOverlay({ players = [], round = 1, onClose }) {
  const maxScore = Math.max(...players.map((p) => p.score), 1);
  const roundsLeft = Math.max(MAX_ROUNDS - round, 0);
  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur flex items-center justify-center px-4">
      <div className="w-full max-w-xl bg-[#1f152b] rounded-3xl border border-white/10 p-6 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-3 right-3 text-white/70 hover:text-white">
          <span className="material-symbols-outlined">close</span>
        </button>
        <h3 className="text-white text-xl font-bold mb-2">Progreso de la partida</h3>
        <p className="text-white/60 text-sm mb-4">Ronda {round} · Quedan {roundsLeft}</p>
        <div className="space-y-3">
          {[...players].sort((a, b) => b.score - a.score).map((p, idx) => {
            const pct = Math.max(5, Math.round((p.score / maxScore) * 100));
            return (
              <div key={p.id} className="flex items-center gap-3">
                <div className="w-6 text-white/70 text-sm">{idx + 1}</div>
                <div className="flex-1">
                  <div className="flex justify-between text-white text-sm">
                    <span>{p.name}</span>
                    <span>{p.score} pts</span>
                  </div>
                  <div className="h-3 bg-white/10 rounded-full overflow-hidden mt-1">
                    <div className="h-full bg-gradient-to-r from-primary to-accent-pink" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Avatar({ name, badge, highlight }) {
  return (
    <div className="flex flex-col items-center gap-3 p-4 rounded-2xl glass-panel relative border-t border-white/10 shadow-lg w-full">
      <div className="absolute top-3 right-3 flex gap-1">{badge}</div>
      <div className="relative w-20 h-20">
        {highlight && <div className="absolute inset-0 bg-gradient-to-tr from-accent-pink to-purple-600 rounded-full blur opacity-40" />}
        <div className="w-full h-full rounded-full border-2 border-white/20 bg-white/5 flex items-center justify-center text-xl font-bold">
          {name?.[0]?.toUpperCase() || 'P'}
        </div>
      </div>
      <div className="text-center">
        <p className="text-white text-base font-bold leading-tight">{name}</p>
      </div>
    </div>
  );
}

function AuthGate({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = mode === 'register'
        ? await api('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password, displayName }),
          })
        : await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
          });
      onAuthenticated(payload.user);
    } catch (err) {
      setError(err?.message || 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#1f152b]/90 p-6 shadow-2xl backdrop-blur">
        <h1 className="text-2xl font-black text-white">Dixit Multijugador</h1>
        <p className="mt-1 text-sm text-white/60">Inicia sesión para recuperar tu partida al volver.</p>
        <div className="mt-4 flex gap-2 rounded-xl bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === 'login' ? 'bg-white/15 text-white' : 'text-white/70'}`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === 'register' ? 'bg-white/15 text-white' : 'text-white/70'}`}
          >
            Registro
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            type="text"
            autoComplete="username"
            maxLength={20}
            placeholder="Usuario"
            className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-white placeholder:text-white/40"
            required
          />
          {mode === 'register' && (
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              type="text"
              maxLength={28}
              placeholder="Nombre visible (opcional)"
              className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-white placeholder:text-white/40"
            />
          )}
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            placeholder="Contraseña"
            className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-white placeholder:text-white/40"
            required
          />
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="h-12 w-full rounded-xl bg-gradient-to-r from-primary to-accent-pink text-sm font-bold text-white disabled:opacity-60"
          >
            {loading ? 'Procesando...' : mode === 'register' ? 'Crear cuenta' : 'Entrar'}
          </button>
        </form>
      </div>
    </section>
  );
}

function Lobby({ state, send, onSolo, onLeave, onShowProgress, toggleMusic, musicOn }) {
  const { roomCode, players = [], hostId, you, canStart } = state;
  const readyCount = players.filter((p) => p.ready).length;
  const pct = players.length ? Math.round((readyCount / players.length) * 100) : 0;
  const isHost = you?.isHost;
  const progressSorted = [...players].sort((a, b) => b.score - a.score);
  const [botDifficulty, setBotDifficulty] = React.useState('normal');

  return (
    <section className="relative z-10 flex-1 overflow-hidden flex flex-col">
      <header className="relative z-20 flex items-center p-4 pt-12 pb-4 justify-between glass-panel rounded-b-2xl mb-4">
        <button onClick={onLeave} className="text-white/80 hover:text-white flex size-10 shrink-0 items-center justify-center rounded-full active:bg-white/10 transition-colors" title="Salir">
          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>arrow_back</span>
        </button>
        <div className="flex flex-col items-center">
          <h2 className="text-white text-lg font-bold leading-tight tracking-tight drop-shadow-md">Lobby de Partida</h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-white/60 font-medium">Online</span>
          </div>
        </div>
        <div className="text-white/60 text-sm flex items-center gap-2">
          <span className="font-mono hidden sm:inline">{roomCode}</span>
          {isHost && (
            <button
              onClick={() => send({ type: 'end_room' })}
              className="h-9 px-3 rounded-full bg-white/10 border border-white/20 text-white text-[11px] font-semibold hover:bg-white/20 transition whitespace-nowrap"
              title="Eliminar sala"
            >
              Eliminar
            </button>
          )}
        </div>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar pb-32 px-4">
        <div className="max-w-md mx-auto flex items-center justify-between mb-3">
          <div className="text-white/70 text-sm">Progreso rápido</div>
          <div className="flex items-center gap-2">
            {progressSorted.map((p, idx) => (
              <Pill key={p.id} className="bg-white/10 border border-white/10 text-white/80">
                {idx + 1}. {p.name} ({p.score})
              </Pill>
            ))}
          </div>
        </div>
        {isHost && (
          <>
            <div className="max-w-md mx-auto mb-4 bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-white/70">Tiempo por turno</p>
                <Pill className="bg-primary/20 text-white">{state.turnSeconds || 60}s</Pill>
              </div>
              <input
                type="range"
                min="15"
                max="180"
                value={state.turnSeconds || 60}
                onChange={(e) => send({ type: 'set_timer', seconds: Number(e.target.value) })}
                className="w-full mt-2 accent-primary"
              />
            </div>
            <div className="max-w-md mx-auto mb-4 bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-white/70">Límite de puntos</p>
                <Pill className="bg-primary/20 text-white">{state.pointLimit || 30} pts</Pill>
              </div>
              <input
                type="range"
                min="10"
                max="80"
                value={state.pointLimit || 30}
                onChange={(e) => send({ type: 'set_point_limit', pointLimit: Number(e.target.value) })}
                className="w-full mt-2 accent-primary"
              />
            </div>
            <div className="max-w-md mx-auto mb-4 bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-white/70">Modo de juego</p>
                <Pill className={state.mode === 'party' ? 'bg-accent-pink/30 text-white' : 'bg-primary/20 text-white'}>
                  {state.mode === 'party' ? '+18 Bebidas' : 'Clásico'}
                </Pill>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={state.mode}
                  onChange={(e) => send({
                    type: 'set_mode',
                    mode: e.target.value,
                    drinkLevel: state.drinkLevel,
                    partyRules: state.partyRules || { randomEvents: true, safeMessaging: true },
                  })}
                  className="h-11 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm"
                >
                  <option value="classic">Clásico</option>
                  <option value="party">Modo +18 (beber)</option>
                </select>
                {state.mode === 'party' && (
                  <select
                    value={state.drinkLevel || 'light'}
                    onChange={(e) => send({
                      type: 'set_mode',
                      mode: 'party',
                      drinkLevel: e.target.value,
                      partyRules: state.partyRules || { randomEvents: true, safeMessaging: true },
                    })}
                    className="h-11 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm"
                  >
                    <option value="light">Beber poco</option>
                    <option value="medium">Beber medio</option>
                    <option value="heavy">Beber mucho</option>
                  </select>
                )}
              </div>
              {state.mode === 'party' && (
                <div className="grid grid-cols-1 gap-2 pt-1">
                  <label className="text-xs text-white/60 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={state.partyRules?.randomEvents !== false}
                      onChange={(e) => send({
                        type: 'set_mode',
                        mode: 'party',
                        drinkLevel: state.drinkLevel,
                        partyRules: {
                          ...(state.partyRules || {}),
                          randomEvents: e.target.checked,
                        },
                      })}
                    />
                    Eventos aleatorios
                  </label>
                  <label className="text-xs text-white/60 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={state.partyRules?.safeMessaging !== false}
                      onChange={(e) => send({
                        type: 'set_mode',
                        mode: 'party',
                        drinkLevel: state.drinkLevel,
                        partyRules: {
                          ...(state.partyRules || {}),
                          safeMessaging: e.target.checked,
                        },
                      })}
                    />
                    Mensajes de consumo responsable
                  </label>
                </div>
              )}
              <p className="text-xs text-white/50">En +18 se genera un reto de bebida ligado a la carta del narrador.</p>
            </div>
          </>
        )}
        <div className="mx-auto max-w-sm mb-8 mt-2">
          <button onClick={() => navigator.clipboard.writeText(roomCode)} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gradient-to-br from-primary/20 to-primary-dark/10 border border-primary/30 shadow-lg w-full">
            <span className="text-primary-light text-xs font-bold tracking-widest uppercase">Código</span>
            <div className="flex items-center gap-3">
              <h2 className="text-white text-3xl font-black tracking-widest drop-shadow font-mono">{roomCode}</h2>
              <span className="material-symbols-outlined text-white/50 text-xl" title="Copiar">content_copy</span>
            </div>
            <p className="text-white/40 text-[10px] mt-1">Toca para copiar y compartir</p>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          {players.map((p) => (
            <Avatar
              key={p.id}
              name={p.name}
              highlight={p.ready}
              badge={
                <>
                  {p.id === hostId && <span className="material-symbols-outlined text-yellow-400" style={{ fontSize: 20 }}>crown</span>}
                  {p.isBot && <Pill className="bg-white/10 text-white/70 border border-white/10">BOT</Pill>}
                </>
              }
            />
          ))}
          <button onClick={() => navigator.clipboard.writeText(roomCode)} className="flex flex-col items-center justify-center gap-3 p-4 rounded-2xl border-2 border-dashed border-white/10 bg-white/5 relative group hover:bg-white/10 transition-colors cursor-pointer min-h-[160px]">
            <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <span className="material-symbols-outlined text-white/70 text-2xl">add</span>
            </div>
            <p className="text-white font-semibold">Compartir enlace</p>
            <p className="text-white/50 text-xs text-center">Invita a más amigos</p>
          </button>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 px-4 pb-8">
        <div className="max-w-md mx-auto glass-panel rounded-2xl p-4 border border-white/10 shadow-lg flex items-center gap-3 flex-wrap">
          <div className="flex-1">
            <p className="text-sm text-white/60">Jugadores listos</p>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
              <span className="text-white/70 text-sm">{readyCount}/{players.length}</span>
            </div>
          </div>
          <button onClick={() => send({ type: 'set_ready', ready: !you?.ready })} className="h-12 px-4 rounded-xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/20 transition min-w-[110px]">{you?.ready ? 'No listo' : 'Listo'}</button>
          {isHost && (
            <div className="flex gap-2">
              <select
                value={botDifficulty}
                onChange={(e) => setBotDifficulty(e.target.value)}
                className="h-12 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm"
              >
                <option value="easy">Bot fácil</option>
                <option value="normal">Bot normal</option>
                <option value="smart">Bot listo</option>
              </select>
              <button onClick={() => send({ type: 'add_bot', difficulty: botDifficulty })} className="h-12 px-3 rounded-xl border border-white/20 bg-white/10 text-white font-semibold hover:bg-white/20 transition text-sm min-w-[110px]">
                Añadir bot
              </button>
              <button onClick={() => send({
                type: 'start_with_bots',
                difficulty: botDifficulty,
                mode: state.mode,
                drinkLevel: state.drinkLevel,
                partyRules: state.partyRules || { randomEvents: true, safeMessaging: true },
              })} className="h-12 px-4 rounded-xl bg-gradient-to-r from-primary to-accent-pink text-white font-semibold shadow-lg shadow-primary/30 hover:brightness-110 transition min-w-[120px]">
                Empezar
              </button>
            </div>
          )}
          <button
            onClick={() => {
              if (onShowProgress) return onShowProgress();
              window.dispatchEvent(new Event('dixit:progress'));
            }}
            className="h-12 px-4 rounded-xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/20 transition min-w-[110px]"
          >
            Ver progreso
          </button>
          <button onClick={() => onLeave && onLeave()} className="h-12 px-4 rounded-xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/20 transition min-w-[90px]">
            Salir
          </button>
          {isHost && (
            <button onClick={() => send({ type: 'end_room' })} className="h-12 px-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold shadow-lg shadow-red-500/30 hover:brightness-110 transition min-w-[130px]">
              Eliminar partida
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Clue({ state, send, selected, setSelected, clue, setClue }) {
  const { hand = [], turnSeconds = 60, phaseStartedAt, storytellerId, players = [] } = state;
  const fallbackDeadline = (phaseStartedAt || Date.now()) + turnSeconds * 1000;
  const timeLeft = Math.max(0, Number(state?.timer?.deadlineAt || fallbackDeadline) - Date.now());
  const narratorName = players.find((p) => p.id === storytellerId)?.name || 'Narrador';
  const ready = selected && clue.trim().length > 0;
  return (
    <section className="relative z-10 flex-1 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 pt-12 pb-4 bg-background-dark/70 backdrop-blur-sm z-20 sticky top-0 border-b border-primary/10">
        <div className="flex items-center gap-2 text-white/70">
          <span className="material-symbols-outlined">auto_stories</span>
          <span className="text-sm uppercase font-semibold">Tu turno · {narratorName}</span>
        </div>
        <div className="flex items-center gap-1 text-white/70">
          <span className="material-symbols-outlined text-[16px]">timer</span>
          <span className="text-xs font-mono font-medium">{formatTime(timeLeft)}</span>
        </div>
      </header>
      <main className="flex-1 flex flex-col relative overflow-y-auto no-scrollbar pb-24">
        <div className="px-6 py-4 text-center">
          <h2 className="text-2xl font-bold leading-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">Elige una carta y escribe tu pista</h2>
          <p className="text-sm text-white/60 mt-1">Sé sutil, pero no demasiado...</p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-2">
          <div className="relative group w-full max-w-[320px] aspect-[2/3]">
            {selected ? (
              <>
                <div className="absolute -inset-1 bg-gradient-to-r from-primary to-purple-600 rounded-xl opacity-75 blur-lg" />
                <div className="relative h-full w-full rounded-xl overflow-hidden shadow-2xl border-2 border-primary/50 bg-slate-800">
                  <img src={`/${selected}`} className="w-full h-full object-cover" />
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5">
                <p className="text-white/50 text-sm">Elige una carta</p>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 px-4 pb-6">
          <div className="flex gap-3 overflow-x-auto no-scrollbar py-4 px-2 snap-x snap-mandatory" id="clue-hand">
            {hand.map((card) => (
              <div key={card} className={`snap-center shrink-0 w-20 aspect-[2/3] rounded-lg overflow-hidden transition-all shadow-lg cursor-pointer ${selected === card ? 'ring-2 ring-primary ring-offset-2 ring-offset-[#191022]' : 'opacity-70 hover:opacity-100'}`} onClick={() => setSelected(card)}>
                <img src={`/${card}`} alt="carta" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 pb-10">
          <label className="text-sm text-white/70">Tu pista</label>
          <div className="mt-2 flex gap-3 items-center">
            <input id="clue-input" value={clue} onChange={(e) => setClue(e.target.value)} type="text" maxLength={80} className="flex-1 rounded-xl bg-white/10 border border-white/10 focus:border-primary focus:ring-primary text-white placeholder:text-white/40 px-3 py-3" placeholder="Un sueño lúcido" />
            <button disabled={!ready} onClick={() => send({ type: 'submit_clue', card: selected, clue: clue.trim() })} className="h-12 px-4 rounded-xl bg-gradient-to-r from-primary to-accent-pink text-white font-semibold shadow-lg shadow-primary/30 hover:brightness-110 transition disabled:opacity-50">Enviar</button>
          </div>
        </div>
      </main>
    </section>
  );
}

function Submit({ state, send }) {
  const { hand = [], clue, you, turnSeconds = 60, phaseStartedAt, storytellerId, players = [] } = state;
  const fallbackDeadline = (phaseStartedAt || Date.now()) + turnSeconds * 1000;
  const timeLeft = Math.max(0, Number(state?.timer?.deadlineAt || fallbackDeadline) - Date.now());
  const narratorName = players.find((p) => p.id === storytellerId)?.name || 'Narrador';
  const pendingNames = (state.pendingPlayers || []).map((entry) => entry.name).filter(Boolean);
  if (you?.submitted) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/70 px-4">
        <div className="text-center rounded-2xl border border-white/10 bg-white/5 px-6 py-6">
          <p className="text-lg font-semibold">Carta enviada</p>
          <p className="text-sm text-white/50">Esperando a: {pendingNames.length > 0 ? pendingNames.join(', ') : 'transición de ronda'}</p>
          <div className="mx-auto mt-4 h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      </div>
    );
  }
  return (
    <section className="relative z-10 flex-1 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 pt-12 pb-4 bg-background-dark/70 backdrop-blur-sm z-20 sticky top-0 border-b border-primary/10">
        <div className="flex flex-col items-start">
          <p className="text-xs uppercase text-primary font-semibold">El narrador dijo</p>
          <p className="text-2xl sm:text-3xl font-black text-white leading-tight">{clue}</p>
        </div>
        <div className="flex items-center gap-1 text-white/70">
          <span className="material-symbols-outlined text-[16px]">timer</span>
          <span className="text-xs font-mono font-medium">{formatTime(timeLeft)}</span>
          <span className="text-xs text-white/60">Narrador: {narratorName}</span>
        </div>
      </header>
      <main className="flex-1 flex flex-col relative overflow-y-auto no-scrollbar pb-24">
        <div className="px-6 py-4 text-center">
          <h2 className="text-2xl font-bold leading-tight">Elige la carta que más encaje</h2>
          <p className="text-sm text-white/60 mt-1">No reveles cuál es la tuya</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-6">
          {hand.map((card) => (
            <button key={card} className="relative rounded-xl overflow-hidden shadow-xl border border-white/10 bg-white/5 hover:-translate-y-1 transition" onClick={() => send({ type: 'submit_card', card })}>
              <img src={`/${card}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      </main>
    </section>
  );
}

function Vote({ state, send }) {
  const { board = [], clue, you, turnSeconds = 60, phaseStartedAt, storytellerId, players = [] } = state;
  const fallbackDeadline = (phaseStartedAt || Date.now()) + turnSeconds * 1000;
  const timeLeft = Math.max(0, Number(state?.timer?.deadlineAt || fallbackDeadline) - Date.now());
  const narratorName = players.find((p) => p.id === storytellerId)?.name || 'Narrador';
  const pendingNames = (state.pendingPlayers || []).map((entry) => entry.name).filter(Boolean);
  return (
    <section className="relative z-10 flex-1 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 pt-12 pb-4 bg-background-dark/70 backdrop-blur-sm z-20 sticky top-0 border-b border-primary/10">
        <div className="flex flex-col items-start">
          <p className="text-xs uppercase text-primary font-semibold">Vota la carta del narrador</p>
          <p className="text-2xl sm:text-3xl font-black text-white leading-tight">{clue}</p>
        </div>
        <div className="flex items-center gap-1 text-white/70">
          <span className="material-symbols-outlined text-[16px]">timer</span>
          <span className="text-xs font-mono font-medium">{formatTime(timeLeft)}</span>
          <span className="text-xs text-white/60">Narrador: {narratorName}</span>
        </div>
      </header>
      <main className="flex-1 flex flex-col relative overflow-y-auto no-scrollbar pb-28">
        <div className="px-6 py-4 text-center">
          <p className="text-sm text-white/60">No votes tu propia carta</p>
          {you?.votedFor && (
            <p className="mt-1 text-xs text-white/50">
              Voto enviado. Esperando a: {pendingNames.length > 0 ? pendingNames.join(', ') : 'resolución'}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-6">
          {board.map((card) => {
            const disabled = Boolean(you?.votedFor) || card.isYours;
            return (
              <button
                key={card.id}
                disabled={disabled}
                className={`relative rounded-xl overflow-hidden shadow-xl border ${card.isYours ? 'border-amber-400/60' : 'border-white/10'} bg-white/5 transition ${disabled ? 'opacity-60' : 'hover:-translate-y-1'}`}
                onClick={() => send({ type: 'vote', submissionId: card.id })}
              >
                <img src={`/${card.card}`} className="w-full h-full object-cover" />
                {card.isYours && <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-amber-500/80 text-xs font-semibold text-white">Tu carta</div>}
              </button>
            );
          })}
        </div>
      </main>
    </section>
  );
}

function Score({ state, send }) {
  const { players = [], summary, board = [], hostId, you } = state;
  const resultMap = useMemo(() => new Map(summary?.results?.map((r) => [r.playerId, r]) || []), [summary]);
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const votesDetail = summary?.votesDetail || summary?.votes || [];
  const storytellerSubmission = board.find((b) => b.ownerId === summary?.storytellerId);
  const storytellerReason = summary?.clueReason || extractReason(summary?.clue);
  const maxRounds = 10;
  const roundsLeft = Math.max(maxRounds - (summary?.round || 1), 0);
  const tags = summary?.tags;
  const canContinue = Boolean(state?.canContinue) && !state?.finished;

  return (
    <section className="relative z-10 flex-1 flex flex-col overflow-hidden" id="screen-score">
      <header className="flex items-center justify-between px-4 pt-12 pb-4 bg-background-dark/70 backdrop-blur-sm z-20 sticky top-0 border-b border-primary/10">
        <div className="flex items-center gap-2 text-white/70">
          <span className="material-symbols-outlined">leaderboard</span>
          <span className="text-sm sm:text-base uppercase tracking-wide font-semibold">Resultados · Ronda {summary?.round || state.round}</span>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => window.dispatchEvent(new CustomEvent('dixit:progress'))} className="h-9 sm:h-10 px-3 sm:px-4 rounded-full bg-white/10 border border-white/20 text-white text-xs sm:text-sm font-semibold hover:bg-white/20 transition whitespace-nowrap">
            Ver progreso
          </button>
          <button
            disabled={!canContinue}
            onClick={() => send({ type: 'continue' })}
            className="h-9 sm:h-10 px-3 sm:px-4 rounded-full bg-gradient-to-r from-primary to-accent-pink text-white text-xs sm:text-sm font-semibold shadow-primary/30 shadow-lg disabled:opacity-60 whitespace-nowrap"
          >
            {state?.finished ? 'Partida terminada' : canContinue ? 'Continuar' : 'Esperando...'}
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto no-scrollbar px-6 py-6">
        <div className="space-y-3 max-w-xl mx-auto" id="scoreboard">
          {sorted.map((p, idx) => {
            const delta = resultMap.get(p.id)?.delta || 0;
            return (
              <div key={p.id} className="flex items-center justify-between rounded-2xl glass-panel border border-white/10 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">{idx + 1}</div>
                  <div>
                    <p className="text-white font-semibold">{p.name}{p.id === summary?.storytellerId ? ' · Narrador' : ''}</p>
                    <p className="text-white/50 text-xs">{delta >= 0 ? '+' : ''}{delta} puntos</p>
                  </div>
                </div>
                <div className="text-xl font-black text-white">{p.score}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 max-w-xl mx-auto glass-panel rounded-2xl p-4 border border-white/10" id="round-summary">
          <p className="text-sm text-white/60 mb-2">Pista del narrador</p>
          <p className="text-3xl font-black text-white mb-2">"{summary?.clue || ''}"</p>
          <p className="text-base text-white/80 mb-2">Narrador: {playerById.get(summary?.storytellerId)?.name || ''}</p>
          {storytellerReason && <p className="text-white/70 text-sm mb-2">Motivo: {storytellerReason}</p>}
          {summary?.gameOver && (
            <div className="mb-3 rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100">
              Partida finalizada. Ganador(es): {(summary?.winnerIds || []).map((id) => playerById.get(id)?.name || id).join(', ')}
            </div>
          )}
          {state.mode === 'party' && summary?.drinkPrompt && (
            <div className="mt-3 p-3 rounded-xl bg-accent-pink/10 border border-accent-pink/30">
              <p className="text-sm font-semibold text-white">Reto de bebida ({state.drinkLevel === 'heavy' ? 'beber mucho' : state.drinkLevel === 'medium' ? 'beber medio' : 'beber poco'})</p>
              <p className="text-white/80 text-sm mt-1">{summary.drinkPrompt}</p>
            </div>
          )}
          {tags && <p className="text-white/50 text-xs mt-2">IA: carta con tema {tags.theme}, ambiente {tags.mood}, elemento {tags.element}, colores {tags.colors}.</p>}
          <div className="space-y-2">
            {board.map((c) => {
              const owner = playerById.get(c.ownerId);
              const votes = summary?.votes?.filter((v) => v.submissionId === c.id).map((v) => playerById.get(v.playerId)?.name || '') || [];
              const isNarratorCard = c.ownerId === summary?.storytellerId;
              return (
                <div key={c.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                  <img src={`/${c.card}`} className="w-16 h-16 object-cover rounded-lg" />
                  <div>
                    <p className="text-white font-semibold">{owner?.name || 'Jugador'}{isNarratorCard ? ' (Narrador)' : ''}</p>
                    <p className="text-white/60 text-sm">Votos: {votes.length ? votes.join(', ') : 'Nadie'}</p>
                    {isNarratorCard && <p className="text-white/60 text-sm">Razón narrador: {storytellerReason || 'No indicada'}</p>}
                    {!isNarratorCard && votes.length === 0 && <p className="text-white/50 text-xs">Nadie la eligió</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <p className="text-sm text-white/60 mb-2">Quién votó a quién</p>
            <div className="space-y-2">
              {votesDetail.length === 0 && <p className="text-white/50 text-sm">Sin votos registrados</p>}
              {votesDetail.map((v, idx) => {
                const voter = playerById.get(v.playerId);
                const owner = playerById.get(v.ownerId);
                return (
                  <div key={`${v.playerId}-${idx}`} className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/5 border border-white/5">
                    <span className="text-white font-semibold">{voter?.name || 'Jugador'}</span>
                    <span className="text-white/60 text-sm">votó</span>
                    <span className="text-white font-semibold">{owner?.name || '??'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </section>
  );
}

function ActiveRoomsView({
  activeRooms = [],
  fetchActiveRooms,
  onBack,
  onJoinRoom,
  onResumeRoom,
  send,
}) {
  const [filter, setFilter] = useState('joinable');
  const [deleteModalRoom, setDeleteModalRoom] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  const filteredRooms = useMemo(() => {
    return (activeRooms || []).filter((room) => {
      if (filter === 'all') return true;
      if (filter === 'joinable') return room.canJoin && room.kind !== 'solo_bots';
      if (filter === 'mine') return room.isUserInRoom;
      if (filter === 'lobby') return room.status === 'lobby';
      if (filter === 'running') return room.status === 'in_progress';
      if (filter === 'party') return room.mode === 'party';
      if (filter === 'online') return room.kind === 'online' || room.kind === 'mixed';
      return true;
    });
  }, [activeRooms, filter]);

  const confirmDeleteRoom = () => {
    if (!deleteModalRoom) return;
    send({ type: 'end_room', roomCode: deleteModalRoom, password: deletePassword });
    setDeleteModalRoom('');
    setDeletePassword('');
    window.setTimeout(() => {
      fetchActiveRooms();
    }, 350);
  };

  return (
    <section className="relative z-10 flex-1 flex flex-col overflow-hidden px-4 pb-6">
      <header className="flex items-center justify-between pt-10 pb-4">
        <button onClick={onBack} className="h-10 w-10 rounded-full bg-white/10 border border-white/20 text-white">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h2 className="text-white text-lg font-bold">Salas activas</h2>
        <button onClick={fetchActiveRooms} className="h-10 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-semibold">
          Refrescar
        </button>
      </header>

      <div className="mb-3 flex gap-2 overflow-x-auto no-scrollbar">
        {[
          ['joinable', 'Unibles'],
          ['mine', 'Mías'],
          ['lobby', 'Lobby'],
          ['running', 'En curso'],
          ['party', '+18'],
          ['online', 'Online'],
          ['all', 'Todas'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`h-9 px-3 rounded-full text-xs font-semibold border ${filter === key ? 'bg-primary/30 border-primary/50 text-white' : 'bg-white/10 border-white/20 text-white/70'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-3">
        {filteredRooms.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-sm text-white/60">
            No hay salas para este filtro.
          </div>
        )}
        {filteredRooms.map((room) => {
          const canJoin = room.canJoin && room.kind !== 'solo_bots';
          return (
            <article key={room.code} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-white/50">Código</p>
                  <p className="text-xl font-black text-white tracking-widest font-mono">{room.code}</p>
                </div>
                <div className="text-right flex flex-col gap-1">
                  <Pill className={room.status === 'lobby' ? 'bg-sky-500/20 text-sky-100' : room.status === 'finished' ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/20 text-amber-100'}>
                    {room.status === 'lobby' ? 'Lobby' : room.status === 'finished' ? 'Terminada' : 'En curso'}
                  </Pill>
                  <Pill className={room.mode === 'party' ? 'bg-accent-pink/30 text-white' : 'bg-primary/20 text-white'}>
                    {room.mode === 'party' ? '+18' : 'Clásico'}
                  </Pill>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/70">
                <p>Jugadores: {room.humanCount} humanos + {room.botCount} bots</p>
                <p>Narrador: {room.storytellerName || '—'}</p>
                <p>Límite: {room.pointLimit} pts</p>
                <p>Tipo: {room.kind === 'solo_bots' ? 'Solo bots' : room.kind === 'mixed' ? 'Mixta' : 'Online'}</p>
              </div>
              <div className="mt-3 flex gap-2">
                {room.isUserInRoom ? (
                  <button
                    type="button"
                    onClick={() => onResumeRoom(room.code)}
                    className="h-10 px-3 rounded-xl bg-primary text-white text-sm font-semibold"
                  >
                    Reanudar
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canJoin}
                    onClick={() => onJoinRoom(room.code)}
                    className="h-10 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {canJoin ? 'Entrar' : 'No unible'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDeletePassword('');
                    setDeleteModalRoom(room.code);
                  }}
                  className="h-10 px-3 rounded-xl bg-red-600/85 text-white text-sm font-semibold"
                >
                  Eliminar
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {deleteModalRoom && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#241634] p-5 shadow-2xl">
            <h3 className="text-white text-lg font-bold">Eliminar sala {deleteModalRoom}</h3>
            <p className="text-white/65 text-sm mt-1">Si no eres host, usa contraseña maestra opcional.</p>
            <label className="block mt-4 text-xs text-white/60">Contraseña maestra (opcional)</label>
            <input
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-3 text-white placeholder:text-white/40"
              placeholder="Escribe la contraseña"
            />
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalRoom('');
                  setDeletePassword('');
                }}
                className="h-10 px-4 rounded-xl border border-white/20 bg-white/10 text-white text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteRoom}
                className="h-10 px-4 rounded-xl bg-red-600 text-white text-sm font-semibold"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ProfileView({
  profileData,
  profileDraft,
  setProfileDraft,
  profileSaving,
  profileError,
  profileSavedAt,
  onSave,
  onBack,
}) {
  const stats = profileData?.stats || {};
  const history = profileData?.history || [];
  const winRate = Math.round((stats.winRate || 0) * 100);
  const initial = profileDraft?.nickname?.[0] || profileData?.profile?.nickname?.[0] || '?';

  if (!profileDraft) {
    return (
      <section className="relative z-10 flex-1 flex items-center justify-center">
        <div className="loading-orb" />
      </section>
    );
  }

  return (
    <section className="relative z-10 flex-1 flex flex-col overflow-hidden px-4 pb-6">
      <header className="flex items-center justify-between pt-10 pb-4">
        <button onClick={onBack} className="h-10 w-10 rounded-full bg-white/10 border border-white/20 text-white">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h2 className="text-white text-lg font-bold">Perfil</h2>
        <button
          type="button"
          disabled={profileSaving}
          onClick={onSave}
          className="h-10 px-3 rounded-xl bg-gradient-to-r from-primary to-accent-pink text-white text-sm font-semibold disabled:opacity-60"
        >
          {profileSaving ? 'Guardando...' : 'Guardar'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-4">
        <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-xl font-black">
              {initial.toUpperCase()}
            </div>
            <div>
              <p className="text-white text-sm">{profileData?.user?.username}</p>
              <p className="text-white/60 text-xs">ID: {profileData?.user?.id}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <label className="text-xs text-white/60">
              Nickname visible
              <input
                value={profileDraft.nickname}
                onChange={(event) => setProfileDraft((current) => ({ ...current, nickname: event.target.value }))}
                maxLength={28}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-white"
              />
            </label>
            <label className="text-xs text-white/60">
              Avatar seed
              <input
                value={profileDraft.avatarSeed}
                onChange={(event) => setProfileDraft((current) => ({ ...current, avatarSeed: event.target.value }))}
                maxLength={24}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-white"
              />
            </label>
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-white/80 font-semibold mb-2">Preferencias</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-white/60">
              Modo por defecto
              <select
                value={profileDraft.preferredMode}
                onChange={(event) => setProfileDraft((current) => ({ ...current, preferredMode: event.target.value }))}
                className="mt-1 w-full h-10 rounded-xl border border-white/15 bg-white/10 px-2 text-white"
              >
                <option value="classic">Clásico</option>
                <option value="party">+18</option>
              </select>
            </label>
            <label className="text-xs text-white/60">
              Bot por defecto
              <select
                value={profileDraft.preferredBotDifficulty}
                onChange={(event) => setProfileDraft((current) => ({ ...current, preferredBotDifficulty: event.target.value }))}
                className="mt-1 w-full h-10 rounded-xl border border-white/15 bg-white/10 px-2 text-white"
              >
                <option value="easy">Fácil</option>
                <option value="normal">Normal</option>
                <option value="smart">Difícil</option>
              </select>
            </label>
            <label className="text-xs text-white/60 flex items-center gap-2">
              <input
                type="checkbox"
                checked={profileDraft.musicOn}
                onChange={(event) => setProfileDraft((current) => ({ ...current, musicOn: event.target.checked }))}
              />
              Música activada
            </label>
            <label className="text-xs text-white/60 flex items-center gap-2">
              <input
                type="checkbox"
                checked={profileDraft.sfxOn}
                onChange={(event) => setProfileDraft((current) => ({ ...current, sfxOn: event.target.checked }))}
              />
              Efectos activados
            </label>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <label className="text-xs text-white/60">
              Volumen música ({Math.round(profileDraft.musicVolume * 100)}%)
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={profileDraft.musicVolume}
                onChange={(event) => setProfileDraft((current) => ({ ...current, musicVolume: Number(event.target.value) }))}
                className="w-full accent-primary"
              />
            </label>
            <label className="text-xs text-white/60">
              Volumen efectos ({Math.round(profileDraft.sfxVolume * 100)}%)
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={profileDraft.sfxVolume}
                onChange={(event) => setProfileDraft((current) => ({ ...current, sfxVolume: Number(event.target.value) }))}
                className="w-full accent-primary"
              />
            </label>
          </div>
          <label className="mt-3 text-xs text-white/60 flex items-start gap-2">
            <input
              type="checkbox"
              checked={profileDraft.adultModeOptIn}
              onChange={(event) => setProfileDraft((current) => ({
                ...current,
                adultModeOptIn: event.target.checked,
                preferredMode: event.target.checked ? current.preferredMode : 'classic',
              }))}
            />
            <span>Acepto activar modo +18 (solo adultos, consumo responsable, opcional).</span>
          </label>
          {!profileDraft.adultModeOptIn && (
            <p className="mt-2 text-xs text-amber-200/90">El modo +18 permanece oculto hasta que lo actives aquí.</p>
          )}
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/5 p-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-white/60">Partidas</p>
            <p className="text-2xl font-black text-white">{stats.gamesPlayed || 0}</p>
          </div>
          <div>
            <p className="text-xs text-white/60">Victorias</p>
            <p className="text-2xl font-black text-white">{stats.gamesWon || 0}</p>
          </div>
          <div>
            <p className="text-xs text-white/60">Winrate</p>
            <p className="text-2xl font-black text-white">{winRate}%</p>
          </div>
          <div>
            <p className="text-xs text-white/60">Puntos acumulados</p>
            <p className="text-2xl font-black text-white">{stats.totalPoints || 0}</p>
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-white/80 font-semibold mb-2">Historial reciente</p>
          <div className="space-y-2">
            {history.length === 0 && <p className="text-xs text-white/50">Aún no hay partidas terminadas.</p>}
            {history.map((entry) => (
              <div key={entry.id} className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-white text-sm font-semibold">{entry.roomCode}</p>
                  <p className="text-xs text-white/60">
                    {entry.mode === 'party' ? '+18' : 'Clásico'} · {entry.winner ? 'Victoria' : 'Derrota'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-white text-sm font-bold">{entry.score} pts</p>
                  <p className="text-xs text-white/50">{new Date(entry.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      {(profileError || profileSavedAt) && (
        <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${profileError ? 'border-rose-300/40 bg-rose-500/20 text-rose-100' : 'border-emerald-300/40 bg-emerald-500/20 text-emerald-100'}`}>
          {profileError || `Perfil guardado (${new Date(profileSavedAt).toLocaleTimeString()})`}
        </div>
      )}
    </section>
  );
}

function Landing({
  onJoin,
  onSolo,
  onOpenRooms,
  onOpenProfile,
  onLogout,
  name,
  setName,
  room,
  setRoom,
  activeRooms,
  toggleMusic,
  musicOn,
  musicStatusLabel,
  startingSolo,
  soloConfig,
  setSoloConfig,
  adultModeEnabled,
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const handleRoomChange = (value, el) => {
    const formatted = formatRoomCode(value);
    if (el) el.value = formatted;
    setRoom(formatted);
  };

  const featuredRoom = activeRooms?.find((entry) => entry.status !== 'finished');
  const soloBlockedByAdult = soloConfig.mode === 'party' && !adultModeEnabled;

  return (
    <section className="relative z-10 flex-1 flex flex-col bg-surreal text-white overflow-hidden">
      <div className="flex items-center justify-between p-6 pt-8">
        <div className="flex items-center gap-3">
          <button onClick={() => setMenuOpen(true)} className="material-symbols-outlined text-white/70 hover:text-white transition-colors" style={{ fontSize: 28 }}>menu</button>
        </div>
        <h1 className="text-xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white via-purple-100 to-white text-glow uppercase">
          DIXIT: ONÍRICO
        </h1>
        <button onClick={onOpenProfile} className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full border-2 border-primary p-0.5 overflow-hidden">
            <div className="h-full w-full rounded-full bg-white/10 flex items-center justify-center text-sm font-bold">{name?.[0] || 'T'}</div>
          </div>
        </button>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end">
          <div className="w-72 max-w-full h-full bg-[#21152f] border-l border-white/10 p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold">Menú</h3>
              <button onClick={() => setMenuOpen(false)} className="material-symbols-outlined text-white/70 hover:text-white">close</button>
            </div>
            <button onClick={() => { toggleMusic(); }} className="w-full h-11 rounded-xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/20 transition flex items-center justify-between px-3">
              <span>Música misteriosa</span>
              <span>{musicStatusLabel || (musicOn ? 'ON' : 'OFF')}</span>
            </button>
            <button onClick={() => { setMenuOpen(false); onOpenRooms(); }} className="w-full h-11 rounded-xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/20 transition flex items-center justify-between px-3">
              <span>Salas activas</span>
              <span className="material-symbols-outlined">groups</span>
            </button>
            <button onClick={() => { setMenuOpen(false); onOpenProfile(); }} className="w-full h-11 rounded-xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/20 transition flex items-center justify-between px-3">
              <span>Perfil</span>
              <span className="material-symbols-outlined">person</span>
            </button>
            <button onClick={onLogout} className="w-full h-11 rounded-xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/20 transition flex items-center justify-between px-3">
              <span>Cerrar sesión</span>
              <span className="material-symbols-outlined">logout</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-start px-4 pb-28 overflow-y-auto no-scrollbar space-y-6">
        <div className="w-full max-w-md glass-panel rounded-3xl p-1 shadow-2xl">
          <div className="relative flex flex-col rounded-2xl bg-surface-dark/30 p-4">
            <div className="flex items-start gap-4">
              <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 shadow-lg">
                <img className="h-full w-full object-cover" src="/cards/card-001.webp" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col h-24 justify-between py-1">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-bold tracking-wide text-gold/90 uppercase">Partida rápida</h3>
                    <span className="text-[10px] font-medium bg-white/10 px-2 py-0.5 rounded-full text-white/80">{featuredRoom ? `${featuredRoom.humanCount + featuredRoom.botCount} jugadores` : 'Nueva'}</span>
                  </div>
                  <p className="text-xs text-purple-200 line-clamp-2">Estado limpio: Home, Salas y Perfil están separados.</p>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="material-symbols-outlined text-primary text-[18px]">hourglass_top</span>
                    <p className="font-medium text-white">{featuredRoom?.status === 'in_progress' ? 'Partidas en curso' : 'Turno libre'}</p>
                  </div>
                  <button onClick={onJoin} className="group flex items-center gap-1 bg-primary hover:bg-primary-light text-white text-xs font-bold px-4 py-2 rounded-full transition-all btn-glow shadow-lg shadow-primary/20">
                    CONTINUAR
                    <span className="material-symbols-outlined text-[16px] group-hover:translate-x-0.5 transition-transform">arrow_forward</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="w-full max-w-md space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-sm text-white/70">Tu nombre</label>
              <input id="name-input" value={name} onChange={(e) => setName(e.target.value)} type="text" maxLength={20} className="mt-2 w-full rounded-2xl bg-white/10 border border-white/10 focus:border-primary focus:ring-primary text-white placeholder:text-white/40 px-3 py-3" placeholder="Sofía" />
            </div>
            <div className="col-span-2">
              <label className="text-sm text-white/70">Código de sala</label>
              <input
                id="room-input"
                value={room}
                onInput={(e) => handleRoomChange(e.target.value, e.target)}
                onChange={(e) => handleRoomChange(e.target.value, e.target)}
                onBlur={(e) => handleRoomChange(e.target.value, e.target)}
                type="text"
                maxLength={7}
                className="mt-2 w-full uppercase tracking-[0.3em] text-center text-lg font-mono rounded-2xl bg-white/10 border border-white/10 focus:border-primary focus:ring-primary text-white placeholder:text-white/40 px-3 py-3"
                placeholder="DXT-123"
              />
            </div>
          </div>

          <button aria-label="Unirse / Crear" onClick={onJoin} className="relative group w-full overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-[#5e0eb0] p-[1px] shadow-lg shadow-primary/10 transition-transform active:scale-95">
            <div className="relative flex h-16 w-full items-center justify-between bg-surface-dark/40 px-6 backdrop-blur-sm transition-colors group-hover:bg-surface-dark/20 rounded-2xl">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
                  <span className="material-symbols-outlined">add</span>
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-lg font-bold text-white tracking-wide">Crear / Unirse</span>
                  <span className="text-xs text-purple-200/70 font-medium">Introduce código o crea nueva</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-white/50 group-hover:text-white transition-colors">chevron_right</span>
            </div>
          </button>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-3">
            <p className="text-sm text-white/80 font-semibold">Configurar Solo con bots</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-white/60">
                Modo
                <select
                  value={soloConfig.mode}
                  onChange={(event) => setSoloConfig((current) => ({ ...current, mode: event.target.value }))}
                  className="mt-1 w-full h-10 rounded-xl border border-white/20 bg-white/10 px-2 text-white"
                >
                  <option value="classic">Clásico</option>
                  <option value="party">+18 (adultos)</option>
                </select>
              </label>
              <label className="text-xs text-white/60">
                Bot
                <select
                  value={soloConfig.difficulty}
                  onChange={(event) => setSoloConfig((current) => ({ ...current, difficulty: event.target.value }))}
                  className="mt-1 w-full h-10 rounded-xl border border-white/20 bg-white/10 px-2 text-white"
                >
                  <option value="easy">Fácil</option>
                  <option value="normal">Normal</option>
                  <option value="smart">Difícil</option>
                </select>
              </label>
            </div>
            {soloConfig.mode === 'party' && (
              <div className="space-y-2">
                <label className="text-xs text-white/60">
                  Intensidad bebida
                  <select
                    value={soloConfig.drinkLevel}
                    onChange={(event) => setSoloConfig((current) => ({ ...current, drinkLevel: event.target.value }))}
                    className="mt-1 w-full h-10 rounded-xl border border-white/20 bg-white/10 px-2 text-white"
                  >
                    <option value="light">Beber poco</option>
                    <option value="medium">Beber medio</option>
                    <option value="heavy">Beber mucho</option>
                  </select>
                </label>
                <label className="text-xs text-white/60 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={soloConfig.partyRules.randomEvents}
                    onChange={(event) => setSoloConfig((current) => ({ ...current, partyRules: { ...current.partyRules, randomEvents: event.target.checked } }))}
                  />
                  Eventos aleatorios de ronda
                </label>
                <label className="text-xs text-white/60 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={soloConfig.partyRules.safeMessaging}
                    onChange={(event) => setSoloConfig((current) => ({ ...current, partyRules: { ...current.partyRules, safeMessaging: event.target.checked } }))}
                  />
                  Mensajes de consumo responsable
                </label>
              </div>
            )}
            {soloBlockedByAdult && (
              <p className="text-xs text-amber-200">Activa +18 en tu perfil para iniciar este modo.</p>
            )}
          </div>

          <button
            onClick={onSolo}
            disabled={startingSolo || soloBlockedByAdult}
            className="relative group w-full overflow-hidden rounded-2xl bg-gradient-to-r from-surface-dark to-surface-dark p-[1px] border border-white/5 hover:border-primary/50 transition-colors active:scale-95 disabled:opacity-60"
          >
            <div className="relative flex h-16 w-full items-center justify-between px-6 bg-surface-dark/80 backdrop-blur-md rounded-2xl">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-purple-200">
                  <span className="material-symbols-outlined">smart_toy</span>
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-lg font-bold text-white tracking-wide">Solo con bots</span>
                  <span className="text-xs text-white/40 font-medium">
                    {startingSolo ? 'Iniciando partida...' : 'Modo aislado, robusto y configurable'}
                  </span>
                </div>
              </div>
              <span className="material-symbols-outlined text-white/30 group-hover:text-white transition-colors">chevron_right</span>
            </div>
          </button>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 pt-2">
        <div className="glass-panel mx-auto flex h-16 w-full max-w-md items-center justify-between rounded-full px-1 shadow-2xl">
          <button className="flex flex-1 flex-col items-center justify-center gap-0.5" type="button">
            <div className="flex h-10 w-16 items-center justify-center rounded-full bg-primary/20 text-primary transition-all">
              <span className="material-symbols-outlined fill-current" style={{ fontVariationSettings: "'FILL' 1, 'wght' 400" }}>home</span>
            </div>
          </button>
          <button onClick={onOpenRooms} className="flex flex-1 flex-col items-center justify-center gap-0.5" type="button">
            <div className="flex h-10 w-16 items-center justify-center rounded-full text-purple-200/60 hover:text-white transition-all hover:bg-white/5">
              <span className="material-symbols-outlined">group</span>
            </div>
          </button>
          <div className="relative -top-6">
            <button onClick={onJoin} className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-gold to-yellow-600 text-black shadow-lg shadow-gold/20 transition-transform active:scale-95 border-4 border-background-dark">
              <span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
            </button>
          </div>
          <button onClick={onOpenProfile} className="flex flex-1 flex-col items-center justify-center gap-0.5" type="button">
            <div className="flex h-10 w-16 items-center justify-center rounded-full text-purple-200/60 hover:text-white transition-all hover:bg-white/5">
              <span className="material-symbols-outlined">person</span>
            </div>
          </button>
          <button onClick={onLogout} className="flex flex-1 flex-col items-center justify-center gap-0.5" type="button">
            <div className="flex h-10 w-16 items-center justify-center rounded-full text-purple-200/60 hover:text-white transition-all hover:bg-white/5">
              <span className="material-symbols-outlined">logout</span>
            </div>
          </button>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [landingView, setLandingView] = useState('home');
  const [entryMode, setEntryMode] = useState(null);
  const [resumeRoomCode, setResumeRoomCode] = useState('');
  const [name, setName] = useState(localStorage.getItem('dixit:name') || '');
  const [room, setRoom] = useState(localStorage.getItem('dixit:room') || '');
  const [selected, setSelected] = useState(null);
  const [clue, setClue] = useState('');
  const [startingSolo, setStartingSolo] = useState(false);
  const [musicOn, setMusicOn] = useState(() => {
    const saved = localStorage.getItem('dixit:music-on');
    return saved === null ? true : saved === '1';
  });
  const [sfxOn, setSfxOn] = useState(() => {
    const saved = localStorage.getItem('dixit:sfx-on');
    return saved === null ? true : saved === '1';
  });
  const [musicVolume, setMusicVolume] = useState(() => {
    const saved = Number(localStorage.getItem('dixit:music-volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.35;
  });
  const [sfxVolume, setSfxVolume] = useState(() => {
    const saved = Number(localStorage.getItem('dixit:sfx-volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.7;
  });
  const [audioNeedsInteraction, setAudioNeedsInteraction] = useState(false);
  const [audioStatus, setAudioStatus] = useState('idle');
  const [audioError, setAudioError] = useState('');
  const [showProgress, setShowProgress] = useState(false);
  const [progressData, setProgressData] = useState([]);
  const [activeRooms, setActiveRooms] = useState([]);
  const [profileData, setProfileData] = useState(null);
  const [profileDraft, setProfileDraft] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSavedAt, setProfileSavedAt] = useState('');
  const [soloConfig, setSoloConfig] = useState({
    mode: 'classic',
    difficulty: 'normal',
    drinkLevel: 'light',
    partyRules: {
      randomEvents: true,
      safeMessaging: true,
    },
  });
  const { state, setState, send, connected, serverError, setServerError } = useWs(Boolean(user));
  const audioRef = useRef(null);
  const tickAudioCtxRef = useRef(null);
  const tickIntervalRef = useRef(null);
  const tickLastSecondRef = useRef(null);
  const resumedRef = useRef(false);
  const lastRoomCodeRef = useRef('');
  const phaseRef = useRef('');
  const gameOverPlayedRef = useRef(false);
  const audioPrefsHydratedRef = useRef(false);

  const playTick = useCallback(() => {
    if (!sfxOn || audioNeedsInteraction) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!tickAudioCtxRef.current) {
        tickAudioCtxRef.current = new Ctx();
      }
      const ctx = tickAudioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 980;
      gain.gain.value = 0.02 + sfxVolume * 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime;
      osc.start(t0);
      osc.stop(t0 + 0.05);
    } catch {
      // ignore audio errors
    }
  }, [sfxOn, audioNeedsInteraction, sfxVolume]);

  const playSfx = useCallback((kind = 'click') => {
    if (!sfxOn || audioNeedsInteraction) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!tickAudioCtxRef.current) {
        tickAudioCtxRef.current = new Ctx();
      }
      const ctx = tickAudioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      const patterns = {
        click: [[880, 0.03, 0], [660, 0.02, 0.03]],
        transition: [[420, 0.05, 0], [560, 0.05, 0.05], [720, 0.06, 0.1]],
        vote: [[520, 0.05, 0], [620, 0.04, 0.05]],
        reveal: [[420, 0.06, 0], [640, 0.07, 0.06], [840, 0.07, 0.12]],
        success: [[500, 0.07, 0], [750, 0.08, 0.08], [1000, 0.09, 0.16]],
        error: [[360, 0.08, 0], [250, 0.1, 0.08]],
      };
      const selected = patterns[kind] || patterns.click;
      selected.forEach(([frequency, duration, offset]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.01 + sfxVolume * 0.045, now + offset + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + duration + 0.01);
      });
    } catch {
      // ignore synthesized sfx failures
    }
  }, [sfxOn, audioNeedsInteraction, sfxVolume]);

  const stopTicking = useCallback(() => {
    if (tickIntervalRef.current) {
      window.clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  }, []);

  const attemptPlayMusic = useCallback(async (source = 'auto') => {
    const audio = audioRef.current;
    if (!audio) return false;
    if (!musicOn) {
      audio.pause();
      setAudioStatus('disabled');
      setAudioNeedsInteraction(false);
      return false;
    }
    try {
      audio.volume = musicVolume;
      audio.loop = true;
      await audio.play();
      setAudioStatus('playing');
      setAudioNeedsInteraction(false);
      setAudioError('');
      debugLog('audio:playing', { source });
      return true;
    } catch (error) {
      const blocked = error?.name === 'NotAllowedError' || error?.name === 'AbortError';
      setAudioStatus(blocked ? 'blocked' : 'error');
      setAudioNeedsInteraction(blocked);
      setAudioError(error?.message || 'No se pudo reproducir la música.');
      debugLog('audio:play_failed', {
        source,
        name: error?.name,
        message: error?.message,
      });
      return false;
    }
  }, [musicOn, musicVolume]);

  const requestAudioUnlock = useCallback(async () => {
    if (!musicOn) {
      setMusicOn(true);
      return;
    }
    const ctx = tickAudioCtxRef.current;
    if (ctx?.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // ignore resume errors
      }
    }
    await attemptPlayMusic('user_gesture');
    playSfx('click');
  }, [attemptPlayMusic, musicOn, playSfx]);

  useEffect(() => {
    let active = true;
    api('/api/auth/me')
      .then((payload) => {
        if (!active) return;
        if (payload.authenticated && payload.user) {
          setUser(payload.user);
          setResumeRoomCode(payload.activeRoom?.code || '');
          if (!name) {
            setName(payload.user.displayName || payload.user.username || '');
          }
          if (payload.profile) {
            hydrateProfilePreferences({
              user: payload.user,
              profile: payload.profile,
              stats: {},
              history: [],
            });
          }
        }
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem('dixit:name', name);
  }, [name]);
  useEffect(() => {
    localStorage.setItem('dixit:room', room);
  }, [room]);
  useEffect(() => {
    localStorage.setItem('dixit:music-on', musicOn ? '1' : '0');
  }, [musicOn]);
  useEffect(() => {
    localStorage.setItem('dixit:sfx-on', sfxOn ? '1' : '0');
  }, [sfxOn]);
  useEffect(() => {
    localStorage.setItem('dixit:music-volume', String(musicVolume));
  }, [musicVolume]);
  useEffect(() => {
    localStorage.setItem('dixit:sfx-volume', String(sfxVolume));
  }, [sfxVolume]);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = musicVolume;
    }
  }, [musicVolume]);
  useEffect(() => {
    setProfileDraft((current) => {
      if (!current) return current;
      if (
        current.musicOn === musicOn &&
        current.sfxOn === sfxOn &&
        current.musicVolume === musicVolume &&
        current.sfxVolume === sfxVolume
      ) {
        return current;
      }
      return {
        ...current,
        musicOn,
        sfxOn,
        musicVolume,
        sfxVolume,
      };
    });
  }, [musicOn, musicVolume, sfxOn, sfxVolume]);
  useEffect(() => {
    if (!user || !profileDraft) return;
    if (!audioPrefsHydratedRef.current) {
      audioPrefsHydratedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      api('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          musicOn,
          sfxOn,
          musicVolume,
          sfxVolume,
        }),
      })
        .then((payload) => {
          if (!payload?.ok) return;
          setProfileData(payload);
          setProfileDraft((current) => (current ? {
            ...current,
            musicOn: payload.profile.musicOn,
            sfxOn: payload.profile.sfxOn,
            musicVolume: payload.profile.musicVolume,
            sfxVolume: payload.profile.sfxVolume,
          } : current));
        })
        .catch(() => {
          // ignore silent preference sync errors
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [musicOn, musicVolume, profileDraft, sfxOn, sfxVolume, user]);

  const fetchActiveRooms = useCallback(async () => {
    if (!user) return;
    try {
      const payload = await api('/api/rooms');
      setActiveRooms(payload.rooms || []);
    } catch (error) {
      console.error(error);
    }
  }, [user]);

  const hydrateProfilePreferences = useCallback((payload) => {
    if (!payload?.profile) return;
    setProfileData(payload);
    setProfileDraft({
      nickname: payload.profile.nickname || payload.user?.displayName || '',
      avatarSeed: payload.profile.avatarSeed || '',
      preferredMode: payload.profile.preferredMode || 'classic',
      preferredBotDifficulty: payload.profile.preferredBotDifficulty || 'normal',
      musicOn: payload.profile.musicOn !== false,
      sfxOn: payload.profile.sfxOn !== false,
      musicVolume: Number(payload.profile.musicVolume ?? 0.35),
      sfxVolume: Number(payload.profile.sfxVolume ?? 0.7),
      adultModeOptIn: Boolean(payload.profile.adultModeOptIn),
    });
    setMusicOn(payload.profile.musicOn !== false);
    setSfxOn(payload.profile.sfxOn !== false);
    setMusicVolume(Number(payload.profile.musicVolume ?? 0.35));
    setSfxVolume(Number(payload.profile.sfxVolume ?? 0.7));
    setSoloConfig((current) => ({
      ...current,
      mode: payload.profile.preferredMode || 'classic',
      difficulty: payload.profile.preferredBotDifficulty || current.difficulty,
    }));
  }, []);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    try {
      const payload = await api('/api/profile');
      hydrateProfilePreferences(payload);
      setProfileError('');
    } catch (error) {
      setProfileError(error?.message || 'No se pudo cargar el perfil.');
    }
  }, [hydrateProfilePreferences, user]);

  const saveProfile = useCallback(async () => {
    if (!profileDraft) return;
    setProfileSaving(true);
    setProfileError('');
    try {
      const payload = await api('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(profileDraft),
      });
      hydrateProfilePreferences(payload);
      setUser((current) => (current ? { ...current, displayName: payload?.user?.displayName || profileDraft.nickname } : current));
      setName(payload?.profile?.nickname || name);
      setProfileSavedAt(payload?.savedAt || new Date().toISOString());
    } catch (error) {
      setProfileError(error?.message || 'No se pudo guardar el perfil.');
    } finally {
      setProfileSaving(false);
    }
  }, [hydrateProfilePreferences, name, profileDraft]);

  const join = () => {
    playSfx('click');
    setEntryMode('online');
    setStartingSolo(false);
    setServerError('');
    resumedRef.current = true;
    const payload = { type: 'join', name: name || user?.displayName || 'Jugador' };
    if (room) payload.roomCode = room;
    send(payload);
  };

  const startSolo = useCallback(() => {
    if (!user) return;
    if (soloConfig.mode === 'party' && !(profileDraft?.adultModeOptIn || profileData?.profile?.adultModeOptIn)) {
      setServerError('Activa y confirma el modo +18 en tu perfil para iniciar esta variante.');
      return;
    }
    playSfx('transition');
    setEntryMode('solo');
    setStartingSolo(true);
    setServerError('');
    setResumeRoomCode('');
    setRoom('');
    setShowProgress(false);
    setProgressData([]);
    resumedRef.current = true;
    debugLog('solo:start_requested');
    send({
      type: 'start_solo',
      name: name || user.displayName || user.username || 'Jugador',
      mode: soloConfig.mode,
      difficulty: soloConfig.difficulty,
      drinkLevel: soloConfig.drinkLevel,
      partyRules: soloConfig.partyRules,
    });
  }, [name, playSfx, profileData?.profile?.adultModeOptIn, profileDraft?.adultModeOptIn, send, setServerError, soloConfig, user]);

  const handleResume = (roomCode) => {
    playSfx('click');
    setEntryMode('online');
    setStartingSolo(false);
    setServerError('');
    resumedRef.current = true;
    const formatted = formatRoomCode(roomCode || room);
    if (formatted) {
      setRoom(formatted);
      setResumeRoomCode(formatted);
    }
    send({ type: 'join', name: name || user?.displayName || 'Jugador', roomCode: formatted });
  };

  const openRoomsView = useCallback(() => {
    playSfx('click');
    setLandingView('rooms');
    fetchActiveRooms();
  }, [fetchActiveRooms, playSfx]);

  const openProfileView = useCallback(() => {
    playSfx('click');
    setLandingView('profile');
    fetchProfile();
  }, [fetchProfile, playSfx]);

  const joinFromActiveRoom = useCallback((roomCode) => {
    const formatted = formatRoomCode(roomCode);
    if (!formatted) return;
    setRoom(formatted);
    setLandingView('home');
    handleResume(formatted);
  }, [handleResume]);

  const handleLogout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      setState(null);
      setUser(null);
      setLandingView('home');
      setEntryMode(null);
      setStartingSolo(false);
      setResumeRoomCode('');
      setServerError('');
      setProfileData(null);
      setProfileDraft(null);
      setProfileError('');
      setProfileSavedAt('');
      audioPrefsHydratedRef.current = false;
      resumedRef.current = false;
    }
  };

  const leave = () => {
    playSfx('click');
    debugLog('room:leave', { roomCode: state?.roomCode, entryMode });
    send({ type: 'leave' });
    setState(null);
    setShowProgress(false);
    setProgressData([]);
    setStartingSolo(false);
    setLandingView('home');
    if (entryMode === 'solo') {
      setRoom('');
      setResumeRoomCode('');
    }
    setEntryMode(null);
    setServerError('');
  };

  const toggleMusic = useCallback(() => {
    playSfx('click');
    setMusicOn((prev) => !prev);
  }, [playSfx]);

  useEffect(() => {
    if (!connected) {
      resumedRef.current = false;
    }
  }, [connected]);

  useEffect(() => {
    if (!connected || !user) return;
    if (state?.roomCode) return;
    if (resumedRef.current) return;
    if (startingSolo) return;
    const targetCode = resumeRoomCode;
    if (!targetCode) return;
    resumedRef.current = true;
    debugLog('resume:auto_join', { targetCode });
    send({ type: 'join', name: name || user.displayName || user.username, roomCode: targetCode });
  }, [connected, user, state?.roomCode, resumeRoomCode, name, send, startingSolo]);

  useEffect(() => {
    if (!user) return;
    fetchActiveRooms();
    fetchProfile();
  }, [fetchActiveRooms, fetchProfile, user]);

  useEffect(() => {
    const handler = () => setShowProgress(true);
    window.addEventListener('dixit:progress', handler);
    return () => window.removeEventListener('dixit:progress', handler);
  }, []);

  useEffect(() => {
    if (!user || landingView !== 'rooms' || state?.phase) return;
    const timer = window.setInterval(() => {
      fetchActiveRooms();
    }, 7000);
    return () => window.clearInterval(timer);
  }, [fetchActiveRooms, landingView, state?.phase, user]);

  useEffect(() => {
    if (!state?.players) return;
    setProgressData(state.players);
  }, [state?.players]);

  useEffect(() => {
    const nextPhase = state?.phase || '';
    const prevPhase = phaseRef.current;
    if (nextPhase && prevPhase && nextPhase !== prevPhase) {
      if (nextPhase === 'vote') playSfx('vote');
      else if (nextPhase === 'reveal') playSfx('reveal');
      else playSfx('transition');
    }
    phaseRef.current = nextPhase;
  }, [playSfx, state?.phase]);

  useEffect(() => {
    const gameOver = Boolean(state?.summary?.gameOver || state?.finished);
    if (!gameOver) {
      gameOverPlayedRef.current = false;
      return;
    }
    if (gameOverPlayedRef.current) return;
    gameOverPlayedRef.current = true;
    playSfx('success');
  }, [playSfx, state?.finished, state?.summary?.gameOver]);

  useEffect(() => {
    if (state?.phase !== phases.CLUE) {
      setSelected(null);
      setClue('');
    }
  }, [state?.phase]);

  useEffect(() => {
    if (!serverError || !startingSolo) return;
    setStartingSolo(false);
  }, [serverError, startingSolo]);

  useEffect(() => {
    if (!serverError) return;
    playSfx('error');
  }, [playSfx, serverError]);

  useEffect(() => {
    if (startingSolo && state?.phase && state.phase !== phases.LOBBY) {
      setStartingSolo(false);
    }
  }, [startingSolo, state?.phase]);

  useEffect(() => {
    const nextRoomCode = state?.roomCode || '';
    if (nextRoomCode === lastRoomCodeRef.current) return;
    const previousRoomCode = lastRoomCodeRef.current;
    lastRoomCodeRef.current = nextRoomCode;
    debugLog('room:changed', {
      from: previousRoomCode || null,
      to: nextRoomCode || null,
      mode: entryMode,
    });
    setSelected(null);
    setClue('');
    setShowProgress(false);
    if (nextRoomCode) {
      setResumeRoomCode(nextRoomCode);
      if (entryMode !== 'solo') {
        setRoom(nextRoomCode);
      }
    } else if (entryMode === 'solo') {
      setRoom('');
    }
  }, [state?.roomCode, entryMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!musicOn) {
      audio.pause();
      setAudioStatus('disabled');
      setAudioNeedsInteraction(false);
      return;
    }
    void attemptPlayMusic('music_enabled');
  }, [musicOn, user, attemptPlayMusic]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onPlaying = () => {
      setAudioStatus('playing');
      setAudioNeedsInteraction(false);
    };
    const onPause = () => {
      if (!musicOn) {
        setAudioStatus('disabled');
        return;
      }
      setAudioStatus((current) => (current === 'blocked' || current === 'error' ? current : 'idle'));
    };
    const onError = () => {
      setAudioStatus('error');
      setAudioNeedsInteraction(false);
      setAudioError('No se pudo cargar la música.');
    };
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
    };
  }, [musicOn]);

  useEffect(() => {
    if (!audioNeedsInteraction || !musicOn) return;
    const unlock = () => {
      void requestAudioUnlock();
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, [audioNeedsInteraction, musicOn, requestAudioUnlock]);

  useEffect(() => {
    const shouldTick =
      sfxOn &&
      !audioNeedsInteraction &&
      state?.timer?.active &&
      ['clue', 'submit', 'vote'].includes(state?.phase) &&
      Number(state?.timer?.deadlineAt) > 0;
    if (!shouldTick) {
      stopTicking();
      tickLastSecondRef.current = null;
      return;
    }
    const deadlineAt = Number(state?.timer?.deadlineAt);
    const maybeTick = () => {
      const remainingMs = Math.max(0, deadlineAt - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      if (remainingSeconds <= 0) return;
      if (remainingSeconds > 10) {
        tickLastSecondRef.current = null;
        return;
      }
      if (tickLastSecondRef.current === remainingSeconds) return;
      tickLastSecondRef.current = remainingSeconds;
      playTick();
    };
    maybeTick();
    tickIntervalRef.current = window.setInterval(maybeTick, 200);
    return () => {
      stopTicking();
      tickLastSecondRef.current = null;
    };
  }, [sfxOn, audioNeedsInteraction, state?.phase, state?.timer?.active, state?.timer?.deadlineAt, playTick, stopTicking]);

  useEffect(() => () => {
    stopTicking();
    if (tickAudioCtxRef.current) {
      tickAudioCtxRef.current.close().catch(() => {});
      tickAudioCtxRef.current = null;
    }
  }, [stopTicking]);

  const musicStatusLabel = !musicOn
    ? 'OFF'
    : audioStatus === 'playing'
      ? 'ON'
      : audioStatus === 'blocked'
        ? 'BLOQ'
        : audioStatus === 'error'
          ? 'ERR'
          : '...';
  const musicActionLabel = !musicOn
    ? 'Música OFF'
    : audioStatus === 'playing'
      ? 'Música ON'
      : audioStatus === 'blocked'
        ? 'Música bloqueada'
        : audioStatus === 'error'
          ? 'Música con error'
          : 'Música iniciando';

  const renderPhase = (extra = {}) => {
    if (!state || !state.phase) return null;
    switch (state.phase) {
      case phases.LOBBY:
        return (
          <Lobby
            state={state}
            send={send}
            onLeave={extra.onLeave}
            onShowProgress={extra.onShowProgress}
            toggleMusic={extra.toggleMusic}
            musicOn={extra.musicOn}
          />
        );
      case phases.CLUE:
        if (state.you?.isStoryteller) {
          return <Clue state={state} send={send} selected={selected} setSelected={setSelected} clue={clue} setClue={setClue} />;
        }
        return <Submit state={{ ...state, you: { ...state.you, submitted: true } }} send={send} />;
      case phases.SUBMIT:
        if (state.you?.isStoryteller) {
          return <Submit state={{ ...state, you: { ...state.you, submitted: true }, hand: [] }} send={send} />;
        }
        return <Submit state={state} send={send} />;
      case phases.VOTE:
        if (state.you?.isStoryteller) {
          return <Submit state={{ ...state, you: { ...state.you, submitted: true }, hand: [] }} send={send} />;
        }
        return <Vote state={state} send={send} />;
      case phases.REVEAL:
      default:
        return <Score state={state} send={send} />;
    }
  };

  if (authLoading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-surreal text-white">
        <div className="loading-orb" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative flex min-h-screen flex-col bg-surreal overflow-hidden">
        <AuthGate onAuthenticated={(me) => {
          playSfx('success');
          setUser(me);
          setLandingView('home');
          setEntryMode(null);
          setServerError('');
          resumedRef.current = false;
          setName((current) => current || me.displayName || me.username || '');
          api('/api/auth/me')
            .then((payload) => {
              setResumeRoomCode(payload?.activeRoom?.code || '');
              if (payload?.profile) {
                hydrateProfilePreferences({
                  user: payload.user || me,
                  profile: payload.profile,
                  stats: {},
                  history: [],
                });
              }
            })
            .catch(() => {});
        }} />
      </div>
    );
  }

  const isLanding = !state || !state.phase;
  const adultModeEnabled = Boolean(profileDraft?.adultModeOptIn || profileData?.profile?.adultModeOptIn);

  return (
    <div className="relative flex min-h-screen flex-col bg-surreal overflow-hidden">
      <div className="fixed top-[-100px] right-[-100px] w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none z-0" />
      <div className="fixed bottom-[-50px] left-[-50px] w-64 h-64 bg-accent-pink/10 rounded-full blur-[80px] pointer-events-none z-0" />
      <audio ref={audioRef} preload="auto" src="/audio/ambient-loop.wav" />
      {audioNeedsInteraction && musicOn && (
        <button
          type="button"
          onClick={requestAudioUnlock}
          className="fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-full border border-white/20 bg-black/50 px-4 py-2 text-xs text-white"
        >
          Toca para activar audio
        </button>
      )}
      {serverError && (
        <button
          type="button"
          onClick={() => setServerError('')}
          className="fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-xl border border-rose-300/40 bg-rose-500/20 px-4 py-2 text-xs text-rose-50"
        >
          {serverError}
        </button>
      )}
      {audioStatus === 'error' && audioError && (
        <div className="fixed left-1/2 top-28 z-40 -translate-x-1/2 rounded-xl border border-amber-300/40 bg-amber-500/20 px-3 py-2 text-xs text-amber-50">
          Audio: {audioError}
        </div>
      )}
      {!connected && !isLanding && (
        <div className="fixed right-4 top-4 z-40 rounded-full border border-amber-300/40 bg-amber-500/20 px-3 py-1 text-xs text-amber-50">
          Reconectando...
        </div>
      )}
      {isLanding ? (
        landingView === 'rooms' ? (
          <ActiveRoomsView
            activeRooms={activeRooms}
            fetchActiveRooms={fetchActiveRooms}
            onBack={() => setLandingView('home')}
            onJoinRoom={joinFromActiveRoom}
            onResumeRoom={joinFromActiveRoom}
            send={send}
          />
        ) : landingView === 'profile' ? (
          <ProfileView
            profileData={profileData}
            profileDraft={profileDraft}
            setProfileDraft={setProfileDraft}
            profileSaving={profileSaving}
            profileError={profileError}
            profileSavedAt={profileSavedAt}
            onSave={saveProfile}
            onBack={() => setLandingView('home')}
          />
        ) : (
          <Landing
            onJoin={join}
            onSolo={startSolo}
            onOpenRooms={openRoomsView}
            onOpenProfile={openProfileView}
            onLogout={handleLogout}
            name={name}
            setName={setName}
            room={room}
            setRoom={setRoom}
            activeRooms={activeRooms}
            toggleMusic={toggleMusic}
            musicOn={musicOn}
            musicStatusLabel={musicStatusLabel}
            startingSolo={startingSolo}
            soloConfig={soloConfig}
            setSoloConfig={setSoloConfig}
            adultModeEnabled={adultModeEnabled}
          />
        )
      ) : (
        renderPhase({ onLeave: leave, onShowProgress: () => setShowProgress(true), toggleMusic, musicOn })
      )}
      {!isLanding && (
        <GameActions
          onLeave={leave}
          onProgress={() => setShowProgress(true)}
          onToggleMusic={toggleMusic}
          musicLabel={musicActionLabel}
        />
      )}
      {showProgress && (
        <ProgressOverlay
          players={progressData}
          round={state?.round || 1}
          onClose={() => setShowProgress(false)}
        />
      )}
    </div>
  );
}
