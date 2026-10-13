/** Maze contracts: a definition is a rectangular grid of cells with N/E/S/W walls.
 * Future story levels may add id, artKey, storyPageId, or linked-maze metadata;
 * generation and validation remain deterministic and independent of presentation.
 */
export const DIRECTIONS = [
  { name: 'N', dx: 0, dy: -1, opposite: 'S' },
  { name: 'E', dx: 1, dy: 0, opposite: 'W' },
  { name: 'S', dx: 0, dy: 1, opposite: 'N' },
  { name: 'W', dx: -1, dy: 0, opposite: 'E' },
];

export function createMaze(width = 7, height = 7, random = Math.random) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) throw new RangeError('Maze dimensions must be integers of at least 2.');
  const cells = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ({ x, y, walls: { N: true, E: true, S: true, W: true } })));
  const visited = new Set(['0,0']);
  const stack = [cells[0][0]];
  while (stack.length) {
    const current = stack.at(-1);
    const options = DIRECTIONS.map(d => ({ d, x: current.x + d.dx, y: current.y + d.dy }))
      .filter(n => n.x >= 0 && n.x < width && n.y >= 0 && n.y < height && !visited.has(`${n.x},${n.y}`));
    if (!options.length) { stack.pop(); continue; }
    const next = options[Math.floor(random() * options.length)];
    current.walls[next.d.name] = false;
    cells[next.y][next.x].walls[next.d.opposite] = false;
    visited.add(`${next.x},${next.y}`);
    stack.push(cells[next.y][next.x]);
  }
  const maze = {
    width, height, cells,
    start: { x: 0, y: 0 }, end: { x: width - 1, y: height - 1 },
    // Start and finish are explicit, intentional openings in an otherwise
    // enclosed perimeter. Out-of-bounds movement remains illegal.
    entrance: { cell: { x: 0, y: 0 }, side: 'N' },
    exit: { cell: { x: width - 1, y: height - 1 }, side: 'S' },
  };
  cells[maze.entrance.cell.y][maze.entrance.cell.x].walls.N = false;
  cells[maze.exit.cell.y][maze.exit.cell.x].walls.S = false;
  if (!validateMaze(maze)) throw new Error('Generated maze failed validation.');
  return maze;
}

export function canMove(maze, from, to) {
  if (!inBounds(maze, from) || !inBounds(maze, to)) return false;
  const direction = DIRECTIONS.find(d => from.x + d.dx === to.x && from.y + d.dy === to.y);
  if (!direction) return false;
  // Treat an edge as open only when both cells agree. This keeps malformed
  // imported/replayed layouts from becoming one-way passages.
  return !maze.cells[from.y][from.x].walls[direction.name]
    && !maze.cells[to.y][to.x].walls[direction.opposite];
}

export function inBounds(maze, point) {
  return Number.isInteger(point?.x) && Number.isInteger(point?.y) && point.x >= 0 && point.x < maze.width && point.y >= 0 && point.y < maze.height;
}

export function isConnected(maze) {
  const seen = new Set([`${maze.start.x},${maze.start.y}`]);
  const queue = [maze.start];
  while (queue.length) {
    const here = queue.shift();
    for (const d of DIRECTIONS) {
      const there = { x: here.x + d.dx, y: here.y + d.dy }, key = `${there.x},${there.y}`;
      if (inBounds(maze, there) && !seen.has(key) && canMove(maze, here, there)) { seen.add(key); queue.push(there); }
    }
  }
  return seen.size === maze.width * maze.height;
}

export function validateMaze(maze) {
  if (!maze || !Number.isInteger(maze.width) || !Number.isInteger(maze.height) || maze.width < 2 || maze.height < 2) return false;
  if (!inBounds(maze, maze.start) || !inBounds(maze, maze.end) || maze.cells?.length !== maze.height) return false;
  const openings = [maze.entrance, maze.exit].filter(Boolean);
  const openingKeys = new Set();
  for (const opening of openings) {
    if (!['N', 'E', 'S', 'W'].includes(opening.side) || !inBounds(maze, opening.cell)) return false;
    const { x, y } = opening.cell;
    if (opening.side === 'N' && y !== 0 || opening.side === 'S' && y !== maze.height - 1 || opening.side === 'W' && x !== 0 || opening.side === 'E' && x !== maze.width - 1) return false;
    const key = `${x},${y},${opening.side}`;
    if (openingKeys.has(key)) return false;
    openingKeys.add(key);
  }
  for (let y = 0; y < maze.height; y++) {
    if (maze.cells[y]?.length !== maze.width) return false;
    for (let x = 0; x < maze.width; x++) {
      const walls = maze.cells[y][x]?.walls;
      if (!walls || DIRECTIONS.some(d => typeof walls[d.name] !== 'boolean')) return false;
      if (y === 0 && !walls.N && !openingKeys.has(`${x},${y},N`) || x === 0 && !walls.W && !openingKeys.has(`${x},${y},W`)
        || y === maze.height - 1 && !walls.S && !openingKeys.has(`${x},${y},S`) || x === maze.width - 1 && !walls.E && !openingKeys.has(`${x},${y},E`)) return false;
      if (openingKeys.has(`${x},${y},N`) && walls.N || openingKeys.has(`${x},${y},E`) && walls.E
        || openingKeys.has(`${x},${y},S`) && walls.S || openingKeys.has(`${x},${y},W`) && walls.W) return false;
      if (x + 1 < maze.width && walls.E !== maze.cells[y][x + 1]?.walls?.W) return false;
      if (y + 1 < maze.height && walls.S !== maze.cells[y + 1]?.[x]?.walls?.N) return false;
    }
  }
  return isConnected(maze);
}

/** Canonical renderable closed edges, deduplicated from the cell wall graph. */
export function getWallSegments(maze) {
  const segments = [];
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const walls = maze.cells[y][x].walls;
    const northBlocked = y === 0 ? walls.N : walls.N || maze.cells[y - 1][x].walls.S;
    const westBlocked = x === 0 ? walls.W : walls.W || maze.cells[y][x - 1].walls.E;
    if (northBlocked) segments.push({ orientation: 'horizontal', x, y });
    if (westBlocked) segments.push({ orientation: 'vertical', x, y });
    if (x === maze.width - 1 && walls.E) segments.push({ orientation: 'vertical', x: x + 1, y });
    if (y === maze.height - 1 && walls.S) segments.push({ orientation: 'horizontal', x, y: y + 1 });
  }
  return segments;
}

export function validatePath(maze, path) {
  if (!Array.isArray(path) || !path.length || path[0].x !== maze.start.x || path[0].y !== maze.start.y) return false;
  for (let i = 1; i < path.length; i++) if (!canMove(maze, path[i - 1], path[i])) return false;
  return true;
}

/** Append a legal adjacent cell, or pop the immediately previous cell when retracing. */
export function advancePath(maze, path, next) {
  if (!validatePath(maze, path)) return { path, moved: false, complete: false };
  const current = path.at(-1);
  if (path.length > 1 && next.x === path.at(-2).x && next.y === path.at(-2).y) {
    if (!canMove(maze, current, next)) return { path, moved: false, complete: false };
    return { path: path.slice(0, -1), moved: true, complete: false };
  }
  if (!canMove(maze, current, next) || path.some(p => p.x === next.x && p.y === next.y)) return { path, moved: false, complete: false };
  const updated = [...path, { x: next.x, y: next.y }];
  return { path: updated, moved: true, complete: next.x === maze.end.x && next.y === maze.end.y };
}
