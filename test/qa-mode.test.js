import test from 'node:test';
import assert from 'node:assert/strict';
import { bindEmblemQaTrigger, isQaEnabledOnStartup, isQaRequested, QA_STORAGE_KEY, readQaPreference, writeQaPreference } from '../src/qa-mode.js';

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

test('QA URL switch and device preference load, persist, and clear safely', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  assert.equal(isQaRequested('?qa=1'), true);
  assert.equal(isQaRequested('?qa=0'), false);
  assert.equal(readQaPreference(storage), false);
  assert.equal(isQaEnabledOnStartup('', storage), false);
  assert.equal(writeQaPreference(storage, true), true);
  assert.equal(values.get(QA_STORAGE_KEY), 'enabled');
  assert.equal(readQaPreference(storage), true);
  assert.equal(isQaEnabledOnStartup('', storage), true);
  assert.equal(isQaEnabledOnStartup('?qa=1', storage), true);
  writeQaPreference(storage, false);
  assert.equal(readQaPreference(storage), false);
  assert.equal(readQaPreference({ getItem() { throw new Error('blocked'); } }), false);
  assert.equal(writeQaPreference({ setItem() { throw new Error('blocked'); } }, true), false);
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
