import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { Category, ChatMsg, Difficulty, DIFFICULTY_LABEL, GameEnd, RoomSettings, RoomState, Stroke, TurnEnd } from '../types';
import DrawBoard, { BoardHandle } from './DrawBoard';
import { Badge, Button, Card, DifficultyBadge, inputCls, Label, Modal } from './ui';

function useCountdown(endsAt: number | null, offset: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!endsAt) return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [endsAt]);
  return endsAt ? Math.max(0, endsAt - (now + offset)) : 0;
}

export default function Room({ code, onLeave }: { code: string; onLeave: () => void }) {
  const { user, socket, toast } = useApp();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [choose, setChoose] = useState<{ words: { id: string; word: string }[]; endsAt: number } | null>(null);
  const [word, setWord] = useState('');
  const [hint, setHint] = useState('');
  const [offset, setOffset] = useState(0);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [turnEnd, setTurnEnd] = useState<TurnEnd | null>(null);
  const [gameEnd, setGameEnd] = useState<GameEnd | null>(null);
  const board = useRef<BoardHandle>(null);

  const pushChat = useCallback((m: ChatMsg) => setChat((c) => [...c.slice(-199), m]), []);

  useEffect(() => {
    if (!socket) return;
    const join = () => socket.emit('room:join', { code }, (res: { ok: boolean; error?: string; state?: RoomState }) => {
      if (!res.ok) { toast(res.error ?? 'Nie udało się dołączyć do pokoju.', 'error'); onLeave(); return; }
      setRoom(res.state!);
    });
    const h: Record<string, (d: any) => void> = {
      'room:state': (s: RoomState) => { setRoom(s); if (!s.turn) { setWord(''); setHint(''); } },
      'game:choose-word': (d) => { setTurnEnd(null); setChoose({ words: d.words, endsAt: Date.now() + d.timeoutSec * 1000 }); },
      'game:turn-start': (d) => { setChoose(null); setTurnEnd(null); setGameEnd(null); setWord(d.word ?? ''); setHint(''); setOffset(d.serverTime - Date.now()); },
      'game:hint': (d) => { if (d.text) setHint(d.text); },
      'game:turn-end': (d: TurnEnd) => { setChoose(null); setTurnEnd(d); },
      'game:end': (d: GameEnd) => { setTurnEnd(null); setChoose(null); setGameEnd(d); },
      'draw:stroke': (s: Stroke) => board.current?.applyStroke(s),
      'draw:undo': () => board.current?.undo(),
      'draw:clear': () => board.current?.clear(),
      'draw:replay': (d: { strokes: Stroke[] }) => board.current?.replay(d.strokes),
      'chat:message': (m: ChatMsg) => pushChat(m),
      'guess:result': (r: { correct: boolean; points?: number }) => { if (r.correct) toast(`Brawo! +${r.points} pkt`, 'success'); },
      'error:message': (d: { message: string }) => toast(d.message, 'error'),
    };
    for (const [ev, fn] of Object.entries(h)) socket.on(ev, fn);
    if (socket.connected) join();
    socket.on('connect', join);                                  // ponowne dołączenie po zerwaniu połączenia
    return () => { socket.off('connect', join); for (const [ev, fn] of Object.entries(h)) socket.off(ev, fn); socket.emit('room:leave'); };
  }, [socket, code]);                                            // eslint-disable-line react-hooks/exhaustive-deps

  const turn = room?.turn ?? null;
  const isHost = room?.hostId === user.id;
  const isDrawer = turn?.drawerId === user.id;
  const phase = turn?.phase;
  const drawing = phase === 'DRAWING';
  const me = room?.players.find((p) => p.userId === user.id);
  const remaining = useCountdown(drawing ? turn!.endsAt : null, offset);
  const chooseLeft = useCountdown(choose ? choose.endsAt : null, 0);
  const total = (room?.settings.roundTimeSeconds ?? 80) * 1000;
  const shownMask = drawing ? (isDrawer ? word : turn!.mask) : '';
  const players = useMemo(() => (room ? (room.status === 'IN_GAME' ? [...room.players].sort((a, b) => b.score - a.score) : room.players) : []), [room]);

  const emit = (ev: string, data?: unknown) => socket?.emit(ev, data);
  const copy = () => { navigator.clipboard?.writeText(code).then(() => toast('Skopiowano kod pokoju', 'success')).catch(() => toast(`Kod pokoju: ${code}`)); };

  if (!room) return <div className="grid min-h-[50vh] place-items-center text-slate-500">Łączenie z pokojem {code}…</div>;

  return (
    <div className="space-y-3">
      {/* pasek stanu */}
      <Card className="!rounded-2xl">
        <div className="-m-1 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={onLeave}>← Opuść pokój</Button>
          <button onClick={copy} className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 font-mono text-sm font-bold tracking-widest text-indigo-700 hover:bg-indigo-100" title="Kopiuj kod pokoju">{code} <span className="text-xs" aria-hidden>⧉</span></button>
          <DifficultyBadge d={room.settings.difficulty} />
          {room.status === 'IN_GAME' && <Badge>Runda {room.round}/{room.totalRounds}</Badge>}
          <div className="min-w-0 flex-1 text-center">
            {drawing ? (
              <div>
                <div className="text-xs font-semibold text-slate-500">{isDrawer ? 'Twoje hasło do narysowania:' : `Rysuje ${turn!.drawerName} — zgadnij hasło`}</div>
                <div className={`mask whitespace-pre-wrap break-words text-2xl font-extrabold ${isDrawer ? 'text-indigo-700' : 'text-slate-800'}`} aria-label={isDrawer ? `Hasło: ${word}` : 'Maska hasła'}>{shownMask}</div>
                {hint && !isDrawer && <div className="mx-auto mt-1 max-w-md rounded-lg bg-amber-50 px-3 py-1 text-xs text-amber-800 slide-in">💡 Podpowiedź: {hint}</div>}
              </div>
            ) : phase === 'CHOOSING' ? <div className="text-sm font-semibold text-slate-600">{isDrawer ? 'Wybierz hasło do narysowania' : `${turn!.drawerName} wybiera hasło…`}</div>
              : room.status === 'LOBBY' ? <div className="text-sm font-semibold text-slate-600">Poczekalnia — czekamy na start gry</div>
              : <div className="text-sm font-semibold text-slate-600">Podsumowanie tury</div>}
          </div>
          {drawing && (
            <div className="w-28 text-right" role="timer" aria-label="Pozostały czas">
              <div className={`text-2xl font-extrabold tabular-nums ${remaining < 10000 ? 'text-rose-600' : 'text-slate-800'}`}>{Math.ceil(remaining / 1000)} s</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${remaining < 10000 ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, (remaining / total) * 100)}%` }} /></div>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)_320px]">
        {/* gracze */}
        <Card title={`Gracze (${room.players.filter((p) => p.connected).length}/${room.settings.maxPlayers})`} className="order-2 lg:order-1">
          <ul className="space-y-1.5">
            {players.map((p, i) => (
              <li key={p.userId} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${p.isDrawer && drawing ? 'bg-indigo-50 ring-1 ring-indigo-200' : p.hasGuessed && drawing ? 'bg-emerald-50' : ''} ${p.connected ? '' : 'opacity-50'}`}>
                <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-bold text-slate-700">{p.username[0]?.toUpperCase()}{room.status === 'IN_GAME' && i === 0 && p.score > 0 && <span className="absolute -right-1 -top-2 text-xs" aria-hidden>👑</span>}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 truncate text-sm font-semibold">{p.username}{p.userId === user.id && <span className="text-xs font-normal text-slate-400">(Ty)</span>}</div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">{p.isHost && <span title="Gospodarz">★ gospodarz</span>}{p.isDrawer && drawing && <span>✏️ rysuje</span>}{p.hasGuessed && drawing && <span className="text-emerald-600">✔ odgadł(a)</span>}{!p.connected && <span>rozłączony</span>}</div>
                </div>
                <div className="text-right"><div className="font-mono text-sm font-bold">{p.score}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* środek: poczekalnia lub płótno */}
        <div className="order-1 min-w-0 lg:order-2">
          {room.status === 'LOBBY' ? <LobbyPanel room={room} isHost={isHost} onSettings={(p) => emit('room:settings', p)} onStart={() => emit('game:start')} onCopy={copy} />
            : (
              <DrawBoard ref={board} canDraw={isDrawer && drawing} onStroke={(s) => emit('draw:stroke', s)} onUndo={() => emit('draw:undo')} onClear={() => emit('draw:clear')}>
                {phase === 'CHOOSING' && isDrawer && choose && (
                  <div className="pop absolute inset-0 grid place-items-center rounded-xl bg-white/90 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-sm text-center">
                      <h3 className="text-lg font-bold">Wybierz hasło</h3>
                      <p className="text-xs text-slate-500">Zostało {Math.ceil(chooseLeft / 1000)} s — potem hasło wybierze system</p>
                      <div className="mt-3 grid gap-2">{choose.words.map((w) => <Button key={w.id} onClick={() => { emit('game:select-word', { wordId: w.id }); setChoose(null); }} className="!py-3 !text-base">{w.word}</Button>)}</div>
                    </div>
                  </div>
                )}
                {phase === 'CHOOSING' && !isDrawer && <div className="absolute inset-0 grid place-items-center rounded-xl bg-white/70 text-center"><div><div className="text-3xl" aria-hidden>🤔</div><div className="mt-1 text-sm font-semibold text-slate-700">{turn?.drawerName} wybiera hasło…</div></div></div>}
                {phase === 'TURN_END' && turnEnd && (
                  <div className="pop absolute inset-0 grid place-items-center rounded-xl bg-slate-900/70 p-4 text-white">
                    <div className="w-full max-w-xs text-center">
                      <div className="text-xs uppercase tracking-wider text-slate-300">{turnEnd.reason === 'ALL_GUESSED' ? 'Wszyscy odgadli!' : turnEnd.reason === 'DRAWER_LEFT' ? 'Rysujący wyszedł' : 'Koniec czasu'}</div>
                      {turnEnd.word && <div className="mt-1 text-3xl font-extrabold">{turnEnd.word}</div>}
                      <ul className="mt-3 space-y-1 text-sm">{[...turnEnd.scores].sort((a, b) => b.delta - a.delta).filter((s) => s.delta > 0).map((s) => <li key={s.userId} className="flex justify-between rounded-lg bg-white/10 px-3 py-1"><span>{room.players.find((p) => p.userId === s.userId)?.username}</span><span className="font-mono font-bold text-emerald-300">+{s.delta}</span></li>)}{turnEnd.scores.every((s) => s.delta === 0) && <li className="text-slate-300">Nikt nie zdobył punktów.</li>}</ul>
                    </div>
                  </div>
                )}
              </DrawBoard>
            )}
        </div>

        {/* czat */}
        <ChatBox messages={chat} placeholder={isDrawer && drawing ? 'Rysujesz — nie możesz zgadywać' : me?.hasGuessed && drawing ? 'Odgadłeś! Piszesz tylko do tych, którzy znają hasło' : drawing ? 'Wpisz odpowiedź i naciśnij Enter…' : 'Napisz do pokoju…'} disabled={isDrawer && drawing} onSend={(text) => emit('guess:send', { text })} />
      </div>

      {gameEnd && <GameEndModal end={gameEnd} meId={user.id} onClose={() => setGameEnd(null)} onLeave={onLeave} />}
    </div>
  );
}

