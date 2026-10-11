import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePath, canMove, createMaze, isConnected, validateMaze, validatePath } from '../src/maze.js';

test('generated Easy mazes are connected and every wall has a matching neighbor', () => {
  for (let seed = 0; seed < 40; seed++) {
    let value = seed + 1;
    const random = () => { value = (value * 48271) % 2147483647; return value / 2147483647; };
    const maze = createMaze(7, 7, random);
    assert.equal(isConnected(maze), true);
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[y][x];
      if (x + 1 < maze.width) assert.equal(cell.walls.E, maze.cells[y][x + 1].walls.W);
      if (y + 1 < maze.height) assert.equal(cell.walls.S, maze.cells[y + 1][x].walls.N);
    }
  }
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
