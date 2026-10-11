import { advancePath, canMove } from './maze.js';

const MAX_SAMPLE_DISTANCE = 0.055;
const CORRIDOR_MARGIN = 0.46;
const ENTRANCE_TOLERANCE = 0.62;
const TRAIL_CAPTURE_RADIUS = 0.4;
const STROKE_WALL_SAFE_OFFSET = 0.42;
const MIN_STROKE_POINT_DISTANCE = 0.015;

function nearestCell(point, maze) {
  const x = Math.round(point.x), y = Math.round(point.y);
  if (x < 0 || y < 0 || x >= maze.width || y >= maze.height) return null;
  return { x, y };
}

function sameCell(a, b) { return a.x === b.x && a.y === b.y; }
function copyPoint(point) { return { x: point.x, y: point.y }; }

function insideCell(point, cell, maze) {
  const dx = point.x - cell.x, dy = point.y - cell.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (sameCell(cell, maze.start) && cell.y === 0 && dy < -CORRIDOR_MARGIN && ay <= ENTRANCE_TOLERANCE && ax <= CORRIDOR_MARGIN) return true;
  if (ax <= CORRIDOR_MARGIN && ay <= CORRIDOR_MARGIN) return true;
  if (ax <= 0.5 && ay <= CORRIDOR_MARGIN && dx !== 0 && canMove(maze, cell, { x: cell.x + Math.sign(dx), y: cell.y })) return true;
  if (ay <= 0.5 && ax <= CORRIDOR_MARGIN && dy !== 0 && canMove(maze, cell, { x: cell.x, y: cell.y + Math.sign(dy) })) return true;
  return false;
}

function constrainStrokePoint(point, cell, maze) {
  const dx = point.x - cell.x, dy = point.y - cell.y;
  const entrance = sameCell(cell, maze.start) && cell.y === 0 && dy < -CORRIDOR_MARGIN;
  return {
    x: cell.x + Math.max(-STROKE_WALL_SAFE_OFFSET, Math.min(STROKE_WALL_SAFE_OFFSET, dx)),
    y: entrance ? point.y : cell.y + Math.max(-STROKE_WALL_SAFE_OFFSET, Math.min(STROKE_WALL_SAFE_OFFSET, dy)),
  };
}

function appendInk(stroke, strokeCells, strokeBreaks, point, cell, breakBefore = false) {
  if (breakBefore && stroke.length) strokeBreaks.push(stroke.length);
  const last = stroke.at(-1);
  if (!last || Math.hypot(point.x - last.x, point.y - last.y) > MIN_STROKE_POINT_DISTANCE) {
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
  let moved = false, blocked = false, complete = false, reason = null;
  const reject = code => { blocked = true; reason ??= code; };
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(distance / MAX_SAMPLE_DISTANCE));
  let rejoining = recovering;

  for (let index = 1; index <= samples; index++) {
    const point = { x: from.x + (to.x - from.x) * index / samples, y: from.y + (to.y - from.y) * index / samples };
    const candidate = nearestCell(point, maze);
    if (!candidate) { reject('outside-maze'); rejoining = true; continue; }

    const current = nextPath.at(-1);
    const same = sameCell(candidate, current);
    if (rejoining && (!same && !canMove(maze, current, candidate))) {
      reject('rejoin-not-route-tail');
      continue;
    }

    let transition = null;
    if (!same) {
      const dx = candidate.x - current.x, dy = candidate.y - current.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1 || !canMove(maze, current, candidate)) {
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
      reject('outside-current-corridor');
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

  return { path: nextPath, stroke, strokeCells, strokeBreaks, position, moved, blocked, reason, complete, recovering: rejoining };
}

/** Pointer lift and cancellation preserve both the legal endpoint and all ink. */
export function createTraceSession(maze) {
  let path = [{ ...maze.start }];
  let stroke = [{ ...maze.start }];
  let strokeCells = [{ ...maze.start }];
  let strokeBreaks = [];
  let position = { ...maze.start };
  let pointerId = null;
  let lastPoint = null;
  let recovering = false;
  let lastBlocked = false;
  let lastReason = null;
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
    get strokeBreaks() { return strokeBreaks; },
    get position() { return position; },
    get endpoint() { return position; },
    get active() { return pointerId !== null; },
    get diagnostics() { return { raw: lastPoint ? copyPoint(lastPoint) : null, endpoint: copyPoint(position), cell: { ...path.at(-1) }, previousCell: path.length > 1 ? { ...path.at(-2) } : null, strokeCells: strokeCells.map(cell => ({ ...cell })), strokeBreaks: [...strokeBreaks], active: pointerId !== null, recovering, blocked: lastBlocked, reason: lastReason, pathLength: path.length, strokeLength: stroke.length }; },
    begin(id, point) {
      if (pointerId !== null) { lastReason = 'gesture-already-active'; return false; }
      const cell = nearestCell(point, maze), endpoint = path.at(-1);
      const entranceStart = path.length === 1 && stroke.length === 1;
      const atEntrance = entranceStart && cell && sameCell(cell, maze.start) && cell.y === 0
        && point.y - cell.y < -CORRIDOR_MARGIN && Math.abs(point.y - cell.y) <= ENTRANCE_TOLERANCE
        && Math.abs(point.x - cell.x) <= CORRIDOR_MARGIN;
      if (!cell || !sameCell(cell, endpoint) || (!insideCell(point, cell, maze) && !atEntrance)) { lastReason = 'begin-outside-route-endpoint-corridor'; return false; }
      if (!entranceStart && Math.hypot(point.x - position.x, point.y - position.y) > TRAIL_CAPTURE_RADIUS) { lastReason = 'begin-too-far-from-pencil-position'; return false; }
      pointerId = id;
      // Anchor the new gesture to the legal pencil endpoint, not the latest
      // permanent-ink sample (which may belong to an older explored branch).
      lastPoint = copyPoint(position);
      recovering = false;
      lastBlocked = false;
      lastReason = null;
      return true;
    },
    move(id, point) {
      if (pointerId !== id || !lastPoint) { lastReason = 'move-without-active-gesture'; return { path, stroke, position, moved: false, blocked: false, reason: lastReason, complete: false }; }
      const result = traceSegment(maze, path, lastPoint, point, stroke, lastPoint, recovering, strokeCells, position, strokeBreaks);
      path = result.path;
      stroke = result.stroke;
      strokeCells = result.strokeCells;
      strokeBreaks = result.strokeBreaks;
      position = result.position;
      lastPoint = copyPoint(point);
      recovering = result.recovering;
      lastBlocked = result.blocked;
      lastReason = result.reason;
      return result;
    },
    step(direction) {
      if (pointerId !== null) return { path, stroke, position, moved: false, blocked: false, complete: false };
      const current = path.at(-1), candidate = { x: current.x + direction.x, y: current.y + direction.y };
      const advance = advancePath(maze, path, candidate);
      if (!advance.moved) { lastReason = canMove(maze, current, candidate) ? 'route-revisit' : 'closed-or-nonadjacent-edge'; return { path, stroke, position, moved: false, blocked: true, reason: lastReason, complete: false }; }
      path = advance.path;
      position = { ...candidate };
      appendInk(stroke, strokeCells, strokeBreaks, position, candidate);
      recovering = false;
      lastBlocked = false;
      lastReason = null;
      return { path, stroke, position, moved: true, blocked: false, complete: advance.complete };
    },
    end,
    cancel: end,
  };
}
