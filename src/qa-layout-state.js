export const QA_CLOSE_VIEW_LAYOUTS = Object.freeze([
  Object.freeze({ value: 'current', label: 'Current', closeViewDvh: 40, overviewLimitDvh: 33 }),
  Object.freeze({ value: 'compact', label: 'Compact', closeViewDvh: 32, overviewLimitDvh: null }),
  Object.freeze({ value: 'extra-compact', label: 'Extra Compact', closeViewDvh: 28.5, overviewLimitDvh: null }),
]);

export const DEFAULT_QA_CLOSE_VIEW_LAYOUT = 'current';

const isSupportedLayout = value => QA_CLOSE_VIEW_LAYOUTS.some(layout => layout.value === value);

/** QA-only, in-memory layout choice. It is never stored in player preferences. */
export function createQaCloseViewLayoutState(initial = DEFAULT_QA_CLOSE_VIEW_LAYOUT) {
  let selected = isSupportedLayout(initial) ? initial : DEFAULT_QA_CLOSE_VIEW_LAYOUT;
  return {
    get value() { return selected; },
    select(value, { qaEnabled = false } = {}) {
      if (!qaEnabled || !isSupportedLayout(value)) return false;
      selected = value;
      return true;
    },
    reset() { selected = DEFAULT_QA_CLOSE_VIEW_LAYOUT; },
  };
}

/**
 * Size the square overview to the real remaining workspace, without cropping
 * or stretching it. Candidate layouts give it all remaining height; Current
 * keeps the existing viewport-height cap as a true production comparison.
 */
export function calculateQaOverviewSize({
  layout = DEFAULT_QA_CLOSE_VIEW_LAYOUT,
  workspaceWidth,
  workspaceHeight,
  closeViewHeight,
  viewportHeight,
  gap = 6,
}) {
  const selected = QA_CLOSE_VIEW_LAYOUTS.find(item => item.value === layout);
  if (!selected || ![workspaceWidth, workspaceHeight, closeViewHeight, viewportHeight].every(Number.isFinite)) return 0;
  const availableHeight = Math.max(0, workspaceHeight - closeViewHeight - gap);
  const limit = selected.overviewLimitDvh === null ? Infinity : viewportHeight * selected.overviewLimitDvh / 100;
  return Math.max(0, Math.min(workspaceWidth, availableHeight, limit));
}

export function getQaCloseViewTargetHeight(layout, viewportHeight, availableWidth = Infinity, baseDvh = 40) {
  const selected = QA_CLOSE_VIEW_LAYOUTS.find(item => item.value === layout);
  if (!selected || !Number.isFinite(viewportHeight) || !Number.isFinite(baseDvh)) return 0;
  const widthLimit = Number.isFinite(availableWidth) ? availableWidth : Infinity;
  return Math.max(0, Math.min(widthLimit, viewportHeight * baseDvh * (selected.closeViewDvh / 40) / 100));
}
