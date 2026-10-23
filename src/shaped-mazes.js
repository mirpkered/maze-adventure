import { canMove, countActiveCells, createMazeFromMask, DIRECTIONS, getShortestPath, inBounds, validateMaze } from './maze.js';

export function createShapedMaze(shape, { random = Math.random, seed = null, selectionMode = 'chosen', maxAttempts = 64 } = {}) {
  if (!shape || typeof shape.id !== 'string' || typeof shape.name !== 'string' || typeof shape.geometryProvider !== 'function') {
    throw new TypeError('A registered shape with geometry is required.');
  }
  const maze = createMazeFromMask(shape.geometryProvider(), {
    shapeId: shape.id, shapeName: shape.name, random, seed, selectionMode, maxAttempts,
  });
  if (!validateShapedMaze(maze, shape)) throw new Error(`Generated ${shape.name} maze did not pass shape validation.`);
  return maze;
}

export function validateShapedMaze(maze, shape) {
  if (!maze || maze.mazeFormat !== 'shaped' || maze.shapeId !== shape?.id || !Array.isArray(maze.mask)) return false;
  if (!validateMaze(maze) || maze.activeCellCount !== countActiveCells(maze)) return false;
  const expected = shape.geometryProvider();
  if (expected.length !== maze.height || expected.some((row, y) => row.length !== maze.width || row.some((active, x) => active !== Boolean(maze.mask[y][x])))) return false;
  const activeCells = [];
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) if (inBounds(maze, { x, y })) activeCells.push({ x, y });
  if (activeCells.length !== maze.activeCellCount) return false;
  const exitDegree = DIRECTIONS.reduce((count, direction) => count + Number(canMove(maze, maze.end, { x: maze.end.x + direction.dx, y: maze.end.y + direction.dy })), 0);
  const path = getShortestPath(maze);
  return exitDegree === 1
    && maze.generationQuality?.exitInternalDegree === 1
    && maze.generationQuality?.exitGatedCells === 0
    && path?.length - 1 >= maze.qualityConstraints.minimumSolutionLength
    && maze.entrance?.cell.x === maze.start.x && maze.entrance?.cell.y === maze.start.y
    && maze.exit?.cell.x === maze.end.x && maze.exit?.cell.y === maze.end.y;
}

