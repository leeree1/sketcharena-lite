import { Router } from 'express';
import { requireAuth } from './auth';
import { query } from './db';
import { wrap } from './errors';
import { DEFAULT_SETTINGS, RoomManager } from './game/rooms';
import { countWords } from './game/words';
import { Article, queryStems, searchArticles, stripPl } from './knowledge';
import { Difficulty } from './types';

type Intent = 'greeting' | 'help' | 'find_game' | 'scoring' | 'explain_rules' | 'drawing_tips' | 'list_categories' | 'knowledge';
interface Category { slug: string; name: string; keywords: string[] }

const plain = (s: string) => stripPl(s.toLowerCase()).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const LEVEL_LABEL: Record<Difficulty, string> = { EASY: 'łatwy', MEDIUM: 'średni', HARD: 'trudny' };

/** Rozpoznaje, czego chce gracz (intencja), oraz poziom trudności i kategorię wspomniane w wiadomości */
export function parseIntent(text: string, categories: Category[]) {
  const t = plain(text);
  const has = (re: RegExp) => re.test(t);

  let difficulty: Difficulty | null = null;
  if (has(/\b(trudn|hard|ciezk|zaawansowan)/)) difficulty = 'HARD';
  else if (has(/\b(sredni|srednio|medium)/)) difficulty = 'MEDIUM';
  else if (has(/\b(latw|prost|easy|poczatk)/)) difficulty = 'EASY';

  let categorySlug: string | null = null;
  for (const c of categories) {
    const words = [c.slug, plain(c.name), ...c.keywords.map(plain)].filter((w) => w.length >= 3);
    if (words.some((w) => t.includes(w))) { categorySlug = c.slug; break; }
  }

  const wantsPlay = has(/\b(chce|chcialbym|chcialabym|chcemy|szukam|znajdz|dolacz|zagrajmy|pograc|zagraj|dobierz|dopasuj)/);
  let intent: Intent = 'knowledge';
  if (has(/^(czesc|hej|siema|witaj|dzien dobry|hello|hi)\b/) && t.split(' ').length <= 4) intent = 'greeting';
  else if (has(/(pomoc|co potrafisz|co umiesz|co mozesz)/)) intent = 'help';
  else if (wantsPlay && !has(/(wytlumacz|zasad|jak dziala)/)) intent = 'find_game';
  else if (has(/(punkt|mnoznik|punktac)/)) intent = 'scoring';
  else if (has(/(zasad|regul|jak grac|jak zagrac|jak dziala|wytlumacz)/)) intent = 'explain_rules';
  else if (has(/(rysow|tablet|mysz|wskazowk|porad|trik)/)) intent = 'drawing_tips';
  else if (has(/(kategori|tematyk|jakie tematy)/)) intent = 'list_categories';
  else if (has(/(zagra|\bgra\b|pokoj|mecz|przeciwnik|rozgrywk)/)) intent = 'find_game';
  return { intent, difficulty, categorySlug };
}

/** Wybiera z artykułu akapit najlepiej pasujący do pytania */
function snippet(content: string, question: string, maxLen = 420): string {
  const stems = queryStems(question);
  const paras = content.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith('## '));
  const score = (p: string) => { const n = stripPl(p.toLowerCase()); return stems.reduce((s, st) => s + (n.includes(st) ? 1 : 0), 0); };
  const best = [...paras].sort((a, b) => score(b) - score(a))[0] ?? content;
  const clean = best.replace(/^- /gm, '• ').replace(/\n/g, ' ');
  return clean.length > maxLen ? clean.slice(0, maxLen).replace(/\s+\S*$/, '') + '…' : clean;
}

export function chatbotRouter(rooms: RoomManager): Router {
  const r = Router();

  r.post('/message', requireAuth, wrap(async (req, res) => {
    const user = req.user!;
    const text = String(req.body?.message ?? '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: { message: 'Wiadomość nie może być pusta.' } });

    const categories = await query<Category>('SELECT slug, name, keywords FROM categories ORDER BY name');
    const { intent, difficulty, categorySlug } = parseIntent(text, categories);
    let reply = '';
    let action: { type: 'join_room'; roomCode: string; label: string } | undefined;
    let articles: Article[] = [];

    if (intent === 'greeting') {
      reply = `Cześć, ${user.username}! Jestem botem SketchArena. Wytłumaczę zasady i punktację albo dobiorę Ci pokój — napisz np. „Chcę zagrać w trudne hasła historyczne”.`;
    } else if (intent === 'help') {
      reply = 'Potrafię dobrać lub utworzyć pokój według poziomu trudności i kategorii oraz wytłumaczyć zasady, punktację i porady rysowania. Spróbuj: „Wytłumacz mi zasady punktacji”.';
    } else if (intent === 'list_categories') {
      reply = 'Dostępne kategorie haseł: ' + categories.map((c) => c.name).join(', ') + '.';
    } else if (intent === 'find_game') {
      // 1. ustal parametry gry (domyślnie poziom łatwy)
      const level: Difficulty = difficulty ?? 'EASY';
      let category = categorySlug;
      if (category && (await countWords(level, category)) === 0) category = null;   // brak haseł w tej kategorii na tym poziomie
      // 2. znajdź pasujący pokój albo utwórz nowy
      let room = rooms.findOpen(level, category);
      const created = !room;
      if (!room) room = await rooms.create(user, { ...DEFAULT_SETTINGS, difficulty: level, categorySlug: category });
      const catName = categories.find((c) => c.slug === category)?.name;
      const where = `poziom ${LEVEL_LABEL[level]}${catName ? `, kategoria „${catName}”` : ''}`;
      reply = created
        ? `Nie było teraz otwartego pokoju (${where}), więc utworzyłem nowy. Kod: ${room.code}. Inni gracze szukający podobnej gry zostaną do niego dopasowani.`
        : `Znalazłem dla Ciebie pokój (${where}). Kod: ${room.code}.`;
      action = { type: 'join_room', roomCode: room.code, label: `Dołącz do pokoju ${room.code}` };
    } else {
      // pytanie o wiedzę: szukamy w artykułach i odpowiadamy fragmentem najlepszego z nich
      const q = intent === 'scoring' ? 'punktacja mnożniki trudności' : intent === 'drawing_tips' ? 'rysowanie porady strategie' : text;
      articles = await searchArticles(q, undefined, 3);
      reply = articles.length === 0
        ? 'Nie znalazłem w bazie wiedzy odpowiedzi na to pytanie. Zapytaj o zasady gry, punktację, poziomy trudności lub porady rysowania.'
        : `${articles[0].title}: ${snippet(articles[0].content, q)}`;
    }

    // zapis rozmowy (historia) — nie blokuje odpowiedzi
    query(`INSERT INTO chatbot_messages (user_id, author, content, intent) VALUES ($1,'USER',$2,$3), ($1,'BOT',$4,$3)`, [user.id, text, intent, reply]).catch(console.error);
    res.json({ reply, intent, action, sources: articles.slice(0, 2).map((a) => ({ slug: a.slug, title: a.title })) });
  }));

  return r;
}
