import { advancePath, canMove } from './maze.js';

const MAX_SAMPLE_DISTANCE = 0.055;
const CORRIDOR_MARGIN = 0.46;
const ENTRANCE_TOLERANCE = 0.62;
// A finger can comfortably wander around inside a printed corridor. Keep
// capture well inside the half-cell boundary so adjacent, walled passages
// never become interchangeable.
const TRAIL_CAPTURE_RADIUS = 0.4;
const STROKE_WALL_SAFE_OFFSET = 0.42;
const MIN_STROKE_POINT_DISTANCE = 0.015;

function nearestCell(point, maze) {
  const roundedX = Math.round(point.x), roundedY = Math.round(point.y);
  const x = roundedX === 0 ? 0 : roundedX, y = roundedY === 0 ? 0 : roundedY;
  if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return null;
  return { x, y };
}

function sameCell(a, b) { return a.x === b.x && a.y === b.y; }
function center(point) { return { x: point.x, y: point.y }; }

function projectOntoStroke(stroke, point, strokeCells = [], allowedCells = null) {
  let traveled = 0, best = { distance: Infinity, along: 0, point: stroke[0] };
  if (stroke.length === 1) return { ...best, distance: Math.hypot(point.x - stroke[0].x, point.y - stroke[0].y), point: stroke[0] };
  for (let index = 1; index < stroke.length; index++) {
    const a = stroke[index - 1], b = stroke[index], dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy, length = Math.sqrt(lengthSquared);
    const ratio = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    const projected = { x: a.x + dx * ratio, y: a.y + dy * ratio };
    const allowed = !allowedCells || (allowedCells.some(cell => sameCell(cell, strokeCells[index - 1])) && allowedCells.some(cell => sameCell(cell, strokeCells[index])));
    const distance = allowed ? Math.hypot(point.x - projected.x, point.y - projected.y) : Infinity;
    const along = traveled + length * ratio;
    if (distance < best.distance - 1e-6 || (Math.abs(distance - best.distance) <= 1e-6 && along > best.along)) best = { distance, along, point: projected };
    traveled += length;
  }
  return best;
}

// Keep the pencil as close to the finger as possible. Clamp only the thin
// safety margin needed to keep the rendered stroke inside the wall boundary.
function constrainStrokePoint(point, cell, maze) {
  const dx = point.x - cell.x, dy = point.y - cell.y;
  const entrance = sameCell(cell, maze.start) && cell.y === 0 && dy < -CORRIDOR_MARGIN;
  const safeX = Math.max(-STROKE_WALL_SAFE_OFFSET, Math.min(STROKE_WALL_SAFE_OFFSET, dx));
  const safeY = entrance ? dy : Math.max(-STROKE_WALL_SAFE_OFFSET, Math.min(STROKE_WALL_SAFE_OFFSET, dy));
  return { x: cell.x + safeX, y: cell.y + safeY };
}

function trimStroke(stroke, strokeCells, along) {
  let traveled = 0;
  const result = [center(stroke[0])];
  const cells = [strokeCells[0]];
  for (let index = 1; index < stroke.length; index++) {
    const a = stroke[index - 1], b = stroke[index], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (traveled + length < along - 1e-8) { result.push(center(b)); cells.push(strokeCells[index]); }
    else {
      const ratio = length ? Math.max(0, Math.min(1, (along - traveled) / length)) : 0;
      const end = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
      if (Math.hypot(end.x - result.at(-1).x, end.y - result.at(-1).y) > 1e-6) { result.push(end); cells.push(strokeCells[index]); }
      break;
    }
    traveled += length;
  }
  return { stroke: result, strokeCells: cells };
}

function trimStrokeToCell(stroke, strokeCells, cell) {
  let lastIndex = -1;
  for (let index = 0; index < strokeCells.length; index++) if (sameCell(strokeCells[index], cell)) lastIndex = index;
  if (lastIndex < 0) return { stroke, strokeCells };
  return { stroke: stroke.slice(0, lastIndex + 1), strokeCells: strokeCells.slice(0, lastIndex + 1) };
}

