import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { canMove, createMazeForDifficulty, getShortestPath, isConnected, validateMaze, validatePath } from '../src/maze.js';
import { analyzeMazeQuality, seededRandom } from './maze-quality-audit.mjs';
import { mazeLayoutId } from '../src/trace-diagnostics.js';

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const CONFIG = Object.freeze({ easy: { min: 18, attempts: 32 }, medium: { min: 28, attempts: 32 }, hard: { min: 42, target: 50, junctionFloor: 6, attempts: 8 } });
const SIDES = ['N', 'E', 'S', 'W'];
const key = cell => `${cell.x},${cell.y}`;

function graphNeighbors(maze, cell) {
  return [
    { x: cell.x, y: cell.y - 1 }, { x: cell.x + 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 }, { x: cell.x - 1, y: cell.y },
  ].filter(next => canMove(maze, cell, next));
}

function branchMetrics(maze, route) {
  const routeKeys = new Set(route.map(key));
  const seen = new Set(routeKeys), sizes = [], depths = [];
  let branchEntrances = 0;
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const root = { x, y }, rootKey = key(root);
    if (seen.has(rootKey)) continue;
    seen.add(rootKey);
    const queue = [root], members = [];
    for (let index = 0; index < queue.length; index++) {
      const cell = queue[index]; members.push(cell);
      for (const next of graphNeighbors(maze, cell)) {
        const nextKey = key(next);
        if (routeKeys.has(nextKey)) { branchEntrances++; continue; }
        if (seen.has(nextKey)) continue;
        seen.add(nextKey); queue.push(next);
      }
    }
    const attachment = members.find(cell => graphNeighbors(maze, cell).some(next => routeKeys.has(key(next))));
    const memberKeys = new Set(members.map(key)), distances = new Map([[key(attachment), 0]]), depthQueue = [attachment];
    let maxDepth = 0;
    for (let index = 0; index < depthQueue.length; index++) {
      const cell = depthQueue[index], depth = distances.get(key(cell));
      maxDepth = Math.max(maxDepth, depth + 1);
      for (const next of graphNeighbors(maze, cell)) {
        const nextKey = key(next);
        if (!memberKeys.has(nextKey) || distances.has(nextKey)) continue;
        distances.set(nextKey, depth + 1); depthQueue.push(next);
      }
    }
    sizes.push(members.length); depths.push(maxDepth);
  }
  return { sizes: sizes.sort((a, b) => b - a), depths: depths.sort((a, b) => b - a), branchEntrances };
}

/** A choice point is a solution-route cell with at least one open continuation other than the solution's next edge (and the incoming edge, except at the start). */
export function analyzeDecisions(maze, route = getShortestPath(maze)) {
  if (!route?.length) throw new Error('A complete solution route is required.');
  const points = [];
  let alternatives = 0;
  for (let index = 0; index < route.length - 1; index++) {
    const cell = route[index], nextOnSolution = key(route[index + 1]);
    const previousOnSolution = index > 0 ? key(route[index - 1]) : null;
    const other = graphNeighbors(maze, cell).filter(next => key(next) !== nextOnSolution && key(next) !== previousOnSolution);
    if (other.length) {
      points.push({ cell: { x: cell.x, y: cell.y }, alternatives: other.length });
      alternatives += other.length;
    }
  }
  return { count: points.length, alternatives, points };
}

function collect(difficulty, samples, startSeed) {
  const rows = [];
  for (let offset = 0; offset < samples; offset++) {
    const seed = startSeed + offset;
    const started = performance.now();
    const maze = createMazeForDifficulty(difficulty, seededRandom(seed));
    const measuredDuration = performance.now() - started;
    const route = getShortestPath(maze);
    const quality = analyzeMazeQuality(maze);
    const decisions = analyzeDecisions(maze, route);
    const branches = branchMetrics(maze, route);
    const record = {
      seed, difficulty, width: maze.width, height: maze.height,
      startX: maze.start.x, startY: maze.start.y, startSide: maze.entrance.side,
      exitX: maze.end.x, exitY: maze.end.y, exitSide: maze.exit.side,
      solutionEdges: route.length - 1, routeJunctions: quality.solutionRouteJunctions,
      meaningfulDecisionPoints: decisions.count, alternativeContinuations: decisions.alternatives,
      optionalBranches: quality.optionalBranchCount, optionalCells: quality.optionalAccessibleCells,
      largestOptionalBranch: quality.largestOptionalBranch, maxOptionalBranchDepth: branches.depths[0] ?? 0,
      deadEnds: quality.graphLeafCount, exitGraphDegree: quality.exitDegree,
      exitGatedCells: quality.exitGatedCells, generationAttempts: maze.generationAttempts,
      generationMs: maze.generationDurationMs ?? measuredDuration,
      layoutId: mazeLayoutId(maze), maze, route,
      valid: validateMaze(maze) && isConnected(maze) && validatePath(maze, route),
    };
    if (!record.valid || record.exitGraphDegree !== 1 || record.exitGatedCells !== 0) throw new Error(`${difficulty} seed ${seed} violated generator invariants.`);
    rows.push(record);
  }
  return rows;
}

