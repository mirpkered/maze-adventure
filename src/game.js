import { createMazeForDifficulty, FREE_PLAY_DIFFICULTIES, getShortestPath, getWallSegments } from './maze.js';
import { createTraceSession } from './tracing.js';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, readPreferences, writePreferences } from './preferences.js';
import { clientToViewBoxPoint, getMazeGridGeometry, mazeToSvgPoint, svgToMazePoint, transformPoint } from './coordinates.js';
import { createMazeCamera, createQaZoomState, effectiveCameraZoom } from './maze-camera.js';
import { tracePathData } from './trace-rendering.js';
import { createTraceRecorder, mazeLayoutId } from './trace-diagnostics.js';
import { bindEmblemQaTrigger, closeQaSession, startQaSession } from './qa-mode.js';
import { pointerMovementSamples } from './pointer-samples.js';
import { APP_BUILD_ID } from './build-info.js';
import { createQaDiagnosticsStore, createQuickSummary, createRecentIncident } from './qa-diagnostics-store.js';
import { calculateQaOverviewSize, createQaCloseViewLayoutState, getQaCloseViewTargetHeight } from './qa-layout-state.js';
import { applyVisualTheme, chooseLaunchTheme, THEME_PREFERENCE_OPTIONS } from './themes.js';
import { createSteeringController } from './continuous-steering.js';
import { captureQaReturnState, restoreQaReturnState } from './qa-view-state.js';

const $ = selector => document.querySelector(selector);
const screens = ['home', 'difficulty', 'play', 'qa-config', 'settings', 'help', 'about'].map(id => $(`#${id}`));
const svg = $('#maze');
const overviewSvg = $('#maze-overview');
let deviceStorage = null;
try { deviceStorage = window.localStorage; } catch { /* Private or embedded contexts may block storage. */ }
const SIZE = 400, PAD = 24;
let gridGeometry = getMazeGridGeometry(7, 7, SIZE, PAD);
let mazeCamera = createMazeCamera({ viewSize: SIZE, zoom: 2 });
let cameraPosition = mazeCamera.snapshot();
let maze, traceSession, activePointerId = null, elapsed = 0, startedAt = 0, timerId, mazeCompleted = false;
let selectedDifficulty = 'easy';
let paused = false, activeOverlay = null, returnFocus = null, resumeAfterOverlay = false;
let qaReturnState = null;
let qaReturnFocus = null;
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
document.body.dataset.zoomAssist = String(preferences.zoomAssist);
for (const { value, label } of THEME_PREFERENCE_OPTIONS) {
  const option = [...$('#visual-theme').options].find(item => item.value === value);
  if (option) option.textContent = label;
  else $('#visual-theme').add(new Option(label, value));
}
let settingsReturnToPlay = false;
let qaEnabled = startQaSession(location, history, deviceStorage);
const qaZoomState = createQaZoomState();
const qaCloseViewLayout = createQaCloseViewLayoutState();
const steeringController = createSteeringController();
let steeringPointerId = null, steeringFrameId = null, steeringHadBlock = false, lastSteeringBlockReason = null;
let lastRawPointer = null, lastClientPointer = null;
let traceRecorder = qaEnabled ? createTraceRecorder({ limit: 400 }) : null;
const qaStore = createQaDiagnosticsStore(deviceStorage);
let qaSessionId = qaEnabled ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null;
let persistTimer = null;
let currentLayoutId = null;
let lastQaWorkspaceSize = null;
let lastQaLayoutMeasurements = null;
let lastQaMeasuredLayout = null;
if (qaEnabled) document.body.dataset.qa = 'true';

function currentCameraZoom() {
  return effectiveCameraZoom({ qaEnabled, qaZoom: qaZoomState.value, ordinaryZoom: 2 });
}

function refreshCameraForZoom() {
  mazeCamera = createMazeCamera({ viewSize: SIZE, zoom: currentCameraZoom() });
  cameraPosition = traceSession
    ? mazeCamera.center(svgPoint(traceSession.position))
    : mazeCamera.snapshot();
  $('#zoom-factor-label').textContent = `· ${cameraPosition.zoom}×`;
  if (traceSession) renderTrace();
}

function syncQaZoomControls() {
  const selector = $('#qa-zoom-magnification');
  const zoom = qaZoomState.value;
  if (selector) selector.value = String(zoom);
  const status = $('#qa-zoom-status');
  if (status) status.textContent = `Selected for this QA session: ${zoom.toFixed(2).replace(/0$/, '')}×. Ordinary play remains at 2.0×.`;
  const indicator = $('#qa-active-mode-indicator');
  if (indicator) {
    indicator.hidden = !qaEnabled;
    indicator.textContent = `QA · Steering · ${zoom}×`;
  }
}

