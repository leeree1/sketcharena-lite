import { Router } from 'express';
import { query, queryOne } from './db';
import { HttpError, wrap } from './errors';
import { requireAuth, requireRole } from './auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const staff = requireRole('MODERATOR', 'ADMIN');          // tylko moderator i administrator

export const moderationRouter = Router();

// ---------- zgłoszenia ----------

// Każdy zalogowany gracz może zgłosić innego
moderationRouter.post('/reports', requireAuth, wrap(async (req, res) => {
  const reportedUserId = String(req.body?.reportedUserId ?? '');
  const reason = String(req.body?.reason ?? '').trim();
  if (!UUID.test(reportedUserId)) throw new HttpError(400, 'Nieprawidłowy gracz.');
  if (reportedUserId === req.user!.id) throw new HttpError(400, 'Nie możesz zgłosić samego siebie.');
  if (reason.length < 5 || reason.length > 500) throw new HttpError(400, 'Opisz powód (5–500 znaków).');
  if (!(await queryOne('SELECT 1 FROM users WHERE id = $1', [reportedUserId]))) throw new HttpError(404, 'Nie znaleziono gracza.');
  await query('INSERT INTO moderation_reports (reporter_id, reported_user_id, reason) VALUES ($1, $2, $3)',
    [req.user!.id, reportedUserId, reason]);
  res.status(201).json({ ok: true });
}));

// Lista zgłoszeń (domyślnie oczekujące)
moderationRouter.get('/reports', requireAuth, staff, wrap(async (req, res) => {
  const s = req.query.status;
  const status = s === 'RESOLVED' || s === 'DISMISSED' ? s : 'PENDING';
  const reports = await query(
    `SELECT r.id, r.reason, r.status, r.created_at, r.resolution_note,
            r.reported_user_id, ru.username AS reported_name, rp.username AS reporter_name
       FROM moderation_reports r
       JOIN users ru ON ru.id = r.reported_user_id
       JOIN users rp ON rp.id = r.reporter_id
      WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 100`, [status]);
  res.json({ reports });
}));

// Rozpatrzenie zgłoszenia: DISMISS (oddal) albo BAN (zablokuj na X godzin)
moderationRouter.post('/reports/:id/resolve', requireAuth, staff, wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(400, 'Nieprawidłowy identyfikator.');
  const action = req.body?.action;
  const note = String(req.body?.note ?? '').trim().slice(0, 500);
  if (action !== 'BAN' && action !== 'DISMISS') throw new HttpError(400, 'Nieznana akcja.');
  const report = await queryOne<{ reported_user_id: string; status: string; reported_role: string }>(
    `SELECT r.reported_user_id, r.status, u.role AS reported_role
       FROM moderation_reports r JOIN users u ON u.id = r.reported_user_id WHERE r.id = $1`, [req.params.id]);
  if (!report) throw new HttpError(404, 'Nie znaleziono zgłoszenia.');
  if (report.status !== 'PENDING') throw new HttpError(409, 'Zgłoszenie zostało już rozpatrzone.');

  if (action === 'BAN') {
    if (report.reported_role === 'MODERATOR' || report.reported_role === 'ADMIN') throw new HttpError(403, 'Nie można zablokować moderatora ani administratora.');
    const hours = Math.min(Math.max(Number(req.body?.hours) || 24, 1), 24 * 30);   // od 1 godziny do 30 dni
    await query(
      `INSERT INTO user_bans (user_id, banned_by, reason, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4::int))`,
      [report.reported_user_id, req.user!.id, note || 'Naruszenie regulaminu', hours]);
  }
  await query(
    `UPDATE moderation_reports SET status = $1, handled_by = $2, resolution_note = $3, handled_at = now() WHERE id = $4`,
    [action === 'BAN' ? 'RESOLVED' : 'DISMISSED', req.user!.id, note || null, req.params.id]);
  res.json({ ok: true });
}));

// ---------- blokady ----------

// Lista aktywnych blokad
moderationRouter.get('/bans', requireAuth, staff, wrap(async (_req, res) => {
  const bans = await query(
    `SELECT b.id, b.reason, b.created_at, b.expires_at, u.username AS user_name, m.username AS banned_by_name
       FROM user_bans b JOIN users u ON u.id = b.user_id JOIN users m ON m.id = b.banned_by
      WHERE b.revoked_at IS NULL AND b.expires_at > now() ORDER BY b.expires_at DESC LIMIT 100`);
  res.json({ bans });
}));

// Odwołanie blokady przed czasem
moderationRouter.post('/bans/:id/revoke', requireAuth, staff, wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(400, 'Nieprawidłowy identyfikator.');
  const done = await queryOne('UPDATE user_bans SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id', [req.params.id]);
  if (!done) throw new HttpError(404, 'Nie znaleziono aktywnej blokady.');
  res.json({ ok: true });
}));
