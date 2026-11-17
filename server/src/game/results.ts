import { query } from '../db';
import type { RankRow } from './engine';
import type { Room } from './room';

/** Zapisuje wynik zakończonego meczu: sesję gry, wyniki graczy i statystyki kont */
export async function saveResults(room: Room, ranking: RankRow[]): Promise<void> {
  const winner = ranking.find((r) => r.rank === 1)?.userId ?? null;
  const [session] = await query<{ id: string }>(
    `INSERT INTO game_sessions (room_id, status, ended_at, winner_user_id) VALUES ($1, 'FINISHED', now(), $2) RETURNING id`,
    [room.id, winner]);
  for (const r of ranking) {
    await query('INSERT INTO game_players (session_id, user_id, final_score, final_rank) VALUES ($1,$2,$3,$4)', [session.id, r.userId, r.score, r.rank]);
  }
  const ids = ranking.map((r) => r.userId);
  await query('UPDATE users SET games_played = games_played + 1 WHERE id = ANY($1::uuid[])', [ids]);
  if (ranking.length > 1) await query('UPDATE users SET games_won = games_won + 1 WHERE id = ANY($1::uuid[])', [ranking.filter((r) => r.rank === 1).map((r) => r.userId)]);
}