function selectQaZoom(value) {
  if (!qaEnabled || $('#qa-config').hidden) return;
  stopActiveInput();
  if (!qaZoomState.select(value, { qaEnabled })) return;
  refreshCameraForZoom();
  syncQaZoomControls();
  updateTraceDiagnostics();
  queueQaPersistence();
}

function stopActiveInput() {
  if (activePointerId !== null) clearPointer();
  else {
    stopSteeringFrameLoop();
    if (steeringPointerId !== null) endSteeringGesture(steeringPointerId);
  }
}

function setQaMode(enabled) {
  const previouslyEffectiveZoom = currentCameraZoom();
  const wasEnabled = qaEnabled;
  if (qaEnabled && !enabled) {
    clearTimeout(persistTimer);
    if (traceRecorder && traceSession && qaSessionId) qaStore.save(diagnosticReportObject(), { sessionId: qaSessionId, buildId: APP_BUILD_ID });
  }
  const nextEnabled = Boolean(enabled);
  if (!nextEnabled) stopActiveInput();
  qaEnabled = nextEnabled;
  if (wasEnabled && !nextEnabled) {
    qaZoomState.reset();
    qaCloseViewLayout.reset();
    lastQaMeasuredLayout = null;
    lastQaLayoutMeasurements = null;
    $('#maze-workspace').style.removeProperty('--qa-overview-panel-size');
  }
  if (previouslyEffectiveZoom !== currentCameraZoom()) refreshCameraForZoom();
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
  if (qaEnabled) document.body.dataset.qaCloseViewSize = qaCloseViewLayout.value;
  else delete document.body.dataset.qaCloseViewSize;
  $('#trace-diagnostic-tools').hidden = !qaEnabled;
  $('#trace-diagnostics').hidden = !qaEnabled || !traceSession;
  $('#qa-open-home').hidden = !qaEnabled || $('#home').hidden;
  $('#qa-open-game').hidden = !qaEnabled;
  $('#qa-active-input-mode').textContent = 'Control system: Continuous Steering';
  $('#qa-zoom-controls').hidden = !qaEnabled;
  $('#qa-zoom-magnification').value = String(qaZoomState.value);
  $('#qa-layout-controls').hidden = !qaEnabled;
  $('#qa-close-view-size').value = qaCloseViewLayout.value;
  applyQaOverviewSizing();
  updateQaLayoutStatus();
  syncQaZoomControls();
  if (qaEnabled) refreshQaSessions();
}

function qaLayoutMeasurements() {
  if (!qaEnabled || !preferences.zoomAssist || $('#play').hidden) return null;
  const overview = overviewSvg.getBoundingClientRect();
  const close = $('#maze-paper').getBoundingClientRect();
  if (!overview.width || !close.width) return null;
  let wallBounds = null;
  try { wallBounds = overviewSvg.querySelector('.walls')?.getBBox?.() ?? null; } catch { /* Fall back to the SVG viewport when SVG geometry measurement is unavailable. */ }
  const view = overviewSvg.viewBox.baseVal;
  const mazeScaleX = view.width ? overview.width / view.width : 1;
  const mazeScaleY = view.height ? overview.height / view.height : 1;
  return {
    overviewMaze: wallBounds
      ? { width: Math.round(wallBounds.width * mazeScaleX), height: Math.round(wallBounds.height * mazeScaleY) }
      : { width: Math.round(overview.width), height: Math.round(overview.height) },
    closeViewPanel: { width: Math.round(close.width), height: Math.round(close.height) },
  };
}

function applyQaOverviewSizing() {
  const workspace = $('#maze-workspace');
  if ($('#play').hidden || !preferences.zoomAssist) {
    if (!qaEnabled || !preferences.zoomAssist) workspace.style.removeProperty('--qa-overview-panel-size');
    return;
  }
  const bounds = workspace.getBoundingClientRect();
  const closeHeight = $('#maze-paper').getBoundingClientRect().height;
  if (!bounds.width || !bounds.height || !closeHeight) return;
  lastQaWorkspaceSize = { width: bounds.width, height: bounds.height };
  if (!qaEnabled || qaCloseViewLayout.value === 'current') {
    workspace.style.removeProperty('--qa-overview-panel-size');
  } else {
    const gap = Number.parseFloat(getComputedStyle(workspace).rowGap) || 0;
    const size = calculateQaOverviewSize({
      layout: qaCloseViewLayout.value,
      workspaceWidth: bounds.width,
      workspaceHeight: bounds.height,
      closeViewHeight: closeHeight,
      viewportHeight: window.innerHeight,
      gap,
    });
    if (size > 0) workspace.style.setProperty('--qa-overview-panel-size', `${size}px`);
  }
  if (qaEnabled) {
    const measurements = qaLayoutMeasurements();
    if (measurements) {
      lastQaLayoutMeasurements = measurements;
      lastQaMeasuredLayout = qaCloseViewLayout.value;
    }
  }
}

