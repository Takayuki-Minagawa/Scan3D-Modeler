import assert from 'node:assert/strict';
import test from 'node:test';
import { approxSizeMismatchRatio, validateProjectInput } from '../.test-build/projectValidation.mjs';
import { parseHashRoute, projectHash, PROJECT_TABS } from '../.test-build/route.mjs';

test('validateProjectInput requires names and three positive finite dimensions', () => {
  const ok = validateProjectInput({ name: ' A ', objectName: 'B', w: '10', h: '0.5', d: '100' });
  assert.deepEqual(ok, { ok: true, value: { name: 'A', objectName: 'B', approxSize: { w: 10, h: 0.5, d: 100 } } });
  assert.deepEqual(validateProjectInput({ name: '', objectName: ' ', w: '1', h: '1', d: '1' }), {
    ok: false, errors: ['nameRequired', 'objectNameRequired'],
  });
  // Zero and blank dimensions produced "0×0×100mm" projects before.
  assert.deepEqual(validateProjectInput({ name: 'A', objectName: 'B', w: '0', h: '1', d: '1' }), { ok: false, errors: ['sizeNotPositive'] });
  assert.deepEqual(validateProjectInput({ name: 'A', objectName: 'B', w: '', h: '1', d: '1' }), { ok: false, errors: ['sizeNotNumber'] });
  assert.deepEqual(validateProjectInput({ name: 'A', objectName: 'B', w: 'abc', h: '1', d: '1' }), { ok: false, errors: ['sizeNotNumber'] });
  assert.deepEqual(validateProjectInput({ name: 'A', objectName: 'B', w: '-1', h: '1', d: '1' }), { ok: false, errors: ['sizeNotPositive'] });
});

test('approxSizeMismatchRatio flags only differences of 10x or more and skips unset sizes', () => {
  assert.equal(approxSizeMismatchRatio({ w: 100, h: 50, d: 20 }, [90, 40, 10]), null);
  assert.equal(approxSizeMismatchRatio({ w: 100, h: 50, d: 20 }, [1000, 40, 10]), 10);
  assert.equal(approxSizeMismatchRatio({ w: 100, h: 50, d: 20 }, [5, 4, 1]), 0.05);
  assert.equal(approxSizeMismatchRatio({ w: 0, h: 0, d: 0 }, [1000, 40, 10]), null);
  assert.equal(approxSizeMismatchRatio({ w: 100, h: 50, d: 20 }, [0, 0, 0]), null);
});

test('parseHashRoute and projectHash round-trip every tab and tolerate unknown tabs', () => {
  const id = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
  assert.deepEqual(parseHashRoute('#/'), { kind: 'list' });
  assert.deepEqual(parseHashRoute(''), { kind: 'list' });
  assert.deepEqual(parseHashRoute(`#/p/${id}`), { kind: 'project', id, tab: 'capture' });
  assert.deepEqual(parseHashRoute(`#/p/${id}/VIEWER`), { kind: 'project', id, tab: 'viewer' });
  assert.deepEqual(parseHashRoute(`#/p/${id}/nope`), { kind: 'project', id, tab: 'capture' });
  assert.deepEqual(parseHashRoute('#/p/not-an-id!/viewer'), { kind: 'list' });
  for (const tab of PROJECT_TABS) {
    assert.deepEqual(parseHashRoute(projectHash(id, tab)), { kind: 'project', id, tab });
  }
  assert.equal(projectHash(id), `#/p/${id}`);
});
