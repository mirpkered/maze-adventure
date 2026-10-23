import test from 'node:test';
import assert from 'node:assert/strict';
import { createQaDiagnosticsStore, createQuickSummary, createRecentIncident, QA_DIAGNOSTICS_STORAGE_KEY } from '../src/qa-diagnostics-store.js';
import { createTraceRecorder } from '../src/trace-diagnostics.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test('QA session storage expires reports after 24 hours and keeps a bounded newest-first list', () => {
  let now = 1_000_000;
  const storage = memoryStorage(), store = createQaDiagnosticsStore(storage, { now: () => now });
  for (let i = 0; i < 8; i++) store.save({ events: [], checkpoints: [], current: { ink: [] } }, { sessionId: `s${i}`, buildId: 'test' });
  assert.equal(store.list().length, 6);
  assert.equal(store.list()[0].sessionId, 's7');
  now += 24 * 60 * 60 * 1000 + 1;
  assert.deepEqual(store.list(), []);
  assert.equal(JSON.parse(storage.getItem(QA_DIAGNOSTICS_STORAGE_KEY)).length, 0);
});

test('quick summary distinguishes observed recovery from insufficient evidence and stays compact', () => {
  const report = { buildId: 'build-test', maze: { layoutId: 'maze-x', dimensions: { width: 7, height: 7 }, start: { cell: { x: 2, y: 0 }, edge: 'N' }, finish: { cell: { x: 6, y: 4 }, edge: 'E' }, shortestSolutionLength: 24 }, current: { state: { authoritativePosition: { x: 1.234, y: 5.42 }, logicalCell: { x: 1, y: 5 }, active: false } }, events: [
    { t: 1, accepted: false, rejectedReason: 'closed-wall-collision' },
    { t: 2, accepted: true, movementAccepted: true },
  ] };
  const recovered = createQuickSummary(report, { observed: 2, accepted: 1, rejectedByReason: { 'closed-wall-collision': 1 }, canceled: 0, durationMs: 500 });
  assert.match(recovered, /RECOVERED AFTER LAST REJECTION/);
  assert.match(recovered, /7x7 easy/);
  assert.match(recovered, /start 2,0 N → finish 6,4 E \| solution 24 steps/);
  const exitProgress = createQuickSummary({ ...report, current: { ...report.current, state: {
    ...report.current.state, exitCellEntered: true, currentlyInExitCell: true, completionCommitted: false,
    invalidPerimeterAttempts: 2,
  } } });
  assert.match(exitProgress, /exit E · inside exit cell; still tracing · invalid perimeter attempts 2/);
  assert.match(createQuickSummary({ ...report, maze: { ...report.maze, difficulty: 'medium', dimensions: { width: 10, height: 10 } } }), /10x10 medium/);
  assert.ok(recovered.length < 2000);
  const steering = createQuickSummary({ ...report, controlSystem: 'continuous-steering', activeController: 'idle', steering: { settings: { deadZonePixels: 10, speedResponseExponent: 1.15, maxSpeedMazeUnitsPerSecond: 1.725 }, frames: 60, activeFrames: 40, clampedFrames: 1 } });
  assert.match(steering, /control system continuous-steering \| active controller idle/);
  assert.match(steering, /steering easy · deflection 0% · dead-zone 10px · curve x\^1.15 · max 1.725 cells\/s \| last gesture frames 40\/60, capped 1/);
  const measuredSteering = createQuickSummary({ ...report, controlSystem: 'continuous-steering', activeController: 'continuous-steering', steering: { difficulty: 'hard', normalizedDeflection: 0.589, maxSpeedMazeUnitsPerSecond: 2.5, settings: { deadZonePixels: 10, speedResponseExponent: 1.15 } }, events: [{ steeringMetrics: { requestedSpeed: 1.473 }, requestedMovement: { x: 0.024, y: 0 }, acceptedMovement: { x: 0, y: 0 }, movementClassification: 'closed-wall-collision' }] });
  assert.match(measuredSteering, /steering hard · deflection 59% · dead-zone 10px · curve x\^1\.15 · max 2\.5 cells\/s/);
  assert.match(measuredSteering, /last steering request 0\.024 0\.000 · accepted 0\.000 0\.000 · closed-wall-collision/);
  const currentLayout = createQuickSummary({ ...report, inputPanel: 'steering-pad', zoomAssist: true, zoomFactor: 1.75, qaSelectedZoomFactor: 1.75, qaCloseViewPanelSize: 'compact' });
  assert.match(currentLayout, /input surface steering-pad/);
  assert.doesNotMatch(currentLayout, /Zoom Assist|Close View|panel compact/,
    'current reports describe the steering pad and omit retired second-view settings');
  const measuredLayout = createQuickSummary({ ...report, layout: {
    viewport: { width: 390, height: 844 },
    mazeSvg: { x: 22, y: 200, width: 346.8, height: 346.8 },
    steeringPad: { width: 370.4, height: 109.7 },
    steeringTouchArea: { width: 366.4, height: 105.7, center: { up: 52.85, down: 52.85, left: 183.2, right: 183.2, diagonal: 74.74, thresholdReachable: { up: false, down: false, left: true, right: true, diagonal: false } } },
    completionPanel: { height: 109.7 },
    completionCheck: { stable: true, maxDeltaPx: 0, maxScaleDelta: 0 },
  } });
  assert.match(measuredLayout, /layout 390x844 · maze 346\.8x346\.8 at 22\.0,200\.0 · pad 370\.4x109\.7px · usable 366\.4x105\.7px · center reach U\/D\/L\/R\/diag 52\.9\/52\.9\/183\.2\/183\.2\/74\.7px \(76px limited\) · completion 109\.7px · geometry stable \(0\.000px\)/);
  const explicitMode = createQuickSummary({ ...report, inputMode: 'direct-touch', selectedInputMode: 'continuous-steering', activeController: 'continuous-steering' });
  assert.match(explicitMode, /selected Continuous Steering \| gesture controller continuous-steering/,
    'historical reports retain the mode and controller they recorded');
  const historicalDirect = createQuickSummary({ ...report, inputMode: 'direct-touch', selectedInputMode: 'direct-touch' });
  assert.match(historicalDirect, /selected Direct Touch/, 'historical Direct Touch reports are not rewritten as Steering');
  const legacy = createQuickSummary({ ...report, inputMode: undefined });
  assert.match(legacy, /selected unknown \(legacy report\)/, 'legacy reports do not invent a Direct Touch selection');
  assert.match(createQuickSummary({ ...report, events: [] }), /INSUFFICIENT EVIDENCE/);
});

