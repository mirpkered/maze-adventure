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

export const FREE_PLAY_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ width: 7, height: 7, label: 'Easy' }),
  medium: Object.freeze({ width: 10, height: 10, label: 'Medium' }),
  hard: Object.freeze({ width: 15, height: 15, label: 'Hard' }),
  expert: Object.freeze({ width: 20, height: 20, label: 'Expert' }),
});

const MIN_SOLUTION_LENGTH = Object.freeze({ '7x7': 18, '10x10': 28, '15x15': 42, '20x20': 100 });
const HARD_TARGET_LENGTH = 50;
const HARD_MIN_ROUTE_JUNCTIONS = 6;
const HARD_MAX_GENERATION_ATTEMPTS = 8;
const EXPERT_TARGET_LENGTH = 120;
const EXPERT_MIN_ROUTE_JUNCTIONS = 12;
const EXPERT_MIN_OPTIONAL_BRANCHES = 8;
const EXPERT_MIN_OPTIONAL_CELLS = 140;
const EXPERT_MAX_OPTIONAL_BRANCH_CELLS = 200;
const EXPERT_MAX_GENERATION_ATTEMPTS = 12;

function pathsFrom(maze, start) {
  const queue = [{ ...start }], parents = new Map([[`${start.x},${start.y}`, null]]);
  for (let index = 0; index < queue.length; index++) {
    const here = queue[index], key = `${here.x},${here.y}`;
    for (const direction of DIRECTIONS) {
      const next = { x: here.x + direction.dx, y: here.y + direction.dy }, nextKey = `${next.x},${next.y}`;
      if (inBounds(maze, next) && !parents.has(nextKey) && canMove(maze, here, next)) {
        parents.set(nextKey, key);
        queue.push(next);
      }
    }
  }
  return parents;
}

function reconstructPath(parents, finish) {
  const path = [];
  for (let cursor = `${finish.x},${finish.y}`; cursor; cursor = parents.get(cursor)) {
    if (!parents.has(cursor)) return null;
    const [x, y] = cursor.split(',').map(Number);
    path.push({ x, y });
  }
  return path.reverse();
}

function shortestPathFrom(maze, start, finish) {
  return reconstructPath(pathsFrom(maze, start), finish);
}

/** Shortest legal cell route, measured on the same reciprocal graph used by tracing. */
export function getShortestPath(maze, start = maze.start, finish = maze.end) {
  if (!inBounds(maze, start) || !inBounds(maze, finish)) return null;
  return shortestPathFrom(maze, start, finish);
}

function perimeterOpenings(width, height, includeCorners = false) {
  const openings = [];
  const first = includeCorners ? 0 : 1, lastX = includeCorners ? width - 1 : width - 2, lastY = includeCorners ? height - 1 : height - 2;
  for (let x = first; x <= lastX; x++) openings.push({ cell: { x, y: 0 }, side: 'N' });
  for (let y = first; y <= lastY; y++) openings.push({ cell: { x: width - 1, y }, side: 'E' });
  for (let x = lastX; x >= first; x--) openings.push({ cell: { x, y: height - 1 }, side: 'S' });
  for (let y = lastY; y >= first; y--) openings.push({ cell: { x: 0, y }, side: 'W' });
  return openings;
}

function graphDegree(maze, cell) {
  return DIRECTIONS.reduce((degree, direction) => degree + Number(canMove(maze, cell, { x: cell.x + direction.dx, y: cell.y + direction.dy })), 0);
}

