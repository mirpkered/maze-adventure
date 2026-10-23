import test from 'node:test';
import assert from 'node:assert/strict';
import { captureGameplayLayout, compareMazeLayout, measureSteeringReach } from '../src/game-layout.js';

function fixture({ panel = { x: 10, y: 90, width: 370, height: 370 }, svg = { x: 20, y: 100, width: 350, height: 350 }, pad = { x: 10, y: 640, width: 370, height: 110 }, completion = { x: 10, y: 640, width: 370, height: 110 }, hint = { x: 10, y: 50, width: 370, height: 40 } } = {}) {
  const elements = new Map([
    ['.maze-display-panel', panel], ['#maze', svg], ['#steering-pad', pad],
    ['#completion-panel', completion], ['#play-hint', hint],
  ]);
  const document = {
    querySelector(selector) {
      const box = elements.get(selector);
      if (!box) return null;
      return { getBoundingClientRect: () => ({ ...box }), getAttribute: key => key === 'viewBox' ? '0 0 400 400' : null };
    },
  };
  return { document, window: { innerWidth: 390, innerHeight: 844, getComputedStyle: () => ({ borderLeftWidth: '2px', borderRightWidth: '2px', borderTopWidth: '2px', borderBottomWidth: '2px', paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px' }) } };
}

test('rendered maze panel position, SVG size, and scale compare within a half-pixel tolerance', () => {
  const first = fixture(), second = fixture({
    panel: { x: 10.2, y: 90.1, width: 370, height: 370 },
    svg: { x: 20.2, y: 100.1, width: 350, height: 350 },
  });
  const before = captureGameplayLayout(first.document, first.window);
  const after = captureGameplayLayout(second.document, second.window);
  const result = compareMazeLayout(before, after);
  assert.equal(result.stable, true);
  assert.equal(result.tolerance, 0.5);
  assert.equal(result.scaleTolerance, 0.001);
  assert.equal(result.maxScaleDelta, 0);
});

test('layout capture reports viewport and the real lower control allocations for QA reports', () => {
  const page = fixture();
  const layout = captureGameplayLayout(page.document, page.window);
  assert.deepEqual(layout.viewport, { width: 390, height: 844 });
  assert.equal(layout.mazeSvg.width, 350);
  assert.equal(layout.steeringPad.height, 110);
  assert.equal(layout.mazeToPadGapPx, 180);
  assert.deepEqual({ up: layout.steeringTouchArea.center.thresholdReachable.up, down: layout.steeringTouchArea.center.thresholdReachable.down, left: layout.steeringTouchArea.center.thresholdReachable.left, right: layout.steeringTouchArea.center.thresholdReachable.right, diagonal: layout.steeringTouchArea.center.thresholdReachable.diagonal }, { up: false, down: false, left: true, right: true, diagonal: false });
  assert.equal(layout.completionPanel.height, 110);
  assert.deepEqual(layout.completionCheck, { stable: null, maxDeltaPx: null, maxScaleDelta: null });
});

test('directional reach uses actual usable pad dimensions and reports off-center limits', () => {
  const reach = measureSteeringReach({ x: 0, y: 0, width: 370, height: 186 }, { left: 2, right: 2, top: 2, bottom: 2 });
  assert.deepEqual({ width: reach.width, height: reach.height }, { width: 366, height: 182 });
  assert.deepEqual({ up: reach.center.up, down: reach.center.down, left: reach.center.left, right: reach.center.right }, { up: 91, down: 91, left: 183, right: 183 });
  assert.equal(reach.center.thresholdReachable.up, true);
  assert.equal(reach.center.thresholdReachable.down, true);
  assert.equal(reach.center.thresholdReachable.left, true);
  assert.equal(reach.center.thresholdReachable.right, true);
  assert.equal(reach.center.thresholdReachable.diagonal, true);
  assert.equal(reach.offCenter.top.thresholdReachable.up, false);
  assert.equal(reach.offCenter.bottom.thresholdReachable.down, false);
  assert.equal(reach.offCenter.top.thresholdReachable.diagonal, true, 'an edge touch still has a reachable inward diagonal');
  assert.equal(reach.offCenter.topLeft.thresholdReachable.up, false);
  assert.equal(reach.offCenter.topLeft.thresholdReachable.left, false);
  assert.equal(reach.thresholdPixels, 76);
});

test('each requested portrait layout provides 76px center-origin reach in every direction', () => {
  const viewports = [
    { width: 390, height: 844, padWidth: 370.4, padHeight: 253.2 },
    { width: 375, height: 812, padWidth: 355.2, padHeight: 243.6 },
    { width: 430, height: 932, padWidth: 402.4, padHeight: 279.6 },
    { width: 320, height: 700, padWidth: 300, padHeight: 210 },
  ];
  for (const viewport of viewports) {
    const reach = measureSteeringReach({ width: viewport.padWidth, height: viewport.padHeight }, { left: 2, right: 2, top: 2, bottom: 2 });
    for (const direction of ['up', 'down', 'left', 'right', 'diagonal']) {
      assert.equal(reach.center.thresholdReachable[direction], true, `${viewport.width}x${viewport.height} center ${direction} reach`);
    }
  }
});

test('Steering Pad uses unused maze clearance without changing the maze row or control slot allocation', async () => {
  const css = await (await import('node:fs/promises')).readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.maze-workspace\s*\{[^}]*--game-control-height:\s*clamp\(170px,\s*22dvh,\s*188px\)[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) var\(--game-control-height\)/s);
  assert.match(css, /\.steering-pad\s*\{[^}]*height:\s*clamp\(204px,\s*30dvh,\s*280px\)[^}]*align-self:\s*end/s);
  assert.match(css, /\.steering-pad\s*\{[^}]*touch-action:\s*none/s);
});

test('the rendered layout assertion detects a completion-induced shrink or recenter', () => {
  const first = fixture(), second = fixture({
    panel: { x: 10, y: 64, width: 370, height: 340 },
    svg: { x: 20, y: 74, width: 350, height: 320 },
  });
  const result = compareMazeLayout(
    captureGameplayLayout(first.document, first.window),
    captureGameplayLayout(second.document, second.window),
  );
  assert.equal(result.stable, false);
  assert.equal(result.maxDeltaPx, 30);
});
