import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePath, canMove, createMaze, getWallSegments, isConnected, validateMaze, validatePath } from '../src/maze.js';

test('generated Easy mazes are connected and every wall has a matching neighbor', () => {
  for (let seed = 0; seed < 500; seed++) {
    let value = seed + 1;
    const random = () => { value = (value * 48271) % 2147483647; return value / 2147483647; };
    const maze = createMaze(7, 7, random);
    assert.equal(isConnected(maze), true);
    assert.equal(validateMaze(maze), true);
    assert.deepEqual(maze.entrance, { cell: { x: 0, y: 0 }, side: 'N' });
    assert.deepEqual(maze.exit, { cell: { x: 6, y: 6 }, side: 'S' });
    assert.equal(maze.cells[0][0].walls.N, false);
    assert.equal(maze.cells[6][6].walls.S, false);
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[y][x];
      if (x + 1 < maze.width) assert.equal(cell.walls.E, maze.cells[y][x + 1].walls.W);
      if (y + 1 < maze.height) assert.equal(cell.walls.S, maze.cells[y + 1][x].walls.N);
      if (x === 0) assert.equal(cell.walls.W, true, `seed ${seed}: west boundary`);
      if (x === 6) assert.equal(cell.walls.E, true, `seed ${seed}: east boundary`);
      if (y === 0 && !(x === 0)) assert.equal(cell.walls.N, true, `seed ${seed}: north boundary`);
      if (y === 6 && !(x === 6)) assert.equal(cell.walls.S, true, `seed ${seed}: south boundary`);
    }
    const segments = getWallSegments(maze);
    assert.equal(segments.some(edge => edge.orientation === 'vertical' && edge.x === 0 && edge.y === 0), true, `seed ${seed}: left wall rendered`);
    assert.equal(segments.some(edge => edge.orientation === 'horizontal' && edge.x === 0 && edge.y === 0), false, `seed ${seed}: entrance opening`);
    assert.equal(segments.some(edge => edge.orientation === 'horizontal' && edge.x === 6 && edge.y === 7), false, `seed ${seed}: exit opening`);
    assert.equal(segments.length, new Set(segments.map(edge => `${edge.orientation}:${edge.x},${edge.y}`)).size, `seed ${seed}: wall segments unique`);
  }
});

test('exterior boundaries are complete apart from declared entrance and exit', () => {
  const maze = createMaze(7, 7, () => 0.37);
  const edges = getWallSegments(maze);
  for (let y = 0; y < 7; y++) {
    assert.ok(edges.some(edge => edge.orientation === 'vertical' && edge.x === 0 && edge.y === y));
    assert.ok(edges.some(edge => edge.orientation === 'vertical' && edge.x === 7 && edge.y === y));
  }
  for (let x = 1; x < 7; x++) assert.ok(edges.some(edge => edge.orientation === 'horizontal' && edge.x === x && edge.y === 0));
  for (let x = 0; x < 6; x++) assert.ok(edges.some(edge => edge.orientation === 'horizontal' && edge.x === x && edge.y === 7));
  assert.equal(canMove(maze, maze.start, { x: 0, y: -1 }), false);
  assert.equal(canMove(maze, maze.end, { x: 6, y: 7 }), false);
});

test('canonical rendered internal edge stays blocked when either cell marks a shared wall', () => {
  const maze = createMaze(3, 3, () => 0.5);
  maze.cells[1][0].walls.E = true;
  maze.cells[1][1].walls.W = false;
  assert.equal(canMove(maze, { x: 0, y: 1 }, { x: 1, y: 1 }), false);
  assert.ok(getWallSegments(maze).some(edge => edge.orientation === 'vertical' && edge.x === 1 && edge.y === 1));
  maze.cells[1][0].walls.E = false;
  maze.cells[1][1].walls.W = true;
  assert.equal(canMove(maze, { x: 0, y: 1 }, { x: 1, y: 1 }), false);
  assert.ok(getWallSegments(maze).some(edge => edge.orientation === 'vertical' && edge.x === 1 && edge.y === 1));
});

test('maze dimensions must be valid integers', () => {
  assert.throws(() => createMaze(1, 7), RangeError);
  assert.throws(() => createMaze(5.5, 7), RangeError);
});

test('maze validation rejects mismatched walls and disconnected definitions', () => {
  const maze = createMaze(4, 4, () => 0.5);
  assert.equal(validateMaze(maze), true);
  const broken = structuredClone(maze);
  broken.cells[0][0].walls.E = !broken.cells[0][0].walls.E;
  assert.equal(validateMaze(broken), false);
});

test('path validation rejects jumps, walls, out-of-bounds steps, and wrong starts', () => {
  const maze = { width: 2, height: 2, start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, cells: [
    [{ walls: { N: true, E: false, S: true, W: true } }, { walls: { N: true, E: true, S: true, W: false } }],
    [{ walls: { N: true, E: true, S: true, W: true } }, { walls: { N: true, E: true, S: true, W: true } }],
  ] };
  assert.equal(validatePath(maze, [{ x: 0, y: 0 }, { x: 1, y: 0 }]), true);
  assert.equal(validatePath(maze, [{ x: 0, y: 0 }, { x: 0, y: 1 }]), false);
  assert.equal(validatePath(maze, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
  assert.equal(validatePath(maze, [{ x: 1, y: 0 }]), false);
  assert.equal(canMove(maze, { x: 1, y: 0 }, { x: 2, y: 0 }), false);
});

test('player may backtrack only by retracing the previous route cell', () => {
  const maze = createMaze(4, 4, () => 0.5);
  const a = { x: 0, y: 0 };
  // Find any open first step so this assertion stays independent of generation order.
  const first = [{ x: 1, y: 0 }, { x: 0, y: 1 }].find(p => canMove(maze, a, p));
  const step = advancePath(maze, [a], first);
  assert.equal(step.moved, true);
  const back = advancePath(maze, step.path, a);
  assert.equal(back.moved, true);
  assert.deepEqual(back.path, [a]);
  assert.equal(validatePath(maze, [a, first]), true);
});

test('legal route reaches the exit and only then reports completion', () => {
  const maze = createMaze(3, 3, () => 0.25);
  const queue = [[{ ...maze.start }]], seen = new Set([`${maze.start.x},${maze.start.y}`]);
  let solution;
  while (queue.length) {
    const route = queue.shift(), here = route.at(-1);
    if (here.x === maze.end.x && here.y === maze.end.y) { solution = route; break; }
    for (const next of [{ x: here.x + 1, y: here.y }, { x: here.x - 1, y: here.y }, { x: here.x, y: here.y + 1 }, { x: here.x, y: here.y - 1 }]) {
      const key = `${next.x},${next.y}`;
      if (!seen.has(key) && canMove(maze, here, next)) { seen.add(key); queue.push([...route, next]); }
    }
  }
  assert.ok(solution);
  let path = [solution[0]];
  for (const cell of solution.slice(1)) {
    const result = advancePath(maze, path, cell); path = result.path;
    assert.equal(result.complete, cell.x === maze.end.x && cell.y === maze.end.y);
  }
  assert.deepEqual(path.at(-1), maze.end);
});
