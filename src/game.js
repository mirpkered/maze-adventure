import { createMaze } from './maze.js';
import { createTraceSession } from './tracing.js';
import { DEFAULT_PREFERENCES, readPreferences, writePreferences } from './preferences.js';
import { clientToViewBoxPoint, mazeToSvgPoint, svgToMazePoint, transformPoint } from './coordinates.js';

const $ = selector => document.querySelector(selector);
const screens = ['home', 'play', 'complete', 'settings', 'help', 'about'].map(id => $(`#${id}`));
const svg = $('#maze');
const SIZE = 400, PAD = 24, CELL = (SIZE - PAD * 2) / 7;
let maze, traceSession, activePointerId = null, elapsed = 0, startedAt = 0, timerId;
let paused = false, activeOverlay = null, returnFocus = null, resumeAfterOverlay = false;
let isolatedPage = [], bodyOverflow = '';
let preferences = readPreferences();

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function activeScreen(screen) {
  document.body.dataset.screen = screen.id;
  for (const item of screens) item.hidden = item !== screen;
  if (screen !== $('#play')) pauseTimer();
  else if (!paused && !activeOverlay) startTimer();
}
function displayTime() { $('#timer').value = formatTime(elapsed); }
function startTimer() {
  if (timerId || $('#play').hidden || document.hidden || paused || activeOverlay) return;
  startedAt = Date.now() - elapsed;
  timerId = setInterval(() => { elapsed = Date.now() - startedAt; displayTime(); }, 200);
}
function pauseTimer() {
  if (!timerId) return;
  clearInterval(timerId); timerId = undefined;
  elapsed = Date.now() - startedAt; displayTime();
}

function pointAt(event) {
  const client = { x: event.clientX, y: event.clientY };
  try {
    const screenToSvg = svg.getScreenCTM()?.inverse();
    if (screenToSvg) return transformPoint(client, screenToSvg);
  } catch { /* Fall back for older or incomplete embedded SVG implementations. */ }
  return clientToViewBoxPoint(client, svg.getBoundingClientRect(), { x: 0, y: 0, width: SIZE, height: SIZE });
}
function pointInMaze(event) { return svgToMazePoint(pointAt(event), PAD, CELL); }
function svgPoint(point) { return mazeToSvgPoint(point, PAD, CELL); }

function renderTrace() {
  if (!traceSession) return;
  const points = traceSession.stroke.map(svgPoint);
  const trail = $('#trail');
  trail.setAttribute('d', points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '));
  const endpoint = points.at(-1);
  $('#player').setAttribute('cx', endpoint.x);
  $('#player').setAttribute('cy', endpoint.y);
  svg.dataset.visited = String(new Set(traceSession.path.map(point => `${point.x},${point.y}`)).size);
}

function renderMaze() {
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  const create = (tag, attributes, text) => {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text) element.textContent = text;
    return element;
  };
  const trail = create('path', { id: 'trail', class: 'trail', d: '' });
  svg.append(trail);
  const walls = create('g', { class: 'walls', 'aria-hidden': 'true' });
  const line = (x1, y1, x2, y2) => walls.append(create('line', { x1, y1, x2, y2, class: 'wall' }));
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    const cell = maze.cells[y][x], x0 = PAD + x * CELL, y0 = PAD + y * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
    if (cell.walls.N && !(x === maze.start.x && y === maze.start.y)) line(x0, y0, x1, y0);
    if (cell.walls.W && x > 0) line(x0, y0, x0, y1);
    if (cell.walls.E) line(x1, y0, x1, y1);
    if (cell.walls.S && !(x === maze.end.x && y === maze.end.y)) line(x0, y1, x1, y1);
  }
  svg.append(walls);
  const start = svgPoint(maze.start), end = svgPoint(maze.end);
  svg.append(create('text', { x: start.x, y: PAD - 7, 'text-anchor': 'middle', class: 'marker marker-start' }, 'START'));
  svg.append(create('text', { x: end.x, y: SIZE - PAD + 17, 'text-anchor': 'middle', class: 'marker marker-end' }, '✿'));
  svg.append(create('circle', { id: 'player', cx: start.x, cy: start.y, r: CELL * .19, class: 'player' }));
  renderTrace();
}

function setTheme() { document.body.dataset.paperTheme = preferences.paperTheme; }
function updateSettingsControls() {
  $('#sound-effects').checked = preferences.soundEffects;
  $('#paper-theme').value = preferences.paperTheme;
  setTheme();
}
function savePreferences(update) {
  preferences = writePreferences({ ...preferences, ...update });
  updateSettingsControls();
}

