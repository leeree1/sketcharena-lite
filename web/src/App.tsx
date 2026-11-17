import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, getToken, setToken } from './api';
import { User } from './types';
import Auth from './components/Auth';
import Knowledge from './components/Knowledge';
import Lobby from './components/Lobby';
import Moderation from './components/Moderation';
import Admin from './components/Admin';
import ProposeWord from './components/ProposeWord';
import Room from './components/Room';

export type ToastTone = 'info' | 'error' | 'success';
interface ToastItem { id: number; text: string; tone: ToastTone }

// Kontekst: dane dostępne w każdym komponencie (gracz, połączenie WebSocket, komunikaty, nawigacja)
interface Ctx { user: User; socket: Socket | null; toast: (text: string, tone?: ToastTone) => void; openRoom: (code: string) => void; openArticle: (slug: string) => void }
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

type View = 'lobby' | 'kb' | 'mod' | 'admin';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(!!getToken());
  const [socket, setSocket] = useState<Socket | null>(null);
  const [view, setView] = useState<View>('lobby');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [articleSlug, setArticleSlug] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [proposing, setProposing] = useState(false);
  const nextId = useRef(0);

  const toast = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = ++nextId.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const logout = useCallback(() => { setToken(null); setUser(null); setRoomCode(null); setView('lobby'); }, []);

  useEffect(() => {
    if (!getToken()) return;
    api<{ user: User }>('GET', '/auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setBooting(false));
  }, []);

  // Jedno połączenie WebSocket na całą sesję gracza (token JWT w handshake)
  useEffect(() => {
    if (!user) { setSocket(null); return; }
    const s = io('/', { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    s.on('connect_error', (e) => {
      if (e.message === 'UNAUTHORIZED') { toast('Sesja wygasła. Zaloguj się ponownie.', 'error'); logout(); }
      if (e.message === 'BANNED') { toast('Twoje konto jest zablokowane.', 'error'); logout(); }
    });
    setSocket(s);
    return () => { s.close(); };
  }, [user?.id, toast, logout]);

  const ctx = useMemo<Ctx | null>(() => user ? {
    user, socket, toast,
    openRoom: (code) => setRoomCode(code),
    openArticle: (slug) => { setArticleSlug(slug); setView('kb'); setRoomCode(null); },
  } : null, [user, socket, toast]);

  if (booting) return <div className="grid h-full place-items-center text-slate-500">Ładowanie…</div>;

  const toastView = (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${t.tone === 'error' ? 'bg-rose-600' : t.tone === 'success' ? 'bg-emerald-600' : 'bg-slate-800'}`}>{t.text}</div>)}
    </div>
  );

  if (!user || !ctx) return <>{toastView}<Auth onAuth={(u, token) => { setToken(token); setUser(u); }} toast={toast} /></>;

  const isStaff = user.role === 'MODERATOR' || user.role === 'ADMIN';
  const tabs: { id: View; label: string }[] = [{ id: 'lobby', label: 'Lobby' }, { id: 'kb', label: 'Baza wiedzy' }, ...(isStaff ? [{ id: 'mod' as View, label: 'Moderacja' }] : []), ...(user.role === 'ADMIN' ? [{ id: 'admin' as View, label: 'Administracja' }] : [])];

  return (
    <AppCtx.Provider value={ctx}>
      {toastView}
      {proposing && <ProposeWord onClose={() => setProposing(false)} />}
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
            <button onClick={() => setRoomCode(null)} className="text-lg font-extrabold tracking-tight text-indigo-700">SketchArena</button>
            {!roomCode && (
              <nav className="ml-2 flex gap-1" aria-label="Główna nawigacja">
                {tabs.map((t) => (
                  <button key={t.id} onClick={() => { setView(t.id); if (t.id !== 'kb') setArticleSlug(null); }} aria-current={view === t.id ? 'page' : undefined}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${view === t.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>{t.label}</button>
                ))}
              </nav>
            )}
            <div className="ml-auto flex items-center gap-3">
              {user.role !== 'GUEST' && <button onClick={() => setProposing(true)} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">💡 Zaproponuj hasło</button>}
              <span className="max-w-32 truncate text-sm font-semibold text-slate-700">{user.username}</span>
            </div>
            <button onClick={logout} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">Wyloguj</button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
          {/* Lobby zostaje w pamięci (tylko ukryte), dzięki czemu rozmowa z botem nie znika po przejściu do bazy wiedzy lub pokoju */}
          <div className={!roomCode && view === 'lobby' ? '' : 'hidden'}><Lobby /></div>
          {roomCode && <Room key={roomCode} code={roomCode} onLeave={() => setRoomCode(null)} />}
          {!roomCode && view === 'kb' && <Knowledge initialSlug={articleSlug} />}
          {!roomCode && view === 'mod' && isStaff && <Moderation />}
          {!roomCode && view === 'admin' && user.role === 'ADMIN' && <Admin />}
        </main>
      </div>
    </AppCtx.Provider>
  );
}
