import {
  ArrowLeft,
  CheckSquare,
  ChevronRight,
  Folder,
  FolderOpen,
  LogOut,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import BottomNav from './BottomNav';
import type { ChatProject, Conversation, ProjectContextMode, Screen, User } from '../lib/types';

const TITLE_MAX_LENGTH = 40;

type HubView = 'home' | 'projects' | 'project' | 'project-settings';

function formatDate(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizeTitle(value: string | null | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed || 'Nuevo chat';
}

function truncateTitle(value: string, maxLength = TITLE_MAX_LENGTH) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function hasProjectAssigned(projectId: number | null | undefined): boolean {
  const parsed = Number(projectId);
  return Number.isInteger(parsed) && parsed > 0;
}

function modeLabel(mode: ProjectContextMode): string {
  if (mode === 'manual') return 'manual';
  if (mode === 'automatic') return 'automático';
  return 'mixto';
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
  const [hubView, setHubView] = useState<HubView>('home');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

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

  const isDevInstance = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const host = String(window.location.hostname || '').toLowerCase();
    return host.includes('codexwebdev') || host.includes('localhost') || host.includes('127.0.0.1') || host.includes('.dev');
  }, []);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '')),
    [projects]
  );

  const selectedProject = useMemo(
    () =>
      Number.isInteger(Number(selectedProjectId)) && Number(selectedProjectId) > 0
        ? projects.find((item) => item.id === Number(selectedProjectId)) || null
        : null,
    [projects, selectedProjectId]
  );

  const unassignedConversations = useMemo(
    () => conversations.filter((item) => !hasProjectAssigned(item.projectId)),
    [conversations]
  );

  const projectConversations = useMemo(() => {
    if (!selectedProject) return [];
    return conversations.filter((item) => Number(item.projectId) === Number(selectedProject.id));
  }, [conversations, selectedProject]);

  const baseConversations = useMemo(() => {
    if (hubView === 'home') return unassignedConversations;
    if (hubView === 'project') return projectConversations;
    return [];
  }, [hubView, projectConversations, unassignedConversations]);

  const visibleConversations = useMemo(() => {
    if (hubView !== 'project') return baseConversations;
    const query = String(searchTerm || '').trim().toLowerCase();
    if (!query) return baseConversations;
    return baseConversations.filter((item) => normalizeTitle(item.title).toLowerCase().includes(query));
  }, [baseConversations, hubView, searchTerm]);

  useEffect(() => {
    if (hubView !== 'project' && hubView !== 'project-settings') return;
    if (selectedProject) return;
    setHubView('projects');
  }, [hubView, selectedProject]);

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

  const openHome = () => {
    setHubView('home');
    setSelectionMode(false);
    setSelectedChatIds([]);
    setSearchTerm('');
    onSelectProject(null);
  };

  const openProjects = () => {
    setHubView('projects');
    setSelectionMode(false);
    setSelectedChatIds([]);
    setSearchTerm('');
  };

  const openProject = (projectId: number) => {
    onSelectProject(projectId);
    setHubView('project');
    setSelectionMode(false);
    setSelectedChatIds([]);
    setSearchTerm('');
  };

  const openProjectSettings = () => {
    if (!selectedProject) return;
    setHubView('project-settings');
    setSelectionMode(false);
    setSelectedChatIds([]);
    setSearchTerm('');
  };

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

  const renderSelectionModeButton = () => (
    <button
      onClick={() => setSelectionMode((prev) => !prev)}
      className={`w-8 h-8 rounded-lg border text-xs flex items-center justify-center ${
        selectionMode
          ? 'bg-blue-600/20 border-blue-500/40 text-blue-200'
          : 'bg-zinc-900 border-zinc-800 text-zinc-300'
      }`}
      type="button"
      aria-label={selectionMode ? 'Cancelar selección' : 'Seleccionar chats'}
      title={selectionMode ? 'Cancelar selección' : 'Seleccionar chats'}
    >
      {selectionMode ? <X size={13} /> : <CheckSquare size={13} />}
    </button>
  );

  const handleCreateProject = async () => {
    const name = String(projectDraft.name || '').trim();
    if (!name) return;
    setProjectBusy(true);
    try {
      const created = await onCreateProject(projectDraft);
      setCreatingProject(false);
      setProjectDraft({
        name: '',
        contextMode: 'mixed',
        autoContextEnabled: true,
        manualContext: ''
      });
      onSelectProject(created.id);
      setHubView('project');
    } catch (error: any) {
      window.alert(error?.message || 'No se pudo crear el proyecto');
    } finally {
      setProjectBusy(false);
    }
  };

  const renderProjectCreateForm = () => {
    if (!creatingProject) return null;
    return (
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
              autoContextEnabled: event.target.value === 'manual' ? false : prev.autoContextEnabled
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
    );
  };

  const renderBackgroundNotices = () => (
    <>
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
    </>
  );

  const renderProjectList = () => {
    if (sortedProjects.length === 0) {
      return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
          No hay proyectos todavía. Crea el primero para agrupar chats y compartir contexto.
        </div>
      );
    }

    return sortedProjects.map((project) => (
      <div
        key={`project-card:${project.id}`}
        className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3"
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => openProject(project.id)}
            className="text-left min-w-0 flex-1"
          >
            <div className="flex items-center gap-2 text-base sm:text-lg font-semibold tracking-tight text-zinc-100">
              <FolderOpen size={18} className="text-blue-300" />
              <span className="truncate">{project.name}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-400">
              <span className="rounded-full border border-zinc-700 px-2 py-0.5">{project.stats?.chatCount || 0} chats</span>
              <span className="rounded-full border border-zinc-700 px-2 py-0.5">Modo {modeLabel(project.contextMode)}</span>
              <span className="rounded-full border border-zinc-700 px-2 py-0.5">
                Última actividad: {project.stats?.lastMessageAt ? formatDate(project.stats.lastMessageAt) : 'sin actividad'}
              </span>
            </div>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                onSelectProject(project.id);
                onCreateChat(project.id);
              }}
              className="h-8 rounded-lg border border-blue-500/40 bg-blue-600/15 px-2.5 text-xs text-blue-200"
              title="Crear chat en este proyecto"
            >
              + Chat
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`¿Eliminar proyecto "${project.name}"? Los chats quedarán sin proyecto.`)) return;
                void onDeleteProject(project.id).catch((error: any) => {
                  window.alert(error?.message || 'No se pudo eliminar el proyecto');
                });
              }}
              className="h-8 w-8 rounded-full border border-red-500/40 text-red-300 flex items-center justify-center"
              aria-label="Eliminar proyecto"
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              onClick={() => openProject(project.id)}
              className="h-8 w-8 rounded-full border border-zinc-700 text-zinc-300 flex items-center justify-center"
              aria-label="Entrar al proyecto"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {(project.manualContextPreview || project.autoContextPreview) ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Resumen de contexto</p>
            <p className="mt-1 text-[11px] text-zinc-300 whitespace-pre-wrap break-words">
              {String(project.manualContextPreview || project.autoContextPreview || '').trim()}
            </p>
          </div>
        ) : null}
      </div>
    ));
  };

  const renderProjectSettings = () => {
    if (!selectedProject) return null;

    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-300">Configuración y contexto del proyecto</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`¿Eliminar proyecto "${selectedProject.name}"? Los chats quedarán sin proyecto.`)) return;
                void onDeleteProject(selectedProject.id)
                  .then(() => {
                    setHubView('projects');
                  })
                  .catch((error: any) => {
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
          className="w-full min-h-[110px] rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs"
          placeholder="Contexto manual base del proyecto"
        />

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Contexto automático</p>
          <pre className="mt-1 text-[11px] text-zinc-300 whitespace-pre-wrap break-words max-h-40 overflow-auto">
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
            })
              .then(() => {
                setProjectContextDirty(false);
              })
              .catch((error: any) => {
                window.alert(error?.message || 'No se pudo guardar el contexto');
              });
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
      </section>
    );
  };

  const renderChatList = () => {
    if (visibleConversations.length === 0) {
      return (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-400">
          {hubView === 'project'
            ? 'No hay chats en este proyecto todavía.'
            : 'No hay chats sin proyecto todavía.'}
        </div>
      );
    }

    return visibleConversations.map((conversation) => {
      const isRunning = runningConversationIds.includes(conversation.id);
      const fullTitle = normalizeTitle(conversation.title);
      const shortTitle = truncateTitle(fullTitle);
      const projectName =
        hubView === 'project'
          ? selectedProject?.name || conversation.project?.name || ''
          : conversation.project?.name || '';
      const movePlaceholder = hasProjectAssigned(conversation.projectId) ? 'Quitar proyecto' : 'Mover a proyecto';
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
              <span className="text-xs text-zinc-500 whitespace-nowrap">
                {formatDate(conversation.last_message_at || conversation.created_at)}
              </span>
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

          <div className={`mt-2 grid grid-cols-1 ${projectName ? 'sm:grid-cols-[1fr_auto]' : 'sm:grid-cols-[auto]'} gap-2 items-center`}>
            {projectName ? (
              <div className="text-[11px] text-zinc-500 truncate">Proyecto: {projectName}</div>
            ) : null}
            <select
              value={hasProjectAssigned(conversation.projectId) ? String(conversation.projectId) : ''}
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
              <option value="">{movePlaceholder}</option>
              {sortedProjects.map((project) => (
                <option key={`chat-move:${conversation.id}:${project.id}`} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{isDevInstance ? 'CodexWeb DEV' : 'CodexWeb'}</h1>
          <p className="text-xs text-zinc-500">{user?.username || 'usuario'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500"
            type="button"
          >
            <RotateCcw size={16} />
          </button>
          <button
            onClick={onRestart}
            className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500"
            type="button"
          >
            <Power size={16} />
          </button>
          <button
            onClick={onLogout}
            className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500"
            type="button"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-28">
        <div className="px-4 py-4 sticky top-0 z-40 bg-black/80 backdrop-blur-xl space-y-2">
          {hubView === 'home' ? (
            <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
              <button
                type="button"
                onClick={() => onNavigate('search')}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 text-left text-zinc-300 flex items-center gap-2"
              >
                <Search size={14} className="text-zinc-500" />
                <span className="text-sm">Búsqueda global en todos los chats</span>
              </button>
              <div className="justify-self-end">{renderSelectionModeButton()}</div>
            </div>
          ) : null}

          {hubView === 'home' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => onCreateChat(null)}
                  className="w-full bg-white text-black py-3 rounded-xl font-medium flex items-center justify-center gap-2"
                  type="button"
                >
                  <Plus size={18} /> Nuevo chat
                </button>
                <button
                  onClick={openProjects}
                  className="w-full bg-zinc-900 border border-zinc-700 py-3 rounded-xl text-zinc-200 flex items-center justify-center gap-2"
                  type="button"
                >
                  <FolderOpen size={16} /> Proyectos
                </button>
              </div>
            </>
          ) : null}

          {hubView === 'projects' ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openHome}
                  className="h-9 px-3 rounded-xl border border-zinc-700 text-zinc-300 flex items-center gap-2"
                >
                  <ArrowLeft size={14} /> Chats
                </button>
                <button
                  onClick={() => setCreatingProject((prev) => !prev)}
                  className="h-9 px-3 rounded-xl border border-zinc-700 text-zinc-200 flex items-center gap-2"
                  type="button"
                >
                  <Plus size={14} /> {creatingProject ? 'Cancelar' : 'Nuevo proyecto'}
                </button>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-300">
                Proyectos ({sortedProjects.length}) · chats sin proyecto: {unassignedCount}
              </div>
              {renderProjectCreateForm()}
            </>
          ) : null}

          {hubView === 'project' && selectedProject ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={openProjects}
                  className="h-9 px-3 rounded-xl border border-zinc-700 text-zinc-300 flex items-center gap-2"
                >
                  <ArrowLeft size={14} /> Proyectos
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onCreateChat(selectedProject.id)}
                    className="h-8 px-2.5 rounded-lg border border-blue-500/40 bg-blue-600/15 text-blue-200 text-xs flex items-center gap-1.5"
                    type="button"
                  >
                    <Plus size={13} /> Nuevo chat
                  </button>
                  <button
                    onClick={openProjectSettings}
                    className="h-8 px-2.5 rounded-lg border border-zinc-700 text-zinc-300 text-xs flex items-center gap-1.5"
                    type="button"
                  >
                    <Settings2 size={13} /> Configurar
                  </button>
                  {renderSelectionModeButton()}
                </div>
              </div>
              <div className="rounded-xl border border-blue-500/30 bg-blue-600/10 px-3 py-2 text-xs text-blue-100">
                <div className="flex items-center gap-2">
                  <FolderOpen size={14} />
                  <span className="text-sm sm:text-base font-semibold tracking-tight">{selectedProject.name}</span>
                </div>
                <p className="mt-1 text-blue-100/90">
                  Chats del proyecto: {projectConversations.length} · Contexto: {modeLabel(selectedProject.contextMode)}
                </p>
              </div>
            </>
          ) : null}

          {hubView === 'project-settings' && selectedProject ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2">
              <button
                type="button"
                onClick={() => setHubView('project')}
                className="h-8 px-2.5 rounded-lg border border-zinc-700 text-zinc-300 text-xs flex items-center gap-1.5"
              >
                <ArrowLeft size={13} /> Chats del proyecto
              </button>
              <p className="text-xs text-zinc-400 truncate">Configuración: {selectedProject.name}</p>
            </div>
          ) : null}

          {renderBackgroundNotices()}

          {hubView === 'home' || hubView === 'project' ? (
            <>
              {hubView === 'project' || selectionMode ? (
                <div className={`grid gap-2 items-center ${hubView === 'project' ? 'grid-cols-1 sm:grid-cols-[1fr_auto]' : 'grid-cols-1'}`}>
                  {hubView === 'project' ? (
                    <label className="relative block">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 pl-9 pr-3 py-2.5 text-sm text-zinc-200"
                        placeholder="Buscar chats del proyecto..."
                      />
                    </label>
                  ) : null}
                  {selectionMode ? (
                    <button
                      onClick={handleSelectAllToggle}
                      className="w-full sm:w-auto h-8 px-2.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 text-xs"
                      type="button"
                    >
                      {allSelected ? 'Deseleccionar todo' : 'Seleccionar visibles'}
                    </button>
                  ) : null}
                </div>
              ) : null}

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
            </>
          ) : null}
        </div>

        <div className="px-4 py-2 space-y-3">
          {hubView === 'projects' ? renderProjectList() : null}
          {hubView === 'project-settings' ? renderProjectSettings() : null}
          {hubView === 'home' || hubView === 'project' ? renderChatList() : null}
        </div>
      </main>

      <BottomNav active="chats" onNavigate={onNavigate} />
    </div>
  );
}
