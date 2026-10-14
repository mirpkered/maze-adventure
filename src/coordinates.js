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

export function getMazeGridGeometry(width, height, viewSize = 400, padding = 24) {
  if (!Number.isFinite(width) || width < 1 || !Number.isFinite(height) || height < 1
    || !Number.isFinite(viewSize) || viewSize <= padding * 2 || !Number.isFinite(padding) || padding < 0) {
    throw new RangeError('Maze grid geometry requires positive dimensions and a usable viewBox.');
  }
  const cellSize = (viewSize - padding * 2) / Math.max(width, height);
  return {
    cellSize,
    x: (viewSize - width * cellSize) / 2,
    y: (viewSize - height * cellSize) / 2,
  };
}

export function svgToMazePoint(point, padX, cellSize, padY = padX) {
  return { x: (point.x - padX) / cellSize - 0.5, y: (point.y - padY) / cellSize - 0.5 };
}

export function mazeToSvgPoint(point, padX, cellSize, padY = padX) {
  return { x: padX + (point.x + 0.5) * cellSize, y: padY + (point.y + 0.5) * cellSize };
}
