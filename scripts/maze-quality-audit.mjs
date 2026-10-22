import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { canMove, createMazeForDifficulty, DIRECTIONS, FREE_PLAY_DIFFICULTIES, getShortestPath } from '../src/maze.js';
import { mazeLayoutId } from '../src/trace-diagnostics.js';

const MINIMUM_ROUTE_LENGTH = { easy: 18, medium: 28, hard: 42 };
const HARD_MIN_ROUTE_JUNCTIONS = 6;
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const GATE_THRESHOLDS = [0, 2, 5];

export function seededRandom(seed) {
  let value = seed + 1;
  return () => { value = (value * 48271) % 2147483647; return value / 2147483647; };
}

function key(cell) { return `${cell.x},${cell.y}`; }

function neighbors(maze, cell) {
  return DIRECTIONS.map(({ dx, dy }) => ({ x: cell.x + dx, y: cell.y + dy }))
    .filter(next => canMove(maze, cell, next));
}

function allCells(maze) {
  return Array.from({ length: maze.height }, (_, y) => Array.from({ length: maze.width }, (_, x) => ({ x, y }))).flat();
}

function reachable(maze, start, blocked = null) {
  if (blocked && key(start) === key(blocked)) return new Set();
  const seen = new Set([key(start)]), queue = [{ ...start }];
  for (let index = 0; index < queue.length; index++) {
    const here = queue[index];
    for (const next of neighbors(maze, here)) {
      const nextKey = key(next);
      if (blocked && nextKey === key(blocked) || seen.has(nextKey)) continue;
      seen.add(nextKey);
      queue.push(next);
    }
  }
  return seen;
}

function componentSizes(maze, members) {
  const unseen = new Set(members), sizes = [];
  while (unseen.size) {
    const first = unseen.values().next().value;
    unseen.delete(first);
    const queue = [first];
    for (let index = 0; index < queue.length; index++) {
      const [x, y] = queue[index].split(',').map(Number);
      for (const next of neighbors(maze, { x, y })) {
        const nextKey = key(next);
        if (unseen.delete(nextKey)) queue.push(nextKey);
      }
    }
    sizes.push(queue.length);
  }
  return sizes.sort((a, b) => b - a);
}

function graphComponentsWithout(maze, blocked) {
  const unseen = new Set(allCells(maze).map(key));
  unseen.delete(key(blocked));
  const componentByCell = new Map(), componentSizesById = [];
  while (unseen.size) {
    const first = unseen.values().next().value;
    unseen.delete(first);
    const queue = [first], id = componentSizesById.length;
    componentByCell.set(first, id);
    for (let index = 0; index < queue.length; index++) {
      const [x, y] = queue[index].split(',').map(Number);
      for (const next of neighbors(maze, { x, y })) {
        const nextKey = key(next);
        if (unseen.delete(nextKey)) {
          componentByCell.set(nextKey, id);
          queue.push(nextKey);
        }
      }
    }
    componentSizesById.push(queue.length);
  }
  return { componentByCell, componentSizesById };
}

function endpointCandidates(maze) {
  const openings = [];
  for (let x = 1; x < maze.width - 1; x++) openings.push({ cell: { x, y: 0 }, side: 'N' });
  for (let y = 1; y < maze.height - 1; y++) openings.push({ cell: { x: maze.width - 1, y }, side: 'E' });
  for (let x = maze.width - 2; x > 0; x--) openings.push({ cell: { x, y: maze.height - 1 }, side: 'S' });
  for (let y = maze.height - 2; y > 0; y--) openings.push({ cell: { x: 0, y }, side: 'W' });
  return openings;
}

