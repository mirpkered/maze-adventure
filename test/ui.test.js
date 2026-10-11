import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('title screen exposes the playable mode and functional supporting controls', async () => {
  const html = await read('index.html');
  assert.match(html, /id="quick-play"/);
  assert.match(html, /id="open-settings"/);
  assert.match(html, /id="open-help"/);
  assert.match(html, /id="open-about"/);
  assert.match(html, /class="hub-card secondary home-contact" href="mailto:contact@mirpworks\.com/);
  assert.match(html, /<button class="hub-card adventure" disabled[^>]*><span class="menu-icon"[^>]*>✿<\/span><strong>Adventure<\/strong><span id="adventure-status">Coming Soon/);
  assert.match(html, /<h1 id="home-title">Maze<br \/><em>Adventure<\/em><\/h1>/);
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*><strong>(?:Daily Challenge|Customize|Trophy Room|Achievements|Statistics)<\/strong>/);
});

test('QA diagnostics are opt-in and report raw touch, legal tip, route cell, collision, and gesture state', async () => {
  const html = await read('index.html'), game = await read('src/game.js'), tracing = await read('src/tracing.js');
  assert.match(html, /id="trace-diagnostics"[^>]*hidden/);
  assert.match(game, /new URLSearchParams\(location\.search\)\.get\('qa'\) === '1'/);
  assert.match(game, /window\.mazeAdventureTraceDiagnostics = \(\) => traceSession\?\.diagnostics/);
  for (const item of ['raw', 'endpoint', 'cell', 'blocked', 'recovering']) assert.ok(tracing.includes(item));
});

test('Contact links prefill Maze Adventure feedback email details', async () => {
  const html = await read('index.html');
  const contactLinks = [...html.matchAll(/<a\b[^>]*href="([^"]*mailto:[^"]*)"[^>]*>(.*?)<\/a>/g)];
  assert.equal(contactLinks.length, 3, 'Home, Settings, and About retain the Contact action');

  for (const [, encodedHref] of contactLinks) {
    const href = encodedHref.replaceAll('&amp;', '&');
    const [recipient, query = ''] = href.slice('mailto:'.length).split('?');
    const parameters = new URLSearchParams(query);
    assert.equal(recipient, 'contact@mirpworks.com');
    assert.equal(parameters.get('subject'), 'Maze Adventure — Feedback');
    assert.equal(parameters.get('body'), 'Sent from: Maze Adventure\n\n[Your message here]');
  }
});

test('gameplay actions keep restart, new maze, pause, and guarded Home behavior distinct', async () => {
  const html = await read('index.html'), game = await read('src/game.js');
  for (const id of ['pause-game', 'restart-maze', 'new-maze', 'next-maze', 'replay-maze', 'back-home', 'pause-dialog', 'confirm-dialog']) {
    assert.ok(html.includes(`id="${id}"`), `Missing ${id} control`);
  }
  assert.match(game, /#restart-maze'\)\.addEventListener\('click', \(\) => makeMaze\(true\)/);
  assert.match(game, /#new-maze'\)\.addEventListener\('click', \(\) => makeMaze\(\)/);
  assert.match(game, /#pause-game'\)\.addEventListener/);
  assert.match(game, /#back-home'\)\.addEventListener\('click', openHomeConfirmation\)/);
  assert.match(game, /setAttribute\('inert'/);
  assert.match(game, /event\.key === 'Escape'/);
});

test('settings persist sound and appearance, with a keyboard-operable maze', async () => {
  const html = await read('index.html'), game = await read('src/game.js');
  assert.match(html, /id="sound-effects" type="checkbox"/);
  assert.match(html, /id="paper-theme"/);
  assert.match(html, /id="reset-settings"/);
  assert.match(html, /id="open-credits"/);
  assert.match(html, /id="maze"[^>]*tabindex="0"/);
  assert.match(game, /svg\.addEventListener\('keydown'/);
  assert.match(game, /ArrowRight/);
});

test('responsive layout keeps touch suppression on the maze and keeps zoom enabled', async () => {
  const css = await read('src/styles.css'), html = await read('index.html');
  assert.match(css, /\.maze-paper,#maze\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /@media \(orientation: landscape\)/);
  assert.match(css, /safe-area-inset-top/);
  assert.doesNotMatch(css, /(?:^|[},])\s*(?:html|body|\*)\s*\{[^}]*touch-action:\s*none/s);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.doesNotMatch(html, /maximum-scale\s*=|user-scalable\s*=\s*no/i);
  assert.match(css, /body\[data-screen="home"\]\s*\{\s*height:\s*100dvh;\s*overflow:\s*hidden/);
  assert.match(css, /@media \(max-height:\s*570px\)[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.home-art\.title-art/);
});

test('iPhone portrait keeps the maze as a responsive, scoped touch target', async () => {
  const css = await read('src/styles.css');
  assert.match(css, /@media \(max-width:\s*420px\)/);
  assert.match(css, /\.maze-paper\s*\{[^}]*width:\s*min\(100%,\s*calc\(100dvh\s*-\s*205px\)\)/s);
  assert.match(css, /\.maze-paper svg\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.maze-paper,#maze\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /safe-area-inset-(?:left|right)/);
});

test('touch input uses the SVG screen transform, coalesced samples, and safe rotation cancellation', async () => {
  const game = await read('src/game.js');
  assert.match(game, /svg\.getScreenCTM\(\)\?\.inverse\(\)/);
  assert.match(game, /event\.getCoalescedEvents\?\./);
  assert.match(game, /window\.addEventListener\('resize', clearPointer\)/);
  assert.match(game, /svgToMazePoint\(pointAt\(event\), PAD, CELL\)/);
});
