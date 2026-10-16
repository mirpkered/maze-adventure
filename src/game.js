import { createMazeForDifficulty, FREE_PLAY_DIFFICULTIES, getShortestPath, getWallSegments } from './maze.js';
import { createTraceSession } from './tracing.js';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, readPreferences, writePreferences } from './preferences.js';
import { clientToViewBoxPoint, getMazeGridGeometry, mazeToSvgPoint, svgToMazePoint, transformPoint } from './coordinates.js';
import { tracePathData } from './trace-rendering.js';
import { createTraceRecorder, mazeLayoutId } from './trace-diagnostics.js';
import { bindEmblemQaTrigger, closeQaSession, startQaSession } from './qa-mode.js';
import { finalPointerMovement, pointerMovementSamples } from './pointer-samples.js';
import { APP_BUILD_ID } from './build-info.js';
import { createQaDiagnosticsStore, createQuickSummary, createRecentIncident } from './qa-diagnostics-store.js';
import { applyVisualTheme, chooseLaunchTheme, THEME_PREFERENCE_OPTIONS } from './themes.js';

const $ = selector => document.querySelector(selector);
const screens = ['home', 'difficulty', 'play', 'complete', 'settings', 'help', 'about'].map(id => $(`#${id}`));
const svg = $('#maze');
let deviceStorage = null;
try { deviceStorage = window.localStorage; } catch { /* Private or embedded contexts may block storage. */ }
const SIZE = 400, PAD = 24;
let gridGeometry = getMazeGridGeometry(7, 7, SIZE, PAD);
const PENCIL_ACQUISITION_RADIUS_PX = 24;
let maze, traceSession, activePointerId = null, elapsed = 0, startedAt = 0, timerId;
let selectedDifficulty = 'easy';
let paused = false, activeOverlay = null, returnFocus = null, resumeAfterOverlay = false;
let isolatedPage = [], bodyOverflow = '';
function preferenceStorageAvailable() {
  if (!deviceStorage) return false;
  const key = `${PREFERENCES_KEY}.availability-check`;
  try {
    const prior = deviceStorage.getItem(key);
    deviceStorage.setItem(key, '1');
    if (prior === null) deviceStorage.removeItem(key);
    else deviceStorage.setItem(key, prior);
    return true;
  } catch { return false; }
}
const canPersistPreferences = preferenceStorageAvailable();
let preferences = readPreferences(deviceStorage);
let activeVisualTheme = chooseLaunchTheme(preferences.themePreference, preferences.lastAutoTheme, Math.random, canPersistPreferences);
if (preferences.themePreference === 'auto') preferences = writePreferences({ ...preferences, lastAutoTheme: activeVisualTheme }, deviceStorage);
applyVisualTheme(document, activeVisualTheme);
for (const { value, label } of THEME_PREFERENCE_OPTIONS) {
  const option = [...$('#visual-theme').options].find(item => item.value === value);
  if (option) option.textContent = label;
  else $('#visual-theme').add(new Option(label, value));
}
let settingsReturnToPlay = false;
let qaEnabled = startQaSession(location, history, deviceStorage);
let lastRawPointer = null, lastClientPointer = null;
let traceRecorder = qaEnabled ? createTraceRecorder({ limit: 400 }) : null;
const qaStore = createQaDiagnosticsStore(deviceStorage);
let qaSessionId = qaEnabled ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null;
let persistTimer = null;
let currentLayoutId = null;
if (qaEnabled) document.body.dataset.qa = 'true';

