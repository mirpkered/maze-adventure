# Maze Adventure — Game Design

**Status:** Phase 1 foundation. This document separates confirmed decisions from ideas that still need discussion.

## Confirmed

### Player activity

- The core puzzle is a traditional top-down maze: trace from a clear entrance to a clear exit.
- Mobile portrait is the primary layout target. Finger, mouse, and pointer tracing use one continuous interaction model.
- Input is slightly forgiving around corridor centers. Walls cause a hard stop and never impose a penalty.
- Dead ends are left by retracing the existing route. Lifting a pointer preserves progress; tracing resumes from the current endpoint.
- The UI does not show step or backtrack counts.
- Completion time is displayed. There is no mandatory countdown. Elapsed time pauses when the player is away from active play, including a hidden page or an unfocused window.
- No forced tutorial, score, currency, or leaderboard is part of the foundation.

### Modes and difficulty

- Free Play will offer Quick Play and Custom configuration. Quick Play defaults to Medium once the full difficulty selection is available.
- Easy, Medium, Hard, and Expert are the standard difficulty family. Easy is the first implementation and validation target.
- Custom mode is intended to let players choose dimensions and difficulty independently.
- Free Play primarily uses procedural mazes. Generated mazes must be validated as solvable.
- Core difficulties are not locked behind progression.

### Adventure

- Maze Adventure is a new, separate Mirpworks game; Word Search Adventure is structural inspiration only.
- The intended shape is multiple small, independent adventures, initially around ten levels each.
- Adventures may combine single mazes, guided linked mazes, and mystery linked mazes.
- A short story page precedes levels, can be revisited without losing progress, and pauses the puzzle timer.
- Clues can sit naturally in story text. Some levels may have no clue. Story-specific mazes may use curated shapes or themes.
- AI may help propose art, shapes, or narrative. Deterministic checks must guarantee puzzle validity.

### Future linked-maze rules

- Guided linked mazes join individual mazes with animated connecting paths.
- Mystery linked mazes ask players to infer a solving order from story clues.
- A mystery sequence result is withheld until every maze in that attempt is solved.
- An incorrect order is not level completion. A retry requires retracing each maze in the new attempt.
- Prior attempts may be remembered internally but cannot restrict the sequence the player chooses.

### Rewards and presentation

- The visual direction combines familiar puzzle-book clarity, paper-inspired surfaces, and restrained digital response.
- Rewards are primarily cosmetic: pencil styles, trail effects, and paper themes. Optional special maze shapes may be unlockable later.

## Phase 1 decisions

- Easy Quick Play uses a small 7×7 perfect maze generated at runtime.
- The start is the upper-left cell; the exit is the lower-right cell.
- The Phase 1 implementation uses pointer tracing over a cell graph. Movement accepts a nearby cell center only when there is an open neighboring edge; the route cannot jump through a wall or skip a cell.
- The current maze is not persisted. “New maze” and “Next maze” generate a fresh puzzle.

## Proposals and open decisions

These remain proposals rather than commitments:

- Story setting, cast, destination, tone, and illustration style.
- Total adventures, final levels per adventure, and region structure.
- Maze dimensions per difficulty and how difficulty is measured beyond size.
- Whether a given adventure level is handcrafted, generated from constraints, or a mix.
- Whether completed mazes are replayable and how replay affects records.
- Exact timer behavior when switching to a story page, since story pages are outside Phase 1.
- Accessibility options such as alternate trail contrast, larger mazes, and non-drag input.
- Save format, local/cloud persistence, and cosmetic unlock rules.
- Exact celebration and completion-screen treatment.

## Data boundaries

`src/contracts.js` sketches data shapes for maze definitions, story pages, adventure levels, sequence attempts, save data, and cosmetics. The Phase 1 app does not implement those future systems. Mystery sequence validation must remain a game-side rule and must not leak correctness before all mazes in an attempt are solved.
