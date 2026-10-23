import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTraceSession as createAuthoritativeTraceSession, traceSegment } from '../src/tracing.js';
import { createTraceRecorder, mazeLayoutId } from '../src/trace-diagnostics.js';
import { advancePath, canMove, createMaze, createMazeForDifficulty, getShortestPath, validateMaze } from '../src/maze.js';
import { pointerMovementSamples } from '../src/pointer-samples.js';
import { tracePathData } from '../src/trace-rendering.js';
import { getMazeGridGeometry, mazeToSvgPoint } from '../src/coordinates.js';

// Point-based fixture adapter: all movement is applied through the production
// Steering session API, with the requested point converted to a frame delta.
function createTraceSession(maze) {
  const session = createAuthoritativeTraceSession(maze);
  return new Proxy(session, {
    get(target, property) {
      if (property === 'begin') return id => target.beginSteering(id);
      if (property === 'move') return (id, point) => target.steer(id, { x: point.x - target.position.x, y: point.y - target.position.y });
      return Reflect.get(target, property, target);
    },
  });
}

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

function exitFixture(side) {
  const inward = { N: { x: 1, y: 1 }, E: { x: 1, y: 1 }, S: { x: 1, y: 1 }, W: { x: 1, y: 1 } }[side];
  const end = { N: { x: 1, y: 0 }, E: { x: 2, y: 1 }, S: { x: 1, y: 2 }, W: { x: 0, y: 1 } }[side];
  const start = { ...inward };
  const maze = mazeWithRoute([start, end], 3, 3);
  maze.exit = { cell: { ...end }, side };
  maze.cells[end.y][end.x].walls[side] = false;
  return maze;
}

function outsideExitPoint(maze, extension = 0.78) {
  const point = { ...maze.end };
  if (maze.exit.side === 'N') point.y -= extension;
  else if (maze.exit.side === 'E') point.x += extension;
  else if (maze.exit.side === 'S') point.y += extension;
  else point.x -= extension;
  return point;
}

function replayRecordedPointerEvents(maze, events) {
  const session = createTraceSession(maze), pointerId = 1, moveResults = [];
  for (const event of events) {
    if (event.eventType === 'pointerdown') session.begin(pointerId, event.maze);
    else if (event.eventType === 'pointermove') moveResults.push(session.move(pointerId, event.maze));
    else if (event.eventType === 'pointerup') session.end(pointerId);
    else if (event.eventType === 'pointercancel') session.cancel(pointerId);
  }
  return { session, moveResults };
}

