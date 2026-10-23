import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { canMove, countActiveCells, DIRECTIONS, getMaskBoundaryEdges, getShortestPath, getWallSegments, inBounds } from '../src/maze.js';
import { SHAPE_REGISTRY } from '../src/shapes.js';
import { validateShapedMaze } from '../src/shaped-mazes.js';
import { createTraceSession } from '../src/tracing.js';
import { mazeLayoutId } from '../src/trace-diagnostics.js';

const SAMPLE_COUNT = 500;
const round = value => Math.round(value * 100) / 100;
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
const seeded = seed => {
  let value = seed + 1;
  return () => { value = value * 48271 % 2147483647; return value / 2147483647; };
};
const sideCounts = () => ({ N: 0, E: 0, S: 0, W: 0 });
const summary = values => values.length ? ({ mean: round(values.reduce((sum, value) => sum + value, 0) / values.length), median: percentile(values, .5), p10: percentile(values, .1), p90: percentile(values, .9), p95: percentile(values, .95), min: Math.min(...values), max: Math.max(...values) }) : null;

function traverseCellsWithTracer(maze, route) {
  const trace = createTraceSession(maze);
  assert.equal(trace.beginSteering(1), true);
  for (let index = 1; index < route.length; index++) {
    const delta = { x: route[index].x - route[index - 1].x, y: route[index].y - route[index - 1].y };
    const movement = trace.steer(1, delta);
    assert.equal(movement.blocked, false, `legal solution movement is accepted at step ${index}`);
    assert.equal(movement.complete, false, 'entering the exit cell does not complete');
  }
  assert.equal(trace.diagnostics.currentlyInExitCell, true);
  assert.equal(trace.diagnostics.completionCommitted, false);
  const outward = maze.exit.side === 'N' ? { x: 0, y: -.9 } : maze.exit.side === 'E' ? { x: .9, y: 0 }
    : maze.exit.side === 'S' ? { x: 0, y: .9 } : { x: -.9, y: 0 };
  const finish = trace.steer(1, outward);
  assert.equal(finish.complete, true, 'the designated perimeter crossing completes');
  assert.equal(trace.diagnostics.completionCommitted, true);
  assert.equal(trace.strokeBreaks.length, 0, 'finish ink remains continuous');
  assert.ok(Math.hypot(trace.position.x - maze.end.x, trace.position.y - maze.end.y) > .5);
  return trace;
}

function auditNonExitBoundary(maze, openings) {
  const forbidden = getMaskBoundaryEdges(maze).find(edge => !openings.some(opening => opening.cell.x === edge.cell.x
    && opening.cell.y === edge.cell.y && opening.side === edge.side));
  assert.ok(forbidden, 'silhouette has a closed outer edge');
  const route = getShortestPath(maze, maze.start, forbidden.cell);
  assert.ok(route);
  const trace = createTraceSession(maze);
  assert.equal(trace.beginSteering(9), true);
  for (let index = 1; index < route.length; index++) {
    const movement = trace.steer(9, { x: route[index].x - route[index - 1].x, y: route[index].y - route[index - 1].y });
    assert.equal(movement.blocked, false);
  }
  const outward = forbidden.side === 'N' ? { x: 0, y: -.9 } : forbidden.side === 'E' ? { x: .9, y: 0 }
    : forbidden.side === 'S' ? { x: 0, y: .9 } : { x: -.9, y: 0 };
  const rejected = trace.steer(9, outward);
  assert.equal(rejected.complete, false);
  assert.equal(rejected.blocked, true, 'closed silhouette boundary rejects outward movement');
}

