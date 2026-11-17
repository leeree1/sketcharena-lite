import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from '../src/chatbot';

const cats = [
  { slug: 'historia', name: 'Historia i kultura', keywords: ['histor', 'kultur'] },
  { slug: 'zwierzeta', name: 'Zwierzęta', keywords: ['zwierz', 'pies', 'kot'] },
];

test('dobór gry z poziomem i kategorią (przykład z dokumentacji)', () => {
  const r = parseIntent('Chcę zagrać z kimś w trudne hasła historyczne', cats);
  assert.equal(r.intent, 'find_game');
  assert.equal(r.difficulty, 'HARD');
  assert.equal(r.categorySlug, 'historia');
});

test('pytania o zasady i punktację', () => {
  assert.equal(parseIntent('Wytłumacz mi zasady punktacji', cats).intent, 'scoring');
  assert.equal(parseIntent('jak zagrać?', cats).intent, 'explain_rules');
});

test('pozostałe intencje, także bez polskich znaków', () => {
  assert.equal(parseIntent('Cześć!', cats).intent, 'greeting');
  assert.equal(parseIntent('jak rysowac na tablecie', cats).intent, 'drawing_tips');
  assert.equal(parseIntent('szukam latwej gry ze zwierzetami', cats).categorySlug, 'zwierzeta');
  assert.equal(parseIntent('losowy tekst', cats).intent, 'knowledge');
});
