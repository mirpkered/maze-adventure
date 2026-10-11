export const DEFAULT_PREFERENCES = Object.freeze({ soundEffects: true, paperTheme: 'warm' });
export const PREFERENCES_KEY = 'mirpworks.maze-adventure.preferences.v1';

export function readPreferences(storage) {
  try {
    storage ??= globalThis.localStorage;
    const saved = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? 'null');
    return {
      soundEffects: typeof saved?.soundEffects === 'boolean' ? saved.soundEffects : DEFAULT_PREFERENCES.soundEffects,
      paperTheme: saved?.paperTheme === 'light' ? 'light' : DEFAULT_PREFERENCES.paperTheme,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writePreferences(preferences, storage) {
  const normalized = {
    soundEffects: preferences.soundEffects === true,
    paperTheme: preferences.paperTheme === 'light' ? 'light' : 'warm',
  };
  try { storage ??= globalThis.localStorage; storage.setItem(PREFERENCES_KEY, JSON.stringify(normalized)); } catch { /* Private browsing may reject storage; settings still work for this session. */ }
  return normalized;
}