function insideCell(point, cell, maze) {
  const dx = point.x - cell.x, dy = point.y - cell.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (sameCell(cell, maze.start) && cell.y === 0 && dy < -CORRIDOR_MARGIN && ay <= ENTRANCE_TOLERANCE && ax <= CORRIDOR_MARGIN) return true;
  if (ax <= CORRIDOR_MARGIN && ay <= CORRIDOR_MARGIN) return true;
  if (ax <= 0.5 && ay <= CORRIDOR_MARGIN && dx !== 0) {
    const neighbor = { x: cell.x + Math.sign(dx), y: cell.y };
    if (canMove(maze, cell, neighbor)) return true;
  }
  if (ay <= 0.5 && ax <= CORRIDOR_MARGIN && dy !== 0) {
    const neighbor = { x: cell.x, y: cell.y + Math.sign(dy) };
    if (canMove(maze, cell, neighbor)) return true;
  }
  return false;
}

/**
 * Validate pointer movement against the maze graph while retaining the actual
 * in-corridor samples for the pencil stroke. The graph path remains the source
 * of truth; visual samples never authorize a move themselves.
 */
export function traceSegment(maze, path, from, to, currentStroke = path.map(center), previousPoint = from, recovering = false, currentStrokeCells = null) {
  let nextPath = path;
  let stroke = currentStroke.map(center);
  let strokeCells = currentStrokeCells?.map(cell => ({ ...cell })) ?? stroke.map(point => nearestCell(point, maze) ?? path.at(-1));
  let moved = false, blocked = false, complete = false;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(distance / MAX_SAMPLE_DISTANCE));
  const routeTail = () => nextPath.slice(-2);
  const beforeProjection = projectOntoStroke(stroke, previousPoint, strokeCells, routeTail());

  let rejoining = recovering;
  for (let index = 1; index <= samples; index++) {
    const point = {
      x: from.x + (to.x - from.x) * index / samples,
      y: from.y + (to.y - from.y) * index / samples,
    };
    const candidate = nearestCell(point, maze);
    if (!candidate) {
      blocked = true;
      // Keep tracking the real pointer while it is outside the legal corridor.
      // On return, it may only rejoin the existing trail near its current tip.
      if (rejoining) continue;
      rejoining = true;
      break;
    }

    const current = nextPath.at(-1);
    const allowedRouteCells = routeTail();
    const projected = projectOntoStroke(stroke, point, strokeCells, allowedRouteCells);
    if (rejoining) {
      const currentIndex = nextPath.findIndex(cell => sameCell(cell, candidate));
      const isCurrentOrPrevious = currentIndex === nextPath.length - 1 || currentIndex === nextPath.length - 2;
      // Re-entering the same legal corridor need not match the old pencil's
      // exact offset. Cell adjacency and corridor geometry provide the safety
      // bound; requiring proximity to the stroke made a wall-side touch wedge.
      if (!insideCell(point, candidate, maze) || !isCurrentOrPrevious) {
        blocked = true;
        continue;
      }
      rejoining = false;
    }

    let forwardTransition = false, backwardTransition = false;
    if (!sameCell(candidate, current)) {
      const oldPathLength = nextPath.length;
      const advance = advancePath(maze, nextPath, candidate);
      if (!advance.moved) { blocked = true; rejoining = true; if (recovering) continue; break; }
      const dx = candidate.x - current.x;
      const crossAxisOffset = dx !== 0 ? Math.abs(point.y - candidate.y) : Math.abs(point.x - candidate.x);
      if (crossAxisOffset > CORRIDOR_MARGIN || !canMove(maze, current, candidate)) { blocked = true; rejoining = true; if (recovering) continue; break; }
      forwardTransition = advance.path.length > oldPathLength;
      backwardTransition = advance.path.length < oldPathLength;
      nextPath = advance.path;
      moved = true;
      complete ||= advance.complete;
    } else if (!insideCell(point, current, maze)) {
      blocked = true;
      if (recovering) { rejoining = true; continue; }
      rejoining = true;
      break;
    }

    // On the way back, the pen must stay close to the stroke already drawn.
    // Shorten that stroke by physical pointer progress instead of snapping a
    // whole grid edge away at once.
    // A newly legal forward edge is never reclassified as a reversal based on
    // proximity to a different, older part of a looping trail.
    const movingBackward = !forwardTransition && projected.distance <= TRAIL_CAPTURE_RADIUS
      && projected.along < beforeProjection.along - 1e-4;
    if (backwardTransition && projected.distance > TRAIL_CAPTURE_RADIUS) {
      // The route graph has confirmed a physical crossing into its one legal
      // predecessor. Retire the abandoned cell's samples instead of projecting
      // through a wall onto an unrelated stroke elsewhere in the maze.
      ({ stroke, strokeCells } = trimStrokeToCell(stroke, strokeCells, candidate));
    }
    if (movingBackward) {
      ({ stroke, strokeCells } = trimStroke(stroke, strokeCells, projected.along));
      moved = true;
      continue;
    }

    const pencilPoint = constrainStrokePoint(point, candidate, maze);
    const last = stroke.at(-1);
    if (Math.hypot(pencilPoint.x - last.x, pencilPoint.y - last.y) > MIN_STROKE_POINT_DISTANCE) { stroke.push(pencilPoint); strokeCells.push({ ...candidate }); moved = true; }
  }

  return { path: nextPath, stroke, strokeCells, moved, blocked, complete, recovering: rejoining };
}

