import { writeFile } from 'node:fs/promises';
import { createOrganicCircleMaze, getOrganicSolutionPolyline, validateOrganicMaze } from '../src/organic-maze.js';
import { createTraceSession } from '../src/tracing.js';

const SAMPLE_COUNT = 500;
const samples = [];
const fingerprints = new Set();
const sideFor = angle => {
  const x = Math.cos(angle), y = Math.sin(angle);
  if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? 'E' : 'W';
  return y >= 0 ? 'S' : 'N';
};
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];

function move(session, to, sample) {
  const result = session.steer(31, { x: to.x - session.position.x, y: to.y - session.position.y });
  if (result.blocked) throw new Error(`sample ${sample.seed}: tracer rejected accepted solution point: ${result.reason}`);
  return result;
}

for (let seed = 0; seed < SAMPLE_COUNT; seed++) {
  const auditStarted = performance.now();
  const maze = createOrganicCircleMaze({ seed });
  const mazeMs = performance.now() - auditStarted;
  const solution = getOrganicSolutionPolyline(maze);
  if (!validateOrganicMaze(maze)) throw new Error(`sample ${seed}: generator validator failed`);
  if (fingerprints.has(maze.layoutFingerprint)) throw new Error(`sample ${seed}: duplicate layout fingerprint`);
  fingerprints.add(maze.layoutFingerprint);
  if (solution.some(point => !maze.geometry.isLegalPoint(point, 0.001))) throw new Error(`sample ${seed}: solution left legal corridor geometry`);

  const session = createTraceSession(maze);
  if (!session.beginSteering(31)) throw new Error(`sample ${seed}: Steering session did not activate`);
  let completedAt = -1, traceStarted = performance.now();
  for (let index = 1; index < solution.length; index++) {
    const result = move(session, solution[index], { seed });
    if (result.complete) { completedAt = index; break; }
    if (session.diagnostics.completionCommitted) throw new Error(`sample ${seed}: completion latched before declared boundary crossing`);
  }
  if (completedAt < 0) throw new Error(`sample ${seed}: legal solution failed to cross its exit`);
  if (completedAt < solution.length - 14) throw new Error(`sample ${seed}: completion occurred before the final portal segment`);
  const completionInk = session.stroke.length;
  const postComplete = session.steer(31, { x: 0.1, y: -0.1 });
  if (postComplete.moved || session.stroke.length !== completionInk) throw new Error(`sample ${seed}: movement/ink continued after completion`);
  session.end(31);
  const traceMs = performance.now() - traceStarted;

  const entranceSession = createTraceSession(maze);
  entranceSession.beginSteering(32);
  const startLength = Math.hypot(maze.entrance.position.x, maze.entrance.position.y);
  const forbiddenEntranceAttempt = entranceSession.steer(32, {
    x: maze.entrance.position.x / startLength * 0.5,
    y: maze.entrance.position.y / startLength * 0.5,
  });
  if (forbiddenEntranceAttempt.complete || !forbiddenEntranceAttempt.blocked || Math.hypot(entranceSession.position.x, entranceSession.position.y) > maze.geometry.radius + 1e-8) {
    throw new Error(`sample ${seed}: entrance or outer rim was crossed illegally`);
  }

  // The exact solution is followed to a central corridor, then a long
  // diagonal displacement toward a forbidden point must stop at the wall.
  const collisionSession = createTraceSession(maze);
  collisionSession.beginSteering(33);
  const middle = Math.floor(solution.length * 0.5);
  for (let index = 1; index <= middle; index++) {
    const point = solution[index];
    const result = collisionSession.steer(33, { x: point.x - collisionSession.position.x, y: point.y - collisionSession.position.y });
    if (result.blocked || result.complete) throw new Error(`sample ${seed}: could not reach the central collision test point`);
  }
  const from = collisionSession.position;
  let illegalTarget = null;
  for (let directionIndex = 0; directionIndex < 32; directionIndex++) {
    const angle = directionIndex * Math.PI / 16;
    const target = { x: from.x + Math.cos(angle) * 0.2, y: from.y + Math.sin(angle) * 0.2 };
    if (Math.hypot(target.x, target.y) < maze.geometry.radius - 0.06 && !maze.geometry.isLegalPoint(target)) { illegalTarget = target; break; }
  }
  if (!illegalTarget) throw new Error(`sample ${seed}: no adversarial wall target found`);
  const collision = collisionSession.steer(33, { x: illegalTarget.x - from.x, y: illegalTarget.y - from.y });
  if (!collision.blocked || !collision.wallCollision || !maze.geometry.isLegalPoint(collisionSession.position)) throw new Error(`sample ${seed}: high-speed curved-wall collision was not safe`);
  const inkBeforeReverse = collisionSession.stroke.length;
  let redirected = null;
  for (let directionIndex = 0; directionIndex < 64 && !redirected; directionIndex++) {
    const angle = directionIndex * Math.PI / 32;
    const attempt = collisionSession.steer(33, { x: Math.cos(angle) * 0.035, y: Math.sin(angle) * 0.035 });
    if (attempt.moved && !attempt.blocked) redirected = attempt;
  }
  if (redirected.blocked || !redirected.moved || collisionSession.stroke.length < inkBeforeReverse) throw new Error(`sample ${seed}: could not redirect/backtrack after collision`);
  collisionSession.cancel(33);

  samples.push({
    seed, fingerprint: maze.layoutFingerprint, nodes: maze.nodes.length + 2, edges: maze.edges.length,
    width: maze.geometry.corridorWidth, activeRegions: maze.nodes.length,
    entranceAngle: Number(maze.entrance.angle.toFixed(6)), entranceSide: sideFor(maze.entrance.angle),
    exitAngle: Number(maze.exit.angle.toFixed(6)), exitSide: sideFor(maze.exit.angle),
    solutionLength: Number(maze.quality.solutionLength.toFixed(4)), meaningfulDecisions: maze.quality.meaningfulDecisions,
    routeJunctions: maze.quality.routeJunctions, optionalBranchCount: maze.quality.branchCount,
    optionalBranchLengths: maze.quality.optionalBranchLengths.map(value => Number(value.toFixed(4))),
    largestOptionalBranch: Number(maze.quality.largestOptionalBranch.toFixed(4)), deadEnds: maze.quality.deadEnds,
    minCorridorClearance: maze.quality.minimumCorridorClearance,
    generationAttempts: maze.generationAttempts, rejectedCandidates: maze.generationRejections,
    generationMs: Number(maze.generationDurationMs.toFixed(3)),
    sampleGenerationMs: Number(mazeMs.toFixed(3)), traceReplayMs: Number(traceMs.toFixed(3)),
    completedAtSolutionPoint: completedAt, solutionPointCount: solution.length,
    collisionBlocked: true, redirectedAfterCollision: true, illegalEntranceBlocked: true, valid: true,
  });
}

