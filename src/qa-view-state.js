export function captureQaReturnState({ screenId, paused = false, timerRunning = false, completed = false }) {
  return {
    screenId,
    wasPaused: Boolean(paused || completed),
    timerWasRunning: Boolean(screenId === 'play' && timerRunning && !completed),
  };
}

export function restoreQaReturnState(snapshot, { completed = false, documentHidden = false } = {}) {
  if (!snapshot) return { screenId: 'home', paused: false, resumeTimer: false };
  const isPlay = snapshot.screenId === 'play';
  const paused = isPlay && Boolean(snapshot.wasPaused || completed);
  return {
    screenId: snapshot.screenId,
    paused,
    resumeTimer: Boolean(isPlay && !paused && snapshot.timerWasRunning && !documentHidden),
  };
}
