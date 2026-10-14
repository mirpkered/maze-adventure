export const VISUAL_THEMES = Object.freeze({
  "traveler-map": Object.freeze({
    id: "traveler-map",
    name: "The Traveler's Map",
    artAsset: "./art/travelers-map.svg",
    artCaption: "FIELD NOTES · THE LONG WAY ROUND",
    iconTreatment: "compass",
    chromeColor: "#dfcfaa",
    backgroundTreatment: "repeating-radial-gradient(ellipse at 58% 44%, transparent 0 47px, rgba(86,103,67,.055) 48px 49px, transparent 50px 76px), radial-gradient(ellipse at 76% 8%, rgba(255,239,188,.82), transparent 25%), radial-gradient(ellipse at 9% 88%, rgba(93,119,76,.25), transparent 35%), linear-gradient(135deg, #e6d5ad, #d3c194)",
    tokens: Object.freeze({
      pageInk: "#344632", ink: "#344632", muted: "#5e654f", surface: "#f7edcf", line: "#c8b27b",
      accent: "#a86629", accentHover: "#89501f", accentText: "#fff9e8", green: "#496344",
      focus: "#a86629", adventure: "#e9ddb9", shadow: "rgba(65,54,32,.18)", paperTint: "#f7edcf",
    }),
  }),
  "camp-dusk": Object.freeze({
    id: "camp-dusk",
    name: "Camp at Dusk",
    artAsset: "./art/camp-at-dusk.svg",
    artCaption: "CAMP NOTES · UNDER THE PINES",
    iconTreatment: "lantern",
    chromeColor: "#1a2c40",
    backgroundTreatment: "radial-gradient(circle at 13% 10%, #f4dfbc88 0 1px, transparent 2px), radial-gradient(circle at 57% 6%, #f4dfbc77 0 1px, transparent 2px), radial-gradient(circle at 87% 24%, #f4dfbc88 0 1px, transparent 2px), radial-gradient(ellipse at 82% 9%, rgba(225,160,74,.25), transparent 23%), radial-gradient(ellipse at 10% 82%, rgba(57,101,112,.32), transparent 36%), radial-gradient(ellipse at 50% 112%, rgba(7,18,27,.48), transparent 52%), linear-gradient(145deg, #1a2c40, #243b50 65%, #334c5a)",
    tokens: Object.freeze({
      pageInk: "#f7edcf", ink: "#293f50", muted: "#5e7078", surface: "#fff4dc", line: "#ddcda7",
      accent: "#b96d29", accentHover: "#94511d", accentText: "#fffaf0", green: "#526f68",
      focus: "#e2a64d", adventure: "#e8e3d2", shadow: "rgba(4,14,27,.32)", paperTint: "#fff4dc",
    }),
  }),
});

export const THEME_PREFERENCE_OPTIONS = Object.freeze([
  Object.freeze({ value: "auto", label: "Auto · rotate each launch" }),
  Object.freeze({ value: "traveler-map", label: "The Traveler's Map" }),
  Object.freeze({ value: "camp-dusk", label: "Camp at Dusk" }),
]);

export function normalizeThemePreference(value) {
  return value === "traveler-map" || value === "camp-dusk" ? value : "auto";
}

export function chooseLaunchTheme(preference = "auto", previousTheme = null, random = Math.random, storageAvailable = true) {
  const normalized = normalizeThemePreference(preference);
  if (normalized !== "auto") return normalized;
  if (!storageAvailable) return "traveler-map";
  const candidates = Object.keys(VISUAL_THEMES).filter(id => id !== previousTheme);
  const available = candidates.length ? candidates : Object.keys(VISUAL_THEMES);
  const roll = Number(random());
  const index = Math.min(available.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * available.length)));
  return available[index];
}

export function applyVisualTheme(document, themeId) {
  const theme = VISUAL_THEMES[themeId] ?? VISUAL_THEMES["traveler-map"];
  document.body.dataset.visualTheme = theme.id;
  document.body.dataset.themeIcon = theme.iconTreatment;
  document.body.style.setProperty("--theme-background", theme.backgroundTreatment);
  for (const [key, value] of Object.entries(theme.tokens)) document.body.style.setProperty(`--theme-${key}`, value);
  const artwork = document.querySelector("#theme-artwork");
  if (artwork) artwork.src = theme.artAsset;
  const caption = document.querySelector("#theme-art-caption");
  if (caption) caption.textContent = theme.artCaption;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme.chromeColor;
  return theme.id;
}