function seeded(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function findSolution(maze) {
  const queue = [[{ ...maze.start }]], seen = new Set([`${maze.start.x},${maze.start.y}`]);
  while (queue.length) {
    const path = queue.shift(), current = path.at(-1);
    if (current.x === maze.end.x && current.y === maze.end.y) return path;
    for (const next of [{ x: current.x, y: current.y - 1 }, { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y + 1 }, { x: current.x - 1, y: current.y }]) {
      const key = `${next.x},${next.y}`;
      if (!seen.has(key) && canMove(maze, current, next)) { seen.add(key); queue.push([...path, next]); }
    }
  }
  return null;
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
  const maze = mazeWithRoute(route);
  maze.entrance = { cell: { x: 0, y: 0 }, side: 'N' };
  maze.cells[0][0].walls.N = false;
  const session = createTraceSession(maze);
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

test('small steering increments move the pencil without creating tiny ink samples', () => {
  const session = createTraceSession(mazeWithRoute([{ x: 0, y: 0 }, { x: 1, y: 0 }]));
  session.begin(6, { x: 0, y: 0 });
  const result = session.move(6, { x: 0.005, y: 0.004 });
  assert.equal(result.moved, true);
  assert.notDeepEqual(session.position, { x: 0, y: 0 }, 'the authoritative endpoint tracks fine movement');
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
  assert.equal(final.complete, false, 'entering the last cell is not an exit crossing');
  assert.equal(result.blocked, false);
});

test('fast movement between pointer samples checks and visits every intermediate cell', () => {
  const route = Array.from({ length: 8 }, (_, x) => ({ x, y: 0 }));
  const maze = mazeWithRoute(route), result = traceSegment(maze, [route[0]], route[0], route.at(-1));
  assert.deepEqual(result.path, route);
  assert.equal(result.blocked, false);
});

test('only an outward crossing through the declared perimeter exit completes in all four orientations', () => {
  const outward = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };
  for (const side of ['N', 'E', 'S', 'W']) {
    const maze = exitFixture(side), session = createTraceSession(maze), pointer = 300 + side.charCodeAt(0);
    assert.equal(session.begin(pointer, maze.start), true);
    const entered = session.move(pointer, maze.end);
    assert.equal(entered.complete, false, `${side}: entering the terminal exit cell stays active`);
    assert.equal(session.diagnostics.exitCellEntered, true);
    const inside = { ...maze.end };
    if (side === 'N') inside.y -= 0.4;
    else if (side === 'E') inside.x += 0.4;
    else if (side === 'S') inside.y += 0.4;
    else inside.x -= 0.4;
    assert.equal(session.move(pointer, inside).complete, false, `${side}: approaching the opening is not completion`);
    const inkBeforeReverse = session.stroke.map(point => ({ ...point }));
    assert.equal(session.move(pointer, maze.start).complete, false, `${side}: backtracking from the exit cell remains legal`);
    assert.deepEqual(session.path, [maze.start]);
    assert.ok(session.stroke.length >= inkBeforeReverse.length, `${side}: backtracking preserves permanent ink`);
    assert.equal(session.move(pointer, maze.end).complete, false, `${side}: re-entering the exit cell still does not finish`);
    const crossing = session.move(pointer, outsideExitPoint(maze));
    assert.equal(crossing.complete, true, `${side}: the declared outward crossing completes`);
    assert.equal(crossing.exitBoundaryReached, true);
    assert.equal(crossing.completionReason, 'designated-exit-boundary-crossing');
    assert.deepEqual(crossing.finishPosition, outsideExitPoint(maze));
    assert.deepEqual(session.stroke.at(-1), outsideExitPoint(maze), `${side}: final ink extends through the opening`);
    const inkAtFinish = session.stroke.map(point => ({ ...point }));
    assert.equal(session.move(pointer, { x: 1.5, y: 1.5 }).moved, false, `${side}: no movement follows completion`);
    assert.deepEqual(session.stroke, inkAtFinish, `${side}: completion does not append later ink`);
    assert.equal(session.diagnostics.completionCommitted, true);

    const keyboard = createTraceSession(maze), inward = { x: maze.end.x - maze.start.x, y: maze.end.y - maze.start.y };
    assert.equal(keyboard.step(inward).complete, false, `${side}: keyboard navigation entering exit cell stays active`);
    const keyboardFinish = keyboard.step(outward[side]);
    assert.equal(keyboardFinish.complete, true, `${side}: keyboard navigation must also cross outward`);
    assert.deepEqual(keyboard.position, outsideExitPoint(maze));
  }
});

test('open exit boundary does not authorize other perimeter exits, corner cuts, or wrong directions', () => {
  for (const side of ['N', 'E', 'S', 'W']) {
    const maze = exitFixture(side), session = createTraceSession(maze), pointer = 500 + side.charCodeAt(0);
    session.begin(pointer, maze.start);
    session.move(pointer, maze.end);
    const wrong = { ...maze.end };
    if (side === 'N' || side === 'S') wrong.x += 0.8;
    else wrong.y += 0.8;
    const rejected = session.move(pointer, wrong);
    assert.equal(rejected.complete, false, `${side}: only its declared edge may complete`);
    assert.equal(rejected.blocked, true);
    assert.deepEqual(session.path.at(-1), maze.end);
    assert.equal(session.diagnostics.completionCommitted, false);
  }
  const maze = exitFixture('E'), session = createTraceSession(maze), pointer = 600;
  session.begin(pointer, maze.start); session.move(pointer, maze.end);
  const diagonal = session.move(pointer, { x: maze.end.x + 0.8, y: maze.end.y + 0.8 });
  assert.equal(diagonal.complete, false, 'a diagonal outside-grid jump cannot cross the exit corner');
  assert.equal(session.diagnostics.completionCommitted, false);
});

test('100 production-generated mazes per difficulty complete only after their designated exit crossing', () => {
  for (const difficulty of ['easy', 'medium', 'hard', 'expert']) {
    for (let seed = 0; seed < 100; seed++) {
      const maze = createMazeForDifficulty(difficulty, seeded(seed));
      const route = getShortestPath(maze), session = createTraceSession(maze), pointer = 10000 + seed;
      assert.ok(route?.length > 2, `${difficulty} seed ${seed}: generated route exists`);
      assert.equal(session.begin(pointer, maze.start), true);
      for (const [index, cell] of route.slice(1).entries()) {
        const result = session.move(pointer, cell);
        assert.equal(result.blocked, false, `${difficulty} seed ${seed}: route step ${index + 1} stays legal`);
        assert.equal(result.complete, false, `${difficulty} seed ${seed}: no cell entry completes`);
      }
      assert.deepEqual(session.path, route, `${difficulty} seed ${seed}: route reaches exit cell`);
      assert.equal(session.diagnostics.exitCellEntered, true);
      assert.equal(session.diagnostics.completionCommitted, false);
      const finish = session.move(pointer, outsideExitPoint(maze));
      assert.equal(finish.complete, true, `${difficulty} seed ${seed}: outward exit crossing completes`);
      assert.equal(finish.blocked, false);
      assert.deepEqual(session.stroke.at(-1), finish.finishPosition);
      assert.equal(session.diagnostics.completionCommitted, true);
      assert.deepEqual(session.path, route, `${difficulty} seed ${seed}: finish crossing does not mutate cell route`);
      assert.equal(session.move(pointer, { x: -2, y: -2 }).moved, false, `${difficulty} seed ${seed}: no post-finish movement`);
    }
  }
});

test('coalesced movement includes the dispatched pointer endpoint when it differs', () => {
  const first = { clientX: 10, clientY: 20 }, lastCoalesced = { clientX: 40, clientY: 20 };
  const event = { clientX: 60, clientY: 20, getCoalescedEvents: () => [first, lastCoalesced] };
  assert.deepEqual(pointerMovementSamples(event), [first, lastCoalesced, event]);
  const duplicate = { clientX: 40, clientY: 20, getCoalescedEvents: () => [first, lastCoalesced] };
  assert.deepEqual(pointerMovementSamples(duplicate), [first, lastCoalesced]);
});

test('pointer release ends Steering without adding unprocessed movement', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  const session = createTraceSession(mazeWithRoute(route));
  session.begin(403, route[0]);
  session.move(403, route[2]);
  const beforeRelease = session.stroke.map(point => ({ ...point }));
  assert.equal(session.end(403), true);
  assert.deepEqual(session.position, route[2]);
  const beforeCancel = session.stroke.map(point => ({ ...point }));
  assert.deepEqual(session.stroke, beforeCancel);
  assert.deepEqual(beforeRelease, beforeCancel);
});

test('sparse high-speed samples follow legal turns with a continuous pencil line', () => {
  const route = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 },
  ];
  const session = createTraceSession(mazeWithRoute(route, 4, 3));
  session.begin(401, route[0]);
  session.move(401, route[2]);
  session.move(401, route[4]);
  const final = session.move(401, route[5]);
  assert.deepEqual(final.path, route);
  assert.equal(final.blocked, false);
  assert.ok(session.stroke.every((point, index, points) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) < 0.2),
    'interpolated samples and cell transitions keep the accepted stroke connected');
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
  assert.equal(result.reason, 'closed-or-nonadjacent-edge');
  assert.ok(Math.max(...result.stroke.map(point => point.x)) < 1.5, 'the visible stroke stays on the open side of the blocked wall');
});

