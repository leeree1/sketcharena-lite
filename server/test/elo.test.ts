import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeElo } from '../src/game/elo';

test('zwycięzca zyskuje, przegrany traci tyle samo', () => {
  const r = computeElo([{ userId: 'a', rating: 1000, rank: 1 }, { userId: 'b', rating: 1000, rank: 2 }]);
  assert.equal(r.get('a'), 1016);
  assert.equal(r.get('b'), 984);
});

test('remis przy równych ocenach nic nie zmienia', () => {
  const r = computeElo([{ userId: 'a', rating: 1000, rank: 1 }, { userId: 'b', rating: 1000, rank: 1 }]);
  assert.equal(r.get('a'), 1000);
  assert.equal(r.get('b'), 1000);
});

test('jeden gracz: brak zmiany', () => {
  assert.equal(computeElo([{ userId: 'a', rating: 1200, rank: 1 }]).get('a'), 1200);
});