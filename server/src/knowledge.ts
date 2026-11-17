import { Router } from 'express';
import { query, queryOne } from './db';
import { HttpError, wrap } from './errors';

const PL_FROM = 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ';
const PL_TO = 'acelnoszzACELNOSZZ';
const STOPWORDS = new Set(['jak', 'co', 'to', 'jest', 'czy', 'mi', 'mnie', 'sie', 'na', 'do', 'dla', 'i', 'a', 'o', 'po', 'za', 'od', 'ale', 'oraz', 'chce', 'prosze', 'wytlumacz', 'powiedz', 'pokaz', 'ile', 'gdzie', 'kiedy', 'moge', 'mozna', 'mam']);

/** Usuwa polskie znaki — tak samo jak funkcja translate() w kolumnie search_vector w bazie */
export function stripPl(s: string): string {
  let out = '';
  for (const ch of s) { const i = PL_FROM.indexOf(ch); out += i >= 0 ? PL_TO[i] : ch; }
  return out;
}

/** Zamienia pytanie na listę „rdzeni” słów, np. „Jak działa punktacja?” → ['dzia', 'punkt'] */
export function queryStems(text: string): string[] {
  const tokens = stripPl(text.toLowerCase()).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const stems = tokens.map((t) => (t.length >= 8 ? t.slice(0, 5) : t.length >= 5 ? t.slice(0, 4) : t));
  return Array.from(new Set(stems));
}

export interface Article { id: string; slug: string; title: string; type: string; content: string }

/** Wyszukiwanie pełnotekstowe w bazie wiedzy (PostgreSQL: tsvector + indeks GIN) */
export async function searchArticles(q: string, type?: string, limit = 20): Promise<Article[]> {
  const stems = q ? queryStems(q) : [];
  if (stems.length === 0) {
    return query<Article>(`SELECT id, slug, title, type, content FROM knowledge_articles WHERE is_published AND ($2::text IS NULL OR type::text = $2) ORDER BY type, title LIMIT $1`, [limit, type ?? null]);
  }
  const tsq = stems.map((s) => `${s}:*`).join(' | ');        // prefiksy połączone OR
  return query<Article>(
    `SELECT a.id, a.slug, a.title, a.type, a.content
       FROM knowledge_articles a, to_tsquery('simple', $3) query
      WHERE a.is_published AND ($2::text IS NULL OR a.type::text = $2) AND a.search_vector @@ query
      ORDER BY ts_rank(a.search_vector, query) DESC LIMIT $1`, [limit, type ?? null, tsq]);
}

export const kbRouter = Router();

kbRouter.get('/articles', wrap(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const list = await searchArticles(q, type, 50);
  res.json({ articles: list.map(({ content, ...a }) => ({ ...a, excerpt: content.replace(/[#*]/g, '').slice(0, 160) })) });
}));

kbRouter.get('/articles/:slug', wrap(async (req, res) => {
  const a = await queryOne<Article>('SELECT id, slug, title, type, content FROM knowledge_articles WHERE slug = $1 AND is_published', [req.params.slug]);
  if (!a) throw new HttpError(404, 'Nie znaleziono artykułu.');
  res.json({ article: a });
}));

kbRouter.get('/categories', wrap(async (_req, res) => {
  res.json({ categories: await query('SELECT id, slug, name, keywords FROM categories ORDER BY name') });
}));

