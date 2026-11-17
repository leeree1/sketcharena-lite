import { AuthUser } from '../auth';
import { RoomSettings, Stroke } from '../types';
import type { GameEngine } from './engine';

export class Player {
  socketIds = new Set<string>();     // jeden gracz może mieć kilka kart przeglądarki
  score = 0;
  connected = true;
  hasGuessed = false;
  disconnectTimer?: NodeJS.Timeout;
  constructor(public userId: string, public username: string) {}
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Pokój gry: ustawienia, gracze (w kolejności dołączenia), rysunek i własny silnik gry */
export class Room {
  players = new Map<string, Player>();
  status: 'LOBBY' | 'IN_GAME' = 'LOBBY';
  strokes: Stroke[] = [];
  lastActive = Date.now();
  readonly createdAt = Date.now();
  engine!: GameEngine;

  constructor(public id: string, public code: string, public hostId: string, public settings: RoomSettings) {}

  connectedPlayers() { return [...this.players.values()].filter((p) => p.connected); }

  addPlayer(user: AuthUser): Player {
    let p = this.players.get(user.id);
    if (!p) { p = new Player(user.id, user.username); this.players.set(user.id, p); }
    p.connected = true;
    if (p.disconnectTimer) { clearTimeout(p.disconnectTimer); p.disconnectTimer = undefined; }
    this.lastActive = Date.now();
    return p;
  }

  removePlayer(userId: string) {
    const p = this.players.get(userId);
    if (p?.disconnectTimer) clearTimeout(p.disconnectTimer);
    this.players.delete(userId);
    this.lastActive = Date.now();
  }

  /** Gdy gospodarza nie ma wśród połączonych graczy, rolę przejmuje następny w kolejności dołączenia */
  ensureHost() {
    const host = this.players.get(this.hostId);
    if (host?.connected) return;
    // pokój utworzony przez bota: twórca ma minutę na dołączenie, zanim rolę przejmie ktoś inny
    if (!host && Date.now() - this.createdAt < 60000) return;
    const next = this.connectedPlayers()[0];
    if (next) this.hostId = next.userId;
  }

  /** Dopisuje fragment pociągnięcia (współrzędne 0–1). Kolejne fragmenty o tym samym id tworzą jedną linię. */
  addStroke(s: Stroke): Stroke | null {
    if (!s || typeof s.id !== 'string' || !Array.isArray(s.points)) return null;
    const points = s.points
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .slice(0, 400)
      .map((p) => [clamp01(p[0]), clamp01(p[1])] as [number, number]);
    if (points.length === 0) return null;
    const clean: Stroke = {
      id: s.id.slice(0, 40),
      color: /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : '#000000',
      width: Math.min(40, Math.max(1, Number(s.width) || 4)),
      points,
    };
    const last = this.strokes[this.strokes.length - 1];
    if (last && last.id === clean.id) last.points.push(...points);
    else if (this.strokes.length < 4000) this.strokes.push({ ...clean });
    return clean;
  }
  undoStroke() { return this.strokes.pop() !== undefined; }
  clearStrokes() { this.strokes = []; }

  /** Stan pokoju wysyłany do wszystkich graczy */
  snapshot() {
    const turn = this.engine.publicTurn();
    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      settings: this.settings,
      round: this.engine.round,
      totalRounds: this.settings.rounds,
      turn,
      players: [...this.players.values()].map((p) => ({
        userId: p.userId, username: p.username, score: p.score, connected: p.connected,
        isHost: p.userId === this.hostId, isDrawer: !!turn && turn.drawerId === p.userId, hasGuessed: p.hasGuessed,
      })),
    };
  }
}

