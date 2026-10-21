import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createSteeringController, DEFAULT_STEERING_SETTINGS, steeringSpeedForDisplacement,
} from '../src/continuous-steering.js';
import { createTraceSession } from '../src/tracing.js';
import { createTraceRecorder } from '../src/trace-diagnostics.js';
import { canMove, createMazeForDifficulty } from '../src/maze.js';

function mazeWithOpenRoute(route, width = 7, height = 7, entranceSide = 'N') {
  const cells = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ({ x, y, walls: { N: true, E: true, S: true, W: true } })));
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1], to = route[i];
    const direction = to.x > from.x ? 'E' : to.x < from.x ? 'W' : to.y > from.y ? 'S' : 'N';
    const opposite = { N: 'S', E: 'W', S: 'N', W: 'E' }[direction];
    cells[from.y][from.x].walls[direction] = false;
    cells[to.y][to.x].walls[opposite] = false;
  }
  const start = { ...route[0] }, end = { x: width - 1, y: height - 1 };
  cells[start.y][start.x].walls[entranceSide] = false;
  cells[end.y][end.x].walls.E = false;
  return { width, height, cells, start, end, entrance: { cell: start, side: entranceSide }, exit: { cell: end, side: 'E' } };
}

function steeringHarness(maze, pointer = 500, settings = {}) {
  const controller = createSteeringController(settings), session = createTraceSession(maze);
  const origin = { x: 200, y: 200 };
  let timestamp = 0;
  assert.equal(session.beginSteering(pointer), true);
  assert.equal(controller.begin(pointer, origin), true);
  controller.advance(pointer, timestamp);
  return {
    controller, session,
    drive: (direction, until, maxFrames = 240) => {
      const vectors = { N: { x: 0, y: -76 }, E: { x: 76, y: 0 }, S: { x: 0, y: 76 }, W: { x: -76, y: 0 } };
      controller.update(pointer, { x: origin.x + vectors[direction].x, y: origin.y + vectors[direction].y });
      const results = [];
      for (let frame = 0; frame < maxFrames && !until(session); frame++) {
        timestamp += 1000 / 60;
        const delta = controller.advance(pointer, timestamp);
        if (delta.active) results.push(session.steer(pointer, delta));
      }
      return results;
    },
  };
}

function containsCell(path, cell) { return path.some(item => item.x === cell.x && item.y === cell.y); }

