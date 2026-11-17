import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { User } from '../types';
import { Button, inputCls, Label } from './ui';

/** Ekran wejścia do gry: wystarczy pseudonim (konto gościa) */
export default function Auth({ onAuth, toast }: { onAuth: (u: User, token: string) => void; toast: (t: string, tone?: 'error' | 'success' | 'info') => void }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ token: string; user: User }>('POST', '/auth/guest', { username });
      onAuth(r.user, r.token);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Nie udało się wejść do gry.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-indigo-50 via-white to-amber-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" aria-label="Wejście do gry">
        <h1 className="text-3xl font-extrabold tracking-tight">Sketch<span className="text-indigo-600">Arena</span></h1>
        <p className="mt-2 text-sm text-slate-600">Rysuj, zgaduj i rywalizuj ze znajomymi. Wystarczy pseudonim.</p>
        <div className="mt-5"><Label htmlFor="username">Pseudonim</Label>
          <input id="username" className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="np. Ola" minLength={3} maxLength={20} required autoFocus /></div>
        <Button type="submit" disabled={busy} className="mt-4 w-full">{busy ? 'Chwileczkę…' : 'Zagraj od razu'}</Button>
      </form>
    </div>
  );
}
