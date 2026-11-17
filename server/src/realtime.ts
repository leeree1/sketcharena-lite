import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { AuthUser, verifyToken } from './auth';
import { activeBan } from './bans';
import { socketErrorsTotal, socketEventsTotal } from './metrics';
import { config } from './config';
import { GameError } from './game/engine';
import { RoomManager, parseScoreLimit } from './game/rooms';
import { Room } from './game/room';
import { Emitter } from './types';

/** Emitter dla silnika gry: wysyła zdarzenia przez Socket.io do pokoju albo do konkretnego gracza */
export function makeEmitter(io: Server): Emitter {
  return {
    toRoom: (code, event, payload) => { io.to(code).emit(event, payload); },
    toUser: (userId, event, payload) => { io.to(`user:${userId}`).emit(event, payload); },
    toUsers: (userIds, event, payload) => { for (const id of userIds) io.to(`user:${id}`).emit(event, payload); },
  };
}

/** Gateway WebSocket: uwierzytelnia połączenia i przekazuje zdarzenia graczy do pokoju i silnika gry */
export function attachSocket(io: Server, rooms: RoomManager) {
  // Każde połączenie musi mieć poprawny token JWT (klient wysyła go w handshake)
  io.use(async (socket, next) => {
    const user = verifyToken(String(socket.handshake.auth?.token ?? ''));
    if (!user) return next(new Error('UNAUTHORIZED'));
    if (await activeBan(user.id)) return next(new Error('BANNED'));   // zablokowany gracz nie połączy się z grą
    socket.data.user = user;
    next();
  });

  const sys = (code: string, text: string) => io.to(code).emit('chat:message', { id: randomUUID(), kind: 'system', text });
  const broadcast = (room: Room) => io.to(room.code).emit('room:state', room.snapshot());

  /** Gracz opuszcza pokój: świadomie (przycisk) albo przez rozłączenie */
  function leave(socket: Socket, explicit: boolean) {
    const user = socket.data.user as AuthUser;
    const code = socket.data.roomCode as string | undefined;
    if (!code) return;
    socket.data.roomCode = undefined;
    socket.leave(code);
    const room = rooms.get(code);
    const player = room?.players.get(user.id);
    if (!room || !player) return;
    player.socketIds.delete(socket.id);
    if (explicit) {
      player.socketIds.clear();
      io.in(`user:${user.id}`).socketsLeave(code);
      room.removePlayer(user.id);
      sys(code, `${user.username} opuścił(a) pokój.`);
    } else if (player.socketIds.size === 0) {
      player.connected = false;
      // w poczekalni rozłączony gracz znika po 30 s; w trakcie meczu czeka do końca gry
      if (room.status === 'LOBBY') {
        player.disconnectTimer = setTimeout(() => {
          const p = room.players.get(user.id);
          if (!p || p.connected) return;
          room.removePlayer(user.id);
          room.ensureHost();
          sys(code, `${user.username} opuścił(a) pokój.`);
          room.engine.onPlayerGone(user.id);
          broadcast(room);
        }, 30000);
      }
    } else {
      return;                                                     // ten gracz ma jeszcze inną kartę w pokoju
    }
    room.ensureHost();
    room.engine.onPlayerGone(user.id);
    broadcast(room);
  }

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;
    socket.join(`user:${user.id}`);                               // „pokój prywatny” gracza: wiadomości tylko dla niego

    // Opakowanie obsługi zdarzenia: błędy trafiają do gracza jako komunikat
    const on = (event: string, fn: (data: any, ack?: (r: unknown) => void) => Promise<void> | void) => {
      socket.on(event, async (data: any, ack?: (r: unknown) => void) => {
        socketEventsTotal.inc({ event });                          // każde odebrane zdarzenie zwiększa licznik
        try { await fn(data ?? {}, typeof ack === 'function' ? ack : undefined); }
        catch (e) {
          socketErrorsTotal.inc({ event });
          const message = e instanceof GameError ? e.message : 'Wystąpił błąd serwera.';
          if (!(e instanceof GameError)) console.error(`Błąd w zdarzeniu ${event}:`, e);
          if (typeof ack === 'function') ack({ ok: false, error: message }); else socket.emit('error:message', { message });
        }
      });
    };

    const currentRoom = (): Room => {
      const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
      if (!room) throw new GameError('Nie jesteś w żadnym pokoju.');
      return room;
    };

    on('room:join', (data, ack) => {
      const room = rooms.get(String(data.code ?? ''));
      if (!room) throw new GameError('Pokój o tym kodzie nie istnieje.');
      if (room.kicked.has(user.id)) throw new GameError('Gospodarz usunął Cię z tego pokoju.');
      const existing = room.players.get(user.id);
      if (!existing && room.players.size >= room.settings.maxPlayers) throw new GameError('Pokój jest pełny.');
      if (socket.data.roomCode && socket.data.roomCode !== room.code) leave(socket, true);
      const player = room.addPlayer(user);
      player.socketIds.add(socket.id);
      socket.join(room.code);
      socket.data.roomCode = room.code;
      room.ensureHost();
      if (!existing) sys(room.code, `${user.username} dołączył(a) do pokoju.`);
      socket.emit('draw:replay', { strokes: room.strokes });      // nowy gracz od razu widzi dotychczasowy rysunek
      broadcast(room);
      room.engine.resync(user.id);
      ack?.({ ok: true, state: room.snapshot() });
    });

    on('room:leave', () => leave(socket, true));

    on('room:settings', async (data) => {
      const room = currentRoom();
      if (room.hostId !== user.id) throw new GameError('Tylko gospodarz może zmieniać ustawienia.');
      if (room.engine.active) throw new GameError('Ustawień nie można zmieniać w trakcie gry.');
      const s = { ...room.settings };
      if (['EASY', 'MEDIUM', 'HARD'].includes(data.difficulty)) s.difficulty = data.difficulty;
      if (data.categorySlug === null || typeof data.categorySlug === 'string') s.categorySlug = data.categorySlug || null;
      if (Number.isFinite(data.maxPlayers)) s.maxPlayers = Math.min(12, Math.max(room.players.size, 2, data.maxPlayers));
      if (Number.isFinite(data.roundTimeSeconds)) s.roundTimeSeconds = Math.min(180, Math.max(20, data.roundTimeSeconds));
      if (Number.isFinite(data.rounds)) s.rounds = Math.min(10, Math.max(1, data.rounds));
      if (data.scoreLimit === null || Number.isFinite(data.scoreLimit)) s.scoreLimit = parseScoreLimit(data.scoreLimit);
      room.settings = s;
      broadcast(room);
    });

    // Gospodarz usuwa gracza z pokoju (serwer sprawdza, czy to naprawdę gospodarz)
    on('room:kick', (data) => {
      const room = currentRoom();
      if (room.hostId !== user.id) throw new GameError('Tylko gospodarz może usuwać graczy.');
      const targetId = String(data.userId ?? '');
      const target = room.players.get(targetId);
      if (!target || targetId === user.id) throw new GameError('Nie można usunąć tego gracza.');
      room.kicked.add(targetId);
      io.to(`user:${targetId}`).emit('room:kicked', { code: room.code });   // usunięty gracz dostaje powiadomienie
      io.in(`user:${targetId}`).socketsLeave(room.code);
      target.socketIds.clear();
      room.removePlayer(targetId);
      sys(room.code, `${target.username} został(a) usunięty(-a) z pokoju przez gospodarza.`);
      room.engine.onPlayerGone(targetId);
      broadcast(room);
    });

    on('game:start', async () => { await currentRoom().engine.start(user.id); });
    on('game:select-word', async (data) => { await currentRoom().engine.chooseWord(user.id, String(data.wordId ?? '')); });

    // Rysowanie: tylko rysujący może wysyłać pociągnięcia; serwer rozsyła je pozostałym graczom
    on('draw:stroke', (data) => {
      const room = currentRoom();
      if (!room.engine.isDrawer(user.id)) return;
      const clean = room.addStroke(data);
      if (clean) socket.to(room.code).emit('draw:stroke', clean);
    });
    on('draw:undo', () => {
      const room = currentRoom();
      if (room.engine.isDrawer(user.id) && room.undoStroke()) socket.to(room.code).emit('draw:undo');
    });
    on('draw:clear', () => {
      const room = currentRoom();
      if (room.engine.isDrawer(user.id)) { room.clearStrokes(); socket.to(room.code).emit('draw:clear'); }
    });

    on('guess:send', async (data) => { await currentRoom().engine.submitGuess(user.id, String(data.text ?? '')); });

    socket.on('disconnect', () => leave(socket, false));
  });
}

