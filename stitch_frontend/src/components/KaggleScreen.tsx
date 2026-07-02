import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, Cloud, Play, RefreshCw, Trash2, Download, Eye, Clock, CheckCircle, XCircle, Loader2, Cpu, Bot, MessageCircle, Code, FileText, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { KaggleJob, KaggleJobOutput, KaggleMultiAgentOptions, Screen } from '../lib/types';
import {
  kaggleSubmit,
  kaggleSubmitMultiAgent,
  kaggleGetStatus,
  kaggleGetOutput,
  kaggleListJobs,
  kaggleDeleteJob,
  kaggleDeleteAllJobs,
  kaggleGetJobDetails,
  kaggleGetOutputDownloadUrl,
  kaggleGetFileDownloadUrl,
  type KaggleJobDetails
} from '../lib/api';
import BottomNav from './BottomNav';

type SubmitMode = 'simple' | 'autoretry';
type KaggleTab = 'submit' | 'jobs';

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

function formatDateTime(value: string): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('es-ES', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function KaggleScreen({
  filterChatId,
  onClearFilter,
  onNavigate
}: {
  filterChatId?: number | null;
  onClearFilter?: () => void;
  onNavigate: (screen: Screen, data?: { chatId?: number }) => void;
}) {
  const [tab, setTab] = useState<KaggleTab>(filterChatId ? 'jobs' : 'submit');
  const [code, setCode] = useState('');
  const [submitMode, setSubmitMode] = useState<SubmitMode>('simple');
  const [primaryAgent, setPrimaryAgent] = useState<'claude' | 'codex'>('claude');
  const [maxRetries, setMaxRetries] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<KaggleJob | null>(null);
  const [jobOutput, setJobOutput] = useState<KaggleJobOutput | null>(null);
  const [recentJobs, setRecentJobs] = useState<KaggleJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobDetails, setJobDetails] = useState<KaggleJobDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRecentJobs = useCallback(async (silent = false) => {
    if (!silent) setJobsLoading(true);
    try {
      const jobs = await kaggleListJobs(30);
      setRecentJobs(jobs);
    } catch (err) {
      if (!silent) setError('Error cargando jobs');
    } finally {
      if (!silent) setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecentJobs();
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [loadRecentJobs]);

  useEffect(() => {
    if (tab !== 'jobs') return;
    const interval = setInterval(() => loadRecentJobs(true), 5000);
    return () => clearInterval(interval);
  }, [tab, loadRecentJobs]);

  const startPolling = useCallback((jobId: string) => {
    setPolling(true);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await kaggleGetStatus(jobId);
        setJobStatus(status);

        if (status.status === 'complete' || status.status === 'error' || status.status === 'cancelled') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setPolling(false);
          setSubmitting(false);
          if (status.status === 'complete') {
            const output = await kaggleGetOutput(jobId);
            setJobOutput(output);
          }
          loadRecentJobs(true);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000);
  }, [loadRecentJobs]);

  async function handleSubmit() {
    if (!code.trim()) {
      setError('El codigo no puede estar vacio');
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    setJobStatus(null);
    setJobOutput(null);

    try {
      let result;
      if (submitMode === 'autoretry') {
        const options: KaggleMultiAgentOptions = {
          primaryAgent,
          enableClaude: true,
          enableCodex: true,
          maxRetries
        };
        result = await kaggleSubmitMultiAgent(code, options);
      } else {
        result = await kaggleSubmit(code);
      }

      if (!result.ok) {
        setError(result.error || 'Error al enviar');
        setSubmitting(false);
        return;
      }

      setActiveJobId(result.jobId);
      setNotice(`Job ${result.jobId} enviado a Kaggle`);
      startPolling(result.jobId);
    } catch (err: any) {
      setError(err.message || 'Error de conexion');
      setSubmitting(false);
    }
  }

  async function handleViewJob(jobId: string) {
    setActiveJobId(jobId);
    setTab('submit');
    setError(null);
    setNotice(null);
    try {
      const status = await kaggleGetStatus(jobId);
      setJobStatus(status);
      if (status.status === 'complete') {
        const output = await kaggleGetOutput(jobId);
        setJobOutput(output);
      } else {
        setJobOutput(null);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteJob(jobId: string) {
    try {
      await kaggleDeleteJob(jobId);
      setNotice('Job eliminado');
      loadRecentJobs(true);
      if (activeJobId === jobId) {
        setActiveJobId(null);
        setJobStatus(null);
        setJobOutput(null);
      }
      if (expandedJobId === jobId) {
        setExpandedJobId(null);
        setJobDetails(null);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteAllJobs() {
    setDeletingAll(true);
    try {
      const result = await kaggleDeleteAllJobs();
      setNotice(`Historial eliminado: ${result.deletedCount} jobs`);
      setRecentJobs([]);
      setExpandedJobId(null);
      setJobDetails(null);
      setShowDeleteConfirm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingAll(false);
    }
  }

  async function handleToggleExpand(jobId: string) {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      setJobDetails(null);
      return;
    }

    setExpandedJobId(jobId);
    setLoadingDetails(true);
    try {
      const details = await kaggleGetJobDetails(jobId);
      setJobDetails(details);
    } catch (err: any) {
      setError(`Error cargando detalles: ${err.message}`);
    } finally {
      setLoadingDetails(false);
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'complete': return <CheckCircle size={16} className="text-green-400" />;
      case 'error': return <XCircle size={16} className="text-red-400" />;
      case 'running': return <Loader2 size={16} className="text-yellow-400 animate-spin" />;
      case 'queued':
      case 'pending': return <Clock size={16} className="text-blue-400" />;
      default: return <Clock size={16} className="text-zinc-500" />;
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'complete': return 'text-green-400';
      case 'error': return 'text-red-400';
      case 'running': return 'text-yellow-400';
      case 'queued':
      case 'pending': return 'text-blue-400';
      default: return 'text-zinc-500';
    }
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-lg">
        <button
          type="button"
          onClick={() => onNavigate('hub')}
          className="p-1.5 -ml-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-2">
          <Cloud size={22} className="text-cyan-400" />
          <h1 className="text-lg font-semibold">Kaggle</h1>
        </div>
        <span className="text-xs text-zinc-500 ml-auto">Remote Execution</span>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 bg-zinc-900/50">
        <button
          type="button"
          onClick={() => setTab('submit')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            tab === 'submit'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Enviar Codigo
        </button>
        <button
          type="button"
          onClick={() => { setTab('jobs'); loadRecentJobs(); }}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            tab === 'jobs'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Jobs ({recentJobs.length})
        </button>
      </div>

      {/* Notices */}
      {error && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-cyan-900/30 border border-cyan-700/50 text-cyan-300 text-sm">
          {notice}
        </div>
      )}

      {/* Content */}
      <main className="flex-1 overflow-auto px-4 py-4 pb-28">
        {tab === 'submit' ? (
          <div className="space-y-4">
            {/* Code Editor */}
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Codigo Python</label>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="# Escribe tu codigo Python aqui...&#10;&#10;import pandas as pd&#10;print('Hello Kaggle!')"
                className="w-full h-52 bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-white font-mono text-sm resize-none focus:outline-none focus:border-cyan-500 placeholder:text-zinc-600"
                disabled={submitting}
              />
            </div>

            {/* Submit Options */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm text-zinc-400">Modo:</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSubmitMode('simple')}
                    disabled={submitting}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      submitMode === 'simple'
                        ? 'bg-cyan-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    <Cpu size={14} className="inline mr-1.5" />
                    Simple
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmitMode('autoretry')}
                    disabled={submitting}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      submitMode === 'autoretry'
                        ? 'bg-purple-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    <Bot size={14} className="inline mr-1.5" />
                    Auto-Retry
                  </button>
                </div>
              </div>

              {submitMode === 'autoretry' && (
                <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-zinc-800">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-zinc-400">Agente:</label>
                    <select
                      value={primaryAgent}
                      onChange={(e) => setPrimaryAgent(e.target.value as 'claude' | 'codex')}
                      className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-cyan-500"
                      disabled={submitting}
                    >
                      <option value="claude">Claude</option>
                      <option value="codex">Codex</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-zinc-400">Max retries:</label>
                    <input
                      type="number"
                      value={maxRetries}
                      onChange={(e) => setMaxRetries(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                      min={1}
                      max={10}
                      className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-white text-sm w-16 focus:outline-none focus:border-cyan-500"
                      disabled={submitting}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !code.trim()}
              className={`w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
                submitting || !code.trim()
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white'
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Ejecutando en Kaggle...
                </>
              ) : (
                <>
                  <Play size={18} />
                  Enviar a Kaggle
                </>
              )}
            </button>

            {/* Active Job Status */}
            {(jobStatus || polling) && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  {getStatusIcon(jobStatus?.status || 'pending')}
                  <div className="flex-1">
                    <div className="text-white font-medium text-sm">
                      Job: {activeJobId}
                    </div>
                    <div className={`text-xs ${getStatusColor(jobStatus?.status || 'pending')}`}>
                      {jobStatus?.status || 'Iniciando...'}
                      {jobStatus?.executionSeconds ? ` (${jobStatus.executionSeconds}s)` : ''}
                    </div>
                  </div>
                </div>

                {jobStatus?.logs && (
                  <div className="mt-3">
                    <div className="text-xs text-zinc-500 mb-1">Logs:</div>
                    <pre className="bg-black/50 rounded-lg p-3 text-xs text-zinc-300 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                      {jobStatus.logs}
                    </pre>
                  </div>
                )}

                {jobStatus?.error && (
                  <div className="mt-3 bg-red-900/20 border border-red-800/50 rounded-lg p-3">
                    <div className="text-xs text-red-400">{jobStatus.error}</div>
                  </div>
                )}
              </div>
            )}

            {/* Output Files */}
            {jobOutput && jobOutput.files && jobOutput.files.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-medium text-sm">Archivos de salida</h3>
                  <a
                    href={kaggleGetOutputDownloadUrl(jobOutput.jobId)}
                    className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                  >
                    <Download size={14} />
                    Descargar Todo
                  </a>
                </div>
                <div className="space-y-2">
                  {jobOutput.files.map((file) => (
                    <div
                      key={file.name}
                      className="flex items-center justify-between bg-black/30 rounded-lg p-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-zinc-400 shrink-0">📄</span>
                        <span className="text-white text-sm truncate">{file.name}</span>
                        <span className="text-xs text-zinc-500 shrink-0">
                          ({formatBytes(file.size)})
                        </span>
                      </div>
                      <a
                        href={kaggleGetFileDownloadUrl(jobOutput.jobId, file.name)}
                        className="text-xs text-cyan-400 hover:text-cyan-300 shrink-0 ml-2"
                      >
                        Descargar
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Jobs Tab */
          <div className="space-y-2">
            {/* Filter indicator, Refresh and Delete All buttons */}
            <div className="flex items-center justify-between mb-3 gap-2">
              {filterChatId ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-cyan-400 flex items-center gap-1">
                    <MessageCircle size={14} />
                    Mostrando jobs del Chat #{filterChatId}
                  </span>
                  <button
                    type="button"
                    onClick={onClearFilter}
                    className="text-xs text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded transition-colors"
                  >
                    Ver todos
                  </button>
                </div>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                {recentJobs.length > 0 && !showDeleteConfirm && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5 transition-colors bg-red-900/20 hover:bg-red-900/30 px-2 py-1 rounded"
                  >
                    <Trash2 size={14} />
                    Eliminar historial
                  </button>
                )}
                {showDeleteConfirm && (
                  <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded px-2 py-1">
                    <AlertTriangle size={14} className="text-red-400" />
                    <span className="text-xs text-red-300">¿Eliminar todos los jobs?</span>
                    <button
                      type="button"
                      onClick={handleDeleteAllJobs}
                      disabled={deletingAll}
                      className="text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                    >
                      {deletingAll ? 'Eliminando...' : 'Sí'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="text-xs text-zinc-400 hover:text-white px-2 py-0.5 rounded transition-colors"
                    >
                      No
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => loadRecentJobs()}
                  disabled={jobsLoading}
                  className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw size={14} className={jobsLoading ? 'animate-spin' : ''} />
                  Actualizar
                </button>
              </div>
            </div>

            {(() => {
              const filteredJobs = filterChatId
                ? recentJobs.filter(j => j.chatId === filterChatId)
                : recentJobs;

              if (jobsLoading && recentJobs.length === 0) {
                return (
                  <div className="flex items-center justify-center py-12 text-zinc-500">
                    <Loader2 size={24} className="animate-spin mr-2" />
                    Cargando jobs...
                  </div>
                );
              }

              if (filteredJobs.length === 0) {
                return (
                  <div className="text-center text-zinc-500 py-12">
                    {filterChatId ? `No hay jobs para el Chat #${filterChatId}` : 'No hay jobs recientes'}
                  </div>
                );
              }

              return filteredJobs.map((job) => (
                <div
                  key={job.jobId}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden"
                >
                  {/* Job Header */}
                  <div className="flex items-center gap-3 p-3">
                    <div className="shrink-0">
                      {getStatusIcon(job.status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-mono truncate">
                        {job.jobId}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <span>{formatDateTime(job.createdAt || '')}</span>
                        {job.chatId && (
                          <button
                            type="button"
                            onClick={() => onNavigate('chat', { chatId: job.chatId! })}
                            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                            title="Ir al chat de origen"
                          >
                            <MessageCircle size={12} />
                            <span>Chat #{job.chatId}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(job.status)} bg-black/30 shrink-0`}>
                      {job.status}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleExpand(job.jobId)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          expandedJobId === job.jobId
                            ? 'text-cyan-400 bg-cyan-900/30'
                            : 'text-zinc-400 hover:text-cyan-400 hover:bg-zinc-800'
                        }`}
                        title={expandedJobId === job.jobId ? 'Ocultar detalles' : 'Ver detalles'}
                      >
                        {expandedJobId === job.jobId ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteJob(job.jobId)}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedJobId === job.jobId && (
                    <div className="border-t border-zinc-800 p-3 space-y-3">
                      {loadingDetails ? (
                        <div className="flex items-center justify-center py-4 text-zinc-500">
                          <Loader2 size={20} className="animate-spin mr-2" />
                          Cargando detalles...
                        </div>
                      ) : jobDetails ? (
                        <>
                          {/* Code Section */}
                          {jobDetails.code && (
                            <div>
                              <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
                                <Code size={14} />
                                <span>Código de entrada</span>
                              </div>
                              <pre className="bg-black/50 rounded-lg p-3 text-xs text-green-300 max-h-48 overflow-auto whitespace-pre-wrap font-mono">
                                {jobDetails.code}
                              </pre>
                            </div>
                          )}

                          {/* Logs Section */}
                          {jobDetails.logs && (
                            <div>
                              <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
                                <FileText size={14} />
                                <span>Logs de ejecución</span>
                              </div>
                              <div className="space-y-2">
                                {jobDetails.logs.stdout && (
                                  <div>
                                    <div className="text-xs text-green-400 mb-1">stdout:</div>
                                    <pre className="bg-black/50 rounded-lg p-3 text-xs text-zinc-300 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                                      {jobDetails.logs.stdout}
                                    </pre>
                                  </div>
                                )}
                                {jobDetails.logs.stderr && (
                                  <div>
                                    <div className="text-xs text-red-400 mb-1">stderr:</div>
                                    <pre className="bg-black/50 rounded-lg p-3 text-xs text-red-300 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                                      {jobDetails.logs.stderr}
                                    </pre>
                                  </div>
                                )}
                                {!jobDetails.logs.stdout && !jobDetails.logs.stderr && jobDetails.logs.raw && (
                                  <pre className="bg-black/50 rounded-lg p-3 text-xs text-zinc-300 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                                    {jobDetails.logs.raw}
                                  </pre>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Output Files Section */}
                          {jobDetails.files && jobDetails.files.length > 0 && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-xs text-zinc-400">
                                  <Download size={14} />
                                  <span>Archivos de output ({jobDetails.files.length})</span>
                                </div>
                                <a
                                  href={kaggleGetOutputDownloadUrl(job.jobId)}
                                  className="text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded flex items-center gap-1 transition-colors"
                                >
                                  <Download size={12} />
                                  Descargar todo
                                </a>
                              </div>
                              <div className="space-y-1">
                                {jobDetails.files.map((file) => (
                                  <div
                                    key={file.name}
                                    className="flex items-center justify-between bg-black/30 rounded-lg p-2"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-zinc-400 shrink-0">
                                        {file.isLog ? '📋' : '📄'}
                                      </span>
                                      <span className="text-white text-xs truncate">{file.name}</span>
                                      <span className="text-xs text-zinc-500 shrink-0">
                                        ({formatBytes(file.size)})
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <a
                                        href={kaggleGetFileDownloadUrl(job.jobId, file.name)}
                                        className="text-xs text-cyan-400 hover:text-cyan-300"
                                      >
                                        Descargar
                                      </a>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* No content message */}
                          {!jobDetails.code && !jobDetails.logs && (!jobDetails.files || jobDetails.files.length === 0) && (
                            <div className="text-center text-zinc-500 py-4 text-sm">
                              No hay datos disponibles para este job
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-center text-zinc-500 py-4 text-sm">
                          Error cargando detalles
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ));
            })()}
          </div>
        )}
      </main>

      <BottomNav active="kaggle" onNavigate={onNavigate} />
    </div>
  );
}
