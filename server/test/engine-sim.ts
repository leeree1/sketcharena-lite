// Symulacja silnika gry bez sieci i bazy: sztuczny „emitter” wypisuje zdarzenia w konsoli.
import { GameEngine } from '../src/game/engine';
import { Room } from '../src/game/room';
import { Emitter } from '../src/types';

process.env.CHOOSE_WORD_MS = '5000';
const log: string[] = [];
const emitter: Emitter = {
  toRoom: (code, event, p) => { log.push(`[pokój ${code}] ${event}`); },
  toUser: (id, event, p: any) => { log.push(`[→ ${id}] ${event}${p?.word ? ` hasło=${p.word}` : ''}`); },
  toUsers: (ids, event) => { log.push(`[→ ${ids.join(',')}] ${event}`); },
};
const words = [
  { id: '1', word: 'krzesło', difficulty: 'EASY' as const, hint: 'Siadamy na nim.' },
  { id: '2', word: 'parasol', difficulty: 'EASY' as const, hint: 'Chroni przed deszczem.' },
  { id: '3', word: 'klucz', difficulty: 'EASY' as const, hint: 'Otwiera zamek.' },
];

async function main() {
  const room = new Room('id1', 'ABC123', 'u1', { difficulty: 'EASY', categorySlug: null, maxPlayers: 4, roundTimeSeconds: 30, rounds: 1, isPrivate: false });
  room.engine = new GameEngine(room, {
    emitter, pickWords: async () => words, onChange: () => {},
    onFinish: async (_r, ranking) => { console.log('\nRANKING:', ranking.map((r) => `${r.rank}. ${r.username} ${r.score} pkt`).join(' | ')); },
  });
  room.addPlayer({ id: 'u1', username: 'Ola', role: 'GUEST' });
  room.addPlayer({ id: 'u2', username: 'Ala', role: 'GUEST' });

  await room.engine.start('u1');
  for (const drawerId of ['u1', 'u2']) {
    const guesser = drawerId === 'u1' ? 'u2' : 'u1';
    await room.engine.chooseWord(drawerId, '1');                      // rysujący wybiera „krzesło”
    await room.engine.submitGuess(guesser, 'stol');                  // błędna odpowiedź
    await room.engine.submitGuess(guesser, 'Krzeslo');               // poprawna (bez polskich znaków)
    await new Promise((r) => setTimeout(r, 4500));                   // pauza po turze
  }
  await new Promise((r) => setTimeout(r, 300));
  console.log(log.join('\n'));
  room.engine.destroy();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

