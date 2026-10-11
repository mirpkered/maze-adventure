import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const ART = 512;
const palette = {
  paper: [245, 239, 223, 255],
  ink: [56, 66, 56, 255],
  rust: [189, 98, 67, 255],
  green: [99, 125, 101, 255],
};
const walls = [
  [[140, 92], [430, 92]], [[82, 92], [82, 430]], [[430, 92], [430, 430]], [[82, 430], [372, 430]],
  [[140, 92], [140, 150]], [[198, 150], [314, 150]], [[256, 150], [256, 208]],
  [[140, 208], [256, 208]], [[314, 208], [372, 208]], [[372, 208], [372, 324]],
  [[198, 266], [314, 266]], [[140, 266], [140, 382]], [[198, 324], [314, 324]],
  [[314, 324], [314, 382]],
];
const trail = [
  [[111, 126], [169, 126]], [[169, 126], [227, 126]], [[227, 126], [227, 184]],
  [[227, 184], [285, 184]], [[285, 184], [285, 242]], [[285, 242], [343, 242]],
  [[343, 242], [343, 300]], [[343, 300], [401, 300]], [[401, 300], [401, 397]],
];

function distanceToSegment(x, y, [[x1, y1], [x2, y2]]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function insideCircle(x, y, cx, cy, radius) { return Math.hypot(x - cx, y - cy) <= radius; }

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function render(size) {
  const scale = size / ART, samples = 2, rowBytes = size * 4;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  const wallsScaled = walls.map(segment => segment.map(point => point.map(value => value * scale)));
  const trailScaled = trail.map(segment => segment.map(point => point.map(value => value * scale)));
  const inkWidth = 15 * scale / 2, trailWidth = 17 * scale / 2;

  for (let y = 0; y < size; y++) {
    const row = y * (rowBytes + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const coverage = { ink: 0, rust: 0, green: 0 };
      for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
        const px = x + (sx + .5) / samples, py = y + (sy + .5) / samples;
        if (trailScaled.some(segment => distanceToSegment(px, py, segment) <= trailWidth)) coverage.rust++;
        else if (wallsScaled.some(segment => distanceToSegment(px, py, segment) <= inkWidth)) coverage.ink++;
        else if (insideCircle(px / scale, py / scale, 111, 126, 12) || insideCircle(px / scale, py / scale, 401, 397, 16)) coverage.green++;
      }
      let color = palette.paper;
      const max = samples * samples;
      if (coverage.rust) color = palette.rust;
      else if (coverage.green) color = palette.green;
      else if (coverage.ink) color = palette.ink;
      const offset = row + 1 + x * 4;
      raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = color[3];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(new URL('../icons/', import.meta.url), { recursive: true });
for (const [file, size] of [['maze-192.png', 192], ['maze-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await writeFile(new URL(`../icons/${file}`, import.meta.url), render(size));
}
console.log('Generated 192px, 512px, and 180px PNG app icons.');
