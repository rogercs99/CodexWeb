import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

type BootMonitor = {
  mark?: (step: string, detail?: string) => void;
  markBooted?: () => void;
  showFatal?: (payload: { code?: string; stage?: string; message?: string; detail?: string }) => void;
};

declare global {
  interface Window {
    __CODEXWEB_BOOT_MONITOR__?: BootMonitor;
  }
}

function getBootMonitor(): BootMonitor | null {
  if (typeof window === 'undefined') return null;
  return window.__CODEXWEB_BOOT_MONITOR__ || null;
}

function reportBootstrapFailure(error: unknown) {
  const monitor = getBootMonitor();
  const message = error instanceof Error ? error.message : String(error || 'Unknown bootstrap error');
  const detail = error instanceof Error ? error.stack || message : message;
  monitor?.showFatal?.({
    code: 'APP_BOOTSTRAP_ERROR',
    stage: 'main_tsx',
    message,
    detail
  });
}

try {
  const rootNode = document.getElementById('root');
  if (!rootNode) {
    throw new Error('Missing #root mount node');
  }
  getBootMonitor()?.mark?.('APP_BOOTSTRAP_START', 'main.tsx render');
  createRoot(rootNode).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (error) {
  reportBootstrapFailure(error);
  throw error;
}
