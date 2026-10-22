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
  const saved = writePreferences({ soundEffects: false, paperTheme: 'light', themePreference: 'camp-dusk', lastAutoTheme: 'traveler-map', zoomAssist: false, controlMode: 'direct-touch', ignored: true }, storage);
  assert.deepEqual(saved, { soundEffects: false, paperTheme: 'light', themePreference: 'camp-dusk', lastAutoTheme: 'traveler-map' });
  assert.deepEqual(readPreferences(storage), saved);
  assert.deepEqual(writePreferences({ soundEffects: true, paperTheme: 'unknown', themePreference: 'unknown', lastAutoTheme: 'unknown' }, storage), { soundEffects: true, paperTheme: 'warm', themePreference: 'auto', lastAutoTheme: null });
  assert.deepEqual(readPreferences(memoryStorage(JSON.stringify({ soundEffects: false, paperTheme: 'light', controlMode: 'direct-touch', zoomAssist: false }))), { soundEffects: false, paperTheme: 'light', themePreference: 'auto', lastAutoTheme: null }, 'obsolete workspace and input settings are ignored while player preferences remain intact');
});

test('obsolete input-mode fields are ignored and never written back', () => {
  const storage = memoryStorage();
  storage.value = JSON.stringify({ soundEffects: false, controlMode: 'direct-touch', inputMode: 'direct' });
  const loaded = readPreferences(storage);
  assert.equal(loaded.soundEffects, false);
  assert.equal(Object.hasOwn(loaded, 'controlMode'), false);
  assert.equal(Object.hasOwn(loaded, 'inputMode'), false);
  const saved = writePreferences({ ...loaded, controlMode: 'direct-touch' }, storage);
  assert.equal(Object.hasOwn(saved, 'controlMode'), false);
  assert.equal(JSON.parse(storage.value).controlMode, undefined);
});

test('unavailable or malformed local storage falls back safely', () => {
  assert.deepEqual(readPreferences(memoryStorage('{broken')), DEFAULT_PREFERENCES);
  const storage = { getItem() { return null; }, setItem() { throw new Error('Storage disabled'); } };
  assert.deepEqual(writePreferences({ soundEffects: false }, storage), { soundEffects: false, paperTheme: 'warm', themePreference: 'auto', lastAutoTheme: null });
});

test('legacy Zoom Assist is retired during preference normalization without losing theme or sound settings', () => {
  const storage = memoryStorage(JSON.stringify({ soundEffects: false, paperTheme: 'light', themePreference: 'camp-dusk', lastAutoTheme: 'traveler-map', zoomAssist: false }));
  const migrated = writePreferences(readPreferences(storage), storage);
  assert.deepEqual(migrated, { soundEffects: false, paperTheme: 'light', themePreference: 'camp-dusk', lastAutoTheme: 'traveler-map' });
  assert.equal(Object.hasOwn(JSON.parse(storage.value), 'zoomAssist'), false);
});