test('rapid repeated steering wall contacts preserve the last legal endpoint', () => {
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

test('collision followed by immediate reversal preserves every legal pencil mark', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  const session = createTraceSession(mazeWithRoute(route, 5, 1));
  session.begin(40, { x: 0, y: 0 }); session.move(40, { x: 2.2, y: 0 });
  session.move(40, { x: 2.8, y: 0 });
  const before = session.stroke.length;
  const reversed = session.move(40, { x: 1.4, y: 0 });
  assert.equal(reversed.moved, true);
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.ok(session.stroke.length >= before);
  assert.ok(Math.abs(session.position.x - 1.4) < 0.06);
});

test('legal reversal at a corner retraces without lifting when no wall was hit', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 3));
  session.begin(41, { x: 0, y: 0 }); session.move(41, { x: 1, y: 0 });
  session.move(41, { x: 1, y: 2 });
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

test('wall collision remains recoverable after lifting and resuming at the legal tip', () => {
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

test('legal branch turn and backtrack remain available without a wall contact', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 2));
  session.begin(8, { x: 0, y: 0 });
  session.move(8, { x: 1, y: 0 });
  const turn = session.move(8, { x: 1, y: 1 });
  assert.deepEqual(turn.path, route);
  assert.equal(turn.blocked, false);
  const back = session.move(8, { x: 1, y: 0 });
  assert.deepEqual(back.path, route.slice(0, 2));
  assert.equal(back.blocked, false);
});

test('diagnostic recorder is bounded, relative-time based, and resettable', () => {
  let now = 100;
  const recorder = createTraceRecorder({ limit: 2, now: () => now });
  recorder.record({ eventType: 'pointerdown', accepted: true });
  now += 5; recorder.record({ eventType: 'pointermove', accepted: false, rejectedReason: 'closed-edge' });
  now += 5; recorder.record({ eventType: 'pointercancel', pointerCanceled: true });
  const report = recorder.report({ layoutId: 'maze-test', dimensions: { width: 10, height: 10 }, difficulty: 'medium', route: [], ink: [], state: null });
  assert.equal(report.events.length, 2);
  assert.equal(report.droppedEvents, 1);
  assert.equal(report.events[0].t, 5);
  assert.equal(report.events[1].eventType, 'pointercancel');
  assert.deepEqual(report.checkpoints.map(event => event.eventType), ['pointerdown', 'pointercancel']);
  assert.equal(report.maze.layoutId, 'maze-test');
  assert.equal(report.maze.difficulty, 'medium');
  assert.equal(report.buildId, null);
  recorder.reset();
  assert.equal(recorder.length, 0);
  assert.equal(recorder.dropped, 0);
  assert.equal(recorder.checkpointCount, 0);
});

test('diagnostic checkpoints retain early gesture and wall transitions beyond the event ring', () => {
  let now = 0;
  const recorder = createTraceRecorder({ limit: 2, now: () => now++ });
  recorder.record({ eventType: 'pointerdown', gestureState: 'active', accepted: true });
  recorder.record({ eventType: 'pointermove', gestureState: 'active', accepted: true });
  recorder.record({ eventType: 'pointermove', gestureState: 'recovering', accepted: false, blocked: true, rejectedReason: 'closed-edge', failureCategory: 'collision', traceHealth: 'wall-blocked-reversal-available', pencilPosition: { x: 1.25, y: 2 }, candidateReversal: { x: 0, y: 2 }, candidateReversalOpen: true });
  for (let index = 0; index < 10; index++) recorder.record({ eventType: 'pointermove', gestureState: 'recovering', accepted: false, blocked: true, rejectedReason: 'closed-edge' });
  const report = recorder.report({ layoutId: 'maze-test', dimensions: { width: 3, height: 3 }, route: [], ink: [], state: null });
  assert.equal(report.droppedEvents, 11);
  assert.deepEqual(report.checkpoints.map(event => event.eventType), ['pointerdown', 'pointermove']);
  assert.equal(report.checkpoints[1].rejectedReason, 'closed-edge');
  assert.equal(report.checkpoints[1].traceHealth, 'wall-blocked-reversal-available');
  assert.equal(report.checkpoints[1].candidateReversalOpen, true);
  assert.deepEqual(report.checkpoints[1].pencilPosition, { x: 1.25, y: 2 });
  assert.equal(report.droppedCheckpoints, 0);
});

test('diagnostic samples retain source, interpolation, attempted edge, and build evidence', () => {
  const recorder = createTraceRecorder({ now: () => 10 });
  recorder.record({ eventType: 'pointermove', sampleType: 'coalesced', sampleIndex: 2,
    interpolationCount: 7, attemptedTransitions: [{ from: { x: 1, y: 2 }, to: { x: 2, y: 2 }, open: false }],
    controlSystem: 'continuous-steering', activeController: 'continuous-steering', movementClassification: 'closed-wall-collision',
    requestedMovement: { x: 0.03, y: 0 }, acceptedMovement: { x: 0, y: 0 },
    gestureState: 'active',
    strokeBreakCreated: true, accepted: false, rejectedReason: 'closed-wall-collision' });
  const report = recorder.report({ layoutId: 'maze-test', dimensions: { width: 3, height: 3 }, route: [], ink: [], state: null, buildId: 'build-test' });
  assert.equal(report.buildId, 'build-test');
  assert.equal(report.events[0].sampleType, 'coalesced');
  assert.equal(report.events[0].sampleIndex, 2);
  assert.equal(report.events[0].interpolationCount, 7);
  assert.deepEqual(report.events[0].attemptedTransitions, [{ from: { x: 1, y: 2 }, to: { x: 2, y: 2 }, open: false }]);
  assert.equal(report.events[0].controlSystem, 'continuous-steering');
  assert.equal(report.events[0].activeController, 'continuous-steering');
  assert.equal(report.events[0].movementClassification, 'closed-wall-collision');
  assert.deepEqual(report.events[0].requestedMovement, { x: 0.03, y: 0 });
  assert.deepEqual(report.events[0].acceptedMovement, { x: 0, y: 0 });
  assert.equal(report.events[0].gestureState, 'active');
  assert.equal(report.events[0].strokeBreakCreated, true);
});