function seeded(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function runRate(hz, durationMs = 1000) {
  const controller = createSteeringController(), pointer = 91;
  controller.begin(pointer, { x: 120, y: 210 });
  controller.update(pointer, { x: 180, y: 210 });
  controller.advance(pointer, 0);
  let total = 0;
  for (let time = 1000 / hz; time <= durationMs + 0.01; time += 1000 / hz) {
    total += controller.advance(pointer, time).x;
  }
  controller.end(pointer);
  return total;
}

test('touch down establishes steering origin without producing movement', () => {
  const controller = createSteeringController(), pointer = 1;
  assert.equal(controller.begin(pointer, { x: 20, y: 30 }), true);
  assert.deepEqual(controller.advance(pointer, 0), { x: 0, y: 0, speed: 0, active: false, frameSeconds: 0, clamped: false });
  assert.deepEqual(controller.advance(pointer, 16), { x: 0, y: 0, speed: 0, active: false, frameSeconds: 0.016, clamped: false });
  assert.deepEqual(controller.snapshot.origin, { x: 20, y: 30 });
});

test('screen displacement defines all four directions and the central dead zone stops motion', () => {
  const controller = createSteeringController({ deadZonePixels: 10, maxDeflectionPixels: 60 });
  const cases = [
    [{ x: 50, y: 0 }, { x: 0, y: -1 }],
    [{ x: 50, y: 100 }, { x: 0, y: 1 }],
    [{ x: 0, y: 50 }, { x: -1, y: 0 }],
    [{ x: 100, y: 50 }, { x: 1, y: 0 }],
  ];
  for (const [finger, direction] of cases) {
    controller.begin(4, { x: 50, y: 50 });
    controller.update(4, finger);
    controller.advance(4, 0);
    const delta = controller.advance(4, 20);
    assert.equal(Math.sign(delta.x), Math.sign(direction.x));
    assert.equal(Math.sign(delta.y), Math.sign(direction.y));
    controller.end(4);
  }
  controller.begin(5, { x: 4, y: 8 });
  controller.update(5, { x: 13, y: 8 });
  controller.advance(5, 0);
  assert.equal(controller.advance(5, 16).active, false);
});

test('greater finger displacement increases speed up to the configured bound', () => {
  const controller = createSteeringController();
  controller.begin(2, { x: 0, y: 0 });
  controller.advance(2, 0);
  controller.update(2, { x: 20, y: 0 });
  const near = controller.advance(2, 20).speed;
  controller.update(2, { x: 60, y: 0 });
  const farther = controller.advance(2, 40).speed;
  controller.update(2, { x: 500, y: 0 });
  const maximum = controller.advance(2, 60).speed;
  assert.ok(farther > near);
  assert.equal(maximum, DEFAULT_STEERING_SETTINGS.maxSpeedMazeUnitsPerSecond);
  assert.ok(maximum <= DEFAULT_STEERING_SETTINGS.maxSpeedMazeUnitsPerSecond);
});

test('steering speed curve has a quiet dead zone, smooth precision onset, and increasing fast range', () => {
  const settings = DEFAULT_STEERING_SETTINGS;
  const sample = displacement => steeringSpeedForDisplacement(displacement, settings);
  assert.equal(sample(10), 0);
  assert.equal(sample(0), 0);
  assert.ok(sample(10.1) > 0 && sample(10.1) < 0.001, 'speed starts continuously and very slowly just outside the dead zone');
  const speeds = [12, 20, 35, 50, 76, 100].map(sample);
  assert.ok(speeds.every((speed, index) => index === 0 || speed >= speeds[index - 1]), 'speed rises monotonically and plateaus only at the cap');
  assert.ok(speeds[2] > speeds[1] * 2, 'moderate deflection is readily faster than slight deflection');
  assert.ok(speeds[4] > speeds[3] * 1.5, 'large deflection is noticeably faster than moderate deflection');
  assert.equal(speeds[4], settings.maxSpeedMazeUnitsPerSecond);
  assert.equal(speeds[5], settings.maxSpeedMazeUnitsPerSecond, 'speed remains capped above maximum deflection');
  assert.ok(sample(10.01) < 0.001, 'there is no velocity jump at the dead-zone boundary');
});

test('current deflection determines steady speed and recentering immediately stops the controller', () => {
  const controller = createSteeringController(), pointer = 32;
  controller.begin(pointer, { x: 50, y: 50 });
  controller.update(pointer, { x: 85, y: 50 });
  controller.advance(pointer, 0);
  const steady = Array.from({ length: 8 }, (_, index) => controller.advance(pointer, (index + 1) * 16).speed);
  assert.ok(steady.every(speed => speed === steady[0]), 'holding a fixed deflection does not accelerate over time');
  controller.update(pointer, { x: 60, y: 50 });
  assert.equal(controller.advance(pointer, 144).active, false, 'returning to the 10px dead zone stops on the next frame');
  controller.end(pointer);
  assert.equal(controller.advance(pointer, 160).active, false, 'release leaves no latent movement');
});

test('bounded QA events can distinguish requested steering speed from collision-limited accepted speed', () => {
  let now = 0;
  const recorder = createTraceRecorder({ now: () => now });
  recorder.record({
    eventType: 'steering-blocked', selectedInputMode: 'continuous-steering', activeController: 'continuous-steering',
    steeringMetrics: { fingerDisplacementPixels: 50.04, speedDemand: 0.517, requestedSpeed: 0.775, acceptedSpeed: 0 },
    rejectedReason: 'closed-wall-collision', blocked: true, accepted: false,
  });
  now = 5;
  const report = recorder.report({ layoutId: 'maze-test', dimensions: { width: 7, height: 7 }, route: [], ink: [], state: null });
  assert.deepEqual(report.events[0].steeringMetrics, {
    fingerDisplacementPixels: 50,
    speedDemand: 0.517,
    requestedSpeed: 0.775,
    acceptedSpeed: 0,
  });
  assert.equal(report.events[0].activeController, 'continuous-steering');
  assert.equal(report.events[0].rejectedReason, 'closed-wall-collision');
});

test('refined faster speed remains bounded by the shared tracer at a wall and redirects legally', () => {
  const route = [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 }];
  const maze = mazeWithOpenRoute(route);
  const { controller, session, drive } = steeringHarness(maze, 541, { speedResponseExponent: 1.15 });
  drive('S', state => containsCell(state.path, route[1]) && state.position.y > 1.02);
  drive('E', state => containsCell(state.path, route[2]) && state.position.x > 3.02);
  const inkAtWall = session.stroke.length;
  const wall = drive('E', state => state.diagnostics.blocked, 100);
  assert.ok(wall.some(result => result.wallCollision), 'the faster controller still reports the closed edge as a wall collision');
  const inkAfterFirstCollision = session.stroke.length;
  drive('E', () => false, 12);
  assert.equal(session.stroke.length, inkAfterFirstCollision, 'repeated blocked frames do not append duplicate ink');
  assert.ok(session.position.x <= 3.46 + 1e-9, 'the accepted endpoint remains on the legal side of the wall');
  drive('W', state => state.position.x < 2.9, 100);
  assert.ok(session.position.x < 2.9, 'the same active gesture can redirect into an open passage');
  assert.ok(session.stroke.length > inkAtWall, 'legal redirection appends permanent ink');
  controller.end(541); session.end(541);
});