function chooseEndpointPair(maze, random, minimumLength, requireTerminalExit = false) {
  const openings = perimeterOpenings(maze.width, maze.height, maze.width <= 2 || maze.height <= 2);
  const pairs = [];
  for (const entrance of openings) {
    const parents = pathsFrom(maze, entrance.cell);
    for (const exit of openings) {
      if (entrance === exit || (entrance.cell.x === exit.cell.x && entrance.cell.y === exit.cell.y)) continue;
      const path = reconstructPath(parents, exit.cell);
      if (!path || path.length - 1 < minimumLength) continue;
      // Shipped difficulties use a leaf finish so completing cannot strand
      // branches beyond the flower. Generic custom grids retain their prior
      // endpoint policy.
      if (requireTerminalExit && graphDegree(maze, exit.cell) !== 1) continue;
      const junctions = path.slice(1, -1).filter(cell => graphDegree(maze, cell) >= 3).length;
      pairs.push({ entrance, exit, junctions });
    }
  }
  if (!pairs.length) return null;
  const decisionPairs = pairs.filter(pair => pair.junctions >= 2);
  const pool = decisionPairs.length ? decisionPairs : pairs;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/**
 * Hard uses the same perfect-maze graph and endpoint model, with a bounded
 * search for a long route that passes through enough decision points. Prefer
 * routes of 50+ edges when present; 42 is the guaranteed floor.
 */
function chooseHardEndpointPair(maze, random) {
  const openings = perimeterOpenings(maze.width, maze.height);
  const candidates = [];
  for (const entrance of openings) {
    // The DFS generator makes a tree, so one BFS provides exact route length
    // and a prefix count of junctions for every possible exit.
    const size = maze.width * maze.height, distance = new Int16Array(size), junctionPrefix = new Int16Array(size);
    const root = entrance.cell.y * maze.width + entrance.cell.x;
    distance.fill(-1);
    distance[root] = 0;
    junctionPrefix[root] = Number(graphDegree(maze, entrance.cell) >= 3);
    const queue = [entrance.cell];
    for (let index = 0; index < queue.length; index++) {
      const here = queue[index], hereIndex = here.y * maze.width + here.x;
      for (const direction of DIRECTIONS) {
        const next = { x: here.x + direction.dx, y: here.y + direction.dy };
        if (!inBounds(maze, next) || !canMove(maze, here, next)) continue;
        const nextIndex = next.y * maze.width + next.x;
        if (distance[nextIndex] !== -1) continue;
        distance[nextIndex] = distance[hereIndex] + 1;
        junctionPrefix[nextIndex] = junctionPrefix[hereIndex] + Number(graphDegree(maze, next) >= 3);
        queue.push(next);
      }
    }
    for (const exit of openings) {
      if (entrance.cell.x === exit.cell.x && entrance.cell.y === exit.cell.y) continue;
      const exitIndex = exit.cell.y * maze.width + exit.cell.x;
      const length = distance[exitIndex];
      if (length < MIN_SOLUTION_LENGTH['15x15']) continue;
      if (graphDegree(maze, exit.cell) !== 1) continue;
      const junctions = junctionPrefix[exitIndex] - Number(graphDegree(maze, entrance.cell) >= 3)
        - Number(graphDegree(maze, exit.cell) >= 3);
      if (junctions >= HARD_MIN_ROUTE_JUNCTIONS) candidates.push({ entrance, exit, length, junctions });
    }
  }
  if (!candidates.length) return null;
  const targetLength = candidates.filter(candidate => candidate.length >= HARD_TARGET_LENGTH);
  const pool = targetLength.length ? targetLength : candidates;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

function getPathFromParents(parents, startIndex, finishIndex, width) {
  const path = [];
  for (let cursor = finishIndex; cursor !== -1; cursor = parents[cursor]) {
    path.push({ x: cursor % width, y: Math.floor(cursor / width) });
    if (cursor === startIndex) break;
  }
  return path.reverse();
}

function optionalBranchSizes(maze, route) {
  const routeCells = new Uint8Array(maze.width * maze.height);
  for (const cell of route) routeCells[cell.y * maze.width + cell.x] = 1;
  const seen = new Uint8Array(routeCells.length), sizes = [];
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const root = y * maze.width + x;
    if (!inBounds(maze, { x, y }) || routeCells[root] || seen[root]) continue;
    seen[root] = 1;
    const queue = [{ x, y }];
    for (let index = 0; index < queue.length; index++) {
      const here = queue[index];
      for (const direction of DIRECTIONS) {
        const next = { x: here.x + direction.dx, y: here.y + direction.dy };
        if (!inBounds(maze, next) || !canMove(maze, here, next)) continue;
        const nextIndex = next.y * maze.width + next.x;
        if (routeCells[nextIndex] || seen[nextIndex]) continue;
        seen[nextIndex] = 1;
        queue.push(next);
      }
    }
    sizes.push(queue.length);
  }
  return sizes.sort((a, b) => b - a);
}

/**
 * Expert reuses the same DFS maze and terminal perimeter exit model. Its
 * endpoint search uses typed-array BFS state, then checks optional branch
 * quality only for route candidates that meet the stronger distance/decision
 * thresholds. This avoids the generic all-pairs path reconstruction that made
 * 20x20 generation unnecessarily expensive.
 */
function chooseExpertEndpointPair(maze, random) {
  const openings = perimeterOpenings(maze.width, maze.height), size = maze.width * maze.height;
  const degree = new Uint8Array(size);
  for (const opening of openings) degree[opening.cell.y * maze.width + opening.cell.x] = graphDegree(maze, opening.cell);
  // Interior degrees are also needed to count route junctions.
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    degree[y * maze.width + x] = graphDegree(maze, { x, y });
  }
  const candidates = [];
  for (const entrance of openings) {
    const parents = new Int16Array(size), distance = new Int16Array(size), junctionPrefix = new Int16Array(size);
    parents.fill(-2); distance.fill(-1);
    const startIndex = entrance.cell.y * maze.width + entrance.cell.x;
    parents[startIndex] = -1; distance[startIndex] = 0;
    junctionPrefix[startIndex] = Number(degree[startIndex] >= 3);
    const queue = new Int16Array(size); queue[0] = startIndex;
    let head = 0, tail = 1;
    while (head < tail) {
      const hereIndex = queue[head++], here = { x: hereIndex % maze.width, y: Math.floor(hereIndex / maze.width) };
      for (const direction of DIRECTIONS) {
        const next = { x: here.x + direction.dx, y: here.y + direction.dy };
        if (!inBounds(maze, next) || !canMove(maze, here, next)) continue;
        const nextIndex = next.y * maze.width + next.x;
        if (distance[nextIndex] !== -1) continue;
        parents[nextIndex] = hereIndex;
        distance[nextIndex] = distance[hereIndex] + 1;
        junctionPrefix[nextIndex] = junctionPrefix[hereIndex] + Number(degree[nextIndex] >= 3);
        queue[tail++] = nextIndex;
      }
    }
    for (const exit of openings) {
      const exitIndex = exit.cell.y * maze.width + exit.cell.x;
      if (exitIndex === startIndex || degree[exitIndex] !== 1) continue;
      const length = distance[exitIndex];
      if (length < MIN_SOLUTION_LENGTH['20x20']) continue;
      const junctions = junctionPrefix[exitIndex] - Number(degree[startIndex] >= 3) - Number(degree[exitIndex] >= 3);
      if (junctions < EXPERT_MIN_ROUTE_JUNCTIONS) continue;
      candidates.push({ entrance, exit, startIndex, exitIndex, length, junctions, parents });
    }
  }
  if (!candidates.length) return null;
  const targeted = candidates.filter(candidate => candidate.length >= EXPERT_TARGET_LENGTH);
  const candidatePools = targeted.length ? [targeted, candidates.filter(candidate => candidate.length < EXPERT_TARGET_LENGTH)] : [candidates];
  for (const pool of candidatePools) {
    const offset = Math.floor(random() * pool.length);
    for (let index = 0; index < pool.length; index++) {
      const candidate = pool[(offset + index) % pool.length];
      const route = getPathFromParents(candidate.parents, candidate.startIndex, candidate.exitIndex, maze.width);
      const branches = optionalBranchSizes(maze, route);
      const optionalCells = size - route.length;
      if (optionalCells < EXPERT_MIN_OPTIONAL_CELLS || branches.length < EXPERT_MIN_OPTIONAL_BRANCHES
        || (branches[0] ?? 0) > EXPERT_MAX_OPTIONAL_BRANCH_CELLS) continue;
      return { ...candidate, optionalAccessibleCells: optionalCells, optionalBranchSizes: branches };
    }
  }
  return null;
}