test('layout fingerprint is stable and changes with maze topology', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const first = mazeWithRoute(route, 2, 2), second = mazeWithRoute(route, 2, 2);
  assert.equal(mazeLayoutId(first), mazeLayoutId(second));
  second.cells[0][0].walls.S = false; second.cells[1][0].walls.N = false;
  assert.notEqual(mazeLayoutId(first), mazeLayoutId(second));
});

test('physically retracing moves the pencil while retaining all prior ink', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 })), maze = mazeWithRoute(route);
  const forward = traceSegment(maze, route, route[0], route.at(-1));
  const result = traceSegment(maze, forward.path, route.at(-1), { x: 1, y: 0 }, forward.stroke, forward.strokeCells, forward.position, forward.strokeBreaks, { allowOpenEdgeProgress: true });
  assert.deepEqual(result.path, route.slice(0, 2));
  assert.ok(result.stroke.length > forward.stroke.length);
  assert.ok(Math.abs(result.position.x - 1) < 0.06);
});

test('backtracking draws a permanent second mark instead of trimming the visible trail', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  const session = createTraceSession(mazeWithRoute(route));
  session.begin(10, { x: 0, y: 0 });
  session.move(10, { x: 3, y: 0 });
  const fullLength = session.stroke.length;
  session.move(10, { x: 2.2, y: 0 });
  assert.ok(session.stroke.length > fullLength);
  assert.ok(Math.abs(session.position.x - 2.2) < 0.06);
  assert.deepEqual(session.path, route.slice(0, 3));
});

test('dead-end ink survives retracing, lift, resume, and repeat traversal', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }];
  const session = createTraceSession(mazeWithRoute(route, 3, 2));
  session.begin(101, route[0]);
  session.move(101, route[1]); session.move(101, route[2]); session.move(101, route[3]);
  const deadEndInk = session.stroke.map(point => ({ ...point }));
  session.move(101, { x: 2, y: 0 });
  assert.deepEqual(session.stroke.slice(0, deadEndInk.length), deadEndInk, 'turning around leaves the explored dead end on the page');
  assert.deepEqual(session.path, route.slice(0, 3));
  const tip = { ...session.position };
  session.end(101);
  assert.equal(session.begin(102, tip), true);
  session.move(102, { x: 2, y: 1 });
  assert.deepEqual(session.path, route, 'pencil resumes from its independent position and can revisit the marked branch');
  assert.ok(session.stroke.length > deadEndInk.length);
  assert.equal(session.diagnostics.strokeCells.length, session.stroke.length);
});

