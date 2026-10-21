import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { captureQaReturnState, restoreQaReturnState } from '../src/qa-view-state.js';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('QA configuration is a separate screen and no diagnostic controls live in gameplay', async () => {
  const html = await read('index.html');
  const playStart = html.indexOf('<section id="play"'), configStart = html.indexOf('<section id="qa-config"'), settingsStart = html.indexOf('<section id="settings"');
  const play = html.slice(playStart, configStart), config = html.slice(configStart, settingsStart);
  assert.ok(play.includes('id="maze-overview"') && play.includes('id="maze"'), 'gameplay keeps both maze views');
  assert.doesNotMatch(play, /trace-diagnostic-tools|trace-diagnostics|qa-input-mode/, 'the tracing surface has no diagnostic panel');
  assert.match(play, /id="qa-open-game"[^>]*hidden/, 'the small in-header entry is hidden unless QA is active');
  assert.match(config, /id="trace-diagnostic-tools"[^>]*hidden/);
  assert.doesNotMatch(config, /<select[^>]*(?:input|mode)|Direct Touch/i, 'QA has no retired input-mode controls');
  assert.match(config, /Control system: Continuous Steering/);
  assert.match(config, /id="qa-config-return"/);
  assert.match(html, /id="qa-open-home"[^>]*hidden/);
});

test('opening QA pauses the game and cancels input; returning preserves the same screen and resumes only a running timer', async () => {
  const game = await read('src/game.js'), css = await read('src/styles.css');
  assert.match(game, /function openQaConfiguration\(\)[\s\S]*?paused = true;\s*pauseTimer\(\);\s*clearPointer\(\);/);
  assert.match(game, /function clearPointer\(\)[\s\S]*?if \(steeringPointerId === id\) endSteeringGesture\(id\)/);
  assert.match(game, /function returnFromQaConfiguration\(\)[\s\S]*?restoreQaReturnState\(snapshot/);
  assert.match(css, /body\[data-qa="true"\] #qa-config \.trace-diagnostic-tools:not\(\[hidden\]\)/);
  assert.doesNotMatch(css, /#play \.trace-diagnostic-tools/);
});

test('QA return state restores active gameplay timer but preserves paused and completed attempts', () => {
  const running = captureQaReturnState({ screenId: 'play', paused: false, timerRunning: true });
  assert.deepEqual(restoreQaReturnState(running), { screenId: 'play', paused: false, resumeTimer: true });

  const paused = captureQaReturnState({ screenId: 'play', paused: true, timerRunning: false });
  assert.deepEqual(restoreQaReturnState(paused), { screenId: 'play', paused: true, resumeTimer: false });

  const completed = captureQaReturnState({ screenId: 'play', timerRunning: false, completed: true });
  assert.deepEqual(restoreQaReturnState(completed, { completed: true }), { screenId: 'play', paused: true, resumeTimer: false });

  assert.deepEqual(restoreQaReturnState(running, { documentHidden: true }), { screenId: 'play', paused: false, resumeTimer: false });
  const home = captureQaReturnState({ screenId: 'home', timerRunning: false });
  assert.deepEqual(restoreQaReturnState(home), { screenId: 'home', paused: false, resumeTimer: false });
});

test('QA remains opt-in and always reports the canonical Steering controller', async () => {
  const game = await read('src/game.js'), css = await read('src/styles.css');
  assert.match(game, /\$\('#qa-open-game'\)\.addEventListener\('click', openQaConfiguration\)/);
  assert.match(game, /\$\('#qa-open-home'\)\.addEventListener\('click', openQaConfiguration\)/);
  assert.match(game, /\$\('#disable-qa-mode'\)\.addEventListener\('click', \(\) => \{ setQaMode\(false\); returnFromQaConfiguration\(\); \}\)/);
  assert.match(game, /traceSession\.beginSteering\(event\.pointerId\)/);
  assert.doesNotMatch(game, /qaInputModeState|selectQaInputMode|traceSession\.begin\(|traceSession\.move\(/,
    'no stale controller selector or Direct Touch dispatch is active');
  assert.match(game, /controlSystem: 'continuous-steering'/);
  assert.match(css, /body\[data-screen="play"\][^{]*\{/);
  assert.match(css, /body\[data-screen="qa-config"\] \.app-shell/);
});
