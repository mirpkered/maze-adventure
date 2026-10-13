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
  assert.match(html, /<h1 id="home-title"><img class="title-logo" src="\.\/branding\/maze-adventure-logo\.svg" alt="Maze Adventure" \/><\/h1>/);
  assert.match(html, /id="qa-logo-trigger"[^>]*><img src="\.\/branding\/maze-adventure-emblem\.svg"/);
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*><strong>(?:Daily Challenge|Customize|Trophy Room|Achievements|Statistics)<\/strong>/);
});

test('canonical Mirpworks launch splash covers startup, then reveals the title once', async () => {
  const html = await read('index.html'), worker = await read('service-worker.js'), styles = await read('src/styles.css');
  assert.match(html, /<html lang="en" data-launch-pending>/);
  assert.match(html, /<body data-launch-pending>[\s\S]*?<div class="launch-splash" id="launch-splash" role="img" aria-label="Mirpworks studio logo">[\s\S]*?<img src="\.\/branding\/mirpworks-logo\.jpg" alt=""/);
  assert.match(html, /<main class="app-shell" data-launch-pending inert aria-hidden="true">/);
  assert.match(html, /rel="preload" as="image" href="\.\/branding\/mirpworks-logo\.jpg"/);
  assert.match(html, /\.launch-splash img[^}]*width:\s*min\(72vw, 420px\)[^}]*object-fit:\s*contain/);
  assert.match(html, /env\(safe-area-inset-(?:top|right|bottom|left)\)/);
  assert.match(html, /const fadeInMs = reducedMotion \? 80 : 650/);
  assert.match(html, /const holdMs = reducedMotion \? 40 : 1400/);
  assert.match(html, /const fadeOutMs = reducedMotion \? 100 : 700/);
  assert.match(html, /setTimeout\(\(\) => finish\(true\), fadeInMs \+ holdMs \+ fadeOutMs \+ 750\)/);
  assert.match(html, /addEventListener\('error', \(\) => finish\(true\)/);
  assert.match(html, /window\.requestAnimationFrame\(\(\) =>/);
  assert.match(html, /app\?\.setAttribute\('data-launch-revealing', ''\)/);
  assert.equal((html.match(/id="launch-splash"/g) || []).length, 1, 'the initial document must contain one splash layer');
  assert.ok(html.indexOf("querySelector('#launch-splash')") < html.indexOf('src="./src/game.js"'), 'splash startup must be initialized before the game module');
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.launch-splash \{ transition: opacity 100ms ease !important/);
  assert.match(worker, /shell-v17/);
  assert.match(worker, /\.\/branding\/mirpworks-logo\.jpg/);
  assert.match(styles, /body\[data-screen="home"\]/);
});

test('QA diagnostics are opt-in and report raw touch, legal tip, route cell, collision, and gesture state', async () => {
  const html = await read('index.html'), game = await read('src/game.js'), tracing = await read('src/tracing.js');
  assert.match(html, /id="trace-diagnostics"[^>]*hidden/);
  assert.match(html, /id="trace-diagnostic-tools"[^>]*hidden/);
  assert.match(html, /id="copy-qa-summary"[^>]*>Copy quick summary/);
  assert.match(html, /id="copy-qa-incident"[^>]*>Copy recent incident/);
  assert.match(html, /id="copy-trace-report"[^>]*>Share \/ export full report/);
  assert.match(html, /id="clear-qa-sessions"/);
  assert.match(html, /stored only on this device for up to 24 hours/);
  assert.match(html, /id="reset-trace-log"[^>]*>Reset current log/);
  assert.match(game, /startQaSession\(location, history, deviceStorage\)/);
  assert.match(html, /id="disable-qa-mode"[^>]*>Exit QA mode/);
  assert.match(game, /window\.mazeAdventureTraceDiagnostics = \(\) => traceSession\?\.diagnostics/);
  for (const item of ['pointerType', 'client:', 'maze:', 'acceptedInkEndpoint', 'pencilPosition', 'previousRouteCell', 'candidateReversal', 'resumeAcquisitionDistance', 'resumeAcquisitionThreshold', 'resumeAcquisitionDistancePixels', 'resumeAcquisitionThresholdPixels', 'failureCategory', 'traceHealth', 'gestureState', 'rejectedReason', 'pointerCaptured', 'pointerCanceled', 'layoutId']) assert.ok(game.includes(item), `QA event record should include ${item}`);
  assert.match(game, /navigator\.clipboard\?\.writeText/);
  assert.match(game, /document\.execCommand\('copy'\)/);
  assert.match(game, /traceRecorder\.reset\(\)/);
  assert.match(game, /limit: 400/);
  for (const item of ['raw', 'endpoint', 'cell', 'blocked', 'recovering']) assert.ok(tracing.includes(item));
});

test('logo hold enables session-only QA, consumes explicit launch URLs, and supports deactivation', async () => {
  const html = await read('index.html'), css = await read('src/styles.css'), game = await read('src/game.js'), worker = await read('service-worker.js');
  const qaMode = await read('src/qa-mode.js');
  assert.match(qaMode, /QA_LOGO_HOLD_MS = 3000/);
  assert.match(qaMode, /QA_LOGO_MOVE_LIMIT = 12/);
  assert.match(qaMode, /startQaSession/);
  assert.match(qaMode, /closeQaSession/);
  assert.doesNotMatch(qaMode, /setItem\(|getItem\(/);
  assert.match(game, /startQaSession\(location, history, deviceStorage\)/);
  assert.match(game, /setQaMode\(true\)/);
  assert.match(game, /function syncQaControls\(\)/);
  assert.match(game, /renderMaze\(\); activeScreen\(\$\('#play'\)\); syncQaControls\(\)/);
  assert.match(game, /#disable-qa-mode'\)\.addEventListener\('click', \(\) => setQaMode\(false\)\)/);
  assert.match(game, /#copy-trace-report/);
  assert.match(game, /#reset-trace-log/);
  assert.match(html, /id="trace-diagnostic-tools"[^>]*hidden/);
  assert.match(css, /\.title-branding[\s\S]*?\.qa-emblem-trigger[\s\S]*?touch-action:\s*manipulation/);
  assert.match(css, /\.title-logo[^}]*width:\s*100%/);
  assert.match(worker, /shell-v17/);
  assert.match(worker, /src\/qa-diagnostics-store\.js/);
  assert.match(worker, /\.\/branding\/maze-adventure-logo\.svg/);
  assert.match(worker, /\.\/branding\/maze-adventure-emblem\.svg/);
  assert.match(worker, /\.\/src\/qa-mode\.js/);
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
  const game = await read('src/game.js'), samples = await read('src/pointer-samples.js');
  assert.match(game, /svg\.getScreenCTM\(\)\?\.inverse\(\)/);
  assert.match(game, /pointerMovementSamples\(event\)/);
  assert.match(samples, /getCoalescedEvents/);
  assert.match(samples, /samples\.push\(event\)/);
  assert.match(game, /finalPointerMovement\(traceSession, event\.pointerId, event, lastRawPointer\)/);
  assert.match(game, /window\.addEventListener\('resize', clearPointer\)/);
  assert.match(game, /svgToMazePoint\(pointAt\(event\), PAD, CELL\)/);
});
