import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTraceSession, traceSegment } from '../src/tracing.js';

function mazeWithRoute(route, width = Math.max(...route.map(p => p.x)) + 1, height = Math.max(...route.map(p => p.y)) + 1) {
  const cells = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ({ x, y, walls: { N: true, E: true, S: true, W: true } })));
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    if (b.x === a.x + 1) { cells[a.y][a.x].walls.E = false; cells[b.y][b.x].walls.W = false; }
    else if (b.x === a.x - 1) { cells[a.y][a.x].walls.W = false; cells[b.y][b.x].walls.E = false; }
    else if (b.y === a.y + 1) { cells[a.y][a.x].walls.S = false; cells[b.y][b.x].walls.N = false; }
    else if (b.y === a.y - 1) { cells[a.y][a.x].walls.N = false; cells[b.y][b.x].walls.S = false; }
    else throw new Error('Test route must use adjacent cells.');
  }
  return { width, height, cells, start: { ...route[0] }, end: { ...route.at(-1) } };
}

test('one continuous drag traverses multiple cells without cell-by-cell gestures', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
  const maze = mazeWithRoute(route), session = createTraceSession(maze);
  assert.equal(session.begin(7, { x: 0, y: 0 }), true);
  const result = session.move(7, { x: 3, y: 0 });
  assert.deepEqual(result.path, route);
  assert.equal(result.moved, true);
  assert.equal(session.end(7), true);
});

test('a player can begin at the printed entrance opening instead of the cell center', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const session = createTraceSession(mazeWithRoute(route));
  assert.equal(session.begin(4, { x: 0, y: -0.48 }), true);
  assert.deepEqual(session.move(4, { x: 0.6, y: 0 }).path, route.slice(0, 2));
});

test('pencil trail matches off-center pointer samples until a wall-safety clamp is needed', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
  const session = createTraceSession(mazeWithRoute(route));
  session.begin(5, { x: 0, y: 0 });
  session.move(5, { x: 0.25, y: 0.12 });
  session.move(5, { x: 1.25, y: 0.12 });
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.ok(session.stroke.some(point => Math.abs(point.y - 0.12) < 0.001));
  assert.ok(session.stroke.some(point => point.y === 0.12));
  assert.ok(session.stroke.some(point => point.x > 0.5 && point.x < 1));
});

test('subpixel pointer jitter does not create excessive SVG trail points', () => {
  const session = createTraceSession(mazeWithRoute([{ x: 0, y: 0 }, { x: 1, y: 0 }]));
  session.begin(6, { x: 0, y: 0 });
  const result = session.move(6, { x: 0.005, y: 0.004 });
  assert.equal(result.moved, false);
  assert.equal(session.stroke.length, 1);
});

test('one uninterrupted gesture follows turns in its pointer path', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }];
  const maze = mazeWithRoute(route), session = createTraceSession(maze);
  session.begin(2, { x: 0, y: 0 });
  session.move(2, { x: 2, y: 0 });
  const result = session.move(2, { x: 2, y: 2 });
  const final = session.move(2, { x: 3, y: 2 });
  assert.deepEqual(final.path, route);
  assert.equal(final.complete, true);
  assert.equal(result.blocked, false);
});

test('fast movement between pointer samples checks and visits every intermediate cell', () => {
  const route = Array.from({ length: 8 }, (_, x) => ({ x, y: 0 }));
  const maze = mazeWithRoute(route), result = traceSegment(maze, [route[0]], route[0], route.at(-1));
  assert.deepEqual(result.path, route);
  assert.equal(result.blocked, false);
});

test('slow pointer movement remains continuous and follows every legal cell', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  const session = createTraceSession(mazeWithRoute(route, 5, 1));
  session.begin(44, { x: 0, y: 0 });
  for (let x = 0.025; x <= 3; x += 0.025) session.move(44, { x, y: 0.08 });
  assert.deepEqual(session.path, route);
  assert.ok(Math.abs(session.stroke.at(-1).x - 3) < 0.02);
});

test('wall collision stops tracing at the last reachable cell', () => {
  const maze = mazeWithRoute([{ x: 0, y: 0 }, { x: 1, y: 0 }], 3, 1);
  maze.end = { x: 2, y: 0 };
  const result = traceSegment(maze, [{ x: 0, y: 0 }], { x: 0, y: 0 }, { x: 2, y: 0 });
  assert.deepEqual(result.path, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  assert.equal(result.blocked, true);
  assert.ok(Math.max(...result.stroke.map(point => point.x)) < 1.5, 'the visible stroke stays on the open side of the blocked wall');
});

test('direct and rapid repeated wall contacts preserve the last legal endpoint', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }], session = createTraceSession(mazeWithRoute(route, 3, 1));
  session.begin(30, { x: 0, y: 0 });
  const first = session.move(30, { x: 1.9, y: 0 });
  assert.equal(first.blocked, true);
  assert.deepEqual(session.path, route);
  assert.ok(session.stroke.at(-1).x <= 1.46);
  assert.equal(Math.round(session.stroke.at(-1).x), session.path.at(-1).x);
  session.move(30, { x: 1.95, y: 0 });
  session.move(30, { x: 2.1, y: 0 });
  assert.deepEqual(session.path, route);
  assert.ok(session.stroke.every(point => point.x <= 1.46));
});

