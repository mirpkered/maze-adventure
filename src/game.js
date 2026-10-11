import { createMaze } from './maze.js';
import { createTraceSession } from './tracing.js';

const $ = (selector) => document.querySelector(selector);
const home = $('#home'), play = $('#play'), complete = $('#complete'), svg = $('#maze');
const SIZE = 400, PAD = 24, CELL = (SIZE - PAD * 2) / 7;
let maze, traceSession, activePointerId = null, elapsed = 0, startedAt = 0, timerId;

function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function activeScreen(screen) { home.hidden = screen !== home; play.hidden = screen !== play; complete.hidden = screen !== complete; }
function startTimer() { if (timerId || play.hidden || document.hidden) return; startedAt = Date.now() - elapsed * 1000; timerId = setInterval(() => { elapsed = Math.floor((Date.now() - startedAt) / 1000); $('#timer').value = formatTime(elapsed); }, 250); }
function pauseTimer() { if (timerId) { clearInterval(timerId); timerId = undefined; elapsed = Math.floor((Date.now() - startedAt) / 1000); $('#timer').value = formatTime(elapsed); } }

function render() {
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  const line = (x1, y1, x2, y2, className = 'wall') => { const el = document.createElementNS(ns, 'line'); Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => el.setAttribute(k, v)); el.setAttribute('class', className); svg.append(el); };
  const center = p => ({ x: PAD + (p.x + .5) * CELL, y: PAD + (p.y + .5) * CELL });
  const points = traceSession.path.map(center);
  if (points.length > 1) { const trail = document.createElementNS(ns, 'polyline'); trail.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' ')); trail.setAttribute('class', 'trail'); svg.append(trail); }
  const visited = new Set(traceSession.path.map(p => `${p.x},${p.y}`));
  for (const p of traceSession.path) { const c = center(p), dot = document.createElementNS(ns, 'circle'); dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y); dot.setAttribute('r', 3.5); dot.setAttribute('class', 'trail-dot'); svg.append(dot); }
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const cell = maze.cells[y][x], x0 = PAD + x * CELL, y0 = PAD + y * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
    if (cell.walls.N && !(x === maze.start.x && y === maze.start.y)) line(x0, y0, x1, y0);
    if (cell.walls.W && x > 0) line(x0, y0, x0, y1);
    if (cell.walls.E) line(x1, y0, x1, y1);
    if (cell.walls.S && !(x === maze.end.x && y === maze.end.y)) line(x0, y1, x1, y1);
  }
  // Clear openings at entrance and exit; their markers sit just outside the maze.
  const s = center(maze.start), e = center(maze.end);
  const start = document.createElementNS(ns, 'text'); start.setAttribute('x', s.x); start.setAttribute('y', PAD - 7); start.setAttribute('text-anchor', 'middle'); start.setAttribute('class', 'marker marker-start'); start.textContent = 'START'; svg.append(start);
  const goal = document.createElementNS(ns, 'text'); goal.setAttribute('x', e.x); goal.setAttribute('y', SIZE - PAD + 17); goal.setAttribute('text-anchor', 'middle'); goal.setAttribute('class', 'marker marker-end'); goal.textContent = '✿'; svg.append(goal);
  const player = document.createElementNS(ns, 'circle'); player.setAttribute('cx', points.at(-1).x); player.setAttribute('cy', points.at(-1).y); player.setAttribute('r', CELL * .19); player.setAttribute('class', 'player'); svg.append(player);
  svg.dataset.visited = String(visited.size);
}

function newMaze() {
  maze = createMaze(7, 7);
  traceSession = createTraceSession(maze); activePointerId = null; elapsed = 0; $('#timer').value = '0:00';
  $('#play-hint').textContent = 'Trace the path from the little flag to the flower.';
  activeScreen(play); render(); startTimer();
}

function pointAt(event) {
  const box = svg.getBoundingClientRect();
  return { x: (event.clientX - box.left) / box.width * SIZE, y: (event.clientY - box.top) / box.height * SIZE };
}
function pointInMaze(event) {
  const point = pointAt(event);
  return { x: (point.x - PAD) / CELL - .5, y: (point.y - PAD) / CELL - .5 };
}
function finishPointer(event, cancel = false) {
  if (activePointerId !== event.pointerId) return;
  if (cancel) traceSession.cancel(event.pointerId);
  else traceSession.end(event.pointerId);
  activePointerId = null;
  try { if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId); } catch { /* Capture may already have been released by the browser. */ }
}
svg.addEventListener('pointerdown', event => {
  // Touching the board belongs to the maze even if the gesture starts away
  // from the current endpoint. Page scrolling remains available elsewhere.
  event.preventDefault();
  if (play.hidden || !event.isPrimary || activePointerId !== null) return;
  const point = pointInMaze(event);
  if (traceSession.begin(event.pointerId, point)) {
    activePointerId = event.pointerId;
    try { svg.setPointerCapture(event.pointerId); } catch { /* Some embedded WebViews lack pointer capture. */ }
  }
});
window.addEventListener('pointermove', event => {
  if (activePointerId !== event.pointerId || play.hidden) return;
  event.preventDefault();
  const result = traceSession.move(event.pointerId, pointInMaze(event));
  if (result.moved) render();
  if (result.complete) {
    finishPointer(event); pauseTimer(); $('#final-time').textContent = formatTime(elapsed); activeScreen(complete);
  }
});
window.addEventListener('pointerup', event => finishPointer(event));
window.addEventListener('pointercancel', event => finishPointer(event, true));
window.addEventListener('lostpointercapture', event => finishPointer(event, true));
document.addEventListener('visibilitychange', () => document.hidden ? pauseTimer() : startTimer());
window.addEventListener('blur', pauseTimer); window.addEventListener('focus', startTimer);
$('#quick-play').addEventListener('click', newMaze);
$('#new-maze').addEventListener('click', newMaze);
$('#next-maze').addEventListener('click', newMaze);
$('#back-home').addEventListener('click', () => { pauseTimer(); activeScreen(home); });
$('#complete-home').addEventListener('click', () => activeScreen(home));