/** Pointer lift or cancellation preserves both the logical route and its pencil trail. */
export function createTraceSession(maze) {
  let path = [{ ...maze.start }];
  let stroke = [{ ...maze.start }];
  let strokeCells = [{ ...maze.start }];
  let pointerId = null;
  let lastPoint = null;
  let recovering = false;
  let lastBlocked = false;
  const end = id => {
    if (pointerId !== id) return false;
    pointerId = null;
    lastPoint = null;
    recovering = false;
    return true;
  };

  return {
    get path() { return path; },
    get stroke() { return stroke; },
    get endpoint() { return stroke.at(-1); },
    get active() { return pointerId !== null; },
    get diagnostics() { return { raw: lastPoint ? { ...lastPoint } : null, endpoint: { ...stroke.at(-1) }, cell: { ...path.at(-1) }, active: pointerId !== null, recovering, blocked: lastBlocked, pathLength: path.length, strokeLength: stroke.length }; },
    begin(id, point) {
      if (pointerId !== null) return false;
      const cell = nearestCell(point, maze), endpoint = path.at(-1);
      const entranceStart = path.length === 1 && stroke.length === 1;
      const atEntrance = entranceStart && cell && sameCell(cell, maze.start) && cell.y === 0
        && point.y - cell.y < -CORRIDOR_MARGIN && Math.abs(point.y - cell.y) <= ENTRANCE_TOLERANCE
        && Math.abs(point.x - cell.x) <= CORRIDOR_MARGIN;
      if (!cell || !sameCell(cell, endpoint) || (!insideCell(point, cell, maze) && !atEntrance)
        || (!entranceStart && Math.hypot(point.x - stroke.at(-1).x, point.y - stroke.at(-1).y) > TRAIL_CAPTURE_RADIUS)) return false;
      pointerId = id;
      lastPoint = { ...point };
      recovering = false;
      lastBlocked = false;
      return true;
    },
    move(id, point) {
      if (pointerId !== id || !lastPoint) return { path, stroke, moved: false, blocked: false, complete: false };
      // When the finger is outside the corridor, anchor reverse intent to the
      // last accepted pencil tip instead of projecting the outside coordinate.
      const acceptedAnchor = recovering ? stroke.at(-1) : lastPoint;
      const result = traceSegment(maze, path, lastPoint, point, stroke, acceptedAnchor, recovering, strokeCells);
      path = result.path;
      stroke = result.stroke;
      strokeCells = result.strokeCells;
      // Track the physical pointer separately from the accepted trail endpoint.
      // This lets a finger that wandered into a wall return to the existing
      // route without repeatedly restarting movement from a snapped position.
      lastPoint = { ...point };
      recovering = result.recovering;
      lastBlocked = result.blocked;
      return result;
    },
    step(direction) {
      if (pointerId !== null) return { path, stroke, moved: false, blocked: false, complete: false };
      const current = path.at(-1), candidate = { x: current.x + direction.x, y: current.y + direction.y };
      const advance = advancePath(maze, path, candidate);
      if (!advance.moved) return { path, stroke, moved: false, blocked: true, complete: false };
      const backtracking = advance.path.length < path.length;
      path = advance.path;
      recovering = false;
      if (backtracking) {
        const projection = projectOntoStroke(stroke, candidate, strokeCells, path.slice(-2));
        ({ stroke, strokeCells } = trimStroke(stroke, strokeCells, projection.along));
      } else {
        const endpoint = stroke.at(-1);
        if (!sameCell(endpoint, candidate)) { stroke.push(center(candidate)); strokeCells.push({ ...candidate }); }
      }
      lastBlocked = false;
      return { path, stroke, moved: true, blocked: false, complete: advance.complete };
    },
    end,
    cancel: end,
  };
}
