// Test kontrolny: dwóch graczy rozgrywa krótki mecz przez prawdziwe połączenia WebSocket.
// Uruchom serwer (npm run dev), a potem:  npx tsx test/play.ts
import { io, Socket } from 'socket.io-client';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plain = (w: string) => w.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const connect = (token: string) => new Promise<Socket>((resolve, reject) => {
  const s = io(BASE, { auth: { token }, transports: ['websocket'], forceNew: true });
  s.once('connect', () => resolve(s));
  s.once('connect_error', reject);
});

async function main() {
  const suffix = Math.random().toString(36).slice(2, 6);
  const a = (await api('POST', '/api/auth/guest', { username: `Ola${suffix}` })).json;
  const b = (await api('POST', '/api/auth/guest', { username: `Ala${suffix}` })).json;
  const room = (await api('POST', '/api/rooms', { difficulty: 'EASY', rounds: 1, roundTimeSeconds: 30 }, a.token)).json;
  console.log('Pokój utworzony, kod:', room.code);

  const players = [{ name: 'Ola', auth: a }, { name: 'Ala', auth: b }] as any[];
  let currentWord = '';
  let strokesSeen = 0;
  for (const p of players) {
    p.sock = await connect(p.auth.token);
    p.sock.on('game:choose-word', (d: any) => p.sock.emit('game:select-word', { wordId: d.words[0].id }));
    p.sock.on('draw:stroke', () => { strokesSeen++; });
    p.sock.on('game:turn-start', async (d: any) => {
      if (d.word) {                                               // ten gracz rysuje i zna hasło
        currentWord = d.word;
        console.log(`  Tura: rysuje ${p.name}, hasło: ${d.word}`);
        p.sock.emit('draw:stroke', { id: 's1', color: '#ff0000', width: 4, points: [[0.1, 0.1], [0.5, 0.5]] });
      } else {                                                    // drugi gracz zgaduje
        await sleep(400);
        p.sock.emit('guess:send', { text: 'zzzzzz' });
        await sleep(200);
        p.sock.emit('guess:send', { text: plain(currentWord).toUpperCase() });
      }
    });
  }
  const end = new Promise<any>((resolve) => players[0].sock.on('game:end', resolve));
  for (const p of players) await new Promise((r) => p.sock.emit('room:join', { code: room.code }, r));
  players[0].sock.emit('game:start');
  const result = await Promise.race([end, sleep(60000).then(() => null)]);
  if (!result) { console.error('❌ Mecz się nie zakończył w 60 s'); process.exit(1); }
  console.log('Ranking:', result.ranking.map((r: any) => `${r.rank}. ${r.username} — ${r.score} pkt`).join(' | '));
  console.log(strokesSeen >= 2 ? '✅ Rysunek dotarł do drugiego gracza' : '❌ Brak rysunku u zgadującego');
  process.exit(strokesSeen >= 2 && result.ranking.length === 2 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