function candidateEndpointPairs(maze, difficulty) {
  const openings = endpointCandidates(maze), pairs = [];
  const degreeByCell = new Map(allCells(maze).map(cell => [key(cell), neighbors(maze, cell).length]));
  const degree = cell => degreeByCell.get(key(cell));
  const hard = difficulty === 'hard';
  for (const entrance of openings) {
    const routeDistance = new Map([[key(entrance.cell), 0]]);
    const junctionPrefix = new Map([[key(entrance.cell), Number(degree(entrance.cell) >= 3)]]);
    const queue = [entrance.cell];
    for (let index = 0; index < queue.length; index++) {
      const here = queue[index], hereKey = key(here);
      for (const next of neighbors(maze, here)) {
        const nextKey = key(next);
        if (routeDistance.has(nextKey)) continue;
        routeDistance.set(nextKey, routeDistance.get(hereKey) + 1);
        junctionPrefix.set(nextKey, junctionPrefix.get(hereKey) + Number(degree(next) >= 3));
        queue.push(next);
      }
    }
    for (const exit of openings) {
      if (key(entrance.cell) === key(exit.cell)) continue;
      const exitKey = key(exit.cell), length = routeDistance.get(exitKey);
      if (length === undefined || length < MINIMUM_ROUTE_LENGTH[difficulty]) continue;
      const junctions = junctionPrefix.get(exitKey) - Number(degree(entrance.cell) >= 3) - Number(degree(exit.cell) >= 3);
      if (hard && junctions < HARD_MIN_ROUTE_JUNCTIONS) continue;
      pairs.push({ entrance, exit, junctions, length, exitDegree: degree(exit.cell) });
    }
  }
  if (hard) {
    const target = pairs.filter(pair => pair.length >= 50);
    return target.length ? target : pairs;
  }
  const withDecisions = pairs.filter(pair => pair.junctions >= 2);
  return withDecisions.length ? withDecisions : pairs;
}

/** Analyze real cell connectivity. The denominator is every internal maze cell. */
export function analyzeMazeQuality(maze) {
  const cells = allCells(maze), total = cells.length, route = getShortestPath(maze);
  if (!route) throw new Error('Maze exit is not reachable from its start.');
  const fullReachable = reachable(maze, maze.start);
  const beforeExit = reachable(maze, maze.start, maze.end);
  const routeKeys = new Set(route.map(key));
  const gatedKeys = cells.map(key).filter(cellKey => cellKey !== key(maze.end) && !beforeExit.has(cellKey));
  const optionalAccessibleKeys = cells.map(key).filter(cellKey => beforeExit.has(cellKey) && !routeKeys.has(cellKey));
  const solutionEdges = route.length - 1;
  const distanceFromExit = new Map([[key(maze.end), 0]]), queue = [maze.end];
  for (let index = 0; index < queue.length; index++) {
    const here = queue[index];
    for (const next of neighbors(maze, here)) if (!distanceFromExit.has(key(next))) {
      distanceFromExit.set(key(next), distanceFromExit.get(key(here)) + 1);
      queue.push(next);
    }
  }
  const graphLeaves = cells.filter(cell => neighbors(maze, cell).length === 1);
  const nearestLeafDistance = Math.min(...graphLeaves.map(cell => distanceFromExit.get(key(cell)) ?? Infinity));
  const gatedRegionSizes = componentSizes(maze, gatedKeys);
  const optionalBranchSizes = componentSizes(maze, optionalAccessibleKeys);
  const exitDegree = neighbors(maze, maze.end).length;
  const internalPassageEdges = cells.reduce((sum, cell) => sum + neighbors(maze, cell).length, 0) / 2;
  const result = {
    totalTraversableCells: total,
    fullReachableCells: fullReachable.size,
    internalPassageEdges,
    cycleRank: internalPassageEdges - total + 1,
    solutionPathEdges: solutionEdges,
    solutionPathCells: route.length,
    solutionPathCoveragePercent: route.length / total * 100,
    exitDegree,
    exitClassification: exitDegree === 1 ? 'dead-end' : exitDegree === 2 ? 'corridor' : exitDegree >= 3 ? 'junction' : 'isolated',
    graphLeafCount: graphLeaves.length,
    exitDistanceToNearestLeaf: nearestLeafDistance,
    reachableWithoutExit: beforeExit.size,
    exitGatedCells: gatedKeys.length,
    exitGatedPercent: gatedKeys.length / total * 100,
    exitGatedRegionSizes: gatedRegionSizes,
    optionalAccessibleCells: optionalAccessibleKeys.length,
    optionalBranchCount: optionalBranchSizes.length,
    optionalBranchSizes,
    largestOptionalBranch: optionalBranchSizes[0] ?? 0,
  };
  if (result.fullReachableCells !== total || beforeExit.has(key(maze.end))) throw new Error('Reachability invariant failed.');
  return result;
}

