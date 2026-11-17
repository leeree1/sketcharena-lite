import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authTotal, gamesFinishedTotal, register } from '../src/metrics';

test('licznik logowań pojawia się w tekście metryk z etykietami', async () => {
  authTotal.inc({ action: 'login', result: 'success' });
  const text = await register.metrics();
  assert.match(text, /sketcharena_auth_total\{action="login",result="success"\} 1/);
});

test('licznik zakończonych meczów rośnie o 1', async () => {
  gamesFinishedTotal.inc();
  assert.match(await register.metrics(), /sketcharena_games_finished_total 1/);
});

test('są metryki procesu Node.js z naszym prefiksem', async () => {
  assert.match(await register.metrics(), /sketcharena_process_resident_memory_bytes/);
});