test('abandoned wrong branch remains inked when the player takes another branch', () => {
  const explored = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const maze = mazeWithRoute(explored, 3, 2);
  maze.cells[0][1].walls.E = false;
  maze.cells[0][2].walls.W = false;
  const session = createTraceSession(maze);
  session.begin(402, explored[0]);
  session.move(402, explored[1]);
  session.move(402, explored[2]);
  const abandonedMarks = session.stroke.map(point => ({ ...point }));
  session.move(402, explored[1]);
  session.move(402, { x: 2, y: 0 });
  assert.deepEqual(session.path, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  assert.deepEqual(session.stroke.slice(0, abandonedMarks.length), abandonedMarks);
  assert.ok(session.diagnostics.strokeCells.some(cell => cell.x === 1 && cell.y === 1), 'the abandoned branch stays represented in permanent ink');
});

test('deterministic generated-maze stress traces, reverses, resumes, and preserves ink across 64 seeds', () => {
  const routeToExit = maze => {
    const queue = [[maze.start]], seen = new Set([`${maze.start.x},${maze.start.y}`]);
    while (queue.length) {
      const route = queue.shift(), current = route.at(-1);
      if (current.x === maze.end.x && current.y === maze.end.y) return route;
      for (const next of [{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }]) {
        const key = `${next.x},${next.y}`;
        if (!seen.has(key) && canMove(maze, current, next)) { seen.add(key); queue.push([...route, next]); }
      }
    }
    throw new Error('Generated maze has no exit route.');
  };

  for (let seed = 1; seed <= 64; seed++) {
    const maze = createMaze(7, 7, seeded(seed));
    assert.equal(validateMaze(maze), true, `seed ${seed} is structurally sound`);
    const route = routeToExit(maze), session = createTraceSession(maze), pointer = 900 + seed;
    assert.equal(session.begin(pointer, route[0]), true);
    for (const cell of route.slice(1)) {
      const result = session.move(pointer, cell);
      assert.equal(result.blocked, false, `seed ${seed} follows each legal route edge`);
      assert.ok(Math.hypot(session.position.x - session.path.at(-1).x, session.position.y - session.path.at(-1).y) <= 0.5);
    }
    assert.deepEqual(session.path, route, `seed ${seed} reaches the actual exit`);
    const inkAtExit = session.stroke.map(point => ({ ...point }));
    session.end(pointer);
    assert.equal(session.begin(pointer + 1000, session.position), true, `seed ${seed} resumes at the pencil tip`);
    for (const cell of route.slice(0, -1).reverse()) {
      assert.equal(session.move(pointer + 1000, cell).blocked, false, `seed ${seed} reverses along the open route`);
    }
    assert.deepEqual(session.path, [maze.start], `seed ${seed} returns to the entrance`);
    assert.ok(session.stroke.length >= inkAtExit.length, `seed ${seed} never discards permanent ink`);
    assert.deepEqual(session.stroke.slice(0, inkAtExit.length), inkAtExit, `seed ${seed} retains the original drawing`);
    session.end(pointer + 1000);
  }
});

test('Medium Steering uses the shared tracer for collision, redirection, backtracking, and completion', () => {
  const maze = createMazeForDifficulty('medium', seeded(31));
  const solution = findSolution(maze);
  assert.ok(solution, 'the 10x10 maze has a valid start-to-flower path');
  const session = createTraceSession(maze);
  assert.equal(session.begin(701, maze.start), true);
  const collisionIndex = solution.findIndex((cell, index) => index > 1 && index < solution.length - 1 && [
    { x: cell.x, y: cell.y - 1 }, { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 }, { x: cell.x - 1, y: cell.y },
  ].some(next => next.x >= 0 && next.y >= 0 && next.x < maze.width && next.y < maze.height && !canMove(maze, cell, next)));
  assert.ok(collisionIndex > 1, 'the solution includes an internal closed wall for a realistic contact');
  for (const cell of solution.slice(1, collisionIndex + 1)) assert.equal(session.move(701, cell).moved, true);
  const collisionCell = solution[collisionIndex], closedNeighbor = [
    { x: collisionCell.x, y: collisionCell.y - 1 }, { x: collisionCell.x + 1, y: collisionCell.y },
    { x: collisionCell.x, y: collisionCell.y + 1 }, { x: collisionCell.x - 1, y: collisionCell.y },
  ].find(next => next.x >= 0 && next.y >= 0 && next.x < maze.width && next.y < maze.height && !canMove(maze, collisionCell, next));
  const collisionPoint = {
    x: session.position.x + Math.sign(closedNeighbor.x - collisionCell.x) * 0.7,
    y: session.position.y + Math.sign(closedNeighbor.y - collisionCell.y) * 0.7,
  };
  const expectedCell = { ...session.path.at(-1) };
  const collision = session.move(701, collisionPoint);
  assert.equal(collision.wallCollision, true);
  assert.equal(session.active, true, 'Steering remains active after collision');
  const legalTip = { ...session.position }, ink = session.stroke.map(point => ({ ...point }));
  assert.deepEqual(session.path.at(-1), expectedCell, 'collision cannot enter the cell behind the closed edge');
  assert.ok(Math.hypot(session.position.x - collisionPoint.x, session.position.y - collisionPoint.y) > 0.1,
    'the accepted pencil endpoint stops before the blocked finger destination');
  assert.equal(session.move(701, solution[collisionIndex - 1]).moved, true, 'legal redirection permits physical backtracking');
  assert.deepEqual(session.stroke.slice(0, ink.length), ink, 'collision and backtracking preserve the original ink history');

  for (let index = collisionIndex - 2; index >= 0; index--) assert.equal(session.move(701, solution[index]).moved, true);
  let completions = 0;
  for (const cell of solution.slice(1)) {
    const result = session.move(701, cell);
    assert.equal(result.moved, true);
    if (result.complete) completions++;
  }
  assert.equal(completions, 0, 'entering Medium exit cell does not complete');
  const finish = session.move(701, outsideExitPoint(maze));
  assert.equal(finish.complete, true, 'the shared tracing engine completes at the outward flower crossing');
  assert.deepEqual(session.path.at(-1), maze.end);
  assert.deepEqual(session.stroke.at(-1), finish.finishPosition);
});

test('dynamic perimeter starts accept the marked opening and finish legally at every exit edge', () => {
  const foundStarts = new Set(), foundFinishes = new Set();
  for (let seed = 0; seed < 120 && (foundStarts.size < 4 || foundFinishes.size < 4); seed++) {
    const maze = createMazeForDifficulty(seed % 2 ? 'easy' : 'medium', seeded(seed));
    foundStarts.add(maze.entrance.side);
    foundFinishes.add(maze.exit.side);
    const session = createTraceSession(maze), pointer = 2000 + seed;
    const outsideStart = { ...maze.start };
    if (maze.entrance.side === 'N') outsideStart.y -= .48;
    if (maze.entrance.side === 'E') outsideStart.x += .48;
    if (maze.entrance.side === 'S') outsideStart.y += .48;
    if (maze.entrance.side === 'W') outsideStart.x -= .48;
    assert.equal(session.begin(pointer, outsideStart), true, `seed ${seed}: touch can acquire ${maze.entrance.side} entrance without leaving the visible board`);
    assert.equal(session.move(pointer, maze.start).blocked, false, `seed ${seed}: pencil can enter through the declared opening`);
    let completed = 0;
    const solution = getShortestPath(maze);
    assert.ok(solution.length - 1 >= (maze.difficulty === 'medium' ? 28 : 18));
    for (const cell of solution.slice(1)) {
      const movement = session.move(pointer, cell);
      assert.equal(movement.moved, true, `seed ${seed}: legal solution transition is accepted`);
      if (movement.complete) completed++;
    }
    assert.equal(completed, 0, `seed ${seed}: entering the terminal cell does not complete`);
    assert.deepEqual(session.path.at(-1), maze.end);
    const finish = session.move(pointer, outsideExitPoint(maze));
    assert.equal(finish.complete, true, `seed ${seed}: crossing the selected flower opening completes`);
    assert.deepEqual(session.position, finish.finishPosition);
  }
  assert.deepEqual([...foundStarts].sort(), ['E', 'N', 'S', 'W']);
  assert.deepEqual([...foundFinishes].sort(), ['E', 'N', 'S', 'W']);
});

test('top-to-left Medium Steering stays a thin open path through turns, collision, and backtracking', () => {
  let maze, solution, turns = 0;
  for (let seed = 0; seed < 300; seed++) {
    const candidate = createMazeForDifficulty('medium', seeded(seed));
    const path = getShortestPath(candidate);
    let turnCount = 0;
    for (let i = 2; i < path.length; i++) {
      const incoming = { x: path[i - 1].x - path[i - 2].x, y: path[i - 1].y - path[i - 2].y };
      const outgoing = { x: path[i].x - path[i - 1].x, y: path[i].y - path[i - 1].y };
      if (incoming.x !== outgoing.x || incoming.y !== outgoing.y) turnCount++;
    }
    if (candidate.entrance.side === 'N' && candidate.entrance.cell.x >= 2
      && candidate.exit.side === 'W' && turnCount >= 3) {
      maze = candidate; solution = path; turns = turnCount; break;
    }
  }
  assert.ok(maze, 'the deterministic generator sample contains a top-to-left route with multiple turns');
  assert.ok(turns >= 3);
  const session = createTraceSession(maze), pointer = 811;
  assert.equal(session.begin(pointer, maze.start), true);

  let collisionIndex = -1, blockedNeighbor;
  for (let index = 1; index < solution.length - 2; index++) {
    const cell = solution[index];
    blockedNeighbor = [
      { x: cell.x + 1, y: cell.y }, { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 }, { x: cell.x, y: cell.y - 1 },
    ].find(next => next.x >= 0 && next.y >= 0 && next.x < maze.width && next.y < maze.height && !canMove(maze, cell, next));
    if (blockedNeighbor) { collisionIndex = index; break; }
  }
  assert.ok(collisionIndex > 0, 'the replay route has a closed wall available for collision');
  for (let index = 1; index <= collisionIndex; index++) assert.equal(session.move(pointer, solution[index]).moved, true);
  const routeBeforeWall = session.path.map(cell => ({ ...cell }));
  const marksBeforeWall = session.stroke.map(point => ({ ...point }));
  const collision = session.move(pointer, blockedNeighbor);
  assert.equal(collision.wallCollision, true);
  assert.deepEqual(session.path, routeBeforeWall, 'wall contact does not advance the logical route');
  assert.deepEqual(session.position, session.stroke.at(-1), 'the visible pencil and accepted ink endpoint stay synchronized');
  assert.ok(Math.abs(session.position.x - solution[collisionIndex].x) <= .46
    && Math.abs(session.position.y - solution[collisionIndex].y) <= .46,
  'the final accepted point remains on the legal side of the wall');
  assert.deepEqual(session.stroke.slice(0, marksBeforeWall.length), marksBeforeWall, 'collision preserves all earlier permanent marks');
  assert.equal(session.move(pointer, solution[collisionIndex - 1]).moved, true, 'legal backtracking remains available without lifting');
  assert.deepEqual(session.path, solution.slice(0, collisionIndex));
  assert.ok(session.stroke.length > marksBeforeWall.length, 'backtracking adds ink instead of erasing old marks');
  assert.deepEqual(session.stroke.slice(0, marksBeforeWall.length), marksBeforeWall);
  assert.equal(session.move(pointer, solution[collisionIndex]).moved, true);

  let completions = 0;
  for (let index = collisionIndex + 1; index < solution.length; index++) {
    const result = session.move(pointer, solution[index]);
    assert.equal(result.moved, true, `legal route step ${index} remains traceable`);
    if (result.complete) completions++;
  }
  assert.equal(completions, 0);
  const finish = session.move(pointer, outsideExitPoint(maze));
  assert.equal(finish.complete, true);
  assert.deepEqual(session.path.at(-1), maze.end);
  assert.deepEqual(maze.entrance, { cell: maze.start, side: 'N' });
  assert.deepEqual(maze.exit, { cell: maze.end, side: 'W' });

  const geometry = getMazeGridGeometry(maze.width, maze.height);
  const svgPoints = session.stroke.map(point => mazeToSvgPoint(point, geometry.x, geometry.cellSize, geometry.y));
  const pathData = tracePathData(svgPoints, session.strokeBreaks);
  assert.doesNotMatch(pathData, /\bZ\b/i, 'ink remains an open stroke path and is never closed into a polygon');
  assert.equal((pathData.match(/\bM/g) ?? []).length, session.strokeBreaks.length + 1, 'only explicit stroke breaks begin a new subpath');
  const strokeCells = session.diagnostics.strokeCells;
  for (let index = 1; index < strokeCells.length; index++) {
    if (session.strokeBreaks.includes(index)) continue;
    const previous = strokeCells[index - 1], current = strokeCells[index];
    const distance = Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y);
    assert.ok(distance === 0 || distance === 1 && canMove(maze, previous, current),
      `ink sample ${index} cannot connect across a wall`);
  }
});