export function renderClassifiedMaze(maze) {
  analyzeMazeQuality(maze);
  const route = new Set(getShortestPath(maze).map(key));
  const beforeExit = reachable(maze, maze.start, maze.end);
  const gated = new Set(allCells(maze).map(key).filter(cellKey => cellKey !== key(maze.end) && !beforeExit.has(cellKey)));
  const top = [], body = [];
  for (let y = 0; y < maze.height; y++) {
    let north = '', row = '';
    for (let x = 0; x < maze.width; x++) {
      const cell = maze.cells[y][x], cellKey = key(cell);
      north += `+${cell.walls.N ? '---' : '   '}`;
      const marker = cellKey === key(maze.start) ? 'S' : cellKey === key(maze.end) ? 'E' : gated.has(cellKey) ? '#' : route.has(cellKey) ? '*' : 'o';
      row += `${cell.walls.W ? '|' : ' '}${` ${marker} `}`;
      if (x === maze.width - 1) row += cell.walls.E ? '|' : ' ';
    }
    top.push(`${north}+`);
    body.push(row);
  }
  let south = '';
  for (let x = 0; x < maze.width; x++) south += `+${maze.cells[maze.height - 1][x].walls.S ? '---' : '   '}`;
  return [...top.flatMap((line, row) => [line, body[row]]), `${south}+`].join('\n');
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return null;
  const position = (ordered.length - 1) * fraction, lower = Math.floor(position), upper = Math.ceil(position);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function summarize(values) {
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    max: values.reduce((largest, value) => Math.max(largest, value), -Infinity),
  };
}

function summarizeExitGated(values) {
  return {
    ...summarize(values),
    zeroPercent: values.filter(value => value === 0).length / values.length * 100,
    moreThan5Percent: values.filter(value => value > 5).length / values.length * 100,
    moreThan10Percent: values.filter(value => value > 10).length / values.length * 100,
    moreThan20Percent: values.filter(value => value > 20).length / values.length * 100,
    moreThan25Percent: values.filter(value => value > 25).length / values.length * 100,
  };
}

