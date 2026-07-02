import { useState, useEffect, useRef, useCallback } from 'react';
import { Cloud, CheckCircle, XCircle, Loader2, Code, FileText, ChevronDown, ChevronUp, Download, Image as ImageIcon, RefreshCw } from 'lucide-react';
import type { KaggleJob, KaggleJobOutput, KaggleOutputFile } from '../lib/types';
import { kaggleGetStatus, kaggleGetOutput, kaggleGetJobDetails, kaggleGetFileDownloadUrl, kaggleGetOutputDownloadUrl, type KaggleJobDetails } from '../lib/api';

interface KaggleJobInlineProps {
  jobId: string;
  initialCode?: string;
  onComplete?: (output: KaggleJobOutput) => void;
  onError?: (error: string) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatInlineLogs(logs: KaggleJobDetails['logs']): string {
  if (!logs) return '';
  const parts: string[] = [];
  if (typeof logs.stdout === 'string' && logs.stdout.trim()) {
    parts.push(`stdout:\n${logs.stdout.trim()}`);
  }
  if (typeof logs.stderr === 'string' && logs.stderr.trim()) {
    parts.push(`stderr:\n${logs.stderr.trim()}`);
  }
  if (parts.length === 0 && typeof logs.raw === 'string' && logs.raw.trim()) {
    parts.push(logs.raw.trim());
  }
  return parts.join('\n\n');
}

function isTerminalKaggleStatus(status: string | null | undefined) {
  return status === 'complete' || status === 'error' || status === 'cancelled';
}

export default function KaggleJobInline({ jobId, initialCode, onComplete, onError }: KaggleJobInlineProps) {
  const [status, setStatus] = useState<KaggleJob['status']>('pending');
  const [logs, setLogs] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<KaggleOutputFile[]>([]);
  const [code, setCode] = useState<string>(initialCode || '');
  const [executionTime, setExecutionTime] = useState<number>(0);
  const [expandedSection, setExpandedSection] = useState<'code' | 'logs' | 'output' | null>(null);
  const [imagePreview, setImagePreview] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const imagePreviewRef = useRef<Record<string, string>>({});

  const isTerminal = isTerminalKaggleStatus(status);

  useEffect(() => {
    imagePreviewRef.current = imagePreview;
  }, [imagePreview]);

  const loadDetails = useCallback(async () => {
    try {
      const details = await kaggleGetJobDetails(jobId);
      if (details.code) setCode(details.code);
      if (details.logs) setLogs(formatInlineLogs(details.logs));
      setError(details.error || null);
      setStatus(details.status as KaggleJob['status']);
      if (typeof details.executionSeconds === 'number' && details.executionSeconds > 0) {
        setExecutionTime(details.executionSeconds);
      }
      return details;
    } catch (err) {
      console.error('Failed to load job details:', err);
      return null;
    }
  }, [jobId]);

  const loadOutput = useCallback(async () => {
    try {
      const output = await kaggleGetOutput(jobId);
      setFiles(output.files || []);
      if (output.logs) setLogs(output.logs);
      setError(output.error || null);
      setStatus(output.status);

      const imageFiles = (output.files || []).filter(f =>
        /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name)
      );
      for (const file of imageFiles) {
        if (!imagePreviewRef.current[file.name]) {
          try {
            const url = kaggleGetFileDownloadUrl(jobId, file.name);
            const response = await fetch(url, { credentials: 'include' });
            if (response.ok) {
              const blob = await response.blob();
              const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
              setImagePreview(prev => {
                if (prev[file.name]) {
                  return prev;
                }
                const next = { ...prev, [file.name]: dataUrl };
                imagePreviewRef.current = next;
                return next;
              });
            }
          } catch (imgErr) {
            console.error('Failed to load image preview:', imgErr);
          }
        }
      }

      if (output.status === 'complete') {
        onComplete?.(output);
      } else if (output.status === 'error') {
        onError?.(output.error || 'Execution failed');
      }
    } catch (err) {
      console.error('Failed to load output:', err);
    }
  }, [jobId, onComplete, onError]);

