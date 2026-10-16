import { advancePath, canMove } from './maze.js';

const MAX_SAMPLE_DISTANCE = 0.055;
const CORRIDOR_MARGIN = 0.46;
const ENTRANCE_TOLERANCE = 0.62;
const STROKE_WALL_SAFE_OFFSET = 0.42;
const MIN_STROKE_POINT_DISTANCE = 0.015;
const DEFAULT_ACQUISITION_RADIUS = 0.5;

function nearestCell(point, maze) {
  const roundedX = Math.round(point.x), roundedY = Math.round(point.y);
  const x = Object.is(roundedX, -0) ? 0 : roundedX, y = Object.is(roundedY, -0) ? 0 : roundedY;
  if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return null;
  return { x, y };
}

function sameCell(a, b) { return a.x === b.x && a.y === b.y; }
function copyPoint(point) { return { x: point.x, y: point.y }; }

function outsideEntrance(point, maze) {
  const entrance = maze.entrance;
  if (!entrance || !sameCell(entrance.cell, maze.start)) return false;
  const dx = point.x - entrance.cell.x, dy = point.y - entrance.cell.y;
  const outward = entrance.side === 'N' ? -dy : entrance.side === 'S' ? dy : entrance.side === 'E' ? dx : -dx;
  const tangent = entrance.side === 'N' || entrance.side === 'S' ? Math.abs(dx) : Math.abs(dy);
  return outward > CORRIDOR_MARGIN && outward <= ENTRANCE_TOLERANCE && tangent <= CORRIDOR_MARGIN;
}

function insideCell(point, cell, maze) {
  const dx = point.x - cell.x, dy = point.y - cell.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (sameCell(cell, maze.start) && outsideEntrance(point, maze)) return true;
  if (ax <= CORRIDOR_MARGIN && ay <= CORRIDOR_MARGIN) return true;
  if (ax <= 0.5 && ay <= CORRIDOR_MARGIN && dx !== 0 && canMove(maze, cell, { x: cell.x + Math.sign(dx), y: cell.y })) return true;
  if (ay <= 0.5 && ax <= CORRIDOR_MARGIN && dy !== 0 && canMove(maze, cell, { x: cell.x, y: cell.y + Math.sign(dy) })) return true;
  return false;
}

function constrainStrokePoint(point, cell, maze) {
  const dx = point.x - cell.x, dy = point.y - cell.y;
  const entranceSide = sameCell(cell, maze.start) && outsideEntrance(point, maze) ? maze.entrance.side : null;
  return {
    x: entranceSide === 'W' || entranceSide === 'E' ? point.x : cell.x + Math.max(-STROKE_WALL_SAFE_OFFSET, Math.min(STROKE_WALL_SAFE_OFFSET, dx)),
    y: entranceSide === 'N' || entranceSide === 'S' ? point.y : cell.y + Math.max(-STROKE_WALL_SAFE_OFFSET, Math.min(STROKE_WALL_SAFE_OFFSET, dy)),
  };
}

function appendInk(stroke, strokeCells, strokeBreaks, point, cell, breakBefore = false) {
  const last = stroke.at(-1);
  if (!last || Math.hypot(point.x - last.x, point.y - last.y) > MIN_STROKE_POINT_DISTANCE) {
    // A break belongs to an actual new point. Recording it before the
    // distance filter leaves a dangling M command when recovery only moves
    // within the point-spacing threshold; the next real point then appears as
    // a detached fragment despite no accepted ink having started there.
    if (breakBefore && stroke.length && strokeBreaks.at(-1) !== stroke.length) strokeBreaks.push(stroke.length);
    stroke.push(copyPoint(point));
    strokeCells.push({ ...cell });
  }
}

/**
 * The maze graph and current pencil position are authoritative. Ink is an
 * append-only history; it is never consulted to decide where the pencil may
 * move and is never shortened by retracing.
 */
