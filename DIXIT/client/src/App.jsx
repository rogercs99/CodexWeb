import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
const MAX_CLUE_AUDIO_BYTES = 650 * 1024;
const AUDIO_FILE_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm', 'flac'];
const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/flac',
  'audio/opus',
];
const AUDIO_UPLOAD_ACCEPT = [...AUDIO_MIME_TYPES, ...AUDIO_FILE_EXTENSIONS.map((extension) => `.${extension}`)].join(',');
const AUDIO_PICKER_TYPES = [
  {
    description: 'Archivos de audio',
    accept: AUDIO_MIME_TYPES.reduce((acc, mimeType) => {
      acc[mimeType] = AUDIO_FILE_EXTENSIONS.map((extension) => `.${extension}`);
      return acc;
    }, {}),
  },
];

const formatTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};
function useWs() {
  const [state, setState] = useState(null);
  const [socket, setSocket] = useState(null);
  const queuedMessagesRef = React.useRef([]);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    setSocket(ws);
    ws.onopen = () => {
      while (queuedMessagesRef.current.length > 0) {
        const payload = queuedMessagesRef.current.shift();
        ws.send(JSON.stringify(payload));
      }
    };
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'state') setState(data);
      if (data.type === 'joined') setState((s) => s || { roomCode: data.roomCode });
      if (data.type === 'ended') {
        setState(null);
        alert('La partida ha sido eliminada por el anfitrión.');
      }
    };
    ws.onclose = () => {
      setSocket(null);
      setState(null);
    };
    return () => ws.close();
  }, []);

  const send = useCallback((payload) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return;
    }
    queuedMessagesRef.current.push(payload);
  }, [socket]);

  return { state, send, connected: !!socket && socket.readyState === WebSocket.OPEN };
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

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result?.toString() || '');
  reader.onerror = () => reject(new Error('No se pudo leer el audio.'));
  reader.readAsDataURL(file);
});

const inferAudioExtension = (mimeType = '') => {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
};

const hasAudioExtension = (fileName = '') => {
  const normalizedName = fileName.toLowerCase();
  return AUDIO_FILE_EXTENSIONS.some((extension) => normalizedName.endsWith(`.${extension}`));
};

const isLikelyAudioFile = (file) => {
  if (!file) return false;
  const mimeType = (file.type || '').toLowerCase();
  if (mimeType.startsWith('audio/')) return true;
  if (mimeType.startsWith('video/')) return false;
  return hasAudioExtension(file.name || '');
};

function ClueAudioPlayer({ clueAudio, title = 'Pista en audio' }) {
  if (!clueAudio) return null;
  return (
    <div className="mt-2 rounded-xl border border-white/15 bg-white/5 p-2.5">
      <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-white/70">
        <span className="material-symbols-outlined text-[16px]">graphic_eq</span>
        {title}
      </p>
      <audio controls preload="metadata" src={clueAudio} className="w-full" />
    </div>
  );
}

