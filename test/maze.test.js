import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePath, canMove, createMaze, createMazeForDifficulty, getShortestPath, getWallSegments, isConnected, validateMaze, validatePath } from '../src/maze.js';
import { mazeLayoutId } from '../src/trace-diagnostics.js';

function seeded(seed) {
  let value = seed + 1;
  return () => { value = (value * 48271) % 2147483647; return value / 2147483647; };
}

function navigationStats(maze) {
  let junctions = 0, deadEnds = 0, longestDeadEndBranch = 0, deepDeadEnds = 0;
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
    if (branchLength >= 4) deepDeadEnds++;
  }
  return { junctions, deadEnds, longestDeadEndBranch, deepDeadEnds };
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor((ordered.length - 1) * fraction)];
}

test('generated Easy mazes are connected and every wall has a matching neighbor', () => {
  const startEdges = new Map(), finishEdges = new Map();
  for (let seed = 0; seed < 500; seed++) {
    const maze = createMaze(7, 7, seeded(seed));
    assert.equal(isConnected(maze), true);
    assert.equal(validateMaze(maze), true);
    assert.deepEqual(maze.start, maze.entrance.cell);
    assert.deepEqual(maze.end, maze.exit.cell);
    assert.notDeepEqual(maze.start, maze.end);
    startEdges.set(maze.entrance.side, (startEdges.get(maze.entrance.side) ?? 0) + 1);
    finishEdges.set(maze.exit.side, (finishEdges.get(maze.exit.side) ?? 0) + 1);
    const solutionLength = getShortestPath(maze).length - 1;
    assert.ok(solutionLength >= 18, `seed ${seed}: Easy solution is meaningfully long`);
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[y][x];
      if (x + 1 < maze.width) assert.equal(cell.walls.E, maze.cells[y][x + 1].walls.W);
      if (y + 1 < maze.height) assert.equal(cell.walls.S, maze.cells[y + 1][x].walls.N);
      for (const side of ['N', 'E', 'S', 'W']) {
        const onBoundary = side === 'N' ? y === 0 : side === 'S' ? y === 6 : side === 'W' ? x === 0 : x === 6;
        if (!onBoundary) continue;
        const isOpening = [maze.entrance, maze.exit].some(opening => opening.side === side && opening.cell.x === x && opening.cell.y === y);
        assert.equal(cell.walls[side], !isOpening, `seed ${seed}: ${side} boundary agrees with declared openings`);
      }
    }
    const segments = getWallSegments(maze);
    for (const opening of [maze.entrance, maze.exit]) {
      const key = opening.side === 'N' ? { orientation: 'horizontal', x: opening.cell.x, y: 0 }
        : opening.side === 'S' ? { orientation: 'horizontal', x: opening.cell.x, y: 7 }
          : opening.side === 'W' ? { orientation: 'vertical', x: 0, y: opening.cell.y }
            : { orientation: 'vertical', x: 7, y: opening.cell.y };
      assert.equal(segments.some(segment => segment.orientation === key.orientation && segment.x === key.x && segment.y === key.y), false, `seed ${seed}: ${opening.side} opening is absent from rendered walls`);
    }
    assert.equal(segments.length, new Set(segments.map(edge => `${edge.orientation}:${edge.x},${edge.y}`)).size, `seed ${seed}: wall segments unique`);
  }
  for (const side of ['N', 'E', 'S', 'W']) {
    assert.ok(startEdges.get(side) > 50, `starts use the ${side} edge throughout the sample`);
    assert.ok(finishEdges.get(side) > 50, `finishes use the ${side} edge throughout the sample`);
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
    assert.deepEqual(medium.start, medium.entrance.cell);
    assert.deepEqual(medium.end, medium.exit.cell);
    assert.ok(getShortestPath(medium).length - 1 >= 28, `medium seed ${seed}: solution length meets its difficulty floor`);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const cell = medium.cells[y][x];
      if (x < 9) assert.equal(cell.walls.E, medium.cells[y][x + 1].walls.W);
      if (y < 9) assert.equal(cell.walls.S, medium.cells[y + 1][x].walls.N);
    }
    const walls = getWallSegments(medium);
    for (let y = 0; y < 10; y++) {
      assert.equal(walls.some(edge => edge.orientation === 'vertical' && edge.x === 0 && edge.y === y), ![medium.entrance, medium.exit].some(port => port.side === 'W' && port.cell.y === y));
      assert.equal(walls.some(edge => edge.orientation === 'vertical' && edge.x === 10 && edge.y === y), ![medium.entrance, medium.exit].some(port => port.side === 'E' && port.cell.y === y));
    }
    for (const opening of [medium.entrance, medium.exit]) {
      const key = opening.side === 'N' ? { orientation: 'horizontal', x: opening.cell.x, y: 0 }
        : opening.side === 'S' ? { orientation: 'horizontal', x: opening.cell.x, y: 10 }
          : opening.side === 'W' ? { orientation: 'vertical', x: 0, y: opening.cell.y }
            : { orientation: 'vertical', x: 10, y: opening.cell.y };
      assert.ok(!walls.some(edge => edge.orientation === key.orientation && edge.x === key.x && edge.y === key.y), `medium seed ${seed}: declared opening is absent from rendered walls`);
    }
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
});