test('slight wall penetration near a corner does not advance the route or stroke', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 2));
  session.begin(31, { x: 0, y: 0 }); session.move(31, { x: 1, y: 0 });
  const before = session.stroke.at(-1);
  const result = session.move(31, { x: 1.6, y: -0.2 });
  assert.equal(result.blocked, true);
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.ok(session.stroke.at(-1).x <= 1.46);
  assert.ok(session.stroke.at(-1).y < 0);
  assert.ok(Math.hypot(session.stroke.at(-1).x - before.x, session.stroke.at(-1).y - before.y) < 0.6);
});

test('finger can leave the corridor at a wall and retrace backward without lifting', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  const session = createTraceSession(mazeWithRoute(route, 5, 1));
  session.begin(32, { x: 0, y: 0 }); session.move(32, { x: 3.2, y: 0 });
  session.move(32, { x: 3.7, y: 0 }); // wall contact; physical pointer remains outside the accepted trail
  session.move(32, { x: 3.75, y: 0.2 });
  const recovered = session.move(32, { x: 2.4, y: 0 });
  assert.equal(recovered.moved, true);
  assert.deepEqual(session.path, route.slice(0, 3));
  assert.ok(Math.abs(session.stroke.at(-1).x - 2.4) < 0.06);
});

test('collision followed by immediate reversal retracts during the same drag', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  const session = createTraceSession(mazeWithRoute(route, 5, 1));
  session.begin(40, { x: 0, y: 0 }); session.move(40, { x: 2.2, y: 0 });
  session.move(40, { x: 2.8, y: 0 });
  const before = session.stroke.length;
  const reversed = session.move(40, { x: 1.4, y: 0 });
  assert.equal(reversed.moved, true);
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.ok(session.stroke.length < before);
});

test('continuous reversal at a corner retraces without lifting', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 3));
  session.begin(41, { x: 0, y: 0 }); session.move(41, { x: 1, y: 0 });
  session.move(41, { x: 1, y: 2 }); session.move(41, { x: 1.6, y: 2 });
  const reversed = session.move(41, { x: 1, y: 0.4 });
  assert.equal(reversed.moved, true);
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.ok(Math.abs(session.stroke.at(-1).y - 0.4) < 0.06);
});

test('off-center tracing stays guided through multiple legal turns', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 3));
  session.begin(42, { x: 0, y: 0 });
  session.move(42, { x: 0, y: 0.3 });
  session.move(42, { x: 1, y: 0.3 });
  session.move(42, { x: 1.3, y: 1 });
  session.move(42, { x: 2, y: 1.25 });
  assert.deepEqual(session.path, route);
  assert.ok(session.stroke.every(point => point.x >= -0.42 && point.x <= 2.42 && point.y >= -0.42 && point.y <= 1.42));
});

test('capture tolerates a slightly off-center finger but stops before a wall-side boundary', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 2));
  session.begin(43, { x: 0, y: 0.44 });
  assert.equal(session.move(43, { x: 1, y: 0.44 }).path.length, 2);
  const lastLegal = { ...session.stroke.at(-1) };
  const result = session.move(43, { x: 1, y: 0.49 });
  assert.equal(result.blocked, true);
  assert.deepEqual(session.path, route);
  assert.deepEqual(session.stroke.at(-1), lastLegal);
});

test('touch tolerance cannot cross into an adjacent corridor separated by a wall', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 2));
  session.begin(45, { x: 0, y: 0 }); session.move(45, { x: 1, y: 0 });
  const result = session.move(45, { x: 1, y: 0.7 });
  assert.equal(result.blocked, true);
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.ok(session.stroke.every(point => point.y <= 0.42), 'the stroke stays within the open cell, short of its closed south wall');
});

test('wall collision can be recovered after lifting and resuming at the legal tip', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  const session = createTraceSession(mazeWithRoute(route, 5, 1));
  session.begin(33, { x: 0, y: 0 }); session.move(33, { x: 3.2, y: 0 });
  session.move(33, { x: 3.7, y: 0 }); session.end(33);
  const tip = { ...session.stroke.at(-1) };
  assert.equal(session.begin(34, tip), true);
  const result = session.move(34, { x: 2.4, y: 0 });
  assert.equal(result.moved, true);
  assert.deepEqual(session.path, route.slice(0, 3));
});

test('recovery retraces around a corner and cannot shortcut to a nonadjacent path cell', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }];
  const maze = mazeWithRoute(route, 4, 3), session = createTraceSession(maze);
  session.begin(35, { x: 0, y: 0 }); session.move(35, { x: 2, y: 0 }); session.move(35, { x: 2, y: 2 });
  session.move(35, { x: 2.6, y: 2 }); // blocked by a closed edge
  session.move(35, { x: 2.65, y: 2.18 }); // move outside corridor before returning
  const result = session.move(35, { x: 2, y: 1.4 });
  assert.equal(result.moved, true);
  assert.deepEqual(session.path, route.slice(0, 4));
  assert.ok(Math.abs(session.stroke.at(-1).x - 2) < 0.06);
  assert.ok(Math.abs(session.stroke.at(-1).y - 1.4) < 0.06);
});

