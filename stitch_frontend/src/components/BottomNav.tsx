import { MessageSquare, Settings, Terminal, FolderOpen } from 'lucide-react';
import type { Screen } from '../lib/types';

export default function BottomNav({
  active,
  onNavigate
}: {
  active: 'chats' | 'projects' | 'tools' | 'settings';
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <nav className="fixed bottom-0 w-full bg-black/90 backdrop-blur-xl border-t border-zinc-900 pb-safe pt-2 px-2 z-50">
      <div className="flex justify-around items-center pb-4">
        <button type="button" onClick={() => onNavigate('hub')} className={`flex flex-col items-center gap-1 p-2 ${active === 'chats' ? 'text-blue-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
          <MessageSquare size={24} className={active === 'chats' ? 'fill-blue-500/20' : ''} />
          <span className="text-[10px] font-medium">Chats</span>
        </button>
        <button type="button" onClick={() => onNavigate('attachments')} className={`flex flex-col items-center gap-1 p-2 ${active === 'projects' ? 'text-blue-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
          <FolderOpen size={24} />
          <span className="text-[10px] font-medium">Files</span>
        </button>
        <button type="button" onClick={() => onNavigate('terminal')} className={`flex flex-col items-center gap-1 p-2 ${active === 'tools' ? 'text-blue-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
          <Terminal size={24} />
          <span className="text-[10px] font-medium">Tools</span>
        </button>
        <button type="button" onClick={() => onNavigate('settings')} className={`flex flex-col items-center gap-1 p-2 ${active === 'settings' ? 'text-blue-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
          <Settings size={24} />
          <span className="text-[10px] font-medium">Settings</span>
        </button>
      </div>
    </nav>
  );
}
