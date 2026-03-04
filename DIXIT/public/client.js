const screens = {
  landing: document.getElementById('screen-landing'),
  lobby: document.getElementById('screen-lobby'),
  clue: document.getElementById('screen-clue'),
  submit: document.getElementById('screen-submit'),
  vote: document.getElementById('screen-vote'),
  score: document.getElementById('screen-score'),
};

const elements = {
  nameInput: document.getElementById('name-input'),
  roomInput: document.getElementById('room-input'),
  createBtn: document.getElementById('create-btn'),
  joinBtn: document.getElementById('join-btn'),
  soloBtn: document.getElementById('solo-btn'),
  roomCodeCard: document.getElementById('room-code-card'),
  playersGrid: document.getElementById('players-grid'),
  readyBtn: document.getElementById('ready-btn'),
  startBtn: document.getElementById('start-btn'),
  readyBar: document.getElementById('ready-bar'),
  readyCount: document.getElementById('ready-count'),
  leaveBtn: document.getElementById('leave-btn'),
  endRoomBtn: document.getElementById('end-room-btn'),
  // Clue
  clueHand: document.getElementById('clue-hand'),
  clueSelected: document.getElementById('clue-selected-card'),
  clueInput: document.getElementById('clue-input'),
  sendClueBtn: document.getElementById('send-clue-btn'),
  clueTimer: document.getElementById('clue-timer'),
  // Submit
  submitHand: document.getElementById('submit-hand'),
  submitClue: document.getElementById('submit-clue'),
  submitTimer: document.getElementById('submit-timer'),
  // Vote
  voteCards: document.getElementById('vote-cards'),
  voteClue: document.getElementById('vote-clue'),
  voteTimer: document.getElementById('vote-timer'),
  // Score
  scoreboard: document.getElementById('scoreboard'),
  roundSummary: document.getElementById('round-summary'),
  nextRoundBtn: document.getElementById('next-round-btn'),
  toast: document.getElementById('toast'),
};

