export type Verdict = 'correct' | 'close' | 'wrong';

/** Małe litery, bez polskich znaków, bez spacji i znaków specjalnych: „Burza Piaskowa!” → „burzapiaskowa” */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '');
}

/** Odległość edycyjna: ile liter trzeba wstawić, usunąć lub zmienić, żeby z jednego słowa zrobić drugie */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Ocena odpowiedzi: trafna, bliska (jedna literówka w haśle od 5 liter) albo błędna */
export function checkGuess(guess: string, word: string): Verdict {
  const g = normalize(guess), w = normalize(word);
  if (!g) return 'wrong';
  if (g === w) return 'correct';
  if (w.length >= 5 && levenshtein(g, w) === 1) return 'close';
  return 'wrong';
}

