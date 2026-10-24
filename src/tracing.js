import { advancePath, canMove, inBounds } from './maze.js';
import { createOrganicTraceSession } from './organic-tracing.js';

const MAX_SAMPLE_DISTANCE = 0.055;
const CORRIDOR_MARGIN = 0.46;
const ENTRANCE_TOLERANCE = 0.62;
const STROKE_WALL_SAFE_OFFSET = 0.42;
const MIN_STROKE_POINT_DISTANCE = 0.015;
// End near the existing flower marker while keeping the final pencil visible
// inside the fixed 400×400 SVG for every shipped grid size.
const FINISH_EXTENSION = 0.78;

function nearestCell(point, maze) {
  const roundedX = Math.round(point.x), roundedY = Math.round(point.y);
  const x = Object.is(roundedX, -0) ? 0 : roundedX, y = Object.is(roundedY, -0) ? 0 : roundedY;
  const cell = { x, y };
  return inBounds(maze, cell) ? cell : null;
}

function sameCell(a, b) { return a.x === b.x && a.y === b.y; }
function copyPoint(point) { return { x: point.x, y: point.y }; }

function exitFinishPoint(maze) {
  if (!maze.exit || maze.cells[maze.exit.cell.y]?.[maze.exit.cell.x]?.walls?.[maze.exit.side] !== false) return null;
  const point = { ...maze.exit.cell };
  if (maze.exit.side === 'N') point.y -= FINISH_EXTENSION;
  else if (maze.exit.side === 'E') point.x += FINISH_EXTENSION;
  else if (maze.exit.side === 'S') point.y += FINISH_EXTENSION;
  else if (maze.exit.side === 'W') point.x -= FINISH_EXTENSION;
  else return null;
  return point;
}

function crossedDeclaredExit(previous, point, current, maze) {
  const exit = maze.exit;
  if (!exit || !sameCell(current, exit.cell)
    || maze.cells[exit.cell.y]?.[exit.cell.x]?.walls?.[exit.side] !== false) return false;
  const { x, y } = exit.cell;
  const boundary = exit.side === 'N' ? y - 0.5 : exit.side === 'S' ? y + 0.5
    : exit.side === 'W' ? x - 0.5 : x + 0.5;
  const previousAxis = exit.side === 'N' || exit.side === 'S' ? previous.y : previous.x;
  const currentAxis = exit.side === 'N' || exit.side === 'S' ? point.y : point.x;
  const outwardSign = exit.side === 'N' || exit.side === 'W' ? -1 : 1;
  const previousDistance = (previousAxis - boundary) * outwardSign;
  const currentDistance = (currentAxis - boundary) * outwardSign;
  const tangent = exit.side === 'N' || exit.side === 'S' ? point.x : point.y;
  const previousTangent = exit.side === 'N' || exit.side === 'S' ? previous.x : previous.y;
  const tangentCenter = exit.side === 'N' || exit.side === 'S' ? x : y;
  return previousDistance <= 1e-9 && currentDistance > 0 && currentDistance > previousDistance
    && Math.abs(tangent - tangentCenter) <= CORRIDOR_MARGIN
    && Math.abs(previousTangent - tangentCenter) <= CORRIDOR_MARGIN;
}

function outsideEntrance(point, maze) {
  const entrance = maze.entrance;
  if (!entrance || !sameCell(entrance.cell, maze.start)) return false;
  const dx = point.x - entrance.cell.x, dy = point.y - entrance.cell.y;
  const outward = entrance.side === 'N' ? -dy : entrance.side === 'S' ? dy : entrance.side === 'E' ? dx : -dx;
  const tangent = entrance.side === 'N' || entrance.side === 'S' ? Math.abs(dx) : Math.abs(dy);
  return outward > CORRIDOR_MARGIN && outward <= ENTRANCE_TOLERANCE && tangent <= CORRIDOR_MARGIN;
}