/** Deterministic sample through createMazeForDifficulty, the production entry point. */
export function runMazeQualityAudit({ samples = 500, startSeed = 0 } = {}) {
  if (!Number.isInteger(samples) || samples < 1) throw new RangeError('samples must be a positive integer');
  const results = {};
  for (const difficulty of DIFFICULTIES) {
    const mazes = [], generationTimes = [], analysisTimes = [];
    const candidateTotals = Object.fromEntries(GATE_THRESHOLDS.map(threshold => [threshold, {
      viable: 0,
      eligiblePairs: 0,
      eligibleRouteLengths: [],
      startSideMazes: Object.fromEntries(['N', 'E', 'S', 'W'].map(side => [side, 0])),
      exitSideMazes: Object.fromEntries(['N', 'E', 'S', 'W'].map(side => [side, 0])),
      arrangements: Object.fromEntries(['N', 'E', 'S', 'W'].flatMap(startSide => ['N', 'E', 'S', 'W'].map(exitSide => [`${startSide}-${exitSide}`, 0]))),
    }]));
    let candidatePairTotal = 0;
    for (let offset = 0; offset < samples; offset++) {
      const seed = startSeed + offset, baseRandom = seededRandom(seed);
      let randomCalls = 0;
      const random = () => { randomCalls++; return baseRandom(); };
      const started = performance.now();
      const maze = createMazeForDifficulty(difficulty, random);
      generationTimes.push(performance.now() - started);
      const analysisStarted = performance.now();
      const metrics = analyzeMazeQuality(maze);
      const candidates = candidateEndpointPairs(maze, difficulty);
      const componentMemo = new Map();
      for (const pair of candidates) {
        const exitKey = key(pair.exit.cell);
        let components = componentMemo.get(exitKey);
        if (!components) {
          components = graphComponentsWithout(maze, pair.exit.cell);
          componentMemo.set(exitKey, components);
        }
        const startComponent = components.componentByCell.get(key(pair.entrance.cell));
        const accessible = startComponent === undefined ? 0 : components.componentSizesById[startComponent];
        pair.exitGatedCells = maze.width * maze.height - 1 - accessible;
        pair.exitGatedPercent = pair.exitGatedCells / (maze.width * maze.height) * 100;
      }
      analysisTimes.push(performance.now() - analysisStarted);
      candidatePairTotal += candidates.length;
      for (const threshold of GATE_THRESHOLDS) {
        const eligiblePairs = candidates.filter(pair => pair.exitGatedPercent <= threshold);
        const eligible = eligiblePairs.length;
        candidateTotals[threshold].eligiblePairs += eligible;
        candidateTotals[threshold].viable += Number(eligible > 0);
        for (const pair of eligiblePairs) candidateTotals[threshold].eligibleRouteLengths.push(pair.length);
        for (const side of new Set(eligiblePairs.map(pair => pair.entrance.side))) candidateTotals[threshold].startSideMazes[side]++;
        for (const side of new Set(eligiblePairs.map(pair => pair.exit.side))) candidateTotals[threshold].exitSideMazes[side]++;
        for (const arrangement of new Set(eligiblePairs.map(pair => `${pair.entrance.side}-${pair.exit.side}`))) candidateTotals[threshold].arrangements[arrangement]++;
      }
      mazes.push({
        seed,
        difficulty,
        width: maze.width,
        height: maze.height,
        layoutId: mazeLayoutId(maze),
        start: { ...maze.start, edge: maze.entrance.side },
        exit: { ...maze.end, edge: maze.exit.side },
        generationAttempts: maze.generationAttempts ?? (randomCalls - 1) / (maze.width * maze.height - 1),
        generationMs: generationTimes.at(-1),
        analysisMs: analysisTimes.at(-1),
        ...metrics,
      });
    }
    const gated = mazes.map(maze => maze.exitGatedPercent);
    const candidateThresholds = Object.fromEntries(GATE_THRESHOLDS.map(threshold => {
      const { viable, eligiblePairs, eligibleRouteLengths, startSideMazes, exitSideMazes, arrangements } = candidateTotals[threshold];
      const maxAttempts = difficulty === 'hard' ? 8 : 32;
      return [`${threshold}%`, {
        mazesWithAtLeastOneCandidate: viable,
        viabilityPercent: viable / samples * 100,
        meanEligiblePairs: eligiblePairs / samples,
        eligibleSolutionLengthEdges: summarize(eligibleRouteLengths),
        mazesWithStartSideCandidate: startSideMazes,
        mazesWithExitSideCandidate: exitSideMazes,
        mazesWithArrangementCandidate: arrangements,
        estimatedRetriesIfIndependent: viable ? 1 / (viable / samples) : null,
        maxAttempts,
        estimatedRetryExhaustionPercentIfIndependent: (1 - viable / samples) ** maxAttempts * 100,
        sampleIsConditionedOnCurrentGeneratorAcceptance: true,
      }];
    }));
    const terminal = candidateThresholds['0%'];
    const shares = threshold => gated.filter(value => value > threshold).length / samples * 100;
    const sortedGated = [...mazes].sort((a, b) => b.exitGatedPercent - a.exitGatedPercent || a.seed - b.seed);
    const slowestGeneration = [...mazes].sort((a, b) => b.generationMs - a.generationMs).slice(0, 5);
    results[difficulty] = {
      dimensions: `${FREE_PLAY_DIFFICULTIES[difficulty].width}x${FREE_PLAY_DIFFICULTIES[difficulty].height}`,
      sampleCount: samples,
      seedRange: [startSeed, startSeed + samples - 1],
      exitGatedPercent: summarizeExitGated(gated),
      shareAboveThresholdPercent: { 5: shares(5), 10: shares(10), 20: shares(20), 25: shares(25) },
      exitDegreeCounts: Object.fromEntries(['dead-end', 'corridor', 'junction', 'isolated'].map(kind => [kind, mazes.filter(maze => maze.exitClassification === kind).length])),
      internalPassageEdgeMean: mazes.reduce((sum, maze) => sum + maze.internalPassageEdges, 0) / samples,
      cycleRankCounts: Object.fromEntries([...new Set(mazes.map(maze => maze.cycleRank))].sort((a, b) => a - b).map(rank => [rank, mazes.filter(maze => maze.cycleRank === rank).length])),
      generationAttempts: { mean: mazes.reduce((sum, maze) => sum + maze.generationAttempts, 0) / samples, max: Math.max(...mazes.map(maze => maze.generationAttempts)), retriesObserved: mazes.filter(maze => maze.generationAttempts > 1).length },
      exitsWithAdditionalInternalBranches: mazes.filter(maze => maze.exitDegree > 1).length,
      meanExitGatedRegionCount: mazes.reduce((sum, maze) => sum + maze.exitGatedRegionSizes.length, 0) / samples,
      meanLargestExitGatedRegion: mazes.reduce((sum, maze) => sum + (maze.exitGatedRegionSizes[0] ?? 0), 0) / samples,
      meanExitGatedCells: mazes.reduce((sum, maze) => sum + maze.exitGatedCells, 0) / samples,
      meanSolutionEdges: mazes.reduce((sum, maze) => sum + maze.solutionPathEdges, 0) / samples,
      solutionEdges: summarize(mazes.map(maze => maze.solutionPathEdges)),
      meanSolutionCoveragePercent: mazes.reduce((sum, maze) => sum + maze.solutionPathCoveragePercent, 0) / samples,
      meanOptionalAccessibleCells: mazes.reduce((sum, maze) => sum + maze.optionalAccessibleCells, 0) / samples,
      meanOptionalBranchCount: mazes.reduce((sum, maze) => sum + maze.optionalBranchCount, 0) / samples,
      meanLargestOptionalBranch: mazes.reduce((sum, maze) => sum + maze.largestOptionalBranch, 0) / samples,
      meanGraphLeaves: mazes.reduce((sum, maze) => sum + maze.graphLeafCount, 0) / samples,
      meanExitDistanceToNearestLeaf: mazes.reduce((sum, maze) => sum + maze.exitDistanceToNearestLeaf, 0) / samples,
      endpointQualityCandidatePairs: { mean: candidatePairTotal / samples, gateThresholds: candidateThresholds },
      generationMs: { mean: generationTimes.reduce((sum, value) => sum + value, 0) / samples, median: percentile(generationTimes, 0.5), p95: percentile(generationTimes, 0.95), max: Math.max(...generationTimes) },
      analysisMs: { mean: analysisTimes.reduce((sum, value) => sum + value, 0) / samples, median: percentile(analysisTimes, 0.5), p95: percentile(analysisTimes, 0.95), max: Math.max(...analysisTimes) },
      slowestGenerationSamples: slowestGeneration,
      worstExamples: sortedGated.slice(0, 5),
      samples: mazes,
    };
    results[difficulty].terminalExitCandidateAvailabilityPercent = terminal.viabilityPercent;
  }
  return {
    method: 'production createMazeForDifficulty with deterministic Park-Miller seed stream matching test/maze.test.js',
    sampleCountPerDifficulty: samples,
    startSeed,
    denominator: 'all width × height internal cells; the exit cell itself is excluded from exit-gated count but remains included in the denominator',
    graphTopology: 'measured from authoritative reciprocal N/E/S/W passages, not assumed by the analyzer',
    strategyThresholds: GATE_THRESHOLDS,
    difficulties: results,
  };
}

