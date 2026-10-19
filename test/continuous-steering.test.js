import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createSteeringController, DEFAULT_STEERING_SETTINGS, QA_INPUT_MODE_KEY, QA_INPUT_MODES,
  readQaInputMode, writeQaInputMode,
} from '../src/continuous-steering.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function runRate(hz, durationMs = 1000) {
  const controller = createSteeringController(), pointer = 91;
  controller.begin(pointer, { x: 120, y: 210 });
  controller.update(pointer, { x: 180, y: 210 });
  controller.advance(pointer, 0);
  let total = 0;
  for (let time = 1000 / hz; time <= durationMs + 0.01; time += 1000 / hz) {
    total += controller.advance(pointer, time).x;
  }
  controller.end(pointer);
  return total;
}

test('Direct Touch remains the default and QA input mode is locally selectable', () => {
  const storage = new MemoryStorage();
  assert.equal(readQaInputMode(storage), QA_INPUT_MODES.DIRECT_TOUCH);
  assert.equal(writeQaInputMode(QA_INPUT_MODES.CONTINUOUS_STEERING, storage), QA_INPUT_MODES.CONTINUOUS_STEERING);
  assert.equal(storage.getItem(QA_INPUT_MODE_KEY), QA_INPUT_MODES.CONTINUOUS_STEERING);
  assert.equal(readQaInputMode(storage), QA_INPUT_MODES.CONTINUOUS_STEERING);
  storage.setItem(QA_INPUT_MODE_KEY, 'unexpected');
  assert.equal(readQaInputMode(storage), QA_INPUT_MODES.DIRECT_TOUCH);
  assert.equal(readQaInputMode({ getItem() { throw new Error('storage unavailable'); } }), QA_INPUT_MODES.DIRECT_TOUCH);
});

test('touch down establishes steering origin without producing movement', () => {
  const controller = createSteeringController(), pointer = 1;
  assert.equal(controller.begin(pointer, { x: 20, y: 30 }), true);
  assert.deepEqual(controller.advance(pointer, 0), { x: 0, y: 0, speed: 0, active: false, frameSeconds: 0, clamped: false });
  assert.deepEqual(controller.advance(pointer, 16), { x: 0, y: 0, speed: 0, active: false, frameSeconds: 0.016, clamped: false });
  assert.deepEqual(controller.snapshot.origin, { x: 20, y: 30 });
});

test('screen displacement defines all four directions and the central dead zone stops motion', () => {
  const controller = createSteeringController({ deadZonePixels: 10, maxDeflectionPixels: 60 });
  const cases = [
    [{ x: 50, y: 0 }, { x: 0, y: -1 }],
    [{ x: 50, y: 100 }, { x: 0, y: 1 }],
    [{ x: 0, y: 50 }, { x: -1, y: 0 }],
    [{ x: 100, y: 50 }, { x: 1, y: 0 }],
  ];
  for (const [finger, direction] of cases) {
    controller.begin(4, { x: 50, y: 50 });
    controller.update(4, finger);
    controller.advance(4, 0);
    const delta = controller.advance(4, 20);
    assert.equal(Math.sign(delta.x), Math.sign(direction.x));
    assert.equal(Math.sign(delta.y), Math.sign(direction.y));
    controller.end(4);
  }
  controller.begin(5, { x: 4, y: 8 });
  controller.update(5, { x: 13, y: 8 });
  controller.advance(5, 0);
  assert.equal(controller.advance(5, 16).active, false);
});

test('greater finger displacement increases speed up to the configured bound', () => {
  const controller = createSteeringController();
  controller.begin(2, { x: 0, y: 0 });
  controller.advance(2, 0);
  controller.update(2, { x: 20, y: 0 });
  const near = controller.advance(2, 20).speed;
  controller.update(2, { x: 60, y: 0 });
  const farther = controller.advance(2, 40).speed;
  controller.update(2, { x: 500, y: 0 });
  const maximum = controller.advance(2, 60).speed;
  assert.ok(farther > near);
  assert.equal(maximum, DEFAULT_STEERING_SETTINGS.maxSpeedMazeUnitsPerSecond);
  assert.ok(maximum <= DEFAULT_STEERING_SETTINGS.maxSpeedMazeUnitsPerSecond);
});