test('refined controller and tracer cross multiple cells with the same time-based integration at 30 and 60 Hz', () => {
  const route = [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }];
  const maze = mazeWithOpenRoute(route);
  function travel(hz) {
    const { session, drive } = steeringHarness(maze, 550 + hz, { speedResponseExponent: 1.15 });
    drive('S', state => state.position.y >= 2.8, 300);
    const position = { ...session.position };
    return { position, route: session.path };
  }
  const at30 = travel(30), at60 = travel(60);
  assert.ok(containsCell(at30.route, route[3]) && containsCell(at60.route, route[3]), 'both frame rates cross multiple legal open edges');
  assert.ok(Math.abs(at30.position.y - at60.position.y) < 0.04, `30 Hz=${at30.position.y}, 60 Hz=${at60.position.y}`);
});

test('holding a displaced finger produces continuous movement without further pointer events', () => {
  const controller = createSteeringController();
  controller.begin(3, { x: 100, y: 100 });
  controller.update(3, { x: 170, y: 100 });
  controller.advance(3, 0);
  const steps = Array.from({ length: 8 }, (_, i) => controller.advance(3, (i + 1) * 16));
  assert.ok(steps.every(step => step.active && step.x > 0 && step.y === 0));
});

test('actual Steering controller and tracer cross the north-start opening, consecutive open cells, and turns without lifting', () => {
  // Equivalent fixed 7x7 reproduction: start at (2,0), north entrance, with
  // a legal south-east-south route and closed surrounding edges.
  const route = [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }];
  const maze = mazeWithOpenRoute(route);
  assert.equal(canMove(maze, route[0], route[1]), true);
  const { controller, session, drive } = steeringHarness(maze, 501);
  assert.ok(drive('S', state => containsCell(state.path, route[1]) && state.position.y > 1.02).length > 0,
    'the pencil crosses the first open cell edge from the starting square');
  assert.ok(drive('E', state => containsCell(state.path, route[2]) && state.position.x > 3.02).length > 0,
    'the same held steering gesture can turn east and cross another open edge');
  assert.ok(drive('S', state => containsCell(state.path, route[3]) && state.position.y > 2.02).length > 0,
    'the same gesture can make a second turn and enter a third cell');
  assert.deepEqual(session.path, route);
  assert.ok(session.stroke.length > 20, 'accepted steering frames produce a connected sampled trail');
  assert.equal(session.diagnostics.active, true);
  assert.equal(controller.active, true);
  controller.end(501); session.end(501);
});

test('generated Easy north-entrance maze can leave start cell (2,0) through its open south edge', () => {
  const maze = createMazeForDifficulty('easy', seeded(12));
  assert.deepEqual(maze.start, { x: 2, y: 0 });
  assert.equal(maze.entrance.side, 'N');
  const inner = { x: 2, y: 1 };
  assert.equal(canMove(maze, maze.start, inner), true);
  const { session, drive } = steeringHarness(maze, 505);
  drive('S', state => containsCell(state.path, inner) && state.position.y > 0.55);
  assert.ok(containsCell(session.path, inner), 'the actual generated open edge is traversable using the live controller and tracer');
  assert.equal(session.diagnostics.blocked, false);
});

