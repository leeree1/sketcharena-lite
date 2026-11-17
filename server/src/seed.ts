// Wczytuje dane początkowe (poziomy trudności, kategorie, hasła, artykuły). Można uruchamiać wielokrotnie.
import fs from 'fs';
import path from 'path';
import { pool, query } from './db';

async function main() {
  const dataDir = path.resolve(__dirname, '../data');
  const words = JSON.parse(fs.readFileSync(path.join(dataDir, 'words.json'), 'utf8'));
  const articles = JSON.parse(fs.readFileSync(path.join(dataDir, 'articles.json'), 'utf8'));

  for (const [code, label, mult, order] of [['EASY', 'Łatwy', 1.0, 1], ['MEDIUM', 'Średni', 1.5, 2], ['HARD', 'Trudny', 2.5, 3]]) {
    await query('INSERT INTO difficulty_levels (code, label, multiplier, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING', [code, label, mult, order]);
  }
  for (const c of words.categories) {
    await query('INSERT INTO categories (slug, name, keywords) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING', [c.slug, c.name, c.keywords]);
  }
  for (const w of words.words) {
    await query(
      `INSERT INTO words (word, difficulty_code, category_id, hint_description)
       VALUES ($1, $2, (SELECT id FROM categories WHERE slug = $3), $4) ON CONFLICT (word) DO NOTHING`,
      [w.word, w.difficulty, w.category, w.hint]);
  }
  for (const a of articles) {
    await query('INSERT INTO knowledge_articles (slug, title, content, type) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING', [a.slug, a.title, a.content, a.type]);
  }
  const [w] = await query('SELECT count(*)::int AS n FROM words');
  const [a] = await query('SELECT count(*)::int AS n FROM knowledge_articles');
  console.log(`Gotowe: ${w.n} haseł, ${a.n} artykułów w bazie.`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

