// Narzędzie administracyjne: ustawia rolę konta.  Użycie:  npx tsx scripts/set-role.ts <email> <ROLA>
// ROLA: PLAYER | MODERATOR | ADMIN
import { pool } from '../src/db';

const ROLES = ['PLAYER', 'MODERATOR', 'ADMIN'];

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  const role = (process.argv[3] ?? '').trim().toUpperCase();
  if (!email || !ROLES.includes(role)) {
    console.error(`Użycie: npx tsx scripts/set-role.ts <email> <${ROLES.join('|')}>`);
    process.exit(1);
  }
  // parametry $1, $2 chronią przed SQL injection
  const res = await pool.query('UPDATE users SET role = $1 WHERE email = $2 RETURNING username, role', [role, email]);
  if (res.rowCount === 0) console.error(`Nie znaleziono konta z adresem ${email}. Czy na pewno się zarejestrowałaś(-eś)?`);
  else console.log(`OK: konto "${res.rows[0].username}" ma teraz rolę ${res.rows[0].role}. Wyloguj się i zaloguj ponownie.`);
  await pool.end();
}
main().catch((e) => { console.error('Błąd:', e.message); process.exit(1); });