function updateQaLayoutStatus() {
  const status = $('#qa-close-view-status');
  if (!status || !qaEnabled) return;
  const selected = qaCloseViewLayout.value;
  if (!preferences.zoomAssist) {
    const label = selected === 'extra-compact' ? 'Extra Compact' : selected === 'compact' ? 'Compact' : 'Current';
    status.textContent = `Selected: ${label}. Zoom Assist is off, so split-screen panel sizing is inactive; the full-maze view remains unchanged.`;
    return;
  }
  const measured = qaLayoutMeasurements() ?? (lastQaMeasuredLayout === selected ? lastQaLayoutMeasurements : null);
  if (measured) {
    status.textContent = `Selected: ${selected === 'extra-compact' ? 'Extra Compact' : selected === 'compact' ? 'Compact' : 'Current'} · Close View ${measured.closeViewPanel.width} × ${measured.closeViewPanel.height} CSS px · overview maze ${measured.overviewMaze.width} × ${measured.overviewMaze.height} CSS px. Panel size is independent of magnification; set the separate Zoom Assist comparison to 2.0×.`;
    return;
  }
  const workspaceWidth = lastQaWorkspaceSize?.width ?? window.innerWidth;
  const landscapeBaseDvh = window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches ? 43 : 40;
  const target = getQaCloseViewTargetHeight(selected, window.innerHeight, workspaceWidth, landscapeBaseDvh);
  const overviewSize = lastQaWorkspaceSize ? calculateQaOverviewSize({
    layout: selected,
    workspaceWidth: lastQaWorkspaceSize.width,
    workspaceHeight: lastQaWorkspaceSize.height,
    closeViewHeight: target,
    viewportHeight: window.innerHeight,
    gap: 6,
  }) : null;
  const label = selected === 'extra-compact' ? 'Extra Compact' : selected === 'compact' ? 'Compact' : 'Current';
  const estimate = selected === 'current' ? '' : ` · Close View target about ${Math.round(target)}px${overviewSize ? ` · overview panel up to ${Math.round(overviewSize)}px` : ''}`;
  status.textContent = `Selected: ${label}${estimate}. Panel size is independent of magnification; set the separate Zoom Assist comparison to 2.0×. Ordinary play keeps the Current layout.`;
}

const qaWorkspaceResizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
  applyQaOverviewSizing();
  updateQaLayoutStatus();
});
qaWorkspaceResizeObserver?.observe($('#maze-workspace'));

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
    failureCategory: state.failureCategory,
    traceHealth: state.traceHealth,
    interpolationCount: movement?.interpolatedSamples ?? 0,
    zoomAssist: preferences.zoomAssist,
    zoomFactor: preferences.zoomAssist ? cameraPosition.zoom : 1,
    qaSelectedZoomFactor: qaEnabled ? qaZoomState.value : null,
    qaCloseViewPanelSize: qaEnabled ? qaCloseViewLayout.value : null,
    cameraPosition: preferences.zoomAssist ? { x: Math.round(cameraPosition.x * 100) / 100, y: Math.round(cameraPosition.y * 100) / 100 } : null,
    inputPanel: preferences.zoomAssist ? 'close-view' : 'full-maze',
    attemptedTransitions: movement?.attemptedTransitions ?? [],
    controlSystem: 'continuous-steering',
    activeController: state.active ? 'continuous-steering' : 'idle',
    movementClassification: movement?.movementClassification ?? null,
    requestedMovement: movement?.requestedMovement ?? null,
    acceptedMovement: movement?.acceptedMovement ?? null,
    steeringMetrics: movement?.steeringMetrics ?? null,
    strokeBreakCreated: movement?.strokeBreakCreated ?? false,
    gestureState: state.active ? 'active' : 'idle',
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
    zoomAssist: preferences.zoomAssist,
    zoomFactor: preferences.zoomAssist ? cameraPosition.zoom : 1,
    qaSelectedZoomFactor: qaEnabled ? qaZoomState.value : null,
    qaCloseViewPanelSize: qaEnabled ? qaCloseViewLayout.value : null,
    qaLayoutMeasurements: qaLayoutMeasurements() ?? (lastQaMeasuredLayout === qaCloseViewLayout.value ? lastQaLayoutMeasurements : null),
    cameraPosition: preferences.zoomAssist ? { x: cameraPosition.x, y: cameraPosition.y } : null,
    controlSystem: 'continuous-steering',
    activeController: state?.active ? 'continuous-steering' : 'idle',
    steering: qaEnabled ? { settings: steeringController.settings, ...steeringController.snapshot } : null,
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
  const dimensions = qaLayoutMeasurements() ?? (lastQaMeasuredLayout === qaCloseViewLayout.value ? lastQaLayoutMeasurements : null);
  const measuredLayout = dimensions ? ` · Close View ${dimensions.closeViewPanel.width}×${dimensions.closeViewPanel.height}px · overview ${dimensions.overviewMaze.width}×${dimensions.overviewMaze.height}px` : '';
  output.textContent = `QA trace · build ${APP_BUILD_ID} · control system continuous-steering · active controller ${state.active ? 'continuous-steering' : 'idle'} · zoom ${preferences.zoomAssist ? `${cameraPosition.zoom}× close view (${cameraPosition.x.toFixed(0)},${cameraPosition.y.toFixed(0)})` : 'off'} · QA zoom ${qaZoomState.value}× · panel ${qaCloseViewLayout.value}${measuredLayout} · client px ${point(lastClientPointer)} · raw maze ${point(raw)} · pencil ${point(state.authoritativePosition)} · cell ${state.logicalCell.x},${state.logicalCell.y} · ${state.blocked ? `BLOCKED: ${state.reason ?? 'unspecified'} (${state.failureCategory ?? 'unknown'})` : 'clear'} · health ${state.traceHealth} · reverse ${reversal} · gesture ${state.active ? 'active' : 'idle'} · events ${traceRecorder?.length ?? 0} · maze ${currentLayoutId ?? 'not started'}`;
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

