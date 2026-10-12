import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTraceSession, traceSegment } from '../src/tracing.js';
import { createTraceRecorder, mazeLayoutId } from '../src/trace-diagnostics.js';
import { advancePath, canMove, validateMaze } from '../src/maze.js';

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
  assert.equal(result.reason, 'closed-or-nonadjacent-edge');
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

test('wall recovery cannot project onto an older parallel corridor across a wall', () => {
  // This reproduces the unrecoverable state: the route doubles back through a
  // parallel corridor, the old and current ink can be less than one finger
  // width apart, and the finger leaves toward the separating wall.
  const route = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ];
  const session = createTraceSession(mazeWithRoute(route, 3, 3));
  session.begin(71, { x: 0, y: 0 });
  session.move(71, { x: 2, y: 0.42 });
  session.move(71, { x: 2, y: 1.42 });
  session.move(71, { x: 0, y: 1.42 });
  assert.deepEqual(session.path, route);

  session.move(71, { x: 0, y: 0.49 }); // touch the wall shared with the earlier row
  const restored = session.move(71, { x: 0, y: 0.54 });
  assert.equal(restored.blocked, false);
  assert.deepEqual(session.path, route);
  assert.equal(Math.round(session.stroke.at(-1).y), session.path.at(-1).y,
    'the visible endpoint remains in the logical endpoint cell');

  const reverse = session.move(71, { x: 1.7, y: 1.42 });
  assert.equal(reverse.moved, true);
  assert.deepEqual(session.path, route.slice(0, 4), 'the legal predecessor remains reachable without lifting');
  assert.equal(Math.round(session.stroke.at(-1).x), session.path.at(-1).x);
  assert.equal(Math.round(session.stroke.at(-1).y), session.path.at(-1).y);
});

test('wall-side recovery preserves the route tip when old ink is closer across a wall', () => {
  const route = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ];
  const maze = mazeWithRoute(route, 3, 3), path = route.slice(0, 5);
  // The current route ink sits on the far side of cell 1,1. The earlier
  // parallel segment sits .16 cells from the wall-side re-entry point.
  const stroke = [
    { x: 0, y: 0 }, { x: 0, y: 0.42 }, { x: 1, y: 0.42 }, { x: 2, y: 0.42 },
    { x: 2, y: 0.58 }, { x: 2, y: 1.42 }, { x: 1.5, y: 1.42 }, { x: 1, y: 1.42 },
  ];
  const strokeCells = [route[0], route[0], route[1], route[2], route[3], route[3], route[4], route[4]];
  const result = traceSegment(maze, path, { x: 1, y: 0.49 }, { x: 1, y: 0.54 }, stroke, stroke.at(-1), true, strokeCells);
  assert.deepEqual(result.path, path);
  assert.equal(result.recovering, false);
  assert.deepEqual({ x: Math.round(result.stroke.at(-1).x), y: Math.round(result.stroke.at(-1).y) }, path.at(-1),
    'the accepted ink endpoint cannot jump to the older corridor');

  const forward = traceSegment(maze, result.path, { x: 1, y: 0.54 }, { x: 0.4, y: 1.42 }, result.stroke, { x: 1, y: 0.54 }, false, result.strokeCells);
  assert.deepEqual(forward.path, route, 'the legal forward edge stays available');
  const reverse = traceSegment(maze, forward.path, { x: 0.4, y: 1.42 }, { x: 1.2, y: 1.42 }, forward.stroke, { x: 0.4, y: 1.42 }, false, forward.strokeCells);
  assert.deepEqual(reverse.path, path, 'the same route can be retraced without a reset');
});

