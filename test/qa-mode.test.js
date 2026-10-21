import test from 'node:test';
import assert from 'node:assert/strict';
import { bindEmblemQaTrigger, closeQaSession, isQaRequested, QA_STORAGE_KEY, startQaSession } from '../src/qa-mode.js';

class FakeTarget {
  listeners = new Map();
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type) { this.listeners.delete(type); }
  emit(type, values = {}) {
    let prevented = false;
    this.listeners.get(type)?.({ button: 0, pointerType: 'touch', clientX: 20, clientY: 30, preventDefault() { prevented = true; }, ...values });
    return prevented;
  }
}

function clock() {
  let next = 1;
  const tasks = new Map();
  return {
    tasks,
    setTimer(callback, delay) { const id = next++; tasks.set(id, { callback, delay }); return id; },
    clearTimer(id) { tasks.delete(id); },
    fire() { const pending = [...tasks.values()]; tasks.clear(); for (const task of pending) task.callback(); },
  };
}

function session(href, values = new Map()) {
  const location = {};
  const setHref = value => {
    const url = new URL(value, 'https://maze.example');
    location.href = url.href;
    location.search = url.search;
  };
  setHref(href);
  const history = { state: null, replaceState(_state, _title, value) { setHref(value); } };
  const storage = { removeItem: key => values.delete(key) };
  return { location, history, storage, values };
}

test('normal launch starts with QA off and removes only retired QA preferences', () => {
  const values = new Map([[QA_STORAGE_KEY, 'enabled'], ['maze-adventure-qa-input-mode-v1', 'direct-touch'], ['game-progress', 'level-4'], ['preferences', 'sound-off']]);
  const app = session('/maze?theme=dark#play', values);
  assert.equal(startQaSession(app.location, app.history, app.storage), false);
  assert.equal(app.location.href, 'https://maze.example/maze?theme=dark#play');
  assert.equal(values.has(QA_STORAGE_KEY), false);
  assert.equal(values.has('maze-adventure-qa-input-mode-v1'), false);
  assert.equal(values.get('game-progress'), 'level-4');
  assert.equal(values.get('preferences'), 'sound-off');
});

test('explicit QA launch enables one session and consumes ?qa=1 from the PWA URL', () => {
  const app = session('/maze?qa=1&theme=dark#play');
  assert.equal(isQaRequested(app.location.search), true);
  assert.equal(startQaSession(app.location, app.history, app.storage), true);
  assert.equal(app.location.href, 'https://maze.example/maze?theme=dark#play');
});

test('closing QA clears legacy state and a restarted or restored PWA stays out of QA', () => {
  const values = new Map([[QA_STORAGE_KEY, 'enabled'], ['game-progress', 'level-4']]);
  const app = session('/maze?qa=1&theme=dark', values);
  assert.equal(startQaSession(app.location, app.history, app.storage), true);
  closeQaSession(app.location, app.history, app.storage);

  // iOS restores the current, canonicalized launch URL after the explicit QA
  // query has been consumed, rather than replaying the original launch URL.
  const restored = session(app.location.href, values);
  assert.equal(startQaSession(restored.location, restored.history, restored.storage), false);
  assert.equal(restored.location.href, 'https://maze.example/maze?theme=dark');
  assert.equal(values.get('game-progress'), 'level-4');
});

test('closing a QA session removes a still-present QA query without touching progress', () => {
  const values = new Map([[QA_STORAGE_KEY, 'enabled'], ['game-progress', 'level-4']]);
  const app = session('/maze?qa=1&other=kept#play', values);
  closeQaSession(app.location, app.history, app.storage);
  assert.equal(app.location.href, 'https://maze.example/maze?other=kept#play');
  assert.equal(values.has(QA_STORAGE_KEY), false);
  assert.equal(values.get('game-progress'), 'level-4');
});

test('emblem requires a three-second stationary hold; early release and movement cancel', () => {
  const target = new FakeTarget(), timers = clock();
  let activations = 0;
  bindEmblemQaTrigger(target, () => activations++, timers);
  target.emit('pointerdown');
  assert.equal([...timers.tasks.values()][0].delay, 3000);
  target.emit('pointerup');
  timers.fire();
  assert.equal(activations, 0);
  target.emit('pointerdown');
  target.emit('pointermove', { clientX: 33, clientY: 30 });
  timers.fire();
  assert.equal(activations, 0);
  target.emit('pointerdown');
  timers.fire();
  assert.equal(activations, 1);
});

test('emblem QA hold cancels on pointer cancellation and supports Shift+Enter', () => {
  const target = new FakeTarget(), timers = clock();
  let activations = 0;
  bindEmblemQaTrigger(target, () => activations++, timers);
  target.emit('pointerdown');
  target.emit('pointercancel');
  timers.fire();
  assert.equal(activations, 0);
  const prevented = target.emit('keydown', { key: 'Enter', shiftKey: true });
  assert.equal(prevented, true);
  assert.equal(activations, 1);
  target.emit('keydown', { key: 'Enter', shiftKey: false });
  assert.equal(activations, 1);
});

test('emblem ignores non-primary mouse buttons and ordinary taps', () => {
  const target = new FakeTarget(), timers = clock();
  let activations = 0;
  bindEmblemQaTrigger(target, () => activations++, timers);
  target.emit('pointerdown', { button: 2, pointerType: 'mouse' });
  timers.fire();
  target.emit('pointerdown');
  target.emit('pointerup');
  timers.fire();
  assert.equal(activations, 0);
});
