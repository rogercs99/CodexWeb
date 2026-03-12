import {
  Plus,
  Search,
  RotateCcw,
  LogOut,
  Power,
  Trash2,
  Pencil,
  X,
  Folder,
  FolderOpen,
  Sparkles,
  Save
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import BottomNav from './BottomNav';
import type { ChatProject, Conversation, ProjectContextMode, Screen, User } from '../lib/types';

const TITLE_MAX_LENGTH = 40;

function formatDate(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function normalizeTitle(value: string | null | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed || 'Nuevo chat';
}

function truncateTitle(value: string, maxLength = TITLE_MAX_LENGTH) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

interface BackgroundNotice {
  jobId: string;
  text: string;
  details?: string;
  tone: 'info' | 'success' | 'error';
  loading?: boolean;
  canDismiss?: boolean;
}

interface ProjectDraft {
  name: string;
  contextMode: ProjectContextMode;
  autoContextEnabled: boolean;
  manualContext: string;
}

export default function ChatHubScreen({
  user,
  conversations,
  projects,
  selectedProjectId,
  unassignedCount,
  activeConversationId,
  runningConversationIds,
  backgroundNotices,
  onDismissBackgroundNotice,
  onOpenChat,
  onCreateChat,
  onSelectProject,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onRegenerateProjectContext,
  onMoveChatToProject,
  onDeleteChat,
  onRenameChat,
  onDeleteChats,
  onLogout,
  onRefresh,
  onRestart,
  onNavigate
}: {
  user: User | null;
  conversations: Conversation[];
  projects: ChatProject[];
  selectedProjectId: number | null;
  unassignedCount: number;
  activeConversationId: number | null;
  runningConversationIds: number[];
  backgroundNotices?: BackgroundNotice[] | null;
  onDismissBackgroundNotice?: (jobId: string) => void;
  onOpenChat: (id: number) => void;
  onCreateChat: (projectId?: number | null) => void;
  onSelectProject: (projectId: number | null) => void;
  onCreateProject: (payload: ProjectDraft) => Promise<ChatProject>;
  onUpdateProject: (
    projectId: number,
    payload: Partial<ProjectDraft>
  ) => Promise<ChatProject>;
  onDeleteProject: (projectId: number) => Promise<void>;
  onRegenerateProjectContext: (projectId: number) => Promise<void>;
  onMoveChatToProject: (conversationId: number, projectId: number | null) => Promise<any>;
  onDeleteChat: (id: number) => void;
  onRenameChat: (id: number, title: string) => void | Promise<void>;
  onDeleteChats: (ids: number[]) => void;
  onLogout: () => void;
  onRefresh: () => void;
  onRestart: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<number[]>([]);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>({
    name: '',
    contextMode: 'mixed',
    autoContextEnabled: true,
    manualContext: ''
  });
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectContextDirty, setProjectContextDirty] = useState(false);
  const [projectEditor, setProjectEditor] = useState<ProjectDraft>({
    name: '',
    contextMode: 'mixed',
    autoContextEnabled: true,
    manualContext: ''
  });

  const selectedProject = useMemo(
    () =>
      Number.isInteger(Number(selectedProjectId)) && Number(selectedProjectId) > 0
        ? projects.find((item) => item.id === Number(selectedProjectId)) || null
        : null,
    [projects, selectedProjectId]
  );

  const visibleConversations = useMemo(() => {
    if (!selectedProject) return conversations;
    return conversations.filter((item) => Number(item.projectId) === Number(selectedProject.id));
  }, [conversations, selectedProject]);

  useEffect(() => {
    const existingIds = new Set(visibleConversations.map((item) => item.id));
    setSelectedChatIds((prev) => prev.filter((id) => existingIds.has(id)));
  }, [visibleConversations]);

  useEffect(() => {
    if (!selectionMode) {
      setSelectedChatIds([]);
    }
  }, [selectionMode]);

  useEffect(() => {
    if (!selectedProject) {
      setProjectContextDirty(false);
      return;
    }
    setProjectEditor({
      name: selectedProject.name,
      contextMode: selectedProject.contextMode,
      autoContextEnabled: selectedProject.autoContextEnabled,
      manualContext: String(selectedProject.manualContext || '')
    });
    setProjectContextDirty(false);
  }, [selectedProject]);

  const selectedCount = selectedChatIds.length;
  const allSelected = useMemo(
    () => visibleConversations.length > 0 && selectedCount === visibleConversations.length,
    [visibleConversations.length, selectedCount]
  );

  const toggleSelection = (conversationId: number) => {
    setSelectedChatIds((prev) =>
      prev.includes(conversationId) ? prev.filter((id) => id !== conversationId) : [...prev, conversationId]
    );
  };

  const handleSelectAllToggle = () => {
    if (allSelected) {
      setSelectedChatIds([]);
      return;
    }
    setSelectedChatIds(visibleConversations.map((item) => item.id));
  };

  const handleDeleteSelected = () => {
    if (selectedCount === 0) return;
    const chatLabel = selectedCount === 1 ? 'chat' : 'chats';
    if (!window.confirm(`¿Eliminar ${selectedCount} ${chatLabel} definitivamente?`)) {
      return;
    }
    onDeleteChats(selectedChatIds);
    setSelectionMode(false);
    setSelectedChatIds([]);
  };

  const handleCreateProject = async () => {
    const name = String(projectDraft.name || '').trim();
    if (!name) return;
    setProjectBusy(true);
    try {
      await onCreateProject(projectDraft);
      setCreatingProject(false);
      setProjectDraft({
        name: '',
        contextMode: 'mixed',
        autoContextEnabled: true,
        manualContext: ''
      });
    } catch (error: any) {
      window.alert(error?.message || 'No se pudo crear el proyecto');
    } finally {
      setProjectBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">CodexWeb</h1>
          <p className="text-xs text-zinc-500">{user?.username || 'usuario'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500" type="button">
            <RotateCcw size={16} />
          </button>
          <button onClick={onRestart} className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500" type="button">
            <Power size={16} />
          </button>
          <button onClick={onLogout} className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500" type="button">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-28">
        <div className="px-4 py-4 sticky top-0 z-40 bg-black/80 backdrop-blur-xl space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onCreateChat(selectedProject ? selectedProject.id : null)}
              className="w-full bg-white text-black py-3 rounded-xl font-medium flex items-center justify-center gap-2"
              type="button"
            >
              <Plus size={18} /> Nuevo chat
            </button>
            <button
              onClick={() => setCreatingProject((prev) => !prev)}
              className="w-full bg-zinc-900 border border-zinc-800 py-3 rounded-xl text-zinc-300 flex items-center justify-center gap-2"
              type="button"
            >
              <Folder size={16} /> {creatingProject ? 'Cancelar' : 'Nuevo proyecto'}
            </button>
          </div>

          {creatingProject ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3 space-y-2">
              <input
                value={projectDraft.name}
                onChange={(event) => setProjectDraft((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm"
                placeholder="Nombre del proyecto"
              />
              <select
                value={projectDraft.contextMode}
                onChange={(event) =>
                  setProjectDraft((prev) => ({
                    ...prev,
                    contextMode: event.target.value as ProjectContextMode,
                    autoContextEnabled:
                      event.target.value === 'manual' ? false : prev.autoContextEnabled
                  }))
                }
                className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm"
              >
                <option value="manual">Modo manual</option>
                <option value="automatic">Modo automático</option>
                <option value="mixed">Modo mixto</option>
              </select>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={projectDraft.autoContextEnabled}
                  onChange={(event) =>
                    setProjectDraft((prev) => ({ ...prev, autoContextEnabled: event.target.checked }))
                  }
                  disabled={projectDraft.contextMode === 'manual'}
                />
                Actualización automática del contexto
              </label>
              {(projectDraft.contextMode === 'manual' || projectDraft.contextMode === 'mixed') ? (
                <textarea
                  value={projectDraft.manualContext}
                  onChange={(event) => setProjectDraft((prev) => ({ ...prev, manualContext: event.target.value }))}
                  className="w-full min-h-[96px] rounded-xl border border-zinc-700 bg-black px-3 py-2 text-xs"
                  placeholder="Describe objetivos, stack, reglas y decisiones base del proyecto"
                />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void handleCreateProject();
                }}
                disabled={projectBusy || !String(projectDraft.name || '').trim()}
                className="w-full rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-200 px-3 py-2 text-sm"
              >
                Crear proyecto
              </button>
            </div>
          ) : null}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-2.5 space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onSelectProject(null)}
                className={`rounded-full px-3 py-1.5 text-xs border ${
                  selectedProjectId === null
                    ? 'border-blue-500/60 bg-blue-600/20 text-blue-200'
                    : 'border-zinc-700 text-zinc-300 bg-zinc-950'
                }`}
              >
                Todos ({conversations.length})
              </button>
              <span className="rounded-full px-3 py-1.5 text-xs border border-zinc-700 text-zinc-400 bg-zinc-950">
                Sin proyecto ({unassignedCount})
              </span>
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSelectProject(project.id)}
                  className={`rounded-full px-3 py-1.5 text-xs border flex items-center gap-1.5 ${
                    selectedProject?.id === project.id
                      ? 'border-blue-500/60 bg-blue-600/20 text-blue-200'
                      : 'border-zinc-700 text-zinc-300 bg-zinc-950'
                  }`}
                >
                  {selectedProject?.id === project.id ? <FolderOpen size={12} /> : <Folder size={12} />}
                  {project.name}
                </button>
              ))}
            </div>

            {selectedProject ? (
              <div className="rounded-xl border border-zinc-700/80 bg-black/40 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-zinc-300">Contexto de proyecto compartido</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`¿Eliminar proyecto "${selectedProject.name}"? Los chats quedarán sin proyecto.`)) return;
                        void onDeleteProject(selectedProject.id).catch((error: any) => {
                          window.alert(error?.message || 'No se pudo eliminar el proyecto');
                        });
                      }}
                      className="h-7 w-7 rounded-full border border-red-500/40 text-red-300 flex items-center justify-center"
                      aria-label="Eliminar proyecto"
                    >
                      <Trash2 size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onRegenerateProjectContext(selectedProject.id).catch((error: any) => {
                          window.alert(error?.message || 'No se pudo regenerar el contexto');
                        });
                      }}
                      className="h-7 w-7 rounded-full border border-cyan-500/40 text-cyan-300 flex items-center justify-center"
                      aria-label="Regenerar contexto automático"
                    >
                      <Sparkles size={12} />
                    </button>
                  </div>
                </div>
                <input
                  value={projectEditor.name}
                  onChange={(event) => {
                    setProjectContextDirty(true);
                    setProjectEditor((prev) => ({ ...prev, name: event.target.value }));
                  }}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={projectEditor.contextMode}
                    onChange={(event) => {
                      setProjectContextDirty(true);
                      setProjectEditor((prev) => ({
                        ...prev,
                        contextMode: event.target.value as ProjectContextMode,
                        autoContextEnabled: event.target.value === 'manual' ? false : prev.autoContextEnabled
                      }));
                    }}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs"
                  >
                    <option value="manual">manual</option>
                    <option value="automatic">automático</option>
                    <option value="mixed">mixto</option>
                  </select>
                  <label className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs flex items-center gap-2 text-zinc-300">
                    <input
                      type="checkbox"
                      checked={projectEditor.autoContextEnabled}
                      onChange={(event) => {
                        setProjectContextDirty(true);
                        setProjectEditor((prev) => ({ ...prev, autoContextEnabled: event.target.checked }));
                      }}
                      disabled={projectEditor.contextMode === 'manual'}
                    />
                    Auto activo
                  </label>
                </div>
                <textarea
                  value={projectEditor.manualContext}
                  onChange={(event) => {
                    setProjectContextDirty(true);
                    setProjectEditor((prev) => ({ ...prev, manualContext: event.target.value }));
                  }}
                  className="w-full min-h-[100px] rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs"
                  placeholder="Contexto manual base del proyecto"
                />
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Contexto automático</p>
                  <pre className="mt-1 text-[11px] text-zinc-300 whitespace-pre-wrap break-words max-h-36 overflow-auto">
                    {String(selectedProject.autoContext || '').trim() || 'Aún no hay memoria automática.'}
                  </pre>
                  <p className="mt-1 text-[10px] text-zinc-500">
                    Última actualización: {selectedProject.autoUpdatedAt ? formatDate(selectedProject.autoUpdatedAt) : 'nunca'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void onUpdateProject(selectedProject.id, {
                      name: projectEditor.name,
                      contextMode: projectEditor.contextMode,
                      autoContextEnabled: projectEditor.autoContextEnabled,
                      manualContext: projectEditor.manualContext
                    }).catch((error: any) => {
                      window.alert(error?.message || 'No se pudo guardar el contexto');
                    });
                    setProjectContextDirty(false);
                  }}
                  disabled={!projectContextDirty}
                  className={`w-full rounded-lg px-3 py-2 text-xs border flex items-center justify-center gap-1.5 ${
                    projectContextDirty
                      ? 'border-blue-500/40 text-blue-200 bg-blue-600/15'
                      : 'border-zinc-700 text-zinc-500 bg-zinc-950'
                  }`}
                >
                  <Save size={13} /> Guardar contexto del proyecto
                </button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSelectionMode((prev) => !prev)}
              className={`w-full border rounded-xl px-3 py-2.5 text-sm ${
                selectionMode
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-200'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300'
              }`}
              type="button"
            >
              {selectionMode ? 'Cancelar selección' : 'Seleccionar chats'}
            </button>
            {selectionMode ? (
              <button
                onClick={handleSelectAllToggle}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-300"
                type="button"
              >
                {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
              </button>
            ) : (
              <button onClick={() => onNavigate('search')} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-zinc-400 text-left flex items-center justify-center gap-2" type="button">
                <Search size={18} /> Search chats...
              </button>
            )}
          </div>

          {(backgroundNotices || []).map((backgroundNotice) => (
            <div
              key={`hub-notice:${backgroundNotice.jobId}`}
              className={`w-full rounded-xl border px-2.5 py-2 text-[11px] ${
                backgroundNotice.tone === 'error'
                  ? 'border-red-500/40 text-red-300'
                  : backgroundNotice.tone === 'success'
                    ? 'border-emerald-500/40 text-emerald-300'
                    : 'border-cyan-500/40 text-cyan-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex items-start gap-2">
                  {backgroundNotice.loading ? (
                    <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  ) : null}
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium leading-relaxed whitespace-normal break-words">{backgroundNotice.text}</p>
                    {backgroundNotice.details ? (
                      <p className="mt-1 text-[10px] leading-relaxed opacity-95 whitespace-normal break-words">
                        {backgroundNotice.details}
                      </p>
                    ) : null}
                  </div>
                </div>
                {backgroundNotice.canDismiss && !backgroundNotice.loading && onDismissBackgroundNotice ? (
                  <button
                    type="button"
                    onClick={() => onDismissBackgroundNotice(backgroundNotice.jobId)}
                    className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-current/35 flex items-center justify-center opacity-90 hover:opacity-100"
                    aria-label="Cerrar aviso"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}

          {selectionMode ? (
            <button
              onClick={handleDeleteSelected}
              disabled={selectedCount === 0}
              className={`w-full rounded-xl px-3 py-2.5 text-sm font-medium border ${
                selectedCount > 0
                  ? 'bg-red-600/20 border-red-500/40 text-red-200'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500'
              }`}
              type="button"
            >
              Eliminar seleccionados ({selectedCount})
            </button>
          ) : null}
        </div>

        <div className="px-4 py-2 space-y-2">
          {visibleConversations.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-400">
              {selectedProject ? 'No hay chats en este proyecto todavía.' : 'No hay conversaciones aún.'}
            </div>
          ) : (
            visibleConversations.map((conversation) => {
              const isRunning = runningConversationIds.includes(conversation.id);
              const fullTitle = normalizeTitle(conversation.title);
              const shortTitle = truncateTitle(fullTitle);
              return (
                <div
                  key={conversation.id}
                  className={`w-full p-4 rounded-2xl border transition-colors ${
                    activeConversationId === conversation.id
                      ? 'bg-blue-500/10 border-blue-500/50'
                      : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => {
                        if (selectionMode) {
                          toggleSelection(conversation.id);
                          return;
                        }
                        onOpenChat(conversation.id);
                      }}
                      className="min-w-0 flex items-center gap-2 text-left flex-1"
                      type="button"
                    >
                      {selectionMode ? (
                        <span
                          className={`h-4 w-4 rounded border shrink-0 ${
                            selectedChatIds.includes(conversation.id)
                              ? 'bg-blue-500 border-blue-400'
                              : 'border-zinc-600'
                          }`}
                          aria-label={selectedChatIds.includes(conversation.id) ? 'Seleccionado' : 'No seleccionado'}
                        />
                      ) : null}
                      {isRunning ? (
                        <span
                          className="h-3.5 w-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0"
                          aria-label="Chat en ejecución"
                        />
                      ) : null}
                      <h4 className="font-medium truncate" title={fullTitle} aria-label={fullTitle}>
                        {shortTitle}
                      </h4>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500 whitespace-nowrap">{formatDate(conversation.last_message_at || conversation.created_at)}</span>
                      {!selectionMode ? (
                        <>
                          <button
                            onClick={() => {
                              const currentTitle = normalizeTitle(conversation.title);
                              const requestedTitle = window.prompt('Nuevo titulo del chat', currentTitle);
                              if (requestedTitle === null) return;
                              void onRenameChat(conversation.id, requestedTitle);
                            }}
                            className="w-8 h-8 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-blue-200 hover:border-blue-400/60"
                            type="button"
                            aria-label="Renombrar chat"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm('¿Eliminar este chat definitivamente?')) {
                                onDeleteChat(conversation.id);
                              }
                            }}
                            className="w-8 h-8 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-red-300 hover:border-red-400/60"
                            type="button"
                            aria-label="Eliminar chat"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
                    <div className="text-[11px] text-zinc-500 truncate">
                      Proyecto: {conversation.project?.name || 'Sin proyecto'}
                    </div>
                    <select
                      value={Number.isInteger(Number(conversation.projectId)) && Number(conversation.projectId) > 0 ? String(conversation.projectId) : ''}
                      onChange={(event) => {
                        const value = String(event.target.value || '').trim();
                        const nextProjectId = value ? Number(value) : null;
                        void onMoveChatToProject(
                          conversation.id,
                          Number.isInteger(nextProjectId) ? nextProjectId : null
                        ).catch((error: any) => {
                          window.alert(error?.message || 'No se pudo mover el chat');
                        });
                      }}
                      className="w-full sm:w-auto rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200"
                    >
                      <option value="">Sin proyecto</option>
                      {projects.map((project) => (
                        <option key={`chat-move:${conversation.id}:${project.id}`} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      <BottomNav active="chats" onNavigate={onNavigate} />
    </div>
  );
}