let ws = null;
let currentState = null;
let selectedClueCard = null;
let soloRequested = false;

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${window.location.host}/ws`;

function show(screen) {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[screen]?.classList.remove('hidden');
}

function toast(message, variant = 'info') {
  const div = document.createElement('div');
  div.className = `pointer-events-auto bg-white/10 border border-white/20 text-white px-4 py-3 rounded-2xl shadow-lg backdrop-blur flex items-center gap-2 animate-fade-in`;
  div.innerHTML = `<span class="material-symbols-outlined text-sm">${variant === 'error' ? 'error' : 'notifications'}</span><span class="text-sm">${message}</span>`;
  elements.toast.appendChild(div);
  setTimeout(() => div.remove(), 2800);
}

function connectSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(WS_URL);
  ws.addEventListener('open', () => {
    const savedName = localStorage.getItem('dixit:name');
    const savedRoom = localStorage.getItem('dixit:room');
    if (savedName) elements.nameInput.value = savedName;
    if (savedRoom) elements.roomInput.value = savedRoom;
  });
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'joined') {
      localStorage.setItem('dixit:room', data.roomCode);
      if (elements.roomInput.value.trim() === '') elements.roomInput.value = data.roomCode;
      if (soloRequested) {
        send({ type: 'start_with_bots' });
        soloRequested = false;
      }
    }
    if (data.type === 'error') {
      toast(data.message, 'error');
      return;
    }
    if (data.type === 'ended') {
      toast('La sala fue eliminada.');
      currentState = null;
      show('landing');
      return;
    }
    if (data.type === 'state') {
      currentState = data;
      render();
    }
  });
  ws.addEventListener('close', () => {
    toast('Conexión cerrada');
    show('landing');
    currentState = null;
  });
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setTimeout(() => send(payload), 200);
    return;
  }
  ws.send(JSON.stringify(payload));
}

function render() {
  if (!currentState) return;
  const state = currentState;
  const me = state.you;
  const phase = state.phase;

  switch (phase) {
    case 'lobby':
      renderLobby(state);
      break;
    case 'clue':
      if (me?.isStoryteller) renderClue(state);
      else renderWaiting('Esperando al narrador...', 'En cuanto envíe su pista, elegirás carta');
      break;
    case 'submit':
      if (me?.isStoryteller) renderWaiting('Esperando jugadores', 'Tus amigos están eligiendo sus cartas');
      else renderSubmit(state);
      break;
    case 'vote':
      if (me?.isStoryteller) renderWaiting('Esperando votos', 'Los jugadores están votando la carta del narrador');
      else renderVote(state);
      break;
    case 'reveal':
      renderScore(state);
      break;
    default:
      show('landing');
  }
}

function renderLobby(state) {
  show('lobby');
  const { roomCode, players, hostId, you } = state;
  elements.roomCodeCard.innerHTML = `
    <div class="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-gradient-to-br from-primary/20 to-primary-dark/10 border border-primary/30 shadow-lg relative overflow-hidden group cursor-pointer" id="copy-room">
      <div class="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
      <span class="text-primary-light text-xs font-bold tracking-widest uppercase">Código</span>
      <div class="flex items-center gap-3">
        <h2 class="text-white text-3xl font-black tracking-widest drop-shadow-[0_2px_10px_rgba(127,19,236,0.5)] font-mono">${roomCode}</h2>
        <span class="material-symbols-outlined text-white/50 text-xl" title="Copiar">content_copy</span>
      </div>
      <p class="text-white/40 text-[10px] mt-1">Toca para copiar y compartir</p>
    </div>`;
  document.getElementById('copy-room').onclick = () => {
    navigator.clipboard.writeText(roomCode).then(() => toast('Código copiado'));
  };

  elements.playersGrid.innerHTML = '';
  const sorted = [...players].sort((a, b) => (a.id === hostId ? -1 : 0) - (b.id === hostId ? -1 : 0));
  sorted.forEach((p) => {
    const readyBadge = p.ready ? '<p class="text-green-400 text-xs font-semibold mt-1 bg-green-400/10 px-2 py-0.5 rounded-full inline-block">Listo</p>' : '<p class="text-white/50 text-xs font-semibold mt-1 bg-white/10 px-2 py-0.5 rounded-full inline-block">Esperando</p>';
    const crown = p.id === hostId ? '<span class="material-symbols-outlined text-yellow-400 drop-shadow-md" style="font-size: 20px;" title="Host">crown</span>' : '';
    const storyteller = p.isStoryteller ? '<span class="material-symbols-outlined text-primary-light" style="font-size:18px;">auto_stories</span>' : '';
    const card = document.createElement('div');
    card.className = 'flex flex-col items-center gap-3 p-4 rounded-2xl glass-panel relative group border-t border-white/10 shadow-lg';
    card.innerHTML = `
      <div class="absolute top-3 right-3 flex gap-1">${crown}${storyteller}</div>
      <div class="relative w-20 h-20">
        <div class="absolute inset-0 bg-gradient-to-tr from-accent-pink to-purple-600 rounded-full blur opacity-30"></div>
        <div class="w-full h-full rounded-full border-2 border-white/20 bg-white/5 flex items-center justify-center text-xl font-bold">${p.name[0]?.toUpperCase() || 'P'}</div>
      </div>
      <div class="text-center">
        <p class="text-white text-base font-bold leading-tight">${p.name}</p>
        ${readyBadge}
      </div>`;
    elements.playersGrid.appendChild(card);
  });
  // invite slot
  const invite = document.createElement('div');
  invite.className = 'flex flex-col items-center justify-center gap-3 p-4 rounded-2xl border-2 border-dashed border-white/10 bg-white/5 relative group hover:bg-white/10 transition-colors cursor-pointer min-h-[160px]';
  invite.innerHTML = `
    <div class="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
      <span class="material-symbols-outlined text-white/70 text-2xl">add</span>
    </div>
    <p class="text-white font-semibold">Compartir enlace</p>
    <p class="text-white/50 text-xs text-center">Invita a más amigos</p>`;
  invite.onclick = () => {
    navigator.clipboard.writeText(roomCode).then(() => toast('Código copiado'));
  };
  elements.playersGrid.appendChild(invite);

  const readyCount = players.filter(p => p.ready).length;
  const pct = players.length ? Math.round((readyCount / players.length) * 100) : 0;
  elements.readyBar.style.width = `${pct}%`;
  elements.readyCount.textContent = `${readyCount}/${players.length}`;

  if (you) {
    elements.readyBtn.textContent = you.ready ? 'No listo' : 'Listo';
    elements.readyBtn.onclick = () => send({ type: 'set_ready', ready: !you.ready });
    elements.startBtn.classList.toggle('hidden', you.isHost !== true);
    elements.startBtn.disabled = !state.canStart;
    elements.startBtn.textContent = state.canStart ? 'Empezar' : 'Esperando jugadores (min 3)';
    elements.startBtn.onclick = () => send({ type: 'start' });

    elements.endRoomBtn.classList.toggle('hidden', you.isHost !== true);
    elements.endRoomBtn.onclick = () => {
      if (!you.isHost) return;
      if (!window.confirm('¿Seguro que quieres eliminar la sala?')) return;
      send({ type: 'end_room' });
    };
  }
}

function renderClue(state) {
  show('clue');
  const { hand } = state;
  elements.clueTimer.textContent = '--:--';
  elements.clueInput.value = elements.clueInput.value || '';
  elements.clueSelected.innerHTML = selectedClueCard ? cardPreview(selectedClueCard) : placeholderCard();

  elements.clueHand.innerHTML = '';
  hand.forEach((card) => {
    const div = document.createElement('div');
    div.className = `snap-center shrink-0 w-20 aspect-[2/3] rounded-lg overflow-hidden transition-all shadow-lg cursor-pointer ${selectedClueCard === card ? 'ring-2 ring-primary ring-offset-2 ring-offset-[#191022]' : 'opacity-70 hover:opacity-100'}`;
    div.innerHTML = `<img src="/${card}" alt="carta" class="w-full h-full object-cover" />`;
    div.onclick = () => {
      selectedClueCard = card;
      renderClue(state);
    };
    elements.clueHand.appendChild(div);
  });

  const enable = Boolean(selectedClueCard) && elements.clueInput.value.trim().length > 0;
  elements.sendClueBtn.disabled = !enable;
  elements.sendClueBtn.onclick = () => {
    if (!enable) return;
    send({ type: 'submit_clue', card: selectedClueCard, clue: elements.clueInput.value.trim() });
    selectedClueCard = null;
    elements.clueInput.value = '';
  };
}

function placeholderCard() {
  return `
    <div class="absolute inset-0 flex items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5">
      <p class="text-white/50 text-sm">Elige una carta</p>
    </div>`;
}

function cardPreview(card) {
  return `
    <div class="absolute -inset-1 bg-gradient-to-r from-primary to-purple-600 rounded-xl opacity-75 blur-lg"></div>
    <div class="relative h-full w-full rounded-xl overflow-hidden shadow-2xl border-2 border-primary/50 bg-slate-800">
      <img src="/${card}" class="w-full h-full object-cover" />
    </div>`;
}

function renderSubmit(state) {
  show('submit');
  const { hand, clue, you } = state;
  elements.submitClue.textContent = clue || '';
  elements.submitTimer.textContent = '--:--';
  elements.submitHand.innerHTML = '';

  if (you?.submitted) {
    const div = document.createElement('div');
    div.className = 'col-span-2 sm:col-span-3 text-center text-white/70';
    div.innerHTML = '<p class="text-lg font-semibold">Carta enviada</p><p class="text-sm text-white/50">Espera a que todos elijan</p>';
    elements.submitHand.appendChild(div);
    return;
  }

  hand.forEach((card) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'relative rounded-xl overflow-hidden shadow-xl border border-white/10 bg-white/5 hover:-translate-y-1 transition cursor-pointer';
    wrapper.innerHTML = `<img src="/${card}" class="w-full h-full object-cover" />`;
    wrapper.onclick = () => {
      send({ type: 'submit_card', card });
      toast('Carta enviada');
    };
    elements.submitHand.appendChild(wrapper);
  });
}

function renderVote(state) {
  show('vote');
  const { board, clue, you } = state;
  elements.voteClue.textContent = clue || '';
  elements.voteTimer.textContent = '--:--';
  elements.voteCards.innerHTML = '';

  if (you?.votedFor) {
    const info = document.createElement('div');
    info.className = 'col-span-2 sm:col-span-3 text-center text-white/70';
    info.innerHTML = '<p class="text-lg font-semibold">Has votado</p><p class="text-sm text-white/50">Esperando resultados</p>';
    elements.voteCards.appendChild(info);
  }

  board.forEach((card) => {
    const disabled = Boolean(you?.votedFor) || card.isYours;
    const wrapper = document.createElement('div');
    wrapper.className = `relative rounded-xl overflow-hidden shadow-xl border ${card.isYours ? 'border-amber-400/60' : 'border-white/10'} bg-white/5 transition ${disabled ? 'opacity-60' : 'hover:-translate-y-1 cursor-pointer'}`;
    wrapper.innerHTML = `
      <img src="/${card.card}" class="w-full h-full object-cover" />
      ${card.isYours ? '<div class="absolute top-2 left-2 px-2 py-1 rounded-full bg-amber-500/80 text-xs font-semibold text-white">Tu carta</div>' : ''}`;
    if (!disabled) {
      wrapper.onclick = () => send({ type: 'vote', submissionId: card.id });
    }
    elements.voteCards.appendChild(wrapper);
  });
}

function renderScore(state) {
  show('score');
  const { players, summary, board, hostId, you } = state;
  const resultMap = new Map(summary?.results?.map(r => [r.playerId, r]) || []);
  const playerById = new Map(players.map(p => [p.id, p]));
  const sorted = [...players].sort((a, b) => b.score - a.score);

  elements.scoreboard.innerHTML = '';
  sorted.forEach((p, idx) => {
    const delta = resultMap.get(p.id)?.delta || 0;
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between rounded-2xl glass-panel border border-white/10 px-4 py-3';
    row.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">${idx + 1}</div>
        <div>
          <p class="text-white font-semibold">${p.name}${p.id === summary?.storytellerId ? ' · Narrador' : ''}</p>
          <p class="text-white/50 text-xs">${delta >= 0 ? '+' : ''}${delta} puntos</p>
        </div>
      </div>
      <div class="text-xl font-black text-white">${p.score}</div>`;
    elements.scoreboard.appendChild(row);
  });

  const storyteller = playerById.get(summary?.storytellerId);
  const votesList = summary?.votes || [];
  const cards = board || [];

  const voteLines = cards.map((c) => {
    const owner = playerById.get(c.ownerId);
    const voters = votesList.filter(v => v.submissionId === c.id).map(v => playerById.get(v.playerId)?.name || '');
    return `<div class="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5"> 
      <img src="/${c.card}" class="w-16 h-16 object-cover rounded-lg" />
      <div>
        <p class="text-white font-semibold">${owner?.name || 'Jugador'}${c.ownerId === summary?.storytellerId ? ' (Narrador)' : ''}</p>
        <p class="text-white/60 text-sm">Votos: ${voters.length ? voters.join(', ') : 'Nadie'}</p>
      </div>
    </div>`;
  }).join('');

  elements.roundSummary.innerHTML = `
    <p class="text-sm text-white/60 mb-2">Pista del narrador</p>
    <p class="text-xl font-bold text-white mb-4">"${summary?.clue || ''}" — ${storyteller?.name || ''}</p>
    <div class="space-y-2">${voteLines}</div>`;

  elements.nextRoundBtn.disabled = you?.id !== hostId;
  elements.nextRoundBtn.textContent = you?.id === hostId ? 'Siguiente ronda' : 'Esperando al host';
  elements.nextRoundBtn.onclick = () => send({ type: 'next_round' });
}

