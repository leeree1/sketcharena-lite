import { Router } from 'express';
import { AuthUser, requireAuth } from '../auth';
import { query, queryOne } from '../db';
import { HttpError, wrap } from '../errors';
import { Difficulty, Emitter, RoomSettings } from '../types';
import { GameEngine } from './engine';
import { Room } from './room';
import { pickWords } from './words';
import { saveResults } from './results';  

export const DEFAULT_SETTINGS: RoomSettings = { difficulty: 'EASY', categorySlug: null, maxPlayers: 8, roundTimeSeconds: 80, rounds: 3, isPrivate: false };
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';           // bez znaków łatwych do pomylenia (0/O, 1/I)
const randomCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

export interface RoomSummary {
  code: string; hostName: string; difficulty: Difficulty; category: string | null;
  players: number; maxPlayers: number; status: 'LOBBY' | 'IN_GAME'; rounds: number; roundTimeSeconds: number;
}

/** Rejestr pokoi (w pamięci serwera) */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private hostNames = new Map<string, string>();

  constructor(private emitter: Emitter) {
    setInterval(() => this.sweep(), 15000);                       // sprzątanie pustych pokoi
  }

  get(code: string): Room | undefined { return this.rooms.get(code.toUpperCase()); }

  async create(host: AuthUser, settings: RoomSettings): Promise<Room> {
    for (let i = 0; i < 8; i++) {
      const code = randomCode();
      if (this.rooms.has(code)) continue;
      try {
        const row = await queryOne<{ id: string }>(
          `INSERT INTO rooms (code, host_id, difficulty_code, category_id, max_players, round_time_seconds, rounds, is_private)
           VALUES ($1,$2,$3,(SELECT id FROM categories WHERE slug = $4),$5,$6,$7,$8) RETURNING id`,
          [code, host.id, settings.difficulty, settings.categorySlug, settings.maxPlayers, settings.roundTimeSeconds, settings.rounds, settings.isPrivate]);
        const room = new Room(row!.id, code, host.id, settings);
        room.engine = new GameEngine(room, {
          emitter: this.emitter,
          pickWords,
          onChange: () => undefined,
          onFinish: saveResults,                        // zapis wyniku w bazie dodamy w etapie 8
        });
        this.rooms.set(code, room);
        this.hostNames.set(code, host.username);
        return room;
      } catch (e: any) { if (e.code !== '23505') throw e; }       // kod zajęty: losujemy kolejny
    }
    throw new HttpError(500, 'Nie udało się wygenerować kodu pokoju.');
  }

  summary(room: Room): RoomSummary {
    return {
      code: room.code, hostName: room.players.get(room.hostId)?.username ?? this.hostNames.get(room.code) ?? '',
      difficulty: room.settings.difficulty, category: room.settings.categorySlug,
      players: room.connectedPlayers().length, maxPlayers: room.settings.maxPlayers,
      status: room.status, rounds: room.settings.rounds, roundTimeSeconds: room.settings.roundTimeSeconds,
    };
  }

  listPublic(difficulty?: string): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => !r.settings.isPrivate && (!difficulty || r.settings.difficulty === difficulty))
      .map((r) => this.summary(r))
      .sort((a, b) => b.players - a.players);
  }

  /** Pokój w poczekalni z wolnym miejscem, o danym poziomie i kategorii (najpierw ten z największą liczbą graczy) */
  findOpen(difficulty: Difficulty, categorySlug: string | null): Room | null {
    const open = [...this.rooms.values()].filter((r) =>
      !r.settings.isPrivate && r.status === 'LOBBY' && r.connectedPlayers().length < r.settings.maxPlayers &&
      r.settings.difficulty === difficulty && r.settings.categorySlug === categorySlug);
    return open.sort((a, b) => b.connectedPlayers().length - a.connectedPlayers().length)[0] ?? null;
  }

  private sweep() {
    for (const room of this.rooms.values()) {
      if (room.connectedPlayers().length === 0 && Date.now() - room.lastActive > 120000) this.close(room);
    }
  }

  close(room: Room) {
    room.engine.destroy();
    this.rooms.delete(room.code);
    void query('UPDATE rooms SET closed_at = now() WHERE id = $1', [room.id]).catch(() => undefined);
  }
}

/** REST: lista pokoi i tworzenie pokoju */
export function roomsRouter(rooms: RoomManager): Router {
  const r = Router();

  r.get('/', requireAuth, wrap(async (req, res) => {
    res.json({ rooms: rooms.listPublic(typeof req.query.difficulty === 'string' ? req.query.difficulty : undefined) });
  }));

  r.post('/', requireAuth, wrap(async (req, res) => {
    const b = req.body ?? {};
    const settings: RoomSettings = {
      difficulty: ['EASY', 'MEDIUM', 'HARD'].includes(b.difficulty) ? b.difficulty : 'EASY',
      categorySlug: typeof b.categorySlug === 'string' && b.categorySlug ? b.categorySlug : null,
      maxPlayers: Math.min(12, Math.max(2, Number(b.maxPlayers) || DEFAULT_SETTINGS.maxPlayers)),
      roundTimeSeconds: Math.min(180, Math.max(20, Number(b.roundTimeSeconds) || DEFAULT_SETTINGS.roundTimeSeconds)),
      rounds: Math.min(10, Math.max(1, Number(b.rounds) || DEFAULT_SETTINGS.rounds)),
      isPrivate: b.isPrivate === true,
    };
    if (settings.categorySlug && !(await queryOne('SELECT 1 FROM categories WHERE slug = $1', [settings.categorySlug]))) {
      throw new HttpError(400, 'Nieznana kategoria haseł.');
    }
    const room = await rooms.create(req.user!, settings);
    res.status(201).json({ ...rooms.summary(room), settings });
  }));

  return r;
}

