import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { User } from '../types';
import { Button, inputCls, Label } from './ui';

type Mode = 'guest' | 'login' | 'register';
const TITLES: Record<Mode, string> = { guest: 'Gość', login: 'Logowanie', register: 'Rejestracja' };

/** Ekran wejścia: gość (sam pseudonim), logowanie albo rejestracja konta */
export default function Auth({ onAuth, toast }: { onAuth: (u: User, token: string) => void; toast: (t: string, tone?: 'error' | 'success' | 'info') => void }) {
  const [mode, setMode] = useState<Mode>('guest');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const path = mode === 'guest' ? '/auth/guest' : mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'guest' ? { username } : mode === 'login' ? { email, password } : { username, email, password };
      const r = await api<{ token: string; user: User }>('POST', path, body);
      onAuth(r.user, r.token);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Nie udało się wejść do gry.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-indigo-50 via-white to-amber-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" aria-label="Wejście do gry">
        <h1 className="text-3xl font-extrabold tracking-tight">Sketch<span className="text-indigo-600">Arena</span></h1>
        <div className="mt-4 flex gap-1" role="tablist">
          {(Object.keys(TITLES) as Mode[]).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-selected={mode === m}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${mode === m ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>{TITLES[m]}</button>
          ))}
        </div>
        {mode !== 'login' && (
          <div className="mt-4"><Label htmlFor="username">Pseudonim</Label>
            <input id="username" className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="np. Ola" minLength={3} maxLength={20} required /></div>
        )}
        {mode !== 'guest' && (
          <>
            <div className="mt-4"><Label htmlFor="email">E-mail</Label>
              <input id="email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div className="mt-4"><Label htmlFor="password">Hasło</Label>
              <input id="password" type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></div>
          </>
        )}
        <Button type="submit" disabled={busy} className="mt-4 w-full">{busy ? 'Chwileczkę…' : mode === 'guest' ? 'Zagraj od razu' : mode === 'login' ? 'Zaloguj się' : 'Załóż konto'}</Button>
      </form>
    </div>
  );
}