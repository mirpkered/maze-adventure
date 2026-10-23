import test from 'node:test';
import assert from 'node:assert/strict';
import { canMove, createMazeForDifficulty, getShortestPath } from '../src/maze.js';
import { analyzeDecisions } from '../scripts/medium-difficulty-audit.mjs';
import { seededRandom } from '../scripts/maze-quality-audit.mjs';

function mazeFromEdges(width, height, edges, start, end) {
  const cells = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ({ x, y, walls: { N: true, E: true, S: true, W: true } })));
  const sides = { '0,-1': ['N', 'S'], '1,0': ['E', 'W'], '0,1': ['S', 'N'], '-1,0': ['W', 'E'] };
  for (const [a, b] of edges) {
    const [side, opposite] = sides[`${b.x - a.x},${b.y - a.y}`];
    cells[a.y][a.x].walls[side] = false; cells[b.y][b.x].walls[opposite] = false;
  }
  return { width, height, cells, start, end };
}

test('meaningful decisions count off-route choices and exclude forced corners', () => {
  const maze = mazeFromEdges(3, 3, [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }], // first solution edge
    [{ x: 1, y: 0 }, { x: 2, y: 0 }], // finish
    [{ x: 0, y: 0 }, { x: 0, y: 1 }], // optional choice at start
    [{ x: 1, y: 0 }, { x: 1, y: 1 }], // optional choice at route junction
    [{ x: 1, y: 1 }, { x: 2, y: 1 }], // forced turn inside optional branch
  ], { x: 0, y: 0 }, { x: 2, y: 0 });
  const measured = analyzeDecisions(maze, getShortestPath(maze));
  assert.equal(measured.count, 2);
  assert.equal(measured.alternatives, 2);
  assert.deepEqual(measured.points.map(point => point.cell), [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
});

test('production Medium decision analysis is reproducible and leaves the maze unchanged', () => {
  const firstMaze = createMazeForDifficulty('medium', seededRandom(56));
  const secondMaze = createMazeForDifficulty('medium', seededRandom(56));
  const before = JSON.stringify(firstMaze);
  const first = analyzeDecisions(firstMaze);
  const second = analyzeDecisions(secondMaze);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(firstMaze), before);
  assert.equal(firstMaze.width, 10);
  assert.equal(firstMaze.height, 10);
  assert.equal(firstMaze.generationAttempts >= 1, true);
  assert.equal(first.count >= 2, true);
  assert.equal(firstMaze.cells[firstMaze.end.y][firstMaze.end.x].walls[firstMaze.exit.side], false);
  assert.equal(canMove(firstMaze, firstMaze.end, { x: firstMaze.end.x + 1, y: firstMaze.end.y })
    || canMove(firstMaze, firstMaze.end, { x: firstMaze.end.x - 1, y: firstMaze.end.y })
    || canMove(firstMaze, firstMaze.end, { x: firstMaze.end.x, y: firstMaze.end.y + 1 })
    || canMove(firstMaze, firstMaze.end, { x: firstMaze.end.x, y: firstMaze.end.y - 1 }), true);
});