function renderWaiting(title, subtitle) {
  show('submit');
  elements.submitClue.textContent = title;
  elements.submitTimer.textContent = '--:--';
  elements.submitHand.innerHTML = `
    <div class="col-span-2 sm:col-span-3 text-center text-white/70 py-10">
      <p class="text-xl font-semibold">${title}</p>
      <p class="text-sm text-white/50 mt-2">${subtitle}</p>
    </div>`;
}

// Event bindings

connectSocket();

['nameInput', 'roomInput'].forEach((id) => {
  elements[id]?.addEventListener('input', () => {
    if (id === 'nameInput') localStorage.setItem('dixit:name', elements.nameInput.value.trim());
    if (id === 'roomInput') localStorage.setItem('dixit:room', elements.roomInput.value.trim().toUpperCase());
  });
});

elements.createBtn.addEventListener('click', () => {
  const name = elements.nameInput.value.trim() || 'Jugador';
  send({ type: 'join', name });
});

elements.soloBtn.addEventListener('click', () => {
  soloRequested = true;
  const name = elements.nameInput.value.trim() || 'Jugador';
  send({ type: 'join', name });
});

elements.joinBtn.addEventListener('click', () => {
  const name = elements.nameInput.value.trim() || 'Jugador';
  const roomCode = elements.roomInput.value.trim().toUpperCase();
  if (!roomCode) { toast('Introduce un código'); return; }
  send({ type: 'join', name, roomCode });
});

elements.clueInput.addEventListener('input', () => {
  if (currentState?.phase === 'clue' && currentState.you?.isStoryteller) {
    renderClue(currentState);
  }
});

elements.leaveBtn.addEventListener('click', () => {
  send({ type: 'leave' });
  show('landing');
});

// copy room code via keyboard shortcut
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' && (e.metaKey || e.ctrlKey) && currentState?.roomCode) {
    navigator.clipboard.writeText(currentState.roomCode).then(() => toast('Código copiado'));
  }
});