function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p, lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarize(rows) {
  const pick = field => rows.map(row => row[field]);
  const stats = values => ({ min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: quantile(values, .5), p10: quantile(values, .1), p25: quantile(values, .25),
    p75: quantile(values, .75), p90: quantile(values, .9), max: Math.max(...values) });
  const lengths = pick('solutionEdges'), junctions = pick('routeJunctions'), choices = pick('meaningfulDecisionPoints');
  const branches = pick('optionalBranches'), optionalCells = pick('optionalCells'), largest = pick('largestOptionalBranch');
  const deadEnds = pick('deadEnds'), attempts = pick('generationAttempts'), durations = pick('generationMs');
  const minimum = CONFIG[rows[0].difficulty].min;
  const histogram = field => Object.fromEntries([...new Set(pick(field))].sort((a, b) => a - b).map(value => [value, pick(field).filter(item => item === value).length]));
  return {
    n: rows.length, minimumAllowed: minimum, minimumPlusFiveShare: lengths.filter(value => value <= minimum + 5).length / rows.length,
    solutionEdges: stats(lengths), routeJunctions: stats(junctions), meaningfulDecisionPoints: stats(choices),
    routeJunctionDistribution: histogram('routeJunctions'), meaningfulDecisionDistribution: histogram('meaningfulDecisionPoints'),
    alternativesAtDecisionPoints: stats(pick('alternativeContinuations')),
    optionalBranches: stats(branches), optionalCells: stats(optionalCells), largestOptionalBranch: stats(largest),
    optionalBranchCountDistribution: histogram('optionalBranches'),
    maximumOptionalBranchDepth: stats(pick('maxOptionalBranchDepth')), deadEnds: stats(deadEnds), deadEndDistribution: histogram('deadEnds'),
    lowDecisionShare: choices.filter(value => value <= 1).length / rows.length,
    largeDirectShare: rows.filter(row => row.solutionEdges >= 40 && row.meaningfulDecisionPoints <= 2).length / rows.length,
    largeOptionalLowDecisionShare: rows.filter(row => row.optionalCells >= 50 && row.meaningfulDecisionPoints <= 2).length / rows.length,
    terminalExitShare: rows.filter(row => row.exitGraphDegree === 1).length / rows.length,
    gatedSamples: rows.filter(row => row.exitGatedCells > 0).length,
    meanAttempts: attempts.reduce((a, b) => a + b, 0) / rows.length,
    attemptCounts: Object.fromEntries([...new Set(attempts)].sort((a, b) => a - b).map(value => [value, attempts.filter(n => n === value).length])),
    retryLimit: CONFIG[rows[0].difficulty].attempts,
    meanGenerationMs: durations.reduce((a, b) => a + b, 0) / rows.length,
    maxGenerationMs: Math.max(...durations),
    startSideCounts: Object.fromEntries(SIDES.map(side => [side, rows.filter(row => row.startSide === side).length])),
    exitSideCounts: Object.fromEntries(SIDES.map(side => [side, rows.filter(row => row.exitSide === side).length])),
  };
}

function diagram(record) {
  const route = new Set(record.route.map(key));
  const body = [];
  for (let y = 0; y < record.height; y++) {
    let row = '';
    for (let x = 0; x < record.width; x++) {
      const cell = record.maze.cells[y][x], id = `${x},${y}`;
      row += cell.walls.W ? '|' : ' ';
      row += id === `${record.startX},${record.startY}` ? ' S ' : id === `${record.exitX},${record.exitY}` ? ' E ' : route.has(id) ? ' · ' : '   ';
    }
    row += record.maze.cells[y][record.width - 1].walls.E ? '|' : ' ';
    body.push(row);
    let walls = '';
    for (let x = 0; x < record.width; x++) walls += `+${record.maze.cells[y][x].walls.S ? '---' : '   '}`;
    body.push(`${walls}+`);
  }
  let top = '';
  for (let x = 0; x < record.width; x++) top += `+${record.maze.cells[0][x].walls.N ? '---' : '   '}`;
  return `${top}+\n${body.join('\n')}`;
}

