# Maze Adventure

**Mirpworks · “Let’s play a game.”**

Maze Adventure is a separate, mobile-first maze puzzle game inspired by the progression structure of Word Search Adventure. Its mazes aim for the familiar look and feel of printed puzzle books, with a warm paper surface and a clean digital path trace.

## Play the foundation

Free Play offers Easy (7×7), Medium (10×10), Hard (15×15), and Expert (20×20), with no unlocks or progression gates. All difficulties use the same maze geometry and Continuous Steering controller. Touch the maze and move your finger away from the touch-down point to steer the pencil; farther movement travels faster. Return to the center or lift your finger to stop. Closed walls stop the pencil, and you can redirect without lifting. Retrace passages to leave a dead end; every accepted pencil mark stays visible. The elapsed timer pauses when the page is hidden or the window loses focus.

Adventure is visibly marked Coming Soon. Story chapters, linked mazes, daily challenges, custom setup, cosmetics, and persistent maze progress are not implemented yet.

The title screen and game surfaces use one of two bundled, offline journal themes: **The Traveler's Map** and **Camp at Dusk**. **Settings → Theme** defaults to Auto, which chooses the other theme from the previous launch when local storage is available; a manual choice stays selected between launches. Without writable local storage, Auto consistently falls back to Traveler's Map. Themes alter color, illustrations, and accents only. A paused maze can open Settings and return to the same attempt without losing its route, ink, or timer.

Maze tracing keeps the legal route and the current pencil position authoritative for collision and completion. Every legal pencil mark remains visible when the player reverses, revisits a dead end, pauses, or lifts a finger. Ink never authorizes movement. Blocked excursions stop the pencil and resume without drawing a connector across a wall. The maze also supports arrow-key passage movement. Pause/resume, same-maze restart, new maze, guarded Home navigation, local sound/appearance settings, instructions, and completion replay are available.

The title screen uses an original horizontal Maze Adventure logo and a matching maze medallion, styled as a Mirpworks sibling to Word Search Adventure while retaining this game's paper-and-pencil identity. The approved square app icon is unchanged. The title screen is designed to fit a typical iPhone portrait display without scrolling and uses a compact landscape layout. Very short viewports can scroll to prevent clipping.

For QA on an installed device, press and hold the small maze medallion beside the title logo for three seconds without moving more than a small amount. Keyboard users can focus the emblem and press **Shift+Enter**. QA mode lasts only for the current app session; `?qa=1` also enables it for one session and is removed from the address bar. Reopening does not restore QA. The QA panel offers a compact summary, a recent incident window, and full report sharing/export. Reports are retained only on this device for up to 24 hours (six sessions, bounded to 180 KB each) while QA is enabled; the app never uploads them. **Reset current log** clears diagnostic events and counters without resetting maze progress. **Clear saved QA sessions** clears only diagnostic history. If local storage is unavailable, the current in-memory report remains usable. Reports omit identifying details. The browser console exposes `window.mazeAdventureTraceDiagnostics()` only while QA is enabled.

## Install on iPhone

Open the published site in Safari, use **Share → Add to Home Screen**, and launch the new icon. The app opens in standalone display mode with a dedicated Home Screen icon and iOS safe-area padding. The normal browser site remains usable without installation.

The service worker caches the app shell for offline startup and uses network-first refreshes while online. Installed apps check for worker updates on launch and when returning to the foreground. A ready update is held while a maze is active; it applies after leaving the attempt or by choosing **Reload now**. This keeps the current attempt intact while making deployed code available. App icons use versioned filenames and are included in the shell cache. When changing shell assets, increment the cache name in `service-worker.js`. Offline use keeps the most recently fetched files available. The current build ID is included in QA reports so a report can be matched to the running version.

The official artwork source is `icons/maze-adventure-approved-source.png`; the published Apple and manifest icons are high-quality resized copies. iOS may keep an already installed Home Screen icon. To refresh it, remove the old Maze Adventure icon from the Home Screen, open the site in Safari, and use **Share → Add to Home Screen** again.

The manifest and service worker use paths relative to the app directory so the same files work locally and under the GitHub Pages `/maze-adventure/` path.

## Requirements

- Node.js 20 or newer (no third-party packages)
- A modern browser

## Development

```sh
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). The local server serves the static files directly; the published site uses GitHub Pages.

## Checks

```sh
npm test
npm run check
```

The automated checks cover seeded maze connectivity and wall symmetry, explicit perimeter openings, canonical rendered wall segments, continuous tracing, turns, sparse input, collision recovery, permanent ink, lift/resume, pointer cancellation, and bounded diagnostics. Five hundred seeded 7×7 layouts and 256 seeded Medium 10×10 layouts are checked; Medium samples also measure junctions, dead ends, branch length, and layout variation. A separate deterministic tracing stress pass covers generated mazes. Automated tests and mobile viewport inspection do not establish physical iPhone behavior.

## Project map

- `src/maze.js` — seeded-capable perfect-maze generation and pure path rules
- `src/contracts.js` — forward-looking data shapes for story, levels, saves, sequences, and cosmetics
- `src/game.js` — screens, controls, timer, stroke display, and service worker registration
- `src/styles.css` — responsive paper-inspired presentation
- `src/tracing.js` — legal route validation, fluid pointer stroke model, and route-to-ink diagnostics
- `src/trace-diagnostics.js` — bounded QA event recorder and reproducible maze-layout fingerprint
- `src/qa-diagnostics-store.js` — QA-only, bounded local report retention and compact report helpers
- `src/preferences.js` — local sound and paper preferences
- `test/maze.test.js`, `test/tracing.test.js`, `test/ui.test.js` — generator, trace, and UI contract checks
- `ROADMAP.md` — phases, priorities, status, and open decisions
- `GAME_DESIGN.md` — confirmed rules and unresolved proposals

## Deploy

The `Deploy to GitHub Pages` workflow publishes the repository root after pushes to `main`. GitHub Pages must be enabled with **GitHub Actions** as its source in repository settings. The workflow provides the live URL after deployment. Until a successful deployment is verified, a pushed commit should not be treated as a published game.

## License

No license has been selected yet. All rights reserved by default; choose a license before inviting outside contributions or reusing the code elsewhere.