function openQaConfiguration() {
  if (!qaEnabled || !$('#qa-config').hidden || activeOverlay) return;
  const currentScreen = screens.find(screen => !screen.hidden);
  if (!currentScreen || currentScreen === $('#qa-config')) return;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  qaReturnState = captureQaReturnState({
    screenId: currentScreen.id,
    paused,
    timerRunning: Boolean(timerId),
    completed: mazeCompleted,
  });
  qaReturnFocus = opener;
  if (currentScreen === $('#play')) {
    paused = true;
    pauseTimer();
    clearPointer();
    $('#qa-config-return').textContent = '← Return to Game';
    $('#qa-config-notice').textContent = 'Gameplay is suspended while these controls are open. Your maze, pencil position, and ink are preserved.';
  } else {
    $('#qa-config-return').textContent = '← Return to Home';
    $('#qa-config-notice').textContent = 'Review tracing behavior and reports here. Gameplay remains untouched until you return to the game.';
  }
  activeScreen($('#qa-config'));
  updateTraceDiagnostics();
  $('#qa-config-title').focus({ preventScroll: true });
}

function returnFromQaConfiguration() {
  const snapshot = qaReturnState;
  qaReturnState = null;
  const restoreState = restoreQaReturnState(snapshot, { completed: mazeCompleted, documentHidden: document.hidden });
  const targetScreen = $(`#${restoreState.screenId}`);
  activeScreen(targetScreen);
  paused = restoreState.paused;
  if (restoreState.resumeTimer) startTimer();
  if (targetScreen === $('#play')) requestAnimationFrame(() => {
    applyQaOverviewSizing();
    // A square panel keeps the same square 2× viewBox; preserve the camera
    // origin so a layout comparison never moves the authoritative pencil.
    renderTrace();
    lastQaLayoutMeasurements = qaLayoutMeasurements() ?? lastQaLayoutMeasurements;
    updateQaLayoutStatus();
    updateTraceDiagnostics();
    queueQaPersistence();
  });
  const opener = qaReturnFocus;
  qaReturnFocus = null;
  const focusTarget = opener?.isConnected && !opener.closest('[hidden]')
    ? opener
    : targetScreen === $('#play') ? $('#pause-game') : $('#quick-play');
  focusTarget?.focus({ preventScroll: true });
}
function displayTime() { $('#timer').value = formatTime(elapsed); }
function startTimer() {
  if (mazeCompleted || timerId || $('#play').hidden || document.hidden || paused || activeOverlay) return;
  startedAt = Date.now() - elapsed;
  timerId = setInterval(() => { elapsed = Date.now() - startedAt; displayTime(); }, 200);
}
function pauseTimer() {
  if (!timerId) return;
  clearInterval(timerId); timerId = undefined;
  elapsed = Date.now() - startedAt; displayTime();
}