const values = key => samples.map(sample => sample[key]);
const average = list => list.reduce((sum, value) => sum + value, 0) / list.length;
const summary = {
  sampleCount: samples.length, seeds: [0, SAMPLE_COUNT - 1], uniqueLayouts: fingerprints.size,
  invalidSamples: samples.filter(sample => !sample.valid).length,
  meanGenerationMs: average(values('generationMs')),
  p95GenerationMs: percentile(values('generationMs'), 0.95),
  maxGenerationMs: Math.max(...values('generationMs')),
  meanWholeSampleGenerationMs: average(values('sampleGenerationMs')),
  maxAttempts: Math.max(...values('generationAttempts')),
  meanAttempts: average(values('generationAttempts')),
  retrySamples: samples.filter(sample => sample.generationAttempts > 1).length,
  totalRejectedCandidates: samples.reduce((sum, sample) => sum + Object.values(sample.rejectedCandidates).reduce((subtotal, count) => subtotal + count, 0), 0),
  rejectionReasons: Object.fromEntries([...new Set(samples.flatMap(sample => Object.keys(sample.rejectedCandidates)))].map(reason => [reason, samples.reduce((sum, sample) => sum + (sample.rejectedCandidates[reason] ?? 0), 0)])),
  meanSolutionLength: average(values('solutionLength')),
  medianSolutionLength: percentile(values('solutionLength'), 0.5),
  minimumSolutionLength: Math.min(...values('solutionLength')),
  p10SolutionLength: percentile(values('solutionLength'), 0.1),
  p90SolutionLength: percentile(values('solutionLength'), 0.9),
  meanMeaningfulDecisions: average(values('meaningfulDecisions')),
  medianMeaningfulDecisions: percentile(values('meaningfulDecisions'), 0.5),
  minMeaningfulDecisions: Math.min(...values('meaningfulDecisions')),
  meanOptionalBranchCount: average(values('optionalBranchCount')),
  meanLargestOptionalBranch: average(values('largestOptionalBranch')),
  maxLargestOptionalBranch: Math.max(...values('largestOptionalBranch')),
  meanTraceReplayMs: average(values('traceReplayMs')),
  maxTraceReplayMs: Math.max(...values('traceReplayMs')),
  entranceSides: Object.fromEntries(['N', 'E', 'S', 'W'].map(side => [side, samples.filter(sample => sample.entranceSide === side).length])),
  exitSides: Object.fromEntries(['N', 'E', 'S', 'W'].map(side => [side, samples.filter(sample => sample.exitSide === side).length])),
  legalRouteReplay: samples.length, outwardExitCompletion: samples.length,
  curvedWallStops: samples.length, collisionRedirections: samples.length,
  illegalEntranceCrossingsRejected: samples.length,
  buildContext: 'Organic Circle QA geometry backend; deterministic seeds 0–499',
};