function playCompletionSound() {
  if (!preferences.soundEffects) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const now = context.currentTime;
    for (const [index, frequency] of [523.25, 659.25, 783.99].entries()) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, now + index * .11);
      gain.gain.exponentialRampToValueAtTime(.075, now + index * .11 + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, now + index * .11 + .22);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(now + index * .11); oscillator.stop(now + index * .11 + .23);
    }
    window.setTimeout(() => context.close(), 650);
  } catch { /* Audio is optional; puzzle completion never depends on it. */ }
}

function makeMaze(reuse = false) {
  if (!reuse || !maze) maze = createMaze(7, 7);
  traceSession = createTraceSession(maze);
  activePointerId = null; elapsed = 0; paused = false; displayTime();
  $('#final-time').textContent = '0:00';
  $('#play-hint').textContent = 'Trace from the entrance to the flower. You can lift and continue.';
  renderMaze(); activeScreen($('#play')); $('#play-title').focus({ preventScroll: true }); startTimer();
}

function clearPointer() {
  if (activePointerId === null) return;
  const id = activePointerId;
  traceSession?.cancel(id); activePointerId = null;
  try { if (svg.hasPointerCapture?.(id)) svg.releasePointerCapture(id); } catch { /* Capture may already be gone. */ }
  renderTrace();
}
function finishPointer(event, cancel = false) {
  if (activePointerId !== event.pointerId) return;
  if (cancel) traceSession.cancel(event.pointerId);
  else traceSession.end(event.pointerId);
  activePointerId = null;
  try { if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId); } catch { /* Capture may already be released by the browser. */ }
}
function completeMaze() {
  pauseTimer(); $('#final-time').textContent = formatTime(elapsed);
  activeScreen($('#complete')); $('#complete-title').focus({ preventScroll: true }); playCompletionSound();
}

