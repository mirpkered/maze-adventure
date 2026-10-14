import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePath, canMove, createMaze, createMazeForDifficulty, getWallSegments, isConnected, validateMaze, validatePath } from '../src/maze.js';
import { mazeLayoutId } from '../src/trace-diagnostics.js';

function seeded(seed) {
  let value = seed + 1;
  return () => { value = (value * 48271) % 2147483647; return value / 2147483647; };
}

function navigationStats(maze) {
  let junctions = 0, deadEnds = 0, longestDeadEndBranch = 0;
  const degree = cell => [
    { x: cell.x, y: cell.y - 1 }, { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 }, { x: cell.x - 1, y: cell.y },
  ].filter(next => canMove(maze, cell, next)).length;
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const cell = { x, y }, count = degree(cell);
    if (count >= 3) junctions++;
    if (count !== 1) continue;
    deadEnds++;
    let previous = null, current = cell, branchLength = 0;
    while (true) {
      branchLength++;
      const neighbors = [
        { x: current.x, y: current.y - 1 }, { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y + 1 }, { x: current.x - 1, y: current.y },
      ].filter(next => canMove(maze, current, next));
      const next = neighbors.find(candidate => !previous || candidate.x !== previous.x || candidate.y !== previous.y);
      if (!next || degree(next) !== 2) break;
      previous = current;
      current = next;
    }
    longestDeadEndBranch = Math.max(longestDeadEndBranch, branchLength);
  }
  return { junctions, deadEnds, longestDeadEndBranch };
}

test('generated Easy mazes are connected and every wall has a matching neighbor', () => {
  for (let seed = 0; seed < 500; seed++) {
    const maze = createMaze(7, 7, seeded(seed));
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

test('Easy and Medium Free Play sizes stay stable and Medium offers more varied decisions', () => {
  const sampleCount = 256, easyStats = [], mediumStats = [], mediumLayouts = new Set();
  for (let seed = 0; seed < sampleCount; seed++) {
    const easy = createMazeForDifficulty('easy', seeded(seed));
    const medium = createMazeForDifficulty('medium', seeded(seed));
    assert.equal(easy.width, 7); assert.equal(easy.height, 7);
    assert.equal(medium.width, 10); assert.equal(medium.height, 10);
    assert.equal(easy.difficulty, 'easy'); assert.equal(medium.difficulty, 'medium');
    assert.equal(isConnected(medium), true, `medium seed ${seed} remains solvable`);
    assert.equal(validateMaze(medium), true, `medium seed ${seed} has reciprocal walls and valid boundaries`);
    assert.deepEqual(medium.entrance, { cell: { x: 0, y: 0 }, side: 'N' });
    assert.deepEqual(medium.exit, { cell: { x: 9, y: 9 }, side: 'S' });
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const cell = medium.cells[y][x];
      if (x < 9) assert.equal(cell.walls.E, medium.cells[y][x + 1].walls.W);
      if (y < 9) assert.equal(cell.walls.S, medium.cells[y + 1][x].walls.N);
    }
    const walls = getWallSegments(medium);
    for (let y = 0; y < 10; y++) {
      assert.ok(walls.some(edge => edge.orientation === 'vertical' && edge.x === 0 && edge.y === y));
      assert.ok(walls.some(edge => edge.orientation === 'vertical' && edge.x === 10 && edge.y === y));
    }
    for (let x = 1; x < 10; x++) assert.ok(walls.some(edge => edge.orientation === 'horizontal' && edge.x === x && edge.y === 0));
    for (let x = 0; x < 9; x++) assert.ok(walls.some(edge => edge.orientation === 'horizontal' && edge.x === x && edge.y === 10));
    assert.ok(!walls.some(edge => edge.orientation === 'horizontal' && edge.x === 0 && edge.y === 0), `medium seed ${seed}: entrance opening`);
    assert.ok(!walls.some(edge => edge.orientation === 'horizontal' && edge.x === 9 && edge.y === 10), `medium seed ${seed}: exit opening`);
    const stats = navigationStats(medium);
    assert.ok(stats.junctions >= 4, `medium seed ${seed}: has multiple decision junctions`);
    assert.ok(stats.deadEnds >= 6, `medium seed ${seed}: offers believable wrong turns`);
    mediumStats.push(stats); easyStats.push(navigationStats(easy));
    mediumLayouts.add(mazeLayoutId(medium));
  }
  const mean = (items, key) => items.reduce((sum, item) => sum + item[key], 0) / items.length;
  assert.ok(mean(mediumStats, 'junctions') >= mean(easyStats, 'junctions') * 1.7,
    'the larger Medium maze presents substantially more junction decisions');
  assert.ok(mean(mediumStats, 'deadEnds') >= mean(easyStats, 'deadEnds') * 1.5,
    'the larger Medium maze includes substantially more wrong-turn endpoints');
  assert.ok(mean(mediumStats, 'longestDeadEndBranch') > mean(easyStats, 'longestDeadEndBranch'),
    'Medium includes longer dead-end branches on average');
  assert.equal(mediumLayouts.size, sampleCount, 'seeded Medium layouts retain variation');
  assert.equal(mazeLayoutId(createMazeForDifficulty('easy', seeded(33))), mazeLayoutId(createMaze(7, 7, seeded(33))),
    'Easy keeps the original generator topology for the same random stream');
  assert.throws(() => createMazeForDifficulty('hard'), RangeError, 'Hard is not enabled');
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
