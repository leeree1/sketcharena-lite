import { Difficulty } from '../types';

/** Mnożniki punktów według poziomu trudności (w pełnej wersji czytane z tabeli difficulty_levels) */
export const MULTIPLIER: Record<Difficulty, number> = { EASY: 1.0, MEDIUM: 1.5, HARD: 2.5 };

/** P = round(100 × M × (0,4 + 0,6 × pozostały czas / czas tury)) */
export function guessPoints(multiplier: number, remainingSec: number, totalSec: number): number {
  const ratio = Math.min(1, Math.max(0, remainingSec / totalSec));
  return Math.round(100 * multiplier * (0.4 + 0.6 * ratio));
}

/** Rysujący dostaje połowę punktów za każdego, kto odgadł jego hasło */
export function drawerPoints(points: number): number {
  return Math.round(0.5 * points);
}

