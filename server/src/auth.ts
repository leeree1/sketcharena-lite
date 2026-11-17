import { NextFunction, Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { query } from './db';
import { HttpError, wrap } from './errors';

export interface AuthUser { id: string; username: string }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export const signToken = (u: AuthUser) => jwt.sign({ sub: u.id, username: u.username }, config.jwtSecret, { expiresIn: '24h' });

export function verifyToken(token: string): AuthUser | null {
  try {
    const p = jwt.verify(token, config.jwtSecret) as { sub: string; username: string };
    return { id: p.sub, username: p.username };
  } catch { return null; }
}

/** Middleware: jeśli żądanie ma nagłówek „Authorization: Bearer <token>”, ustawia req.user */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) req.user = verifyToken(h.slice(7)) ?? undefined;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  req.user ? next() : next(new HttpError(401, 'Zaloguj się, aby wykonać tę akcję.'));
}

export const authRouter = Router();

// Wejście jako gość: wystarczy pseudonim
authRouter.post('/guest', wrap(async (req, res) => {
  const base = String(req.body?.username ?? '').trim();
  if (base.length < 3 || base.length > 20) throw new HttpError(400, 'Pseudonim musi mieć od 3 do 20 znaków.');
  let name = base;
  for (let i = 0; i < 6; i++) {
    try {
      const [u] = await query(`INSERT INTO users (username, role) VALUES ($1, 'GUEST') RETURNING id, username`, [name]);
      return res.status(201).json({ token: signToken(u), user: u });
    } catch (e: any) {
      if (e.code !== '23505') throw e;                    // 23505 = pseudonim już istnieje
      name = `${base.slice(0, 15)}#${Math.floor(1000 + Math.random() * 9000)}`;
    }
  }
  throw new HttpError(409, 'Nie udało się nadać pseudonimu. Spróbuj innego.');
}));

authRouter.get('/me', requireAuth, (req, res) => { res.json({ user: req.user }); });