function closeOverlay({ resume = false, restore = true } = {}) {
  if (!activeOverlay) return;
  const oldOverlay = activeOverlay;
  oldOverlay.hidden = true; activeOverlay = null;
  for (const item of isolatedPage) {
    if (item.inert) item.element.setAttribute('inert', ''); else item.element.removeAttribute('inert');
    if (item.ariaHidden === null) item.element.removeAttribute('aria-hidden'); else item.element.setAttribute('aria-hidden', item.ariaHidden);
  }
  isolatedPage = [];
  document.body.style.overflow = bodyOverflow;
  const target = returnFocus?.isConnected ? returnFocus : null;
  returnFocus = null;
  if (resume && resumeAfterOverlay && $('#play').hidden === false) paused = false;
  resumeAfterOverlay = false;
  if (restore) target?.focus({ preventScroll: true });
  if (!paused && $('#play').hidden === false) startTimer();
}
function openOverlay(overlay, { pause = false, resumeOnClose = false } = {}) {
  if (activeOverlay) closeOverlay();
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  resumeAfterOverlay = resumeOnClose && !paused;
  if (pause) { paused = true; pauseTimer(); clearPointer(); }
  bodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  isolatedPage = [...document.querySelector('.app-shell').children]
    .filter(element => element !== overlay)
    .map(element => ({ element, inert: element.hasAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') }));
  for (const item of isolatedPage) { item.element.setAttribute('inert', ''); item.element.setAttribute('aria-hidden', 'true'); }
  activeOverlay = overlay; overlay.hidden = false;
  (overlay.querySelector('button:not(:disabled)') ?? overlay).focus({ preventScroll: true });
}
function showHome() { closeOverlay({ restore: false }); paused = false; activeScreen($('#home')); $('#quick-play').focus({ preventScroll: true }); }
function openHomeConfirmation() {
  clearPointer();
  openOverlay($('#confirm-dialog'), { pause: true, resumeOnClose: true });
}
function returnToHome() { showHome(); }

svg.addEventListener('pointerdown', event => {
  event.preventDefault();
  if ($('#play').hidden || paused || activeOverlay || !event.isPrimary || activePointerId !== null) return;
  if (traceSession.begin(event.pointerId, pointInMaze(event))) {
    activePointerId = event.pointerId;
    try { svg.setPointerCapture(event.pointerId); } catch { /* Older embedded WebViews may lack pointer capture. */ }
  }
});
window.addEventListener('pointermove', event => {
  if (activePointerId !== event.pointerId || $('#play').hidden || paused) return;
  event.preventDefault();
  let coalesced;
  try { coalesced = event.getCoalescedEvents?.(); } catch { /* Older WebViews may expose but not implement this method. */ }
  const samples = coalesced?.length ? coalesced : [event];
  let moved = false, complete = false;
  for (const sample of samples) {
    const result = traceSession.move(event.pointerId, pointInMaze(sample));
    moved ||= result.moved;
    if (result.complete) { complete = true; break; }
  }
  if (moved) renderTrace();
  if (complete) {
    finishPointer(event); completeMaze();
  }
});
// A rotation can change the SVG's screen transform between pointer samples.
// End that gesture safely; the next touch resumes from the accepted endpoint.
window.addEventListener('resize', clearPointer);
svg.addEventListener('keydown', event => {
  const direction = { ArrowUp: { x: 0, y: -1 }, ArrowRight: { x: 1, y: 0 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 } }[event.key];
  if (!direction || $('#play').hidden || paused || activeOverlay) return;
  event.preventDefault();
  const result = traceSession.step(direction);
  if (result.moved) renderTrace();
  if (result.complete) completeMaze();
});
window.addEventListener('pointerup', event => finishPointer(event));
window.addEventListener('pointercancel', event => finishPointer(event, true));
window.addEventListener('lostpointercapture', event => finishPointer(event, true));
document.addEventListener('visibilitychange', () => document.hidden ? pauseTimer() : startTimer());
window.addEventListener('blur', pauseTimer);
window.addEventListener('focus', startTimer);

$('#quick-play').addEventListener('click', () => makeMaze());
$('#new-maze').addEventListener('click', () => makeMaze());
$('#next-maze').addEventListener('click', () => makeMaze());
$('#restart-maze').addEventListener('click', () => makeMaze(true));
$('#replay-maze').addEventListener('click', () => makeMaze(true));
$('#back-home').addEventListener('click', openHomeConfirmation);
$('#brand-home').addEventListener('click', event => { event.preventDefault(); $('#play').hidden ? showHome() : openHomeConfirmation(); });
$('#complete-home').addEventListener('click', showHome);
$('#pause-game').addEventListener('click', () => openOverlay($('#pause-dialog'), { pause: true }));
function resumeFromPause() { paused = false; closeOverlay(); startTimer(); }
$('#resume-game').addEventListener('click', resumeFromPause);
$('#close-pause').addEventListener('click', resumeFromPause);
$('#pause-restart').addEventListener('click', () => { closeOverlay(); makeMaze(true); });
$('#pause-new').addEventListener('click', () => { closeOverlay(); makeMaze(); });
$('#pause-home').addEventListener('click', returnToHome);
$('#confirm-leave').addEventListener('click', returnToHome);
$('#cancel-leave').addEventListener('click', () => closeOverlay({ resume: true }));

$('#open-settings').addEventListener('click', () => { updateSettingsControls(); activeScreen($('#settings')); $('#settings-title').focus(); });
$('#settings-home').addEventListener('click', showHome);
$('#open-help').addEventListener('click', () => { activeScreen($('#help')); $('#help-title').focus({ preventScroll: true }); });
$('#help-home').addEventListener('click', showHome);
$('#help-play').addEventListener('click', () => makeMaze());
$('#open-about').addEventListener('click', () => { activeScreen($('#about')); $('#about-title').focus({ preventScroll: true }); });
$('#about-home').addEventListener('click', showHome);
$('#open-credits').addEventListener('click', () => { activeScreen($('#about')); $('#about-title').focus({ preventScroll: true }); });
$('#sound-effects').addEventListener('change', event => savePreferences({ soundEffects: event.currentTarget.checked }));
$('#paper-theme').addEventListener('change', event => savePreferences({ paperTheme: event.currentTarget.value }));
$('#reset-settings').addEventListener('click', () => openOverlay($('#reset-dialog')));
$('#cancel-reset').addEventListener('click', () => closeOverlay());
$('#confirm-reset').addEventListener('click', () => { preferences = writePreferences({ ...DEFAULT_PREFERENCES }); updateSettingsControls(); closeOverlay(); });

document.addEventListener('keydown', event => {
  if (!activeOverlay) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (activeOverlay === $('#pause-dialog')) resumeFromPause();
    else if (activeOverlay === $('#confirm-dialog')) closeOverlay({ resume: true });
    else closeOverlay();
    return;
  }
  if (event.key !== 'Tab') return;
  const stops = [...activeOverlay.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)')].filter(element => !element.closest('[hidden]'));
  if (!stops.length) return;
  const index = stops.indexOf(document.activeElement);
  if (event.shiftKey && index <= 0) { event.preventDefault(); stops.at(-1).focus(); }
  else if (!event.shiftKey && index === stops.length - 1) { event.preventDefault(); stops[0].focus(); }
});

updateSettingsControls();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const workerUrl = new URL('../service-worker.js', import.meta.url);
  const appScope = new URL('../', import.meta.url).pathname;
  navigator.serviceWorker.register(workerUrl, { scope: appScope, updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(() => {});
}
