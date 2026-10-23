export const QA_DIAGNOSTICS_STORAGE_KEY = 'maze-adventure-qa-diagnostics-v1';
export const QA_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const QA_SESSION_LIMIT = 6;
export const QA_SESSION_MAX_BYTES = 180_000;

const bytes = value => JSON.stringify(value).length * 2;

/** Small, bounded local retention. This store is called only while QA is opted in. */
export function createQaDiagnosticsStore(storage, { now = () => Date.now() } = {}) {
  let available = Boolean(storage);
  function read() {
    if (!available) return [];
    try {
      const parsed = JSON.parse(storage.getItem(QA_DIAGNOSTICS_STORAGE_KEY) ?? '[]');
      if (!Array.isArray(parsed)) return [];
      const cutoff = now() - QA_SESSION_TTL_MS;
      const valid = parsed.filter(item => item && typeof item === 'object' && Number.isFinite(item.savedAt) && item.savedAt >= cutoff);
      if (valid.length !== parsed.length) write(valid);
      return valid.sort((a, b) => b.savedAt - a.savedAt).slice(0, QA_SESSION_LIMIT);
    } catch { available = false; return []; }
  }
  function write(sessions) {
    if (!available) return false;
    try { storage.setItem(QA_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(sessions)); return true; }
    catch { available = false; return false; }
  }
  return {
    list: read,
    get available() { read(); return available; },
    save(report, { sessionId, buildId } = {}) {
      if (!available) return false;
      // Keep a useful replay-sized snapshot under a strict bound. The on-demand
      // full export is generated from live state and is not truncated here.
      const snapshot = JSON.parse(JSON.stringify(report));
      snapshot.retention = { truncated: false, maxBytes: QA_SESSION_MAX_BYTES };
      while (bytes(snapshot) > QA_SESSION_MAX_BYTES && snapshot.events?.length > 24) snapshot.events.shift(), snapshot.retention.truncated = true;
      while (bytes(snapshot) > QA_SESSION_MAX_BYTES && snapshot.checkpoints?.length > 4) snapshot.checkpoints.shift(), snapshot.retention.truncated = true;
      while (bytes(snapshot) > QA_SESSION_MAX_BYTES && snapshot.current?.ink?.length > 200) {
        snapshot.current.ink = snapshot.current.ink.filter((_, index) => index % 2 === 0);
        snapshot.current.inkCellAssociation = snapshot.current.inkCellAssociation?.filter((_, index) => index % 2 === 0);
        snapshot.retention.truncated = true;
      }
      if (bytes(snapshot) > QA_SESSION_MAX_BYTES) return false;
      const sessions = read().filter(item => item.sessionId !== sessionId);
      sessions.unshift({ sessionId, buildId, savedAt: now(), report: snapshot });
      return write(sessions.slice(0, QA_SESSION_LIMIT));
    },
    clear() { return write([]); },
  };
}

