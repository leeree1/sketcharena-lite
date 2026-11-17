import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../App';
import { AdminArticle, AdminWord, ARTICLE_TYPE_LABEL, Article, Category, Difficulty, DIFFICULTY_LABEL, Level } from '../types';
import { Badge, Button, Card, DifficultyBadge, Empty, inputCls, Label, Modal, Spinner } from './ui';

type Tab = 'articles' | 'words' | 'levels';
const TABS: { id: Tab; label: string }[] = [{ id: 'articles', label: 'Artykuły' }, { id: 'words', label: 'Hasła' }, { id: 'levels', label: 'Mnożniki punktów' }];
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Panel administratora: artykuły bazy wiedzy, hasła do gry i mnożniki punktów */
export default function Admin() {
  const [tab, setTab] = useState<Tab>('articles');
  return (
    <div className="space-y-4">
      <div className="flex gap-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-selected={tab === t.id}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'articles' && <Articles />}
      {tab === 'words' && <Words />}
      {tab === 'levels' && <Levels />}
    </div>
  );
}

// ---------- artykuły ----------
function Articles() {
  const { toast } = useApp();
  const [list, setList] = useState<AdminArticle[] | null>(null);
  const [editing, setEditing] = useState<AdminArticle | 'new' | null>(null);
  const load = useCallback(() => api<{ articles: AdminArticle[] }>('GET', '/admin/articles').then((r) => setList(r.articles)).catch((e) => toast(errMsg(e, 'Nie udało się pobrać artykułów.'), 'error')), [toast]);
  useEffect(() => { load(); }, [load]);
  return (
    <Card title="Artykuły bazy wiedzy" action={<Button size="sm" onClick={() => setEditing('new')}>+ Nowy artykuł</Button>}>
      {list === null ? <Spinner /> : list.length === 0 ? <Empty>Brak artykułów.</Empty> : (
        <ul className="divide-y divide-slate-100">{list.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{a.title}</div><div className="text-xs text-slate-500">{ARTICLE_TYPE_LABEL[a.type]} · /{a.slug}</div></div>
            <Badge tone={a.is_published ? 'emerald' : 'amber'}>{a.is_published ? 'opublikowany' : 'szkic'}</Badge>
            <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>Edytuj</Button>
          </li>))}
        </ul>
      )}
      {editing && <ArticleForm article={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Card>
  );
}

