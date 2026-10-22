import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('completion is an inline play-screen state with a single accessible result panel', async () => {
  const html = await read('index.html');
  const game = await read('src/game.js');
  const worker = await read('service-worker.js');

  assert.match(html, /<section id="play"[^>]*class="screen play-screen"/);
  assert.match(html, /<section id="completion-panel" class="completion-panel maze-paper"[^>]*aria-labelledby="completion-title" aria-live="polite" aria-atomic="true" hidden>/);
  assert.match(html, /You found your way!/);
  assert.match(html, /Another little journey complete\./);
  assert.match(html, /class="maze-display-panel maze-paper"[^>]*aria-label="Maze and pencil route"/);
  assert.match(html, /id="steering-pad"/);
  assert.match(html, /id="timer" aria-label="Elapsed time"/);
  assert.match(html, /id="back-home"[\s\S]*?id="restart-maze"[\s\S]*?id="new-maze"/);
  assert.doesNotMatch(html, /id="complete"|id="next-maze"|id="replay-maze"|id="final-time"/);

  assert.match(game, /const screens = \['home', 'difficulty', 'play', 'qa-config', 'settings', 'help', 'about'\]/);
  assert.match(game, /function completeMaze\(\) \{\s*if \(mazeCompleted\) return;[\s\S]*?pauseTimer\(\); displayTime\(\);[\s\S]*?document\.body\.dataset\.completed = 'true';[\s\S]*?\$\('#completion-panel'\)\.hidden = false;/);
  assert.match(game, /if \(mazeCompleted \|\| timerId \|\|/);
  assert.match(game, /if \(mazeCompleted \|\| activePointerId !== event\.pointerId/);
  assert.match(game, /if \(!direction \|\| mazeCompleted \|\|/);
  assert.match(game, /mazeCompleted = false;\s*delete document\.body\.dataset\.completed;\s*\$\('#completion-panel'\)\.hidden = true/);
  assert.match(game, /\$\('#restart-maze'\)\.addEventListener\('click', \(\) => makeMaze\(true\)\)/);
  assert.match(game, /\$\('#new-maze'\)\.addEventListener\('click', \(\) => makeMaze\(\)\)/);
  assert.match(worker, /shell-v41/);
});

test('the full maze stays visible while completion replaces only the steering pad', async () => {
  const css = await read('src/styles.css');
  const game = await read('src/game.js');

  assert.match(css, /\.maze-workspace\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) clamp\(112px,\s*17dvh,\s*150px\)/);
  assert.match(css, /body\[data-completed="true"\] \.maze-workspace\s*\{\s*grid-template-rows:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\s*\.01ms/);
  assert.match(game, /steeringPad\.hidden = true/);
  assert.match(game, /\$\('#completion-panel'\)\.hidden = false/);
  assert.doesNotMatch(game, /preferences\.zoomAssist|maze-overview|overview-trail/);
  assert.match(css, /body\[data-visual-theme="traveler-map"\] :is\([^\n]*\.completion-panel/);
  assert.match(css, /body\[data-visual-theme="camp-dusk"\] :is\([^\n]*\.completion-panel/);
});
