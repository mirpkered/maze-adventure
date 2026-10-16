import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, readPreferences, writePreferences } from '../src/preferences.js';

function memoryStorage(value = null) {
  return {
    value,
    getItem(key) { assert.equal(key, PREFERENCES_KEY); return this.value; },
    setItem(key, value) { assert.equal(key, PREFERENCES_KEY); this.value = value; },
  };
}

test('sound, paper, manual theme and automatic rotation history persist and normalize', () => {
  const storage = memoryStorage();
  assert.deepEqual(readPreferences(storage), DEFAULT_PREFERENCES);
  const saved = writePreferences({ soundEffects: false, paperTheme: 'light', themePreference: 'camp-dusk', lastAutoTheme: 'traveler-map', zoomAssist: false, ignored: true }, storage);
  assert.deepEqual(saved, { soundEffects: false, paperTheme: 'light', themePreference: 'camp-dusk', lastAutoTheme: 'traveler-map', zoomAssist: false });
  assert.deepEqual(readPreferences(storage), saved);
  assert.deepEqual(writePreferences({ soundEffects: true, paperTheme: 'unknown', themePreference: 'unknown', lastAutoTheme: 'unknown' }, storage), { soundEffects: true, paperTheme: 'warm', themePreference: 'auto', lastAutoTheme: null, zoomAssist: true });
  assert.deepEqual(readPreferences(memoryStorage(JSON.stringify({ soundEffects: false, paperTheme: 'light' }))), { soundEffects: false, paperTheme: 'light', themePreference: 'auto', lastAutoTheme: null, zoomAssist: true }, 'existing settings retain compatibility and receive the Zoom Assist default');
});

test('unavailable or malformed local storage falls back safely', () => {
  assert.deepEqual(readPreferences(memoryStorage('{broken')), DEFAULT_PREFERENCES);
  const storage = { getItem() { return null; }, setItem() { throw new Error('Storage disabled'); } };
  assert.deepEqual(writePreferences({ soundEffects: false }, storage), { soundEffects: false, paperTheme: 'warm', themePreference: 'auto', lastAutoTheme: null, zoomAssist: true });
});
