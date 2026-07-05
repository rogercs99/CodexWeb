import React, { useState, useEffect } from 'react';
import {
  getRuntimeKaggleStatus,
  getRuntimeClaudePreflight,
  getRuntimeCodexPreflight
} from '../lib/api';

interface KaggleInfo {
  isKaggle: boolean;
  environment: string;
  info: {
    workingDir: string;
    paths: {
      app: string;
      runtime: string;
      workspace: string;
      db: string;
      uploads: string;
      public: string;
    };
  } | null;
}

interface PreflightResult {
  success: boolean;
  available: boolean;
  version?: string;
  bin?: string;
  error?: string;
}

export default function KaggleRuntimeScreen() {
  const [kaggleInfo, setKaggleInfo] = useState<KaggleInfo | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<PreflightResult | null>(null);
  const [codexStatus, setCodexStatus] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);

    try {
      const [kaggle, claude, codex] = await Promise.all([
        getRuntimeKaggleStatus(),
        getRuntimeClaudePreflight(),
        getRuntimeCodexPreflight()
      ]);

      setKaggleInfo(kaggle);
      setClaudeStatus(claude);
      setCodexStatus(codex);
    } catch (err: any) {
      setError(err.message || 'Failed to load runtime status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading runtime status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md">
          <h2 className="text-red-800 dark:text-red-300 font-bold mb-2">Error</h2>
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={loadStatus}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isKaggle = kaggleInfo?.isKaggle || false;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">
          Runtime Environment
        </h1>

        {/* Environment Status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            Environment
          </h2>

          <div className="flex items-center gap-3 mb-4">
            <div className={`w-3 h-3 rounded-full ${isKaggle ? 'bg-purple-500' : 'bg-blue-500'}`}></div>
            <span className="text-lg font-mono text-gray-900 dark:text-white">
              {kaggleInfo?.environment || 'unknown'}
            </span>
          </div>

          {isKaggle && kaggleInfo?.info && (
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded p-4">
              <h3 className="font-bold text-purple-900 dark:text-purple-300 mb-2">
                Kaggle Paths
              </h3>
              <div className="space-y-1 font-mono text-sm text-purple-800 dark:text-purple-400">
                <div><span className="font-bold">App:</span> {kaggleInfo.info.paths.app}</div>
                <div><span className="font-bold">Runtime:</span> {kaggleInfo.info.paths.runtime}</div>
                <div><span className="font-bold">Workspace:</span> {kaggleInfo.info.paths.workspace}</div>
                <div><span className="font-bold">Database:</span> {kaggleInfo.info.paths.db}</div>
              </div>
            </div>
          )}

          {!isKaggle && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-4">
              <p className="text-blue-800 dark:text-blue-300">
                Running on VPS — production or development environment
              </p>
            </div>
          )}
        </div>

        {/* Claude Code Status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            Claude Code
          </h2>

          {claudeStatus && (
            <div className={`p-4 rounded border ${
              claudeStatus.available
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${claudeStatus.available ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                <span className={`font-bold ${
                  claudeStatus.available
                    ? 'text-green-800 dark:text-green-300'
                    : 'text-yellow-800 dark:text-yellow-300'
                }`}>
                  {claudeStatus.available ? 'Available' : 'Not Available'}
                </span>
              </div>

              {claudeStatus.version && (
                <div className="font-mono text-sm text-gray-700 dark:text-gray-300 mb-1">
                  Version: {claudeStatus.version}
                </div>
              )}

              {claudeStatus.bin && (
                <div className="font-mono text-sm text-gray-700 dark:text-gray-300 mb-1">
                  Binary: {claudeStatus.bin}
                </div>
              )}

              {claudeStatus.error && (
                <div className="text-sm text-red-600 dark:text-red-400 mt-2">
                  Error: {claudeStatus.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Codex CLI Status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            Codex CLI
          </h2>

          {codexStatus && (
            <div className={`p-4 rounded border ${
              codexStatus.available
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${codexStatus.available ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                <span className={`font-bold ${
                  codexStatus.available
                    ? 'text-green-800 dark:text-green-300'
                    : 'text-yellow-800 dark:text-yellow-300'
                }`}>
                  {codexStatus.available ? 'Available' : 'Not Available'}
                </span>
              </div>

              {codexStatus.version && (
                <div className="font-mono text-sm text-gray-700 dark:text-gray-300 mb-1">
                  Version: {codexStatus.version}
                </div>
              )}

              {codexStatus.bin && (
                <div className="font-mono text-sm text-gray-700 dark:text-gray-300 mb-1">
                  Binary: {codexStatus.bin}
                </div>
              )}

              {codexStatus.error && (
                <div className="text-sm text-red-600 dark:text-red-400 mt-2">
                  Error: {codexStatus.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            Actions
          </h2>

          <button
            onClick={loadStatus}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            Refresh Status
          </button>
        </div>
      </div>
    </div>
  );
}