export function createMaze(width = 7, height = 7, random = Math.random) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) throw new RangeError('Maze dimensions must be integers of at least 2.');
  const generationStartedAt = globalThis.performance?.now?.() ?? null;
  const isHard = width === 15 && height === 15;
  const isExpert = width === 20 && height === 20;
  const minimumLength = MIN_SOLUTION_LENGTH[`${width}x${height}`] ?? 1;
  const maxAttempts = isExpert ? EXPERT_MAX_GENERATION_ATTEMPTS : isHard ? HARD_MAX_GENERATION_ATTEMPTS : 32;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
    const maze = { width, height, cells };
    const isShippedDifficulty = Object.hasOwn(MIN_SOLUTION_LENGTH, `${width}x${height}`);
    let pair = isExpert ? chooseExpertEndpointPair(maze, random)
      : isHard ? chooseHardEndpointPair(maze, random)
      : chooseEndpointPair(maze, random, minimumLength, isShippedDifficulty);
    if (!pair) continue;
    maze.start = { ...pair.entrance.cell };
    maze.end = { ...pair.exit.cell };
    maze.entrance = pair.entrance;
    maze.exit = pair.exit;
    cells[maze.start.y][maze.start.x].walls[maze.entrance.side] = false;
    cells[maze.end.y][maze.end.x].walls[maze.exit.side] = false;
    if (!validateMaze(maze)) throw new Error('Generated maze failed validation.');
    maze.generationAttempts = attempt + 1;
    maze.generationDurationMs = generationStartedAt === null
      ? null : Math.round((globalThis.performance.now() - generationStartedAt) * 100) / 100;
    if (isExpert) maze.generationQuality = {
      solutionPathEdges: pair.length,
      solutionRouteJunctions: pair.junctions,
      optionalAccessibleCells: pair.optionalAccessibleCells,
      optionalBranchCount: pair.optionalBranchSizes.length,
      largestOptionalBranch: pair.optionalBranchSizes[0] ?? 0,
    };
    return maze;
  }
  throw new Error(`Could not generate a ${width}x${height} maze meeting its bounded endpoint quality requirements after ${maxAttempts} attempts.`);
}