test('Expert QA summary identifies 20x20 dimensions, terminal exit, quality, attempts, and speed', () => {
  const report = {
    buildId: '2026.10.22-exit-crossing-completion-1',
    controlSystem: 'continuous-steering', activeController: 'continuous-steering',
    steering: { difficulty: 'expert', normalizedDeflection: 1, maxSpeedMazeUnitsPerSecond: 3, settings: { deadZonePixels: 10, speedResponseExponent: 1.15 } },
    maze: {
      layoutId: 'maze-20x20-a1b2c3d4', dimensions: { width: 20, height: 20 },
      start: { cell: { x: 5, y: 0 }, edge: 'N' }, finish: { cell: { x: 19, y: 8 }, edge: 'E' },
      shortestSolutionLength: 158, exitInternalDegree: 1, exitGatedCells: 0, generationAttempts: 2, generationDurationMs: 8.12,
      generationQuality: { solutionRouteJunctions: 16, optionalBranchCount: 17, largestOptionalBranch: 99 },
    },
    current: { state: { authoritativePosition: { x: 19, y: 8 }, logicalCell: { x: 19, y: 8 }, active: false } }, events: [],
  };
  const summary = createQuickSummary(report);
  assert.match(summary, /20x20 expert/);
  assert.match(summary, /maze-20x20-a1b2c3d4/);
  assert.match(summary, /solution 158 steps/);
  assert.match(summary, /exit degree 1 · gated cells 0 · attempts 2 · generation 8\.12ms/);
  assert.match(summary, /route junctions 16 · optional branches 17 · largest branch 99/);
  assert.match(summary, /max 3 cells\/s/);
  assert.ok(summary.length < 2000);
});

