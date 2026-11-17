export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type Role = 'GUEST' | 'PLAYER' | 'MODERATOR' | 'ADMIN';
export interface User { id: string; username: string; role: Role }
export interface RoomSettings { difficulty: Difficulty; categorySlug: string | null; maxPlayers: number; roundTimeSeconds: number; rounds: number; isPrivate: boolean }
export interface RoomSummary { code: string; hostName: string; difficulty: Difficulty; category: string | null; players: number; maxPlayers: number; status: 'LOBBY' | 'IN_GAME'; rounds: number; roundTimeSeconds: number }
export interface Category { id: number; slug: string; name: string; keywords: string[] }

export interface PlayerState { userId: string; username: string; score: number; connected: boolean; isHost: boolean; isDrawer: boolean; hasGuessed: boolean }
export interface TurnPublic { phase: 'CHOOSING' | 'DRAWING' | 'TURN_END'; drawerId: string; drawerName: string; mask: string; endsAt: number; serverTime: number; difficulty: Difficulty }
export interface RoomState { code: string; status: 'LOBBY' | 'IN_GAME'; hostId: string; settings: RoomSettings; round: number; totalRounds: number; turn: TurnPublic | null; players: PlayerState[] }
export interface Stroke { id: string; color: string; width: number; points: [number, number][] }
export interface ChatMsg { id: string; userId?: string; username?: string; text: string; kind: 'guess' | 'correct' | 'close' | 'secret' | 'system' | 'chat' }
export interface TurnEnd { word: string | null; scores: { userId: string; delta: number; total: number }[]; reason: string }
export interface RankRow { userId: string; username: string; score: number; rank: number }
export interface GameEnd { aborted: boolean; ranking: RankRow[] }

export interface Article { id: string; slug: string; title: string; type: 'RULES' | 'DRAWING_TIPS' | 'FAQ' | 'GLOSSARY'; content?: string; excerpt?: string }
export interface BotReply { reply: string; intent: string; action?: { type: 'join_room'; roomCode: string; label: string }; sources: { slug: string; title: string }[] }

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { EASY: 'Łatwy', MEDIUM: 'Średni', HARD: 'Trudny' };
export const ARTICLE_TYPE_LABEL: Record<Article['type'], string> = { RULES: 'Zasady', DRAWING_TIPS: 'Porady rysowania', FAQ: 'FAQ', GLOSSARY: 'Słownik' };