function onExitApproach(point, cell, maze) {
  const exit = maze.exit;
  if (!exit || !sameCell(cell, exit.cell) || maze.cells[cell.y]?.[cell.x]?.walls?.[exit.side] !== false) return false;
  const outward = exit.side === 'N' ? cell.y - point.y : exit.side === 'S' ? point.y - cell.y
    : exit.side === 'W' ? cell.x - point.x : point.x - cell.x;
  const tangent = exit.side === 'N' || exit.side === 'S' ? Math.abs(point.x - cell.x) : Math.abs(point.y - cell.y);
  return outward >= 0 && outward <= 0.5 && tangent <= CORRIDOR_MARGIN;
}

function insideCell(point, cell, maze) {
  const dx = point.x - cell.x, dy = point.y - cell.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (sameCell(cell, maze.start) && outsideEntrance(point, maze)) return true;
  if (onExitApproach(point, cell, maze)) return true;
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
  const exitSide = onExitApproach(point, cell, maze) ? maze.exit.side : null;
  return {
    x: entranceSide === 'W' || entranceSide === 'E' || exitSide === 'W' || exitSide === 'E' ? point.x : cell.x + Math.max(-xLimit, Math.min(xLimit, dx)),
    y: entranceSide === 'N' || entranceSide === 'S' || exitSide === 'N' || exitSide === 'S' ? point.y : cell.y + Math.max(-yLimit, Math.min(yLimit, dy)),
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
  let enteredExitCell = false, exitBoundaryReached = false, completionReason = null, finishPosition = null;
  let interpolatedSamples = 0;
  const attemptedTransitions = [];
  const initialBreakCount = strokeBreaks.length;
  const reject = code => { blocked = true; reason ??= code; };
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(distance / MAX_SAMPLE_DISTANCE));
  interpolatedSamples = Math.max(0, samples - 1);

  for (let index = 1; index <= samples; index++) {
    const point = { x: from.x + (to.x - from.x) * index / samples, y: from.y + (to.y - from.y) * index / samples };
    const previousPoint = { x: from.x + (to.x - from.x) * (index - 1) / samples, y: from.y + (to.y - from.y) * (index - 1) / samples };
    const candidate = nearestCell(point, maze);
    if (!candidate) {
      if (crossedDeclaredExit(previousPoint, point, nextPath.at(-1), maze)) {
        finishPosition = exitFinishPoint(maze);
        if (finishPosition) {
          appendInk(stroke, strokeCells, strokeBreaks, finishPosition, maze.exit.cell);
          position = finishPosition;
          moved = true; complete = true; exitBoundaryReached = true;
          completionReason = 'designated-exit-boundary-crossing';
          break;
        }
      }
      reject('outside-maze'); break;
    }

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
      enteredExitCell ||= sameCell(candidate, maze.end) && !sameCell(current, maze.end);
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
    enteredExitCell, exitBoundaryReached, completionReason, finishPosition,
    interpolatedSamples, attemptedTransitions, strokeBreakCreated: strokeBreaks.length > initialBreakCount };
}

