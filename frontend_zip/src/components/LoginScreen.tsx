import { ChevronLeft, Bot } from 'lucide-react';
import { useState } from 'react';

export default function LoginScreen({
  onLogin,
  status
}: {
  onLogin: (username: string, password: string) => void;
  status: string;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="min-h-screen flex flex-col bg-black px-6 py-12">
      <button className="text-zinc-500 flex items-center gap-1 mb-12 hover:text-white transition-colors w-fit" type="button">
        <ChevronLeft size={20} />
        <span>Help</span>
      </button>

      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        <div className="w-16 h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-8 shadow-2xl">
          <Bot size={32} className="text-white" />
        </div>

        <h1 className="text-3xl font-semibold mb-2 tracking-tight">Welcome back</h1>
        <p className="text-zinc-400 mb-8">Sign in to access CodexWeb</p>

        <form
          className="w-full space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onLogin(username.trim(), password);
          }}
        >
          <input
            type="text"
            placeholder="Usuario"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3.5 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            required
          />

          <input
            type="password"
            placeholder="Contraseña"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3.5 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            required
          />

          <button
            type="submit"
            className="w-full bg-white text-black font-semibold rounded-xl py-3.5 mt-4 hover:bg-zinc-200 transition-colors active:scale-[0.98]"
          >
            Sign In
          </button>

          {status ? <p className="text-sm text-zinc-400 text-center">{status}</p> : null}
        </form>
      </div>
    </div>
  );
}
