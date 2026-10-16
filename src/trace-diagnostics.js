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
  let observed = 0, acceptedCount = 0, canceledCount = 0;
  const rejectedCounts = {};
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
        resumeAcquisitionDistancePixels: Number.isFinite(event.resumeAcquisitionDistancePixels) ? Math.round(event.resumeAcquisitionDistancePixels * 10) / 10 : null,
        resumeAcquisitionThresholdPixels: Number.isFinite(event.resumeAcquisitionThresholdPixels) ? Math.round(event.resumeAcquisitionThresholdPixels * 10) / 10 : null,
        failureCategory: typeof event.failureCategory === 'string' ? event.failureCategory.slice(0, 32) : null,
        traceHealth: typeof event.traceHealth === 'string' ? event.traceHealth.slice(0, 40) : null,
        interpolationCount: Number.isInteger(event.interpolationCount) ? event.interpolationCount : 0,
        attemptedTransitions: Array.isArray(event.attemptedTransitions) ? event.attemptedTransitions.slice(0, 24).map(transition => ({
          from: cell(transition.from), to: cell(transition.to), open: Boolean(transition.open),
        })) : [],
        strokeBreakCreated: Boolean(event.strokeBreakCreated),
        gestureState: String(event.gestureState ?? 'unknown').slice(0, 32),
        gestureTerminatedByWallCollision: Boolean(event.gestureTerminatedByWallCollision),
        lockedOutMovement: Boolean(event.lockedOutMovement),
        lockedOutMovementCount: Number.isInteger(event.lockedOutMovementCount) ? event.lockedOutMovementCount : 0,
        resumeAfterWallCollision: Boolean(event.resumeAfterWallCollision),
        accepted: Boolean(event.accepted),
        rejectedReason: typeof event.rejectedReason === 'string' ? event.rejectedReason.slice(0, 80) : null,
        blocked: Boolean(event.blocked),
        pointerCaptured: Boolean(event.pointerCaptured),
        pointerCanceled: Boolean(event.pointerCanceled),
        layoutId: typeof event.layoutId === 'string' ? event.layoutId.slice(0, 64) : null,
      };
      events.push(entry);
      observed++;
      const movementAccepted = event.movementAccepted ?? (entry.eventType === 'pointermove' && entry.accepted);
      entry.movementAccepted = Boolean(movementAccepted);
      if (entry.movementAccepted) acceptedCount++;
      else if (entry.rejectedReason && entry.rejectedReason !== 'no-route-or-stroke-change') rejectedCounts[entry.rejectedReason] = (rejectedCounts[entry.rejectedReason] ?? 0) + 1;
      if (entry.pointerCanceled) canceledCount++;
      if (events.length > limit) { events.shift(); dropped++; }
      const lifecycle = ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture'].includes(entry.eventType);
      const blockedTransition = entry.blocked && (!previous?.blocked || previous?.rejectedReason !== entry.rejectedReason);
      const recovered = entry.movementAccepted && previous?.blocked;
      const gestureTransition = entry.gestureState !== previous?.gestureState;
      if (lifecycle || blockedTransition || recovered || gestureTransition) {
        checkpoints.push(entry);
        if (checkpoints.length > CHECKPOINT_LIMIT) { checkpoints.shift(); droppedCheckpoints++; }
      }
      previous = entry;
    },
    reset() { events = []; checkpoints = []; dropped = 0; droppedCheckpoints = 0; observed = 0; acceptedCount = 0; canceledCount = 0; for (const key of Object.keys(rejectedCounts)) delete rejectedCounts[key]; previous = null; startedAt = now(); },
    report({ layoutId, dimensions, difficulty = null, start = null, finish = null, shortestSolutionLength = null, mazeDefinition, route, ink, state, inkCellAssociation, buildId = null }) {
      return {
        format: 'maze-adventure-trace-qa-v1',
        buildId,
        privacy: 'Pointer coordinates are maze-local; no name, account, URL, or pointer identifier is recorded.',
        maze: { layoutId, dimensions, difficulty, start, finish, shortestSolutionLength, definition: mazeDefinition },
      current: { route, ink, inkCellAssociation, state },
        events: [...events],
        checkpoints: [...checkpoints],
        droppedEvents: dropped,
        eventLimit: limit,
        droppedCheckpoints,
        checkpointLimit: CHECKPOINT_LIMIT,
        counters: { observed, accepted: acceptedCount, rejectedByReason: { ...rejectedCounts }, canceled: canceledCount, durationMs: Math.max(0, now() - startedAt) },
      };
    },
    get length() { return events.length; },
    get dropped() { return dropped; },
    get checkpointCount() { return checkpoints.length; },
    get droppedCheckpoints() { return droppedCheckpoints; },
    get counters() { return { observed, accepted: acceptedCount, rejectedByReason: { ...rejectedCounts }, canceled: canceledCount, durationMs: Math.max(0, now() - startedAt) }; },
  };
}

/** Stable layout fingerprint so a report can be rebuilt without recording a random seed. */
export function mazeLayoutId(maze) {
  let hash = 2166136261;
  const bits = `${maze.width}x${maze.height}|${maze.start.x},${maze.start.y},${maze.entrance?.side ?? '?'}|${maze.end.x},${maze.end.y},${maze.exit?.side ?? '?'}|` +
    maze.cells.flatMap(row => row.map(cell => ['N', 'E', 'S', 'W'].map(direction => cell.walls[direction] ? '1' : '0').join(''))).join('');
  for (let index = 0; index < bits.length; index++) {
    hash ^= bits.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `maze-${maze.width}x${maze.height}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
