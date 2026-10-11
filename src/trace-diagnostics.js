const DEFAULT_EVENT_LIMIT = 400;

/** A bounded, privacy-conscious recorder for QA pointer replays. */
export function createTraceRecorder({ limit = DEFAULT_EVENT_LIMIT, now = () => performance.now() } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Diagnostic event limit must be a positive integer.');
  let startedAt = now();
  let events = [];
  let dropped = 0;
  const point = value => value && Number.isFinite(value.x) && Number.isFinite(value.y)
    ? { x: Math.round(value.x * 1000) / 1000, y: Math.round(value.y * 1000) / 1000 }
    : null;
  const cell = value => value && Number.isInteger(value.x) && Number.isInteger(value.y)
    ? { x: value.x, y: value.y }
    : null;
  return {
    record(event) {
      events.push({
        t: Math.max(0, Math.round(now() - startedAt)),
        eventType: String(event.eventType ?? 'unknown').slice(0, 32),
        pointerType: String(event.pointerType ?? 'unknown').slice(0, 16),
        client: point(event.client),
        maze: point(event.maze),
        cell: cell(event.cell),
        acceptedInkEndpoint: point(event.acceptedInkEndpoint),
        previousRouteCell: cell(event.previousRouteCell),
        gestureState: String(event.gestureState ?? 'unknown').slice(0, 16),
        accepted: Boolean(event.accepted),
        rejectedReason: typeof event.rejectedReason === 'string' ? event.rejectedReason.slice(0, 80) : null,
        blocked: Boolean(event.blocked),
        pointerCaptured: Boolean(event.pointerCaptured),
        pointerCanceled: Boolean(event.pointerCanceled),
        layoutId: typeof event.layoutId === 'string' ? event.layoutId.slice(0, 64) : null,
      });
      if (events.length > limit) { events.shift(); dropped++; }
    },
    reset() { events = []; dropped = 0; startedAt = now(); },
    report({ layoutId, dimensions, mazeDefinition, route, ink, state, inkCellAssociation }) {
      return {
        format: 'maze-adventure-trace-qa-v1',
        privacy: 'Pointer coordinates are maze-local; no name, account, URL, or pointer identifier is recorded.',
        maze: { layoutId, dimensions, definition: mazeDefinition },
        current: { route, ink, inkCellAssociation, state },
        events: [...events],
        droppedEvents: dropped,
        eventLimit: limit,
      };
    },
    get length() { return events.length; },
    get dropped() { return dropped; },
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
