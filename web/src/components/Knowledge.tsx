import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../App';
import { Article, ARTICLE_TYPE_LABEL } from '../types';
import { Badge, Button, Card, Empty, inputCls, Markdown } from './ui';

export default function Knowledge({ initialSlug }: { initialSlug: string | null }) {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [list, setList] = useState<Article[] | null>(null);
  const [open, setOpen] = useState<Article | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ articles: Article[] }>('GET', `/kb/articles?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`).then((r) => setList(r.articles)).catch(() => setList([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, type]);

  const show = (slug: string) => api<{ article: Article }>('GET', `/kb/articles/${slug}`).then((r) => { setOpen(r.article); window.scrollTo({ top: 0 }); }).catch((e) => toast(e instanceof ApiError ? e.message : 'Nie udało się wczytać artykułu.', 'error'));
  useEffect(() => { if (initialSlug) void show(initialSlug); }, [initialSlug]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-5 md:grid-cols-[340px_1fr]">
      <Card title="Baza wiedzy">
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj, np. punktacja…" aria-label="Szukaj w bazie wiedzy" />
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Typ artykułu">
          {(['', 'RULES', 'DRAWING_TIPS', 'FAQ', 'GLOSSARY'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} aria-pressed={type === t} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${type === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{t ? ARTICLE_TYPE_LABEL[t] : 'Wszystko'}</button>
          ))}
        </div>
        <ul className="mt-3 divide-y divide-slate-100">
          {list === null ? <li className="py-4 text-sm text-slate-500">Wczytuję…</li> : list.length === 0 ? <li><Empty>Brak wyników. Spróbuj innej frazy.</Empty></li> : list.map((a) => (
            <li key={a.id}>
              <button onClick={() => void show(a.slug)} className={`w-full rounded-lg px-2 py-2.5 text-left hover:bg-slate-50 ${open?.slug === a.slug ? 'bg-indigo-50' : ''}`}>
                <div className="flex items-center gap-2"><span className="text-sm font-semibold text-slate-800">{a.title}</span></div>
                <div className="mt-0.5 flex items-center gap-2"><Badge tone="indigo">{ARTICLE_TYPE_LABEL[a.type]}</Badge><span className="line-clamp-1 text-xs text-slate-500">{a.excerpt}</span></div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        {open ? (
          <article>
            <div className="mb-1 flex items-center gap-2"><Badge tone="indigo">{ARTICLE_TYPE_LABEL[open.type]}</Badge></div>
            <h1 className="text-2xl font-extrabold tracking-tight">{open.title}</h1>
            <div className="mt-3"><Markdown text={open.content ?? ''} /></div>
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => setOpen(null)}>← Wróć do wyboru</Button>
          </article>
        ) : (
          <div className="py-10 text-center"><div className="text-4xl" aria-hidden>📚</div><h2 className="mt-2 text-lg font-bold">Zasady, punktacja i porady rysowania</h2><p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Wybierz artykuł z listy albo użyj wyszukiwarki. Z tej samej bazy korzysta chatbot w lobby.</p></div>
        )}
      </Card>
    </div>
  );
}
