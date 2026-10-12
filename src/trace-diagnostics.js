const DEFAULT_EVENT_LIMIT = 400;
const CHECKPOINT_LIMIT = 64;

/** A bounded, privacy-conscious recorder for QA pointer replays. */
export function createTraceRecorder({ limit = DEFAULT_EVENT_LIMIT, now = () => performance.now() } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Diagnostic event limit must be a positive integer.');
  let startedAt = now();
  let events = [];
  let checkpoints = [];
  let dropped = 0;
  let droppedCheckpoints = 0;
  let previous = null;
  const point = value => value && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? { x: Math.round(value.x * 1000) / 1000, y: Math.round(value.y * 1000) / 1000 }
    : null;
  const cell = value => value && Number.isInteger(value.x) && Number.isInteger(value.y)
    ? { x: value.x, y: value.y }
    : null;
  return {
    record(event) {
      const entry = {
        t: Math.max(0, Math.round(now() - startedAt)),
        eventType: String(event.eventType ?? 'unknown').slice(0, 32),
        pointerType: String(event.pointerType ?? 'unknown').slice(0, 16),
        sampleType: String(event.sampleType ?? 'dispatched').slice(0, 16),
        sampleIndex: Number.isInteger(event.sampleIndex) ? event.sampleIndex : null,
        client: point(event.client),
        maze: point(event.maze),
        cell: cell(event.cell),
        acceptedInkEndpoint: point(event.acceptedInkEndpoint),
        pencilPosition: point(event.pencilPosition),
        previousRouteCell: cell(event.previousRouteCell),
        candidateReversal: cell(event.candidateReversal),
        candidateReversalOpen: typeof event.candidateReversalOpen === 'boolean' ? event.candidateReversalOpen : null,
        resumeAcquisitionDistance: Number.isFinite(event.resumeAcquisitionDistance) ? Math.round(event.resumeAcquisitionDistance * 1000) / 1000 : null,
        resumeAcquisitionThreshold: Number.isFinite(event.resumeAcquisitionThreshold) ? Math.round(event.resumeAcquisitionThreshold * 1000) / 1000 : null,
        failureCategory: typeof event.failureCategory === 'string' ? event.failureCategory.slice(0, 32) : null,
        traceHealth: typeof event.traceHealth === 'string' ? event.traceHealth.slice(0, 40) : null,
        interpolationCount: Number.isInteger(event.interpolationCount) ? event.interpolationCount : 0,
        attemptedTransitions: Array.isArray(event.attemptedTransitions) ? event.attemptedTransitions.slice(0, 24).map(transition => ({
          from: cell(transition.from), to: cell(transition.to), open: Boolean(transition.open),
        })) : [],
        strokeBreakCreated: Boolean(event.strokeBreakCreated),
        gestureState: String(event.gestureState ?? 'unknown').slice(0, 16),
        accepted: Boolean(event.accepted),
        rejectedReason: typeof event.rejectedReason === 'string' ? event.rejectedReason.slice(0, 80) : null,
        blocked: Boolean(event.blocked),
        pointerCaptured: Boolean(event.pointerCaptured),
        pointerCanceled: Boolean(event.pointerCanceled),
        layoutId: typeof event.layoutId === 'string' ? event.layoutId.slice(0, 64) : null,
      };
      events.push(entry);
      if (events.length > limit) { events.shift(); dropped++; }
      const lifecycle = ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture'].includes(entry.eventType);
      const blockedTransition = entry.blocked && (!previous?.blocked || previous?.rejectedReason !== entry.rejectedReason);
      const recovered = entry.accepted && previous?.blocked;
      const gestureTransition = entry.gestureState !== previous?.gestureState;
      if (lifecycle || blockedTransition || recovered || gestureTransition) {
        checkpoints.push(entry);
        if (checkpoints.length > CHECKPOINT_LIMIT) { checkpoints.shift(); droppedCheckpoints++; }
      }
      previous = entry;
    },
    reset() { events = []; checkpoints = []; dropped = 0; droppedCheckpoints = 0; previous = null; startedAt = now(); },
    report({ layoutId, dimensions, mazeDefinition, route, ink, state, inkCellAssociation, buildId = null }) {
      return {
        format: 'maze-adventure-trace-qa-v1',
        buildId,
        privacy: 'Pointer coordinates are maze-local; no name, account, URL, or pointer identifier is recorded.',
        maze: { layoutId, dimensions, definition: mazeDefinition },
      current: { route, ink, inkCellAssociation, state },
        events: [...events],
        checkpoints: [...checkpoints],
        droppedEvents: dropped,
        eventLimit: limit,
        droppedCheckpoints,
        checkpointLimit: CHECKPOINT_LIMIT,
      };
    },
    get length() { return events.length; },
    get dropped() { return dropped; },
    get checkpointCount() { return checkpoints.length; },
    get droppedCheckpoints() { return droppedCheckpoints; },
  };
}

/** Stable layout fingerprint so a report can be rebuilt without recording a random seed. */
export function mazeLayoutId(maze) {
  let hash = 2166136261;
  const bits = `${maze.width}x${maze.height}|${maze.start.x},${maze.start.y}|${maze.end.x},${maze.end.y}|` +
    maze.cells.flatMap(row => row.map(cell => ['N', 'E', 'S', 'W'].map(direction => cell.walls[direction] ? '1' : '0').join(''))).join('');
  for (let index = 0; index < bits.length; index++) {
    hash ^= bits.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `maze-${maze.width}x${maze.height}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
