export const DEFAULT_PREFERENCES = Object.freeze({ soundEffects: true, paperTheme: 'warm', themePreference: 'auto', lastAutoTheme: null, zoomAssist: true });
export const PREFERENCES_KEY = 'mirpworks.maze-adventure.preferences.v1';

function validTheme(theme) { return theme === 'traveler-map' || theme === 'camp-dusk'; }

export function readPreferences(storage) {
  try {
    storage ??= globalThis.localStorage;
    const saved = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? 'null');
    return {
      soundEffects: typeof saved?.soundEffects === 'boolean' ? saved.soundEffects : DEFAULT_PREFERENCES.soundEffects,
      paperTheme: saved?.paperTheme === 'light' ? 'light' : DEFAULT_PREFERENCES.paperTheme,
      themePreference: saved?.themePreference === 'traveler-map' || saved?.themePreference === 'camp-dusk' ? saved.themePreference : 'auto',
      lastAutoTheme: validTheme(saved?.lastAutoTheme) ? saved.lastAutoTheme : null,
      zoomAssist: typeof saved?.zoomAssist === 'boolean' ? saved.zoomAssist : DEFAULT_PREFERENCES.zoomAssist,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writePreferences(preferences, storage) {
  const normalized = {
    soundEffects: preferences.soundEffects === true,
    paperTheme: preferences.paperTheme === 'light' ? 'light' : 'warm',
    themePreference: preferences.themePreference === 'traveler-map' || preferences.themePreference === 'camp-dusk' ? preferences.themePreference : 'auto',
    lastAutoTheme: validTheme(preferences.lastAutoTheme) ? preferences.lastAutoTheme : null,
    zoomAssist: preferences.zoomAssist !== false,
  };
  try { storage ??= globalThis.localStorage; storage.setItem(PREFERENCES_KEY, JSON.stringify(normalized)); } catch { /* Private browsing may reject storage; settings still work for this session. */ }
  return normalized;
}
