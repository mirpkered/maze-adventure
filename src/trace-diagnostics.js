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
        difficulty: typeof event.difficulty === 'string' ? event.difficulty.slice(0, 16) : null,
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
        failureCategory: typeof event.failureCategory === 'string' ? event.failureCategory.slice(0, 32) : null,
        traceHealth: typeof event.traceHealth === 'string' ? event.traceHealth.slice(0, 40) : null,
        interpolationCount: Number.isInteger(event.interpolationCount) ? event.interpolationCount : 0,
        attemptedTransitions: Array.isArray(event.attemptedTransitions) ? event.attemptedTransitions.slice(0, 24).map(transition => ({
          from: cell(transition.from), to: cell(transition.to), open: Boolean(transition.open),
        })) : [],
        controlSystem: typeof event.controlSystem === 'string' ? event.controlSystem.slice(0, 32) : null,
        activeController: typeof event.activeController === 'string' ? event.activeController.slice(0, 32) : null,
        movementClassification: typeof event.movementClassification === 'string' ? event.movementClassification.slice(0, 40) : null,
        requestedMovement: point(event.requestedMovement),
        acceptedMovement: point(event.acceptedMovement),
        steeringMetrics: event.steeringMetrics && typeof event.steeringMetrics === 'object' ? {
          difficulty: typeof event.steeringMetrics.difficulty === 'string' ? event.steeringMetrics.difficulty.slice(0, 16) : null,
          fingerDisplacementPixels: Number.isFinite(event.steeringMetrics.fingerDisplacementPixels) ? Math.round(event.steeringMetrics.fingerDisplacementPixels * 10) / 10 : null,
          normalizedDeflection: Number.isFinite(event.steeringMetrics.normalizedDeflection) ? Math.round(event.steeringMetrics.normalizedDeflection * 1000) / 1000 : null,
          speedDemand: Number.isFinite(event.steeringMetrics.speedDemand) ? Math.round(event.steeringMetrics.speedDemand * 1000) / 1000 : null,
          maxSpeedMazeUnitsPerSecond: Number.isFinite(event.steeringMetrics.maxSpeedMazeUnitsPerSecond) ? Math.round(event.steeringMetrics.maxSpeedMazeUnitsPerSecond * 1000) / 1000 : null,
          requestedSpeed: Number.isFinite(event.steeringMetrics.requestedSpeed) ? Math.round(event.steeringMetrics.requestedSpeed * 1000) / 1000 : null,
          acceptedSpeed: Number.isFinite(event.steeringMetrics.acceptedSpeed) ? Math.round(event.steeringMetrics.acceptedSpeed * 1000) / 1000 : null,
        } : null,
        strokeBreakCreated: Boolean(event.strokeBreakCreated),
        gestureState: String(event.gestureState ?? 'unknown').slice(0, 32),
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
    report({ layoutId, dimensions, difficulty = null, mazeFormat = 'classic', freePlayRoute = null, shapeId = null, shapeName = null, activeCellCount = null, generationSeed = null, mask = null, start = null, finish = null, shortestSolutionLength = null, exitInternalDegree = null, exitGatedCells = null, generationAttempts = null, generationDurationMs = null, generationQuality = null, mazeDefinition, route, ink, state, inkCellAssociation, buildId = null, layout = null }) {
      return {
        format: 'maze-adventure-trace-qa-v1',
        buildId,
        privacy: 'Pointer coordinates are maze-local; no name, account, URL, or pointer identifier is recorded.',
        layout,
        maze: { layoutId, mazeFormat, freePlayRoute, difficulty, shapeId, shapeName, dimensions, activeCellCount, generationSeed, mask, start, finish, shortestSolutionLength, exitInternalDegree, exitGatedCells, generationAttempts, generationDurationMs, generationQuality, definition: mazeDefinition },
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
  const bits = `${maze.mazeFormat ?? 'classic'}|${maze.shapeId ?? ''}|${maze.width}x${maze.height}|${maze.start.x},${maze.start.y},${maze.entrance?.side ?? '?'}|${maze.end.x},${maze.end.y},${maze.exit?.side ?? '?'}|` +
    maze.cells.flatMap(row => row.map(cell => cell ? ['N', 'E', 'S', 'W'].map(direction => cell.walls[direction] ? '1' : '0').join('') : '----')).join('');
  for (let index = 0; index < bits.length; index++) {
    hash ^= bits.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `maze-${maze.width}x${maze.height}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
