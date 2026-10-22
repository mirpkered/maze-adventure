const rectKeys = ['x', 'y', 'width', 'height'];

function readRect(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return Object.fromEntries(rectKeys.map(key => [key, rect[key]]));
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
