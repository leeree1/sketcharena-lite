import { randomUUID } from 'crypto';
import { config } from '../config';
import { Difficulty, Emitter, Word } from '../types';
import { checkGuess } from './guess';
import { drawerPoints, guessPoints, MULTIPLIER } from './scoring';
import type { Room } from './room';
import { gamesAbortedTotal, gamesFinishedTotal, gamesStartedTotal } from '../metrics';

/** Błąd, który pokazujemy graczowi (np. „Tylko gospodarz może rozpocząć grę”) */
export class GameError extends Error {}

export interface RankRow { userId: string; username: string; score: number; rank: number; elo?: { before: number; after: number } }

export interface EngineDeps {
  emitter: Emitter;
  pickWords: (difficulty: Difficulty, categorySlug: string | null, n: number, excludeIds: string[]) => Promise<Word[]>;
  onChange: () => void;                                        // wywoływane po każdej zmianie stanu pokoju
  onFinish: (room: Room, ranking: RankRow[]) => Promise<void | Record<string, { before: number; after: number }>>; // zapis wyniku meczu
}

type Phase = 'IDLE' | 'CHOOSING' | 'DRAWING' | 'TURN_END';
interface Turn { drawerId: string; choices: Word[]; word: Word | null; endsAt: number; revealed: Set<number>; points: Map<string, number> }

const isLetter = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** Silnik gry jednego pokoju: wybór hasła → rysowanie → podsumowanie tury → … → koniec meczu */
export class GameEngine {
  phase: Phase = 'IDLE';
  round = 0;
  private queue: string[] = [];          // kolejka rysujących w bieżącej rundzie
  private turn: Turn | null = null;
  private timers: NodeJS.Timeout[] = [];
  private used: string[] = [];           // hasła użyte w tym meczu

  constructor(private room: Room, private d: EngineDeps) {}

  get active() { return this.phase !== 'IDLE'; }
  isDrawer(userId: string) { return this.phase === 'DRAWING' && this.turn?.drawerId === userId; }

  // ---------- pomocnicze ----------
  private timer(fn: () => void, ms: number) { this.timers.push(setTimeout(fn, Math.max(0, ms))); }
  private clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  destroy() { this.clearTimers(); }

  private broadcast() {
    this.d.emitter.toRoom(this.room.code, 'room:state', this.room.snapshot());
    this.d.onChange();
  }

  /** Maska hasła: litery jako „_”, odsłonięte litery i spacje bez zmian, np. „_ _ r z _ s _ o” */
  private mask(): string {
    const t = this.turn;
    if (!t?.word) return '';
    return [...t.word.word].map((ch, i) => (isLetter(ch) ? (t.revealed.has(i) ? ch : '_') : ch)).join('');
  }

  /** Dane tury widoczne dla wszystkich (bez hasła!) */
  publicTurn() {
    if (!this.turn || this.phase === 'IDLE') return null;
    return {
      phase: this.phase,
      drawerId: this.turn.drawerId,
      drawerName: this.room.players.get(this.turn.drawerId)?.username ?? '',
      mask: this.mask(),
      endsAt: this.turn.endsAt,
      serverTime: Date.now(),
      difficulty: this.turn.word?.difficulty ?? this.room.settings.difficulty,
    };
  }

  // ---------- start meczu ----------
  async start(userId: string) {
    if (this.room.hostId !== userId) throw new GameError('Tylko gospodarz może rozpocząć grę.');
    if (this.active) throw new GameError('Gra już trwa.');
    if (this.room.connectedPlayers().length < config.minPlayers) throw new GameError(`Do rozpoczęcia gry potrzeba co najmniej ${config.minPlayers} graczy.`);
    for (const p of [...this.room.players.values()]) {
      if (!p.connected) this.room.removePlayer(p.userId); else { p.score = 0; p.hasGuessed = false; }
    }
    this.phase = 'CHOOSING';
    this.room.status = 'IN_GAME';
    this.round = 1;
    gamesStartedTotal.inc();
    this.used = [];
    this.queue = this.room.connectedPlayers().map((p) => p.userId);
    this.d.emitter.toRoom(this.room.code, 'chat:message', { id: randomUUID(), kind: 'system', text: 'Gra się rozpoczęła! Powodzenia!' });
    this.broadcast();
    await this.nextTurn();
  }