const report = { format: 'maze-adventure-organic-circle-audit-v1', generatedAt: new Date().toISOString(), summary, samples };
await writeFile(new URL('../docs/ORGANIC_CIRCLE_QA_AUDIT.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
const table = [
  '# Organic Circle QA Prototype — 500-Seed Audit', '',
  `Generated ${report.generatedAt}. Seeds ${summary.seeds[0]}–${summary.seeds[1]} through the production Organic Circle generator and geometry trace session.`, '',
  'Every sample replays its full solution through the authoritative tracer, confirms completion only at the final outward portal crossing, then attempts a post-completion movement. Separate tracer sessions test an illegal entrance exit, a high-speed curved-wall strike, legal redirection/backtracking, and retained ink.', '',
  '| Metric | Result |', '|---|---:|',
  `| Valid samples | ${summary.sampleCount}/${summary.sampleCount} |`,
  `| Unique fingerprints | ${summary.uniqueLayouts}/${summary.sampleCount} |`,
  `| Solution length mean / median / min / P10 / P90 | ${summary.meanSolutionLength.toFixed(3)} / ${summary.medianSolutionLength.toFixed(3)} / ${summary.minimumSolutionLength.toFixed(3)} / ${summary.p10SolutionLength.toFixed(3)} / ${summary.p90SolutionLength.toFixed(3)} world units |`,
  `| Meaningful decisions mean / median / min | ${summary.meanMeaningfulDecisions.toFixed(2)} / ${summary.medianMeaningfulDecisions} / ${summary.minMeaningfulDecisions} |`,
  `| Optional branches mean; largest branch mean / max | ${summary.meanOptionalBranchCount.toFixed(2)}; ${summary.meanLargestOptionalBranch.toFixed(3)} / ${summary.maxLargestOptionalBranch.toFixed(3)} world units |`,
  `| Generation duration mean / P95 / max | ${summary.meanGenerationMs.toFixed(3)} / ${summary.p95GenerationMs.toFixed(3)} / ${summary.maxGenerationMs.toFixed(3)} ms |`,
  `| Attempts mean / max; retried seeds | ${summary.meanAttempts.toFixed(2)} / ${summary.maxAttempts}; ${summary.retrySamples}/${summary.sampleCount} |`,
  `| Rejected candidates total; reasons | ${summary.totalRejectedCandidates}; ${Object.entries(summary.rejectionReasons).map(([reason, count]) => `${reason} ${count}`).join(', ')} |`,
  `| Tracer replay mean / max | ${summary.meanTraceReplayMs.toFixed(3)} / ${summary.maxTraceReplayMs.toFixed(3)} ms |`,
  `| Entrance side N/E/S/W | ${['N','E','S','W'].map(side => summary.entranceSides[side]).join('/')} |`,
  `| Exit side N/E/S/W | ${['N','E','S','W'].map(side => summary.exitSides[side]).join('/')} |`,
  `| Route replays / valid exits / wall stops / redirects / illegal entrance rejects | ${summary.legalRouteReplay} / ${summary.outwardExitCompletion} / ${summary.curvedWallStops} / ${summary.collisionRedirections} / ${summary.illegalEntranceCrossingsRejected} |`, '',
  '## Acceptance interpretation', '',
  'All 500 seeds passed the implemented structural generator checks and tracer replays. Start and exit portals vary around the circular boundary; only the exit portal permits outward crossing. The wall renderer uses offset samples from the same curved centerline representation whose corridor tubes define collision. Times are from this development environment, not an iPhone. The adjacent JSON contains the measured record for every seed.',
].join('\n');
await writeFile(new URL('../docs/ORGANIC_CIRCLE_QA_AUDIT.md', import.meta.url), `${table}\n`);
console.log(`Organic Circle: ${summary.sampleCount} valid samples, ${summary.uniqueLayouts} unique layouts, ${summary.invalidSamples} failures, ${summary.retrySamples} retries; generation mean ${summary.meanGenerationMs.toFixed(2)}ms, max ${summary.maxGenerationMs.toFixed(2)}ms.`);
