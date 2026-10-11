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

test('sound and paper preferences persist and normalize invalid values', () => {
  const storage = memoryStorage();
  assert.deepEqual(readPreferences(storage), DEFAULT_PREFERENCES);
  const saved = writePreferences({ soundEffects: false, paperTheme: 'light', ignored: true }, storage);
  assert.deepEqual(saved, { soundEffects: false, paperTheme: 'light' });
  assert.deepEqual(readPreferences(storage), saved);
  assert.deepEqual(writePreferences({ soundEffects: true, paperTheme: 'unknown' }, storage), { soundEffects: true, paperTheme: 'warm' });
});

test('unavailable or malformed local storage falls back safely', () => {
  assert.deepEqual(readPreferences(memoryStorage('{broken')), DEFAULT_PREFERENCES);
  const storage = { getItem() { return null; }, setItem() { throw new Error('Storage disabled'); } };
  assert.deepEqual(writePreferences({ soundEffects: false }, storage), { soundEffects: false, paperTheme: 'warm' });
});