export function traceSegment(maze, path, from, to, currentStroke = path.map(copyPoint), previousPoint = from, recovering = false, currentStrokeCells = null, acceptedPosition = currentStroke.at(-1), currentStrokeBreaks = []) {
  let nextPath = path;
  const stroke = currentStroke.map(copyPoint);
  const strokeCells = currentStrokeCells?.map(cell => ({ ...cell })) ?? stroke.map(point => nearestCell(point, maze) ?? path.at(-1));
  const strokeBreaks = [...currentStrokeBreaks];
  let position = copyPoint(acceptedPosition ?? currentStroke.at(-1) ?? path.at(-1));
  let moved = false, blocked = false, complete = false, wallCollision = false, reason = null;
  let interpolatedSamples = 0;
  const attemptedTransitions = [];
  const initialBreakCount = strokeBreaks.length;
  const reject = code => { blocked = true; reason ??= code; };
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(distance / MAX_SAMPLE_DISTANCE));
  interpolatedSamples = Math.max(0, samples - 1);
  let rejoining = recovering;

  for (let index = 1; index <= samples; index++) {
    const point = { x: from.x + (to.x - from.x) * index / samples, y: from.y + (to.y - from.y) * index / samples };
    const candidate = nearestCell(point, maze);
    if (!candidate) { reject('outside-maze'); rejoining = true; continue; }

    const current = nextPath.at(-1);
    const same = sameCell(candidate, current);
    if (rejoining && (!same && !canMove(maze, current, candidate))) {
      const adjacent = Math.abs(candidate.x - current.x) + Math.abs(candidate.y - current.y) === 1;
      if (adjacent) {
        wallCollision = true;
        reject('closed-or-nonadjacent-edge');
        break;
      }
      reject('rejoin-not-route-tail');
      continue;
    }

    let transition = null;
    if (!same) {
      const dx = candidate.x - current.x, dy = candidate.y - current.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) attemptedTransitions.push({ from: { ...current }, to: { ...candidate }, open: canMove(maze, current, candidate) });
      if (Math.abs(dx) + Math.abs(dy) !== 1 || !canMove(maze, current, candidate)) {
        wallCollision ||= Math.abs(dx) + Math.abs(dy) === 1 && !canMove(maze, current, candidate);
        reject('closed-or-nonadjacent-edge');
        rejoining = true;
        // Do not accept a later sample from this same sparse diagonal segment;
        // it may already have crossed a wall corner before re-entering a cell.
        break;
      }
      const crossAxisOffset = dx !== 0 ? Math.abs(point.y - candidate.y) : Math.abs(point.x - candidate.x);
      if (crossAxisOffset > CORRIDOR_MARGIN) { reject('off-center-edge'); rejoining = true; break; }
      // Validate before mutating the route so an edge sample at a corner cannot
      // leave the logical route one cell ahead of the legal pencil position.
      if (!insideCell(point, candidate, maze)) {
        reject(rejoining ? 'outside-rejoin-corridor' : 'outside-current-corridor');
        rejoining = true;
        continue;
      }
      transition = advancePath(maze, nextPath, candidate);
      if (!transition.moved) { reject('closed-or-nonadjacent-edge'); rejoining = true; continue; }
      nextPath = transition.path;
      complete ||= transition.complete;
      moved = true;
    } else if (!insideCell(point, current, maze)) {
      const dx = point.x - current.x, dy = point.y - current.y;
      const wallSide = Math.abs(dx) > CORRIDOR_MARGIN
        ? !canMove(maze, current, { x: current.x + Math.sign(dx), y: current.y })
        : Math.abs(dy) > CORRIDOR_MARGIN
          ? !canMove(maze, current, { x: current.x, y: current.y + Math.sign(dy) })
          : false;
      reject(wallSide ? 'closed-wall-collision' : 'outside-current-corridor');
      if (wallSide) {
        wallCollision = true;
        rejoining = true;
        break;
      }
      rejoining = true;
      continue;
    }

    const accepted = constrainStrokePoint(point, candidate, maze);
    if (Math.hypot(accepted.x - position.x, accepted.y - position.y) > MIN_STROKE_POINT_DISTANCE) {
      appendInk(stroke, strokeCells, strokeBreaks, accepted, candidate, rejoining);
      position = accepted;
      moved = true;
    }
    rejoining = false;
  }

  return { path: nextPath, stroke, strokeCells, strokeBreaks, position, moved, blocked, reason, complete, wallCollision, recovering: rejoining, recovered: blocked && moved && !rejoining,
    interpolatedSamples, attemptedTransitions, strokeBreakCreated: strokeBreaks.length > initialBreakCount };
}