function LobbyPanel({ room, isHost, onSettings, onStart, onCopy }: { room: RoomState; isHost: boolean; onSettings: (p: Partial<RoomSettings>) => void; onStart: () => void; onCopy: () => void }) {
  const [cats, setCats] = useState<Category[]>([]);
  useEffect(() => { api<{ categories: Category[] }>('GET', '/kb/categories').then((r) => setCats(r.categories)).catch(() => undefined); }, []);
  const s = room.settings;
  const connected = room.players.filter((p) => p.connected).length;
  return (
    <Card title="Poczekalnia" className="min-h-[420px]">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <div className="rounded-xl bg-indigo-50 p-4 text-center">
            <div className="text-xs font-semibold text-indigo-600">Kod pokoju — wyślij znajomym</div>
            <div className="mt-1 font-mono text-4xl font-extrabold tracking-[0.3em] text-indigo-700">{room.code}</div>
            <Button size="sm" variant="secondary" onClick={onCopy} className="mt-2">Kopiuj kod</Button>
          </div>
          <p className="text-sm text-slate-600">{isHost ? 'Jesteś gospodarzem: ustaw parametry gry i rozpocznij mecz, gdy wszyscy będą gotowi.' : 'Czekamy, aż gospodarz rozpocznie grę. Poniżej widzisz ustawienia pokoju.'}</p>
          {isHost ? <Button onClick={onStart} disabled={connected < 2} className="w-full !py-3 !text-base">▶ Rozpocznij grę</Button> : <div className="rounded-lg bg-slate-50 px-3 py-2 text-center text-sm text-slate-500">Czekaj na gospodarza…</div>}
          {connected < 2 && <p className="text-center text-xs text-slate-500">Do startu potrzeba co najmniej 2 graczy.</p>}
        </div>
        <fieldset disabled={!isHost} className="space-y-3">
          <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Ustawienia gry</legend>
          <div><Label>Poziom trudności</Label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-semibold">{(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((d) => <button type="button" key={d} onClick={() => onSettings({ difficulty: d })} aria-pressed={s.difficulty === d} className={`rounded-md py-1.5 ${s.difficulty === d ? 'bg-white text-indigo-700 shadow' : 'text-slate-600'} disabled:cursor-not-allowed`}>{DIFFICULTY_LABEL[d]}</button>)}</div></div>
          <div><Label htmlFor="rc">Kategoria haseł</Label><select id="rc" className={inputCls} value={s.categorySlug ?? ''} onChange={(e) => onSettings({ categorySlug: e.target.value || null })}><option value="">Wszystkie kategorie</option>{cats.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="rmp">Gracze</Label><input id="rmp" type="number" min={2} max={12} className={inputCls} value={s.maxPlayers} onChange={(e) => onSettings({ maxPlayers: Number(e.target.value) })} /></div>
            <div><Label htmlFor="rrt">Czas (s)</Label><input id="rrt" type="number" min={20} max={180} step={10} className={inputCls} value={s.roundTimeSeconds} onChange={(e) => onSettings({ roundTimeSeconds: Number(e.target.value) })} /></div>
            <div><Label htmlFor="rrd">Rundy</Label><input id="rrd" type="number" min={1} max={10} className={inputCls} value={s.rounds} onChange={(e) => onSettings({ rounds: Number(e.target.value) })} /></div>
          </div>
          {s.difficulty === 'HARD' && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">W rundach trudnych zgadujący dostają w połowie czasu podpowiedź opisową z bazy wiedzy.</p>}
        </fieldset>
      </div>
    </Card>
  );
}

function ChatBox({ messages, onSend, placeholder, disabled }: { messages: ChatMsg[]; onSend: (t: string) => void; placeholder: string; disabled: boolean }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages]);
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim() && !disabled) { onSend(text); setText(''); } };
  return (
    <Card title="Czat i odpowiedzi" fill className="order-3 h-[420px] lg:h-[560px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3 text-sm" aria-live="polite">
          {messages.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Tu pojawią się odpowiedzi graczy.</p>}
          {messages.map((m) => m.kind === 'system' ? <div key={m.id} className="py-0.5 text-center text-xs italic text-slate-400">{m.text}</div>
            : m.kind === 'correct' ? <div key={m.id} className="rounded-lg bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">✔ {m.text}</div>
            : m.kind === 'close' ? <div key={m.id} className="rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-700">{m.text}</div>
            : m.kind === 'secret' ? <div key={m.id} className="rounded-lg bg-violet-50 px-2 py-1 text-violet-800"><span aria-hidden>🔒</span> <b>{m.username}:</b> {m.text}</div>
            : <div key={m.id}><b className="text-slate-700">{m.username}:</b> <span className="text-slate-600">{m.text}</span></div>)}
          <div ref={end} />
        </div>
        <form onSubmit={submit} className="flex gap-2 border-t border-slate-100 p-2.5">
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} disabled={disabled} maxLength={100} aria-label="Odpowiedź lub wiadomość" autoComplete="off" />
          <Button type="submit" disabled={disabled || !text.trim()}>Wyślij</Button>
        </form>
      </div>
    </Card>
  );
}