test('Hard meets seeded path and navigation quality targets on 256 deterministic mazes', () => {
  const sampleCount = 256, metrics = [], layouts = new Set();
  const starts = Object.fromEntries(['N', 'E', 'S', 'W'].map(side => [side, 0]));
  const finishes = Object.fromEntries(['N', 'E', 'S', 'W'].map(side => [side, 0]));
  let totalAttempts = 0;
  for (let seed = 0; seed < sampleCount; seed++) {
    const maze = createMazeForDifficulty('hard', seeded(seed));
    const route = getShortestPath(maze), routeStats = navigationStats(maze);
    assert.equal(maze.width, 15); assert.equal(maze.height, 15);
    assert.equal(maze.difficulty, 'hard');
    assert.equal(validateMaze(maze), true, `Hard seed ${seed} is connected, reciprocal, and boundary-valid`);
    assert.ok(route && route.length - 1 >= 42, `Hard seed ${seed} meets the 42-edge minimum`);
    assert.equal(maze.start.x, maze.entrance.cell.x); assert.equal(maze.start.y, maze.entrance.cell.y);
    assert.equal(maze.end.x, maze.exit.cell.x); assert.equal(maze.end.y, maze.exit.cell.y);
    assert.notDeepEqual(maze.start, maze.end);
    const renderedWalls = getWallSegments(maze);
    for (const opening of [maze.entrance, maze.exit]) {
      const expected = opening.side === 'N' ? { orientation: 'horizontal', x: opening.cell.x, y: 0 }
        : opening.side === 'S' ? { orientation: 'horizontal', x: opening.cell.x, y: 15 }
          : opening.side === 'W' ? { orientation: 'vertical', x: 0, y: opening.cell.y }
            : { orientation: 'vertical', x: 15, y: opening.cell.y };
      assert.ok(!renderedWalls.some(wall => wall.orientation === expected.orientation && wall.x === expected.x && wall.y === expected.y),
        `Hard seed ${seed}: entrance and exit openings match rendered geometry`);
    }
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
      const cell = maze.cells[y][x];
      if (x < 14) assert.equal(cell.walls.E, maze.cells[y][x + 1].walls.W, `Hard seed ${seed} reciprocal east/west wall`);
      if (y < 14) assert.equal(cell.walls.S, maze.cells[y + 1][x].walls.N, `Hard seed ${seed} reciprocal north/south wall`);
    }
    starts[maze.entrance.side]++; finishes[maze.exit.side]++;
    totalAttempts += maze.generationAttempts;
    layouts.add(mazeLayoutId(maze));
    metrics.push({ length: route.length - 1, ...routeStats,
      routeJunctions: route.slice(1, -1).filter(cell => [
        { x: cell.x, y: cell.y - 1 }, { x: cell.x + 1, y: cell.y },
        { x: cell.x, y: cell.y + 1 }, { x: cell.x - 1, y: cell.y },
      ].filter(next => canMove(maze, cell, next)).length >= 3).length });
    assert.ok(maze.generationAttempts >= 1 && maze.generationAttempts <= 8, `Hard seed ${seed} stays within the retry bound`);
  }
  assert.ok(percentile(metrics.map(item => item.length), .1) >= 42, 'P10 solution is at least 42 edges');
  assert.ok(percentile(metrics.map(item => item.length), .5) >= 50, 'median solution is at least 50 edges');
  assert.ok(percentile(metrics.map(item => item.junctions), .5) >= 18, 'median maze has at least 18 junctions');
  assert.ok(percentile(metrics.map(item => item.deadEnds), .5) >= 18, 'median maze has at least 18 dead ends');
  assert.ok(percentile(metrics.map(item => item.routeJunctions), .5) >= 6, 'median solution passes at least 6 junctions');
  assert.ok(percentile(metrics.map(item => item.deepDeadEnds), .5) >= 3, 'median maze has at least 3 dead ends with four or more cells before a junction');
  assert.equal(layouts.size, sampleCount, 'all deterministic seeds produce distinct Hard layouts');
  for (const side of ['N', 'E', 'S', 'W']) {
    assert.ok(starts[side] >= 30, `Hard starts are distributed across ${side}`);
    assert.ok(finishes[side] >= 30, `Hard finishes are distributed across ${side}`);
  }
  assert.ok(totalAttempts <= sampleCount * 8, 'the quality search has a strict maximum of eight generated candidates per maze');
});

