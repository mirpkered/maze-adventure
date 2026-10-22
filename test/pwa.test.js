import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canReloadForUpdate } from '../src/update-policy.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url));

test('manifest uses the deployed application directory as its standalone start and scope', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  const deployedManifestUrl = new URL('https://mirpkered.github.io/maze-adventure/manifest.webmanifest');
  assert.equal(manifest.name, 'Maze Adventure');
  assert.equal(manifest.display, 'standalone');
  assert.equal(new URL(manifest.start_url, deployedManifestUrl).href, 'https://mirpkered.github.io/maze-adventure/');
  assert.equal(new URL(manifest.scope, deployedManifestUrl).href, 'https://mirpkered.github.io/maze-adventure/');
  assert.equal(new URL(manifest.id, deployedManifestUrl).href, 'https://mirpkered.github.io/maze-adventure/');
  assert.equal(manifest.theme_color, '#f5efdf');
  assert.equal(manifest.background_color, '#f5efdf');
});

test('manifest and Apple Home Screen icons exist as correctly sized PNGs', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  const expected = new Map([['./icons/maze-adventure-icon-192.png', 192], ['./icons/maze-adventure-icon-512.png', 512]]);
  assert.equal(manifest.icons.length, expected.size);
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    assert.equal(icon.purpose, 'any');
    const expectedSize = expected.get(icon.src);
    assert.ok(expectedSize, `Unexpected manifest icon ${icon.src}`);
    const data = await read(icon.src.slice(2));
    assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(data.readUInt32BE(16), expectedSize);
    assert.equal(data.readUInt32BE(20), expectedSize);
  }
  const appleIcon = await read('icons/maze-adventure-icon-180.png');
  assert.equal(appleIcon.readUInt32BE(16), 180);
  assert.equal(appleIcon.readUInt32BE(20), 180);
});

test('document links to manifest and Apple metadata without disabling browser zoom', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\.\/icons\/maze-adventure-icon-180\.png"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="apple-mobile-web-app-title" content="Maze Adventure"/);
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /maximum-scale\s*=|user-scalable\s*=\s*no/i);
  assert.doesNotMatch(html, /(?:href|src)="\/(?:src|icons|manifest|service-worker)/);
});

test('service worker is app-scoped, refreshes from network, and removes obsolete caches', async () => {
  const html = await readFile(new URL('../src/pwa.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(html, /new URL\('\.\.\/service-worker\.js', import\.meta\.url\)/);
  assert.match(html, /new URL\('\.\.\/', import\.meta\.url\)\.pathname/);
  assert.match(html, /updateViaCache:\s*'none'/);
  assert.match(html, /registration\.update\(\)/);
  assert.match(worker, /const APP_BASE = new URL\('\.\/', self\.registration\.scope\)/);
  assert.match(worker, /url\.pathname\.startsWith\(APP_BASE\.pathname\)/);
  assert.match(worker, /const response = await fetch\(request\)/);
  assert.match(worker, /if \(cached\) return cached/);
  assert.match(worker, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);
  assert.match(worker, /await self\.skipWaiting\(\)/);
  assert.match(worker, /await self\.clients\.claim\(\)/);
  assert.match(worker, /shell-v43/);
  assert.match(worker, /src\/trace-rendering\.js/);
  assert.match(worker, /src\/qa-diagnostics-store\.js/);
  assert.match(worker, /src\/trace-diagnostics\.js/);
  assert.match(worker, /\.\/src\/coordinates\.js/);
  assert.match(worker, /\.\/src\/pointer-samples\.js/);
  assert.match(worker, /src\/build-info\.js/);
  assert.match(worker, /src\/update-policy\.js/);
  assert.match(worker, /\.\/src\/themes\.js/);
  assert.match(worker, /\.\/art\/travelers-map\.svg/);
  assert.match(worker, /\.\/art\/camp-at-dusk\.svg/);
  const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.equal(game.match(/serviceWorker\.register/g)?.length ?? 0, 0,
    'the PWA registers and checks for updates from one module only');
  assert.match(html, /updateViaCache:/);
  const appShell = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const updater = await readFile(new URL('../src/pwa.js', import.meta.url), 'utf8');
  assert.match(appShell, /id="app-update-notice"[^>]*role="status"[^>]*hidden/);
  assert.match(updater, /navigator\.serviceWorker\.addEventListener\('controllerchange', showUpdate\)/);
  assert.match(updater, /maze-adventure:safe-to-update/);
  assert.match(updater, /visibilitychange/);
  assert.equal(canReloadForUpdate('play'), false, 'a live attempt is not discarded for an update');
  assert.equal(canReloadForUpdate('difficulty'), true, 'the inline completion can be safely left through the regular difficulty navigation');
  for (const screen of ['home', 'difficulty', 'settings', 'help', 'about']) assert.equal(canReloadForUpdate(screen), true);
  for (const icon of ['maze-adventure-icon-180.png', 'maze-adventure-icon-192.png', 'maze-adventure-icon-512.png']) {
    assert.ok(worker.includes(icon), `Service worker should cache ${icon}`);
  }
});
