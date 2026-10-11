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
- Current size preference for future iPhone Free Play: 20×20 is the practical normal maximum; 25×25 remains experimental until tested on device. The current playable slice remains 7×7.

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

## Phase 2C — Tracing and Mirpworks UI conventions

- Maze walls and the legal cell route remain authoritative for movement, collision, retracing, and completion. The visible pencil trail uses dense, accepted pointer samples inside legal corridors; it is not snapped to cell centers. Backtracking trims the trail as the pointer retraces it.
- Pointer lift and cancellation preserve the visible and logical endpoint. Arrow keys are an alternate accessible control and move along one legal passage at a time.
- After wall contact, the input session retains the physical pointer coordinate separately from the legal trail endpoint. Recovery can rejoin only near the existing trail tip or its immediately previous route cell; collision samples cannot extend the route or pencil line. The trace is still validated in small samples against corridor geometry and the cell graph.
- Restart Maze resets the same layout and timer. New Maze and Next Maze generate a fresh layout. Home from active play asks before discarding the attempt. Pause stops the timer; Resume continues it.
- The home hub follows Word Search Adventure's card hierarchy and familiar mode/settings placement while keeping the Maze Adventure paper palette, maze artwork, and pencil trail.
- Sound Effects and Paper Surface are local device preferences. Sound is an optional completion chime. The current game has no music or ambience catalog.
- Word Search Adventure reference source: private repository `mirpkered/WordSearchAdventure`, `main` at `da1857b6420b94ceb0405080b9604950f23b4f49` (audited October 11, 2026). The provided live Pages URL returned GitHub Pages 404 during the audit, so rendered reference layouts could not be compared live.

### Reference controls and Maze Adventure mapping

| Word Search Adventure control | Maze Adventure mapping | Status |
| --- | --- | --- |
| Free Play | Quick Play · Easy | Available; Maze Custom setup is deferred |
| Adventure | Story levels | Coming later; campaign is outside this phase |
| Daily Challenge | Daily maze | Coming later; no daily schedule/progression exists |
| Customize | Cosmetics | Coming later; cosmetic inventory is not implemented |
| Trophy Room | Regional keepsakes | Coming later; no adventure reward collection exists |
| Achievements | Maze achievements | Coming later; no progression records exist |
| Statistics | Maze history | Coming later; attempts are not persisted |
| Settings | Sound toggle, paper appearance, reset, About/contact | Adapted and functional |
| Audio settings: master/music/ambience/SFX, music modes and tracks | Optional completion sound | Sound effect adapted; music and ambience omitted because Maze Adventure has no corresponding tracks or mixer |
| Credits and Contact Mirpworks | About and mail link | Adapted; no contact backend is added |
| New Puzzle, Restart, setup, Main Menu | New Maze, Restart Maze, Home | Adapted with separate behavior and a discard confirmation |
| Word list, category picker, word-search selection, daily puzzle records | None | Word-search specific and not applicable to maze play |

Pause/Resume and the keyboard arrow-key alternative are maze-specific additions. Linked maze sequences, saved statistics, custom setup, and the Adventure campaign remain planned rather than implied by the hub placeholders.

## Phase 2D — Touch tracing refinement

- Touch samples remain validated against the legal cell route and corridor geometry. The visible pencil follows the actual accepted touch coordinates, clamped only at the wall-safety margin; a 0.4-cell capture radius supports off-center reversal and recovery.
- The accepted stroke stays inside a 0.42-cell inset; the legal corridor margin remains 0.46 cells. After leaving a corridor, input may rejoin only near the current route tip or its immediately previous cell and cannot jump to another branch.
- The trace tracks the physical pointer separately from the accepted pencil endpoint so wall contact does not reset the origin. Physical iPhone validation remains necessary to tune the capture feel against different finger sizes and devices.
- Pointer client coordinates map through the inverse SVG screen transform (in CSS pixels; device-pixel ratio is not applied a second time). A meet-aspect-ratio fallback is used where the screen transform is unavailable. Resize/orientation changes safely end the current gesture; the next touch resumes at the accepted endpoint.

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