/** Free Play sizes share the same maze model and generator; Easy keeps its original 7×7 behavior. */
export function createMazeForDifficulty(difficulty = 'easy', random = Math.random) {
  const configuration = FREE_PLAY_DIFFICULTIES[difficulty];
  if (!configuration) throw new RangeError(`Unknown Free Play difficulty: ${difficulty}`);
  return { ...createMaze(configuration.width, configuration.height, random), difficulty };
}

function validateMask(mask) {
  if (!Array.isArray(mask) || mask.length < 3 || !Array.isArray(mask[0]) || mask[0].length < 3) return false;
  const width = mask[0].length, height = mask.length, active = [];
  for (let y = 0; y < height; y++) {
    if (!Array.isArray(mask[y]) || mask[y].length !== width || mask[y].some(value => typeof value !== 'boolean')) return false;
    for (let x = 0; x < width; x++) if (mask[y][x]) active.push({ x, y });
  }
  if (active.length < 20) return false;
  const seen = new Set([`${active[0].x},${active[0].y}`]), queue = [active[0]];
  for (let index = 0; index < queue.length; index++) for (const direction of DIRECTIONS) {
    const next = { x: queue[index].x + direction.dx, y: queue[index].y + direction.dy }, key = `${next.x},${next.y}`;
    if (next.x >= 0 && next.x < width && next.y >= 0 && next.y < height && mask[next.y][next.x] && !seen.has(key)) {
      seen.add(key); queue.push(next);
    }
  }
  return seen.size === active.length;
}

