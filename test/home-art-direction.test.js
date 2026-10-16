import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the home art direction remains a shared offline-ready screen system', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/home-art-direction.css', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(html, /\.\/src\/home-art-direction\.css/);
  assert.match(html, /id="quick-play"/);
  assert.match(html, /id="difficulty"/);
  assert.match(html, /id="settings"/);
  assert.match(css, /body\[data-visual-theme="traveler-map"\]/);
  assert.match(css, /body\[data-visual-theme="camp-dusk"\]/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.home-art\.title-art\s*\{[^}]*order:\s*-1/s);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(worker, /shell-v24/);
  assert.match(worker, /\.\/src\/home-art-direction\.css/);
});

test('theme scenes are locally bundled, organic compositions rather than framed panels', async () => {
  const map = await readFile(new URL('../art/travelers-map.svg', import.meta.url), 'utf8');
  const camp = await readFile(new URL('../art/camp-at-dusk.svg', import.meta.url), 'utf8');
  for (const [name, asset] of [['map', map], ['camp', camp]]) {
    assert.match(asset, /viewBox="0 0 900 600"/, `${name} has a scalable wide scene`);
    assert.ok((asset.match(/<path\b/g) ?? []).length >= 25, `${name} includes layered scene drawing`);
    assert.match(asset, /<linearGradient\b/);
    assert.match(asset, /<radialGradient\b/);
    assert.doesNotMatch(asset, /(?:href|src)=["']https?:\/\//, `${name} has no runtime network dependency`);
  }
  assert.match(map, /id="paper"/);
  assert.match(map, /id="river"/);
  assert.match(map, /id="fibers"/);
  assert.match(camp, /id="lantern-glow"/);
  assert.match(camp, /id="canvas-weave"/);
  assert.match(camp, /Pine|pine/i);
});
