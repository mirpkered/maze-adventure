import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQaOverviewSize,
  createQaCloseViewLayoutState,
  getQaCloseViewTargetHeight,
  QA_CLOSE_VIEW_LAYOUTS,
} from '../src/qa-layout-state.js';

test('QA exposes Current, Compact, and Extra Compact as an ephemeral layout choice', () => {
  assert.deepEqual(QA_CLOSE_VIEW_LAYOUTS.map(({ value }) => value), ['current', 'compact', 'extra-compact']);
  const state = createQaCloseViewLayoutState();
  assert.equal(state.value, 'current');
  assert.equal(state.select('compact'), false, 'layout cannot be changed outside QA');
  assert.equal(state.select('compact', { qaEnabled: true }), true);
  assert.equal(state.value, 'compact');
  assert.equal(state.select('unknown', { qaEnabled: true }), false);
  state.reset();
  assert.equal(state.value, 'current', 'leaving QA restores the production layout');
});

test('compact panel heights match the requested relative reductions at iPhone portrait sizes', () => {
  for (const height of [844, 812, 932]) {
    const current = getQaCloseViewTargetHeight('current', height, 500);
    const compact = getQaCloseViewTargetHeight('compact', height, 500);
    const extra = getQaCloseViewTargetHeight('extra-compact', height, 500);
    assert.ok(Math.abs((current - compact) / current - .2) < 1e-10);
    assert.ok(Math.abs((current - extra) / current - .2875) < 1e-10);
  }
  const landscapeBase = 43, landscapeHeight = 390;
  const landscapeCurrent = getQaCloseViewTargetHeight('current', landscapeHeight, 500, landscapeBase);
  const landscapeCompact = getQaCloseViewTargetHeight('compact', landscapeHeight, 500, landscapeBase);
  const landscapeExtra = getQaCloseViewTargetHeight('extra-compact', landscapeHeight, 500, landscapeBase);
  assert.ok(Math.abs((landscapeCurrent - landscapeCompact) / landscapeCurrent - .2) < 1e-10);
  assert.ok(Math.abs((landscapeCurrent - landscapeExtra) / landscapeCurrent - .2875) < 1e-10);
});

test('candidate overview uses reclaimed workspace height and never exceeds its width', () => {
  const viewportHeight = 844, workspaceWidth = 370, workspaceHeight = 620, gap = 6;
  const currentClose = getQaCloseViewTargetHeight('current', viewportHeight, workspaceWidth);
  const compactClose = getQaCloseViewTargetHeight('compact', viewportHeight, workspaceWidth);
  const extraClose = getQaCloseViewTargetHeight('extra-compact', viewportHeight, workspaceWidth);
  const currentOverview = calculateQaOverviewSize({
    layout: 'current', workspaceWidth, workspaceHeight, closeViewHeight: currentClose, viewportHeight, gap,
  });
  const compactOverview = calculateQaOverviewSize({
    layout: 'compact', workspaceWidth, workspaceHeight, closeViewHeight: compactClose, viewportHeight, gap,
  });
  const extraOverview = calculateQaOverviewSize({
    layout: 'extra-compact', workspaceWidth, workspaceHeight, closeViewHeight: extraClose, viewportHeight, gap,
  });
  assert.equal(currentOverview, Math.min(workspaceWidth, workspaceHeight - currentClose - gap, viewportHeight * .33));
  assert.ok(compactOverview > currentOverview);
  assert.equal(extraOverview, workspaceWidth, 'extra available height permits a width-limited square overview');
  assert.ok(compactOverview <= workspaceWidth && extraOverview <= workspaceWidth);
  assert.ok(compactOverview <= workspaceHeight - compactClose - gap);
  assert.ok(extraOverview <= workspaceHeight - extraClose - gap);
});

test('narrow viewports limit the overview square without distortion or cropping', () => {
  const width = 335, viewportHeight = 812, workspaceHeight = 605, closeViewHeight = 231.4;
  const size = calculateQaOverviewSize({
    layout: 'extra-compact', workspaceWidth: width, workspaceHeight, closeViewHeight, viewportHeight, gap: 6,
  });
  assert.equal(size, width);
  assert.ok(size <= workspaceHeight - closeViewHeight - 6);
});
