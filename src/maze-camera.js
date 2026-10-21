const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * A square, bounded 2D camera over the maze's existing SVG coordinate space.
 * It only changes the presentation viewBox; it never mutates tracing state.
 */
export function createMazeCamera({ viewSize = 400, zoom = 2, edgePadding = 26, followInset = .3 } = {}) {
  if (!Number.isFinite(viewSize) || viewSize <= 0 || !Number.isFinite(zoom) || zoom < 1) {
    throw new TypeError('Maze camera requires a positive view size and zoom of at least 1.');
  }
  const span = viewSize / zoom;
  const min = -edgePadding;
  const max = viewSize + edgePadding - span;
  let left = min, top = min;

  function centered(point) {
    left = clamp(point.x - span / 2, min, max);
    top = clamp(point.y - span / 2, min, max);
    return snapshot();
  }

  function follow(point) {
    const inset = span * followInset;
    // Keep the pencil at the edge of its follow zone instead of snapping it
    // back to the center. Centering here can move the viewBox by many world
    // units in response to one small touch sample, while the active gesture
    // correctly continues using its pointerdown transform. That makes the
    // rendered pencil jump away from the finger even though the route did not.
    // Following the edge limits camera movement to the amount the endpoint
    // crossed the dead zone; when input stops, the camera stops immediately.
    if (point.x < left + inset) left = clamp(point.x - inset, min, max);
    else if (point.x > left + span - inset) left = clamp(point.x - (span - inset), min, max);
    if (point.y < top + inset) top = clamp(point.y - inset, min, max);
    else if (point.y > top + span - inset) top = clamp(point.y - (span - inset), min, max);
    return snapshot();
  }

  function snapshot() {
    return { x: left, y: top, width: span, height: span, zoom, viewBox: `${left} ${top} ${span} ${span}` };
  }

  return { center: centered, follow, snapshot };
}

export const QA_ZOOM_LEVELS = Object.freeze([
  Object.freeze({ value: 2, label: '2.0× — Current' }),
  Object.freeze({ value: 1.75, label: '1.75× — Candidate' }),
  Object.freeze({ value: 1.5, label: '1.5× — Wide' }),
]);
export const DEFAULT_QA_ZOOM = 2;

const isSupportedQaZoom = value => QA_ZOOM_LEVELS.some(level => level.value === value);

/** Ephemeral QA-only selection. It intentionally has no storage integration. */
export function createQaZoomState(initial = DEFAULT_QA_ZOOM) {
  let selected = isSupportedQaZoom(initial) ? initial : DEFAULT_QA_ZOOM;
  return {
    get value() { return selected; },
    select(value, { qaEnabled = false } = {}) {
      if (!qaEnabled || !isSupportedQaZoom(value)) return false;
      selected = value;
      return true;
    },
    reset() { selected = DEFAULT_QA_ZOOM; },
  };
}

/** Normal play always uses the established 2× camera, regardless of QA state. */
export function effectiveCameraZoom({ qaEnabled = false, qaZoom = DEFAULT_QA_ZOOM, ordinaryZoom = 2 } = {}) {
  return qaEnabled && isSupportedQaZoom(qaZoom) ? qaZoom : ordinaryZoom;
}