function pointAt(event, screenToSvg = null) {
  const client = { x: event.clientX, y: event.clientY };
  if (screenToSvg) return transformPoint(client, screenToSvg);
  try {
    const screenToSvg = svg.getScreenCTM()?.inverse();
    if (screenToSvg) return transformPoint(client, screenToSvg);
  } catch { /* Fall back for older or incomplete embedded SVG implementations. */ }
  return clientToViewBoxPoint(client, svg.getBoundingClientRect(), { x: 0, y: 0, width: SIZE, height: SIZE });
}
function pointInMaze(event, screenToSvg = null) { return svgToMazePoint(pointAt(event, screenToSvg), gridGeometry.x, gridGeometry.cellSize, gridGeometry.y); }
function svgPoint(point) { return mazeToSvgPoint(point, gridGeometry.x, gridGeometry.cellSize, gridGeometry.y); }

function renderTrace() {
  if (!traceSession) return;
  const points = traceSession.stroke.map(svgPoint);
  const path = tracePathData(points, traceSession.strokeBreaks);
  $('#trail').setAttribute('d', path);
  $('#overview-trail').setAttribute('d', path);
  const endpoint = svgPoint(traceSession.position);
  $('#player').setAttribute('cx', endpoint.x);
  $('#player').setAttribute('cy', endpoint.y);
  $('#overview-player').setAttribute('cx', endpoint.x);
  $('#overview-player').setAttribute('cy', endpoint.y);
  svg.dataset.visited = String(new Set(traceSession.path.map(point => `${point.x},${point.y}`)).size);
  // Steering remains screen-space while the camera follows the accepted pencil.
  if (preferences.zoomAssist && (activePointerId === null || steeringPointerId !== null)) cameraPosition = mazeCamera.follow(endpoint);
  svg.setAttribute('viewBox', preferences.zoomAssist ? cameraPosition.viewBox : `0 0 ${SIZE} ${SIZE}`);
}

function renderMaze() {
  gridGeometry = getMazeGridGeometry(maze.width, maze.height, SIZE, PAD);
  mazeCamera = createMazeCamera({ viewSize: SIZE, zoom: currentCameraZoom() });
  const startPoint = svgPoint(maze.start);
  cameraPosition = mazeCamera.center(startPoint);
  $('#zoom-factor-label').textContent = `· ${cameraPosition.zoom}×`;
  const ns = 'http://www.w3.org/2000/svg';
  const create = (tag, attributes, text) => {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text) element.textContent = text;
    return element;
  };
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
  for (const [target, overview] of [[svg, false], [overviewSvg, true]]) {
    target.replaceChildren();
    const trailId = overview ? 'overview-trail' : 'trail';
    const playerId = overview ? 'overview-player' : 'player';
    target.append(create('path', { id: trailId, class: 'trail', fill: 'none', d: '' }));
    const walls = create('g', { class: 'walls', 'aria-hidden': 'true' });
    const line = (x1, y1, x2, y2) => walls.append(create('line', { x1, y1, x2, y2, class: 'wall' }));
    for (const segment of getWallSegments(maze)) {
      const x0 = gridGeometry.x + segment.x * gridGeometry.cellSize, y0 = gridGeometry.y + segment.y * gridGeometry.cellSize;
      if (segment.orientation === 'horizontal') line(x0, y0, x0 + gridGeometry.cellSize, y0);
      else line(x0, y0, x0, y0 + gridGeometry.cellSize);
    }
    target.append(walls);
    target.append(marker(startMarker, 'marker-start', 'START'));
    target.append(marker(endMarker, 'marker-end', '✿'));
    target.append(create('circle', { id: playerId, cx: start.x, cy: start.y, r: gridGeometry.cellSize * .19, class: 'player' }));
  }
  overviewSvg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  renderTrace();
}

