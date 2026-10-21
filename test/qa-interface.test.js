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
  assert.match(config, /id="qa-zoom-controls"[^>]*hidden[\s\S]*?id="qa-zoom-magnification"[\s\S]*?value="2"[\s\S]*?value="1\.75"[\s\S]*?value="1\.5"/);
  assert.match(config, /Ordinary play remains at 2\.0×/);
  assert.match(config, /id="qa-layout-controls"[^>]*hidden[\s\S]*?id="qa-close-view-size"[\s\S]*?value="current"[\s\S]*?value="compact"[\s\S]*?value="extra-compact"/);
  assert.match(config, /id="qa-close-view-status"/);
  assert.doesNotMatch(config, /<select[^>]*(?:input|mode)|Direct Touch/i, 'QA has no retired input-mode controls');
  assert.match(config, /Control system: Continuous Steering/);
  assert.match(config, /id="qa-config-return"/);
  assert.match(html, /id="qa-open-home"[^>]*hidden/);
});

test('QA zoom comparison is isolated to the Close View camera and reports the selected value', async () => {
  const game = await read('src/game.js'), camera = await read('src/maze-camera.js'), worker = await read('service-worker.js');
  assert.match(game, /function selectQaZoom\(value\)[\s\S]*?if \(!qaEnabled \|\| \$\('#qa-config'\)\.hidden\) return;[\s\S]*?stopActiveInput\(\)/);
  assert.match(game, /function refreshCameraForZoom\(\)[\s\S]*?createMazeCamera\(\{ viewSize: SIZE, zoom: currentCameraZoom\(\) \}\)[\s\S]*?mazeCamera\.center\(svgPoint\(traceSession\.position\)\)/);
  assert.match(game, /qaSelectedZoomFactor: qaEnabled \? qaZoomState\.value : null/);
  assert.match(camera, /effectiveCameraZoom\([\s\S]*?qaEnabled && isSupportedQaZoom\(qaZoom\) \? qaZoom : ordinaryZoom/);
  assert.match(worker, /shell-v39/);
});

test('QA panel-size selection is independent from magnification and leaves gameplay state authoritative', async () => {
  const game = await read('src/game.js'), css = await read('src/styles.css'), worker = await read('service-worker.js');
  assert.match(game, /createQaCloseViewLayoutState\(\)/);
  assert.match(game, /qaCloseViewLayout\.select\(event\.currentTarget\.value, \{ qaEnabled \}\)/);
  assert.match(game, /qaCloseViewLayout\.reset\(\)/);
  assert.match(game, /renderTrace\(\);\s*updateTraceDiagnostics\(\);\s*queueQaPersistence\(\);/);
  assert.match(game, /qaCloseViewPanelSize: qaEnabled \? qaCloseViewLayout\.value : null/);
  assert.match(game, /qaLayoutMeasurements: qaLayoutMeasurements\(\)/);
  assert.match(game, /applyQaOverviewSizing\(\)[\s\S]*?calculateQaOverviewSize\(/);
  assert.match(css, /body\[data-qa="true"\]\[data-zoom-assist="true"\]\[data-screen="play"\]\[data-qa-close-view-size="compact"\] \.maze-close-panel/);
  assert.match(css, /data-qa-close-view-size="extra-compact"/);
  assert.match(worker, /\.\/src\/qa-layout-state\.js/);
  assert.match(worker, /shell-v39/);
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
