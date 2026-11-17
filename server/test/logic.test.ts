import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuess, levenshtein, normalize } from '../src/game/guess';
import { drawerPoints, guessPoints } from '../src/game/scoring';

test('normalize usuwa wielkość liter, polskie znaki i spacje', () => {
  assert.equal(normalize('Krzesło'), 'krzeslo');
  assert.equal(normalize('  Burza  Piaskowa '), 'burzapiaskowa');
});

test('levenshtein liczy odległość edycyjną', () => {
  assert.equal(levenshtein('kot', 'kot'), 0);
  assert.equal(levenshtein('kot', 'kut'), 1);
});

test('checkGuess: trafna, bliska i błędna odpowiedź', () => {
  assert.equal(checkGuess('KRZESLO', 'krzesło'), 'correct');
  assert.equal(checkGuess('krzeslu', 'krzesło'), 'close');
  assert.equal(checkGuess('kut', 'kot'), 'wrong');       // krótkie hasło: bez „blisko”
  assert.equal(checkGuess('stół', 'krzesło'), 'wrong');
});

test('punktacja: przykład z dokumentacji = 220 punktów', () => {
  assert.equal(guessPoints(2.5, 64, 80), 220);            // hasło trudne, 64 s z 80 s
  assert.equal(guessPoints(1.0, 64, 80), 88);             // to samo na poziomie łatwym
  assert.equal(drawerPoints(220), 110);
});