function setTheme() { document.body.dataset.paperTheme = preferences.paperTheme; }
function updateSettingsControls() {
  $('#sound-effects').checked = preferences.soundEffects;
  $('#paper-theme').value = preferences.paperTheme;
  $('#visual-theme').value = preferences.themePreference;
  $('#zoom-assist').checked = preferences.zoomAssist;
  setTheme();
}
function savePreferences(update) {
  const zoomChanged = Object.hasOwn(update, 'zoomAssist') && preferences.zoomAssist !== update.zoomAssist;
  if (zoomChanged && activePointerId !== null) clearPointer();
  preferences = writePreferences({ ...preferences, ...update });
  updateSettingsControls();
  if (zoomChanged) {
    document.body.dataset.zoomAssist = String(preferences.zoomAssist);
    if (mazeCompleted) $('#maze-paper').hidden = preferences.zoomAssist;
    if (preferences.zoomAssist && traceSession) cameraPosition = mazeCamera.center(svgPoint(traceSession.position));
    if (!mazeCompleted && !$('#play').hidden) $('#play-hint').textContent = `Touch ${preferences.zoomAssist ? 'the Close View' : 'the maze'} to set a steering origin. Move away to guide the pencil; return to center or lift to stop.`;
    if (traceSession) renderTrace();
    updateTraceDiagnostics();
    queueQaPersistence();
  }
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
  if (activePointerId !== null) clearPointer();
  if (!reuse || !maze) maze = createMazeForDifficulty(selectedDifficulty);
  mazeCompleted = false;
  delete document.body.dataset.completed;
  $('#completion-panel').hidden = true;
  $('#maze-paper').hidden = false;
  selectedDifficulty = maze.difficulty ?? selectedDifficulty;
  $('#play-difficulty').textContent = FREE_PLAY_DIFFICULTIES[selectedDifficulty].label.toUpperCase();
  currentLayoutId = mazeLayoutId(maze);
  traceSession = createTraceSession(maze);
  activePointerId = null; elapsed = 0; paused = false; displayTime();
  $('#play-hint').textContent = `Touch ${preferences.zoomAssist ? 'the Close View' : 'the maze'} to set a steering origin. Move away to guide the pencil; return to center or lift to stop.`;
  renderMaze(); activeScreen($('#play')); syncQaControls(); updateTraceDiagnostics(); queueQaPersistence(); $('#play-title').focus({ preventScroll: true }); startTimer();
}

function updateSteeringIndicator(point) {
  const indicator = $('#steering-indicator');
  if (!qaEnabled || !point || !steeringController.active) {
    indicator.hidden = true;
    return;
  }
  const rect = indicator.getBoundingClientRect(), state = steeringController.snapshot;
  if (!state.origin || !state.finger) { indicator.hidden = true; return; }
  const originX = state.origin.x - rect.left, originY = state.origin.y - rect.top;
  const fingerX = state.finger.x - rect.left, fingerY = state.finger.y - rect.top;
  const dx = fingerX - originX, dy = fingerY - originY;
  indicator.style.setProperty('--origin-x', `${originX}px`);
  indicator.style.setProperty('--origin-y', `${originY}px`);
  indicator.style.setProperty('--finger-x', `${fingerX}px`);
  indicator.style.setProperty('--finger-y', `${fingerY}px`);
  indicator.style.setProperty('--vector-length', `${Math.hypot(dx, dy)}px`);
  indicator.style.setProperty('--vector-angle', `${Math.atan2(dy, dx)}rad`);
  indicator.hidden = false;
}

function stopSteeringFrameLoop() {
  if (steeringFrameId !== null) cancelAnimationFrame(steeringFrameId);
  steeringFrameId = null;
}

function endSteeringGesture(id) {
  stopSteeringFrameLoop();
  steeringController.end(id);
  if (steeringPointerId === id) steeringPointerId = null;
  steeringHadBlock = false;
  lastSteeringBlockReason = null;
  $('#steering-indicator').hidden = true;
}

function recordSteeringEvent(eventType, movement, reason = null) {
  const finger = steeringController.snapshot.finger;
  const event = { pointerId: steeringPointerId, pointerType: 'touch', clientX: finger?.x, clientY: finger?.y };
  recordTraceEvent(eventType, event, traceSession.position, Boolean(movement?.moved), reason, false, movement, 'steering-frame');
}