test('Steering can redirect away from dead-end walls in all four movement directions', () => {
  const cases = [
    { route: [{ x: 0, y: 1 }, { x: 1, y: 1 }], deadEnd: { x: 1, y: 1 }, back: { x: 0, y: 1 }, outward: { x: 2, y: 1 } },
    { route: [{ x: 2, y: 1 }, { x: 1, y: 1 }], deadEnd: { x: 1, y: 1 }, back: { x: 2, y: 1 }, outward: { x: 0, y: 1 } },
    { route: [{ x: 1, y: 2 }, { x: 1, y: 1 }], deadEnd: { x: 1, y: 1 }, back: { x: 1, y: 2 }, outward: { x: 1, y: 0 } },
    { route: [{ x: 1, y: 0 }, { x: 1, y: 1 }], deadEnd: { x: 1, y: 1 }, back: { x: 1, y: 0 }, outward: { x: 1, y: 2 } },
  ];
  for (const [index, scenario] of cases.entries()) {
    const route = scenario.route;
    const maze = mazeWithRoute(route, 3, 3);
    const session = createTraceSession(maze);
    session.begin(300 + index, route[0]);
    session.move(300 + index, scenario.deadEnd);
    const ink = session.stroke.map(point => ({ ...point }));
    const blocked = session.move(300 + index, scenario.outward);
    assert.equal(blocked.blocked, true, `direction case ${index} stops at the dead-end wall`);
    const tip = { ...session.position };
    assert.equal(session.move(300 + index, scenario.back).moved, true, `direction case ${index} redirects through the open corridor`);
    assert.deepEqual(session.path.at(-1), scenario.back, `direction case ${index} reverses through its open corridor`);
    assert.equal(session.diagnostics.controlSystem, 'continuous-steering');
    assert.deepEqual(session.stroke.slice(0, ink.length), ink);
  }
});

