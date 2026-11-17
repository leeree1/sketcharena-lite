import { Router } from 'express';
import { query, queryOne } from './db';
import { HttpError, wrap } from './errors';
import { requireAuth, requireRole } from './auth';
import { stripPl } from './knowledge';
import { parseWordInput, DIFFICULTIES } from './validate';
import { refreshMultipliers } from './game/multipliers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTICLE_TYPES = ['RULES', 'DRAWING_TIPS', 'FAQ', 'GLOSSARY'];
const slugify = (s: string) => stripPl(s.toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'artykul';

/** Panel administratora: wszystkie trasy tylko dla roli ADMIN */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));

function parseArticle(body: any) {
  const title = String(body?.title ?? '').trim();
  const content = String(body?.content ?? '').trim();
  const type = String(body?.type ?? '');
  if (title.length < 3 || title.length > 160) throw new HttpError(400, 'Tytuł musi mieć od 3 do 160 znaków.');
  if (content.length < 10 || content.length > 20000) throw new HttpError(400, 'Treść musi mieć od 10 do 20 000 znaków.');
  if (!ARTICLE_TYPES.includes(type)) throw new HttpError(400, 'Nieprawidłowy typ artykułu.');
  return { title, content, type, isPublished: body?.isPublished !== false };
}

// ---------- artykuły bazy wiedzy ----------
adminRouter.get('/articles', wrap(async (_req, res) => {
  res.json({ articles: await query('SELECT id, slug, title, type, content, is_published, updated_at FROM knowledge_articles ORDER BY type, title') });
}));

adminRouter.post('/articles', wrap(async (req, res) => {
  const a = parseArticle(req.body);
  const base = slugify(a.title);
  let slug = base;
  for (let i = 0; i < 5; i++) {
    try {
      const [row] = await query(
        'INSERT INTO knowledge_articles (slug, title, content, type, author_id, is_published) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [slug, a.title, a.content, a.type, req.user!.id, a.isPublished]);
      return res.status(201).json({ id: row.id });
    } catch (e: any) {
      if (e.code !== '23505') throw e;                       // slug już istnieje: dopisujemy losowy numer
      slug = `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
  }
  throw new HttpError(409, 'Nie udało się utworzyć adresu artykułu. Zmień tytuł.');
}));

adminRouter.put('/articles/:id', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(400, 'Nieprawidłowy identyfikator.');
  const a = parseArticle(req.body);
  const done = await queryOne(
    'UPDATE knowledge_articles SET title = $2, type = $3, content = $4, is_published = $5, updated_at = now() WHERE id = $1 RETURNING id',
    [req.params.id, a.title, a.type, a.content, a.isPublished]);
  if (!done) throw new HttpError(404, 'Nie znaleziono artykułu.');
  res.json({ ok: true });
}));

// ---------- hasła do gry ----------
adminRouter.get('/words', wrap(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const words = await query(
    `SELECT w.id, w.word, w.difficulty_code AS difficulty, c.name AS category_name, w.hint_description AS hint, w.is_active
       FROM words w LEFT JOIN categories c ON c.id = w.category_id
      WHERE ($1 = '' OR w.word ILIKE '%' || $1 || '%')
      ORDER BY w.difficulty_code, w.word LIMIT 200`, [q]);
  res.json({ words });
}));

adminRouter.post('/words', wrap(async (req, res) => {
  const w = parseWordInput(req.body);
  try {
    await query('INSERT INTO words (word, difficulty_code, category_id, hint_description) VALUES ($1,$2,$3,$4)', [w.word, w.difficulty, w.categoryId, w.hint]);
  } catch (e: any) {
    if (e.code === '23505') throw new HttpError(409, 'Takie hasło już istnieje.');
    if (e.code === '23503') throw new HttpError(400, 'Nie ma takiej kategorii.');
    throw e;
  }
  res.status(201).json({ ok: true });
}));

// Włączenie/wyłączenie hasła (wyłączone nie jest losowane) oraz zmiana poziomu lub podpowiedzi
adminRouter.put('/words/:id', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(400, 'Nieprawidłowy identyfikator.');
  const isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : null;
  const difficulty = req.body?.difficulty === undefined ? null : String(req.body.difficulty);
  if (difficulty !== null && !(DIFFICULTIES as readonly string[]).includes(difficulty)) throw new HttpError(400, 'Nieprawidłowy poziom trudności.');
  const hint = req.body?.hint === undefined ? null : String(req.body.hint).trim().slice(0, 300);
  const done = await queryOne(
    `UPDATE words SET is_active = COALESCE($2, is_active), difficulty_code = COALESCE($3, difficulty_code), hint_description = COALESCE($4, hint_description)
      WHERE id = $1 RETURNING id`, [req.params.id, isActive, difficulty, hint]);
  if (!done) throw new HttpError(404, 'Nie znaleziono hasła.');
  res.json({ ok: true });
}));

// ---------- poziomy trudności (mnożniki punktów) ----------
adminRouter.get('/levels', wrap(async (_req, res) => {
  res.json({ levels: await query('SELECT code, label, multiplier::float8 AS multiplier FROM difficulty_levels ORDER BY sort_order') });
}));

adminRouter.put('/levels/:code', wrap(async (req, res) => {
  const code = req.params.code;
  const m = Math.round(Number(req.body?.multiplier) * 10) / 10;      // kolumna numeric(3,1): jedno miejsce po przecinku
  if (!(DIFFICULTIES as readonly string[]).includes(code)) throw new HttpError(404, 'Nie ma takiego poziomu.');
  if (!Number.isFinite(m) || m < 0.1 || m > 10) throw new HttpError(400, 'Mnożnik musi być liczbą od 0,1 do 10.');
  await query('UPDATE difficulty_levels SET multiplier = $1 WHERE code = $2', [m, code]);
  await refreshMultipliers();                                         // nowa wartość działa od razu w trwających grach
  res.json({ ok: true });
}));
