import { NextFunction, Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config';
import { query, queryOne } from './db';
import { HttpError, wrap } from './errors';
import { activeBan } from './bans';


export type Role = 'GUEST' | 'PLAYER' | 'MODERATOR' | 'ADMIN';
export interface AuthUser { id: string; username: string, role: Role }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export const signToken = (u: AuthUser) => jwt.sign({ sub: u.id, username: u.username, role: u.role }, config.jwtSecret, { expiresIn: '24h' });

export function verifyToken(token: string): AuthUser | null {
  try {
    const p = jwt.verify(token, config.jwtSecret) as { sub: string; username: string; role: Role };
    return { id: p.sub, username: p.username, role: p.role };
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

/** Przepuszcza tylko użytkowników z jedną z podanych ról (np. requireRole('ADMIN')) */
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, 'Zaloguj się, aby wykonać tę akcję.'));
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Brak uprawnień do tej akcji.'));
};

export const authRouter = Router();

// Wejście jako gość: wystarczy pseudonim
authRouter.post('/guest', wrap(async (req, res) => {
  const base = String(req.body?.username ?? '').trim();
  if (base.length < 3 || base.length > 20) throw new HttpError(400, 'Pseudonim musi mieć od 3 do 20 znaków.');
  let name = base;
  for (let i = 0; i < 6; i++) {
    try {
      const [u] = await query(`INSERT INTO users (username, role) VALUES ($1, 'GUEST') RETURNING id, username, role`, [name]);
      return res.status(201).json({ token: signToken(u), user: u });
    } catch (e: any) {
      if (e.code !== '23505') throw e;                    // 23505 = pseudonim już istnieje
      name = `${base.slice(0, 15)}#${Math.floor(1000 + Math.random() * 9000)}`;
    }
  }
  throw new HttpError(409, 'Nie udało się nadać pseudonimu. Spróbuj innego.');
}));

// Rejestracja konta z hasłem (rola PLAYER)
authRouter.post('/register', wrap(async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (username.length < 3 || username.length > 20) throw new HttpError(400, 'Pseudonim musi mieć od 3 do 20 znaków.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Podaj poprawny adres e-mail.');
  if (password.length < 8) throw new HttpError(400, 'Hasło musi mieć co najmniej 8 znaków.');

  const hash = await bcrypt.hash(password, 10);           // hasz z solą, koszt 10
  try {
    const [u] = await query(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'PLAYER') RETURNING id, username, role`,
      [username, email, hash]);
    return res.status(201).json({ token: signToken(u), user: u });
  } catch (e: any) {
    if (e.code === '23505') throw new HttpError(409, 'Pseudonim lub e-mail jest już zajęty.');
    throw e;
  }
}));

// Logowanie e-mailem i hasłem
authRouter.post('/login', wrap(async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const row = await queryOne<{ id: string; username: string; role: Role; password_hash: string | null }>(
    'SELECT id, username, role, password_hash FROM users WHERE email = $1', [email]);
  const ok = row?.password_hash ? await bcrypt.compare(password, row.password_hash) : false;
  if (!row || !ok) throw new HttpError(401, 'Nieprawidłowy e-mail lub hasło.');   // ten sam komunikat dla obu błędów
  const ban = await activeBan(row.id);                  // zablokowane konto nie może się zalogować
  if (ban) throw new HttpError(403, `Konto jest zablokowane do ${new Date(ban.expires_at).toLocaleString('pl-PL')}. Powód: ${ban.reason}`);
  const user: AuthUser = { id: row.id, username: row.username, role: row.role };
  res.json({ token: signToken(user), user });
}));


authRouter.get('/me', requireAuth, (req, res) => { res.json({ user: req.user }); });

