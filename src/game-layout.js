const rectKeys = ['x', 'y', 'width', 'height'];

function readRect(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return Object.fromEntries(rectKeys.map(key => [key, rect[key]]));
}

const cssPixels = value => Number.parseFloat(value) || 0;

/** Measure conservative pointer travel inside the non-border, non-padding pad area. */
export function measureSteeringReach(rect, insets = {}, thresholdPixels = 76) {
  if (!rect) return null;
  const left = cssPixels(insets.left), right = cssPixels(insets.right);
  const top = cssPixels(insets.top), bottom = cssPixels(insets.bottom);
  const width = Math.max(0, rect.width - left - right);
  const height = Math.max(0, rect.height - top - bottom);
  const reachAt = (xFraction, yFraction) => {
    const x = left + width * xFraction, y = top + height * yFraction;
    const up = y - top, down = top + height - y;
    const leftReach = x - left, rightReach = left + width - x;
    const diagonals = {
      upLeft: Math.min(up, leftReach) * Math.SQRT2,
      upRight: Math.min(up, rightReach) * Math.SQRT2,
      downLeft: Math.min(down, leftReach) * Math.SQRT2,
      downRight: Math.min(down, rightReach) * Math.SQRT2,
    };
    const diagonal = Math.max(...Object.values(diagonals));
    return {
      up, down, left: leftReach, right: rightReach, diagonal, diagonals,
      thresholdReachable: {
        up: up >= thresholdPixels, down: down >= thresholdPixels,
        left: leftReach >= thresholdPixels, right: rightReach >= thresholdPixels,
        diagonal: diagonal >= thresholdPixels,
        diagonals: Object.fromEntries(Object.entries(diagonals).map(([direction, distance]) => [direction, distance >= thresholdPixels])),
      },
    };
  };
  return {
    width, height, thresholdPixels,
    center: reachAt(0.5, 0.5),
    offCenter: {
      top: reachAt(0.5, 0), bottom: reachAt(0.5, 1),
      left: reachAt(0, 0.5), right: reachAt(1, 0.5),
      topLeft: reachAt(0, 0), topRight: reachAt(1, 0),
      bottomLeft: reachAt(0, 1), bottomRight: reachAt(1, 1),
    },
  };
}

/** Capture the rendered gameplay geometry used to verify the inline completion transition. */
export function captureGameplayLayout(document, window) {
  const panel = document.querySelector('.maze-display-panel');
  const svg = document.querySelector('#maze');
  const viewBoxText = svg?.getAttribute('viewBox') ?? '0 0 0 0';
  const [, , viewWidth = 0, viewHeight = 0] = viewBoxText.trim().split(/[\s,]+/).map(Number);
  const mazePanel = readRect(panel);
  const mazeSvg = readRect(svg);
  const pad = readRect(document.querySelector('#steering-pad'));
  const mazeToPadGapPx = mazePanel && pad ? pad.y - (mazePanel.y + mazePanel.height) : null;
  const padElement = document.querySelector('#steering-pad');
  const padStyle = padElement && typeof window.getComputedStyle === 'function' ? window.getComputedStyle(padElement) : null;
  const padInsets = padStyle ? {
    left: cssPixels(padStyle.borderLeftWidth) + cssPixels(padStyle.paddingLeft),
    right: cssPixels(padStyle.borderRightWidth) + cssPixels(padStyle.paddingRight),
    top: cssPixels(padStyle.borderTopWidth) + cssPixels(padStyle.paddingTop),
    bottom: cssPixels(padStyle.borderBottomWidth) + cssPixels(padStyle.paddingBottom),
  } : {};
  const completion = readRect(document.querySelector('#completion-panel'));
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    mazePanel,
    mazeSvg,
    viewBox: { width: viewWidth, height: viewHeight },
    scale: {
      x: viewWidth > 0 && mazeSvg ? mazeSvg.width / viewWidth : null,
      y: viewHeight > 0 && mazeSvg ? mazeSvg.height / viewHeight : null,
    },
    steeringPad: pad,
    mazeToPadGapPx,
    steeringTouchArea: measureSteeringReach(pad, padInsets),
    completionPanel: completion,
    playHint: readRect(document.querySelector('#play-hint')),
    completionCheck: {
      stable: document.body?.dataset?.completionLayoutStable === undefined ? null : document.body.dataset.completionLayoutStable === 'true',
      maxDeltaPx: Number.isFinite(Number(document.body?.dataset?.completionLayoutDelta)) ? Number(document.body.dataset.completionLayoutDelta) : null,
      maxScaleDelta: Number.isFinite(Number(document.body?.dataset?.completionLayoutScaleDelta)) ? Number(document.body.dataset.completionLayoutScaleDelta) : null,
    },
  };
}

/** Compare actual maze placement, dimensions, and SVG scale with a subpixel tolerance. */
export function compareMazeLayout(before, after, tolerance = 0.5) {
  const fields = ['x', 'y', 'width', 'height'];
  const measurements = [];
  for (const key of ['mazePanel', 'mazeSvg']) {
    for (const field of fields) {
      measurements.push({ key, field, delta: Math.abs(before?.[key]?.[field] - after?.[key]?.[field]) });
    }
  }
  const maxDeltaPx = Math.max(...measurements.map(item => item.delta));
  const maxScaleDelta = Math.max(...['x', 'y'].map(axis => Math.abs(before?.scale?.[axis] - after?.scale?.[axis])));
  const scaleTolerance = 0.001;
  return {
    stable: Number.isFinite(maxDeltaPx) && maxDeltaPx <= tolerance && Number.isFinite(maxScaleDelta) && maxScaleDelta <= scaleTolerance,
    tolerance,
    maxDeltaPx,
    scaleTolerance,
    maxScaleDelta,
    measurements,
  };
}