function GameActions({ onLeave, onToggleMusic, musicOn }) {
  return (
    <div className="fixed left-0 right-0 top-0 z-40 pointer-events-none px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
      <div className="mx-auto flex w-full max-w-md items-center justify-end gap-2">
        <button
          onClick={onToggleMusic}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/20 transition pointer-events-auto"
          title={musicOn ? 'Silenciar música' : 'Activar música'}
          aria-label={musicOn ? 'Silenciar música' : 'Activar música'}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1, 'wght' 500" }}>
            {musicOn ? 'volume_up' : 'volume_off'}
          </span>
        </button>
        <button
          onClick={onLeave}
          className="flex h-10 items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 text-white font-semibold hover:bg-white/20 transition pointer-events-auto"
          title="Salir de la partida"
          aria-label="Salir de la partida"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>logout</span>
          <span className="text-sm">Salir</span>
        </button>
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

function Lobby({ state, send, onLeave }) {
  const { roomCode, players = [], hostId, you, canStart } = state;
  const readyCount = players.filter((p) => p.ready).length;
  const pct = players.length ? Math.round((readyCount / players.length) * 100) : 0;
  const isHost = you?.isHost;
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
          <button
            onClick={() => send({ type: 'end_room', password: 'hola123' })}
            className="h-9 px-3 rounded-full bg-white/10 border border-white/20 text-white text-[11px] font-semibold hover:bg-white/20 transition whitespace-nowrap"
            title="Eliminar sala (contraseña hola123)"
          >
            Eliminar
          </button>
        </div>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar pb-32 px-4">
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
                  onChange={(e) => send({ type: 'set_mode', mode: e.target.value, drinkLevel: state.drinkLevel })}
                  className="h-11 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm"
                >
                  <option value="classic">Clásico</option>
                  <option value="party">Modo +18 (beber)</option>
                </select>
                {state.mode === 'party' && (
                  <select
                    value={state.drinkLevel || 'light'}
                    onChange={(e) => send({ type: 'set_mode', mode: 'party', drinkLevel: e.target.value })}
                    className="h-11 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-sm"
                  >
                    <option value="light">Beber poco</option>
                    <option value="medium">Beber medio</option>
                    <option value="heavy">Beber mucho</option>
                  </select>
                )}
              </div>
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
              <button onClick={() => send({ type: 'start_with_bots', difficulty: botDifficulty, mode: state.mode, drinkLevel: state.drinkLevel })} className="h-12 px-4 rounded-xl bg-gradient-to-r from-primary to-accent-pink text-white font-semibold shadow-lg shadow-primary/30 hover:brightness-110 transition min-w-[120px]">
                Empezar
              </button>
            </div>
          )}
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

function Clue({ state, send, selected, setSelected, clue, setClue, clueAudio, setClueAudio }) {
  const { hand = [], turnSeconds = 60, phaseStartedAt, storytellerId, players = [] } = state;
  const timeLeft = Math.max(0, turnSeconds * 1000 - (Date.now() - (phaseStartedAt || Date.now())));
  const narratorName = players.find((p) => p.id === storytellerId)?.name || 'Narrador';
  const canSendAudio = players.length >= 2 && players.every((p) => !p.isBot);
  const hasAudio = Boolean(clueAudio?.dataUrl);
  const ready = selected && (clue.trim().length > 0 || (canSendAudio && hasAudio));
  const fileInputRef = React.useRef(null);
  const recorderRef = React.useRef(null);
  const recorderStreamRef = React.useRef(null);
  const recorderChunksRef = React.useRef([]);
  const [audioError, setAudioError] = React.useState('');
  const [isRecording, setIsRecording] = React.useState(false);
  const canRecordAudio = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const stopRecorderStream = useCallback(() => {
    const stream = recorderStreamRef.current;
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
  }, []);

  const handleRecordedBlob = useCallback(async (blob) => {
    if (!blob || blob.size === 0) {
      setAudioError('No se pudo grabar el audio.');
      return;
    }
    if (blob.size > MAX_CLUE_AUDIO_BYTES) {
      setAudioError('Audio demasiado largo. Máximo aproximado: 30s.');
      return;
    }
    try {
      const extension = inferAudioExtension(blob.type);
      const recordedFile = new File([blob], `pista.${extension}`, { type: blob.type || 'audio/webm' });
      const dataUrl = await readFileAsDataUrl(recordedFile);
      if (!dataUrl.startsWith('data:audio/')) {
        setAudioError('Formato de audio no soportado.');
        return;
      }
      setClueAudio({
        dataUrl,
        name: recordedFile.name,
        size: recordedFile.size,
      });
      setAudioError('');
    } catch (error) {
      console.error(error);
      setAudioError('No se pudo procesar el audio grabado.');
    }
  }, [setClueAudio]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    stopRecorderStream();
    setIsRecording(false);
  }, [stopRecorderStream]);

  React.useEffect(() => {
    if (canSendAudio) return;
    if (isRecording) stopRecording();
    if (hasAudio) setClueAudio(null);
    setAudioError('');
  }, [canSendAudio, hasAudio, isRecording, setClueAudio, stopRecording]);

  React.useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorderRef.current = null;
    }
    stopRecorderStream();
  }, [stopRecorderStream]);

  const startRecording = async () => {
    if (!canRecordAudio) {
      setAudioError('Tu navegador no soporta grabación directa.');
      return;
    }
    try {
      setAudioError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      recorderStreamRef.current = stream;
      recorderChunksRef.current = [];
      const preferredMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      const selectedMimeType = preferredMimeTypes.find((mimeType) => window.MediaRecorder.isTypeSupported?.(mimeType));
      const recorder = selectedMimeType ? new window.MediaRecorder(stream, { mimeType: selectedMimeType }) : new window.MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recorderChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setAudioError('No se pudo grabar el audio.');
        stopRecorderStream();
        setIsRecording(false);
      };
      recorder.onstop = () => {
        const chunks = recorderChunksRef.current;
        recorderChunksRef.current = [];
        stopRecorderStream();
        setIsRecording(false);
        if (!chunks.length) return;
        const sourceMimeType = recorder.mimeType || chunks[0].type || '';
        const normalizedMimeType = sourceMimeType.startsWith('video/')
          ? sourceMimeType.replace('video/', 'audio/')
          : sourceMimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: normalizedMimeType });
        void handleRecordedBlob(blob);
      };
      recorder.start(250);
      setIsRecording(true);
    } catch (error) {
      console.error(error);
      setAudioError('No se pudo acceder al micrófono. Revisa permisos.');
      stopRecorderStream();
      setIsRecording(false);
    }
  };

  const processAudioFile = useCallback(async (file) => {
    if (!file) return;
    if (!isLikelyAudioFile(file)) {
      setAudioError('El archivo debe ser de audio.');
      return;
    }
    if (file.size > MAX_CLUE_AUDIO_BYTES) {
      setAudioError('Audio demasiado largo. Máximo aproximado: 30s.');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl.startsWith('data:audio/')) {
        setAudioError('Formato de audio no soportado.');
        return;
      }
      setClueAudio({
        dataUrl,
        name: file.name?.slice(0, 40) || 'audio',
        size: file.size,
      });
      setAudioError('');
    } catch (error) {
      console.error(error);
      setAudioError('No se pudo cargar el audio.');
    }
  }, [setClueAudio]);

  const handleAudioFile = async (event) => {
    if (isRecording) stopRecording();
    const file = event.target.files?.[0];
    event.target.value = '';
    await processAudioFile(file);
  };

  const handlePickAudio = async () => {
    if (isRecording) stopRecording();
    if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: true,
          types: AUDIO_PICKER_TYPES,
        });
        const file = await fileHandle.getFile();
        await processAudioFile(file);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error(error);
      }
    }
    fileInputRef.current?.click();
  };

  const handleSubmit = () => {
    send({
      type: 'submit_clue',
      card: selected,
      clue: clue.trim(),
      clueAudio: canSendAudio && clueAudio?.dataUrl ? clueAudio.dataUrl : '',
    });
  };

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
          <label className="text-sm text-white/70">Tu pista (texto y/o audio)</label>
          <div className="mt-2 flex gap-3 items-center">
            <input id="clue-input" value={clue} onChange={(e) => setClue(e.target.value)} type="text" maxLength={80} className="flex-1 rounded-xl bg-white/10 border border-white/10 focus:border-primary focus:ring-primary text-white placeholder:text-white/40 px-3 py-3" placeholder="Un sueño lúcido" />
            <button disabled={!ready} onClick={handleSubmit} className="h-12 px-4 rounded-xl bg-gradient-to-r from-primary to-accent-pink text-white font-semibold shadow-lg shadow-primary/30 hover:brightness-110 transition disabled:opacity-50">Enviar</button>
          </div>
          {canSendAudio ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-white/70">Audio de pista (solo partidas sin bots)</p>
                <div className="flex items-center gap-2">
                  {canRecordAudio && (
                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`h-8 px-3 rounded-lg border text-xs font-semibold text-white transition ${isRecording ? 'border-red-400/60 bg-red-500/20 hover:bg-red-500/30' : 'border-white/20 bg-white/10 hover:bg-white/20'}`}
                    >
                      {isRecording ? 'Detener' : 'Grabar audio'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePickAudio}
                    className="h-8 px-3 rounded-lg border border-white/20 bg-white/10 text-xs font-semibold text-white hover:bg-white/20 transition"
                  >
                    Subir audio
                  </button>
                </div>
              </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={AUDIO_UPLOAD_ACCEPT}
                  capture="microphone"
                  className="hidden"
                  onChange={handleAudioFile}
                />
              {isRecording && <p className="mt-2 text-xs text-red-200">Grabando... pulsa Detener para adjuntar el audio.</p>}
              {!hasAudio && !isRecording && <p className="mt-2 text-xs text-white/45">Puedes grabar con micrófono o subir un archivo corto.</p>}
              {hasAudio && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-white/70">Adjunto: {clueAudio.name}</p>
                  <audio controls preload="metadata" src={clueAudio.dataUrl} className="w-full" />
                  <button
                    type="button"
                    onClick={() => {
                      setClueAudio(null);
                      setAudioError('');
                    }}
                    className="text-xs text-red-300 hover:text-red-200 transition"
                  >
                    Quitar audio
                  </button>
                </div>
              )}
              {audioError && <p className="mt-2 text-xs text-red-300">{audioError}</p>}
            </div>
          ) : (
            <p className="mt-3 text-xs text-white/45">La pista por audio se activa cuando no hay bots en la sala.</p>
          )}
        </div>
      </main>
    </section>
  );
}

