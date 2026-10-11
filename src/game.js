import { advancePath, createMaze } from './maze.js';

const $ = (selector) => document.querySelector(selector);
const home = $('#home'), play = $('#play'), complete = $('#complete'), svg = $('#maze');
const SIZE = 400, PAD = 24, CELL = (SIZE - PAD * 2) / 7;
let maze, path, pointerDown = false, lastPointerPoint = null, elapsed = 0, startedAt = 0, timerId;

function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function activeScreen(screen) { home.hidden = screen !== home; play.hidden = screen !== play; complete.hidden = screen !== complete; }
function startTimer() { if (timerId || play.hidden || document.hidden) return; startedAt = Date.now() - elapsed * 1000; timerId = setInterval(() => { elapsed = Math.floor((Date.now() - startedAt) / 1000); $('#timer').value = formatTime(elapsed); }, 250); }
function pauseTimer() { if (timerId) { clearInterval(timerId); timerId = undefined; elapsed = Math.floor((Date.now() - startedAt) / 1000); $('#timer').value = formatTime(elapsed); } }

function render() {
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  const line = (x1, y1, x2, y2, className = 'wall') => { const el = document.createElementNS(ns, 'line'); Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => el.setAttribute(k, v)); el.setAttribute('class', className); svg.append(el); };
  const center = p => ({ x: PAD + (p.x + .5) * CELL, y: PAD + (p.y + .5) * CELL });
  const points = path.map(center);
  if (points.length > 1) { const trail = document.createElementNS(ns, 'polyline'); trail.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' ')); trail.setAttribute('class', 'trail'); svg.append(trail); }
  const visited = new Set(path.map(p => `${p.x},${p.y}`));
  for (const p of path) { const c = center(p), dot = document.createElementNS(ns, 'circle'); dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y); dot.setAttribute('r', 3.5); dot.setAttribute('class', 'trail-dot'); svg.append(dot); }
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
  path = [{ ...maze.start }]; elapsed = 0; $('#timer').value = '0:00';
  $('#play-hint').textContent = 'Trace the path from the little flag to the flower.';
  activeScreen(play); render(); startTimer();
}

function pointAt(event) {
  const box = svg.getBoundingClientRect();
  return { x: (event.clientX - box.left) / box.width * SIZE, y: (event.clientY - box.top) / box.height * SIZE };
}
function nearestCell(point) {
  const x = Math.round((point.x - PAD) / CELL - .5), y = Math.round((point.y - PAD) / CELL - .5);
  const centerX = PAD + (x + .5) * CELL, centerY = PAD + (y + .5) * CELL;
  if (Math.hypot(centerX - point.x, centerY - point.y) > CELL * .62) return null;
  return { x, y };
}
function onPointerMove(event) {
  if (!pointerDown || play.hidden) return;
  const point = pointAt(event), previous = lastPointerPoint || point;
  const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
  const samples = Math.max(1, Math.ceil(distance / (CELL * .2)));
  for (let i = 1; i <= samples; i++) {
    const candidate = nearestCell({ x: previous.x + (point.x - previous.x) * i / samples, y: previous.y + (point.y - previous.y) * i / samples });
    if (!candidate) continue;
    const result = advancePath(maze, path, candidate);
    if (!result.moved) continue;
    path = result.path; render();
    if (result.complete) {
      pointerDown = false; lastPointerPoint = null; pauseTimer(); $('#final-time').textContent = formatTime(elapsed); activeScreen(complete); return;
    }
  }
  lastPointerPoint = point;
}
svg.addEventListener('pointerdown', event => {
  if (play.hidden) return;
  const candidate = nearestCell(pointAt(event));
  const last = path.at(-1);
  if (candidate && candidate.x === last.x && candidate.y === last.y) {
    pointerDown = true; lastPointerPoint = pointAt(event); svg.setPointerCapture(event.pointerId); onPointerMove(event); event.preventDefault();
  }
});
svg.addEventListener('pointermove', onPointerMove);
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) svg.addEventListener(eventName, () => { pointerDown = false; lastPointerPoint = null; });
document.addEventListener('visibilitychange', () => document.hidden ? pauseTimer() : startTimer());
window.addEventListener('blur', pauseTimer); window.addEventListener('focus', startTimer);
$('#quick-play').addEventListener('click', newMaze);
$('#new-maze').addEventListener('click', newMaze);
$('#next-maze').addEventListener('click', newMaze);
$('#back-home').addEventListener('click', () => { pauseTimer(); activeScreen(home); });
$('#complete-home').addEventListener('click', () => activeScreen(home));