test('permanent marks cannot authorize a jump across a closed wall', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const maze = mazeWithRoute(route, 3, 2), session = createTraceSession(maze);
  session.begin(103, route[0]); session.move(103, route[1]); session.move(103, route[2]);
  const marks = session.stroke.map(point => ({ ...point }));
  const result = session.move(103, { x: 2, y: 1 });
  assert.equal(result.blocked, true);
  assert.deepEqual(session.path, route);
  assert.ok(session.stroke.length >= marks.length);
  assert.deepEqual(session.stroke.slice(0, marks.length), marks);
});

test('restart creates a fresh attempt with no prior ink and completion retains exploration marks', () => {
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }], maze = mazeWithRoute(route, 2, 2);
  maze.exit = { cell: { ...maze.end }, side: 'E' }; maze.cells[0][1].walls.E = false;
  const session = createTraceSession(maze);
  session.begin(104, route[0]);
  session.move(104, route.at(-1));
  const result = session.move(104, outsideExitPoint(maze));
  assert.equal(result.complete, true);
  const completedInk = session.stroke.map(point => ({ ...point }));
  assert.deepEqual(session.stroke, completedInk);
  const restarted = createTraceSession(maze);
  assert.deepEqual(restarted.stroke, [maze.start]);
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

test('actual iPhone QA report excerpt replays the wall stop and corridor rejoin decisions', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/iphone-trace-qa-7x7.json', import.meta.url), 'utf8'));
  const directions = ['N', 'E', 'S', 'W'];
  const maze = {
    width: fixture.dimensions.width, height: fixture.dimensions.height,
    start: fixture.start, end: fixture.end,
    cells: fixture.wallRows.map((row, y) => row.map((bits, x) => ({
      x, y, walls: Object.fromEntries(directions.map((direction, index) => [direction, bits[index] === '1'])),
    }))),
  };
  assert.notEqual(mazeLayoutId(maze), fixture.layoutId,
    'the supplied wall bits and the report fingerprint disagree; preserve the discrepancy instead of silently normalizing it');
  assert.equal(fixture.capture.droppedEvents, 1109);
  assert.equal(fixture.capture.eventLimit, 400);

  const mismatchA = { x: 2, y: 4 }, mismatchB = { x: 3, y: 4 };
  assert.equal(maze.cells[4][2].walls.E, false);
  assert.equal(maze.cells[4][3].walls.W, true);
  const asymmetricEdges = [];
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    if (x + 1 < maze.width && maze.cells[y][x].walls.E !== maze.cells[y][x + 1].walls.W) asymmetricEdges.push({ x, y, direction: 'E' });
    if (y + 1 < maze.height && maze.cells[y][x].walls.S !== maze.cells[y + 1][x].walls.N) asymmetricEdges.push({ x, y, direction: 'S' });
  }
  assert.deepEqual(asymmetricEdges, [{ x: 2, y: 4, direction: 'E' }], 'the source excerpt has exactly one one-sided edge');
  assert.equal(canMove(maze, mismatchA, mismatchB), false);
  assert.equal(canMove(maze, mismatchB, mismatchA), false);
  assert.equal(validateMaze(maze), false, 'the captured definition contains a one-sided wall');

  const [lastLegal, collision, outsideRejoin] = fixture.capture.events;
  assert.equal(collision.rejectedReason, 'closed-or-nonadjacent-edge');
  assert.equal(outsideRejoin.rejectedReason, 'rejoin-not-route-tail');
  const routeAtCheckpoint = [...fixture.reportedFinalState.route, { x: 3, y: 3 }];
  const currentCell = { x: 3, y: 3 };
  const initialInk = [lastLegal.acceptedInkEndpoint];
  const initialInkCells = [currentCell];
  const collisionReplay = traceSegment(maze, routeAtCheckpoint, lastLegal.maze, collision.maze,
    initialInk, initialInkCells, lastLegal.acceptedInkEndpoint);
  assert.equal(collisionReplay.blocked, true);
  assert.deepEqual(collisionReplay.path, routeAtCheckpoint, 'the recorded diagonal wall contact does not advance the route');
  assert.deepEqual(collisionReplay.position, lastLegal.acceptedInkEndpoint);

  assert.equal(outsideRejoin.rejectedReason, 'rejoin-not-route-tail', 'the historical Direct Touch rejection remains unchanged in its report');

  const nextEvent = fixture.capture.events.find(event => event.t === 15221);
  assert.equal(nextEvent.cell.x, 2);
  assert.equal(nextEvent.cell.y, 4);
  assert.equal(nextEvent.previousRouteCell.x, 3);
  assert.equal(nextEvent.previousRouteCell.y, 4);
  // This event is retained as observed telemetry, but its pre-event state was
  // among the 1,109 dropped events; the report cannot prove how it was reached.
});

