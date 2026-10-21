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