export function createQuickSummary(report, { observed = 0, accepted = 0, rejectedByReason = {}, canceled = 0, durationMs = 0 } = {}) {
  const current = report.current?.state;
  const meaningfulReject = event => !event.accepted && event.rejectedReason && event.rejectedReason !== 'no-route-or-stroke-change';
  const latestReject = [...(report.events ?? [])].reverse().find(meaningfulReject);
  const acceptedAfterReject = latestReject && (report.events ?? []).some(event => event.t > latestReject.t && event.movementAccepted);
  const status = !latestReject ? 'INSUFFICIENT EVIDENCE' : acceptedAfterReject ? 'RECOVERED AFTER LAST REJECTION' : 'RECOVERY NOT YET OBSERVED';
  const counts = Object.entries(rejectedByReason).map(([reason, count]) => `${reason}:${count}`).join(', ') || 'none';
  const dimensions = report.maze?.dimensions;
  const difficulty = report.maze?.difficulty ?? (dimensions?.width === 7 && dimensions?.height === 7 ? 'easy'
    : dimensions?.width === 10 && dimensions?.height === 10 ? 'medium'
      : dimensions?.width === 15 && dimensions?.height === 15 ? 'hard'
        : dimensions?.width === 20 && dimensions?.height === 20 ? 'expert' : 'custom');
  const start = report.maze?.start, finish = report.maze?.finish;
  const endpointSummary = start && finish
    ? `start ${start.cell?.x ?? '?'},${start.cell?.y ?? '?'} ${start.edge ?? '?'} → finish ${finish.cell?.x ?? '?'},${finish.cell?.y ?? '?'} ${finish.edge ?? '?'} | solution ${report.maze?.shortestSolutionLength ?? '?'} steps`
    : null;
  const traceState = report.current?.state;
  const exitProgress = finish && typeof traceState?.completionCommitted === 'boolean'
    ? `exit ${finish.edge ?? '?'} · ${traceState.completionCommitted ? 'crossed and complete'
      : traceState.currentlyInExitCell ? 'inside exit cell; still tracing'
        : traceState.exitCellEntered ? 'exit cell visited; not complete' : 'not reached'} · invalid perimeter attempts ${traceState.invalidPerimeterAttempts ?? 0}`
    : null;
  const generation = report.maze ? `exit degree ${report.maze.exitInternalDegree ?? '?'} · gated cells ${report.maze.exitGatedCells ?? '?'} · attempts ${report.maze.generationAttempts ?? '?'} · generation ${report.maze.generationDurationMs ?? '?'}ms${report.maze.generationQuality ? ` · route junctions ${report.maze.generationQuality.solutionRouteJunctions} · optional branches ${report.maze.generationQuality.optionalBranchCount} · largest branch ${report.maze.generationQuality.largestOptionalBranch}` : ''}` : null;
  const historicalMode = report.selectedInputMode ?? report.inputMode;
  const activeController = report.activeController ?? current?.gestureInputMode ?? (report.controlSystem === 'continuous-steering' ? 'continuous-steering' : 'idle');
  const steeringSummary = report.controlSystem
    ? `control system ${report.controlSystem} | active controller ${activeController}`
    : `${historicalMode === 'continuous-steering' ? 'selected Continuous Steering' : historicalMode === 'direct-touch' ? 'selected Direct Touch' : `selected ${historicalMode ?? 'unknown (legacy report)'}`} | gesture controller ${activeController}`;
  const inputSurfaceSummary = report.inputPanel ? `input surface ${report.inputPanel}` : null;
  const steeringMetrics = (report.controlSystem === 'continuous-steering' || historicalMode === 'continuous-steering') && report.steering
    ? `steering ${report.steering.difficulty ?? difficulty} · deflection ${((report.steering.normalizedDeflection ?? 0) * 100).toFixed(0)}% · dead-zone ${report.steering.settings?.deadZonePixels ?? '?'}px · curve x^${report.steering.settings?.speedResponseExponent ?? '?'} · max ${report.steering.maxSpeedMazeUnitsPerSecond ?? report.steering.settings?.maxSpeedMazeUnitsPerSecond ?? '?'} cells/s | last gesture frames ${report.steering.activeFrames ?? 0}/${report.steering.frames ?? 0}, capped ${report.steering.clampedFrames ?? 0}` : null;
  const latestSteering = [...(report.events ?? [])].reverse().find(event => event.steeringMetrics);
  const steeringMovement = latestSteering?.steeringMetrics;
  const movementSummary = steeringMovement
    ? `last steering request ${latestSteering.requestedMovement?.x?.toFixed?.(3) ?? '?'} ${latestSteering.requestedMovement?.y?.toFixed?.(3) ?? '?'} · accepted ${latestSteering.acceptedMovement?.x?.toFixed?.(3) ?? '?'} ${latestSteering.acceptedMovement?.y?.toFixed?.(3) ?? '?'} · ${latestSteering.movementClassification ?? latestSteering.rejectedReason ?? 'unknown'}` : null;
  const layout = report.layout;
  const reach = layout?.steeringTouchArea;
  const centerReachComplete = reach && ['up', 'down', 'left', 'right', 'diagonal'].every(direction => reach.center.thresholdReachable[direction]);
  const layoutSummary = layout?.viewport && layout.mazeSvg
    ? `layout ${layout.viewport.width}x${layout.viewport.height} · maze ${layout.mazeSvg.width.toFixed(1)}x${layout.mazeSvg.height.toFixed(1)} at ${layout.mazeSvg.x.toFixed(1)},${layout.mazeSvg.y.toFixed(1)} · pad ${layout.steeringPad?.width.toFixed(1) ?? '?'}x${layout.steeringPad?.height.toFixed(1) ?? '?'}px · usable ${reach ? `${reach.width.toFixed(1)}x${reach.height.toFixed(1)}px` : '?'} · center reach U/D/L/R/diag ${reach ? [reach.center.up, reach.center.down, reach.center.left, reach.center.right, reach.center.diagonal].map(value => value.toFixed(1)).join('/') : '?'}px (76px ${reach ? centerReachComplete ? 'reachable' : 'limited' : 'unknown'}) · completion ${layout.completionPanel?.height.toFixed(1) ?? '?'}px${layout.completionCheck?.stable === null ? '' : ` · geometry ${layout.completionCheck.stable ? 'stable' : 'changed'} (${layout.completionCheck.maxDeltaPx?.toFixed(3) ?? '?'}px)`}` : null;
  return [
    `Maze Adventure QA ${report.buildId ?? 'build unknown'} | ${report.maze?.layoutId ?? 'maze unknown'}`,
    `${dimensions?.width ?? '?'}x${dimensions?.height ?? '?'} ${difficulty} | ${(durationMs / 1000).toFixed(1)}s | events ${observed}, accepted ${accepted}, rejected ${Object.values(rejectedByReason).reduce((a, b) => a + b, 0)} (${counts}), canceled ${canceled}`,
    ...(endpointSummary ? [endpointSummary] : []),
    ...(exitProgress ? [exitProgress] : []),
    ...(generation ? [generation] : []),
    steeringSummary,
    ...(inputSurfaceSummary ? [inputSurfaceSummary] : []),
    ...(steeringMetrics ? [steeringMetrics] : []),
    ...(movementSummary ? [movementSummary] : []),
    ...(layoutSummary ? [layoutSummary] : []),
    `pencil ${current?.authoritativePosition?.x?.toFixed?.(3) ?? '?'} ${current?.authoritativePosition?.y?.toFixed?.(3) ?? '?'} | cell ${current?.logicalCell?.x ?? '?'},${current?.logicalCell?.y ?? '?'} | gesture ${current?.active ? current.recovering ? 'recovering' : 'active' : 'idle'}`,
    `last rejection ${latestReject?.rejectedReason ?? 'none'} | ${status}`,
  ].join('\n').slice(0, 1900);
}

