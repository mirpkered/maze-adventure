import { ORGANIC_CIRCLE_CONSTANTS } from './organic-maze.js';

const copy = point => ({ x: point.x, y: point.y });
const magnitude = vector => Math.hypot(vector.x, vector.y);
const distance = (a, b) => magnitude({ x: a.x - b.x, y: a.y - b.y });
const MIN_INK_POINT = 0.004;

function exitCrossing(from, to, maze) {
  const radius = maze.geometry.radius, direction = maze.exit.direction, portal = maze.exit.position;
  const previousRadius = magnitude(from), nextRadius = magnitude(to);
  if (previousRadius > radius + 1e-6 || nextRadius <= radius + 1e-8 || (to.x - from.x) * direction.x + (to.y - from.y) * direction.y <= 0) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  const a = dx * dx + dy * dy, b = 2 * (from.x * dx + from.y * dy), c = from.x * from.x + from.y * from.y - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0 || a === 0) return false;
  const rawT = (-b + Math.sqrt(discriminant)) / (2 * a);
  if (rawT < -1e-8 || rawT > 1) return false;
  const t = Math.max(0, rawT);
  const crossing = { x: from.x + dx * t, y: from.y + dy * t };
  const along = (crossing.x - portal.x) * direction.x + (crossing.y - portal.y) * direction.y;
  const across = Math.abs((crossing.x - portal.x) * direction.y - (crossing.y - portal.y) * direction.x);
  return Math.abs(along) <= 0.026 && across <= maze.geometry.halfWidth * 0.82;
}

function clampLastLegal(from, blocked, maze) {
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 20; iteration++) {
    const middle = (low + high) / 2;
    const point = { x: from.x + (blocked.x - from.x) * middle, y: from.y + (blocked.y - from.y) * middle };
    if (maze.geometry.isLegalPoint(point)) low = middle;
    else high = middle;
  }
  return { x: from.x + (blocked.x - from.x) * low, y: from.y + (blocked.y - from.y) * low };
}

