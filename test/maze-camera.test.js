import test from 'node:test';
import assert from 'node:assert/strict';
import { createMazeCamera, mazeDistanceForScreenPixels } from '../src/maze-camera.js';
import { transformPoint } from '../src/coordinates.js';

test('close camera stays at 2x magnification and follows each maze boundary within padded limits', () => {
  const camera = createMazeCamera({ viewSize: 400, zoom: 2 });
  assert.equal(camera.center({ x: 100, y: 100 }).width, 200);
  const positions = [
    { x: 0, y: 100 }, { x: 400, y: 100 }, { x: 100, y: 0 }, { x: 100, y: 400 },
  ];
  for (const point of positions) {
    const view = camera.center(point);
    assert.equal(view.width, 200);
    assert.equal(view.height, 200);
    assert.ok(view.x >= -26 && view.x <= 226);
    assert.ok(view.y >= -26 && view.y <= 226);
    assert.ok(point.x >= view.x && point.x <= view.x + view.width);
    assert.ok(point.y >= view.y && point.y <= view.y + view.height);
  }
});

test('camera follow changes only the viewBox; gesture mapping uses its captured screen transform', () => {
  const camera = createMazeCamera({ viewSize: 400, zoom: 2 });
  camera.center({ x: 90, y: 90 });
  const capturedScreenToSvg = { a: .5, b: 0, c: 0, d: .5, e: 100, f: 40 };
  const fingerBeforeFollow = { x: 120, y: 110 };
  const mappedBeforeFollow = transformPoint(fingerBeforeFollow, capturedScreenToSvg);
  const earlierView = camera.snapshot();
  const followedView = camera.follow({ x: 160, y: 90 });
  assert.notEqual(followedView.x, earlierView.x, 'the visual camera follows the pencil');
  assert.deepEqual(transformPoint(fingerBeforeFollow, capturedScreenToSvg), mappedBeforeFollow,
    'the active gesture keeps mapping against the pointerdown transform instead of the newly recentered viewBox');
});

test('camera follows at the dead-zone edge without a recenter jump or post-stop drift', () => {
  const camera = createMazeCamera({ viewSize: 400, zoom: 2 });
  camera.center({ x: 100, y: 100 });

  const before = camera.snapshot();
  const first = camera.follow({ x: 141, y: 100 });
  assert.ok(Math.abs(first.x - before.x) <= 1.000001,
    'crossing the inset by one maze unit moves the camera by at most that amount');
  assert.ok(Math.abs((141 - first.x) - 140) < 1e-9,
    'the pencil remains at the same edge of the close-view follow zone');

  const next = camera.follow({ x: 142, y: 100 });
  assert.ok(Math.abs(next.x - first.x) <= 1.000001,
    'each immediate update follows only the new endpoint movement');
  assert.deepEqual(camera.follow({ x: 142, y: 100 }), next,
    'the camera remains still as soon as the pencil stops');
});

test('camera follow is symmetric on all four directions and remains clamped at maze bounds', () => {
  const camera = createMazeCamera({ viewSize: 400, zoom: 2 });
  const directions = [
    { origin: { x: 100, y: 100 }, next: { x: 141, y: 100 }, axis: 'x' },
    { origin: { x: 100, y: 100 }, next: { x: 59, y: 100 }, axis: 'x' },
    { origin: { x: 100, y: 100 }, next: { x: 100, y: 141 }, axis: 'y' },
    { origin: { x: 100, y: 100 }, next: { x: 100, y: 59 }, axis: 'y' },
  ];
  for (const { origin, next, axis } of directions) {
    const initial = camera.center(origin);
    const followed = camera.follow(next);
    assert.ok(Math.abs(followed[axis] - initial[axis]) <= 1.000001);
    assert.ok(next[axis] >= followed[axis] && next[axis] <= followed[axis] + followed.width);
  }

  for (const point of [{ x: 0, y: 200 }, { x: 400, y: 200 }, { x: 200, y: 0 }, { x: 200, y: 400 }]) {
    camera.center({ x: 200, y: 200 });
    const followed = camera.follow(point);
    assert.ok(followed.x >= -26 && followed.x <= 226);
    assert.ok(followed.y >= -26 && followed.y <= 226);
  }
});

test('repeated corner turns do not accumulate camera-relative coordinate drift', () => {
  const capturedScreenToSvg = { a: .125, b: 0, c: 0, d: .125, e: -7.5, f: -4.8 };
  const samples = [
    { x: 135, y: 88 }, { x: 145, y: 88 }, { x: 145, y: 98 },
    { x: 145, y: 108 }, { x: 155, y: 108 }, { x: 165, y: 108 },
  ];
  const mapped = samples.map(point => transformPoint(point, capturedScreenToSvg));
  const deltas = mapped.map(point => ({ x: point.x - mapped[0].x, y: point.y - mapped[0].y }));
  assert.ok(Math.abs(deltas.at(-1).x - 3.75) < 1e-10);
  assert.ok(Math.abs(deltas.at(-1).y - 2.5) < 1e-10);
  const steps = deltas.slice(1).map((point, index) => ({ x: point.x - deltas[index].x, y: point.y - deltas[index].y }));
  assert.deepEqual(steps.map(point => ({ x: Math.round(point.x * 1e10) / 1e10, y: Math.round(point.y * 1e10) / 1e10 })), [
    { x: 1.25, y: 0 }, { x: 0, y: 1.25 }, { x: 0, y: 1.25 }, { x: 1.25, y: 0 }, { x: 1.25, y: 0 },
  ]);
});

test('endpoint acquisition remains 24 CSS pixels at the current SVG magnification', () => {
  const cellSize = 35.2;
  const normal = mazeDistanceForScreenPixels(24, cellSize, .82);
  const zoomed = mazeDistanceForScreenPixels(24, cellSize, 1.64);
  assert.equal(normal.pixelsPerMazeUnit, cellSize * .82);
  assert.equal(zoomed.pixelsPerMazeUnit, cellSize * 1.64);
  assert.ok(Math.abs(normal.mazeUnits * normal.pixelsPerMazeUnit - 24) < 1e-10);
  assert.ok(Math.abs(zoomed.mazeUnits * zoomed.pixelsPerMazeUnit - 24) < 1e-10);
  assert.ok(zoomed.mazeUnits < normal.mazeUnits, 'the world-space tolerance shrinks when the pane is magnified');
});
