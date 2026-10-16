/** Build an open SVG polyline path for append-only accepted ink. */
export function tracePathData(points, strokeBreaks = []) {
  const breaks = new Set(strokeBreaks);
  return points.map((point, index) => `${index === 0 || breaks.has(index) ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}
