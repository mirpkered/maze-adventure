import { advancePath } from './maze.js';

const MAX_SAMPLE_DISTANCE = 0.2;
const CORRIDOR_TOLERANCE = 0.62;

function nearestCell(point, maze) {
  const x = Math.round(point.x), y = Math.round(point.y);
  if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return null;
  return Math.hypot(point.x - x, point.y - y) <= CORRIDOR_TOLERANCE ? { x, y } : null;
}

/**
 * Trace a sampled pointer segment in cell-center coordinates (each cell center
 * is an integer point). Every crossed cell boundary is checked; a segment that
 * cuts a corner, leaves the corridor, or meets a wall stops at the last legal
 * cell. The input is sampled densely enough that fast pointer events cannot
 * jump over those checks.
 */
export function traceSegment(maze, path, from, to) {
  let nextPath = path;
  let moved = false;
  let blocked = false;
  let complete = false;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(distance / MAX_SAMPLE_DISTANCE));

  for (let index = 1; index <= samples; index++) {
    const point = {
      x: from.x + (to.x - from.x) * index / samples,
      y: from.y + (to.y - from.y) * index / samples,
    };
    const candidate = nearestCell(point, maze);
    if (!candidate) { blocked = true; break; }
    const result = advancePath(maze, nextPath, candidate);
    if (result.moved) {
      nextPath = result.path;
      moved = true;
      if (result.complete) { complete = true; break; }
    } else if (candidate.x !== nextPath.at(-1).x || candidate.y !== nextPath.at(-1).y) {
      // A corner cut, non-adjacent jump, visited-cell shortcut, or wall.
      blocked = true;
      break;
    }
  }

  return { path: nextPath, moved, blocked, complete };
}

/** Pointer gesture state. Ending or cancelling a gesture preserves its route. */
export function createTraceSession(maze) {
  let path = [{ ...maze.start }];
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
    get active() { return pointerId !== null; },
    begin(id, point) {
      if (pointerId !== null) return false;
      const cell = nearestCell(point, maze), endpoint = path.at(-1);
      if (!cell || cell.x !== endpoint.x || cell.y !== endpoint.y) return false;
      pointerId = id;
      lastPoint = { ...point };
      return true;
    },
    move(id, point) {
      if (pointerId !== id || !lastPoint) return { path, moved: false, blocked: false, complete: false };
      const result = traceSegment(maze, path, lastPoint, point);
      path = result.path;
      lastPoint = { ...point };
      return result;
    },
    end,
    cancel: end,
  };
}