function csv(rows) {
  const fields = ['seed','difficulty','width','height','startX','startY','startSide','exitX','exitY','exitSide','solutionEdges','routeJunctions','meaningfulDecisionPoints','alternativeContinuations','optionalBranches','optionalCells','largestOptionalBranch','maxOptionalBranchDepth','deadEnds','exitGraphDegree','exitGatedCells','generationAttempts','generationMs','layoutId','valid'];
  return [fields.join(','), ...rows.map(row => fields.map(field => JSON.stringify(row[field] ?? '')).join(','))].join('\n') + '\n';
}

function main() {
  const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=')[1];
  const samples = Number(arg('samples') ?? 500), startSeed = Number(arg('start-seed') ?? 0);
  if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(startSeed) || startSeed < 0) throw new RangeError('Expected positive --samples and non-negative --start-seed integers.');
  const results = Object.fromEntries(DIFFICULTIES.map(difficulty => [difficulty, collect(difficulty, samples, startSeed)]));
  if (process.argv.includes('--write-csv')) {
    const csvPath = process.argv[process.argv.indexOf('--write-csv') + 1];
    if (!csvPath) throw new Error('--write-csv requires an output path.');
    writeFileSync(csvPath, csv(results.medium), 'utf8');
  }
  const summaries = Object.fromEntries(DIFFICULTIES.map(difficulty => [difficulty, summarize(results[difficulty])]));
  const medium = results.medium;
  const easyExamples = [...medium].sort((a, b) => a.meaningfulDecisionPoints - b.meaningfulDecisionPoints || a.solutionEdges - b.solutionEdges || a.seed - b.seed).slice(0, 3);
  const substantialExamples = [...medium].sort((a, b) => b.meaningfulDecisionPoints - a.meaningfulDecisionPoints || b.solutionEdges - a.solutionEdges || a.seed - b.seed).slice(0, 3);
  const thresholds = [2, 3, 4, 5].map(minimumDecisions => {
    const accepted = medium.filter(row => row.meaningfulDecisionPoints >= minimumDecisions).length;
    const passRate = accepted / medium.length;
    return { minimumDecisions, accepted, share: passRate, estimatedMeanAttempts: passRate ? 1 / passRate : null,
      estimated32AttemptExhaustionPercent: (1 - passRate) ** 32 * 100 };
  });
  const output = {
    method: 'Production createMazeForDifficulty; deterministic Park–Miller random stream, same seed range for Easy/Medium/Hard.',
    seedRange: [startSeed, startSeed + samples - 1], sampleCountPerDifficulty: samples,
    definitions: {
      routeJunctions: 'Existing production metric: degree ≥3 on shortest route, excluding start and exit.',
      meaningfulDecisionPoints: 'Shortest-route cells before the exit with ≥1 legal off-route continuation after excluding the previous solution edge (except at start) and next solution edge. A forced corner is not counted.',
      alternatives: 'Total number of legal off-route continuations offered at those decision points.',
      nearMinimum: 'At most five solution edges above the configured minimum for that grid.',
      lowDecision: 'At most one meaningful decision point.',
      largeDirect: 'At least 40 solution edges and at most two meaningful decision points.',
      largeOptionalLowDecision: 'At least 50 cells outside the solution route and at most two meaningful decision points.',
      branch: 'Connected off-route components after deleting the shortest route; in generated perfect mazes each is one wrong-turn branch.'
    },
    summaries,
    simulatedDecisionFloors: thresholds.map(item => ({ ...item, method: 'Post-selection rejection and independent resampling estimate based on the observed current-generator sample; topology-level alternative-candidate selection could reduce actual retries.' })),
    easiestMediumExamples: easyExamples.map(row => ({ ...Object.fromEntries(Object.entries(row).filter(([k]) => !['maze','route','valid'].includes(k))), diagram: diagram(row) })),
    substantialMediumExamples: substantialExamples.map(row => ({ ...Object.fromEntries(Object.entries(row).filter(([k]) => !['maze','route','valid'].includes(k))), diagram: diagram(row) })),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
