import { query } from '../db';
import { computeElo } from './elo';
import type { RankRow } from './engine';
import type { Room } from './room';

export type EloChanges = Record<string, { before: number; after: number }>;

/** Zapisuje wynik meczu, liczy ELO kont zarejestrowanych i zwraca zmiany ocen */
export async function saveResults(room: Room, ranking: RankRow[]): Promise<EloChanges> {
  const winner = ranking.find((r) => r.rank === 1)?.userId ?? null;
  const [session] = await query<{ id: string }>(
    `INSERT INTO game_sessions (room_id, status, ended_at, winner_user_id) VALUES ($1, 'FINISHED', now(), $2) RETURNING id`,
    [room.id, winner]);

  // aktualne oceny i role graczy
  const ids = ranking.map((r) => r.userId);
  const users = await query<{ id: string; role: string; elo_rating: number }>(
    'SELECT id, role, elo_rating FROM users WHERE id = ANY($1::uuid[])', [ids]);
  const current = new Map(users.map((u) => [u.id, u]));

  // do ELO bierzemy tylko konta zarejestrowane (nie GUEST)
  const rated = ranking
    .filter((r) => { const u = current.get(r.userId); return !!u && u.role !== 'GUEST'; })
    .map((r) => ({ userId: r.userId, rating: current.get(r.userId)!.elo_rating, rank: r.rank }));
  const newRatings = computeElo(rated);

  const changes: EloChanges = {};
  for (const r of ranking) {
    const after = newRatings.get(r.userId);
    const before = after === undefined ? null : current.get(r.userId)!.elo_rating;
    await query(
      'INSERT INTO game_players (session_id, user_id, final_score, final_rank, elo_before, elo_after) VALUES ($1,$2,$3,$4,$5,$6)',
      [session.id, r.userId, r.score, r.rank, before, after ?? null]);
    if (after !== undefined) {
      await query('UPDATE users SET elo_rating = $1 WHERE id = $2', [after, r.userId]);
      changes[r.userId] = { before: before!, after };
    }
  }

  await query('UPDATE users SET games_played = games_played + 1 WHERE id = ANY($1::uuid[])', [ids]);
  if (ranking.length > 1) await query('UPDATE users SET games_won = games_won + 1 WHERE id = ANY($1::uuid[])', [ranking.filter((r) => r.rank === 1).map((r) => r.userId)]);
  return changes;
}