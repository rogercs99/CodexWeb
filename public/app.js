const authCard = document.getElementById('authCard');
const keysCard = document.getElementById('keysCard');
const chatCard = document.getElementById('chatCard');
const statusEl = document.getElementById('status');
const logoutBtn = document.getElementById('logoutBtn');

const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const authForm = document.getElementById('authForm');
const authSubmit = document.getElementById('authSubmit');

const keysForm = document.getElementById('keysForm');
const chatForm = document.getElementById('chatForm');
const chatLog = document.getElementById('chatLog');

let authMode = 'login';

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function setAuthMode(mode) {
  authMode = mode;
  loginTab.classList.toggle('active', mode === 'login');
  registerTab.classList.toggle('active', mode === 'register');
  authSubmit.textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
}

function addMessage(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `msg ${role}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Error inesperado');
  }
  return data;
}

async function refreshSession() {
  try {
    const me = await api('/api/me');
    if (!me.authenticated) {
      authCard.classList.remove('hidden');
      keysCard.classList.add('hidden');
      chatCard.classList.add('hidden');
      logoutBtn.classList.add('hidden');
      return;
    }

    authCard.classList.add('hidden');
    logoutBtn.classList.remove('hidden');

    if (me.hasKeys) {
      keysCard.classList.add('hidden');
      chatCard.classList.remove('hidden');
    } else {
      keysCard.classList.remove('hidden');
      chatCard.classList.add('hidden');
    }
  } catch (error) {
    setStatus(error.message);
  }
}

loginTab.addEventListener('click', () => setAuthMode('login'));
registerTab.addEventListener('click', () => setAuthMode('register'));

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  setStatus('Sesión cerrada.');
  refreshSession();
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
    await api(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setStatus(authMode === 'login' ? 'Login correcto.' : 'Cuenta creada.');
    refreshSession();
  } catch (error) {
    setStatus(error.message);
  }
});

keysForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const openaiKey = document.getElementById('openaiKey').value.trim();
  const anthropicKey = document.getElementById('anthropicKey').value.trim();

  try {
    await api('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ openaiKey, anthropicKey })
    });
    setStatus('Keys guardadas de forma segura.');
    refreshSession();
  } catch (error) {
    setStatus(error.message);
  }
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  addMessage('user', message);
  input.value = '';
  setStatus('Consultando a Codex local...');

  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    addMessage('bot', data.reply || '(Sin respuesta)');
    if (data.warning) {
      addMessage('bot', `Aviso: ${data.warning}`);
    }
    setStatus('Respuesta recibida.');
  } catch (error) {
    addMessage('bot', `Error: ${error.message}`);
    setStatus('Falló la consulta a Codex.');
  }
});

setAuthMode('login');
refreshSession();