  // ---------- kolejna tura ----------
  private async nextTurn() {
    this.clearTimers();
    const limit = this.room.settings.scoreLimit;             // limit punktów ustawiony przez gospodarza
    if (limit && [...this.room.players.values()].some((p) => p.score >= limit)) return this.finish();
    let drawerId: string | undefined;
    for (;;) {
      if (this.room.connectedPlayers().length < config.minPlayers) return this.abort();
      const id = this.queue.shift();
      if (id === undefined) {                                  // koniec rundy
        if (this.round >= this.room.settings.rounds) return this.finish();
        this.round++;
        this.queue = this.room.connectedPlayers().map((p) => p.userId);
        continue;
      }
      if (this.room.players.get(id)?.connected) { drawerId = id; break; }
    }
    const s = this.room.settings;
    const choices = await this.d.pickWords(s.difficulty, s.categorySlug, 3, this.used);
    if (choices.length === 0) return this.abort();
    for (const p of this.room.players.values()) p.hasGuessed = false;
    this.turn = { drawerId, choices, word: null, endsAt: 0, revealed: new Set(), points: new Map() };
    this.phase = 'CHOOSING';
    this.room.clearStrokes();
    this.d.emitter.toRoom(this.room.code, 'draw:clear');
    this.sendChoices();
    this.broadcast();
    // jeśli rysujący nie wybierze hasła na czas, wybieramy za niego pierwsze
    this.timer(() => { void this.pick(drawerId!, choices[0].id).catch(console.error); }, config.chooseWordMs);
  }

  private sendChoices() {
    const t = this.turn;
    if (!t) return;
    this.d.emitter.toUser(t.drawerId, 'game:choose-word', { words: t.choices.map((w) => ({ id: w.id, word: w.word })), timeoutSec: Math.round(config.chooseWordMs / 1000) });
  }

  async chooseWord(userId: string, wordId: string) {
    if (this.phase !== 'CHOOSING' || this.turn?.drawerId !== userId) throw new GameError('Teraz nie możesz wybrać hasła.');
    if (!this.turn.choices.some((w) => w.id === wordId)) throw new GameError('To hasło nie było w propozycjach.');
    await this.pick(userId, wordId);
  }

  private async pick(userId: string, wordId: string) {
    const t = this.turn;
    if (this.phase !== 'CHOOSING' || !t || t.drawerId !== userId) return;
    const word = t.choices.find((w) => w.id === wordId);
    if (!word) return;
    this.clearTimers();
    this.phase = 'DRAWING';
    t.word = word;
    this.used.push(word.id);
    const total = this.room.settings.roundTimeSeconds * 1000;
    t.endsAt = Date.now() + total;
    for (const p of this.room.connectedPlayers()) this.sendTurnStart(p.userId);
    this.broadcast();
    // odsłanianie liter (40% i 70% czasu) i podpowiedź opisowa w rundach trudnych (50%)
    this.timer(() => this.revealLetter(), total * 0.4);
    this.timer(() => this.revealLetter(), total * 0.7);
    if (word.difficulty === 'HARD') this.timer(() => this.d.emitter.toRoom(this.room.code, 'game:hint', { text: word.hint }), total * 0.5);
    this.timer(() => { void this.endTurn('TIMEOUT'); }, total);
  }

  private sendTurnStart(userId: string) {
    const t = this.turn;
    if (!t?.word) return;
    this.d.emitter.toUser(userId, 'game:turn-start', {
      ...this.publicTurn(),
      round: this.round,
      totalRounds: this.room.settings.rounds,
      ...(userId === t.drawerId ? { word: t.word.word } : {}),    // tylko rysujący zna hasło
    });
  }

  /** Po powrocie gracza do pokoju odtwarza stan bieżącej tury tylko dla niego */
  resync(userId: string) {
    if (this.phase === 'CHOOSING' && this.turn?.drawerId === userId) this.sendChoices();
    if (this.phase === 'DRAWING') this.sendTurnStart(userId);
  }

  private revealLetter() {
    const t = this.turn;
    if (this.phase !== 'DRAWING' || !t?.word) return;
    const letters = [...t.word.word].map((ch, i) => (isLetter(ch) && !t.revealed.has(i) ? i : -1)).filter((i) => i >= 0);
    const total = [...t.word.word].filter(isLetter).length;
    if (total < 4 || letters.length <= 2 || t.revealed.size >= Math.floor(total / 2)) return;
    t.revealed.add(letters[Math.floor(Math.random() * letters.length)]);
    this.broadcast();                                          // nowa maska trafia do graczy w room:state
  }

  // ---------- odpowiedzi graczy ----------
  private allGuessed(): boolean {
    const t = this.turn;
    if (!t) return false;
    const guessers = this.room.connectedPlayers().filter((p) => p.userId !== t.drawerId);
    return guessers.length > 0 && guessers.every((p) => p.hasGuessed);
  }