function scheduleSteeringFrameLoop(id) {
  if (steeringFrameId !== null) return;
  const frame = timestamp => {
    steeringFrameId = null;
    if (id !== steeringPointerId || activePointerId !== id
      || $('#play').hidden || paused || activeOverlay || document.hidden || mazeCompleted) {
      if (id === steeringPointerId && activePointerId === id) clearPointer();
      return;
    }
    const delta = steeringController.advance(id, timestamp);
    if (delta.active) {
      const positionBefore = traceSession.position;
      const movement = traceSession.steer(id, delta);
      movement.requestedMovement = { x: delta.x, y: delta.y };
      movement.acceptedMovement = { x: movement.position.x - positionBefore.x, y: movement.position.y - positionBefore.y };
      const steeringState = steeringController.snapshot;
      const fingerDisplacementPixels = steeringState.origin && steeringState.finger
        ? Math.hypot(steeringState.finger.x - steeringState.origin.x, steeringState.finger.y - steeringState.origin.y) : 0;
      movement.steeringMetrics = {
        fingerDisplacementPixels,
        speedDemand: delta.speed / steeringController.settings.maxSpeedMazeUnitsPerSecond,
        requestedSpeed: delta.speed,
        acceptedSpeed: delta.frameSeconds > 0
          ? Math.hypot(movement.acceptedMovement.x, movement.acceptedMovement.y) / delta.frameSeconds : 0,
      };
      movement.movementClassification = movement.wallCollision ? 'closed-wall-collision'
        : movement.blocked && movement.attemptedTransitions?.some(transition => transition.open) ? 'open-edge-transition-rejected'
          : movement.blocked ? 'movement-rejected'
            : !movement.moved ? 'steering-no-progress' : 'accepted';
      if (movement.moved) renderTrace();
      if (movement.blocked) {
        if (!steeringHadBlock || movement.reason !== lastSteeringBlockReason) recordSteeringEvent('steering-blocked', movement, movement.reason);
        steeringHadBlock = true;
        lastSteeringBlockReason = movement.reason;
      } else if (steeringHadBlock && movement.moved) {
        recordSteeringEvent('steering-recovered', movement);
        steeringHadBlock = false;
        lastSteeringBlockReason = null;
      } else if (!movement.moved && !movement.blocked) {
        // A sustained nonzero steering vector that produces no legal movement
        // is useful evidence (for example, a pencil stalled before an open
        // edge) but recording every animation frame would bloat QA reports.
        if (!steeringHadBlock) recordSteeringEvent('steering-no-progress', movement, 'steering-no-progress');
        steeringHadBlock = true;
        lastSteeringBlockReason = 'steering-no-progress';
      }
      if (movement.complete) {
        recordSteeringEvent('steering-completed', movement);
        endSteeringGesture(id);
        traceSession.end(id);
        activePointerId = null;
        try { if (svg.hasPointerCapture?.(id)) svg.releasePointerCapture(id); } catch { /* Capture may already have been released. */ }
        completeMaze();
        return;
      }
    }
    steeringFrameId = requestAnimationFrame(frame);
  };
  steeringFrameId = requestAnimationFrame(frame);
}

