import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPE_REGISTRY, chooseSurpriseShape, createShapeRoute, getPlayableShapes } from '../src/shapes.js';

const playable = (id, extra = {}) => ({
  id,
  name: `Shape ${id}`,
  availability: 'playable',
  validated: true,
  geometryProvider() {},
  generator() {},
  gameplayAdapter() {},
  display: { symbol: '✦' },
  ...extra,
});

test('shape registry remains empty until a real shape has validated geometry and gameplay integration', () => {
  assert.deepEqual(SHAPE_REGISTRY, []);
  assert.deepEqual(getPlayableShapes(), []);
  assert.equal(chooseSurpriseShape(), null);
});

test('only fully implemented, validated, stable-ID shapes are eligible', () => {
  const registry = [
    playable('valid-star'),
    playable('coming-soon', { availability: 'coming-soon' }),
    playable('not-validated', { validated: false }),
    playable('missing-adapter', { gameplayAdapter: null }),
    playable('bad id'),
    playable('valid-star'),
  ];
  assert.deepEqual(getPlayableShapes(registry).map(shape => shape.id), ['valid-star']);
});

test('Surprise Me handles one eligible shape and uses injectable uniform selection for several', () => {
  const only = playable('first-shape');
  assert.equal(chooseSurpriseShape([only], () => 0.82), only);
  const shapes = [only, playable('second-shape'), playable('third-shape')];
  assert.equal(chooseSurpriseShape(shapes, () => 0), shapes[0]);
  assert.equal(chooseSurpriseShape(shapes, () => 0.5), shapes[1]);
  assert.equal(chooseSurpriseShape(shapes, () => 0.999), shapes[2]);
  assert.equal(chooseSurpriseShape(shapes, () => 1), shapes[2]);
});

test('shaped route preserves the selected stable shape identity separately from Classic difficulty', () => {
  const star = playable('star-maze'), castle = playable('castle-maze');
  const registry = [star, castle];
  assert.deepEqual(createShapeRoute('castle-maze', registry), { category: 'shaped', shapeId: 'castle-maze' });
  assert.equal(createShapeRoute('missing-shape', registry), null);
  assert.equal(createShapeRoute('castle-maze', [playable('castle-maze', { availability: 'coming-soon' })]), null);
  assert.equal(Object.hasOwn(createShapeRoute('star-maze', registry), 'difficulty'), false);
});
