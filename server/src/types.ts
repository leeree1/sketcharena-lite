export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface RoomSettings {
  difficulty: Difficulty;
  categorySlug: string | null;
  maxPlayers: number;
  roundTimeSeconds: number;
  rounds: number;
  isPrivate: boolean;
}

export interface Word { id: string; word: string; difficulty: Difficulty; hint: string }

/** Fragment rysunku: punkty mają współrzędne od 0 do 1, więc rysunek wygląda tak samo na każdym ekranie */
export interface Stroke { id: string; color: string; width: number; points: [number, number][] }

/** Dzięki temu interfejsowi silnik gry nie zależy od Socket.io (łatwo go przetestować) */
export interface Emitter {
  toRoom(code: string, event: string, payload?: unknown): void;
  toUser(userId: string, event: string, payload?: unknown): void;
  toUsers(userIds: string[], event: string, payload?: unknown): void;
}

