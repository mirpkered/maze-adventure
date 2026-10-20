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
    : dimensions?.width === 10 && dimensions?.height === 10 ? 'medium' : 'custom');
  const start = report.maze?.start, finish = report.maze?.finish;
  const endpointSummary = start && finish
    ? `start ${start.cell?.x ?? '?'},${start.cell?.y ?? '?'} ${start.edge ?? '?'} → finish ${finish.cell?.x ?? '?'},${finish.cell?.y ?? '?'} ${finish.edge ?? '?'} | solution ${report.maze?.shortestSolutionLength ?? '?'} steps`
    : null;
  const selectedMode = report.selectedInputMode ?? report.inputMode ?? 'unknown (legacy report)';
  const activeController = report.activeController ?? current?.gestureInputMode ?? 'idle';
  const steeringSummary = `${selectedMode === 'continuous-steering' ? 'selected Continuous Steering' : selectedMode === 'direct-touch' ? 'selected Direct Touch' : `selected ${selectedMode}`} | gesture controller ${activeController}`;
  const steeringMetrics = selectedMode === 'continuous-steering' && report.steering
    ? `steering dead-zone ${report.steering.settings?.deadZonePixels ?? '?'}px, curve x^${report.steering.settings?.speedResponseExponent ?? '?'}, max ${report.steering.settings?.maxSpeedMazeUnitsPerSecond ?? '?'} cells/s | last gesture frames ${report.steering.activeFrames ?? 0}/${report.steering.frames ?? 0}, capped ${report.steering.clampedFrames ?? 0}` : null;
  return [
    `Maze Adventure QA ${report.buildId ?? 'build unknown'} | ${report.maze?.layoutId ?? 'maze unknown'}`,
    `${dimensions?.width ?? '?'}x${dimensions?.height ?? '?'} ${difficulty} | ${(durationMs / 1000).toFixed(1)}s | events ${observed}, accepted ${accepted}, rejected ${Object.values(rejectedByReason).reduce((a, b) => a + b, 0)} (${counts}), canceled ${canceled}`,
    ...(endpointSummary ? [endpointSummary] : []),
    steeringSummary,
    ...(steeringMetrics ? [steeringMetrics] : []),
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
      inputMode: event.selectedInputMode ?? null, activeController: event.activeController ?? null,
      raw: event.maze, pencil: event.pencilPosition, cell: event.cell,
      requestedMovement: event.requestedMovement ?? null, acceptedMovement: event.acceptedMovement ?? null,
      classification: event.movementClassification ?? null, accepted: event.accepted,
      movementAccepted: Boolean(event.movementAccepted), reason: event.rejectedReason,
      transitions: event.attemptedTransitions ?? [], state: event.gestureState,
      captured: event.pointerCaptured, canceled: event.pointerCanceled })),
  };
}
