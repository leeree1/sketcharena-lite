import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../App';
import { Category, Difficulty, DIFFICULTY_LABEL, RoomSummary } from '../types';
import ChatbotPanel from './ChatbotPanel';
import { Badge, Button, Card, DifficultyBadge, Empty, inputCls, Label } from './ui';

export default function Lobby() {
  const { toast, openRoom } = useApp();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [filter, setFilter] = useState<Difficulty | ''>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [code, setCode] = useState('');
  const [form, setForm] = useState({ difficulty: 'EASY' as Difficulty, categorySlug: '', maxPlayers: 8, roundTimeSeconds: 80, rounds: 3, isPrivate: false });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api<{ rooms: RoomSummary[] }>('GET', `/rooms${filter ? `?difficulty=${filter}` : ''}`); setRooms(r.rooms); } catch { /* następna próba za chwilę */ }
  }, [filter]);

  useEffect(() => { void load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  useEffect(() => { api<{ categories: Category[] }>('GET', '/kb/categories').then((r) => setCategories(r.categories)).catch(() => undefined); }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault(); setCreating(true);
    try {
      const r = await api<{ code: string }>('POST', '/rooms', { ...form, categorySlug: form.categorySlug || null });
      openRoom(r.code);
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Nie udało się utworzyć pokoju.', 'error'); } finally { setCreating(false); }
  };
  const joinByCode = (e: FormEvent) => { e.preventDefault(); if (code.trim().length >= 4) openRoom(code.trim().toUpperCase()); };
  const catName = (slug: string | null) => categories.find((c) => c.slug === slug)?.name;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <Card title="Pokoje publiczne" action={
          <div className="flex gap-1" role="group" aria-label="Filtr poziomu trudności">
            {(['', 'EASY', 'MEDIUM', 'HARD'] as const).map((d) => (
              <button key={d} onClick={() => setFilter(d)} aria-pressed={filter === d} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${filter === d ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{d ? DIFFICULTY_LABEL[d] : 'Wszystkie'}</button>
            ))}
          </div>}>
          {rooms === null ? <Empty>Wczytuję pokoje…</Empty> : rooms.length === 0 ? <Empty>Nie ma teraz otwartych pokoi. Utwórz własny albo poproś bota o dobranie gry.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {rooms.map((r) => (
                <li key={r.code} className="flex items-center gap-3 py-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-50 font-mono text-xs font-bold text-indigo-700">{r.code}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5"><span className="truncate text-sm font-semibold">Pokój gracza {r.hostName}</span><DifficultyBadge d={r.difficulty} />{r.category && <Badge>{catName(r.category) ?? r.category}</Badge>}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{r.players}/{r.maxPlayers} graczy · {r.rounds} rund · {r.roundTimeSeconds} s na turę · {r.status === 'LOBBY' ? 'czeka na start' : 'trwa gra'}</div>
                  </div>
                  <Button size="sm" disabled={r.players >= r.maxPlayers} onClick={() => openRoom(r.code)}>{r.players >= r.maxPlayers ? 'Pełny' : 'Dołącz'}</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-5 md:grid-cols-[1fr_260px]">
          <Card title="Utwórz pokój">
            <form onSubmit={create} className="space-y-3">
              <div>
                <Label>Poziom trudności</Label>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-semibold" role="radiogroup" aria-label="Poziom trudności">
                  {(['EASY', 'MEDIUM', 'HARD'] as const).map((d) => <button type="button" key={d} role="radio" aria-checked={form.difficulty === d} onClick={() => setForm({ ...form, difficulty: d })} className={`rounded-md py-1.5 ${form.difficulty === d ? 'bg-white text-indigo-700 shadow' : 'text-slate-600'}`}>{DIFFICULTY_LABEL[d]}</button>)}
                </div>
              </div>
              <div><Label htmlFor="cat">Kategoria haseł</Label>
                <select id="cat" className={inputCls} value={form.categorySlug} onChange={(e) => setForm({ ...form, categorySlug: e.target.value })}><option value="">Wszystkie kategorie</option>{categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label htmlFor="mp">Gracze</Label><input id="mp" type="number" min={2} max={12} className={inputCls} value={form.maxPlayers} onChange={(e) => setForm({ ...form, maxPlayers: Number(e.target.value) })} /></div>
                <div><Label htmlFor="rt">Czas tury (s)</Label><input id="rt" type="number" min={20} max={180} step={10} className={inputCls} value={form.roundTimeSeconds} onChange={(e) => setForm({ ...form, roundTimeSeconds: Number(e.target.value) })} /></div>
                <div><Label htmlFor="rd">Rundy</Label><input id="rd" type="number" min={1} max={10} className={inputCls} value={form.rounds} onChange={(e) => setForm({ ...form, rounds: Number(e.target.value) })} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.isPrivate} onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600" /> Pokój prywatny (tylko z kodem)</label>
              <Button type="submit" disabled={creating} className="w-full">{creating ? 'Tworzę…' : 'Utwórz pokój'}</Button>
            </form>
          </Card>
          <Card title="Dołącz kodem">
            <form onSubmit={joinByCode} className="space-y-3">
              <div><Label htmlFor="code">Kod pokoju</Label><input id="code" className={`${inputCls} text-center font-mono text-lg uppercase tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="ABC123" /></div>
              <Button type="submit" variant="secondary" disabled={code.trim().length < 4} className="w-full">Dołącz</Button>
            </form>
            <p className="mt-3 text-xs text-slate-500">Kod dostajesz od gospodarza pokoju. Możesz też zapytać chatbota o wolne pokoje.</p>
          </Card>
        </div>
      </div>
      <ChatbotPanel />
    </div>
  );
}
