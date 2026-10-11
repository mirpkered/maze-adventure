import { advancePath, canMove } from './maze.js';

const MAX_SAMPLE_DISTANCE = 0.055;
const CORRIDOR_TOLERANCE = 0.62;
const CORRIDOR_MARGIN = 0.46;
const RETRACE_TOLERANCE = 0.14;
const MIN_STROKE_POINT_DISTANCE = 0.015;

function nearestCell(point, maze) {
  const roundedX = Math.round(point.x), roundedY = Math.round(point.y);
  const x = roundedX === 0 ? 0 : roundedX, y = roundedY === 0 ? 0 : roundedY;
  if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return null;
  return Math.hypot(point.x - x, point.y - y) <= CORRIDOR_TOLERANCE ? { x, y } : null;
}

function sameCell(a, b) { return a.x === b.x && a.y === b.y; }
function center(point) { return { x: point.x, y: point.y }; }

function projectOntoStroke(stroke, point) {
  let traveled = 0, best = { distance: Infinity, along: 0, point: stroke[0] };
  for (let index = 1; index < stroke.length; index++) {
    const a = stroke[index - 1], b = stroke[index], dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy, length = Math.sqrt(lengthSquared);
    const ratio = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    const projected = { x: a.x + dx * ratio, y: a.y + dy * ratio };
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (distance < best.distance) best = { distance, along: traveled + length * ratio, point: projected };
    traveled += length;
  }
  return best;
}

function trimStroke(stroke, along) {
  let traveled = 0;
  const result = [center(stroke[0])];
  for (let index = 1; index < stroke.length; index++) {
    const a = stroke[index - 1], b = stroke[index], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (traveled + length < along - 1e-8) result.push(center(b));
    else {
      const ratio = length ? Math.max(0, Math.min(1, (along - traveled) / length)) : 0;
      const end = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
      if (Math.hypot(end.x - result.at(-1).x, end.y - result.at(-1).y) > 1e-6) result.push(end);
      break;
    }
    traveled += length;
  }
  return result;
}

function insideCell(point, cell, maze) {
  const dx = point.x - cell.x, dy = point.y - cell.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (sameCell(cell, maze.start) && cell.y === 0 && dy < -CORRIDOR_MARGIN && ay <= CORRIDOR_TOLERANCE && ax <= CORRIDOR_MARGIN) return true;
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
export function traceSegment(maze, path, from, to, currentStroke = path.map(center), previousPoint = from) {
  let nextPath = path;
  let stroke = currentStroke.map(center);
  let moved = false, blocked = false, complete = false;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(distance / MAX_SAMPLE_DISTANCE));
  const beforeProjection = projectOntoStroke(stroke, previousPoint);

  for (let index = 1; index <= samples; index++) {
    const point = {
      x: from.x + (to.x - from.x) * index / samples,
      y: from.y + (to.y - from.y) * index / samples,
    };
    const candidate = nearestCell(point, maze);
    if (!candidate) { blocked = true; break; }

    const current = nextPath.at(-1);
    if (!sameCell(candidate, current)) {
      const advance = advancePath(maze, nextPath, candidate);
      if (!advance.moved) { blocked = true; break; }
      const dx = candidate.x - current.x;
      const crossAxisOffset = dx !== 0 ? Math.abs(point.y - candidate.y) : Math.abs(point.x - candidate.x);
      if (crossAxisOffset > CORRIDOR_MARGIN || !canMove(maze, current, candidate)) { blocked = true; break; }
      nextPath = advance.path;
      moved = true;
      complete ||= advance.complete;
    } else if (!insideCell(point, current, maze)) {
      blocked = true;
      break;
    }

    // On the way back, the pen must stay close to the stroke already drawn.
    // Shorten that stroke by physical pointer progress instead of snapping a
    // whole grid edge away at once.
    const projected = projectOntoStroke(stroke, point);
    const movingBackward = projected.distance <= RETRACE_TOLERANCE
      && projected.along < beforeProjection.along - 1e-4;
    if (movingBackward) {
      stroke = trimStroke(stroke, projected.along);
      moved = true;
      continue;
    }

    const last = stroke.at(-1);
    if (Math.hypot(point.x - last.x, point.y - last.y) > MIN_STROKE_POINT_DISTANCE) { stroke.push(point); moved = true; }
  }

  return { path: nextPath, stroke, moved, blocked, complete };
}

/** Pointer lift or cancellation preserves both the logical route and its pencil trail. */
export function createTraceSession(maze) {
  let path = [{ ...maze.start }];
  let stroke = [{ ...maze.start }];
  let pointerId = null;
  let lastPoint = null;
  const end = id => {
    if (pointerId !== id) return false;
    pointerId = null;
    lastPoint = null;
    return true;
  };

  return {
    get path() { return path; },
    get stroke() { return stroke; },
    get endpoint() { return stroke.at(-1); },
    get active() { return pointerId !== null; },
    begin(id, point) {
      if (pointerId !== null) return false;
      const cell = nearestCell(point, maze), endpoint = path.at(-1);
      const entranceStart = path.length === 1 && stroke.length === 1;
      if (!cell || !sameCell(cell, endpoint) || (!entranceStart && Math.hypot(point.x - stroke.at(-1).x, point.y - stroke.at(-1).y) > 0.3)) return false;
      pointerId = id;
      lastPoint = { ...point };
      return true;
    },
    move(id, point) {
      if (pointerId !== id || !lastPoint) return { path, stroke, moved: false, blocked: false, complete: false };
      const result = traceSegment(maze, path, lastPoint, point, stroke, lastPoint);
      path = result.path;
      stroke = result.stroke;
      lastPoint = { ...(result.blocked ? stroke.at(-1) : point) };
      return result;
    },
    step(direction) {
      if (pointerId !== null) return { path, stroke, moved: false, blocked: false, complete: false };
      const current = path.at(-1), candidate = { x: current.x + direction.x, y: current.y + direction.y };
      const advance = advancePath(maze, path, candidate);
      if (!advance.moved) return { path, stroke, moved: false, blocked: true, complete: false };
      const backtracking = advance.path.length < path.length;
      path = advance.path;
      if (backtracking) {
        const projection = projectOntoStroke(stroke, candidate);
        stroke = trimStroke(stroke, projection.along);
      } else {
        const endpoint = stroke.at(-1);
        if (!sameCell(endpoint, candidate)) stroke.push(center(candidate));
      }
      return { path, stroke, moved: true, blocked: false, complete: advance.complete };
    },
    end,
    cancel: end,
  };
}
