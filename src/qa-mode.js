export const QA_STORAGE_KEY = 'mirpworks.mazeAdventure.qaMode';
export const QA_LOGO_HOLD_MS = 3000;
export const QA_LOGO_MOVE_LIMIT = 12;

export function isQaRequested(search = '') {
  return new URLSearchParams(search).get('qa') === '1';
}

export function readQaPreference(storage) {
  try { return storage?.getItem(QA_STORAGE_KEY) === 'enabled'; }
  catch { return false; }
}

export function isQaEnabledOnStartup(search, storage) {
  return isQaRequested(search) || readQaPreference(storage);
}

export function writeQaPreference(storage, enabled) {
  try {
    if (enabled) storage?.setItem(QA_STORAGE_KEY, 'enabled');
    else storage?.removeItem(QA_STORAGE_KEY);
    return Boolean(storage);
  } catch { return false; }
}

export function bindEmblemQaTrigger(target, activate, {
  holdMs = QA_LOGO_HOLD_MS,
  moveLimit = QA_LOGO_MOVE_LIMIT,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let timer = null;
  let origin = null;
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    origin = null;
  };
  const down = event => {
    cancel();
    if (event.button !== 0) return;
    origin = { x: event.clientX, y: event.clientY };
    timer = setTimer(() => { cancel(); activate(); }, holdMs);
  };
  const move = event => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > moveLimit) cancel();
  };
  const keydown = event => {
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); cancel(); activate(); }
  };
  const contextmenu = event => event.preventDefault();
  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', cancel);
  target.addEventListener('pointercancel', cancel);
  target.addEventListener('pointerleave', cancel);
  target.addEventListener('blur', cancel);
  target.addEventListener('keydown', keydown);
  target.addEventListener('contextmenu', contextmenu);
  return () => {
    cancel();
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', cancel);
    target.removeEventListener('pointercancel', cancel);
    target.removeEventListener('pointerleave', cancel);
    target.removeEventListener('blur', cancel);
    target.removeEventListener('keydown', keydown);
    target.removeEventListener('contextmenu', contextmenu);
  };
}