test('trace report serialization retains Expert generator and endpoint measurements', () => {
  const layout = { viewport: { width: 390, height: 844 }, mazeSvg: { x: 10, y: 20, width: 350, height: 350 }, steeringPad: { width: 370, height: 110 }, steeringTouchArea: { width: 366, height: 106, center: { up: 53, down: 53, left: 183, right: 183, diagonal: 74.95, thresholdReachable: { up: false, down: false, left: true, right: true, diagonal: false } }, offCenter: {} }, completionPanel: { height: 110 }, completionCheck: { stable: true, maxDeltaPx: 0, maxScaleDelta: 0 } };
  const report = createTraceRecorder().report({
    layoutId: 'maze-20x20-seed-fixture', dimensions: { width: 20, height: 20 }, difficulty: 'expert',
    start: { cell: { x: 5, y: 0 }, edge: 'N' }, finish: { cell: { x: 19, y: 8 }, edge: 'E' },
    shortestSolutionLength: 158, exitInternalDegree: 1, exitGatedCells: 0,
    generationAttempts: 2, generationDurationMs: 8.12,
    generationQuality: { solutionPathEdges: 158, solutionRouteJunctions: 16, optionalAccessibleCells: 241, optionalBranchCount: 17, largestOptionalBranch: 99 },
    route: [], ink: [], state: null, layout,
  });
  assert.equal(report.maze.difficulty, 'expert');
  assert.deepEqual(report.maze.dimensions, { width: 20, height: 20 });
  assert.equal(report.maze.exitInternalDegree, 1);
  assert.equal(report.maze.exitGatedCells, 0);
  assert.equal(report.maze.generationAttempts, 2);
  assert.equal(report.maze.generationDurationMs, 8.12);
  assert.equal(report.maze.generationQuality.largestOptionalBranch, 99);
  assert.deepEqual(report.layout, layout);
});

test('recent incident report provides a bounded event window and recovery evidence', () => {
  const events = Array.from({ length: 40 }, (_, t) => ({ t, eventType: 'pointermove', accepted: true, movementAccepted: true, maze: { x: t, y: 0 }, pencilPosition: { x: t, y: 0 }, cell: { x: t, y: 0 } }));
  events[25] = { ...events[25], accepted: false, rejectedReason: 'closed-wall-collision', controlSystem: 'continuous-steering', activeController: 'continuous-steering', movementClassification: 'closed-wall-collision', requestedMovement: { x: 0.02, y: 0 }, acceptedMovement: { x: 0, y: 0 }, attemptedTransitions: [{ from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, open: false }] };
  const incident = createRecentIncident({ buildId: 'b', maze: { layoutId: 'm' }, events }, 4);
  assert.equal(incident.events.length, 9);
  assert.equal(incident.recoveryObserved, true);
  assert.equal(incident.events[incident.rejectionIndex].reason, 'closed-wall-collision');
  assert.equal(incident.events[incident.rejectionIndex].activeController, 'continuous-steering');
  assert.deepEqual(incident.events[incident.rejectionIndex].requestedMovement, { x: 0.02, y: 0 });
  assert.deepEqual(incident.events[incident.rejectionIndex].transitions, [{ from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, open: false }]);
  assert.equal(Object.hasOwn(incident.events[incident.rejectionIndex], 'inputMode'), false,
    'new Steering incidents do not carry the retired input-mode field');

  const historical = createRecentIncident({ buildId: 'old', maze: { layoutId: 'm' }, events: [{ t: 1, accepted: false, rejectedReason: 'wall', inputMode: 'direct-touch' }] });
  assert.equal(historical.events[0].inputMode, 'direct-touch', 'historical reports retain their recorded controller mode');
});

test('QA diagnostics persistence fails safely when browser storage throws', () => {
  const store = createQaDiagnosticsStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.equal(store.available, false);
  assert.equal(store.save({}, { sessionId: 'x' }), false);
  assert.deepEqual(store.list(), []);
});

test('retained QA snapshots are size-bounded and clearing them leaves other app data intact', () => {
  const storage = memoryStorage();
  storage.setItem('maze-adventure-progress', JSON.stringify({ level: 1, preference: 'warm' }));
  const store = createQaDiagnosticsStore(storage, { now: () => 5_000 });
  const points = Array.from({ length: 12_000 }, (_, index) => ({ x: index / 1000, y: index / 2000 }));
  assert.equal(store.save({ events: [], checkpoints: [], current: { ink: points, inkCellAssociation: points } }, { sessionId: 'large', buildId: 'test' }), true);
  const saved = store.list()[0].report;
  assert.equal(saved.retention.truncated, true);
  assert.ok(JSON.stringify(saved).length * 2 <= 180_000);
  assert.equal(store.clear(), true);
  assert.equal(storage.getItem(QA_DIAGNOSTICS_STORAGE_KEY), '[]');
  assert.deepEqual(JSON.parse(storage.getItem('maze-adventure-progress')), { level: 1, preference: 'warm' });
});