test('actual Steering controller crosses an inward open edge from entrances on all four sides', () => {
  const cases = [
    { start: { x: 3, y: 0 }, inner: { x: 3, y: 1 }, side: 'N', direction: 'S' },
    { start: { x: 3, y: 6 }, inner: { x: 3, y: 5 }, side: 'S', direction: 'N' },
    { start: { x: 6, y: 3 }, inner: { x: 5, y: 3 }, side: 'E', direction: 'W' },
    { start: { x: 0, y: 3 }, inner: { x: 1, y: 3 }, side: 'W', direction: 'E' },
  ];
  for (const [index, item] of cases.entries()) {
    const { session, drive } = steeringHarness(mazeWithOpenRoute([item.start, item.inner], 7, 7, item.side), 510 + index);
    drive(item.direction, state => containsCell(state.path, item.inner) && Math.hypot(state.position.x - item.inner.x, state.position.y - item.inner.y) < 0.45);
    assert.ok(containsCell(session.path, item.inner), `${item.side} entrance can enter its adjacent open cell`);
    assert.equal(session.diagnostics.blocked, false);
  }
});

test('actual Steering plus tracer can enter an open cell on Easy, Medium, and Hard generated layouts', () => {
  const vectors = [{ x: 0, y: -1, direction: 'N' }, { x: 1, y: 0, direction: 'E' },
    { x: 0, y: 1, direction: 'S' }, { x: -1, y: 0, direction: 'W' }];
  for (const [index, difficulty] of ['easy', 'medium', 'hard'].entries()) {
    const maze = createMazeForDifficulty(difficulty, seeded(600 + index));
    const adjacent = vectors.map(({ x, y, direction }) => ({ cell: { x: maze.start.x + x, y: maze.start.y + y }, direction }))
      .find(item => item.cell.x >= 0 && item.cell.y >= 0 && item.cell.x < maze.width && item.cell.y < maze.height && canMove(maze, maze.start, item.cell));
    assert.ok(adjacent, `${difficulty} start has a legal neighboring passage`);
    const { session, drive } = steeringHarness(maze, 530 + index);
    drive(adjacent.direction, state => containsCell(state.path, adjacent.cell)
      && Math.hypot(state.position.x - adjacent.cell.x, state.position.y - adjacent.cell.y) < 0.45);
    assert.ok(containsCell(session.path, adjacent.cell), `${difficulty} crosses its generated open edge`);
    assert.equal(session.diagnostics.blocked, false);
  }
});

test('Steering collision remains a real wall stop and legal redirection resumes without endpoint duplication', () => {
  const route = [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }];
  const maze = mazeWithOpenRoute(route), { controller, session, drive } = steeringHarness(maze, 521);
  drive('S', state => containsCell(state.path, route[1]) && state.position.y > 1.02);
  drive('E', state => containsCell(state.path, route[2]) && state.position.x > 3.02);
  drive('S', state => containsCell(state.path, route[3]) && state.position.y > 2.02);
  const pathBeforeCollision = session.path.map(cell => ({ ...cell }));
  const collisionFrames = drive('E', state => state.diagnostics.blocked, 80);
  assert.ok(collisionFrames.some(result => result.wallCollision && result.reason === 'closed-wall-collision'),
    'the closed east edge is identified as a collision');
  assert.deepEqual(session.path, pathBeforeCollision, 'closed wall does not change the logical route');
  assert.ok(session.position.x <= route[3].x + 0.46 + 1e-9, 'the pencil remains on the legal side of the wall');
  const inkAfterCollision = session.stroke.map(point => ({ ...point }));
  drive('N', state => state.path.at(-1).x === 3 && state.path.at(-1).y === 1 && state.position.y < 1.05, 100);
  assert.deepEqual(session.path.at(-1), route[2], 'the active steering gesture redirects through the open north passage');
  assert.ok(session.stroke.length >= inkAfterCollision.length, 'the old ink remains append-only');
  assert.equal(session.diagnostics.blocked, false, 'a legal frame clears the blocked condition');
  controller.end(521); session.end(521);
});