test('after a blocked sample both route directions remain available in the same gesture', () => {
  const route = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  const session = createTraceSession(mazeWithRoute(route, 5, 2));
  session.begin(72, { x: 0, y: 0 });
  session.move(72, { x: 2, y: 0 });
  assert.equal(session.move(72, { x: 2, y: 0.7 }).blocked, true);
  const recovered = session.move(72, { x: 2, y: 0.42 });
  assert.equal(recovered.recovering, false, 'the pointer re-enters the legal corridor without a lift');
  assert.deepEqual(session.path, route.slice(0, 3));
  assert.equal(session.move(72, { x: 1.2, y: 0 }).moved, true);
  assert.deepEqual(session.path, route.slice(0, 2));
  assert.equal(session.move(72, { x: 2.4, y: 0 }).moved, true);
  assert.deepEqual(session.path, route.slice(0, 3));
  assert.equal(session.move(72, { x: 2.4, y: 0.7 }).blocked, true, 'repeated wall contact is safely rejected');
  assert.equal(session.move(72, { x: 1.1, y: 0 }).moved, true, 'reverse remains available after repeated contact');
  assert.deepEqual(session.path, route.slice(0, 2));
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

test('long multi-turn gesture with repeated wall contacts keeps forward and reverse transitions available', () => {
  const route = [
    ...Array.from({ length: 7 }, (_, x) => ({ x, y: 0 })),
    ...Array.from({ length: 7 }, (_, index) => ({ x: 6 - index, y: 1 })),
    ...Array.from({ length: 7 }, (_, index) => ({ x: index, y: 2 })),
    ...Array.from({ length: 7 }, (_, index) => ({ x: 6 - index, y: 3 })),
  ];
  const maze = mazeWithRoute(route, 7, 5), recorded = [{ eventType: 'pointerdown', pointerType: 'touch', maze: { x: 0, y: 0 } }];
  const collisionIndices = new Set([3, 8, 14, 19, 22]);
  for (let index = 1; index <= 22; index++) {
    const destination = route[index];
    recorded.push({ eventType: 'pointermove', pointerType: 'touch', maze: destination });
    if (!collisionIndices.has(index)) continue;
    const current = route[index];
    const blockedOffsets = [
      { x: 0, y: -0.49 }, { x: 0.49, y: 0 }, { x: 0, y: 0.49 }, { x: -0.49, y: 0 },
    ].filter(offset => !canMove(maze, current, { x: current.x + Math.sign(offset.x), y: current.y + Math.sign(offset.y) }));
    recorded.push({ eventType: 'pointermove', pointerType: 'touch', maze: { x: current.x + blockedOffsets[0].x, y: current.y + blockedOffsets[0].y } });
    recorded.push({ eventType: 'pointermove', pointerType: 'touch', maze: current });
  }
  const endpointIndex = 22;
  recorded.push({ eventType: 'pointermove', pointerType: 'touch', maze: route[endpointIndex + 1] });
  recorded.push({ eventType: 'pointermove', pointerType: 'touch', maze: route[endpointIndex] });
  recorded.push({ eventType: 'pointermove', pointerType: 'touch', maze: route[endpointIndex - 1] });
  recorded.push({ eventType: 'pointerup', pointerType: 'touch', maze: route[endpointIndex - 1] });

  let eventTime = 0;
  const recorder = createTraceRecorder({ now: () => eventTime++ });
  for (const event of recorded) recorder.record(event);
  const replayReport = recorder.report({ layoutId: mazeLayoutId(maze), dimensions: { width: maze.width, height: maze.height }, route: [], ink: [], state: null });
  const { session, moveResults } = replayRecordedPointerEvents(maze, replayReport.events);
  assert.equal(moveResults.filter(result => result.blocked).length, collisionIndices.size, 'the replay records every repeated wall contact');
  const [forward, reverse, secondReverse] = moveResults.slice(-3);
  assert.ok(forward.moved, 'legal forward movement still works after the long gesture');
  assert.deepEqual(forward.path, route.slice(0, endpointIndex + 2));
  assert.ok(reverse.moved, 'immediate reverse movement still works after the long gesture');
  assert.deepEqual(reverse.path, route.slice(0, endpointIndex + 1));
  assert.ok(secondReverse.moved, 'a second reverse transition is still legal');
  assert.deepEqual(secondReverse.path, route.slice(0, endpointIndex));
  assert.equal(session.diagnostics.strokeCells.length, session.stroke.length, 'each visible sample retains its logical-cell association');
});

test('diagnostic recorder is bounded, relative-time based, and resettable', () => {
  let now = 100;
  const recorder = createTraceRecorder({ limit: 2, now: () => now });
  recorder.record({ eventType: 'pointerdown', accepted: true });
  now += 5; recorder.record({ eventType: 'pointermove', accepted: false, rejectedReason: 'closed-edge' });
  now += 5; recorder.record({ eventType: 'pointercancel', pointerCanceled: true });
  const report = recorder.report({ layoutId: 'maze-test', dimensions: { width: 3, height: 3 }, route: [], ink: [], state: null });
  assert.equal(report.events.length, 2);
  assert.equal(report.droppedEvents, 1);
  assert.equal(report.events[0].t, 5);
  assert.equal(report.events[1].eventType, 'pointercancel');
  assert.deepEqual(report.checkpoints.map(event => event.eventType), ['pointerdown', 'pointercancel']);
  assert.equal(report.maze.layoutId, 'maze-test');
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
  const result = traceSegment(maze, forward.path, route.at(-1), { x: 1, y: 0 }, forward.stroke, route.at(-1), false, forward.strokeCells, forward.position, forward.strokeBreaks);
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

test('wall collision at the reported iPhone endpoint remains reversible and resumable', () => {
  const walked = Array.from({ length: 6 }, (_, y) => ({ x: 0, y }));
  walked.push({ x: 1, y: 5 });
  const maze = mazeWithRoute(walked, 7, 7);
  maze.end = { x: 6, y: 6 };
  // Add a legal branch from the junction to prove exploration can continue.
  maze.cells[5][0].walls.S = false;
  maze.cells[6][0].walls.N = false;
  const session = createTraceSession(maze);
  session.begin(201, walked[0]);
  session.move(201, { x: 0, y: 5 });
  session.move(201, { x: 1.4188556957678766, y: 5.42 });
  assert.deepEqual(session.path, walked);
  assert.ok(Math.abs(session.position.x - 1.4188556957678766) < 0.01);
  const inkAtLegalEndpoint = session.stroke.map(point => ({ ...point }));

  const collision = session.move(201, { x: 1.539, y: 5.452 });
  assert.equal(collision.blocked, true);
  assert.equal(collision.reason, 'closed-wall-collision');
  assert.equal(session.position.x, 1.4188556957678766, 'wall contact leaves the authoritative pencil position unchanged');
  assert.deepEqual(session.stroke, inkAtLegalEndpoint, 'collision never erases or adds marks through the wall');
  assert.equal(session.diagnostics.traceHealth, 'wall-blocked-reversal-available');
  assert.deepEqual(session.diagnostics.candidateReversal, { x: 0, y: 5 });
  assert.equal(session.diagnostics.candidateReversalOpen, true);

  session.end(201);
  assert.equal(session.begin(202, { x: 2.2, y: 5.42 }), false);
  assert.equal(session.diagnostics.reason, 'begin-outside-route-endpoint-corridor');
  assert.equal(session.diagnostics.failureCategory, 'acquisition');
  assert.ok(session.diagnostics.resumeAcquisitionDistance > session.diagnostics.resumeAcquisitionThreshold);
  assert.equal(session.begin(202, { x: 0.54, y: 5.46 }), true,
    'resume accepts a point in the same legal cell even when it is more than 0.4 from the pencil');
  assert.ok(session.diagnostics.resumeAcquisitionDistance > 0.4);
  assert.ok(session.diagnostics.resumeAcquisitionDistance <= session.diagnostics.resumeAcquisitionThreshold);
  assert.equal(session.diagnostics.failureCategory, null);
  assert.equal(session.position.x, 1.4188556957678766, 'acquisition does not teleport the pencil');
  const reversal = session.move(202, { x: 0.4, y: 5.42 });
  assert.equal(reversal.moved, true);
  assert.deepEqual(session.path, walked.slice(0, -1));
  assert.equal(session.diagnostics.recovering, false);
  assert.equal(session.diagnostics.blocked, false, 'a legal reversal clears the active collision state');
  assert.equal(session.diagnostics.traceHealth, 'ready');
  assert.ok(session.stroke.length > inkAtLegalEndpoint.length);
  assert.deepEqual(session.stroke.slice(0, inkAtLegalEndpoint.length), inkAtLegalEndpoint);
  assert.ok(Math.abs(session.position.x - 0.4) < 1e-9);
  assert.equal(session.position.y, 5.42);

  session.end(202);
  const positionBeforeAcquire = { ...session.position };
  assert.equal(session.begin(203, { x: 0.42, y: 5.44 }), true, 'a touch in the legal endpoint cell is acquired');
  assert.deepEqual(session.position, positionBeforeAcquire, 'pointerdown acquisition offset is not traveled movement');
  session.move(203, { x: 0.2, y: 5.42 });
  assert.deepEqual(session.path, walked.slice(0, -1));
  assert.ok(Math.abs(session.position.x - 0.2) < 0.03);
  session.move(203, { x: 0, y: 5 });
  assert.deepEqual(session.path, walked.slice(0, -1));
  session.move(203, { x: 0, y: 4 });
  assert.deepEqual(session.path, walked.slice(0, -2));
  session.move(203, { x: 0.4, y: 5.42 });
  session.move(203, { x: 0, y: 6 });
  assert.deepEqual(session.path.at(-1), { x: 0, y: 6 }, 'the player can continue exploring from the junction');

  const marksBeforeRepeat = session.stroke.map(point => ({ ...point }));
  session.move(203, { x: 0, y: 5 });
  session.move(203, { x: 1.6, y: 5.42 });
  assert.equal(session.diagnostics.reason, 'closed-wall-collision');
  assert.equal(session.diagnostics.traceHealth, 'wall-blocked-reversal-available');
  session.move(203, { x: 0.4, y: 5.42 });
  session.move(203, { x: 0, y: 6 });
  assert.deepEqual(session.path.at(-1), { x: 0, y: 6 }, 'repeated wall contacts do not permanently block legal input');
  assert.deepEqual(session.stroke.slice(0, marksBeforeRepeat.length), marksBeforeRepeat);
});

test('dead-end recovery works across all four movement directions', () => {
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
    session.move(300 + index, scenario.back);
    assert.deepEqual(session.path.at(-1), scenario.back, `direction case ${index} reverses through its open corridor`);
    assert.equal(session.diagnostics.recovering, false);
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
  const session = createTraceSession(maze);
  session.begin(104, route[0]);
  const result = session.move(104, route.at(-1));
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
    initialInk, lastLegal.maze, false, initialInkCells, lastLegal.acceptedInkEndpoint);
  assert.equal(collisionReplay.blocked, true);
  assert.deepEqual(collisionReplay.path, routeAtCheckpoint, 'the recorded diagonal wall contact does not advance the route');
  assert.deepEqual(collisionReplay.position, lastLegal.acceptedInkEndpoint);

  const rejoinReplay = traceSegment(maze, collisionReplay.path, collision.maze, outsideRejoin.maze,
    collisionReplay.stroke, collision.maze, true, collisionReplay.strokeCells, collisionReplay.position, collisionReplay.strokeBreaks);
  assert.equal(rejoinReplay.blocked, true, 'the recorded sample remains outside the connected route');
  assert.deepEqual(rejoinReplay.path, routeAtCheckpoint);
  assert.deepEqual(rejoinReplay.stroke, collisionReplay.stroke, 'blocked movement adds no ink');

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

test('touch gesture suppression is scoped to the maze and browser zoom stays enabled', async () => {
  const [css, html] = await Promise.all([readFile(new URL('../src/styles.css', import.meta.url), 'utf8'), readFile(new URL('../index.html', import.meta.url), 'utf8')]);
  assert.match(css, /\.maze-paper,#maze\s*\{[^}]*touch-action\s*:\s*none/s);
  assert.doesNotMatch(css, /(?:^|[},])\s*(?:html|body|\*)\s*\{[^}]*touch-action\s*:\s*none/s);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.doesNotMatch(html, /maximum-scale\s*=|user-scalable\s*=\s*no/i);
});