function Submit({ state, send }) {
  const { hand = [], clue, clueAudio, you, turnSeconds = 60, phaseStartedAt, storytellerId, players = [] } = state;
  const timeLeft = Math.max(0, turnSeconds * 1000 - (Date.now() - (phaseStartedAt || Date.now())));
  const narratorName = players.find((p) => p.id === storytellerId)?.name || 'Narrador';
  if (you?.submitted) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/70">
        <div className="text-center">
          <p className="text-lg font-semibold">Carta enviada</p>
          <p className="text-sm text-white/50">Espera a que todos elijan</p>
        </div>
      </div>
    );
  }
  return (
    <section className="relative z-10 flex-1 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 pt-12 pb-4 bg-background-dark/70 backdrop-blur-sm z-20 sticky top-0 border-b border-primary/10">
        <div className="flex flex-col items-start">
          <p className="text-xs uppercase text-primary font-semibold">El narrador dijo</p>
          <p className="text-base font-bold text-white">{clue}</p>
          <ClueAudioPlayer clueAudio={clueAudio} />
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
  const { board = [], clue, clueAudio, you, turnSeconds = 60, phaseStartedAt, storytellerId, players = [] } = state;
  const timeLeft = Math.max(0, turnSeconds * 1000 - (Date.now() - (phaseStartedAt || Date.now())));
  const narratorName = players.find((p) => p.id === storytellerId)?.name || 'Narrador';
  return (
    <section className="relative z-10 flex-1 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 pt-12 pb-4 bg-background-dark/70 backdrop-blur-sm z-20 sticky top-0 border-b border-primary/10">
        <div className="flex flex-col items-start">
          <p className="text-xs uppercase text-primary font-semibold">Vota la carta del narrador</p>
          <p className="text-base font-bold text-white">{clue}</p>
          <ClueAudioPlayer clueAudio={clueAudio} />
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
  const storytellerReason = summary?.clueReason || extractReason(summary?.clue);
  const storytellerAudio = summary?.clueAudio || state.clueAudio || '';
  const tags = summary?.tags;

  return (
    <section className="relative z-10 flex-1 flex flex-col overflow-hidden" id="screen-score">
      <header className="flex items-center justify-between px-4 pt-12 pb-4 bg-background-dark/70 backdrop-blur-sm z-20 sticky top-0 border-b border-primary/10">
        <div className="flex items-center gap-2 text-white/70">
          <span className="material-symbols-outlined">leaderboard</span>
          <span className="text-sm sm:text-base uppercase tracking-wide font-semibold">Resultados · Ronda {summary?.round || state.round}</span>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button disabled={you?.id !== hostId} onClick={() => send({ type: 'next_round' })} className="h-9 sm:h-10 px-3 sm:px-4 rounded-full bg-gradient-to-r from-primary to-accent-pink text-white text-xs sm:text-sm font-semibold shadow-primary/30 shadow-lg disabled:opacity-60 whitespace-nowrap">
            {you?.id === hostId ? 'Siguiente ronda' : 'Esperando al host'}
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
          <p className="text-xl font-bold text-white mb-2">"{summary?.clue || ''}" — {playerById.get(summary?.storytellerId)?.name || ''}</p>
          <ClueAudioPlayer clueAudio={storytellerAudio} />
          {storytellerReason && <p className="text-white/70 text-sm mb-2">Motivo: {storytellerReason}</p>}
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

function Landing({ onJoin, onQuickCreate, onSolo, onResume, name, setName, room, setRoom, activeRooms, resumePlayerId, setResumePlayerId, fetchActiveRooms, toggleMusic, musicOn }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [activeView, setActiveView] = React.useState('home');
  const [selectedRooms, setSelectedRooms] = React.useState([]);

  const roomCodes = useMemo(() => (activeRooms || []).map((r) => r.code), [activeRooms]);
  const allRoomsSelected = roomCodes.length > 0 && roomCodes.every((code) => selectedRooms.includes(code));

  React.useEffect(() => {
    setSelectedRooms((prev) => prev.filter((code) => roomCodes.includes(code)));
  }, [roomCodes]);

  const handleRoomChange = (value, el) => {
    const formatted = formatRoomCode(value);
    if (el) el.value = formatted;
    setRoom(formatted);
  };

  const handleResumeClick = (code, playerId) => {
    setResumePlayerId(playerId);
    handleRoomChange(code);
    onResume && onResume(code, playerId);
  };

  const handleAvatarClick = () => {
    const nextName = window.prompt('Editar nombre', name || 'Jugador');
    if (nextName === null) return;
    setName(nextName.trim().slice(0, 20));
  };

  const openRoomsView = () => {
    setMenuOpen(false);
    setActiveView('rooms');
    fetchActiveRooms();
  };

  const toggleRoomSelection = (roomCode) => {
    setSelectedRooms((prev) => {
      if (prev.includes(roomCode)) {
        return prev.filter((code) => code !== roomCode);
      }
      return [...prev, roomCode];
    });
  };

  const toggleSelectAllRooms = () => {
    if (allRoomsSelected) {
      setSelectedRooms([]);
      return;
    }
    setSelectedRooms(roomCodes);
  };

  const deleteRooms = async (roomCodesToDelete) => {
    if (!roomCodesToDelete || roomCodesToDelete.length === 0) return;
    const password = window.prompt('Contraseña para eliminar la(s) sala(s)', 'hola123');
    if (!password) return;

    const outcomes = await Promise.all(roomCodesToDelete.map(async (roomCode) => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}?password=${encodeURIComponent(password)}`, {
          method: 'DELETE',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          return { roomCode, ok: false, error: payload?.error || 'No se pudo eliminar la sala.' };
        }
        return { roomCode, ok: true };
      } catch (error) {
        return { roomCode, ok: false, error: 'Error de red al intentar eliminar la sala.' };
      }
    }));

    const failed = outcomes.filter((entry) => !entry.ok);
    const deletedCount = outcomes.length - failed.length;
    if (failed.length === 0) {
      alert(`Se eliminaron ${deletedCount} sala(s).`);
      setSelectedRooms((prev) => prev.filter((code) => !roomCodesToDelete.includes(code)));
    } else {
      const sampleErrors = failed.slice(0, 3).map((entry) => `${entry.roomCode}: ${entry.error}`).join('\n');
      alert(`Eliminadas: ${deletedCount}. Fallidas: ${failed.length}.\n${sampleErrors}`);
      setSelectedRooms(failed.map((entry) => entry.roomCode));
    }
    fetchActiveRooms();
  };

  const handleDeleteRoom = async (roomCode) => {
    await deleteRooms([roomCode]);
  };

  return (
    <section className="relative z-10 flex-1 flex flex-col bg-surreal text-white overflow-hidden">
      <div className="flex items-center justify-between p-6 pt-8">
        <div className="flex items-center gap-3">
          <button onClick={() => setMenuOpen(true)} className="material-symbols-outlined text-white/70 hover:text-white transition-colors" style={{ fontSize: 28 }}>menu</button>
        </div>
        <h1 className="text-xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white via-purple-100 to-white text-glow uppercase">
          DIXIT: ONÍRICO
        </h1>
        <div className="flex items-center gap-3">
          <button onClick={handleAvatarClick} className="h-10 w-10 rounded-full border-2 border-primary p-0.5 overflow-hidden hover:brightness-110 transition" title="Editar nombre">
            <div className="h-full w-full rounded-full bg-white/10 flex items-center justify-center text-sm font-bold">{name?.[0] || 'T'}</div>
          </button>
        </div>
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
              <span>{musicOn ? 'ON' : 'OFF'}</span>
            </button>
            <button onClick={openRoomsView} className="w-full h-11 rounded-xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/20 transition flex items-center justify-between px-3">
              <span>Ver salas</span>
              <span className="material-symbols-outlined">meeting_room</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-start px-4 pb-28 overflow-y-auto no-scrollbar space-y-6">
        {activeView === 'home' && (
          <>
            <div className="w-full max-w-md space-y-4 pt-4">
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

              <button onClick={onSolo} className="relative group w-full overflow-hidden rounded-2xl bg-gradient-to-r from-surface-dark to-surface-dark p-[1px] border border-white/5 hover:border-primary/50 transition-colors active:scale-95">
                <div className="relative flex h-16 w-full items-center justify-between px-6 bg-surface-dark/80 backdrop-blur-md rounded-2xl">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-purple-200">
                      <span className="material-symbols-outlined">smart_toy</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="text-lg font-bold text-white tracking-wide">Solo con bots</span>
                      <span className="text-xs text-white/40 font-medium">Practica contra IA</span>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-white/30 group-hover:text-white transition-colors">chevron_right</span>
                </div>
              </button>
            </div>

            <div className="mt-4 w-full max-w-md">
              <p className="text-xs text-purple-200 italic text-center">"Una imagen vale más que mil palabras, pero un sueño es infinito."</p>
            </div>
          </>
        )}

        {activeView === 'rooms' && (
          <div className="w-full max-w-md space-y-3 pt-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70 font-semibold">Salas activas</p>
                  <p className="text-xs text-white/50">{activeRooms?.length || 0} salas encontradas</p>
                </div>
                <button onClick={fetchActiveRooms} className="text-xs px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white/80 hover:bg-white/20 transition">
                  Refrescar
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={toggleSelectAllRooms} className="h-9 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-xs font-semibold hover:bg-white/20 transition">
                  {allRoomsSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </button>
                <button onClick={() => setSelectedRooms([])} className="h-9 px-3 rounded-xl bg-white/10 border border-white/20 text-white text-xs font-semibold hover:bg-white/20 transition">
                  Limpiar
                </button>
              </div>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {(activeRooms || []).length === 0 && <p className="text-white/50 text-sm">No hay partidas activas.</p>}
              {(activeRooms || []).map((r) => {
                const checked = selectedRooms.includes(r.code);
                return (
                  <div key={r.code} data-testid={`room-card-${r.code}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid={`select-room-${r.code}`}
                          checked={checked}
                          onChange={() => toggleRoomSelection(r.code)}
                          className="mt-1 accent-primary"
                        />
                        <div>
                          <p className="text-xs text-white/50">Código</p>
                          <p className="text-lg font-bold text-white tracking-widest font-mono">{r.code}</p>
                          <p className="text-xs text-white/60 mt-1">Fase: {r.phase}</p>
                        </div>
                      </label>
                      <div className="text-right text-xs text-white/60">
                        <p>{r.players?.length || 0} jugadores</p>
                        <p>Modo: {r.mode === 'party' ? '+18' : 'clásico'}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {(r.players || []).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleResumeClick(r.code, p.id)}
                          className={`flex items-center justify-between px-3 py-2 rounded-xl text-left border ${resumePlayerId === p.id ? 'border-primary bg-primary/20' : 'border-white/10 bg-white/5 hover:bg-white/10'} text-white/80 transition text-sm`}
                        >
                          <span className="font-semibold">{p.name}</span>
                          <span className={`w-2 h-2 rounded-full ${p.connected ? 'bg-green-400' : 'bg-yellow-300'}`} title={p.connected ? 'Conectado' : 'Desconectado'} />
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => handleDeleteRoom(r.code)}
                      className="mt-2 w-full h-10 rounded-xl bg-red-600/80 text-white text-sm font-semibold hover:bg-red-600 transition"
                    >
                      Eliminar esta sala
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => deleteRooms(selectedRooms)}
              disabled={selectedRooms.length === 0}
              data-testid="delete-selected-rooms"
              className="w-full h-12 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Eliminar seleccionadas ({selectedRooms.length})
            </button>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 pt-2">
        <div className="glass-panel mx-auto flex h-16 w-full max-w-md items-center justify-between rounded-full px-1 shadow-2xl">
          <div className="flex flex-1 justify-start">
            <button
              onClick={() => setActiveView('home')}
              className={`flex h-10 w-16 items-center justify-center rounded-full transition-all ${activeView === 'home' ? 'bg-primary/20 text-primary' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
              title="Inicio"
            >
              <span className="material-symbols-outlined fill-current" style={{ fontVariationSettings: "'FILL' 1, 'wght' 400" }}>home</span>
            </button>
          </div>
          <div className="relative -top-6">
            <button onClick={onQuickCreate} className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-gold to-yellow-600 text-black shadow-lg shadow-gold/20 transition-transform active:scale-95 border-4 border-background-dark" title="Crear sala rápida">
              <span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
            </button>
          </div>
          <div className="flex flex-1 justify-end">
            <button
              onClick={openRoomsView}
              className={`relative flex h-10 w-16 items-center justify-center rounded-full transition-all ${activeView === 'rooms' ? 'bg-primary/20 text-primary' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
              title="Ver salas"
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1, 'wght' 400" }}>meeting_room</span>
              {(activeRooms?.length || 0) > 0 && (
                <span className="absolute -top-1 -right-0 h-4 min-w-4 px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
                  {Math.min(activeRooms.length, 99)}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const { state, send } = useWs();
  const [name, setName] = useState(localStorage.getItem('dixit:name') || '');
  const [room, setRoom] = useState(localStorage.getItem('dixit:room') || '');
  const [selected, setSelected] = useState(null);
  const [clue, setClue] = useState('');
  const [clueAudio, setClueAudio] = useState(null);
  const [soloPending, setSoloPending] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const audioRef = React.useRef(null);
  const [activeRooms, setActiveRooms] = useState([]);
  const [resumePlayerId, setResumePlayerId] = useState('');
  const toggleMusic = useCallback(() => {
    const audio = audioRef.current;
    setMusicOn((prev) => {
      const next = !prev;
      if (audio) {
        if (next) {
          audio.volume = 0.35;
          audio.loop = true;
          audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      }
      return next;
    });
  }, []);

  useEffect(() => { localStorage.setItem('dixit:name', name); }, [name]);
  useEffect(() => { localStorage.setItem('dixit:room', room); }, [room]);

  const join = (withBots = false) => {
    const payload = { type: 'join', name: name || 'Jugador' };
    if (room) payload.roomCode = room;
    if (resumePlayerId) payload.playerId = resumePlayerId;
    send(payload);
    if (withBots) setSoloPending(true);
  };

  const quickCreate = () => {
    setRoom('');
    setResumePlayerId('');
    send({ type: 'join', name: name || 'Jugador' });
  };

  const handleResume = (roomCode, playerId) => {
    const formatted = formatRoomCode(roomCode || room);
    if (formatted) setRoom(formatted);
    if (playerId) setResumePlayerId(playerId);
    const payload = { type: 'join', name: name || 'Jugador' };
    if (formatted) payload.roomCode = formatted;
    if (playerId) payload.playerId = playerId;
    send(payload);
  };

  useEffect(() => {
    if (soloPending && state?.roomCode) {
      send({ type: 'start_with_bots' });
      setSoloPending(false);
    }
  }, [soloPending, state?.roomCode, send]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (musicOn) {
      audio.volume = 0.35;
      audio.loop = true;
      audio.currentTime = 0;
      audio.play().catch(() => {
        // ignored: browser blocks until user interacts
      });
    } else {
      audio.pause();
    }
  }, [musicOn]);

  const leave = () => {
    send({ type: 'leave' });
    window.location.reload();
  };

  const fetchActiveRooms = async () => {
    try {
      const res = await fetch('/api/rooms');
      const data = await res.json();
      setActiveRooms(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchActiveRooms();
  }, []);

  useEffect(() => {
    if (state?.phase !== phases.CLUE) {
      setSelected(null);
      setClue('');
      setClueAudio(null);
    }
  }, [state?.phase]);

  const renderPhase = (extra = {}) => {
    if (!state || !state.phase) return null;
    switch (state.phase) {
      case phases.LOBBY:
        return <Lobby state={state} send={send} onLeave={extra.onLeave} />;
      case phases.CLUE:
        if (state.you?.isStoryteller) return <Clue state={state} send={send} selected={selected} setSelected={setSelected} clue={clue} setClue={setClue} clueAudio={clueAudio} setClueAudio={setClueAudio} />;
        return <Submit state={{ you: { submitted: true } }} send={send} />;
      case phases.SUBMIT:
        if (state.you?.isStoryteller) return <Submit state={{ you: { submitted: true }, clue: state.clue, hand: [] }} send={send} />;
        return <Submit state={state} send={send} />;
      case phases.VOTE:
        if (state.you?.isStoryteller) return <Submit state={{ you: { submitted: true }, clue: state.clue, hand: [] }} send={send} />;
        return <Vote state={state} send={send} />;
      case phases.REVEAL:
        return <Score state={state} send={send} />;
      default:
        return null;
    }
  };

  const isLanding = !state || !state.phase;

  return (
    <div className="relative flex min-h-screen flex-col bg-surreal overflow-hidden">
      <div className="fixed top-[-100px] right-[-100px] w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none z-0" />
      <div className="fixed bottom-[-50px] left-[-50px] w-64 h-64 bg-accent-pink/10 rounded-full blur-[80px] pointer-events-none z-0" />
      {/* acciones globales ahora se despliegan en menú / headers, no flotan todo el rato */}
      <audio ref={audioRef} preload="metadata" src="/audio/misteriosa.mp3" />
      {isLanding ? (
        <Landing
          onJoin={() => join(false)}
          onQuickCreate={quickCreate}
          onSolo={() => join(true)}
          onResume={handleResume}
          name={name}
          setName={setName}
          room={room}
          setRoom={setRoom}
          activeRooms={activeRooms}
          resumePlayerId={resumePlayerId}
          setResumePlayerId={setResumePlayerId}
          fetchActiveRooms={fetchActiveRooms}
          toggleMusic={toggleMusic}
          musicOn={musicOn}
        />
      ) : (
        renderPhase({ onLeave: leave, toggleMusic, musicOn })
      )}
      {!isLanding && (
        <GameActions
          onLeave={leave}
          onToggleMusic={toggleMusic}
          musicOn={musicOn}
        />
      )}
    </div>
  );
}
