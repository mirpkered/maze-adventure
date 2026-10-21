import { advancePath, canMove } from './maze.js';

const MAX_SAMPLE_DISTANCE = 0.055;
const CORRIDOR_MARGIN = 0.46;
const ENTRANCE_TOLERANCE = 0.62;
const STROKE_WALL_SAFE_OFFSET = 0.42;
const MIN_STROKE_POINT_DISTANCE = 0.015;

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

function constrainStrokePoint(point, cell, maze, allowOpenEdgeProgress = false) {
  const dx = point.x - cell.x, dy = point.y - cell.y;
  const entranceSide = sameCell(cell, maze.start) && outsideEntrance(point, maze) ? maze.entrance.side : null;
  // Steering applies each frame's displacement to the authoritative pencil
  // endpoint. Let it accumulate all the way to an OPEN cell boundary; the
  // ordinary ink clamp (0.42) otherwise strands it before nearestCell can
  // classify the adjacent cell at 0.5. The swept edge checks still decide
  // whether that transition is legal, and the perpendicular axis stays in
  // the existing corridor margin.
  const xCorridor = allowOpenEdgeProgress && Math.abs(dy) <= CORRIDOR_MARGIN ? CORRIDOR_MARGIN : STROKE_WALL_SAFE_OFFSET;
  const yCorridor = allowOpenEdgeProgress && Math.abs(dx) <= CORRIDOR_MARGIN ? CORRIDOR_MARGIN : STROKE_WALL_SAFE_OFFSET;
  const xLimit = allowOpenEdgeProgress && Math.abs(dy) <= CORRIDOR_MARGIN && dx !== 0
    ? canMove(maze, cell, { x: cell.x + Math.sign(dx), y: cell.y }) ? 0.5 : xCorridor : STROKE_WALL_SAFE_OFFSET;
  const yLimit = allowOpenEdgeProgress && Math.abs(dx) <= CORRIDOR_MARGIN && dy !== 0
    ? canMove(maze, cell, { x: cell.x, y: cell.y + Math.sign(dy) }) ? 0.5 : yCorridor : STROKE_WALL_SAFE_OFFSET;
  return {
    x: entranceSide === 'W' || entranceSide === 'E' ? point.x : cell.x + Math.max(-xLimit, Math.min(xLimit, dx)),
    y: entranceSide === 'N' || entranceSide === 'S' ? point.y : cell.y + Math.max(-yLimit, Math.min(yLimit, dy)),
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
export function traceSegment(maze, path, from, to, currentStroke = path.map(copyPoint), currentStrokeCells = null, acceptedPosition = currentStroke.at(-1), currentStrokeBreaks = [], { advanceSubthreshold = false, allowOpenEdgeProgress = false } = {}) {
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

  for (let index = 1; index <= samples; index++) {
    const point = { x: from.x + (to.x - from.x) * index / samples, y: from.y + (to.y - from.y) * index / samples };
    const candidate = nearestCell(point, maze);
    if (!candidate) { reject('outside-maze'); break; }

    const current = nextPath.at(-1);
    if (!sameCell(candidate, current)) {
      const dx = candidate.x - current.x, dy = candidate.y - current.y;
      const adjacent = Math.abs(dx) + Math.abs(dy) === 1;
      const open = adjacent && canMove(maze, current, candidate);
      if (adjacent) attemptedTransitions.push({ from: { ...current }, to: { ...candidate }, open });
      if (!open) {
        wallCollision ||= adjacent;
        reject('closed-or-nonadjacent-edge');
        break;
      }
      const crossAxisOffset = dx !== 0 ? Math.abs(point.y - candidate.y) : Math.abs(point.x - candidate.x);
      if (crossAxisOffset > CORRIDOR_MARGIN) { reject('off-center-edge'); break; }
      if (!insideCell(point, candidate, maze)) { reject('outside-current-corridor'); break; }
      const transition = advancePath(maze, nextPath, candidate);
      if (!transition.moved) { reject('closed-or-nonadjacent-edge'); break; }
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
      wallCollision = wallSide;
      break;
    }

    const accepted = constrainStrokePoint(point, candidate, maze, allowOpenEdgeProgress);
    const acceptedDistance = Math.hypot(accepted.x - position.x, accepted.y - position.y);
    if (advanceSubthreshold ? acceptedDistance > 1e-9 : acceptedDistance > MIN_STROKE_POINT_DISTANCE) {
      appendInk(stroke, strokeCells, strokeBreaks, accepted, candidate);
      position = accepted;
      moved = true;
    }
  }

  return { path: nextPath, stroke, strokeCells, strokeBreaks, position, moved, blocked, reason, complete, wallCollision,
    interpolatedSamples, attemptedTransitions, strokeBreakCreated: strokeBreaks.length > initialBreakCount };
}

/** Shared authoritative maze route, pencil endpoint, and append-only ink session. */
export function createTraceSession(maze) {
  let path = [{ ...maze.start }];
  let stroke = [{ ...maze.start }];
  let strokeCells = [{ ...maze.start }];
  let strokeBreaks = [];
  let position = { ...maze.start };
  let pointerId = null;
  let lastBlocked = false;
  let lastReason = null;
  let lastFailureCategory = null;
  const failureCategory = reason => {
    if (!reason) return null;
    if (reason === 'closed-wall-collision' || reason === 'closed-or-nonadjacent-edge' || reason === 'off-center-edge') return 'collision';
    if (reason === 'route-revisit') return 'route-history';
    if (reason.startsWith('outside-')) return 'corridor';
    return 'movement';
  };
  const end = id => {
    if (pointerId !== id) return false;
    pointerId = null;
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
      return {
        endpoint: copyPoint(position), authoritativePosition: copyPoint(position),
        cell: { ...cell }, logicalCell: { ...cell }, previousCell: candidateReversal,
        candidateReversal, candidateReversalOpen, controlSystem: 'continuous-steering',
        traceHealth: lastBlocked ? 'blocked' : 'ready', active: pointerId !== null,
        blocked: lastBlocked, reason: lastReason, failureCategory: lastFailureCategory,
        pathLength: path.length, strokeLength: stroke.length,
        strokeCells: strokeCells.map(item => ({ ...item })), strokeBreaks: [...strokeBreaks],
      };
    },
    beginSteering(id) {
      if (pointerId !== null) { lastReason = 'gesture-already-active'; lastFailureCategory = 'movement'; lastBlocked = true; return false; }
      pointerId = id;
      lastBlocked = false; lastReason = null; lastFailureCategory = null;
      return true;
    },
    steer(id, delta) {
      if (pointerId !== id) return { path, stroke, position, moved: false, blocked: false, complete: false, reason: 'steering-without-active-gesture' };
      if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.y)) {
        return { path, stroke, position, moved: false, blocked: false, complete: false, reason: 'invalid-steering-delta' };
      }
      const from = copyPoint(position), to = { x: from.x + delta.x, y: from.y + delta.y };
      const result = traceSegment(maze, path, from, to, stroke, strokeCells, position, strokeBreaks,
        { advanceSubthreshold: true, allowOpenEdgeProgress: true });
      path = result.path; stroke = result.stroke; strokeCells = result.strokeCells;
      strokeBreaks = result.strokeBreaks; position = result.position;
      const recovered = lastBlocked && result.moved && !result.blocked;
      lastBlocked = result.blocked; lastReason = result.reason;
      lastFailureCategory = result.blocked ? failureCategory(result.reason) : null;
      return { ...result, recovered, steeringCollision: result.wallCollision };
    },
    step(direction) {
      if (pointerId !== null) return { path, stroke, position, moved: false, blocked: false, complete: false };
      const current = path.at(-1), candidate = { x: current.x + direction.x, y: current.y + direction.y };
      const advance = advancePath(maze, path, candidate);
      if (!advance.moved) {
        lastReason = canMove(maze, current, candidate) ? 'route-revisit' : 'closed-or-nonadjacent-edge';
        lastFailureCategory = failureCategory(lastReason); lastBlocked = true;
        return { path, stroke, position, moved: false, blocked: true, reason: lastReason, complete: false };
      }
      path = advance.path; position = { ...candidate };
      appendInk(stroke, strokeCells, strokeBreaks, position, candidate);
      lastBlocked = false; lastReason = null; lastFailureCategory = null;
      return { path, stroke, position, moved: true, blocked: false, complete: advance.complete };
    },
    end,
    cancel: end,
  };
}
