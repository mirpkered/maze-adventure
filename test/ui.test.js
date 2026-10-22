import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('title screen exposes the playable mode and functional supporting controls', async () => {
  const html = await read('index.html');
  assert.match(html, /id="quick-play"/);
  assert.match(html, /id="quick-play-description">Choose your maze challenge\./);
  assert.doesNotMatch(html.match(/<section id="home"[\s\S]*?<\/section>/)?.[0] ?? '', /difficulty-picker|data-start-difficulty|Easy|Medium|7×7|10×10/);
  assert.match(html, /<section id="difficulty"[^>]*hidden/);
  assert.match(html, /data-start-difficulty="easy"[\s\S]*?Easy[\s\S]*?7×7 maze[\s\S]*?data-start-difficulty="medium"[\s\S]*?Medium[\s\S]*?10×10 maze[\s\S]*?data-start-difficulty="hard"[\s\S]*?Hard[\s\S]*?15×15 maze[\s\S]*?data-start-difficulty="expert"[\s\S]*?Expert[\s\S]*?20×20 maze/);
  assert.match(html, /id="difficulty-home">← Home/);
  assert.match(html, /id="play-difficulty">EASY/);
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
  assert.match(worker, /shell-v44/);
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
  for (const item of ['controlSystem', 'activeController', 'pointerType', 'client:', 'maze:', 'difficulty: maze?.difficulty', 'acceptedInkEndpoint', 'pencilPosition', 'previousRouteCell', 'candidateReversal', 'failureCategory', 'traceHealth', 'gestureState', 'rejectedReason', 'pointerCaptured', 'pointerCanceled', 'layoutId']) assert.ok(game.includes(item), `QA event record should include ${item}`);
  assert.match(game, /controlSystem: 'continuous-steering'/, 'QA events identify the single active control system');
  assert.match(game, /window\.addEventListener\('pointercancel', event => finishPointer\(event, true\)\)/);
  assert.match(game, /window\.addEventListener\('lostpointercapture', event => finishPointer\(event, true\)\)/);
  assert.match(game, /navigator\.clipboard\?\.writeText/);
  assert.match(game, /document\.execCommand\('copy'\)/);
  assert.match(game, /traceRecorder\.reset\(\)/);
  assert.match(game, /limit: 400/);
  for (const item of ['endpoint', 'cell', 'blocked', 'controlSystem', 'candidateReversal']) assert.ok(tracing.includes(item));
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
  assert.match(game, /#disable-qa-mode'\)\.addEventListener\('click', \(\) => \{ setQaMode\(false\); returnFromQaConfiguration\(\); \}\)/);
  assert.match(game, /#copy-trace-report/);
  assert.match(game, /#reset-trace-log/);
  assert.match(html, /id="trace-diagnostic-tools"[^>]*hidden/);
  assert.match(css, /\.title-branding[\s\S]*?\.qa-emblem-trigger[\s\S]*?touch-action:\s*manipulation/);
  assert.match(css, /\.title-logo[^}]*width:\s*100%/);
  assert.match(worker, /shell-v44/);
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
  for (const id of ['pause-game', 'restart-maze', 'new-maze', 'back-home', 'completion-panel', 'pause-dialog', 'confirm-dialog']) {
    assert.ok(html.includes(`id="${id}"`), `Missing ${id} control`);
  }
  for (const obsolete of ['next-maze', 'replay-maze', 'complete-home', 'final-time']) assert.ok(!html.includes(`id="${obsolete}"`), `${obsolete} belongs to the retired full-screen results flow`);
  assert.match(game, /#restart-maze'\)\.addEventListener\('click', \(\) => makeMaze\(true\)/);
  assert.match(game, /#new-maze'\)\.addEventListener\('click', \(\) => makeMaze\(\)/);
  assert.match(game, /function completeMaze\(\) \{\s*if \(mazeCompleted\) return;[\s\S]*?document\.body\.dataset\.completed = 'true';[\s\S]*?\$\('#completion-panel'\)\.hidden = false;[\s\S]*?playCompletionSound\(\);\s*\}/);
  assert.match(game, /if \(mazeCompleted \|\| timerId \|\|/);
  assert.match(game, /if \(mazeCompleted \|\| activePointerId !== event\.pointerId/);
  assert.match(game, /if \(!direction \|\| mazeCompleted \|\|/);
  assert.match(game, /mazeCompleted = false;[\s\S]*?\$\('#completion-panel'\)\.hidden = true/);
  assert.match(html, /id="completion-panel"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(html, /class="maze-display-panel maze-paper"[^>]*aria-label="Maze and pencil route"/);
  assert.match(html, /id="timer" aria-label="Elapsed time"/);
  assert.match(html, /id="steering-pad"/);
  assert.match(game, /steeringPad\.hidden = true/);
  assert.doesNotMatch(game, /preferences\.zoomAssist|maze-overview|overview-trail/);
  assert.match(game, /#back-home'\)\.addEventListener\('click', \(\) => \{ clearPointer\(\); showDifficultySelection\(\); \}\)/);
  assert.match(game, /createMazeForDifficulty\(selectedDifficulty\)/);
  assert.match(game, /const screens = \['home', 'difficulty', 'play', 'qa-config'/);
  assert.match(game, /#quick-play'\)\.addEventListener\('click', showDifficultySelection\)/);
  assert.match(game, /#difficulty-home'\)\.addEventListener\('click', showHome\)/);
  assert.match(game, /querySelectorAll\('\[data-start-difficulty\]'\)/);
  assert.match(game, /if \(!Object\.hasOwn\(FREE_PLAY_DIFFICULTIES, difficulty\)\) return;[\s\S]*?selectedDifficulty = difficulty;[\s\S]*?makeMaze\(\)/);
  assert.match(game, /function showDifficultySelection\(\) \{ activeScreen\(\$\('#difficulty'\)\)/);
  assert.doesNotMatch(game.slice(game.indexOf("$('#quick-play').addEventListener"), game.indexOf("for (const option of document.querySelectorAll('[data-start-difficulty]'))")), /makeMaze\(/, 'entering the picker cannot start or reset a maze');
  assert.match(game, /#help-play'\)\.addEventListener\('click', showDifficultySelection\)/);
  assert.match(game, /getMazeGridGeometry\(maze\.width, maze\.height, SIZE, PAD\)/);
  assert.match(game, /selectedDifficulty = maze\.difficulty/);
  assert.match(game, /#pause-game'\)\.addEventListener/);
  assert.match(game, /#back-home'\)\.addEventListener\('click', \(\) => \{ clearPointer\(\); showDifficultySelection\(\); \}\)/);
  assert.match(game, /setAttribute\('inert'/);
  assert.match(game, /event\.key === 'Escape'/);
});

test('Free Play difficulty screen offers large shared-theme cards and only starts after selection', async () => {
  const html = await read('index.html'), css = await read('src/styles.css'), game = await read('src/game.js');
  assert.match(html, /class="screen info-screen difficulty-screen"/);
  assert.match(html, /class="difficulty-card-list"/);
  assert.equal((html.match(/data-start-difficulty=/g) ?? []).length, 4, 'Easy, Medium, Hard, and Expert are immediately available');
  assert.match(html, /data-start-difficulty="hard"[\s\S]*?Start Hard/);
  assert.match(html, /Hard[\s\S]*?15×15 maze[\s\S]*?deeper wrong turns and more decisions/);
  assert.match(html, /data-start-difficulty="expert"[\s\S]*?Expert[\s\S]*?20×20 maze[\s\S]*?Start Expert/);
  assert.match(css, /\.difficulty-card-list \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.difficulty-card-list \{ grid-template-columns: 1fr;/, 'the difficulty list stays touch-friendly in phone layouts');
  assert.match(html, /id="difficulty-title"[^>]*>Choose a difficulty/);
  assert.match(css, /\.difficulty-card\s*\{[^}]*min-height:\s*190px/s);
  assert.match(css, /\.difficulty-card-list\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /body\[data-visual-theme="traveler-map"\] \.difficulty-card/);
  assert.match(css, /body\[data-visual-theme="camp-dusk"\] \.difficulty-card/);
  assert.match(css, /body\[data-visual-theme\] \.difficulty-intro/);
  assert.match(game, /FREE_PLAY_DIFFICULTIES\[selectedDifficulty\]\.label/);
  assert.match(game, /#new-maze'\)\.addEventListener\('click', \(\) => makeMaze\(\)\)/);
  assert.match(game, /#restart-maze'\)\.addEventListener\('click', \(\) => makeMaze\(true\)\)/);
});

test('settings persist sound and appearance, with a keyboard-operable maze', async () => {
  const html = await read('index.html'), game = await read('src/game.js');
  assert.match(html, /id="sound-effects" type="checkbox"/);
  assert.match(html, /id="paper-theme"/);
  assert.match(html, /id="visual-theme"[\s\S]*?value="auto"[\s\S]*?value="traveler-map"[\s\S]*?value="camp-dusk"/);
  assert.match(html, /id="reset-settings"/);
  assert.match(html, /id="open-credits"/);
  assert.match(html, /id="maze"[^>]*tabindex="0"/);
  assert.match(game, /svg\.addEventListener\('keydown'/);
  assert.match(game, /ArrowRight/);
});

test('the gameplay renders one full maze above an independent, touch-safe steering pad', async () => {
  const html = await read('index.html'), game = await read('src/game.js'), css = await read('src/styles.css');
  assert.equal((html.match(/<svg id="maze"/g) ?? []).length, 1);
  assert.match(html, /id="maze"[^>]*tabindex="0"[^>]*role="application"/);
  assert.match(html, /id="steering-pad"/);
  assert.doesNotMatch(html, /id="maze-overview"|id="maze-paper"|id="zoom-assist"|Close View/);
  const toolbar = html.match(/<nav class="game-actions" aria-label="Maze controls">([\s\S]*?)<\/nav>/)?.[1] ?? '';
  assert.ok(toolbar.indexOf('id="back-home"') < toolbar.indexOf('id="restart-maze"'));
  assert.ok(toolbar.indexOf('id="restart-maze"') < toolbar.indexOf('id="new-maze"'));
  assert.match(game, /const svg = \$\('#maze'\)/);
  assert.match(game, /steeringPad\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(game, /svg\.addEventListener\('pointerdown'/);
  assert.match(game, /\$\('#trail'\)\.setAttribute\('d', path\)/);
  assert.match(game, /pointInSteeringPad\(event\)/);
  assert.match(game, /inputPanel: 'steering-pad'/);
  assert.match(game, /svg\.setAttribute\('viewBox', `0 0 \$\{SIZE\} \$\{SIZE\}`\)/);
  assert.match(game, /steeringPointerId !== null/);
  assert.match(game, /#back-home'\)\.addEventListener\('click', \(\) => \{ clearPointer\(\); showDifficultySelection\(\); \}\)/);
  assert.match(css, /\.maze-display-panel\s*\{[^}]*width:\s*min\(100%,\s*60dvh/s);
  assert.match(css, /\.steering-pad\s*\{[^}]*touch-action:\s*none/s);
  assert.doesNotMatch(game, /mazeCamera|zoomAssist|overviewSvg/);
});

test('responsive layout keeps touch suppression scoped to the steering pad and retains safe areas', async () => {
  const css = await read('src/styles.css'), html = await read('index.html');
  assert.match(css, /\.maze-paper,#maze\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /@media \(orientation: landscape\)/);
  assert.match(css, /\.steering-pad\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /safe-area-inset-top/);
  assert.doesNotMatch(css, /(?:^|[},])\s*(?:html|body|\*)\s*\{[^}]*touch-action:\s*none/s);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.doesNotMatch(html, /maximum-scale\s*=|user-scalable\s*=\s*no/i);
  assert.match(css, /body\[data-screen="home"\]\s*\{\s*height:\s*100dvh;\s*overflow:\s*hidden/);
  assert.match(css, /@media \(max-height:\s*570px\)[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.home-art\.title-art/);
});

test('iPhone portrait keeps the full maze and steering field responsive and scoped', async () => {
  const css = await read('src/styles.css');
  assert.match(css, /@media \(max-width:\s*420px\)/);
  assert.match(css, /\.maze-paper\s*\{[^}]*width:\s*min\(100%,\s*calc\(100dvh\s*-\s*205px\)\)/s);
  assert.match(css, /\.maze-paper svg\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.maze-paper,#maze\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /safe-area-inset-(?:left|right)/);
});

test('steering input uses screen-space origin, coalesced samples, and safe rotation cancellation', async () => {
  const game = await read('src/game.js'), samples = await read('src/pointer-samples.js');
  assert.match(game, /steeringPad\.getBoundingClientRect\(\)/, 'pad-local coordinates are used for QA reporting');
  assert.match(game, /pointerMovementSamples\(event\)/);
  assert.match(samples, /getCoalescedEvents/);
  assert.match(samples, /samples\.push\(event\)/);
  assert.doesNotMatch(game, /finalPointerMovement/);
  assert.match(game, /traceSession\.beginSteering\(event\.pointerId\)/);
  assert.match(game, /steeringController\.begin\(event\.pointerId, \{ x: event\.clientX, y: event\.clientY \}\)/);
  assert.match(game, /steeringController\.update\(event\.pointerId, \{ x: sample\.clientX, y: sample\.clientY \}\)/);
  assert.match(game, /window\.addEventListener\('resize', clearPointer\)/);
  assert.match(game, /function pointInSteeringPad\(event\) \{/);
  assert.match(game, /getMazeGridGeometry\(maze\.width, maze\.height, SIZE, PAD\)/);
});