function cellDegree(maze, cell) {
  return DIRECTIONS.reduce((count, direction) => count + Number(canMove(maze, cell, { x: cell.x + direction.dx, y: cell.y + direction.dy })), 0);
}

function maskedEndpointPair(maze, random, activeCount, quality) {
  const boundaryEdges = getMaskBoundaryEdges(maze);
  const degree = new Map();
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    if (inBounds(maze, { x, y })) degree.set(`${x},${y}`, cellDegree(maze, { x, y }));
  }
  const terminalExits = boundaryEdges.filter(edge => degree.get(`${edge.cell.x},${edge.cell.y}`) === 1);
  const entrancePool = [...boundaryEdges];
  for (let index = entrancePool.length - 1; index > 0; index--) {
    const picked = Math.min(index, Math.floor(Math.min(0.999999999, Math.max(0, random())) * (index + 1)));
    [entrancePool[index], entrancePool[picked]] = [entrancePool[picked], entrancePool[index]];
  }
  const candidates = [];
  // A bounded spread of boundary starts keeps generation quick on phones while
  // still allowing every exterior edge to appear across ordinary sessions.
  for (const entrance of entrancePool.slice(0, Math.min(16, entrancePool.length))) {
    const parents = pathsFrom(maze, entrance.cell);
    for (const exit of terminalExits) {
      if (entrance.cell.x === exit.cell.x && entrance.cell.y === exit.cell.y) continue;
      const route = reconstructPath(parents, exit.cell);
      const length = route?.length - 1;
      if (!route || length < quality.minimumSolutionLength) continue;
      const junctions = route.slice(1, -1).filter(cell => degree.get(`${cell.x},${cell.y}`) >= 3).length;
      if (junctions < quality.minimumMeaningfulDecisions) continue;
      candidates.push({ entrance, exit, route, length, junctions });
    }
  }
  if (!candidates.length) return null;
  const ranked = [...candidates].sort((a, b) => Number(b.length >= quality.targetSolutionLength) - Number(a.length >= quality.targetSolutionLength)
    || b.junctions - a.junctions || b.length - a.length);
  const candidatePool = ranked.slice(0, Math.min(12, ranked.length));
  const start = Math.min(candidatePool.length - 1, Math.floor(Math.min(0.999999999, Math.max(0, random())) * candidatePool.length));
  for (let offset = 0; offset < candidatePool.length; offset++) {
    const candidate = candidatePool[(start + offset) % candidatePool.length];
    const branches = optionalBranchSizes(maze, candidate.route);
    const optionalCells = activeCount - candidate.route.length;
    if (optionalCells < quality.minimumOptionalCells
      || branches.length < quality.minimumOptionalBranches
      || (branches[0] ?? 0) > quality.maximumOptionalBranchCells) continue;
    return { ...candidate, branches, optionalCells };
  }
  return null;
}

/**
 * Generate a perfect maze inside a connected cell mask. Null cells are outside
 * the playable domain and remain walls for rendering, collision, and tracing.
 */