function setQaMode(enabled) {
  if (qaEnabled && !enabled) {
    clearTimeout(persistTimer);
    if (traceRecorder && traceSession && qaSessionId) qaStore.save(diagnosticReportObject(), { sessionId: qaSessionId, buildId: APP_BUILD_ID });
  }
  qaEnabled = Boolean(enabled);
  if (qaEnabled) {
    traceRecorder ??= createTraceRecorder({ limit: 400 });
    qaSessionId ??= `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    $('#qa-mode-status').textContent = 'QA mode is on for this session. Use Exit QA mode to turn it off.';
    window.mazeAdventureTraceDiagnostics = () => traceSession?.diagnostics ?? null;
  } else {
    $('#trace-diagnostic-fallback').hidden = true;
    $('#trace-diagnostic-status').textContent = '';
    $('#qa-mode-status').textContent = '';
    closeQaSession(location, history, deviceStorage);
    delete window.mazeAdventureTraceDiagnostics;
    traceRecorder = null;
    qaSessionId = null;
  }
  syncQaControls();
  updateTraceDiagnostics();
}

function syncQaControls() {
  if (qaEnabled) document.body.dataset.qa = 'true';
  else delete document.body.dataset.qa;
  $('#trace-diagnostic-tools').hidden = !qaEnabled;
  $('#trace-diagnostics').hidden = !qaEnabled || !traceSession;
  if (qaEnabled) refreshQaSessions();
}

function refreshQaSessions() {
  const picker = $('#qa-session-history');
  if (!picker) return;
  const selected = picker.value;
  picker.replaceChildren(new Option('Current session', 'current'));
  const sessions = qaStore.list();
  for (const item of sessions) picker.add(new Option(`${new Date(item.savedAt).toLocaleString()} · ${item.buildId ?? 'build unknown'}`, item.sessionId));
  if ([...picker.options].some(option => option.value === selected)) picker.value = selected;
  $('#qa-retention-status').textContent = `Local QA history: ${qaStore.available ? `${sessions.length} retained session(s), up to 24 hours` : 'unavailable; current session only'}. Reports stay on this device.`;
}

function selectedQaReport() {
  const id = $('#qa-session-history')?.value;
  if (!id || id === 'current') return diagnosticReportObject();
  return qaStore.list().find(item => item.sessionId === id)?.report ?? diagnosticReportObject();
}

function recordTraceEvent(eventType, event, point, accepted, reason = null, canceled = false, movement = null, sampleType = 'dispatched', sampleIndex = null) {
  if (!traceRecorder || !traceSession) return;
  const state = traceSession.diagnostics;
  let captured = false;
  try { captured = event?.pointerId !== undefined && Boolean(svg.hasPointerCapture?.(event.pointerId)); } catch { /* Capture state is unavailable in some embedded WebViews. */ }
  traceRecorder.record({
    eventType,
    pointerType: event?.pointerType ?? 'unknown',
    sampleType,
    sampleIndex,
    client: event && Number.isFinite(event.clientX) ? { x: Math.round(event.clientX * 10) / 10, y: Math.round(event.clientY * 10) / 10 } : null,
    maze: point ? { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 } : null,
    cell: { ...state.cell },
    acceptedInkEndpoint: { ...state.endpoint },
    pencilPosition: { ...state.authoritativePosition },
    previousRouteCell: state.previousCell ? { ...state.previousCell } : null,
    candidateReversal: state.candidateReversal,
    candidateReversalOpen: state.candidateReversalOpen,
    resumeAcquisitionDistance: state.resumeAcquisitionDistance,
    resumeAcquisitionThreshold: state.resumeAcquisitionThreshold,
    resumeAcquisitionDistancePixels: state.resumeAcquisitionDistancePixels,
    resumeAcquisitionThresholdPixels: state.resumeAcquisitionThresholdPixels,
    failureCategory: state.failureCategory,
    traceHealth: state.traceHealth,
    interpolationCount: movement?.interpolatedSamples ?? 0,
    gestureTerminatedByWallCollision: Boolean(movement?.gestureTerminatedByWallCollision),
    lockedOutMovement: Boolean(movement?.ignored),
    lockedOutMovementCount: state.lockedOutMovementCount,
    resumeAfterWallCollision: state.resumeAfterWallCollision,
    attemptedTransitions: movement?.attemptedTransitions ?? [],
    strokeBreakCreated: movement?.strokeBreakCreated ?? false,
    gestureState: state.lockedOut ? 'locked-out-until-release' : state.active ? (state.recovering ? 'recovering' : 'active') : 'idle',
    accepted: Boolean(accepted),
    movementAccepted: Boolean(movement?.moved || (eventType === 'pointermove' && accepted)),
    rejectedReason: reason ?? state.reason ?? (accepted ? null : 'no-route-or-stroke-change'),
    blocked: state.blocked,
    pointerCaptured: captured,
    pointerCanceled: canceled,
    layoutId: currentLayoutId,
  });
  queueQaPersistence();
  updateTraceDiagnostics(point);
}

function diagnosticReportObject() {
  const state = traceSession?.diagnostics;
  return traceRecorder.report({
    layoutId: currentLayoutId,
    dimensions: maze ? { width: maze.width, height: maze.height } : null,
    difficulty: maze?.difficulty ?? selectedDifficulty,
    start: maze?.entrance ? { cell: { ...maze.start }, edge: maze.entrance.side } : null,
    finish: maze?.exit ? { cell: { ...maze.end }, edge: maze.exit.side } : null,
    shortestSolutionLength: maze ? (getShortestPath(maze)?.length ?? 0) - 1 : null,
    mazeDefinition: maze ? {
      start: { ...maze.start }, end: { ...maze.end },
      entrance: maze.entrance ? { cell: { ...maze.entrance.cell }, side: maze.entrance.side } : null,
      exit: maze.exit ? { cell: { ...maze.exit.cell }, side: maze.exit.side } : null,
      cells: maze.cells.map(row => row.map(cell => ({ x: cell.x, y: cell.y, walls: { ...cell.walls } }))),
    } : null,
    route: traceSession?.path.map(cell => ({ ...cell })) ?? [],
    ink: traceSession?.stroke.map(point => ({ x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 })) ?? [],
    state: state ? { ...state } : null,
    inkCellAssociation: state?.strokeCells ?? [],
    buildId: APP_BUILD_ID,
  });
}
function diagnosticReport() { return JSON.stringify(diagnosticReportObject(), null, 2); }
function queueQaPersistence() {
  if (!qaEnabled || !traceRecorder || !traceSession || !qaSessionId) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const report = diagnosticReportObject();
    qaStore.save(report, { sessionId: qaSessionId, buildId: APP_BUILD_ID });
    refreshQaSessions();
  }, 700);
}

function updateTraceDiagnostics(raw = lastRawPointer) {
  if (!qaEnabled || !traceSession) return;
  const output = $('#trace-diagnostics');
  if (!output) return;
  output.hidden = false;
  const state = traceSession.diagnostics;
  const point = value => value ? `${value.x.toFixed(3)}, ${value.y.toFixed(3)}` : '—';
  const reversal = state.candidateReversal ? `${state.candidateReversal.x},${state.candidateReversal.y} (${state.candidateReversalOpen ? 'open' : 'closed'})` : 'none';
  const resume = state.resumeAcquisitionDistancePixels === null ? '—' : `${state.resumeAcquisitionDistancePixels.toFixed(1)}/${state.resumeAcquisitionThresholdPixels.toFixed(0)}px`;
  output.textContent = `QA trace · build ${APP_BUILD_ID} · client px ${point(lastClientPointer)} · raw maze ${point(raw)} · pencil ${point(state.authoritativePosition)} · cell ${state.logicalCell.x},${state.logicalCell.y} · ${state.blocked ? `BLOCKED: ${state.reason ?? 'unspecified'} (${state.failureCategory ?? 'unknown'})` : 'clear'} · health ${state.traceHealth} · reverse ${reversal} · resume distance/limit ${resume} · gesture ${state.lockedOut ? `locked until release (${state.lockedOutMovementCount} ignored)` : state.active ? (state.recovering ? 'recovering' : 'active') : 'idle'} · resumed after wall ${state.resumeAfterWallCollision ? 'yes' : 'no'} · events ${traceRecorder?.length ?? 0} · maze ${currentLayoutId ?? 'not started'}`;
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function activeScreen(screen, { safeToUpdate = true } = {}) {
  document.body.dataset.screen = screen.id;
  for (const item of screens) item.hidden = item !== screen;
  if (safeToUpdate && ['home', 'difficulty', 'settings', 'help', 'about'].includes(screen.id)) window.dispatchEvent(new Event('maze-adventure:safe-to-update'));
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
function pointInMaze(event) { return svgToMazePoint(pointAt(event), gridGeometry.x, gridGeometry.cellSize, gridGeometry.y); }
function svgPoint(point) { return mazeToSvgPoint(point, gridGeometry.x, gridGeometry.cellSize, gridGeometry.y); }
function pencilAcquisitionOptions() {
  const rect = svg.getBoundingClientRect();
  const cellPixels = rect.width * gridGeometry.cellSize / SIZE;
  const pixelsPerMazeUnit = cellPixels > 0 ? cellPixels : null;
  return {
    radius: pixelsPerMazeUnit ? PENCIL_ACQUISITION_RADIUS_PX / pixelsPerMazeUnit : 0.5,
    pixelsPerMazeUnit,
  };
}

function renderTrace() {
  if (!traceSession) return;
  const points = traceSession.stroke.map(svgPoint);
  const trail = $('#trail');
  trail.setAttribute('d', tracePathData(points, traceSession.strokeBreaks));
  const endpoint = svgPoint(traceSession.position);
  $('#player').setAttribute('cx', endpoint.x);
  $('#player').setAttribute('cy', endpoint.y);
  svg.dataset.visited = String(new Set(traceSession.path.map(point => `${point.x},${point.y}`)).size);
}

function renderMaze() {
  gridGeometry = getMazeGridGeometry(maze.width, maze.height, SIZE, PAD);
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  const create = (tag, attributes, text) => {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text) element.textContent = text;
    return element;
  };
  const trail = create('path', { id: 'trail', class: 'trail', fill: 'none', d: '' });
  svg.append(trail);
  const walls = create('g', { class: 'walls', 'aria-hidden': 'true' });
  const line = (x1, y1, x2, y2) => walls.append(create('line', { x1, y1, x2, y2, class: 'wall' }));
  for (const segment of getWallSegments(maze)) {
    const x0 = gridGeometry.x + segment.x * gridGeometry.cellSize, y0 = gridGeometry.y + segment.y * gridGeometry.cellSize;
    if (segment.orientation === 'horizontal') line(x0, y0, x0 + gridGeometry.cellSize, y0);
    else line(x0, y0, x0, y0 + gridGeometry.cellSize);
  }
  svg.append(walls);
  const start = svgPoint(maze.start), end = svgPoint(maze.end);
  const markerPosition = (opening, isStart) => {
    const cell = opening.cell, x = gridGeometry.x + (cell.x + .5) * gridGeometry.cellSize;
    const y = gridGeometry.y + (cell.y + .5) * gridGeometry.cellSize;
    if (opening.side === 'N') return { x, y: gridGeometry.y - (isStart ? 7 : 8) };
    if (opening.side === 'S') return { x, y: gridGeometry.y + maze.height * gridGeometry.cellSize + (isStart ? 16 : 16) };
    if (opening.side === 'W') return { x: gridGeometry.x - 8, y, rotate: -90 };
    return { x: SIZE - 8, y, rotate: 90 };
  };
  const startMarker = markerPosition(maze.entrance, true), endMarker = markerPosition(maze.exit, false);
  const marker = (position, className, text) => create('text', {
    x: position.x, y: position.y, 'text-anchor': 'middle', class: `marker ${className}`,
    ...(position.rotate ? { transform: `rotate(${position.rotate} ${position.x} ${position.y})` } : {}),
  }, text);
  svg.append(marker(startMarker, 'marker-start', 'START'));
  svg.append(marker(endMarker, 'marker-end', '✿'));
  svg.append(create('circle', { id: 'player', cx: start.x, cy: start.y, r: gridGeometry.cellSize * .19, class: 'player' }));
  renderTrace();
}

function setTheme() { document.body.dataset.paperTheme = preferences.paperTheme; }
function updateSettingsControls() {
  $('#sound-effects').checked = preferences.soundEffects;
  $('#paper-theme').value = preferences.paperTheme;
  $('#visual-theme').value = preferences.themePreference;
  setTheme();
}
function savePreferences(update) {
  preferences = writePreferences({ ...preferences, ...update });
  updateSettingsControls();
}
function saveThemePreference(themePreference) {
  if (themePreference === 'auto') {
    activeVisualTheme = chooseLaunchTheme('auto', activeVisualTheme, Math.random, canPersistPreferences);
    preferences = writePreferences({ ...preferences, themePreference, lastAutoTheme: activeVisualTheme }, deviceStorage);
  } else {
    activeVisualTheme = themePreference;
    preferences = writePreferences({ ...preferences, themePreference }, deviceStorage);
  }
  applyVisualTheme(document, activeVisualTheme);
  updateSettingsControls();
}
function openSettingsFromPause() {
  settingsReturnToPlay = true;
  closeOverlay({ restore: false });
  updateSettingsControls();
  $('#settings-home').textContent = '← Return to Maze';
  activeScreen($('#settings'), { safeToUpdate: false });
  $('#settings-title').focus({ preventScroll: true });
}
function returnFromSettings() {
  if (!settingsReturnToPlay) { showHome(); return; }
  settingsReturnToPlay = false;
  paused = false;
  $('#settings-home').textContent = '← Home';
  activeScreen($('#play'));
  $('#pause-game').focus({ preventScroll: true });
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
  if (!reuse || !maze) maze = createMazeForDifficulty(selectedDifficulty);
  selectedDifficulty = maze.difficulty ?? selectedDifficulty;
  $('#play-difficulty').textContent = FREE_PLAY_DIFFICULTIES[selectedDifficulty].label.toUpperCase();
  currentLayoutId = mazeLayoutId(maze);
  traceSession = createTraceSession(maze);
  activePointerId = null; elapsed = 0; paused = false; displayTime();
  $('#final-time').textContent = '0:00';
  $('#play-hint').textContent = 'Trace from the entrance to the flower. You can lift and continue.';
  renderMaze(); activeScreen($('#play')); syncQaControls(); updateTraceDiagnostics(); queueQaPersistence(); $('#play-title').focus({ preventScroll: true }); startTimer();
}

function clearPointer() {
  if (activePointerId === null) return;
  const id = activePointerId;
  recordTraceEvent('gesture-canceled-by-app', {
    pointerId: id, pointerType: 'unknown', clientX: lastClientPointer?.x, clientY: lastClientPointer?.y,
  }, lastRawPointer, false, 'application-interruption', true);
  traceSession?.cancel(id); activePointerId = null;
  try { if (svg.hasPointerCapture?.(id)) svg.releasePointerCapture(id); } catch { /* Capture may already be gone. */ }
  renderTrace();
  updateTraceDiagnostics();
}
function finishPointer(event, cancel = false) {
  if (activePointerId !== event.pointerId) return;
  lastClientPointer = { x: event.clientX, y: event.clientY };
  lastRawPointer = pointInMaze(event);
  const finalMove = !cancel ? finalPointerMovement(traceSession, event.pointerId, event, lastRawPointer) : null;
  if (finalMove?.moved) renderTrace();
  recordTraceEvent(event.type ?? (cancel ? 'pointercancel' : 'pointerup'), event, lastRawPointer,
    finalMove ? finalMove.moved : true,
    finalMove?.reason ?? (!finalMove?.moved && finalMove ? 'no-route-or-stroke-change' : null), cancel, finalMove);
  if (cancel) traceSession.cancel(event.pointerId);
  else traceSession.end(event.pointerId);
  activePointerId = null;
  try { if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId); } catch { /* Capture may already be released by the browser. */ }
  updateTraceDiagnostics();
  return Boolean(finalMove?.complete);
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
function showDifficultySelection() { activeScreen($('#difficulty')); $('#difficulty-title').focus({ preventScroll: true }); }
function openHomeConfirmation() {
  clearPointer();
  openOverlay($('#confirm-dialog'), { pause: true, resumeOnClose: true });
}
function returnToHome() { showHome(); }

svg.addEventListener('pointerdown', event => {
  event.preventDefault();
  if ($('#play').hidden || !traceSession) return;
  lastClientPointer = { x: event.clientX, y: event.clientY };
  lastRawPointer = pointInMaze(event);
  if (paused || activeOverlay) { recordTraceEvent('pointerdown', event, lastRawPointer, false, 'game-not-interactive'); return; }
  if (!event.isPrimary) { recordTraceEvent('pointerdown', event, lastRawPointer, false, 'non-primary-pointer'); return; }
  if (activePointerId !== null) { recordTraceEvent('pointerdown', event, lastRawPointer, false, 'another-pointer-owns-gesture'); return; }
  const began = traceSession.begin(event.pointerId, lastRawPointer, pencilAcquisitionOptions());
  if (began) {
    activePointerId = event.pointerId;
    try { svg.setPointerCapture(event.pointerId); } catch { /* Older embedded WebViews may lack pointer capture. */ }
    updateTraceDiagnostics(lastRawPointer);
  }
  recordTraceEvent('pointerdown', event, lastRawPointer, began, began ? null : traceSession.diagnostics.reason);
});
window.addEventListener('pointermove', event => {
  if (activePointerId !== event.pointerId || $('#play').hidden || paused) return;
  event.preventDefault();
  let moved = false, complete = false;
  const samples = pointerMovementSamples(event);
  for (const [sampleIndex, sample] of samples.entries()) {
    lastClientPointer = { x: sample.clientX, y: sample.clientY };
    lastRawPointer = pointInMaze(sample);
    const result = traceSession.move(event.pointerId, lastRawPointer);
    moved ||= result.moved;
    if (!result.ignored || result.firstLockedOutMove) {
      recordTraceEvent('pointermove', sample, lastRawPointer, result.moved, result.reason ?? (!result.moved ? 'no-route-or-stroke-change' : null), false, result,
        sample === event ? 'dispatched' : 'coalesced', sampleIndex);
    }
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
window.addEventListener('pointerup', event => { if (finishPointer(event)) completeMaze(); });
window.addEventListener('pointercancel', event => finishPointer(event, true));
window.addEventListener('lostpointercapture', event => finishPointer(event, true));
document.addEventListener('visibilitychange', () => document.hidden ? pauseTimer() : startTimer());
window.addEventListener('blur', pauseTimer);
window.addEventListener('focus', startTimer);

$('#quick-play').addEventListener('click', showDifficultySelection);
$('#difficulty-home').addEventListener('click', showHome);
for (const option of document.querySelectorAll('[data-start-difficulty]')) {
  option.addEventListener('click', () => {
    const difficulty = option.dataset.startDifficulty;
    if (!Object.hasOwn(FREE_PLAY_DIFFICULTIES, difficulty)) return;
    selectedDifficulty = difficulty;
    makeMaze();
  });
}
$('#new-maze').addEventListener('click', () => makeMaze());
$('#next-maze').addEventListener('click', () => makeMaze());
$('#restart-maze').addEventListener('click', () => makeMaze(true));
$('#replay-maze').addEventListener('click', () => makeMaze(true));
$('#back-home').addEventListener('click', openHomeConfirmation);
$('#brand-home').addEventListener('click', event => { event.preventDefault(); $('#play').hidden ? showHome() : openHomeConfirmation(); });
$('#complete-home').addEventListener('click', showHome);
$('#pause-game').addEventListener('click', () => openOverlay($('#pause-dialog'), { pause: true }));
$('#pause-settings').addEventListener('click', openSettingsFromPause);
function resumeFromPause() { paused = false; closeOverlay(); startTimer(); }
$('#resume-game').addEventListener('click', resumeFromPause);
$('#close-pause').addEventListener('click', resumeFromPause);
$('#pause-restart').addEventListener('click', () => { closeOverlay(); makeMaze(true); });
$('#pause-new').addEventListener('click', () => { closeOverlay(); makeMaze(); });
$('#pause-home').addEventListener('click', returnToHome);
$('#confirm-leave').addEventListener('click', returnToHome);
$('#cancel-leave').addEventListener('click', () => closeOverlay({ resume: true }));

$('#open-settings').addEventListener('click', () => { settingsReturnToPlay = false; $('#settings-home').textContent = '← Home'; updateSettingsControls(); activeScreen($('#settings')); $('#settings-title').focus({ preventScroll: true }); });
$('#settings-home').addEventListener('click', returnFromSettings);
$('#open-help').addEventListener('click', () => { activeScreen($('#help')); $('#help-title').focus({ preventScroll: true }); });
$('#help-home').addEventListener('click', showHome);
$('#help-play').addEventListener('click', showDifficultySelection);
$('#open-about').addEventListener('click', () => { activeScreen($('#about')); $('#about-title').focus({ preventScroll: true }); });
$('#about-home').addEventListener('click', showHome);
$('#open-credits').addEventListener('click', () => { activeScreen($('#about')); $('#about-title').focus({ preventScroll: true }); });
$('#sound-effects').addEventListener('change', event => savePreferences({ soundEffects: event.currentTarget.checked }));
$('#paper-theme').addEventListener('change', event => savePreferences({ paperTheme: event.currentTarget.value }));
$('#visual-theme').addEventListener('change', event => saveThemePreference(event.currentTarget.value));
$('#reset-settings').addEventListener('click', () => openOverlay($('#reset-dialog')));
$('#cancel-reset').addEventListener('click', () => closeOverlay());
$('#confirm-reset').addEventListener('click', () => {
  preferences = writePreferences({ ...DEFAULT_PREFERENCES }, deviceStorage);
  activeVisualTheme = chooseLaunchTheme('auto', activeVisualTheme, Math.random, canPersistPreferences);
  preferences = writePreferences({ ...preferences, lastAutoTheme: activeVisualTheme }, deviceStorage);
  applyVisualTheme(document, activeVisualTheme);
  updateSettingsControls(); closeOverlay();
});

async function copyQaText(value, label) {
  const fallback = $('#trace-diagnostic-fallback'), status = $('#trace-diagnostic-status');
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(value); fallback.hidden = true; status.textContent = `${label} copied.`;
  } catch {
    fallback.value = value; fallback.hidden = false; fallback.focus({ preventScroll: true });
    fallback.select(); fallback.setSelectionRange(0, fallback.value.length);
    let copied = false; try { copied = document.execCommand('copy'); } catch { /* Selection remains available. */ }
    status.textContent = copied ? `${label} copied.` : `Clipboard unavailable. ${label} is selected below; use Copy, then paste or share it.`;
  }
}
$('#copy-qa-summary').addEventListener('click', () => {
  if (!qaEnabled || !traceRecorder) return;
  const report = selectedQaReport();
  copyQaText(createQuickSummary(report, report.counters ?? traceRecorder.counters), 'Quick summary');
});
$('#copy-qa-incident').addEventListener('click', () => {
  if (!qaEnabled || !traceRecorder) return;
  copyQaText(JSON.stringify(createRecentIncident(selectedQaReport()), null, 2), 'Recent incident');
});
$('#copy-trace-report').addEventListener('click', async () => {
  if (!qaEnabled || !traceRecorder) return;
  const file = new File([JSON.stringify(selectedQaReport(), null, 2)], `maze-adventure-qa-${Date.now()}.json`, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ title: 'Maze Adventure QA report', files: [file] });
      $('#trace-diagnostic-status').textContent = 'Full report opened in the system share sheet.'; return;
    }
  } catch (error) { if (error?.name === 'AbortError') return; }
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
  $('#trace-diagnostic-status').textContent = 'Full JSON report exported as a file.';
});
$('#reset-trace-log').addEventListener('click', () => {
    if (!qaEnabled || !traceRecorder) return;
    traceRecorder.reset();
    $('#trace-diagnostic-fallback').hidden = true;
    $('#trace-diagnostic-status').textContent = 'Current diagnostic log cleared; maze and pencil progress were kept.';
    queueQaPersistence();
    updateTraceDiagnostics();
});
$('#clear-qa-sessions').addEventListener('click', () => {
  if (!qaEnabled || !window.confirm('Delete locally saved QA sessions? Game progress and preferences will remain.')) return;
  const cleared = qaStore.clear(); refreshQaSessions();
  $('#qa-retention-status').textContent = cleared ? 'Saved QA sessions cleared. Game progress and preferences remain.' : 'Local QA storage unavailable; no saved reports could be cleared.';
});
window.addEventListener('pagehide', () => {
  if (!qaEnabled || !traceRecorder || !traceSession || !qaSessionId) return;
  clearTimeout(persistTimer); qaStore.save(diagnosticReportObject(), { sessionId: qaSessionId, buildId: APP_BUILD_ID });
});
$('#disable-qa-mode').addEventListener('click', () => setQaMode(false));
bindEmblemQaTrigger($('#qa-logo-trigger'), () => {
  setQaMode(true);
  if (navigator.vibrate) navigator.vibrate(18);
});

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
activeScreen($('#home'));
setQaMode(qaEnabled);
updateTraceDiagnostics();