export function createRecentIncident(report, windowSize = 8) {
  const events = report.events ?? [];
  const index = events.findLastIndex(event => !event.accepted && event.rejectedReason && event.rejectedReason !== 'no-route-or-stroke-change');
  if (index < 0) return { format: 'maze-adventure-incident-v1', note: 'No rejected movement is recorded in the current event window.', layoutId: report.maze?.layoutId, buildId: report.buildId, events: [] };
  const from = Math.max(0, index - windowSize), to = Math.min(events.length, index + windowSize + 1);
  return {
    format: 'maze-adventure-incident-v1', buildId: report.buildId,
    layoutId: report.maze?.layoutId, rejectionIndex: index - from,
    recoveryObserved: events.slice(index + 1).some(event => event.movementAccepted),
    events: events.slice(from, to).map(event => ({ t: event.t, type: event.eventType, sample: event.sampleType,
      ...((event.selectedInputMode ?? event.inputMode) ? { inputMode: event.selectedInputMode ?? event.inputMode } : {}),
      controlSystem: event.controlSystem ?? null, activeController: event.activeController ?? null,
      inputPanel: event.inputPanel ?? null,
      raw: event.maze, pencil: event.pencilPosition, cell: event.cell,
      requestedMovement: event.requestedMovement ?? null, acceptedMovement: event.acceptedMovement ?? null,
      classification: event.movementClassification ?? null, accepted: event.accepted,
      movementAccepted: Boolean(event.movementAccepted), reason: event.rejectedReason,
      transitions: event.attemptedTransitions ?? [], state: event.gestureState,
      captured: event.pointerCaptured, canceled: event.pointerCanceled })),
  };
}
