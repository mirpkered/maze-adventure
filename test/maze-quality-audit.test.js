import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMazeQuality, runMazeQualityAudit } from '../scripts/maze-quality-audit.mjs';

function mazeFromEdges(width, height, edges, start, end) {
  const cells = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ({ x, y, walls: { N: true, E: true, S: true, W: true } })));
  const sides = { '0,-1': ['N', 'S'], '1,0': ['E', 'W'], '0,1': ['S', 'N'], '-1,0': ['W', 'E'] };
  for (const [a, b] of edges) {
    const dx = b.x - a.x, dy = b.y - a.y, [side, opposite] = sides[`${dx},${dy}`];
    cells[a.y][a.x].walls[side] = false;
    cells[b.y][b.x].walls[opposite] = false;
  }
  return { width, height, cells, start, end };
}

test('exit-gated count excludes the exit cell and splits gated regions on the graph', () => {
  const maze = mazeFromEdges(3, 2, [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }], // start to exit
    [{ x: 1, y: 0 }, { x: 2, y: 0 }],
    [{ x: 1, y: 0 }, { x: 1, y: 1 }],
    [{ x: 1, y: 1 }, { x: 0, y: 1 }],
    [{ x: 1, y: 1 }, { x: 2, y: 1 }],
  ], { x: 0, y: 0 }, { x: 1, y: 0 });
  const before = JSON.stringify(maze);
  const result = analyzeMazeQuality(maze);
  assert.equal(JSON.stringify(maze), before, 'analysis leaves the maze definition unchanged');
  assert.equal(result.totalTraversableCells, 6);
  assert.equal(result.fullReachableCells, 6);
  assert.equal(result.internalPassageEdges, 5);
  assert.equal(result.cycleRank, 0);
  assert.equal(result.reachableWithoutExit, 1);
  assert.equal(result.exitGatedCells, 4);
  assert.equal(result.exitGatedPercent, 4 / 6 * 100);
  assert.deepEqual(result.exitGatedRegionSizes, [3, 1]);
  assert.equal(result.exitDegree, 3);
  assert.equal(result.exitClassification, 'junction');
});

test('looped mazes use actual reachability and optional cells are counted once', () => {
  const maze = mazeFromEdges(2, 2, [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    [{ x: 1, y: 0 }, { x: 1, y: 1 }],
    [{ x: 1, y: 1 }, { x: 0, y: 1 }],
    [{ x: 0, y: 1 }, { x: 0, y: 0 }],
  ], { x: 0, y: 0 }, { x: 1, y: 1 });
  const result = analyzeMazeQuality(maze);
  assert.equal(result.exitDegree, 2);
  assert.equal(result.internalPassageEdges, 4);
  assert.equal(result.cycleRank, 1);
  assert.equal(result.exitGatedCells, 0);
  assert.equal(result.exitGatedPercent, 0);
  assert.equal(result.optionalAccessibleCells, 1);
  assert.equal(result.optionalBranchCount, 1);
  assert.equal(result.solutionPathCells + result.optionalAccessibleCells, 4);
});

test('seeded production audit is reproducible and does not mutate maze definitions', () => {
  const first = runMazeQualityAudit({ samples: 4, startSeed: 120 });
  const second = runMazeQualityAudit({ samples: 4, startSeed: 120 });
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const projection = result => result.difficulties[difficulty].samples.map(({ seed, layoutId, start, exit, exitGatedCells, solutionPathEdges, optionalAccessibleCells }) =>
      ({ seed, layoutId, start, exit, exitGatedCells, solutionPathEdges, optionalAccessibleCells }));
    assert.deepEqual(projection(first), projection(second));
    assert.equal(first.difficulties[difficulty].sampleCount, 4);
    assert.equal(first.difficulties[difficulty].samples.every(sample => sample.fullReachableCells === sample.width * sample.height), true);
    assert.equal(first.difficulties[difficulty].samples.every(sample => Number.isInteger(sample.generationAttempts) && sample.generationAttempts >= 1), true);
  }
});
