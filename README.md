# Maze Adventure

**Mirpworks · “Let’s play a game.”**

Maze Adventure is a separate, mobile-first maze puzzle game inspired by the progression structure of Word Search Adventure. Its mazes aim for the familiar look and feel of printed puzzle books, with a warm paper surface and a clean digital path trace.

## Play the foundation

The Phase 1 slice includes a Home screen and an Easy Quick Play maze. Trace from START to the flower with a finger, mouse, or pointer. Walls stop movement; retrace the route to leave a dead end. Lifting your pointer preserves your route. The elapsed timer pauses when the page is hidden or the window loses focus.

The Adventure entry is marked as coming later. Story chapters, linked mazes, cosmetics, custom setup, and persistent saves are not implemented yet.

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

The automated checks cover generated-maze connectivity and wall symmetry, dimension validation, illegal path input and wall collision, retracing, and reaching the exit. The browser interaction is designed for touch and pointer input; manually check an iPhone-sized viewport when changing layout or input behavior.

## Project map

- `src/maze.js` — seeded-capable perfect-maze generation and pure path rules
- `src/contracts.js` — forward-looking data shapes for story, levels, saves, sequences, and cosmetics
- `src/game.js` — Phase 1 screens, pointer tracing, and timer
- `src/styles.css` — responsive paper-inspired presentation
- `test/maze.test.js` — rule and generator checks
- `ROADMAP.md` — phases, priorities, status, and open decisions
- `GAME_DESIGN.md` — confirmed rules and unresolved proposals

## Deploy

The `Deploy to GitHub Pages` workflow publishes the repository root after pushes to `main`. GitHub Pages must be enabled with **GitHub Actions** as its source in repository settings. The workflow provides the live URL after deployment. Until a successful deployment is verified, a pushed commit should not be treated as a published game.

## License

No license has been selected yet. All rights reserved by default; choose a license before inviting outside contributions or reusing the code elsewhere.