test('steady steering distance is nearly frame-rate independent at 30 and 60 Hz', () => {
  const at30 = runRate(30), at60 = runRate(60);
  assert.ok(Math.abs(at30 - at60) < 0.015, `30 Hz=${at30}, 60 Hz=${at60}`);
});

test('frame stalls are capped and do not accumulate hidden movement', () => {
  const controller = createSteeringController();
  controller.begin(8, { x: 0, y: 0 }); controller.update(8, { x: 100, y: 0 });
  controller.advance(8, 0);
  const delayed = controller.advance(8, 2000);
  assert.equal(delayed.clamped, true);
  assert.equal(delayed.frameSeconds, DEFAULT_STEERING_SETTINGS.maxFrameSeconds);
  assert.ok(delayed.x <= DEFAULT_STEERING_SETTINGS.maxSpeedMazeUnitsPerSecond * DEFAULT_STEERING_SETTINGS.maxFrameSeconds);
  const next = controller.advance(8, 2016);
  assert.equal(next.frameSeconds, 0.016, 'the suspended interval is not replayed on the next frame');
});

test('lift, cancel, and mismatched pointers stop steering', () => {
  const controller = createSteeringController();
  controller.begin(7, { x: 0, y: 0 });
  assert.equal(controller.update(9, { x: 40, y: 0 }), false);
  assert.equal(controller.end(9), false);
  assert.equal(controller.cancel(7), true);
  assert.equal(controller.active, false);
  assert.equal(controller.advance(7, 1000).active, false);
});

test('Steering is the only gameplay controller and QA diagnostics identify it without an override', async () => {
  const [html, game, css, worker, packageJson] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(html, /qa-input-mode|control-mode|Direct Touch/i);
  assert.match(html, /Control system: Continuous Steering/);
  assert.match(html, /id="qa-active-mode-indicator"[^>]*hidden/);
  assert.doesNotMatch(game, /qaInputModeState|selectQaInputMode|traceSession\.begin\(|traceSession\.move\(/);
  assert.match(game, /traceSession\.beginSteering\(event\.pointerId\)/);
  assert.match(game, /traceSession\.steer\(id, delta\)/);
  assert.match(game, /if \(!event\.isPrimary\)/, 'a second simultaneous pointer cannot start another steering gesture');
  assert.match(game, /activePointerId !== null\) \{ recordTraceEvent\('pointerdown', event, lastRawPointer, false, 'another-pointer-owns-gesture'/);
  assert.match(game, /function makeMaze\(reuse = false\) \{\s*if \(activePointerId !== null\) clearPointer\(\)/,
    'restart and new maze cancel the active controller');
  assert.match(game, /if \(pause\) \{ paused = true; pauseTimer\(\); clearPointer\(\); \}/,
    'pause and its Settings transition stop the controller');
  assert.match(game, /if \(cancel\) traceSession\.cancel\(event\.pointerId\)/,
    'pointercancel and lost capture end steering without movement');
  assert.match(game, /if \(preferences\.zoomAssist && \(activePointerId === null \|\| steeringPointerId !== null\)\) cameraPosition = mazeCamera\.follow\(endpoint\)/,
    'camera follows the logical pencil while steering input remains screen-space');
  assert.match(game, /requestAnimationFrame\(frame\)/);
  assert.match(game, /cancelAnimationFrame\(steeringFrameId\)/);
  assert.match(game, /document\.hidden\) \{ pauseTimer\(\); if \(steeringPointerId !== null\) clearPointer\(\); \}/);
  assert.match(game, /movement\.complete[\s\S]*?endSteeringGesture\(id\)[\s\S]*?completeMaze\(\)/);
  assert.match(css, /\.steering-indicator\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(worker, /\.\/src\/continuous-steering\.js/);
  const steeringSource = await readFile(new URL('../src/continuous-steering.js', import.meta.url), 'utf8');
  assert.match(steeringSource, /maxSpeedMazeUnitsPerSecond: 1\.725/);
  assert.doesNotMatch(steeringSource, /cameraPosition|viewBox/, 'camera updates cannot feed back into steering direction');
  assert.match(packageJson, /continuous-steering\.js/);
});