  async submitGuess(userId: string, rawText: string) {
    const text = rawText.trim().slice(0, 100);
    const player = this.room.players.get(userId);
    if (!text || !player) return;
    const t = this.turn;
    const e = this.d.emitter;
    const msg = (kind: string, extra: object = {}) => ({ id: randomUUID(), userId, username: player.username, text, kind, ...extra });

    if (this.phase !== 'DRAWING' || !t?.word) {                // poza turą rysowania to zwykły czat
      e.toRoom(this.room.code, 'chat:message', msg('chat'));
      return;
    }
    if (userId === t.drawerId) { e.toUser(userId, 'error:message', { message: 'Rysujący nie może zgadywać.' }); return; }
    if (player.hasGuessed) {                                   // kto już odgadł, pisze tylko do osób znających hasło
      const audience = [t.drawerId, ...this.room.connectedPlayers().filter((p) => p.hasGuessed).map((p) => p.userId)];
      e.toUsers([...new Set(audience)], 'chat:message', msg('secret'));
      return;
    }

    const verdict = checkGuess(text, t.word.word);
    if (verdict === 'correct') {
      const remaining = Math.max(0, (t.endsAt - Date.now()) / 1000);
      const pts = guessPoints(MULTIPLIER[t.word.difficulty], remaining, this.room.settings.roundTimeSeconds);
      player.score += pts;
      player.hasGuessed = true;
      t.points.set(userId, (t.points.get(userId) ?? 0) + pts);
      const drawer = this.room.players.get(t.drawerId);
      if (drawer) { const dp = drawerPoints(pts); drawer.score += dp; t.points.set(drawer.userId, (t.points.get(drawer.userId) ?? 0) + dp); }
      e.toUser(userId, 'guess:result', { correct: true, points: pts });
      e.toRoom(this.room.code, 'chat:message', { id: randomUUID(), kind: 'correct', text: `${player.username} odgadł(a) hasło! (+${pts} pkt)` });
      this.broadcast();
      if (this.allGuessed()) await this.endTurn('ALL_GUESSED');
    } else if (verdict === 'close') {                          // „blisko” widzi tylko autor odpowiedzi
      e.toUser(userId, 'chat:message', msg('guess'));
      e.toUser(userId, 'chat:message', { id: randomUUID(), kind: 'close', text: 'Blisko! Sprawdź jeszcze raz.' });
    } else {
      e.toRoom(this.room.code, 'chat:message', msg('guess'));
    }
  }

  // ---------- koniec tury ----------
  private async endTurn(reason: 'ALL_GUESSED' | 'TIMEOUT' | 'DRAWER_LEFT') {
    if (this.phase !== 'DRAWING' && this.phase !== 'CHOOSING') return;
    this.clearTimers();
    const t = this.turn;
    this.phase = 'TURN_END';
    const scores = [...this.room.players.values()].map((p) => ({ userId: p.userId, delta: t?.points.get(p.userId) ?? 0, total: p.score }));
    this.d.emitter.toRoom(this.room.code, 'game:turn-end', { word: t?.word?.word ?? null, scores, reason });
    this.broadcast();
    this.timer(() => { void this.nextTurn().catch(console.error); }, config.turnEndMs);
  }

  /** Wywoływane, gdy gracz wyszedł albo się rozłączył */
  onPlayerGone(userId: string) {
    if (!this.active) return;
    if (this.room.connectedPlayers().length < config.minPlayers) { void this.abort(); return; }
    const t = this.turn;
    if (t && t.drawerId === userId && (this.phase === 'CHOOSING' || this.phase === 'DRAWING')) { void this.endTurn('DRAWER_LEFT'); return; }
    if (this.phase === 'DRAWING' && this.allGuessed()) void this.endTurn('ALL_GUESSED');
  }

  // ---------- koniec meczu ----------
  /** Ranking według punktów; gracze z tym samym wynikiem mają to samo miejsce */
  private ranking(): RankRow[] {
    const sorted = [...this.room.players.values()].sort((a, b) => b.score - a.score);
    let rank = 0, last = Number.NaN;
    return sorted.map((p, i) => {
      if (p.score !== last) { rank = i + 1; last = p.score; }
      return { userId: p.userId, username: p.username, score: p.score, rank };
    });
  }

  private resetToLobby() {
    this.clearTimers();
    this.phase = 'IDLE';
    this.turn = null;
    this.room.status = 'LOBBY';
    for (const p of [...this.room.players.values()]) { if (!p.connected) this.room.removePlayer(p.userId); p.hasGuessed = false; }
    this.room.ensureHost();
    this.room.clearStrokes();
  }

  private async finish() {
    if (!this.active) return;
    let ranking = this.ranking();
    this.clearTimers();
    try {
      const elo = await this.d.onFinish(this.room, ranking);
      if (elo) ranking = ranking.map((r) => ({ ...r, elo: elo[r.userId] }));   // dołącza zmianę ELO do wiersza rankingu
    } catch (e) { console.error('Nie udało się zapisać wyniku meczu:', e); }
    gamesFinishedTotal.inc();
    this.resetToLobby();
    this.d.emitter.toRoom(this.room.code, 'game:end', { aborted: false, ranking });
    this.broadcast();
  }

  private abort() {
    if (!this.active) return;
    const ranking = this.ranking();
    gamesAbortedTotal.inc();
    this.resetToLobby();
    this.d.emitter.toRoom(this.room.code, 'game:end', { aborted: true, ranking });
    this.d.emitter.toRoom(this.room.code, 'chat:message', { id: randomUUID(), kind: 'system', text: 'Za mało graczy lub brak haseł — mecz został przerwany.' });
    this.broadcast();
  }
}

