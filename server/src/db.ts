import { Pool } from 'pg';
import { config } from './config';
import { dbQueryDuration } from './metrics';

// Jedna pula połączeń z PostgreSQL dla całej aplikacji
export const pool = new Pool({ connectionString: config.databaseUrl });

/** Wykonuje zapytanie SQL i zwraca wiersze. Parametry ($1, $2…) chronią przed SQL injection. */
export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const first = text.trimStart().split(/\s+/, 1)[0].toUpperCase();                  // SELECT, INSERT, UPDATE…
  const operation = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(first) ? first : 'OTHER';
  const stop = dbQueryDuration.startTimer({ operation });                           // start stopera
  try {
    const res = await pool.query(text, params);
    return res.rows as T[];
  } finally {
    stop();                                                                         // zatrzymanie stopera zapisuje czas w histogramie
  }
}

/** Zwraca pierwszy wiersz albo null */
export async function queryOne<T = any>(text: string, params: any[] = []): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null;
}

