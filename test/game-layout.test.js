import test from 'node:test';
import assert from 'node:assert/strict';
import { captureGameplayLayout, compareMazeLayout } from '../src/game-layout.js';

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
  return { document, window: { innerWidth: 390, innerHeight: 844 } };
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
  assert.equal(layout.completionPanel.height, 110);
  assert.deepEqual(layout.completionCheck, { stable: null, maxDeltaPx: null, maxScaleDelta: null });
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