/** Geometry-backed continuous trace session. No cell coordinates are fabricated. */
export function createOrganicTraceSession(maze) {
  let position = copy(maze.start), stroke = [copy(maze.start)], route = [copy(maze.start)];
  let pointerId = null, completionCommitted = false, lastBlocked = false, lastReason = null, invalidPerimeterAttempts = 0;
  const pushInk = point => {
    if (distance(point, stroke.at(-1)) > MIN_INK_POINT) stroke.push(copy(point));
  };
  const end = id => { if (pointerId !== id) return false; pointerId = null; return true; };
  const move = to => {
    const from = copy(position), delta = { x: to.x - from.x, y: to.y - from.y }, length = magnitude(delta);
    const step = Math.min(ORGANIC_CIRCLE_CONSTANTS.renderStep * 0.72, maze.geometry.corridorWidth / 12);
    const count = Math.max(1, Math.ceil(length / step));
    let moved = false, complete = false, blocked = false, reason = null, finishPosition = null;
    for (let index = 1; index <= count; index++) {
      const candidate = { x: from.x + delta.x * index / count, y: from.y + delta.y * index / count };
      const previous = position;
      if (exitCrossing(previous, candidate, maze)) {
        finishPosition = copy(maze.exit.outside);
        if (!maze.geometry.isLegalPoint(finishPosition, 0.001)) {
          blocked = true; reason = 'exit-extension-invalid'; break;
        }
        const extensionDelta = { x: finishPosition.x - candidate.x, y: finishPosition.y - candidate.y };
        const extensionSteps = Math.max(1, Math.ceil(magnitude(extensionDelta) / step));
        let extensionValid = true;
        for (let extensionIndex = 0; extensionIndex <= extensionSteps; extensionIndex++) {
          const fraction = extensionIndex / extensionSteps;
          const point = { x: candidate.x + extensionDelta.x * fraction, y: candidate.y + extensionDelta.y * fraction };
          if (!maze.geometry.isLegalPoint(point, 0.001)) { extensionValid = false; break; }
          position = point; pushInk(position); route.push(copy(position));
        }
        if (!extensionValid) { blocked = true; reason = 'exit-extension-invalid'; break; }
        moved = true; complete = true; completionCommitted = true;
        break;
      }
      if (!maze.geometry.isLegalPoint(candidate)) {
        const radial = magnitude(candidate);
        position = clampLastLegal(previous, candidate, maze);
        pushInk(position); moved ||= distance(position, previous) > 1e-7;
        blocked = true; reason = radial > maze.geometry.radius ? 'unauthorized-outer-boundary' : 'curved-wall-collision';
        if (radial > maze.geometry.radius) invalidPerimeterAttempts++;
        break;
      }
      position = candidate;
      if (distance(position, route.at(-1)) > 0.008) route.push(copy(position));
      pushInk(position); moved ||= distance(position, previous) > 1e-7;
    }
    lastBlocked = blocked; lastReason = reason;
    return {
      path: route, stroke, strokeBreaks: [], strokeCells: [], position: copy(position), moved, blocked,
      wallCollision: blocked && reason === 'curved-wall-collision', reason, complete,
      exitBoundaryReached: complete, completionReason: complete ? 'designated-organic-exit-crossing' : null,
      finishPosition, enteredExitCell: false, interpolatedSamples: Math.max(0, count - 1), attemptedTransitions: [],
      invalidPerimeterAttempts,
    };
  };
  const diagnostics = () => ({
    endpoint: copy(position), authoritativePosition: copy(position), cell: copy(position), logicalCell: copy(position),
    previousCell: null, candidateReversal: null, candidateReversalOpen: false, controlSystem: 'continuous-steering',
    traceHealth: lastBlocked ? 'blocked' : 'ready', active: pointerId !== null, blocked: lastBlocked,
    reason: lastReason, failureCategory: lastBlocked ? 'geometry' : null, pathLength: route.length, strokeLength: stroke.length,
    exitCellEntered: false, currentlyInExitCell: distanceToExitTube(position, maze) <= maze.geometry.halfWidth * 1.8,
    exitBoundaryReached: completionCommitted, completionCommitted,
    exitCell: null, exitSide: 'circular', finishPosition: completionCommitted ? copy(position) : null,
    completionReason: completionCommitted ? 'designated-organic-exit-crossing' : null,
    invalidPerimeterAttempts, strokeCells: [], strokeBreaks: [],
  });
  return {
    get path() { return route; }, get stroke() { return stroke; }, get strokeBreaks() { return []; },
    get position() { return position; }, get endpoint() { return position; }, get active() { return pointerId !== null; },
    get diagnostics() { return diagnostics(); },
    beginSteering(id) { if (pointerId !== null || completionCommitted) return false; pointerId = id; lastBlocked = false; lastReason = null; return true; },
    steer(id, delta) {
      if (completionCommitted) return { path: route, stroke, position: copy(position), moved: false, blocked: false, complete: false, reason: 'attempt-already-completed' };
      if (pointerId !== id) return { path: route, stroke, position: copy(position), moved: false, blocked: false, complete: false, reason: 'steering-without-active-gesture' };
      if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.y)) return { path: route, stroke, position: copy(position), moved: false, blocked: true, complete: false, reason: 'invalid-steering-delta' };
      const wasBlocked = lastBlocked;
      const result = move({ x: position.x + delta.x, y: position.y + delta.y });
      return { ...result, recovered: wasBlocked && result.moved && !result.blocked };
    },
    step(direction) {
      if (pointerId !== null || completionCommitted) return { path: route, stroke, position: copy(position), moved: false, blocked: false, complete: false };
      return move({ x: position.x + direction.x * 0.035, y: position.y + direction.y * 0.035 });
    },
    end, cancel: end,
  };
}

function distanceToExitTube(point, maze) {
  const { position, direction } = maze.exit;
  const relative = { x: point.x - position.x, y: point.y - position.y };
  const along = relative.x * direction.x + relative.y * direction.y;
  const across = Math.abs(relative.x * direction.y - relative.y * direction.x);
  return along >= -0.2 && along <= 0.15 ? across : Infinity;
}