test('Easy, Medium, and Hard use terminal exits with zero exit-gated cells across 500 seeds each', () => {
  const samples = 500;
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const maxAttempts = difficulty === 'hard' ? 8 : 32;
    for (let seed = 0; seed < samples; seed++) {
      const maze = createMazeForDifficulty(difficulty, seeded(seed));
      const exitDegree = [
        { x: maze.end.x, y: maze.end.y - 1 }, { x: maze.end.x + 1, y: maze.end.y },
        { x: maze.end.x, y: maze.end.y + 1 }, { x: maze.end.x - 1, y: maze.end.y },
      ].filter(next => canMove(maze, maze.end, next)).length;
      assert.equal(exitDegree, 1, `${difficulty} seed ${seed}: exit is a terminal cell`);
      assert.equal(isConnected(maze), true, `${difficulty} seed ${seed}: generated graph is connected`);
      assert.equal(validateMaze(maze), true, `${difficulty} seed ${seed}: walls and completion route validate`);
      const route = getShortestPath(maze);
      assert.ok(route && route.at(-1).x === maze.end.x && route.at(-1).y === maze.end.y,
        `${difficulty} seed ${seed}: solution reaches the selected exit`);
      if (difficulty === 'hard') {
        const routeJunctions = route.slice(1, -1).filter(cell => [
          { x: cell.x, y: cell.y - 1 }, { x: cell.x + 1, y: cell.y },
          { x: cell.x, y: cell.y + 1 }, { x: cell.x - 1, y: cell.y },
        ].filter(next => canMove(maze, cell, next)).length >= 3).length;
        assert.ok(routeJunctions >= 6, `Hard seed ${seed}: route keeps the six-junction minimum`);
      }
      let logicalRoute = [{ ...maze.start }];
      for (const [index, cell] of route.slice(1).entries()) {
        const result = advancePath(maze, logicalRoute, cell);
        assert.equal(result.moved, true, `${difficulty} seed ${seed}: completion path step ${index + 1} is legal`);
        assert.equal(result.complete, index === route.length - 2,
          `${difficulty} seed ${seed}: completion occurs only on the final exit step`);
        logicalRoute = result.path;
      }
      assert.ok(maze.generationAttempts >= 1 && maze.generationAttempts <= maxAttempts,
        `${difficulty} seed ${seed}: generation stays within its retry bound`);
    }
  }
});