function GameEndModal({ end, meId, onClose, onLeave }: { end: GameEnd; meId: string; onClose: () => void; onLeave: () => void }) {
  const medal = (r: number) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `${r}.`);
  return (
    <Modal title={end.aborted ? 'Mecz przerwany' : '🏆 Koniec meczu!'} onClose={onClose}>
      {end.aborted && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">W pokoju zostało za mało graczy albo zabrakło haseł dla wybranych ustawień.</p>}
      <ol className="space-y-2">
        {end.ranking.map((r) => {
          return (
            <li key={r.userId} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${r.rank === 1 && !end.aborted ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-slate-50'} ${r.userId === meId ? 'font-bold' : ''}`}>
              <span className="w-8 text-center text-xl">{medal(r.rank)}</span><span className="flex-1 truncate">{r.username}</span>
              {r.elo && <span className={`text-sm font-mono ${r.elo.after >= r.elo.before ? 'text-emerald-600' : 'text-rose-600'}`}>ELO {r.elo.after} ({r.elo.after >= r.elo.before ? '+' : ''}{r.elo.after - r.elo.before})</span>}
              <span className="font-mono">{r.score} pkt</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onLeave}>Opuść pokój</Button><Button onClick={onClose}>Wróć do poczekalni</Button></div>
    </Modal>
  );
}