export function createMazeFromMask(mask, { shapeId, shapeName, random = Math.random, seed = null, selectionMode = 'chosen', maxAttempts = 64 } = {}) {
  if (!validateMask(mask)) throw new RangeError('Maze shape mask must be a connected grid with at least 20 active cells.');
  if (typeof shapeId !== 'string' || !shapeId) throw new RangeError('A stable shape ID is required.');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 256) throw new RangeError('Shaped-maze attempts must be between 1 and 256.');
  const height = mask.length, width = mask[0].length;
  const activeCount = mask.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const quality = {
    minimumSolutionLength: Math.max(14, Math.ceil(activeCount * 0.22)),
    targetSolutionLength: Math.max(20, Math.ceil(activeCount * 0.3)),
    minimumMeaningfulDecisions: Math.max(3, Math.ceil(Math.sqrt(activeCount) * 0.35)),
    minimumOptionalBranches: Math.max(2, Math.floor(activeCount / 60)),
    minimumOptionalCells: Math.ceil(activeCount * 0.18),
    maximumOptionalBranchCells: Math.floor(activeCount * 0.58),
  };
  const startedAt = globalThis.performance?.now?.() ?? null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cells = mask.map((row, y) => row.map((active, x) => active
      ? { x, y, walls: { N: true, E: true, S: true, W: true } } : null));
    const root = mask.flatMap((row, y) => row.map((active, x) => active ? { x, y } : null).filter(Boolean))[Math.floor(activeCount / 2)];
    const visited = new Set([`${root.x},${root.y}`]), stack = [cells[root.y][root.x]];
    while (stack.length) {
      const current = stack.at(-1);
      const options = DIRECTIONS.map(direction => ({ direction, x: current.x + direction.dx, y: current.y + direction.dy }))
        .filter(next => next.x >= 0 && next.x < width && next.y >= 0 && next.y < height
          && mask[next.y][next.x] && !visited.has(`${next.x},${next.y}`));
      if (!options.length) { stack.pop(); continue; }
      const picked = options[Math.min(options.length - 1, Math.floor(Math.min(0.999999999, Math.max(0, random())) * options.length))];
      current.walls[picked.direction.name] = false;
      cells[picked.y][picked.x].walls[picked.direction.opposite] = false;
      visited.add(`${picked.x},${picked.y}`);
      stack.push(cells[picked.y][picked.x]);
    }
    const maze = { width, height, cells, mask, shapeId, shapeName, mazeFormat: 'shaped', selectionMode, seed,
      qualityConstraints: quality };
    const pair = maskedEndpointPair(maze, random, activeCount, quality);
    if (!pair) continue;
    maze.start = { ...pair.entrance.cell };
    maze.end = { ...pair.exit.cell };
    maze.entrance = { cell: { ...pair.entrance.cell }, side: pair.entrance.side };
    maze.exit = { cell: { ...pair.exit.cell }, side: pair.exit.side };
    cells[maze.start.y][maze.start.x].walls[maze.entrance.side] = false;
    cells[maze.end.y][maze.end.x].walls[maze.exit.side] = false;
    if (!validateMaze(maze)) throw new Error(`Generated ${shapeId} maze failed canonical validation.`);
    maze.activeCellCount = activeCount;
    maze.generationAttempts = attempt + 1;
    maze.generationDurationMs = startedAt === null ? null : Math.round((globalThis.performance.now() - startedAt) * 100) / 100;
    maze.generationQuality = {
      solutionPathEdges: pair.length,
      meaningfulDecisions: pair.junctions,
      solutionRouteJunctions: pair.junctions,
      deadEndCount: activeCountOfMaze(maze, cell => cellDegree(maze, cell) === 1),
      optionalBranchCount: pair.branches.length,
      optionalBranchSizes: pair.branches,
      optionalAccessibleCells: pair.optionalCells,
      largestOptionalBranch: pair.branches[0] ?? 0,
      exitInternalDegree: cellDegree(maze, maze.end),
      exitGatedCells: 0,
    };
    return maze;
  }
  throw new Error(`Could not generate a ${shapeId} maze meeting its bounded quality requirements after ${maxAttempts} attempts.`);
}

function activeCountOfMaze(maze, predicate) {
  let count = 0;
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const cell = maze.cells[y][x];
    if (cell && predicate(cell)) count++;
  }
  return count;
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
  return Number.isInteger(point?.x) && Number.isInteger(point?.y)
    && point.x >= 0 && point.x < maze.width && point.y >= 0 && point.y < maze.height
    && Boolean(maze.cells?.[point.y]?.[point.x]);
}

export function countActiveCells(maze) {
  return maze.cells.reduce((count, row) => count + row.filter(Boolean).length, 0);
}

