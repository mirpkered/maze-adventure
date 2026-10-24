export const QA_STORAGE_KEY = 'mirpworks.mazeAdventure.qaMode';
export const QA_SESSION_KEY = 'mirpworks.mazeAdventure.qaSession';
const RETIRED_QA_INPUT_MODE_KEY = 'maze-adventure-qa-input-mode-v1';
export const QA_LOGO_HOLD_MS = 3000;
export const QA_LOGO_MOVE_LIMIT = 12;

export function isQaRequested(search = '') {
  return new URLSearchParams(search).get('qa') === '1';
}

function removeQaQuery(location, history) {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('qa')) return;
    url.searchParams.delete('qa');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch { /* URL cleanup must not prevent the game from starting. */ }
}

function clearLegacyQaPreference(storage) {
  try {
    storage?.removeItem(QA_STORAGE_KEY);
    storage?.removeItem(RETIRED_QA_INPUT_MODE_KEY);
  }
  catch { /* Storage can be unavailable in private or embedded contexts. */ }
}

export function startQaSession(location, history, storage, sessionStorage = null) {
  clearLegacyQaPreference(storage);
  const requested = isQaRequested(location.search);
  let enabled = requested;
  try {
    if (sessionStorage) {
      enabled ||= sessionStorage.getItem(QA_SESSION_KEY) === 'enabled';
      if (enabled) sessionStorage.setItem(QA_SESSION_KEY, 'enabled');
    }
  } catch { /* The explicit query remains sufficient when session storage is blocked. */ }
  if (enabled) removeQaQuery(location, history);
  return enabled;
}

export function closeQaSession(location, history, storage, sessionStorage = null) {
  clearLegacyQaPreference(storage);
  try { sessionStorage?.removeItem(QA_SESSION_KEY); }
  catch { /* Session cleanup must not prevent QA from closing. */ }
  removeQaQuery(location, history);
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