/** Pointer lift and cancellation preserve both the legal endpoint and all ink. */
export function createTraceSession(maze) {
  let path = [{ ...maze.start }];
  let stroke = [{ ...maze.start }];
  let strokeCells = [{ ...maze.start }];
  let strokeBreaks = [];
  let position = { ...maze.start };
  let pointerId = null;
  let lockedPointerId = null;
  let lockedOutMovementCount = 0;
  let wallCollisionTerminated = false;
  let lastResumeAfterWallCollision = false;
  let lastTracePoint = null;
  let lastPointerPoint = null;
  let hasBegun = false;
  let recovering = false;
  let lastBlocked = false;
  let lastReason = null;
  let lastFailureCategory = null;
  let lastResumeDistance = null;
  let lastResumeThreshold = 0;
  let lastResumeDistancePixels = null;
  let lastResumeThresholdPixels = null;
  const failureCategory = reason => {
    if (!reason) return null;
    if (reason.startsWith('begin-')) return 'acquisition';
    if (reason === 'closed-wall-collision' || reason === 'closed-or-nonadjacent-edge' || reason === 'off-center-edge') return 'collision';
    if (reason.startsWith('rejoin-') || reason === 'route-revisit') return 'route-history';
    if (reason.startsWith('outside-')) return 'corridor-recovery';
    return 'gesture';
  };
  const end = id => {
    if (pointerId !== id && lockedPointerId !== id) return false;
    if (pointerId === id) {
      pointerId = null;
      lastTracePoint = null;
      lastPointerPoint = null;
      recovering = false;
    }
    if (lockedPointerId === id) {
      lockedPointerId = null;
      lockedOutMovementCount = 0;
      lastPointerPoint = null;
      recovering = false;
    }
    return true;
  };

  return {
    get path() { return path; },
    get stroke() { return stroke; },
    get strokeBreaks() { return strokeBreaks; },
    get position() { return position; },
    get endpoint() { return position; },
    get active() { return pointerId !== null; },
    get diagnostics() {
      const cell = path.at(-1);
      const candidateReversal = path.length > 1 ? { ...path.at(-2) } : null;
      const candidateReversalOpen = candidateReversal ? canMove(maze, cell, candidateReversal) : false;
      const traceHealth = lockedPointerId !== null ? 'wall-collision-gesture-terminated'
        : lastFailureCategory === 'acquisition' ? 'acquisition-rejected'
        : lastFailureCategory === 'route-history' ? 'route-history-rejected'
          : lastFailureCategory === 'collision' && candidateReversalOpen ? 'wall-blocked-reversal-available'
            : recovering && candidateReversalOpen ? 'recovering-reversal-available'
              : recovering ? 'recovery-needs-corridor-reentry'
                : lastBlocked ? 'blocked' : 'ready';
      return {
        raw: lastPointerPoint ? copyPoint(lastPointerPoint) : null,
        endpoint: copyPoint(position), authoritativePosition: copyPoint(position),
        cell: { ...cell }, logicalCell: { ...cell },
        previousCell: candidateReversal, candidateReversal,
        candidateReversalOpen,
        traceHealth,
        strokeCells: strokeCells.map(cell => ({ ...cell })), strokeBreaks: [...strokeBreaks],
        active: pointerId !== null, recovering, blocked: lastBlocked, reason: lastReason,
        lockedOut: lockedPointerId !== null, lockedOutMovementCount,
        wallCollisionTerminated, resumeAfterWallCollision: lastResumeAfterWallCollision,
        failureCategory: lastFailureCategory,
        resumeAcquisitionDistance: lastResumeDistance,
        resumeAcquisitionThreshold: lastResumeThreshold,
        resumeAcquisitionDistancePixels: lastResumeDistancePixels,
        resumeAcquisitionThresholdPixels: lastResumeThresholdPixels,
        pathLength: path.length, strokeLength: stroke.length,
      };
    },
    begin(id, point, { radius = DEFAULT_ACQUISITION_RADIUS, pixelsPerMazeUnit = null } = {}) {
      if (lockedPointerId !== null) {
        lastReason = 'wall-collision-pointer-locked-until-release';
        lastFailureCategory = 'gesture';
        lastBlocked = true;
        return false;
      }
      if (pointerId !== null) { lastReason = 'gesture-already-active'; return false; }
      const cell = nearestCell(point, maze);
      const entranceStart = path.length === 1 && stroke.length === 1;
      const atEntrance = entranceStart && cell && sameCell(cell, maze.start) && outsideEntrance(point, maze);
      lastResumeDistance = Math.hypot(point.x - position.x, point.y - position.y);
      lastResumeThreshold = Number.isFinite(radius) && radius >= 0 ? radius : DEFAULT_ACQUISITION_RADIUS;
      lastResumeDistancePixels = Number.isFinite(pixelsPerMazeUnit) && pixelsPerMazeUnit > 0
        ? lastResumeDistance * pixelsPerMazeUnit : null;
      lastResumeThresholdPixels = Number.isFinite(pixelsPerMazeUnit) && pixelsPerMazeUnit > 0
        ? lastResumeThreshold * pixelsPerMazeUnit : null;
      if (entranceStart && (!cell || !sameCell(cell, maze.start) || (!insideCell(point, cell, maze) && !atEntrance))) {
        lastReason = 'begin-outside-route-endpoint-corridor';
        lastFailureCategory = 'acquisition';
        lastBlocked = true;
        return false;
      }
      if (!entranceStart && !atEntrance && lastResumeDistance > lastResumeThreshold + 1e-9) {
        lastReason = 'begin-outside-route-endpoint-corridor';
        lastFailureCategory = 'acquisition';
        lastBlocked = true;
        return false;
      }
      pointerId = id;
      lastResumeAfterWallCollision = wallCollisionTerminated;
      wallCollisionTerminated = false;
      // Anchor this gesture's contact point at the legal pencil endpoint.
      // The acquisition offset is not movement: only later finger deltas are
      // sent through the normal swept collision and route-history checks.
      lastPointerPoint = copyPoint(point);
      lastTracePoint = copyPoint(hasBegun ? position : point);
      hasBegun = true;
      recovering = false;
      lastBlocked = false;
      lastReason = null;
      lastFailureCategory = null;
      return true;
    },
    move(id, point) {
      if (lockedPointerId === id) {
        lockedOutMovementCount++;
        lastPointerPoint = copyPoint(point);
        return { path, stroke, position, moved: false, blocked: true, reason: 'wall-collision-pointer-locked-out', complete: false,
          ignored: true, lockedOut: true, lockedOutMovementCount, firstLockedOutMove: lockedOutMovementCount === 1 };
      }
      if (pointerId !== id || !lastTracePoint || !lastPointerPoint) { lastReason = 'move-without-active-gesture'; return { path, stroke, position, moved: false, blocked: false, reason: lastReason, complete: false }; }
      const target = {
        x: lastTracePoint.x + point.x - lastPointerPoint.x,
        y: lastTracePoint.y + point.y - lastPointerPoint.y,
      };
      const result = traceSegment(maze, path, lastTracePoint, target, stroke, lastTracePoint, recovering, strokeCells, position, strokeBreaks);
      path = result.path;
      stroke = result.stroke;
      strokeCells = result.strokeCells;
      strokeBreaks = result.strokeBreaks;
      position = result.position;
      lastPointerPoint = copyPoint(point);
      lastTracePoint = target;
      if (result.wallCollision) {
        pointerId = null;
        lockedPointerId = id;
        lockedOutMovementCount = 0;
        lastTracePoint = null;
        recovering = false;
        wallCollisionTerminated = true;
        lastBlocked = true;
        lastReason = result.reason;
        lastFailureCategory = 'collision';
        lastResumeAfterWallCollision = false;
        return { ...result, recovering: false, recovered: false, gestureTerminatedByWallCollision: true, lockedOut: true };
      }
      recovering = result.recovering;
      lastBlocked = result.recovered ? false : result.blocked;
      lastReason = result.recovered ? null : result.reason;
      lastFailureCategory = result.recovered ? null : failureCategory(result.reason);
      return result;
    },
    step(direction) {
      if (pointerId !== null || lockedPointerId !== null) return { path, stroke, position, moved: false, blocked: false, complete: false };
      const current = path.at(-1), candidate = { x: current.x + direction.x, y: current.y + direction.y };
      const advance = advancePath(maze, path, candidate);
      if (!advance.moved) { lastReason = canMove(maze, current, candidate) ? 'route-revisit' : 'closed-or-nonadjacent-edge'; lastFailureCategory = failureCategory(lastReason); lastBlocked = true; return { path, stroke, position, moved: false, blocked: true, reason: lastReason, complete: false }; }
      path = advance.path;
      position = { ...candidate };
      appendInk(stroke, strokeCells, strokeBreaks, position, candidate);
      recovering = false;
      lastBlocked = false;
      lastReason = null;
      lastFailureCategory = null;
      return { path, stroke, position, moved: true, blocked: false, complete: advance.complete };
    },
    end,
    cancel: end,
  };
}