function auditDiagonalCorner(maze) {
  for (let y = 0; y < maze.height - 1; y++) for (let x = 0; x < maze.width - 1; x++) {
    for (const [source, target] of [[{ x, y }, { x: x + 1, y: y + 1 }], [{ x: x + 1, y }, { x, y: y + 1 }]]) {
      if (!inBounds(maze, source) || !inBounds(maze, target)) continue;
      const orthogonalA = { x: target.x, y: source.y }, orthogonalB = { x: source.x, y: target.y };
      if (canMove(maze, source, orthogonalA) || canMove(maze, source, orthogonalB)) continue;
      const route = getShortestPath(maze, maze.start, source);
      assert.ok(route);
      const trace = createTraceSession(maze);
      assert.equal(trace.beginSteering(77), true);
      for (let index = 1; index < route.length; index++) {
        const move = trace.steer(77, { x: route[index].x - route[index - 1].x, y: route[index].y - route[index - 1].y });
        assert.equal(move.blocked, false);
      }
      const move = trace.steer(77, { x: Math.sign(target.x - source.x) * .9, y: Math.sign(target.y - source.y) * .9 });
      assert.equal(move.blocked, true, 'diagonal corner cutting is rejected by the shared tracer');
      assert.deepEqual(trace.diagnostics.cell, source, 'the diagonal attempt cannot enter the diagonal-only target cell');
      assert.ok(Math.abs(trace.position.x - target.x) > .5 || Math.abs(trace.position.y - target.y) > .5);
      return true;
    }
  }
  return false;
}

function seedRow(shape, seed) {
  const random = seeded(seed), maze = shape.generator(random, seed, 'chosen');
  assert.equal(maze.seed, seed);
  assert.equal(validateShapedMaze(maze, shape), true);
  assert.equal(countActiveCells(maze), maze.activeCellCount);
  assert.equal(maze.generationQuality.exitInternalDegree, 1);
  assert.equal(maze.generationQuality.exitGatedCells, 0);
  assert.notDeepEqual(maze.start, maze.end);
  assert.ok(maze.generationAttempts <= 64);
  const route = getShortestPath(maze);
  assert.ok(route.length - 1 >= maze.qualityConstraints.minimumSolutionLength);
  assert.ok(maze.generationQuality.meaningfulDecisions >= maze.qualityConstraints.minimumMeaningfulDecisions);
  assert.ok(maze.generationQuality.optionalBranchCount >= maze.qualityConstraints.minimumOptionalBranches);
  assert.ok(maze.generationQuality.optionalAccessibleCells >= maze.qualityConstraints.minimumOptionalCells);
  assert.ok(maze.generationQuality.largestOptionalBranch <= maze.qualityConstraints.maximumOptionalBranchCells);
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    if (!maze.mask[y][x]) {
      assert.equal(maze.cells[y][x], null);
      assert.equal(inBounds(maze, { x, y }), false);
      continue;
    }
    for (const direction of DIRECTIONS) {
      const next = { x: x + direction.dx, y: y + direction.dy };
      if (inBounds(maze, next)) assert.equal(maze.cells[y][x].walls[direction.name], maze.cells[next.y][next.x].walls[direction.opposite]);
    }
  }
  const wallSegments = getWallSegments(maze);
  assert.equal(wallSegments.length, new Set(wallSegments.map(wall => `${wall.orientation}:${wall.x},${wall.y}`)).size);
  const declared = [maze.entrance, maze.exit];
  for (const edge of getMaskBoundaryEdges(maze)) {
    const intentional = declared.some(opening => opening.cell.x === edge.cell.x && opening.cell.y === edge.cell.y && opening.side === edge.side);
    assert.equal(maze.cells[edge.cell.y][edge.cell.x].walls[edge.side], !intentional);
    assert.equal(canMove(maze, edge.cell, { x: edge.cell.x + DIRECTIONS.find(d => d.name === edge.side).dx, y: edge.cell.y + DIRECTIONS.find(d => d.name === edge.side).dy }), false);
  }
  traverseCellsWithTracer(maze, route);
  auditNonExitBoundary(maze, declared);
  const diagonalCornerRejected = auditDiagonalCorner(maze);
  return {
    shapeId: maze.shapeId, seed, width: maze.width, height: maze.height, id: mazeLayoutId(maze), activeCells: maze.activeCellCount,
    start: { ...maze.start, side: maze.entrance.side }, exit: { ...maze.end, side: maze.exit.side },
    exitInternalDegree: maze.generationQuality.exitInternalDegree, exitGatedCells: maze.generationQuality.exitGatedCells,
    solutionLength: route.length - 1,
    decisions: maze.generationQuality.meaningfulDecisions,
    routeJunctions: maze.generationQuality.solutionRouteJunctions,
    branches: maze.generationQuality.optionalBranchCount,
    branchSizes: [...maze.generationQuality.optionalBranchSizes],
    optionalCells: maze.generationQuality.optionalAccessibleCells,
    largestBranch: maze.generationQuality.largestOptionalBranch,
    deadEnds: maze.generationQuality.deadEndCount,
    diagonalCornerRejected,
    startSide: maze.entrance.side, exitSide: maze.exit.side,
    attempts: maze.generationAttempts, duration: maze.generationDurationMs ?? 0,
    retryCount: maze.generationAttempts - 1,
  };
}

