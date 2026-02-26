import BottomNav from './BottomNav';
import type { Screen } from '../lib/types';

export default function OfflineErrorScreen({
  message,
  onRetry,
  onNavigate
}: {
  message: string;
  onRetry: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md border border-zinc-800 bg-zinc-900/40 rounded-2xl p-6 text-center">
          <h2 className="text-xl font-semibold mb-2">Sin conexión</h2>
          <p className="text-sm text-zinc-400 mb-5">{message}</p>
          <button onClick={onRetry} className="w-full bg-white text-black font-medium rounded-xl py-3 mb-2" type="button">
            Reintentar
          </button>
          <button onClick={() => onNavigate('hub')} className="w-full border border-zinc-700 text-zinc-300 rounded-xl py-3" type="button">
            Ir al chat
          </button>
        </div>
      </main>
      <BottomNav active="chats" onNavigate={onNavigate} />
    </div>
  );
}
