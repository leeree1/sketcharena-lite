import { query } from '../db';
import { Difficulty } from '../types';
import { MULTIPLIER } from './scoring';

/** Wczytuje mnożniki punktów z tabeli difficulty_levels do pamięci (wywoływane przy starcie i po zmianie przez administratora) */
export async function refreshMultipliers(): Promise<void> {
  const rows = await query<{ code: Difficulty; multiplier: string }>('SELECT code, multiplier FROM difficulty_levels');
  for (const r of rows) if (r.code in MULTIPLIER) MULTIPLIER[r.code] = Number(r.multiplier);   // numeric z bazy przychodzi jako tekst
}
