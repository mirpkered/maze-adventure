/** Apply a 2D affine transform to a client or SVG point. */
export function transformPoint(point, matrix) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

/**
 * Map a client point into SVG user units when getScreenCTM is unavailable.
 * This mirrors SVG's default xMidYMid meet behavior, including letterboxing.
 */
export function clientToViewBoxPoint(point, rect, viewBox) {
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  if (!Number.isFinite(scale) || scale <= 0) return { x: viewBox.x, y: viewBox.y };
  const drawnWidth = viewBox.width * scale, drawnHeight = viewBox.height * scale;
  const offsetX = (rect.width - drawnWidth) / 2, offsetY = (rect.height - drawnHeight) / 2;
  return {
    x: viewBox.x + (point.x - rect.left - offsetX) / scale,
    y: viewBox.y + (point.y - rect.top - offsetY) / scale,
  };
}

export function svgToMazePoint(point, pad, cellSize) {
  return { x: (point.x - pad) / cellSize - 0.5, y: (point.y - pad) / cellSize - 0.5 };
}

export function mazeToSvgPoint(point, pad, cellSize) {
  return { x: pad + (point.x + 0.5) * cellSize, y: pad + (point.y + 0.5) * cellSize };
}
