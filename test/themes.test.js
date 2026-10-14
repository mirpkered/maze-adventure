import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyVisualTheme, chooseLaunchTheme, normalizeThemePreference, THEME_PREFERENCE_OPTIONS, VISUAL_THEMES } from '../src/themes.js';

test('the registry contains only the two curated, self-contained illustrated themes', async () => {
  assert.deepEqual(Object.keys(VISUAL_THEMES), ['traveler-map', 'camp-dusk']);
  assert.deepEqual(THEME_PREFERENCE_OPTIONS.map(option => option.value), ['auto', 'traveler-map', 'camp-dusk']);
  for (const theme of Object.values(VISUAL_THEMES)) {
    assert.ok(theme.name && theme.backgroundTreatment && theme.chromeColor && theme.iconTreatment);
    for (const token of ['pageInk', 'ink', 'muted', 'surface', 'line', 'accent', 'accentHover', 'accentText', 'green', 'focus', 'adventure', 'shadow']) assert.ok(theme.tokens[token], `${theme.id} defines ${token}`);
    const svg = await readFile(new URL(`../${theme.artAsset.slice(2)}`, import.meta.url), 'utf8');
    assert.match(svg, /<svg[^>]+viewBox=/);
    assert.doesNotMatch(svg, /(?:href|src)=["']https?:\/\//, 'illustrations do not load runtime network assets');
  }
  assert.equal(normalizeThemePreference('not-a-theme'), 'auto');
});

test('Auto chooses deterministically from the random source and avoids the previous theme', () => {
  assert.equal(chooseLaunchTheme('auto', null, () => 0), 'traveler-map');
  assert.equal(chooseLaunchTheme('auto', null, () => .99), 'camp-dusk');
  assert.equal(chooseLaunchTheme('auto', 'traveler-map', () => 0), 'camp-dusk');
  assert.equal(chooseLaunchTheme('auto', 'camp-dusk', () => .99), 'traveler-map');
});

test('manual themes stay selected and unavailable storage uses a deterministic Auto fallback', () => {
  assert.equal(chooseLaunchTheme('camp-dusk', 'traveler-map', () => 0, false), 'camp-dusk');
  assert.equal(chooseLaunchTheme('auto', 'camp-dusk', () => .99, false), 'traveler-map');
  assert.equal(chooseLaunchTheme('invalid', null, () => .99, false), 'traveler-map');
});

test('applying a theme updates only shared visual surfaces and the decorative illustration', () => {
  const style = new Map(), body = { dataset: {}, style: { setProperty: (key, value) => style.set(key, value) } };
  const artwork = { src: '' }, caption = { textContent: '' }, themeColor = { content: '' };
  const document = { body, querySelector(selector) { return ({ '#theme-artwork': artwork, '#theme-art-caption': caption, 'meta[name="theme-color"]': themeColor })[selector]; } };
  assert.equal(applyVisualTheme(document, 'camp-dusk'), 'camp-dusk');
  assert.equal(body.dataset.visualTheme, 'camp-dusk');
  assert.equal(body.dataset.themeIcon, 'lantern');
  assert.equal(style.get('--theme-ink'), VISUAL_THEMES['camp-dusk'].tokens.ink);
  assert.equal(artwork.src, './art/camp-at-dusk.svg');
  assert.equal(caption.textContent, VISUAL_THEMES['camp-dusk'].artCaption);
  assert.equal(themeColor.content, VISUAL_THEMES['camp-dusk'].chromeColor);
});

test('theme setting is immediate without recreating gameplay; artwork is in the offline shell', async () => {
  const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(game, /#visual-theme'\)\.addEventListener\('change',[\s\S]*?saveThemePreference/);
  const handler = game.slice(game.indexOf('function saveThemePreference'), game.indexOf('function playCompletionSound'));
  assert.doesNotMatch(handler, /makeMaze\(|createTraceSession\(|renderMaze\(/, 'changing a theme cannot restart or redraw maze geometry');
  assert.match(html, /id="pause-settings"[^>]*>Settings/);
  assert.match(game, /function openSettingsFromPause\(\)[\s\S]*?settingsReturnToPlay = true[\s\S]*?activeScreen\(\$\('#settings'\), \{ safeToUpdate: false \}\)/);
  assert.match(game, /function returnFromSettings\(\)[\s\S]*?paused = false[\s\S]*?activeScreen\(\$\('#play'\)\)/);
  assert.match(game, /#settings-home'\)\.addEventListener\('click', returnFromSettings\)/);
  assert.match(html, /id="visual-theme"[\s\S]*?value="auto"[\s\S]*?value="traveler-map"[\s\S]*?value="camp-dusk"/);
  assert.match(html, /id="theme-artwork"[^>]+\.\/art\/travelers-map\.svg/);
  assert.doesNotMatch(html, /class="art-maze"/, 'the former decorative maze art has been removed');
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?\.theme-artwork\s*\{\s*filter:\s*none/);
  for (const asset of ['./src/themes.js', './art/travelers-map.svg', './art/camp-at-dusk.svg']) assert.ok(worker.includes(asset), `${asset} is cached for offline startup`);
});