test('recovery cannot cut diagonally across a maze corner to another open branch', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 2));
  session.begin(37, { x: 0, y: 0 }); session.move(37, { x: 1, y: 0 });
  session.move(37, { x: 2, y: 0 }); // collide with the closed east wall
  const before = session.stroke.map(point => ({ ...point }));
  session.move(37, { x: 1, y: 1 }); // diagonal approach would cut across a corner
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.deepEqual(session.stroke, before);
});

test('repeated recovery updates keep the logical and visual endpoints synchronized', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 3));
  session.begin(36, { x: 0, y: 0 }); session.move(36, { x: 1, y: 0 }); session.move(36, { x: 1, y: 1 });
  for (const point of [{ x: 1, y: 1.55 }, { x: 1.1, y: 1.58 }, { x: 1, y: 0.4 }]) session.move(36, point);
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.deepEqual({ x: Math.round(session.stroke.at(-1).x), y: Math.round(session.stroke.at(-1).y) }, session.path.at(-1));
  assert.ok(session.stroke.every(point => point.x >= -0.46 && point.y >= -0.46));
});

test('a blocked drag can turn into a legal corridor without lifting', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 2));
  session.begin(8, { x: 0, y: 0 });
  session.move(8, { x: 1, y: 0 });
  assert.equal(session.move(8, { x: 2, y: 0 }).blocked, true);
  session.move(8, { x: 1, y: 0 }); // retrace to the junction
  const turn = session.move(8, { x: 1, y: 1 });
  assert.deepEqual(turn.path, route);
  assert.equal(turn.blocked, false);
});

test('physically retracing the route erases it cell by cell', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 })), maze = mazeWithRoute(route);
  const result = traceSegment(maze, route, route.at(-1), { x: 1, y: 0 });
  assert.deepEqual(result.path, route.slice(0, 2));
});

test('backtracking trims the visible trail progressively along the traced route', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  const session = createTraceSession(mazeWithRoute(route));
  session.begin(10, { x: 0, y: 0 });
  session.move(10, { x: 3, y: 0 });
  const fullLength = session.stroke.length;
  session.move(10, { x: 2.2, y: 0 });
  assert.ok(session.stroke.length < fullLength);
  assert.ok(Math.abs(session.stroke.at(-1).x - 2.2) < 0.06);
  assert.deepEqual(session.path, route.slice(0, 3));
});

test('lifting and resuming preserves the endpoint', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 })), session = createTraceSession(mazeWithRoute(route));
  session.begin(1, { x: 0, y: 0 }); session.move(1, { x: 2, y: 0 }); session.end(1);
  assert.deepEqual(session.path, route.slice(0, 3));
  assert.equal(session.begin(9, { x: 2, y: 0 }), true);
  assert.deepEqual(session.move(9, { x: 3, y: 0 }).path, route);
});

test('pointer cancellation ends the gesture and preserves the route', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 })), session = createTraceSession(mazeWithRoute(route));
  session.begin(3, { x: 0, y: 0 }); session.move(3, { x: 2, y: 0 });
  assert.equal(session.cancel(3), true);
  assert.equal(session.active, false);
  assert.deepEqual(session.path, route.slice(0, 3));
  assert.equal(session.begin(4, { x: 2, y: 0 }), true);
});

test('diagonal corner cutting is rejected even when both exits are open', () => {
  const maze = mazeWithRoute([{ x: 0, y: 0 }, { x: 1, y: 0 }], 2, 2);
  maze.cells[0][0].walls.S = false; maze.cells[1][0].walls.N = false;
  const result = traceSegment(maze, [{ x: 0, y: 0 }], { x: 0, y: 0 }, { x: 1, y: 1 });
  assert.deepEqual(result.path, [{ x: 0, y: 0 }]);
  assert.equal(result.complete, false);
});

test('keyboard alternative follows open passages and can backtrack by retracing', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const session = createTraceSession(mazeWithRoute(route));
  assert.equal(session.step({ x: 1, y: 0 }).moved, true);
  assert.equal(session.step({ x: 0, y: 1 }).moved, true);
  assert.equal(session.step({ x: 0, y: -1 }).moved, true);
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.equal(session.step({ x: 0, y: -1 }).blocked, true);
});

test('touch gesture suppression is scoped to the maze and browser zoom stays enabled', async () => {
  const [css, html] = await Promise.all([readFile(new URL('../src/styles.css', import.meta.url), 'utf8'), readFile(new URL('../index.html', import.meta.url), 'utf8')]);
  assert.match(css, /\.maze-paper,#maze\s*\{[^}]*touch-action\s*:\s*none/s);
  assert.doesNotMatch(css, /(?:^|[},])\s*(?:html|body|\*)\s*\{[^}]*touch-action\s*:\s*none/s);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.doesNotMatch(html, /maximum-scale\s*=|user-scalable\s*=\s*no/i);
});
