import type {
  AttachmentItem,
  ChatOptions,
  Conversation,
  Message,
  RestartState,
  User
} from './types';

interface ApiError extends Error {
  status?: number;
}

async function parseJsonSafe(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const err = new Error(data?.error || `Request failed (${response.status})`) as ApiError;
    err.status = response.status;
    throw err;
  }
  return data as T;
}

export async function getMe(): Promise<{ authenticated: boolean; user: User | null }> {
  return api('/api/me');
}

export async function login(username: string, password: string): Promise<{ ok: true; username: string }> {
  return api('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

export async function logout(): Promise<void> {
  await api('/api/logout', { method: 'POST' });
}

export async function listConversations(): Promise<Conversation[]> {
  const data = await api<{ conversations: Conversation[] }>('/api/conversations');
  return Array.isArray(data.conversations) ? data.conversations : [];
}

export async function listMessages(conversationId: number): Promise<{ conversation: { id: number; title: string }; messages: Message[] }> {
  const data = await api<{ conversation: { id: number; title: string }; messages: Message[] }>(
    `/api/conversations/${conversationId}/messages`
  );
  return {
    conversation: data.conversation,
    messages: Array.isArray(data.messages) ? data.messages : []
  };
}

export async function getChatOptions(): Promise<ChatOptions> {
  return api('/api/chat/options');
}

export async function listAttachments(limit = 200): Promise<AttachmentItem[]> {
  const data = await api<{ attachments: AttachmentItem[] }>(`/api/attachments?limit=${limit}`);
  return Array.isArray(data.attachments) ? data.attachments : [];
}

export async function uploadAttachment(file: File, conversationId: number | null, signal?: AbortSignal): Promise<{ uploadId: string }> {
  const headers: Record<string, string> = {
    'Content-Type': file.type || 'application/octet-stream',
    'X-File-Name': encodeURIComponent(file.name || 'file'),
    'X-File-Type': file.type || 'application/octet-stream'
  };
  if (conversationId && Number.isInteger(conversationId) && conversationId > 0) {
    headers['X-Conversation-Id'] = String(conversationId);
  }

  const response = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: file,
    signal
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(data?.error || `No se pudo subir ${file.name}`);
  }

  const uploadId = data?.attachment?.uploadId;
  if (!uploadId) {
    throw new Error(`Respuesta invalida al subir ${file.name}`);
  }

  return { uploadId: String(uploadId) };
}

export async function restartServer(): Promise<{ attemptId: string }> {
  return api('/api/restart', { method: 'POST' });
}

export async function getRestartStatus(): Promise<RestartState> {
  const data = await api<{ restart: RestartState }>('/api/restart/status');
  return data.restart;
}

export async function startChatStream(payload: {
  message: string;
  model: string;
  reasoningEffort: string;
  conversationId: number | null;
  attachments: Array<{ uploadId: string }>;
  signal: AbortSignal;
}): Promise<Response> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: payload.message,
      model: payload.model,
      reasoningEffort: payload.reasoningEffort,
      conversationId: payload.conversationId,
      attachments: payload.attachments
    }),
    signal: payload.signal
  });

  if (!response.ok) {
    const data = await parseJsonSafe(response);
    throw new Error(data?.error || `No se pudo enviar el mensaje (${response.status})`);
  }

  return response;
}