/** Shared authoritative maze route, pencil endpoint, and append-only ink session. */
export function createTraceSession(maze) {
  if (maze?.mazeFormat === 'organic') return createOrganicTraceSession(maze);
  let path = [{ ...maze.start }];
  let stroke = [{ ...maze.start }];
  let strokeCells = [{ ...maze.start }];
  let strokeBreaks = [];
  let position = { ...maze.start };
  let pointerId = null;
  let completionCommitted = false;
  let exitCellEntered = false;
  let invalidPerimeterAttempts = 0;
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
        exitCellEntered, currentlyInExitCell: sameCell(cell, maze.end),
        exitBoundaryReached: completionCommitted, completionCommitted,
        exitCell: maze.exit ? { ...maze.exit.cell } : null, exitSide: maze.exit?.side ?? null,
        finishPosition: completionCommitted ? copyPoint(position) : null,
        completionReason: completionCommitted ? 'designated-exit-boundary-crossing' : null,
        invalidPerimeterAttempts,
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
      if (completionCommitted) return { path, stroke, position, moved: false, blocked: false, complete: false, reason: 'attempt-already-completed' };
      if (pointerId !== id) return { path, stroke, position, moved: false, blocked: false, complete: false, reason: 'steering-without-active-gesture' };
      if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.y)) {
        return { path, stroke, position, moved: false, blocked: false, complete: false, reason: 'invalid-steering-delta' };
      }
      const from = copyPoint(position), to = { x: from.x + delta.x, y: from.y + delta.y };
      const result = traceSegment(maze, path, from, to, stroke, strokeCells, position, strokeBreaks,
        { advanceSubthreshold: true, allowOpenEdgeProgress: true });
      path = result.path; stroke = result.stroke; strokeCells = result.strokeCells;
      strokeBreaks = result.strokeBreaks; position = result.position;
      exitCellEntered ||= result.enteredExitCell;
      if (result.reason === 'outside-maze' && !result.exitBoundaryReached) invalidPerimeterAttempts++;
      completionCommitted ||= result.complete;
      const recovered = lastBlocked && result.moved && !result.blocked;
      lastBlocked = result.blocked; lastReason = result.reason;
      lastFailureCategory = result.blocked ? failureCategory(result.reason) : null;
      return { ...result, recovered, steeringCollision: result.wallCollision };
    },
    step(direction) {
      if (completionCommitted) return { path, stroke, position, moved: false, blocked: false, complete: false, reason: 'attempt-already-completed' };
      if (pointerId !== null) return { path, stroke, position, moved: false, blocked: false, complete: false };
      const current = path.at(-1), candidate = { x: current.x + direction.x, y: current.y + direction.y };
      const exitDelta = maze.exit?.side === 'N' ? { x: 0, y: -1 } : maze.exit?.side === 'E' ? { x: 1, y: 0 }
        : maze.exit?.side === 'S' ? { x: 0, y: 1 } : maze.exit?.side === 'W' ? { x: -1, y: 0 } : null;
      if (exitDelta && sameCell(current, maze.exit.cell) && direction.x === exitDelta.x && direction.y === exitDelta.y) {
        const finishPosition = exitFinishPoint(maze);
        if (finishPosition) {
          appendInk(stroke, strokeCells, strokeBreaks, finishPosition, maze.exit.cell);
          position = finishPosition; completionCommitted = true; exitCellEntered = true;
          lastBlocked = false; lastReason = null; lastFailureCategory = null;
          return { path, stroke, strokeCells, strokeBreaks, position, moved: true, blocked: false, complete: true,
            enteredExitCell: false, exitBoundaryReached: true, completionReason: 'designated-exit-boundary-crossing', finishPosition: copyPoint(finishPosition) };
        }
      }
      const advance = advancePath(maze, path, candidate);
      if (!advance.moved) {
        if (candidate.x < 0 || candidate.y < 0 || candidate.x >= maze.width || candidate.y >= maze.height) invalidPerimeterAttempts++;
        lastReason = canMove(maze, current, candidate) ? 'route-revisit' : 'closed-or-nonadjacent-edge';
        lastFailureCategory = failureCategory(lastReason); lastBlocked = true;
        return { path, stroke, position, moved: false, blocked: true, reason: lastReason, complete: false };
      }
      path = advance.path; position = { ...candidate };
      appendInk(stroke, strokeCells, strokeBreaks, position, candidate);
      const enteredExitCell = sameCell(candidate, maze.end) && !sameCell(current, maze.end);
      exitCellEntered ||= enteredExitCell;
      lastBlocked = false; lastReason = null; lastFailureCategory = null;
      return { path, stroke, position, moved: true, blocked: false, complete: false, enteredExitCell,
        exitBoundaryReached: false, completionReason: null };
    },
    end,
    cancel: end,
  };
}
