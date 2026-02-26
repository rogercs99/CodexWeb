import BottomNav from './BottomNav';
import type { Capabilities, ChatOptions, Screen } from '../lib/types';

export default function SettingsScreen({
  options,
  model,
  reasoningEffort,
  caps,
  onModelChange,
  onReasoningChange,
  onCapsChange,
  onNavigate
}: {
  options: ChatOptions;
  model: string;
  reasoningEffort: string;
  caps: Capabilities;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: string) => void;
  onCapsChange: (value: Capabilities) => void;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="bg-black px-4 py-3 border-b border-zinc-900 flex items-center justify-between sticky top-0 z-40 backdrop-blur-xl">
        <button onClick={() => onNavigate('hub')} className="text-zinc-400 hover:text-white" type="button">Cancel</button>
        <h1 className="text-base font-semibold tracking-tight">Settings</h1>
        <button onClick={() => onNavigate('hub')} className="text-blue-500 font-medium" type="button">Done</button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-28 space-y-6">
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs uppercase text-zinc-500">Modelo</h3>
          <select
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5"
          >
            <option value="">Automatico (default CLI)</option>
            {options.models.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs uppercase text-zinc-500">Razonamiento</h3>
          <select
            value={reasoningEffort}
            onChange={(event) => onReasoningChange(event.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5"
          >
            {options.reasoningEfforts.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </section>

        <section className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 space-y-4">
          <h3 className="text-xs uppercase text-zinc-500">Capabilities</h3>

          <label className="flex items-center justify-between text-sm">
            <span>Web Browsing</span>
            <input
              type="checkbox"
              checked={caps.web}
              onChange={(event) => onCapsChange({ ...caps, web: event.target.checked })}
            />
          </label>

          <label className="flex items-center justify-between text-sm">
            <span>Code Interpreter</span>
            <input
              type="checkbox"
              checked={caps.code}
              onChange={(event) => onCapsChange({ ...caps, code: event.target.checked })}
            />
          </label>

          <label className="flex items-center justify-between text-sm">
            <span>Long Term Memory</span>
            <input
              type="checkbox"
              checked={caps.memory}
              onChange={(event) => onCapsChange({ ...caps, memory: event.target.checked })}
            />
          </label>
        </section>
      </main>

      <BottomNav active="settings" onNavigate={onNavigate} />
    </div>
  );
}