test('holding a displaced finger produces continuous movement without further pointer events', () => {
  const controller = createSteeringController();
  controller.begin(3, { x: 100, y: 100 });
  controller.update(3, { x: 170, y: 100 });
  controller.advance(3, 0);
  const steps = Array.from({ length: 8 }, (_, i) => controller.advance(3, (i + 1) * 16));
  assert.ok(steps.every(step => step.active && step.x > 0 && step.y === 0));
});

test('steady steering distance is nearly frame-rate independent at 30 and 60 Hz', () => {
  const at30 = runRate(30), at60 = runRate(60);
  assert.ok(Math.abs(at30 - at60) < 0.015, `30 Hz=${at30}, 60 Hz=${at60}`);
});

test('frame stalls are capped and do not accumulate hidden movement', () => {
  const controller = createSteeringController();
  controller.begin(8, { x: 0, y: 0 }); controller.update(8, { x: 100, y: 0 });
  controller.advance(8, 0);
  const delayed = controller.advance(8, 2000);
  assert.equal(delayed.clamped, true);
  assert.equal(delayed.frameSeconds, DEFAULT_STEERING_SETTINGS.maxFrameSeconds);
  assert.ok(delayed.x <= DEFAULT_STEERING_SETTINGS.maxSpeedMazeUnitsPerSecond * DEFAULT_STEERING_SETTINGS.maxFrameSeconds);
  const next = controller.advance(8, 2016);
  assert.equal(next.frameSeconds, 0.016, 'the suspended interval is not replayed on the next frame');
});

test('lift, cancel, and mismatched pointers stop steering', () => {
  const controller = createSteeringController();
  controller.begin(7, { x: 0, y: 0 });
  assert.equal(controller.update(9, { x: 40, y: 0 }), false);
  assert.equal(controller.end(9), false);
  assert.equal(controller.cancel(7), true);
  assert.equal(controller.active, false);
  assert.equal(controller.advance(7, 1000).active, false);
});

test('QA steering controls are opt-in, locally stored, interruptible, and do not use the camera transform', async () => {
  const [html, game, css, worker, packageJson] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="qa-input-mode-controls"[^>]*hidden/);
  assert.match(html, /id="qa-input-mode"[\s\S]*?value="direct-touch"[\s\S]*?value="continuous-steering"/);
  assert.doesNotMatch(html.slice(html.indexOf('<section id="settings"')), /qa-input-mode/,
    'experimental input controls are absent from standard Settings');
  assert.match(game, /qaEnabled \? readQaInputMode\(deviceStorage\) : QA_INPUT_MODES\.DIRECT_TOUCH/);
  assert.match(game, /traceSession\.beginSteering\(event\.pointerId\)/);
  assert.match(game, /traceSession\.steer\(id, delta\)/);
  assert.match(game, /if \(!event\.isPrimary\)/, 'a second simultaneous pointer cannot start another steering gesture');
  assert.match(game, /activePointerId !== null\) \{ recordTraceEvent\('pointerdown', event, lastRawPointer, false, 'another-pointer-owns-gesture'/);
  assert.match(game, /function makeMaze\(reuse = false\) \{\s*if \(activePointerId !== null\) clearPointer\(\)/,
    'restart and new maze cancel the active controller');
  assert.match(game, /if \(pause\) \{ paused = true; pauseTimer\(\); clearPointer\(\); \}/,
    'pause and its Settings transition stop the controller');
  assert.match(game, /if \(cancel\) traceSession\.cancel\(event\.pointerId\)/,
    'pointercancel and lost capture end steering without movement');
  assert.match(game, /gestureScreenToSvg \|\| steeringPointerId !== null/,
    'camera follows the logical pencil while steering input remains screen-space');
  assert.match(game, /requestAnimationFrame\(frame\)/);
  assert.match(game, /cancelAnimationFrame\(steeringFrameId\)/);
  assert.match(game, /document\.hidden\) \{ pauseTimer\(\); if \(steeringPointerId !== null\) clearPointer\(\); \}/);
  assert.match(game, /movement\.complete[\s\S]*?endSteeringGesture\(id\)[\s\S]*?completeMaze\(\)/);
  assert.match(css, /\.steering-indicator\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(worker, /\.\/src\/continuous-steering\.js/);
  const steeringSource = await readFile(new URL('../src/continuous-steering.js', import.meta.url), 'utf8');
  assert.doesNotMatch(steeringSource, /cameraPosition|viewBox/, 'camera updates cannot feed back into steering direction');
  assert.match(packageJson, /continuous-steering\.js/);
});