function clearPointer() {
  if (activePointerId === null) return;
  const id = activePointerId;
  recordTraceEvent('gesture-canceled-by-app', {
    pointerId: id, pointerType: 'unknown', clientX: lastClientPointer?.x, clientY: lastClientPointer?.y,
  }, lastRawPointer, false, 'application-interruption', true);
  if (steeringPointerId === id) endSteeringGesture(id);
  traceSession?.cancel(id); activePointerId = null;
  try { if (svg.hasPointerCapture?.(id)) svg.releasePointerCapture(id); } catch { /* Capture may already be gone. */ }
  renderTrace();
  updateTraceDiagnostics();
}
function finishPointer(event, cancel = false) {
  if (activePointerId !== event.pointerId) return;
  lastClientPointer = { x: event.clientX, y: event.clientY };
  lastRawPointer = pointInMaze(event);
  recordTraceEvent(event.type ?? (cancel ? 'pointercancel' : 'pointerup'), event, lastRawPointer, true, null, cancel);
  endSteeringGesture(event.pointerId);
  if (cancel) traceSession.cancel(event.pointerId);
  else traceSession.end(event.pointerId);
  activePointerId = null;
  renderTrace();
  try { if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId); } catch { /* Capture may already be released by the browser. */ }
  updateTraceDiagnostics();
  return false;
}
function completeMaze() {
  if (mazeCompleted) return;
  mazeCompleted = true;
  pauseTimer(); displayTime();
  document.body.dataset.completed = 'true';
  $('#maze-paper').hidden = preferences.zoomAssist;
  $('#completion-panel').hidden = false;
  $('#play-hint').textContent = preferences.zoomAssist
    ? 'Your finished route stays visible in the map above.'
    : 'Your finished drawing stays here on the paper.';
  $('#completion-title').focus({ preventScroll: true });
  playCompletionSound();
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
  if (mazeCompleted) { recordTraceEvent('pointerdown', event, lastRawPointer, false, 'attempt-already-completed'); return; }
  if (paused || activeOverlay) { recordTraceEvent('pointerdown', event, lastRawPointer, false, 'game-not-interactive'); return; }
  if (!event.isPrimary) { recordTraceEvent('pointerdown', event, lastRawPointer, false, 'non-primary-pointer'); return; }
  if (activePointerId !== null) { recordTraceEvent('pointerdown', event, lastRawPointer, false, 'another-pointer-owns-gesture'); return; }
  let began = traceSession.beginSteering(event.pointerId);
  if (began) {
    began = steeringController.begin(event.pointerId, { x: event.clientX, y: event.clientY });
    if (began) {
      steeringPointerId = event.pointerId;
      steeringHadBlock = false;
      lastSteeringBlockReason = null;
    } else traceSession.cancel(event.pointerId);
  }
  if (began) {
    activePointerId = event.pointerId;
    updateSteeringIndicator({ x: event.clientX, y: event.clientY });
    scheduleSteeringFrameLoop(event.pointerId);
    try { svg.setPointerCapture(event.pointerId); } catch { /* Older embedded WebViews may lack pointer capture. */ }
    updateTraceDiagnostics(lastRawPointer);
  }
  recordTraceEvent('pointerdown', event, lastRawPointer, began, began ? null : traceSession.diagnostics.reason);
});
window.addEventListener('pointermove', event => {
  if (mazeCompleted || activePointerId !== event.pointerId || $('#play').hidden || paused) return;
  event.preventDefault();
  if (steeringPointerId !== event.pointerId) return;
  for (const sample of pointerMovementSamples(event)) {
    lastClientPointer = { x: sample.clientX, y: sample.clientY };
    lastRawPointer = pointInMaze(sample);
    steeringController.update(event.pointerId, { x: sample.clientX, y: sample.clientY });
  }
  updateSteeringIndicator(lastClientPointer);
  updateTraceDiagnostics(lastRawPointer);
});
// A rotation can change the SVG's screen transform between pointer samples.
// End that gesture safely; the next touch resumes from the accepted endpoint.
window.addEventListener('resize', clearPointer);
svg.addEventListener('keydown', event => {
  const direction = { ArrowUp: { x: 0, y: -1 }, ArrowRight: { x: 1, y: 0 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 } }[event.key];
  if (!direction || mazeCompleted || $('#play').hidden || paused || activeOverlay) return;
  event.preventDefault();
  const result = traceSession.step(direction);
  if (result.moved) renderTrace();
  if (result.complete) completeMaze();
});
window.addEventListener('pointerup', event => { if (finishPointer(event)) completeMaze(); });
window.addEventListener('pointercancel', event => finishPointer(event, true));
window.addEventListener('lostpointercapture', event => finishPointer(event, true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pauseTimer(); if (steeringPointerId !== null) clearPointer(); }
  else startTimer();
});
window.addEventListener('blur', () => { pauseTimer(); if (steeringPointerId !== null) clearPointer(); });
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
$('#restart-maze').addEventListener('click', () => makeMaze(true));
$('#back-home').addEventListener('click', () => { clearPointer(); showDifficultySelection(); });
$('#brand-home').addEventListener('click', event => { event.preventDefault(); $('#play').hidden ? showHome() : openHomeConfirmation(); });
$('#pause-game').addEventListener('click', () => openOverlay($('#pause-dialog'), { pause: true }));
$('#qa-open-home').addEventListener('click', openQaConfiguration);
$('#qa-open-game').addEventListener('click', openQaConfiguration);
$('#qa-config-return').addEventListener('click', returnFromQaConfiguration);
$('#qa-zoom-magnification').addEventListener('change', event => selectQaZoom(Number(event.currentTarget.value)));
$('#qa-close-view-size').addEventListener('change', event => {
  if (!qaEnabled || $('#qa-config').hidden) return;
  stopActiveInput();
  if (!qaCloseViewLayout.select(event.currentTarget.value, { qaEnabled })) return;
  document.body.dataset.qaCloseViewSize = qaCloseViewLayout.value;
  applyQaOverviewSizing();
  updateQaLayoutStatus();
  renderTrace();
  updateTraceDiagnostics();
  queueQaPersistence();
});
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
$('#zoom-assist').addEventListener('change', event => savePreferences({ zoomAssist: event.currentTarget.checked }));
$('#paper-theme').addEventListener('change', event => savePreferences({ paperTheme: event.currentTarget.value }));
$('#visual-theme').addEventListener('change', event => saveThemePreference(event.currentTarget.value));
$('#reset-settings').addEventListener('click', () => openOverlay($('#reset-dialog')));
$('#cancel-reset').addEventListener('click', () => closeOverlay());
$('#confirm-reset').addEventListener('click', () => {
  preferences = writePreferences({ ...DEFAULT_PREFERENCES }, deviceStorage);
  activeVisualTheme = chooseLaunchTheme('auto', activeVisualTheme, Math.random, canPersistPreferences);
  preferences = writePreferences({ ...preferences, lastAutoTheme: activeVisualTheme }, deviceStorage);
  applyVisualTheme(document, activeVisualTheme);
  updateSettingsControls(); syncQaControls(); updateTraceDiagnostics(); closeOverlay();
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
$('#disable-qa-mode').addEventListener('click', () => { setQaMode(false); returnFromQaConfiguration(); });
bindEmblemQaTrigger($('#qa-logo-trigger'), () => {
  setQaMode(true);
  openQaConfiguration();
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
