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
  const report = { buildId: 'build-test', maze: { layoutId: 'maze-x', dimensions: { width: 7, height: 7 } }, current: { state: { authoritativePosition: { x: 1.234, y: 5.42 }, logicalCell: { x: 1, y: 5 }, active: false } }, events: [
    { t: 1, accepted: false, rejectedReason: 'closed-wall-collision' },
    { t: 2, accepted: true, movementAccepted: true },
  ] };
  const recovered = createQuickSummary(report, { observed: 2, accepted: 1, rejectedByReason: { 'closed-wall-collision': 1 }, canceled: 0, durationMs: 500 });
  assert.match(recovered, /RECOVERED AFTER LAST REJECTION/);
  assert.ok(recovered.length < 2000);
  assert.match(createQuickSummary({ ...report, events: [] }), /INSUFFICIENT EVIDENCE/);
});

test('recent incident report provides a bounded event window and recovery evidence', () => {
  const events = Array.from({ length: 40 }, (_, t) => ({ t, eventType: 'pointermove', accepted: true, movementAccepted: true, maze: { x: t, y: 0 }, pencilPosition: { x: t, y: 0 }, cell: { x: t, y: 0 } }));
  events[25] = { ...events[25], accepted: false, rejectedReason: 'rejoin-not-route-tail' };
  const incident = createRecentIncident({ buildId: 'b', maze: { layoutId: 'm' }, events }, 4);
  assert.equal(incident.events.length, 9);
  assert.equal(incident.recoveryObserved, true);
  assert.equal(incident.events[incident.rejectionIndex].reason, 'rejoin-not-route-tail');
});

test('QA diagnostics persistence fails safely when browser storage throws', () => {
  const store = createQaDiagnosticsStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.equal(store.available, false);
  assert.equal(store.save({}, { sessionId: 'x' }), false);
  assert.deepEqual(store.list(), []);
});
