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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return attachments;
    return attachments.filter((item) => item.name.toLowerCase().includes(q) || item.conversationTitle.toLowerCase().includes(q));
  }, [attachments, query]);

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
          <h3 className="text-xs text-zinc-500 uppercase mb-2">En servidor</h3>
          <div className="space-y-2">
            {filtered.length === 0 ? <div className="text-sm text-zinc-500">No hay adjuntos.</div> : null}
            {filtered.map((item) => (
              <div key={item.id} className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{item.name}</p>
                  <p className="text-xs text-zinc-500">{formatBytes(item.size)} • {item.conversationTitle} • {formatDate(item.uploadedAt)}</p>
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
