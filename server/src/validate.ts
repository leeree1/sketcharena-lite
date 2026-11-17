import { HttpError } from './errors';

export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;

/** Sprawdza dane nowego hasła (używane przy dodawaniu przez administratora i przy propozycjach graczy) */
export function parseWordInput(body: any) {
  const word = String(body?.word ?? '').trim().toLocaleLowerCase('pl');   // hasła w bazie są małymi literami
  const hint = String(body?.hint ?? '').trim();
  const difficulty = String(body?.difficulty ?? '');
  const raw = body?.categoryId;
  const categoryId = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (word.length < 2 || word.length > 60) throw new HttpError(400, 'Hasło musi mieć od 2 do 60 znaków.');
  if (hint.length < 3 || hint.length > 300) throw new HttpError(400, 'Podpowiedź musi mieć od 3 do 300 znaków.');
  if (!(DIFFICULTIES as readonly string[]).includes(difficulty)) throw new HttpError(400, 'Nieprawidłowy poziom trudności.');
  if (categoryId !== null && !Number.isInteger(categoryId)) throw new HttpError(400, 'Nieprawidłowa kategoria.');
  return { word, hint, difficulty, categoryId };
}
