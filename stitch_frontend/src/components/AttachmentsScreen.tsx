import { ChevronLeft, RefreshCw, Plus, X, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import BottomNav from './BottomNav';
import type { AttachmentItem, Screen } from '../lib/types';

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AttachmentsScreen({
  selectedFiles,
  attachments,
  onPickFiles,
  onRemoveSelected,
  onDeleteAttachment,
  onRefresh,
  onNavigate
}: {
  selectedFiles: File[];
  attachments: AttachmentItem[];
  onPickFiles: (files: File[]) => void;
  onRemoveSelected: (name: string) => void;
  onDeleteAttachment: (attachmentId: string) => void;
  onRefresh: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [expandedChats, setExpandedChats] = useState<Record<number, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return attachments;
    return attachments.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.conversationTitle.toLowerCase().includes(q)
    );
  }, [attachments, query]);

  const groupedByConversation = useMemo(() => {
    const groups = new Map<
      number,
      {
        conversationId: number;
        conversationTitle: string;
        latestAt: string;
        totalSize: number;
        items: AttachmentItem[];
      }
    >();
    filtered.forEach((item) => {
      const conversationId = Number(item.conversationId);
      if (!Number.isInteger(conversationId) || conversationId <= 0) return;
      if (!groups.has(conversationId)) {
        groups.set(conversationId, {
          conversationId,
          conversationTitle: String(item.conversationTitle || 'Chat'),
          latestAt: String(item.uploadedAt || ''),
          totalSize: 0,
          items: []
        });
      }
      const group = groups.get(conversationId);
      if (!group) return;
      group.items.push(item);
      group.totalSize += Math.max(0, Number(item.size) || 0);
      const currentLatest = Date.parse(group.latestAt || '');
      const candidate = Date.parse(String(item.uploadedAt || ''));
      if (!Number.isFinite(currentLatest) || (Number.isFinite(candidate) && candidate > currentLatest)) {
        group.latestAt = String(item.uploadedAt || group.latestAt || '');
      }
    });
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: group.items
          .slice()
          .sort((a, b) => Date.parse(b.uploadedAt || '') - Date.parse(a.uploadedAt || ''))
      }))
      .sort((a, b) => Date.parse(b.latestAt || '') - Date.parse(a.latestAt || ''));
  }, [filtered]);

  const autoExpandAll = query.trim().length > 0;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="bg-black px-4 py-3 sticky top-0 z-40 border-b border-zinc-900">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => onNavigate('hub')} className="p-2 -ml-2 text-zinc-400 hover:text-white" type="button">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-semibold tracking-tight">Attachments</h1>
          <button onClick={onRefresh} className="text-blue-500 font-medium text-sm flex items-center gap-1" type="button">
            <RefreshCw size={14} /> Refrescar
          </button>
        </div>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files..."
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
        />
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-6">
        <section>
          <h3 className="text-xs text-zinc-500 uppercase mb-2">Pendientes</h3>
          {selectedFiles.length === 0 ? <div className="text-sm text-zinc-500">No hay adjuntos pendientes.</div> : null}
          <div className="space-y-2">
            {selectedFiles.map((file) => (
              <div key={file.name + file.size} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white truncate">{file.name}</p>
                  <p className="text-xs text-zinc-500">{formatBytes(file.size)}</p>
                </div>
                <button onClick={() => onRemoveSelected(file.name)} className="w-7 h-7 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white" type="button">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-xs text-zinc-500 uppercase mb-2">En servidor (por chat)</h3>
          <div className="space-y-2">
            {groupedByConversation.length === 0 ? (
              <div className="text-sm text-zinc-500">No hay adjuntos.</div>
            ) : null}
            {groupedByConversation.map((group) => {
              const expanded = autoExpandAll || Boolean(expandedChats[group.conversationId]);
              return (
                <article
                  key={group.conversationId}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden"
                  onMouseEnter={() => {
                    setExpandedChats((prev) => {
                      if (prev[group.conversationId]) return prev;
                      return { ...prev, [group.conversationId]: true };
                    });
                  }}
                >
                  <button
                    type="button"
                    className="w-full text-left px-3 py-3 hover:bg-zinc-900/70"
                    onClick={() => {
                      setExpandedChats((prev) => ({
                        ...prev,
                        [group.conversationId]: !prev[group.conversationId]
                      }));
                    }}
                  >
                    <p className="text-sm text-white truncate">
                      {expanded ? '▾' : '▸'} {group.conversationTitle}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {group.items.length} archivo{group.items.length === 1 ? '' : 's'} · {formatBytes(group.totalSize)}
                      {group.latestAt ? ` · ${formatDate(group.latestAt)}` : ''}
                    </p>
                  </button>
                  {expanded ? (
                    <div className="border-t border-zinc-800 p-2 space-y-2">
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-white truncate">{item.name}</p>
                            <p className="text-xs text-zinc-500">
                              {formatBytes(item.size)} · {formatDate(item.uploadedAt)}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              if (window.confirm(`¿Eliminar adjunto ${item.name} definitivamente?`)) {
                                onDeleteAttachment(item.id);
                              }
                            }}
                            className="w-8 h-8 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-red-300 hover:border-red-400/60 shrink-0"
                            type="button"
                            aria-label="Eliminar adjunto"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </main>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.currentTarget.files ? (Array.from(event.currentTarget.files) as File[]) : [];
          if (files.length > 0) onPickFiles(files);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
      <button onClick={() => inputRef.current?.click()} className="fixed bottom-24 right-4 w-14 h-14 bg-white rounded-full flex items-center justify-center text-black" type="button">
        <Plus size={26} />
      </button>

      <BottomNav active="projects" onNavigate={onNavigate} />
    </div>
  );
}
