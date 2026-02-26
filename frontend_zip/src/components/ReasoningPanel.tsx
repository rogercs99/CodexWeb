import { ChevronDown, Brain, ChevronRight, Download } from 'lucide-react';

export default function ReasoningPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
      <div className="bg-black border border-zinc-800 rounded-t-[32px] h-[85vh] flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.8)] animate-in slide-in-from-bottom-full duration-300">
        <header className="flex items-center justify-between px-6 py-5 border-b border-zinc-900 bg-black/50 backdrop-blur-xl z-20 sticky top-0 rounded-t-[32px]">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-900 transition-colors">
              <ChevronDown size={24} />
            </button>
            <h2 className="text-base font-semibold tracking-wide">Reasoning Chain</h2>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-50"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
            </div>
            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest font-mono">Complete</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-8">
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden">
            <div className="flex justify-between items-start mb-6 relative z-10">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Brain size={20} className="text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                  <span className="text-sm font-medium text-white">Codex-v4-Turbo</span>
                </div>
                <div className="text-xs text-zinc-500 font-mono pl-7">Model ID: cx-9921</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold font-mono text-white tracking-tight">1.24s</div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mt-0.5">Latency</div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-px bg-zinc-800 rounded-lg overflow-hidden border border-zinc-700 relative z-10">
              <div className="bg-zinc-950 p-3 flex flex-col items-center">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Input Tokens</span>
                <span className="font-mono text-white font-medium">452</span>
              </div>
              <div className="bg-zinc-950 p-3 flex flex-col items-center">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Output Tokens</span>
                <span className="font-mono text-white font-medium">128</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 ml-1">Process Log</h3>
            <div className="space-y-1">
              <div className="group border border-transparent hover:border-zinc-800 rounded-xl p-3 transition-colors">
                <div className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="w-6 h-6 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center text-xs font-mono font-bold shadow-[0_0_10px_rgba(59,130,246,0.2)]">01</div>
                    <span className="text-sm font-medium font-mono">Intent Parsing</span>
                  </div>
                  <ChevronRight size={20} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                </div>
              </div>
              
              <div className="border border-zinc-800 bg-zinc-900/30 rounded-xl p-3">
                <div className="flex items-center justify-between cursor-pointer mb-3">
                  <div className="flex items-center gap-4">
                    <div className="w-6 h-6 rounded bg-zinc-800 text-white border border-zinc-700 flex items-center justify-center text-xs font-mono font-bold">02</div>
                    <span className="text-sm font-medium font-mono">Structural Analysis</span>
                  </div>
                  <ChevronDown size={20} className="text-zinc-400" />
                </div>
                <div className="pl-10 pr-2 pb-2">
                  <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
                    Scanned snippet. Detected <code className="bg-zinc-800 text-white px-1 rounded font-mono">IndentationError</code> in lines 12-15.
                  </p>
                  <div className="bg-black border border-zinc-800 rounded-lg overflow-hidden">
                    <div className="bg-zinc-900 px-3 py-1.5 border-b border-zinc-800 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">diff_check.py</div>
                    <div className="p-3 font-mono text-[11px] leading-relaxed">
                      <div className="flex"><span className="text-zinc-700 w-6 select-none">12</span><span className="text-zinc-300">def calculate_metrics(data):</span></div>
                      <div className="flex"><span className="text-zinc-700 w-6 select-none">13</span><span className="text-zinc-500 pl-4"># Checking depth...</span></div>
                      <div className="flex bg-red-500/10 -mx-3 px-3 border-l-2 border-red-500/50"><span className="text-zinc-700 w-6 select-none">14</span><span className="text-red-400 pl-4">if not data:</span></div>
                      <div className="flex bg-red-500/10 -mx-3 px-3 border-l-2 border-red-500/50"><span className="text-zinc-700 w-6 select-none">15</span><span className="text-red-400 pl-8">return None</span></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="group border border-transparent hover:border-zinc-800 rounded-xl p-3 transition-colors">
                <div className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="w-6 h-6 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center text-xs font-mono font-bold shadow-[0_0_10px_rgba(59,130,246,0.2)]">03</div>
                    <span className="text-sm font-medium font-mono">Syntax Validation</span>
                  </div>
                  <ChevronRight size={20} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                </div>
              </div>
            </div>
          </div>
        </main>

        <footer className="p-6 border-t border-zinc-900 bg-black/50 backdrop-blur-xl">
          <button className="w-full py-3.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded-xl border border-zinc-800 flex items-center justify-center gap-2 transition-colors font-mono tracking-wide">
            <Download size={18} className="text-zinc-400" />
            EXPORT_LOG.JSON
          </button>
        </footer>
      </div>
    </div>
  );
}