export function getMaskBoundaryEdges(maze) {
  const edges = [];
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    if (!maze.cells[y]?.[x]) continue;
    for (const direction of DIRECTIONS) {
      if (!inBounds(maze, { x: x + direction.dx, y: y + direction.dy })) {
        edges.push({ cell: { x, y }, side: direction.name });
      }
    }
  }
  return edges;
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
  return seen.size === countActiveCells(maze);
}

export function validateMaze(maze) {
  if (!maze || !Number.isInteger(maze.width) || !Number.isInteger(maze.height) || maze.width < 2 || maze.height < 2) return false;
  if (!inBounds(maze, maze.start) || !inBounds(maze, maze.end) || maze.cells?.length !== maze.height) return false;
  const openings = [maze.entrance, maze.exit].filter(Boolean);
  if (openings.length !== 2 || maze.start.x === maze.end.x && maze.start.y === maze.end.y) return false;
  if (maze.entrance.cell.x !== maze.start.x || maze.entrance.cell.y !== maze.start.y
    || maze.exit.cell.x !== maze.end.x || maze.exit.cell.y !== maze.end.y) return false;
  const openingKeys = new Set();
  for (const opening of openings) {
    if (!['N', 'E', 'S', 'W'].includes(opening.side) || !inBounds(maze, opening.cell)) return false;
    const { x, y } = opening.cell;
    const direction = DIRECTIONS.find(item => item.name === opening.side);
    if (inBounds(maze, { x: x + direction.dx, y: y + direction.dy })) return false;
    const key = `${x},${y},${opening.side}`;
    if (openingKeys.has(key)) return false;
    openingKeys.add(key);
  }
  for (let y = 0; y < maze.height; y++) {
    if (maze.cells[y]?.length !== maze.width) return false;
    for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[y][x];
      if (!cell) { if (!maze.mask || maze.mask[y]?.[x] !== false) return false; continue; }
      if (maze.mask && maze.mask[y]?.[x] !== true) return false;
      const walls = cell.walls;
      if (!walls || DIRECTIONS.some(d => typeof walls[d.name] !== 'boolean')) return false;
      for (const direction of DIRECTIONS) {
        const nx = x + direction.dx, ny = y + direction.dy, neighbor = inBounds(maze, { x: nx, y: ny });
        const opening = openingKeys.has(`${x},${y},${direction.name}`);
        if (neighbor) {
          if (opening || walls[direction.name] !== maze.cells[ny][nx].walls[direction.opposite]) return false;
        } else if (walls[direction.name] === opening) return false;
      }
    }
  }
  const minimumLength = maze.qualityConstraints?.minimumSolutionLength ?? MIN_SOLUTION_LENGTH[`${maze.width}x${maze.height}`] ?? 1;
  return isConnected(maze) && (getShortestPath(maze)?.length ?? 0) - 1 >= minimumLength;
}

/** Canonical renderable closed edges, deduplicated from the cell wall graph. */
export function getWallSegments(maze) {
  const segments = [];
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    if (!maze.cells[y]?.[x]) continue;
    const walls = maze.cells[y][x].walls;
    const northNeighbor = inBounds(maze, { x, y: y - 1 }) ? maze.cells[y - 1][x] : null;
    const westNeighbor = inBounds(maze, { x: x - 1, y }) ? maze.cells[y][x - 1] : null;
    const northBlocked = northNeighbor ? walls.N || northNeighbor.walls.S : walls.N;
    const westBlocked = westNeighbor ? walls.W || westNeighbor.walls.E : walls.W;
    if (northBlocked) segments.push({ orientation: 'horizontal', x, y });
    if (westBlocked) segments.push({ orientation: 'vertical', x, y });
    if (!inBounds(maze, { x: x + 1, y }) && walls.E) segments.push({ orientation: 'vertical', x: x + 1, y });
    if (!inBounds(maze, { x, y: y + 1 }) && walls.S) segments.push({ orientation: 'horizontal', x, y: y + 1 });
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
  // Cell navigation establishes a route only. Finishing is a physical trace
  // across the declared perimeter opening and is decided by the tracer.
  return { path: updated, moved: true, complete: false };
}
