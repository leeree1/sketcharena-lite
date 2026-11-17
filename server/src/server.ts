import http from 'http';
import express, { NextFunction, Request, Response } from 'express';
import { Server } from 'socket.io';
import { config } from './config';
import { query } from './db';
import { authenticate, authRouter } from './auth';
import { kbRouter } from './knowledge';
import { chatbotRouter } from './chatbot';
import { HttpError } from './errors';
import { RoomManager, roomsRouter } from './game/rooms';
import { attachSocket, makeEmitter } from './realtime';

const app = express();
app.use(express.json());
app.use(authenticate);

const httpServer = http.createServer(app);
const io = new Server(httpServer);
const rooms = new RoomManager(makeEmitter(io));
attachSocket(io, rooms);

app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', db: true });
  } catch {
    res.status(503).json({ status: 'degraded', db: false });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/kb', kbRouter);
app.use('/api/rooms', roomsRouter(rooms));
app.use('/api/chatbot', chatbotRouter(rooms));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: { message: err.message } });
  console.error(err);
  res.status(500).json({ error: { message: 'Wystąpił błąd serwera.' } });
});

httpServer.listen(config.port, () => console.log(`Serwer działa: http://localhost:${config.port}`));
