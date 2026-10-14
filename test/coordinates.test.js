import test from 'node:test';
import assert from 'node:assert/strict';
import { clientToViewBoxPoint, getMazeGridGeometry, mazeToSvgPoint, svgToMazePoint, transformPoint } from '../src/coordinates.js';

const close = (actual, expected) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `x ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `y ${actual.y} != ${expected.y}`);
};

test('client-to-SVG transform stays aligned under different scales, offsets, and DPR-equivalent matrices', () => {
  const svgPoint = { x: 173.25, y: 211.5 };
  for (const scale of [0.72, 1, 1.5, 2.75]) {
    const screen = { a: scale, b: 0, c: 0, d: scale, e: 31, f: 87 };
    const client = transformPoint(svgPoint, screen);
    const inverse = { a: 1 / scale, b: 0, c: 0, d: 1 / scale, e: -31 / scale, f: -87 / scale };
    close(transformPoint(client, inverse), svgPoint);
  }
});

test('fallback mapping respects SVG meet letterboxing in portrait and landscape boxes', () => {
  const viewBox = { x: 0, y: 0, width: 400, height: 400 };
  const expected = { x: 172, y: 248 };
  for (const rect of [
    { left: 12, top: 100, width: 360, height: 360 },
    { left: 42, top: 70, width: 300, height: 480 },
    { left: 90, top: 40, width: 520, height: 260 },
  ]) {
    const scale = Math.min(rect.width / 400, rect.height / 400);
    const offsetX = (rect.width - 400 * scale) / 2, offsetY = (rect.height - 400 * scale) / 2;
    const client = { x: rect.left + offsetX + expected.x * scale, y: rect.top + offsetY + expected.y * scale };
    close(clientToViewBoxPoint(client, rect, viewBox), expected);
  }
});

test('SVG and maze coordinates round-trip without a touch-offset transform', () => {
  const pad = 24, cellSize = (400 - 2 * pad) / 7;
  const mazePoint = { x: 1.237, y: 4.411 };
  close(svgToMazePoint(mazeToSvgPoint(mazePoint, pad, cellSize), pad, cellSize), mazePoint);
});

test('portrait and rotated viewport mappings preserve the same logical maze point', () => {
  const logical = { x: 2.2, y: 3.4 }, pad = 24, cellSize = (400 - 2 * pad) / 7;
  const svgPoint = mazeToSvgPoint(logical, pad, cellSize), viewBox = { x: 0, y: 0, width: 400, height: 400 };
  for (const rect of [
    { left: 18, top: 70, width: 354, height: 354 },
    { left: 260, top: 30, width: 320, height: 320 },
  ]) {
    const client = { x: rect.left + svgPoint.x * rect.width / 400, y: rect.top + svgPoint.y * rect.height / 400 };
    const mappedSvg = clientToViewBoxPoint(client, rect, viewBox);
    close(svgToMazePoint(mappedSvg, pad, cellSize), logical);
  }
});

test('7x7 and 10x10 grid geometry fits the same paper and maps cell centers consistently', () => {
  const geometry = [getMazeGridGeometry(7, 7), getMazeGridGeometry(10, 10)];
  assert.equal(geometry[0].cellSize, 352 / 7);
  assert.equal(geometry[1].cellSize, 35.2);
  for (const [index, dimensions] of [[0, 7], [1, 10]]) {
    const layout = geometry[index];
    assert.equal(layout.x, 24); assert.equal(layout.y, 24);
    assert.ok(layout.x + dimensions * layout.cellSize <= 376);
    assert.ok(layout.y + dimensions * layout.cellSize <= 376);
    const mazePoint = { x: dimensions - 1, y: dimensions - 1 };
    const svgPoint = mazeToSvgPoint(mazePoint, layout.x, layout.cellSize, layout.y);
    close(svgToMazePoint(svgPoint, layout.x, layout.cellSize, layout.y), mazePoint);
  }
  assert.throws(() => getMazeGridGeometry(0, 10), RangeError);
});
