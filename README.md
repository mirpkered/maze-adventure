# Maze Adventure

**Mirpworks · “Let’s play a game.”**

Maze Adventure is a separate, mobile-first maze puzzle game inspired by the progression structure of Word Search Adventure. Its mazes aim for the familiar look and feel of printed puzzle books, with a warm paper surface and a clean digital path trace.

## Play the foundation

The Phase 1 slice includes a Home screen and an Easy Quick Play maze. Trace from START to the flower with a finger, mouse, or pointer. Walls stop movement; retrace the route to leave a dead end. Lifting your pointer preserves your route. The elapsed timer pauses when the page is hidden or the window loses focus.

Adventure is visibly marked Coming Soon. Story chapters, linked mazes, daily challenges, custom setup, cosmetics, and persistent maze progress are not implemented yet.

Maze tracing keeps the legal route and the current pencil position authoritative for collision and completion. Every legal pencil mark remains visible when the player reverses, revisits a dead end, pauses, or lifts a finger. Ink never authorizes movement. Blocked excursions stop the pencil and resume without drawing a connector across a wall. The maze also supports arrow-key passage movement. Pause/resume, same-maze restart, new maze, guarded Home navigation, local sound/appearance settings, instructions, and completion replay are available.

The title screen uses an original horizontal Maze Adventure logo and a matching maze medallion, styled as a Mirpworks sibling to Word Search Adventure while retaining this game's paper-and-pencil identity. The approved square app icon is unchanged. The title screen is designed to fit a typical iPhone portrait display without scrolling and uses a compact landscape layout. Very short viewports can scroll to prevent clipping.

For QA on an installed device, press and hold the small maze medallion beside the title logo for three seconds without moving more than a small amount. Keyboard users can focus the emblem and press **Shift+Enter**. QA mode is saved on that device and survives relaunch. Start a maze to open the QA panel; use **Exit QA mode** there to turn it off. For browser QA, `?qa=1` remains available as a session-only option. In either path, use **Reset diagnostic log** immediately before reproducing an issue, then tap **Copy diagnostic report** below the maze and paste the result into a support message. If iOS does not grant clipboard access, the report appears selected in a text box; use the system Copy action and paste it manually. The report keeps the most recent 400 pointer events plus up to 64 significant checkpoints (gesture starts, collisions, recovery, and state changes), including after routine samples roll out. It includes relative event time, pointer type, client and maze coordinates, logical and ink endpoints, rejection reason, gesture/capture/cancellation state, and a maze-layout fingerprint plus the wall definition. It does not record pointer IDs, names, accounts, URLs, or other profile information. Compare the fingerprint with the wall definition before replay; a report may also omit early route history if more than the retained checkpoints have occurred. The browser console exposes `window.mazeAdventureTraceDiagnostics()` while QA is enabled. QA diagnostics are hidden during normal play.

## Install on iPhone

Open the published site in Safari, use **Share → Add to Home Screen**, and launch the new icon. The app opens in standalone display mode with a dedicated Home Screen icon and iOS safe-area padding. The normal browser site remains usable without installation.

The service worker caches the app shell for offline startup and uses network-first refreshes while online. Installed apps check for the worker update on launch; a newly activated version is shown after a reload or next launch. App icons use versioned filenames and are included in the shell cache. When changing the shell assets, increment the cache name in `service-worker.js`. Offline use keeps the most recently fetched files available.

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

The automated checks cover generated-maze connectivity and wall symmetry, dimension validation, continuous off-center tracing, turns, sparse input, wall collision and recovery beside parallel passages, the supplied iPhone report excerpt, permanent ink through dead-end exploration and backtracking, lift/resume, pointer cancellation, keyboard passage movement, and bounded diagnostic checkpoints. The supplied report confirms the recorded t=15920 diagonal move was correctly blocked, but its 1,109 dropped events prevent exact reconstruction of the initial gesture state. Its wall definition also disagrees with its layout fingerprint. Physical iPhone tracing and a fresh diagnostic capture using the updated checkpoint recorder remain required.

## Project map

- `src/maze.js` — seeded-capable perfect-maze generation and pure path rules
- `src/contracts.js` — forward-looking data shapes for story, levels, saves, sequences, and cosmetics
- `src/game.js` — screens, controls, timer, stroke display, and service worker registration
- `src/styles.css` — responsive paper-inspired presentation
- `src/tracing.js` — legal route validation, fluid pointer stroke model, and route-to-ink diagnostics
- `src/trace-diagnostics.js` — bounded QA event recorder and reproducible maze-layout fingerprint
- `src/preferences.js` — local sound and paper preferences
- `test/maze.test.js`, `test/tracing.test.js`, `test/ui.test.js` — generator, trace, and UI contract checks
- `ROADMAP.md` — phases, priorities, status, and open decisions
- `GAME_DESIGN.md` — confirmed rules and unresolved proposals

## Deploy

The `Deploy to GitHub Pages` workflow publishes the repository root after pushes to `main`. GitHub Pages must be enabled with **GitHub Actions** as its source in repository settings. The workflow provides the live URL after deployment. Until a successful deployment is verified, a pushed commit should not be treated as a published game.

## License

No license has been selected yet. All rights reserved by default; choose a license before inviting outside contributions or reusing the code elsewhere.
