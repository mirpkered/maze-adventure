import test from 'node:test';
import assert from 'node:assert/strict';
import { createQaDiagnosticsStore, createQuickSummary, createRecentIncident, QA_DIAGNOSTICS_STORAGE_KEY } from '../src/qa-diagnostics-store.js';

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
  assert.match(createQuickSummary({ ...report, maze: { ...report.maze, difficulty: 'medium', dimensions: { width: 10, height: 10 } } }), /10x10 medium/);
  assert.ok(recovered.length < 2000);
  const steering = createQuickSummary({ ...report, inputMode: 'continuous-steering', steering: { settings: { deadZonePixels: 10, speedResponseExponent: 1.15, maxSpeedMazeUnitsPerSecond: 1.725 }, frames: 60, activeFrames: 40, clampedFrames: 1 } });
  assert.match(steering, /steering dead-zone 10px, curve x\^1.15, max 1.725 cells\/s \| last gesture frames 40\/60, capped 1/);
  const explicitMode = createQuickSummary({ ...report, inputMode: 'direct-touch', selectedInputMode: 'continuous-steering', activeController: 'continuous-steering' });
  assert.match(explicitMode, /selected Continuous Steering \| gesture controller continuous-steering/,
    'the summary uses explicitly captured mode and controller rather than a stale legacy alias');
  assert.doesNotMatch(explicitMode, /selected Direct Touch/);
  const legacy = createQuickSummary({ ...report, inputMode: undefined });
  assert.match(legacy, /selected unknown \(legacy report\)/, 'legacy reports do not invent a Direct Touch selection');
  assert.match(createQuickSummary({ ...report, events: [] }), /INSUFFICIENT EVIDENCE/);
});

test('recent incident report provides a bounded event window and recovery evidence', () => {
  const events = Array.from({ length: 40 }, (_, t) => ({ t, eventType: 'pointermove', accepted: true, movementAccepted: true, maze: { x: t, y: 0 }, pencilPosition: { x: t, y: 0 }, cell: { x: t, y: 0 } }));
  events[25] = { ...events[25], accepted: false, rejectedReason: 'closed-wall-collision', selectedInputMode: 'continuous-steering', activeController: 'continuous-steering', movementClassification: 'closed-wall-collision', requestedMovement: { x: 0.02, y: 0 }, acceptedMovement: { x: 0, y: 0 }, attemptedTransitions: [{ from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, open: false }] };
  const incident = createRecentIncident({ buildId: 'b', maze: { layoutId: 'm' }, events }, 4);
  assert.equal(incident.events.length, 9);
  assert.equal(incident.recoveryObserved, true);
  assert.equal(incident.events[incident.rejectionIndex].reason, 'closed-wall-collision');
  assert.equal(incident.events[incident.rejectionIndex].activeController, 'continuous-steering');
  assert.deepEqual(incident.events[incident.rejectionIndex].requestedMovement, { x: 0.02, y: 0 });
  assert.deepEqual(incident.events[incident.rejectionIndex].transitions, [{ from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, open: false }]);
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
