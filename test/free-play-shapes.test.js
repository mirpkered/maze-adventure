import test from 'node:test';
import assert from 'node:assert/strict';
import { canMove, countActiveCells, DIRECTIONS, getMaskBoundaryEdges, getShortestPath, getWallSegments, inBounds, validateMaze } from '../src/maze.js';
import { createTraceSession } from '../src/tracing.js';
import { SHAPE_REGISTRY, chooseSurpriseShape, createShapeRoute, getPlayableShapes } from '../src/shapes.js';
import { validateShapedMaze } from '../src/shaped-mazes.js';

const ids = ['castle', 'circle', 'heart', 'star', 'diamond', 'cross', 'arrow', 'key', 'dj-penguin'];
function seeded(seed) {
  let value = seed + 1;
  return () => { value = value * 48271 % 2147483647; return value / 2147483647; };
}

test('the playable registry contains only the nine implemented, validated shape identities', () => {
  assert.deepEqual(SHAPE_REGISTRY.map(shape => shape.id), ids);
  assert.deepEqual(getPlayableShapes().map(shape => shape.id), ids);
  assert.ok(SHAPE_REGISTRY.every(shape => shape.availability === 'playable' && shape.validated));
});

test('Surprise Me samples only registered playable shapes and supports deterministic selection', () => {
  for (let index = 0; index < ids.length; index++) {
    assert.equal(chooseSurpriseShape(SHAPE_REGISTRY, () => index / ids.length).id, ids[index]);
  }
  assert.equal(chooseSurpriseShape([], () => 0), null);
  assert.equal(chooseSurpriseShape([SHAPE_REGISTRY[0]], () => 0.99).id, SHAPE_REGISTRY[0].id, 'a one-shape registry remains eligible');
  const unavailable = { ...SHAPE_REGISTRY[0], availability: 'coming-soon' };
  const unaudited = { ...SHAPE_REGISTRY[1], validated: false };
  assert.deepEqual(getPlayableShapes([unavailable, unaudited]), [], 'unavailable and unaudited concepts are excluded');
  assert.equal(chooseSurpriseShape([unavailable, unaudited], () => 0), null, 'no unplayable concept is selected');
  const counts = new Map(ids.map(id => [id, 0]));
  const distribution = seeded(531);
  for (let sample = 0; sample < 9000; sample++) {
    const shape = chooseSurpriseShape(SHAPE_REGISTRY, distribution);
    counts.set(shape.id, counts.get(shape.id) + 1);
  }
  for (const count of counts.values()) assert.ok(count > 850 && count < 1150);
});

test('shape routes preserve identity independently from Classic difficulty', () => {
  assert.deepEqual(createShapeRoute('castle', SHAPE_REGISTRY, 'chosen'), { category: 'shaped', shapeId: 'castle', selectionMode: 'chosen' });
  assert.deepEqual(createShapeRoute('dj-penguin', SHAPE_REGISTRY, 'surprise'), { category: 'shaped', shapeId: 'dj-penguin', selectionMode: 'surprise' });
  assert.equal(createShapeRoute('missing-shape'), null);
  assert.equal(createShapeRoute('castle', SHAPE_REGISTRY, 'difficulty'), null);
});

test('all masks are connected and generated mazes keep inactive cells outside collision and rendering geometry', () => {
  for (const shape of SHAPE_REGISTRY) {
    const mask = shape.geometryProvider(), maze = shape.generator(seeded(71), 71, 'chosen');
    assert.ok(mask.length >= 15 && mask[0].length >= 15, `${shape.id}: recognizable mask resolution`);
    assert.equal(validateMaze(maze), true, `${shape.id}: canonical maze validates`);
    assert.equal(validateShapedMaze(maze, shape), true, `${shape.id}: shape adapter validates`);
    assert.equal(countActiveCells(maze), maze.activeCellCount);
    const openings = [maze.entrance, maze.exit];
    for (const edge of getMaskBoundaryEdges(maze)) {
      const cell = maze.cells[edge.cell.y][edge.cell.x];
      const intentional = openings.some(opening => opening.cell.x === edge.cell.x && opening.cell.y === edge.cell.y && opening.side === edge.side);
      assert.equal(cell.walls[edge.side], !intentional, `${shape.id}: boundary ${edge.cell.x},${edge.cell.y},${edge.side}`);
      assert.equal(canMove(maze, edge.cell, { x: edge.cell.x + DIRECTIONS.find(d => d.name === edge.side).dx, y: edge.cell.y + DIRECTIONS.find(d => d.name === edge.side).dy }), false, `${shape.id}: outside mask is never traversable`);
    }
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
      if (!mask[y][x]) { assert.equal(inBounds(maze, { x, y }), false); assert.equal(maze.cells[y][x], null); continue; }
      for (const direction of DIRECTIONS) {
        const next = { x: x + direction.dx, y: y + direction.dy };
        if (inBounds(maze, next)) assert.equal(maze.cells[y][x].walls[direction.name], maze.cells[next.y][next.x].walls[direction.opposite]);
      }
    }
    const walls = getWallSegments(maze);
    assert.equal(walls.length, new Set(walls.map(wall => `${wall.orientation}:${wall.x},${wall.y}`)).size, `${shape.id}: visible wall geometry is deduplicated`);
  }
});

test('every registered shaped maze uses the shared tracer and completes only after outward exit crossing', () => {
  for (const [index, shape] of SHAPE_REGISTRY.entries()) {
    const maze = shape.generator(seeded(100 + index), 100 + index, 'chosen');
    const solution = getShortestPath(maze);
    assert.ok(solution && solution.length - 1 >= maze.qualityConstraints.minimumSolutionLength);
    assert.equal(maze.generationQuality.exitInternalDegree, 1);
    assert.equal(maze.generationQuality.exitGatedCells, 0);
    const trace = createTraceSession(maze);
    assert.equal(trace.beginSteering(1), true);
    for (let step = 1; step < solution.length; step++) {
      const delta = { x: solution[step].x - solution[step - 1].x, y: solution[step].y - solution[step - 1].y };
      const result = trace.steer(1, delta);
      assert.equal(result.blocked, false, `${shape.id}: route edge ${step} remains traceable`);
      assert.equal(result.complete, false, `${shape.id}: entering exit cell is not completion`);
    }
    assert.equal(trace.diagnostics.currentlyInExitCell, true);
    assert.equal(trace.diagnostics.completionCommitted, false);
    const outward = maze.exit.side === 'N' ? { x: 0, y: -0.9 } : maze.exit.side === 'E' ? { x: 0.9, y: 0 }
      : maze.exit.side === 'S' ? { x: 0, y: 0.9 } : { x: -0.9, y: 0 };
    const completed = trace.steer(1, outward);
    assert.equal(completed.complete, true, `${shape.id}: designated opening completes`);
    assert.equal(trace.diagnostics.completionCommitted, true);
    assert.equal(trace.diagnostics.exitSide, maze.exit.side);
    assert.equal(trace.strokeBreaks.length, 0, `${shape.id}: completed route has no invented connector`);
    assert.ok(Math.hypot(trace.stroke.at(-1).x - maze.end.x, trace.stroke.at(-1).y - maze.end.y) > 0.5, `${shape.id}: finish ink crosses the mask boundary`);
  }
});