test('a one-sided wall cannot be crossed while retracing the previous route edge', () => {
  const maze = mazeWithRoute([{ x: 0, y: 0 }, { x: 1, y: 0 }], 2, 1);
  maze.cells[0][0].walls.E = false;
  maze.cells[0][1].walls.W = true;
  const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  assert.equal(canMove(maze, route[0], route[1]), false);
  assert.equal(advancePath(maze, route, route[0]).moved, false,
    'a predecessor pop must still validate the physical edge in both wall definitions');
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

test('Hard 15x15 uses the shared Steering tracer for a long route, collision redirect, and permanent ink', () => {
  const maze = createMazeForDifficulty('hard', seeded(712)), solution = findSolution(maze);
  const session = createTraceSession(maze), pointer = 880;
  assert.equal(session.begin(pointer, { ...maze.start }), true);
  let completion;
  for (const cell of solution.slice(1)) {
    completion = session.move(pointer, { ...cell });
    assert.equal(completion.blocked, false, `Hard solution can enter ${cell.x},${cell.y}`);
  }
  assert.deepEqual(session.path.at(-1), maze.end);
  assert.equal(completion.complete, false, 'entering Hard exit cell does not finish');
  completion = session.move(pointer, outsideExitPoint(maze));
  assert.equal(completion.complete, true, 'crossing Hard exit opening finishes');
  assert.ok(session.stroke.length > 100, 'the shared permanent ink history supports the longer Hard route');

  const replay = createTraceSession(maze), replayPointer = 881;
  replay.begin(replayPointer, { ...maze.start });
  let collisionIndex = -1, collisionDirection;
  for (let index = 1; index < solution.length; index++) {
    const cell = solution[index];
    replay.move(replayPointer, { ...cell });
    const closedDirection = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]
      .map(delta => ({ x: cell.x + delta.x, y: cell.y + delta.y, delta }))
      .find(next => next.x >= 0 && next.y >= 0 && next.x < maze.width && next.y < maze.height
        && !canMove(maze, cell, { x: next.x, y: next.y }));
    if (closedDirection) { collisionIndex = index; collisionDirection = closedDirection.delta; break; }
  }
  assert.ok(collisionIndex > 0, 'the deterministic Hard route contains a testable closed wall');
  const beforeCollision = replay.stroke.map(point => ({ ...point }));
  const tip = solution[collisionIndex];
  const collision = replay.move(replayPointer, { x: tip.x + collisionDirection.x * .7, y: tip.y + collisionDirection.y * .7 });
  assert.equal(collision.wallCollision, true);
  assert.equal(replay.active, true, 'Steering stays active after a wall stop');
  assert.deepEqual(replay.stroke.slice(0, beforeCollision.length), beforeCollision, 'the collision preserves earlier ink');
  const endpoint = { ...replay.position }, inkAtCollision = replay.stroke.map(point => ({ ...point }));
  const backtrack = replay.move(replayPointer, solution[collisionIndex - 1]);
  assert.equal(backtrack.blocked, false, 'the shared tracer permits legal backtracking in the same Steering gesture');
  assert.equal(replay.path.length, collisionIndex, 'logical route shortens when retracing');
  assert.ok(replay.stroke.length >= inkAtCollision.length, 'permanent ink never shrinks during backtracking');
});

test('QA steering collision rejects only the frame and can redirect through an open passage without lifting', () => {
  const maze = mazeWithRoute([{ x: 0, y: 0 }, { x: 0, y: 1 }], 2, 2);
  const session = createTraceSession(maze), initialPosition = { ...session.position }, initialInk = session.stroke.map(point => ({ ...point }));
  assert.equal(session.beginSteering(991), true);
  assert.deepEqual(session.position, initialPosition, 'establishing the steering gesture does not move the pencil');
  assert.deepEqual(session.stroke, initialInk, 'touchdown draws no ink');
  const collision = session.steer(991, { x: 0.7, y: 0 });
  assert.equal(collision.wallCollision, true);
  assert.equal(collision.steeringCollision, true);
  assert.equal(session.active, true, 'steering stays active after wall contact');
  assert.equal(session.diagnostics.controlSystem, 'continuous-steering');
  assert.deepEqual(session.path, [{ x: 0, y: 0 }]);
  assert.ok(session.position.x <= 0.46, 'the pencil stops on the legal side of the closed east wall');
  const afterCollisionInk = session.stroke.map(point => ({ ...point }));
  for (let index = 0; index < 8; index++) session.steer(991, { x: 0.2, y: 0 });
  assert.deepEqual(session.position, collision.position, 'continued wall pressure cannot advance the endpoint');
  assert.deepEqual(session.stroke, afterCollisionInk, 'holding against a wall does not add duplicate ink');
  const turn = session.steer(991, { x: 0, y: 0.8 });
  assert.equal(turn.moved, true);
  assert.deepEqual(session.path, [{ x: 0, y: 0 }, { x: 0, y: 1 }], 'steering can proceed down the open passage without lifting');
  assert.equal(turn.complete, false, 'reaching the terminal cell alone does not finish');
  assert.ok(session.stroke.length >= afterCollisionInk.length, 'earlier ink remains append-only');
  assert.equal(session.end(991), true);
});

test('QA steering can backtrack to a junction while retaining permanent ink', () => {
  const maze = mazeWithRoute([{ x: 0, y: 0 }, { x: 1, y: 0 }], 2, 2);
  maze.end = { x: 1, y: 1 };
  const session = createTraceSession(maze);
  session.beginSteering(992);
  assert.equal(session.steer(992, { x: 0.9, y: 0 }).moved, true);
  assert.deepEqual(session.path, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  const beforeReverse = session.stroke.map(point => ({ ...point }));
  assert.equal(session.steer(992, { x: -0.9, y: 0 }).moved, true);
  assert.deepEqual(session.path, [{ x: 0, y: 0 }]);
  assert.ok(session.stroke.length >= beforeReverse.length, 'backtracking does not remove any ink');
  assert.deepEqual(session.stroke.slice(0, beforeReverse.length), beforeReverse);
});

test('the shared steering tracer accepts legal movement in Easy, Medium, and Hard layouts', () => {
  for (const [index, difficulty] of ['easy', 'medium', 'hard', 'expert'].entries()) {
    const maze = createMazeForDifficulty(difficulty, seeded(4300 + index));
    const solution = findSolution(maze), session = createTraceSession(maze), pointer = 995 + index;
    assert.ok(solution && solution.length > 2);
    assert.equal(session.beginSteering(pointer), true,
      'the tracing session accepts steering ownership without moving the pencil');
    for (const next of solution.slice(1, 6)) {
      const from = session.position;
      const movement = session.steer(pointer, { x: next.x - from.x, y: next.y - from.y });
      assert.equal(movement.blocked, false, `${difficulty} accepts legal movement toward ${next.x},${next.y}`);
    }
    assert.deepEqual(session.path.at(-1), solution[5]);
    assert.ok(session.stroke.length > 1);
    session.end(pointer);
  }
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
