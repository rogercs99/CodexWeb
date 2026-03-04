export type Screen =
  | 'login'
  | 'hub'
  | 'chat'
  | 'search'
  | 'attachments'
  | 'terminal'
  | 'settings'
  | 'reboot'
  | 'offline';

export interface User {
  id: number;
  username: string;
}

export interface Conversation {
  id: number;
  title: string;
  model: string;
  reasoningEffort: string;
  created_at: string;
  last_message_at: string;
  liveDraftOpen?: boolean;
  liveDraftUpdatedAt?: string;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface AttachmentItem {
  id: string;
  conversationId: number;
  conversationTitle: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

export interface TerminalEntry {
  id: string;
  itemId: string;
  kind: 'running' | 'success' | 'error' | 'notice';
  command: string;
  output: string;
  statusText: string;
  timestamp: string;
  durationMs: number;
}

export interface ChatOptions {
  models: string[];
  reasoningEfforts: string[];
  defaults: {
    model: string;
    reasoningEffort: string;
  };
}

export interface RestartState {
  attemptId: string;
  active: boolean;
  phase: string;
  requestedBy: string;
  startedAt: string;
  finishedAt: string;
  updatedAt: string;
  logs: Array<{ at: string; message: string }>;
}

export interface Capabilities {
  web: boolean;
  code: boolean;
  memory: boolean;
}

export interface CodexQuotaWindow {
  totalPercent: number;
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number;
  resetAt: string;
}

export interface CodexQuotaCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: number | null;
}

export interface CodexQuota {
  source: string;
  observedAt: string;
  fetchedAt: string;
  limitId: string;
  planType: string;
  primary: CodexQuotaWindow | null;
  secondary: CodexQuotaWindow | null;
  credits: CodexQuotaCredits;
}
