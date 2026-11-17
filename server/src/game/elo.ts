export interface EloPlayer { userId: string; rating: number; rank: number }
export const K_FACTOR = 32;

/** Szansa gracza A na wygraną z B (0–1) */
export const expectedScore = (ra: number, rb: number) => 1 / (1 + 10 ** ((rb - ra) / 400));

/** Zwraca nowe oceny: userId → nowy rating. Każdy gracz jest porównywany z każdym innym. */
export function computeElo(players: EloPlayer[], k = K_FACTOR): Map<string, number> {
  const out = new Map<string, number>();
  const n = players.length;
  for (const a of players) {
    if (n < 2) { out.set(a.userId, a.rating); continue; }       // jeden gracz: brak rywala, brak zmiany
    let sum = 0;
    for (const b of players) {
      if (a === b) continue;
      const actual = a.rank < b.rank ? 1 : a.rank === b.rank ? 0.5 : 0;   // niższy numer = lepsze miejsce
      sum += actual - expectedScore(a.rating, b.rating);
    }
    out.set(a.userId, Math.round(a.rating + (k / (n - 1)) * sum));
  }
  return out;
}