const rows = [];
const report = {
  title: 'Shaped Mazes Phase 1 — Deterministic Production Generator Audit',
  createdAt: new Date().toISOString(),
  method: 'For each registered shape, generate seeds 0–499 through the production registry generator, validate the canonical mask/wall graph and exact two perimeter openings, traverse the shortest route through createTraceSession.steer, confirm exit-cell entry does not complete, then cross the declared exit. A separate tracer pass attempts one non-exit mask boundary per seed.',
  sampleCountPerShape: SAMPLE_COUNT,
  shapes: [],
};

for (const shape of SHAPE_REGISTRY) {
  const sampleRows = [];
  const startedAt = performance.now();
  for (let seed = 0; seed < SAMPLE_COUNT; seed++) {
    try { sampleRows.push(seedRow(shape, seed)); }
    catch (error) { sampleRows.push({ seed, failure: error instanceof Error ? error.message : String(error) }); }
  }
  const wallClockMs = performance.now() - startedAt;
  const validRows = sampleRows.filter(row => !row.failure);
  const failedRows = sampleRows.filter(row => row.failure);
  const ids = new Set(validRows.map(row => row.id));
  const starts = sideCounts(), exits = sideCounts();
  for (const row of validRows) { starts[row.startSide]++; exits[row.exitSide]++; }
  for (const side of ['N', 'E', 'S', 'W']) {
    assert.ok(starts[side] > 0, `${shape.id}: at least one sampled start uses ${side}`);
    assert.ok(exits[side] > 0, `${shape.id}: at least one sampled exit uses ${side}`);
  }
  const entry = {
    id: shape.id, name: shape.name, width: shape.geometryProvider()[0].length,
    height: shape.geometryProvider().length, activeCells: validRows[0]?.activeCells ?? shape.geometryProvider().reduce((sum, row) => sum + row.filter(Boolean).length, 0),
    sampleCount: sampleRows.length, valid: validRows.length, failures: failedRows.length, failedSeeds: failedRows,
    uniqueLayouts: ids.size, layoutVariation: round(ids.size / Math.max(1, validRows.length)),
    startSides: starts, exitSides: exits,
    solutionLength: summary(validRows.map(row => row.solutionLength)),
    meaningfulDecisions: summary(validRows.map(row => row.decisions)),
    routeJunctions: summary(validRows.map(row => row.routeJunctions)),
    optionalBranches: summary(validRows.map(row => row.branches)),
    optionalCells: summary(validRows.map(row => row.optionalCells)),
    largestOptionalBranch: summary(validRows.map(row => row.largestBranch)),
    deadEnds: summary(validRows.map(row => row.deadEnds)),
    diagonalCornerChecks: validRows.filter(row => row.diagonalCornerRejected).length,
    generationDurationMs: summary(validRows.map(row => row.duration)),
    generationAttempts: summary(validRows.map(row => row.attempts)),
    totalWallClockSeconds: round(wallClockMs / 1000),
    samples: sampleRows,
  };
  report.shapes.push(entry);
  console.log(`${shape.id}: ${entry.valid}/${SAMPLE_COUNT} valid, ${entry.uniqueLayouts} unique, mean ${entry.generationDurationMs?.mean ?? 'n/a'}ms, max attempts ${entry.generationAttempts?.max ?? 'n/a'}, failures ${entry.failures}`);
}

