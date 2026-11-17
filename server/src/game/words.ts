import { query } from '../db';
import { Difficulty, Word } from '../types';

const SELECT_WORD = `SELECT w.id, w.word, w.difficulty_code AS difficulty, w.hint_description AS hint
                       FROM words w LEFT JOIN categories c ON c.id = w.category_id`;

/** Ile aktywnych haseł jest na danym poziomie (i w kategorii) */
export async function countWords(difficulty: Difficulty, categorySlug: string | null): Promise<number> {
  const [row] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM words w LEFT JOIN categories c ON c.id = w.category_id
      WHERE w.is_active AND w.difficulty_code = $1 AND ($2::text IS NULL OR c.slug = $2)`, [difficulty, categorySlug]);
  return row.n;
}

/** Losuje `n` haseł z danego poziomu trudności (i kategorii); pomija już użyte w tym meczu */
export async function pickWords(difficulty: Difficulty, categorySlug: string | null, n: number, excludeIds: string[]): Promise<Word[]> {
  const fetch = (cat: string | null, exclude: string[], limit: number) => query<Word>(
    `${SELECT_WORD} WHERE w.is_active AND w.difficulty_code = $1 AND ($2::text IS NULL OR c.slug = $2)
        AND NOT (w.id = ANY($3::uuid[])) ORDER BY random() LIMIT $4`, [difficulty, cat, exclude, limit]);
  let words = await fetch(categorySlug, excludeIds, n);
  if (words.length < n && categorySlug) words = words.concat(await fetch(null, [...excludeIds, ...words.map((w) => w.id)], n - words.length));
  if (words.length < n) words = words.concat(await fetch(null, words.map((w) => w.id), n - words.length));   // pula wyczerpana
  return words;
}