function main() {
  const samplesArg = process.argv.find(arg => arg.startsWith('--samples='));
  const startSeedArg = process.argv.find(arg => arg.startsWith('--start-seed='));
  const summaryOnly = process.argv.includes('--summary');
  const samples = samplesArg ? Number(samplesArg.split('=')[1]) : 500;
  const startSeed = startSeedArg ? Number(startSeedArg.split('=')[1]) : 0;
  if (!Number.isInteger(samples) || !Number.isInteger(startSeed) || startSeed < 0) throw new RangeError('Use integer --samples and non-negative --start-seed values.');
  const report = runMazeQualityAudit({ samples, startSeed });
  if (process.argv.includes('--table')) {
    const table = Object.fromEntries(Object.entries(report.difficulties).map(([difficulty, result]) => [difficulty, {
      dimensions: result.dimensions,
      exitGatedPercent: result.exitGatedPercent,
      exitDegreeCounts: result.exitDegreeCounts,
      meanExitGatedCells: result.meanExitGatedCells,
      meanLargestExitGatedRegion: result.meanLargestExitGatedRegion,
      meanSolutionEdges: result.meanSolutionEdges,
      solutionEdges: result.solutionEdges,
      meanSolutionCoveragePercent: result.meanSolutionCoveragePercent,
      generationAttempts: result.generationAttempts,
      candidatePairs: Object.fromEntries(Object.entries(result.endpointQualityCandidatePairs.gateThresholds).map(([threshold, candidate]) => [threshold, {
        viabilityPercent: candidate.viabilityPercent,
        meanEligiblePairs: candidate.meanEligiblePairs,
        eligibleSolutionLengthEdges: candidate.eligibleSolutionLengthEdges,
        candidateSideCoverage: {
          startSidesSeen: Object.keys(candidate.mazesWithStartSideCandidate).filter(side => candidate.mazesWithStartSideCandidate[side] > 0),
          exitSidesSeen: Object.keys(candidate.mazesWithExitSideCandidate).filter(side => candidate.mazesWithExitSideCandidate[side] > 0),
          sideArrangementsSeen: Object.keys(candidate.mazesWithArrangementCandidate).filter(arrangement => candidate.mazesWithArrangementCandidate[arrangement] > 0),
        },
        estimatedRetriesIfIndependent: candidate.estimatedRetriesIfIndependent,
        maxAttempts: candidate.maxAttempts,
      }])),
      generationMs: result.generationMs,
      analysisMs: result.analysisMs,
      worstExamples: result.worstExamples.slice(0, 1).map(({ seed, layoutId, start, exit, solutionPathEdges, exitDegree, exitGatedCells, exitGatedPercent, exitGatedRegionSizes, optionalAccessibleCells, largestOptionalBranch }) => ({ seed, layoutId, start, exit, solutionPathEdges, exitDegree, exitGatedCells, exitGatedPercent, exitGatedRegionSizes, optionalAccessibleCells, largestOptionalBranch })),
    }]));
    process.stdout.write(`${JSON.stringify({ sampleCountPerDifficulty: samples, seedRange: [startSeed, startSeed + samples - 1], table }, null, 2)}\n`);
    return;
  }
  if (summaryOnly) for (const [difficulty, result] of Object.entries(report.difficulties)) {
    delete result.samples;
    delete result.slowestGenerationSamples;
    for (const candidate of Object.values(result.endpointQualityCandidatePairs.gateThresholds)) {
      candidate.candidateSideCoverage = {
        startSidesSeen: Object.keys(candidate.mazesWithStartSideCandidate).filter(side => candidate.mazesWithStartSideCandidate[side] > 0),
        exitSidesSeen: Object.keys(candidate.mazesWithExitSideCandidate).filter(side => candidate.mazesWithExitSideCandidate[side] > 0),
        sideArrangementsSeen: Object.keys(candidate.mazesWithArrangementCandidate).filter(arrangement => candidate.mazesWithArrangementCandidate[arrangement] > 0),
      };
      delete candidate.mazesWithStartSideCandidate;
      delete candidate.mazesWithExitSideCandidate;
      delete candidate.mazesWithArrangementCandidate;
    }
    result.worstExamples = result.worstExamples.slice(0, 3).map(({ seed, layoutId, start, exit, solutionPathEdges, exitDegree, exitClassification, exitGatedCells, exitGatedPercent, exitGatedRegionSizes, optionalAccessibleCells, largestOptionalBranch }) => ({
      seed, layoutId, start, exit, solutionPathEdges, exitDegree, exitClassification, exitGatedCells, exitGatedPercent, exitGatedRegionSizes, optionalAccessibleCells, largestOptionalBranch,
      diagram: renderClassifiedMaze(createMazeForDifficulty(difficulty, seededRandom(seed))),
    }));
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