  const pollStatus = useCallback(async () => {
    try {
      const job = await kaggleGetStatus(jobId);
      setStatus(job.status);
      if (job.logs) setLogs(job.logs);
      setError(job.error || null);
      if (job.executionSeconds) setExecutionTime(job.executionSeconds);

      if (job.status === 'complete' || job.status === 'error' || job.status === 'cancelled') {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        await loadOutput();
      }
      return job.status;
    } catch (err) {
      console.error('Poll status failed:', err);
      return null;
    }
  }, [jobId, loadOutput]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      const details = await loadDetails();
      if (cancelled) return;

      if (isTerminalKaggleStatus(details?.status)) {
        await loadOutput();
        return;
      }

      const currentStatus = await pollStatus();
      if (cancelled || pollRef.current || isTerminalKaggleStatus(currentStatus)) {
        return;
      }

      pollRef.current = setInterval(() => {
        void pollStatus();
      }, 3000);
    };

    void initialize();

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [pollStatus, loadDetails, loadOutput]);

  useEffect(() => {
    if (!isTerminal) {
      const timer = setInterval(() => {
        setExecutionTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isTerminal]);

  const statusConfig = {
    pending: { icon: Loader2, color: 'text-zinc-400', bg: 'bg-zinc-800', label: 'Preparando...' },
    queued: { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-900/30', label: 'En cola...' },
    running: { icon: Loader2, color: 'text-cyan-400', bg: 'bg-cyan-900/30', label: 'Ejecutando...' },
    complete: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-900/30', label: 'Completado' },
    error: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-900/30', label: 'Error' },
    cancelled: { icon: XCircle, color: 'text-zinc-500', bg: 'bg-zinc-800', label: 'Cancelado' }
  };

  const cfg = statusConfig[status] || statusConfig.pending;
  const StatusIcon = cfg.icon;
  const isAnimated = status === 'pending' || status === 'queued' || status === 'running';

  const toggleSection = (section: 'code' | 'logs' | 'output') => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  const hasImages = files.some(f => /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name));

  return (
    <div className={`rounded-xl border ${cfg.bg} border-zinc-700/50 overflow-hidden my-3`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-700/50">
        <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center`}>
          <Cloud size={16} className={cfg.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">Kaggle Job</span>
            <code className="text-xs text-zinc-500 font-mono">{jobId.slice(0, 8)}</code>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusIcon size={12} className={`${cfg.color} ${isAnimated ? 'animate-spin' : ''}`} />
            <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
            {executionTime > 0 && (
              <span className="text-xs text-zinc-500">
                {Math.floor(executionTime / 60)}:{String(executionTime % 60).padStart(2, '0')}
              </span>
            )}
          </div>
        </div>
        {isTerminal && (
          <button
            onClick={() => loadOutput()}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            title="Recargar"
          >
            <RefreshCw size={14} className="text-zinc-400" />
          </button>
        )}
      </div>

      {/* Code Section */}
      {code && (
        <div className="border-b border-zinc-700/30">
          <button
            onClick={() => toggleSection('code')}
            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/5 transition-colors"
          >
            <Code size={14} className="text-blue-400" />
            <span className="text-xs font-medium text-zinc-300">Código enviado</span>
            <span className="text-xs text-zinc-500 ml-auto">{code.split('\n').length} líneas</span>
            {expandedSection === 'code' ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
          </button>
          {expandedSection === 'code' && (
            <div className="px-4 pb-3">
              <pre className="text-xs text-zinc-300 bg-black/40 rounded-lg p-3 overflow-x-auto max-h-60 overflow-y-auto font-mono">
                {code}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Logs Section */}
      {(logs || error) && (
        <div className="border-b border-zinc-700/30">
          <button
            onClick={() => toggleSection('logs')}
            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/5 transition-colors"
          >
            <FileText size={14} className={error ? 'text-red-400' : 'text-amber-400'} />
            <span className="text-xs font-medium text-zinc-300">
              {error ? 'Error de ejecución' : 'Logs'}
            </span>
            {logs && <span className="text-xs text-zinc-500 ml-auto">{logs.split('\n').length} líneas</span>}
            {expandedSection === 'logs' ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
          </button>
          {expandedSection === 'logs' && (
            <div className="px-4 pb-3">
              {error && (
                <div className="text-xs text-red-400 bg-red-900/20 rounded-lg p-3 mb-2 font-mono">
                  {error}
                </div>
              )}
              {logs && (
                <pre className="text-xs text-zinc-400 bg-black/40 rounded-lg p-3 overflow-x-auto max-h-60 overflow-y-auto font-mono whitespace-pre-wrap">
                  {logs}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Output Section */}
      {files.length > 0 && (
        <div>
          <button
            onClick={() => toggleSection('output')}
            className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/5 transition-colors"
          >
            <ImageIcon size={14} className="text-emerald-400" />
            <span className="text-xs font-medium text-zinc-300">Output</span>
            <span className="text-xs text-zinc-500 ml-auto">{files.length} archivo{files.length !== 1 ? 's' : ''}</span>
            {expandedSection === 'output' ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
          </button>
          {expandedSection === 'output' && (
            <div className="px-4 pb-3 space-y-3">
              {/* Image previews */}
              {hasImages && (
                <div className="grid grid-cols-2 gap-2">
                  {files
                    .filter(f => /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name))
                    .map(file => (
                      <div key={file.name} className="relative group">
                        {imagePreview[file.name] ? (
                          <img
                            src={imagePreview[file.name]}
                            alt={file.name}
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-900"
                          />
                        ) : (
                          <div className="aspect-square bg-zinc-900 rounded-lg border border-zinc-700 flex items-center justify-center">
                            <Loader2 size={20} className="text-zinc-600 animate-spin" />
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 rounded-b-lg">
                          <p className="text-xs text-white truncate">{file.name}</p>
                          <p className="text-xs text-zinc-400">{formatBytes(file.size)}</p>
                        </div>
                        <a
                          href={kaggleGetFileDownloadUrl(jobId, file.name)}
                          download={file.name}
                          className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Download size={12} className="text-white" />
                        </a>
                      </div>
                    ))}
                </div>
              )}
              {/* Other files */}
              {files.filter(f => !/\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name)).length > 0 && (
                <div className="space-y-1">
                  {files
                    .filter(f => !/\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name))
                    .map(file => (
                      <a
                        key={file.name}
                        href={kaggleGetFileDownloadUrl(jobId, file.name)}
                        download={file.name}
                        className="flex items-center gap-2 p-2 bg-zinc-800/50 rounded-lg hover:bg-zinc-800 transition-colors"
                      >
                        <FileText size={14} className="text-zinc-400" />
                        <span className="text-xs text-zinc-300 flex-1 truncate">{file.name}</span>
                        <span className="text-xs text-zinc-500">{formatBytes(file.size)}</span>
                        <Download size={12} className="text-zinc-400" />
                      </a>
                    ))}
                </div>
              )}
              {/* Download all */}
              <a
                href={kaggleGetOutputDownloadUrl(jobId)}
                download
                className="flex items-center justify-center gap-2 p-2 bg-emerald-900/30 border border-emerald-700/30 rounded-lg hover:bg-emerald-900/50 transition-colors"
              >
                <Download size={14} className="text-emerald-400" />
                <span className="text-xs font-medium text-emerald-400">Descargar todo (ZIP)</span>
              </a>
            </div>
          )}
        </div>
      )}

      {/* Auto-expand output when complete with images */}
      {isTerminal && hasImages && expandedSection === null && (
        <div className="px-4 pb-3">
          <div className="grid grid-cols-2 gap-2">
            {files
              .filter(f => /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name))
              .slice(0, 4)
              .map(file => (
                <div key={file.name} className="relative">
                  {imagePreview[file.name] ? (
                    <img
                      src={imagePreview[file.name]}
                      alt={file.name}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 cursor-pointer"
                      onClick={() => toggleSection('output')}
                    />
                  ) : (
                    <div className="aspect-square bg-zinc-900 rounded-lg border border-zinc-700 flex items-center justify-center">
                      <Loader2 size={20} className="text-zinc-600 animate-spin" />
                    </div>
                  )}
                </div>
              ))}
          </div>
          {files.filter(f => /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name)).length > 4 && (
            <button
              onClick={() => toggleSection('output')}
              className="w-full mt-2 text-xs text-zinc-400 hover:text-white transition-colors"
            >
              +{files.filter(f => /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f.name)).length - 4} más...
            </button>
          )}
        </div>
      )}
    </div>
  );
}