test('endpoint arrangements vary across every edge while staying distinct, non-cornered, and graph-distant', () => {
  const edgeNames = ['N', 'E', 'S', 'W'], startCounts = Object.fromEntries(edgeNames.map(side => [side, 0]));
  const finishCounts = Object.fromEntries(edgeNames.map(side => [side, 0]));
  const arrangements = new Set();
  for (let seed = 0; seed < 1000; seed++) {
    const difficulty = seed % 2 ? 'easy' : 'medium';
    const maze = createMazeForDifficulty(difficulty, seeded(seed));
    const path = getShortestPath(maze);
    const minimum = difficulty === 'easy' ? 18 : 28;
    assert.ok(path && path.length - 1 >= minimum, `${difficulty} seed ${seed} meets the shortest-path floor`);
    assert.notDeepEqual(maze.start, maze.end);
    for (const opening of [maze.entrance, maze.exit]) {
      assert.ok(opening.cell.x > 0 && opening.cell.x < maze.width - 1 || opening.cell.y > 0 && opening.cell.y < maze.height - 1,
        `seed ${seed}: endpoint does not occupy a corner`);
    }
    startCounts[maze.entrance.side]++;
    finishCounts[maze.exit.side]++;
    arrangements.add(`${maze.entrance.side}-${maze.exit.side}`);
  }
  for (const side of edgeNames) {
    assert.ok(startCounts[side] >= 100, `start edge ${side} receives broad representation`);
    assert.ok(finishCounts[side] >= 100, `finish edge ${side} receives broad representation`);
  }
  assert.ok([...arrangements].some(pair => { const [a, b] = pair.split('-'); return a === b; }), 'same-edge arrangements occur');
  assert.ok([...arrangements].some(pair => { const [a, b] = pair.split('-'); return Math.abs(edgeNames.indexOf(a) - edgeNames.indexOf(b)) === 2; }), 'opposite-edge arrangements occur');
  assert.ok([...arrangements].some(pair => { const [a, b] = pair.split('-'); const delta = Math.abs(edgeNames.indexOf(a) - edgeNames.indexOf(b)); return delta === 1 || delta === 3; }), 'adjacent-edge arrangements occur');
});

test('exterior boundaries are complete apart from declared entrance and exit', () => {
  const maze = createMaze(7, 7, seeded(0));
  const edges = getWallSegments(maze);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const cell = maze.cells[y][x];
      for (const side of ['N', 'E', 'S', 'W']) {
        const onBoundary = side === 'N' ? y === 0 : side === 'S' ? y === 6 : side === 'W' ? x === 0 : x === 6;
        if (!onBoundary) continue;
        const opening = [maze.entrance, maze.exit].some(port => port.side === side && port.cell.x === x && port.cell.y === y);
        assert.equal(cell.walls[side], !opening);
        const segment = side === 'N' ? { orientation: 'horizontal', x, y: 0 }
          : side === 'S' ? { orientation: 'horizontal', x, y: 7 }
            : side === 'W' ? { orientation: 'vertical', x: 0, y }
              : { orientation: 'vertical', x: 7, y };
        assert.equal(edges.some(edge => edge.orientation === segment.orientation && edge.x === segment.x && edge.y === segment.y), !opening,
          `${side} exterior SVG edge must match its canonical wall bit`);
      }
    }
  }
  const outside = { x: maze.entrance.side === 'W' ? -1 : maze.entrance.side === 'E' ? maze.width : maze.start.x,
    y: maze.entrance.side === 'N' ? -1 : maze.entrance.side === 'S' ? maze.height : maze.start.y };
  assert.equal(canMove(maze, maze.start, outside), false,
    'an exterior opening never creates an out-of-domain graph edge');
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
  const a = { ...maze.start };
  // Find any open first step so this assertion stays independent of generation order.
  const first = [{ x: a.x + 1, y: a.y }, { x: a.x - 1, y: a.y }, { x: a.x, y: a.y + 1 }, { x: a.x, y: a.y - 1 }]
    .find(p => canMove(maze, a, p));
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
