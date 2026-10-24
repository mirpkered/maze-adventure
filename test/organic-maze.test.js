import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrganicCircleMaze, getOrganicSolutionPolyline, organicPointToSvg, organicWallGeometry, validateOrganicMaze } from '../src/organic-maze.js';
import { createTraceSession } from '../src/tracing.js';
import { SHAPE_REGISTRY, chooseSurpriseShape, getPlayableShapes } from '../src/shapes.js';

function replayTo(session, points, lastIndex) {
  for (let index = 1; index <= lastIndex; index++) {
    const point = points[index];
    const result = session.steer(7, { x: point.x - session.position.x, y: point.y - session.position.y });
    if (result.complete || result.blocked) return { index, result };
  }
  return { index: lastIndex, result: null };
}

test('organic circle generation is seeded, connected, valid, and varies between seeds', () => {
  const first = createOrganicCircleMaze({ seed: 122 });
  const repeated = createOrganicCircleMaze({ seed: 122 });
  const another = createOrganicCircleMaze({ seed: 123 });
  assert.equal(first.layoutFingerprint, repeated.layoutFingerprint);
  assert.deepEqual(first.solutionNodePath, repeated.solutionNodePath);
  assert.deepEqual(first.edges.map(edge => edge.points), repeated.edges.map(edge => edge.points));
  assert.notEqual(first.layoutFingerprint, another.layoutFingerprint);
  for (const maze of [first, repeated, another]) {
    assert.equal(validateOrganicMaze(maze), true);
    assert.equal(maze.nodes.length, 16);
    assert.ok(maze.edges.length >= 18, 'the maze has a safe reconnection in addition to its tree and portals');
    assert.equal(maze.edges.length - 2, maze.nodes.length, 'the internal passage graph contains a genuine reconnecting loop');
    assert.equal(maze.quality.exitInternalDegree, 1);
    assert.equal(maze.quality.exitGatedCells, 0);
    assert.ok(maze.quality.solutionLength >= 2.35);
    assert.ok(maze.quality.meaningfulDecisions >= 2);
    assert.ok(maze.quality.branchCount >= 4);
    assert.ok(maze.generationAttempts <= 96);
  }
});

test('organic route replays through the authoritative geometry tracer and finishes only outside the declared portal', () => {
  for (let seed = 0; seed < 16; seed++) {
    const maze = createOrganicCircleMaze({ seed });
    const solution = getOrganicSolutionPolyline(maze);
    const session = createTraceSession(maze);
    assert.equal(session.beginSteering(7), true);
    let completedAt = -1;
    for (let index = 1; index < solution.length; index++) {
      const point = solution[index];
      const result = session.steer(7, { x: point.x - session.position.x, y: point.y - session.position.y });
      assert.equal(result.blocked, false, `seed ${seed}, sample ${index}: ${result.reason}`);
      if (result.complete) { completedAt = index; break; }
      assert.equal(session.diagnostics.completionCommitted, false, `seed ${seed} completed before the outward crossing`);
      assert.equal(maze.geometry.isLegalPoint(session.position), true);
    }
    assert.ok(completedAt > solution.length - 14, `seed ${seed} completion was not at the final portal`);
    assert.equal(session.diagnostics.completionCommitted, true);
    assert.equal(session.diagnostics.completionReason, 'designated-organic-exit-crossing');
    assert.ok(Math.hypot(session.position.x - maze.exit.outside.x, session.position.y - maze.exit.outside.y) < 1e-8);
    const inkAtCompletion = session.stroke.length;
    assert.equal(session.steer(7, { x: 0.3, y: 0.3 }).complete, false);
    assert.equal(session.stroke.length, inkAtCompletion);
  }
});