const markdown = [
  '# Shaped Mazes Phase 1 — Production Audit', '',
  `Generated ${report.createdAt}.`, '',
  report.method, '',
  '| Shape | Grid | Active cells | Valid samples | Unique layouts | Route mean / median / min / P10 / P90 | Decisions mean / median | Branches mean | Generation ms mean / P95 / max | Attempts mean / max |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...report.shapes.map(shape => `| ${shape.name} (${shape.id}) | ${shape.width}×${shape.height} | ${shape.activeCells} | ${shape.valid}/${SAMPLE_COUNT} | ${shape.uniqueLayouts}/${SAMPLE_COUNT} | ${shape.solutionLength?.mean ?? 'n/a'} / ${shape.solutionLength?.median ?? 'n/a'} / ${shape.solutionLength?.min ?? 'n/a'} / ${shape.solutionLength?.p10 ?? 'n/a'} / ${shape.solutionLength?.p90 ?? 'n/a'} | ${shape.meaningfulDecisions?.mean ?? 'n/a'} / ${shape.meaningfulDecisions?.median ?? 'n/a'} | ${shape.optionalBranches?.mean ?? 'n/a'} | ${shape.generationDurationMs?.mean ?? 'n/a'} / ${shape.generationDurationMs?.p95 ?? 'n/a'} / ${shape.generationDurationMs?.max ?? 'n/a'} | ${shape.generationAttempts?.mean ?? 'n/a'} / ${shape.generationAttempts?.max ?? 'n/a'} |`),
  '',
  '## Opening-side distributions', '',
  '| Shape | Start N/E/S/W | Exit N/E/S/W |', '|---|---:|---:|',
  ...report.shapes.map(shape => `| ${shape.name} | ${shape.startSides.N}/${shape.startSides.E}/${shape.startSides.S}/${shape.startSides.W} | ${shape.exitSides.N}/${shape.exitSides.E}/${shape.exitSides.S}/${shape.exitSides.W} |`),
  '',
  '## Branch quality and generation retries', '',
  '| Shape | Route junctions mean / median | Branches mean / median | Optional cells mean / median | Largest branch mean / max | Dead ends mean / median | Attempts mean / max | Retry samples |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...report.shapes.map(shape => `| ${shape.name} | ${shape.routeJunctions?.mean ?? 'n/a'} / ${shape.routeJunctions?.median ?? 'n/a'} | ${shape.optionalBranches?.mean ?? 'n/a'} / ${shape.optionalBranches?.median ?? 'n/a'} | ${shape.optionalCells?.mean ?? 'n/a'} / ${shape.optionalCells?.median ?? 'n/a'} | ${shape.largestOptionalBranch?.mean ?? 'n/a'} / ${shape.largestOptionalBranch?.max ?? 'n/a'} | ${shape.deadEnds?.mean ?? 'n/a'} / ${shape.deadEnds?.median ?? 'n/a'} | ${shape.generationAttempts?.mean ?? 'n/a'} / ${shape.generationAttempts?.max ?? 'n/a'} | ${shape.samples.filter(row => row.retryCount > 0).length}/${shape.valid} |`),
  '',
  ...report.shapes.map(shape => `- ${shape.name}: ${shape.diagonalCornerChecks}/${shape.valid} samples had a blocked diagonal corner case exercised through the shared tracer.`),
  '',
  'All audited mazes were required to have connected active masks, reciprocal shared walls, exactly the declared entrance and exit external openings, a degree-one internal exit, zero exit-gated cells, a route meeting per-shape computed quality floors, and a single successful outward exit crossing. Each seed also attempted to cross a closed non-exit mask boundary and was rejected.', '',
  'The source of each raw sample and every generated layout fingerprint is available in the adjacent JSON report for reproducibility.', '',
].join('\n');

const root = resolve(import.meta.dirname, '..');
await writeFile(resolve(root, 'docs/SHAPED_MAZES_PHASE1_AUDIT.md'), markdown);
await writeFile(resolve(root, 'docs/SHAPED_MAZES_PHASE1_AUDIT.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${report.shapes.length * SAMPLE_COUNT} audited maze records.`);