function ArticleForm({ article, onClose, onSaved }: { article: AdminArticle | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [title, setTitle] = useState(article?.title ?? '');
  const [type, setType] = useState<Article['type']>(article?.type ?? 'FAQ');
  const [content, setContent] = useState(article?.content ?? '');
  const [published, setPublished] = useState(article?.is_published ?? true);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { title, type, content, isPublished: published };
      if (article) await api('PUT', `/admin/articles/${article.id}`, body); else await api('POST', '/admin/articles', body);
      toast('Artykuł zapisany.', 'success');
      onSaved();
    } catch (err) { toast(errMsg(err, 'Nie udało się zapisać artykułu.'), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={article ? 'Edycja artykułu' : 'Nowy artykuł'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        <div><Label htmlFor="a-title">Tytuł</Label><input id="a-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={160} required /></div>
        <div><Label htmlFor="a-type">Typ</Label>
          <select id="a-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as Article['type'])}>
            {(Object.keys(ARTICLE_TYPE_LABEL) as Article['type'][]).map((t) => <option key={t} value={t}>{ARTICLE_TYPE_LABEL[t]}</option>)}
          </select></div>
        <div><Label htmlFor="a-content">Treść (nagłówki „## ”, listy „- ”, **pogrubienia**)</Label>
          <textarea id="a-content" className={inputCls} rows={12} value={content} onChange={(e) => setContent(e.target.value)} minLength={10} required /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Opublikowany (widoczny w bazie wiedzy)</label>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Anuluj</Button><Button type="submit" disabled={busy}>Zapisz</Button></div>
      </form>
    </Modal>
  );
}

// ---------- hasła ----------
function Words() {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [list, setList] = useState<AdminWord[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [form, setForm] = useState({ word: '', difficulty: 'EASY' as Difficulty, categoryId: '', hint: '' });
  const load = useCallback(() => api<{ words: AdminWord[] }>('GET', `/admin/words?q=${encodeURIComponent(q)}`).then((r) => setList(r.words)).catch((e) => toast(errMsg(e, 'Nie udało się pobrać haseł.'), 'error')), [q, toast]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);      // krótkie opóźnienie, żeby nie pytać serwera przy każdej literze
  useEffect(() => { api<{ categories: Category[] }>('GET', '/kb/categories').then((r) => setCats(r.categories)).catch(() => undefined); }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('POST', '/admin/words', { ...form, categoryId: form.categoryId ? Number(form.categoryId) : null });
      toast('Hasło dodane.', 'success');
      setForm({ ...form, word: '', hint: '' });
      load();
    } catch (err) { toast(errMsg(err, 'Nie udało się dodać hasła.'), 'error'); }
  };
  const toggle = async (w: AdminWord) => {
    try { await api('PUT', `/admin/words/${w.id}`, { isActive: !w.is_active }); load(); }
    catch (err) { toast(errMsg(err, 'Nie udało się zmienić hasła.'), 'error'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card title="Dodaj hasło">
        <form onSubmit={add} className="space-y-3">
          <div><Label htmlFor="w-word">Hasło</Label><input id="w-word" className={inputCls} value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} minLength={2} maxLength={60} required /></div>
          <div><Label htmlFor="w-diff">Poziom trudności</Label>
            <select id="w-diff" className={inputCls} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>
              {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}</select></div>
          <div><Label htmlFor="w-cat">Kategoria</Label>
            <select id="w-cat" className={inputCls} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">(bez kategorii)</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><Label htmlFor="w-hint">Podpowiedź słowna</Label><input id="w-hint" className={inputCls} value={form.hint} onChange={(e) => setForm({ ...form, hint: e.target.value })} minLength={3} maxLength={300} required /></div>
          <Button type="submit" className="w-full">Dodaj hasło</Button>
        </form>
      </Card>
      <Card title="Hasła w grze" action={<input aria-label="Szukaj hasła" className={`${inputCls} !w-44`} placeholder="Szukaj…" value={q} onChange={(e) => setQ(e.target.value)} />}>
        {list === null ? <Spinner /> : list.length === 0 ? <Empty>Nic nie znaleziono.</Empty> : (
          <ul className="divide-y divide-slate-100">{list.map((w) => (
            <li key={w.id} className={`flex items-center gap-3 py-2 ${w.is_active ? '' : 'opacity-50'}`}>
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{w.word}</div><div className="truncate text-xs text-slate-500">{w.category_name ?? 'bez kategorii'} · {w.hint}</div></div>
              <DifficultyBadge d={w.difficulty} />
              <Button size="sm" variant="secondary" onClick={() => toggle(w)}>{w.is_active ? 'Wyłącz' : 'Włącz'}</Button>
            </li>))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- mnożniki ----------
function Levels() {
  const { toast } = useApp();
  const [levels, setLevels] = useState<Level[] | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const load = useCallback(() => api<{ levels: Level[] }>('GET', '/admin/levels').then((r) => {
    setLevels(r.levels);
    setVals(Object.fromEntries(r.levels.map((l) => [l.code, String(l.multiplier)])));
  }).catch((e) => toast(errMsg(e, 'Nie udało się pobrać poziomów.'), 'error')), [toast]);
  useEffect(() => { load(); }, [load]);
  const save = async (code: string) => {
    try { await api('PUT', `/admin/levels/${code}`, { multiplier: Number(vals[code]) }); toast('Mnożnik zapisany.', 'success'); load(); }
    catch (err) { toast(errMsg(err, 'Nie udało się zapisać mnożnika.'), 'error'); }
  };
  return (
    <Card title="Mnożniki punktów według poziomu trudności" className="max-w-lg">
      <p className="mb-3 text-xs text-slate-500">Punkty za odgadnięcie = 100 × mnożnik × (0,4 + 0,6 × pozostały czas / czas tury). Zmiana działa od razu.</p>
      {levels === null ? <Spinner /> : (
        <ul className="space-y-2">{levels.map((l) => (
          <li key={l.code} className="flex items-center gap-3">
            <div className="w-24"><DifficultyBadge d={l.code} /></div>
            <input aria-label={`Mnożnik ${l.label}`} type="number" step="0.1" min="0.1" max="10" className={`${inputCls} !w-24`} value={vals[l.code] ?? ''} onChange={(e) => setVals({ ...vals, [l.code]: e.target.value })} />
            <Button size="sm" onClick={() => save(l.code)}>Zapisz</Button>
          </li>))}
        </ul>
      )}
    </Card>
  );
}
