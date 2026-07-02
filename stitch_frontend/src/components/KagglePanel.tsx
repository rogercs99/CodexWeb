import { useState, useEffect, useRef } from 'react';
import type { KaggleJob, KaggleJobOutput, KaggleMultiAgentOptions } from '../lib/types';
import {
  kaggleSubmit,
  kaggleSubmitMultiAgent,
  kaggleGetStatus,
  kaggleGetOutput,
  kaggleListJobs,
  kagglePollComplete,
  kaggleDeleteJob,
  kaggleGetOutputDownloadUrl,
  kaggleGetFileDownloadUrl
} from '../lib/api';

interface KagglePanelProps {
  onClose: () => void;
  initialCode?: string;
}

type SubmitMode = 'simple' | 'autoretry';

export default function KagglePanel({ onClose, initialCode = '' }: KagglePanelProps) {
  const [code, setCode] = useState(initialCode);
  const [submitMode, setSubmitMode] = useState<SubmitMode>('simple');
  const [primaryAgent, setPrimaryAgent] = useState<'claude' | 'codex'>('claude');
  const [maxRetries, setMaxRetries] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<KaggleJob | null>(null);
  const [jobOutput, setJobOutput] = useState<KaggleJobOutput | null>(null);
  const [recentJobs, setRecentJobs] = useState<KaggleJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'submit' | 'jobs'>('submit');
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadRecentJobs();
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  async function loadRecentJobs() {
    try {
      const jobs = await kaggleListJobs(20);
      setRecentJobs(jobs);
    } catch (err) {
      console.error('Error loading Kaggle jobs:', err);
    }
  }

  async function handleSubmit() {
    if (!code.trim()) {
      setError('El codigo no puede estar vacio');
      return;
    }
    setError(null);
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
      startPolling(result.jobId);
    } catch (err: any) {
      setError(err.message || 'Error de conexion');
      setSubmitting(false);
    }
  }

  function startPolling(jobId: string) {
    setPolling(true);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await kaggleGetStatus(jobId);
        setJobStatus(status);

        if (status.status === 'complete' || status.status === 'error' || status.status === 'cancelled') {
          stopPolling();
          setSubmitting(false);
          if (status.status === 'complete') {
            const output = await kaggleGetOutput(jobId);
            setJobOutput(output);
          }
          loadRecentJobs();
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000);
  }

  function stopPolling() {
    setPolling(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  async function handleViewJob(jobId: string) {
    setActiveJobId(jobId);
    setTab('submit');
    try {
      const status = await kaggleGetStatus(jobId);
      setJobStatus(status);
      if (status.status === 'complete') {
        const output = await kaggleGetOutput(jobId);
        setJobOutput(output);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteJob(jobId: string) {
    try {
      await kaggleDeleteJob(jobId);
      loadRecentJobs();
      if (activeJobId === jobId) {
        setActiveJobId(null);
        setJobStatus(null);
        setJobOutput(null);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'complete': return 'text-green-400';
      case 'error': return 'text-red-400';
      case 'running': return 'text-yellow-400';
      case 'queued':
      case 'pending': return 'text-blue-400';
      default: return 'text-gray-400';
    }
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'complete': return '✓';
      case 'error': return '✗';
      case 'running': return '⟳';
      case 'queued':
      case 'pending': return '…';
      default: return '?';
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#2a2a4a]">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏔️</span>
            <h2 className="text-lg font-semibold text-white">Kaggle Remote Execution</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#2a2a4a]">
          <button
            onClick={() => setTab('submit')}
            className={`px-4 py-2 text-sm font-medium ${
              tab === 'submit'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Enviar Codigo
          </button>
          <button
            onClick={() => { setTab('jobs'); loadRecentJobs(); }}
            className={`px-4 py-2 text-sm font-medium ${
              tab === 'jobs'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Jobs Recientes ({recentJobs.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {tab === 'submit' ? (
            <div className="space-y-4">
              {/* Code Editor */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Codigo Python</label>
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="# Escribe tu codigo Python aqui..."
                  className="w-full h-48 bg-[#0d0d1a] border border-[#2a2a4a] rounded p-3 text-white font-mono text-sm resize-none focus:outline-none focus:border-blue-500"
                  disabled={submitting}
                />
              </div>

              {/* Submit Options */}
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-400">Modo:</label>
                  <select
                    value={submitMode}
                    onChange={(e) => setSubmitMode(e.target.value as SubmitMode)}
                    className="bg-[#0d0d1a] border border-[#2a2a4a] rounded px-2 py-1 text-white text-sm"
                    disabled={submitting}
                  >
                    <option value="simple">Simple</option>
                    <option value="autoretry">Auto-Retry (Multi-Agent)</option>
                  </select>
                </div>

                {submitMode === 'autoretry' && (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-400">Agente primario:</label>
                      <select
                        value={primaryAgent}
                        onChange={(e) => setPrimaryAgent(e.target.value as 'claude' | 'codex')}
                        className="bg-[#0d0d1a] border border-[#2a2a4a] rounded px-2 py-1 text-white text-sm"
                        disabled={submitting}
                      >
                        <option value="claude">Claude</option>
                        <option value="codex">Codex</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-400">Max retries:</label>
                      <input
                        type="number"
                        value={maxRetries}
                        onChange={(e) => setMaxRetries(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                        min={1}
                        max={10}
                        className="bg-[#0d0d1a] border border-[#2a2a4a] rounded px-2 py-1 text-white text-sm w-16"
                        disabled={submitting}
                      />
                    </div>
                  </>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={submitting || !code.trim()}
                  className={`px-4 py-2 rounded font-medium text-sm ${
                    submitting || !code.trim()
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {submitting ? 'Ejecutando...' : 'Enviar a Kaggle'}
                </button>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-300 text-sm">
                  {error}
                </div>
              )}

              {/* Job Status */}
              {(jobStatus || polling) && (
                <div className="bg-[#0d0d1a] border border-[#2a2a4a] rounded p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-xl ${getStatusColor(jobStatus?.status || 'pending')}`}>
                      {getStatusIcon(jobStatus?.status || 'pending')}
                    </span>
                    <div>
                      <div className="text-white font-medium">
                        Job: {activeJobId}
                      </div>
                      <div className={`text-sm ${getStatusColor(jobStatus?.status || 'pending')}`}>
                        {jobStatus?.status || 'Iniciando...'}
                        {jobStatus?.executionSeconds && ` (${jobStatus.executionSeconds}s)`}
                      </div>
                    </div>
                  </div>

                  {/* Logs */}
                  {jobStatus?.logs && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-500 mb-1">Logs:</div>
                      <pre className="bg-black/50 rounded p-2 text-xs text-gray-300 max-h-32 overflow-auto whitespace-pre-wrap">
                        {jobStatus.logs}
                      </pre>
                    </div>
                  )}

                  {/* Error */}
                  {jobStatus?.error && (
                    <div className="mt-3 bg-red-900/20 border border-red-800 rounded p-2">
                      <div className="text-xs text-red-400">{jobStatus.error}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Output Files */}
              {jobOutput && jobOutput.files.length > 0 && (
                <div className="bg-[#0d0d1a] border border-[#2a2a4a] rounded p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-white font-medium">Archivos de salida</h3>
                    <a
                      href={kaggleGetOutputDownloadUrl(jobOutput.jobId)}
                      className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded"
                    >
                      Descargar Todo (ZIP)
                    </a>
                  </div>
                  <div className="space-y-2">
                    {jobOutput.files.map((file) => (
                      <div
                        key={file.name}
                        className="flex items-center justify-between bg-black/30 rounded p-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400">📄</span>
                          <span className="text-white text-sm">{file.name}</span>
                          <span className="text-xs text-gray-500">
                            ({(file.size / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                        <a
                          href={kaggleGetFileDownloadUrl(jobOutput.jobId, file.name)}
                          className="text-xs text-blue-400 hover:text-blue-300"
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
              {recentJobs.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  No hay jobs recientes
                </div>
              ) : (
                recentJobs.map((job) => (
                  <div
                    key={job.jobId}
                    className="flex items-center justify-between bg-[#0d0d1a] border border-[#2a2a4a] rounded p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-lg ${getStatusColor(job.status)}`}>
                        {getStatusIcon(job.status)}
                      </span>
                      <div>
                        <div className="text-white text-sm font-mono">
                          {job.jobId}
                        </div>
                        <div className="text-xs text-gray-500">
                          {job.createdAt || 'Sin fecha'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(job.status)} bg-black/30`}>
                        {job.status}
                      </span>
                      <button
                        onClick={() => handleViewJob(job.jobId)}
                        className="text-xs text-blue-400 hover:text-blue-300 px-2"
                      >
                        Ver
                      </button>
                      <button
                        onClick={() => handleDeleteJob(job.jobId)}
                        className="text-xs text-red-400 hover:text-red-300 px-2"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
