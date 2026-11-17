import { queryOne } from './db';

/** Zwraca aktywną blokadę użytkownika (nieodwołaną i niewygasłą) albo null */
export const activeBan = (userId: string) =>
  queryOne<{ reason: string; expires_at: Date }>(
    `SELECT reason, expires_at FROM user_bans
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY expires_at DESC LIMIT 1`, [userId]);