test('curved wall sweeps stop at the legal boundary and allow redirection without lifting', () => {
  const maze = createOrganicCircleMaze({ seed: 81 });
  const solution = getOrganicSolutionPolyline(maze);
  const middle = Math.floor(solution.length / 2);
  const session = createTraceSession(maze);
  session.beginSteering(7);
  const reached = replayTo(session, solution, middle);
  assert.equal(reached.result, null);
  const here = session.position;
  const beforeInk = session.stroke.length;
  let blocked = null;
  for (const offset of [0.16, -0.16]) {
    const target = { x: here.x - offset, y: here.y + offset };
    if (Math.hypot(target.x, target.y) < maze.geometry.radius - 0.05 && !maze.geometry.isLegalPoint(target)) {
      const result = session.steer(7, { x: target.x - here.x, y: target.y - here.y });
      if (result.blocked) { blocked = result; break; }
    }
  }
  assert.ok(blocked, 'expected an attempted move through the nearby curved wall to stop');
  assert.equal(blocked.wallCollision, true);
  assert.equal(maze.geometry.isLegalPoint(session.position), true);
  assert.ok(session.stroke.length >= beforeInk);
  const next = solution[middle - 1];
  const redirected = session.steer(7, { x: next.x - session.position.x, y: next.y - session.position.y });
  assert.equal(redirected.blocked, false);
  assert.equal(maze.geometry.isLegalPoint(session.position), true);
  assert.equal(session.active, true);
});

test('large movement cannot tunnel through the outer wall or complete at the entrance', () => {
  const maze = createOrganicCircleMaze({ seed: 43 });
  const session = createTraceSession(maze);
  session.beginSteering(3);
  const outward = maze.entrance.position;
  const length = Math.hypot(outward.x, outward.y);
  const direction = { x: outward.x / length, y: outward.y / length };
  const result = session.steer(3, { x: direction.x * 0.5, y: direction.y * 0.5 });
  assert.equal(result.complete, false);
  assert.equal(result.blocked, true);
  assert.equal(session.diagnostics.completionCommitted, false);
  assert.equal(maze.geometry.isLegalPoint(session.position), true);
  assert.ok(Math.hypot(session.position.x, session.position.y) <= maze.geometry.radius + 1e-8);
});

test('organic backtracking retains append-only ink and gesture cancellation releases steering', () => {
  const maze = createOrganicCircleMaze({ seed: 59 }), solution = getOrganicSolutionPolyline(maze);
  const session = createTraceSession(maze);
  session.beginSteering(4);
  const midpoint = Math.floor(solution.length * 0.42);
  replayTo(session, solution, midpoint);
  const inkLength = session.stroke.length, before = session.position;
  for (let index = midpoint - 1; index > midpoint - 8; index--) {
    const point = solution[index];
    session.steer(4, { x: point.x - session.position.x, y: point.y - session.position.y });
  }
  assert.ok(session.stroke.length >= inkLength);
  assert.notDeepEqual(session.position, before);
  assert.equal(session.cancel(4), true);
  assert.equal(session.active, false);
  assert.equal(session.steer(4, { x: 0.2, y: 0 }).moved, false);
  assert.equal(session.beginSteering(5), true);
  assert.equal(session.active, true);
});

test('organic SVG geometry has curved walls and a consistent world-to-viewBox map', () => {
  const maze = createOrganicCircleMaze({ seed: 211 }), render = organicWallGeometry(maze);
  assert.equal(render.boundaries.length, 2);
  assert.ok(render.walls.length >= maze.edges.length * 2);
  assert.ok(render.walls.some(path => /[Ll]/.test(path)));
  assert.deepEqual(organicPointToSvg({ x: 0, y: 0 }), { x: 200, y: 200 });
  assert.ok(render.entrance.x >= 0 && render.entrance.x <= 400);
  assert.ok(render.exit.y >= 0 && render.exit.y <= 400);
});

test('organic Circle remains QA-only and excluded from public shape selection', () => {
  assert.equal(getPlayableShapes().some(shape => shape.id === 'organic-circle'), false);
  assert.equal(chooseSurpriseShape(SHAPE_REGISTRY, () => 0).id, 'castle');
  assert.equal(SHAPE_REGISTRY.length, 9);
});
