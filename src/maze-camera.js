const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Convert a physical CSS-pixel touch radius into the maze's cell units. */
export function mazeDistanceForScreenPixels(distancePixels, cellSize, pixelsPerSvgUnit) {
  if (![distancePixels, cellSize, pixelsPerSvgUnit].every(Number.isFinite)
    || distancePixels < 0 || cellSize <= 0 || pixelsPerSvgUnit <= 0) {
    throw new TypeError('Touch distance conversion requires nonnegative pixels and positive geometry scales.');
  }
  const pixelsPerMazeUnit = cellSize * pixelsPerSvgUnit;
  return { mazeUnits: distancePixels / pixelsPerMazeUnit, pixelsPerMazeUnit };
}

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
    if (point.x < left + inset || point.x > left + span - inset) left = clamp(point.x - span / 2, min, max);
    if (point.y < top + inset || point.y > top + span - inset) top = clamp(point.y - span / 2, min, max);
    return snapshot();
  }

  function snapshot() {
    return { x: left, y: top, width: span, height: span, zoom, viewBox: `${left} ${top} ${span} ${span}` };
  }

  return { center: centered, follow, snapshot };
}

