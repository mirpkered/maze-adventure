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

- Maze walls, the legal cell route, and the separately stored current pencil position remain authoritative for movement, collision, retracing, and completion. Permanent ink uses dense, accepted pointer samples inside legal corridors; it is not snapped to cell centers and is never shortened by backtracking. Rendering starts a new SVG subpath after a blocked excursion when reconnecting the pointer would otherwise draw across a wall.
- Pointer lift and cancellation preserve the visible and logical endpoint. Arrow keys are an alternate accessible control and move along one legal passage at a time.
- After wall contact, the input session retains the physical pointer coordinate separately from the accepted pencil position. Recovery is determined by the current legal route and corridor geometry, never by the tail of the permanent ink. Collision samples cannot extend the route or pencil line. The trace is validated in small samples against corridor geometry and the cell graph.
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

## Phase 2F — Tracing reliability and title screen

- The route cell stack is authoritative for legality and completion. Every accepted visual sample is tagged with the route cell that admitted it, so recovery projection can inspect only the current route cell and its immediate predecessor. It cannot select a geometrically nearby sample from an older, wall-separated passage.
- Root cause addressed: blocked-movement recovery previously projected against the entire historical freeform stroke. A touch returning near a tight, parallel corridor could select old ink across a wall. The code could then shorten the visible trail independently of the route stack; after lifting, the legal endpoint and ink endpoint could disagree and the begin/rejoin checks could refuse further input. Recovery now follows route-tail membership and validated corridor cells. Leaving and re-entering the current/previous legal route corridor does not require matching the old ink offset exactly. A backward cell transition trims only the matching route tail.
- QA is available through `?qa=1` for a browser session or by holding the small Maze Adventure title medallion for three seconds. The emblem hold follows Word Search Adventure main `dcf1e39d373c6a1a2b3e3c15cd7051de2ec039cb`: release, cancellation, blur, or movement over 12 px cancels it; Shift+Enter is the keyboard equivalent. Unlike the reference app's session-only QA state, the Maze Adventure emblem action persists a local device preference for installed-PWA use. Start a maze to open QA controls and use **Exit QA mode** to clear that preference. URL activation itself is session-only. The readout displays screen-pixel and mapped maze coordinates, accepted ink endpoint, logical cell, collision flag, gesture/recovery state, and route/ink lengths. The console helper `window.mazeAdventureTraceDiagnostics()` exists only while QA is enabled.
- The title uses an original horizontal SVG wordmark and matching maze medallion. The wordmark borrows the reference game's illustrated, dimensional title treatment in a restrained way; the maze's paper, gold, green, and navy remain its own identity. The approved square Home Screen icon is not used as the title logo and is unchanged. The medallion is the discreet QA hold target.
- The Home screen is a single-screen title composition using the existing Maze Adventure maze illustration, paper/gold surfaces, a prominent Free Play action, a disabled Adventure “Coming Soon” action, and functional Settings, How to Play, About/Credits, and Contact actions. Small landscape viewports have a compact two-column title treatment. Very short screens may scroll rather than clip content. Zoom remains available.
- Deterministic regression tests cover wall recovery beside an older parallel passage, both-direction continuation after collision, route/ink endpoint synchronization, and existing corner, diagonal, lift/resume, and pointer cancellation cases. Automated and browser viewport checks do not establish physical-device reliability; iPhone Safari and installed-PWA testing is still required.

## Phase 2G — Real-device diagnostics

- In `?qa=1` gameplay, the recorder keeps at most 400 recent pointer events and a separate bounded set of 64 significant checkpoints. Checkpoints retain gesture start/end, collision transitions, recovery, and gesture-state changes after routine samples roll out of the event ring. The report includes relative times, pointer type, client/maze coordinates, logical route cell and predecessor, accepted pencil position, gesture state, accepted/blocked reason, pointer capture/cancellation flags, and the stable maze-layout ID. No pointer IDs, identity, account, URL, or profile details are recorded.
- To capture a device issue: open the app URL with `?qa=1`, start a maze, tap **Reset diagnostic log**, reproduce the problem, then tap **Copy diagnostic report** below the maze and paste the result into a support message. If clipboard access is unavailable in the iOS browser or standalone app, the report remains selected in a text box for the system Copy action. The layout ID is checked against the supplied wall definition before replay; the report's event list can be incomplete when earlier samples have rolled off, so an exact initial gesture state is not always recoverable.
- A 7×7 serpentine replay with several turns and five near-wall contacts confirms that the modeled route remains forward/reverse traversable and that ink samples retain route-cell associations. It does not reproduce the reported physical-device lockup, so physical iPhone testing and review of an actual diagnostic report remain required.

## Phase 2I — Captured iPhone trace and permanent ink

- The supplied report excerpt's t=15920 sample moves diagonally from the edge of cell (3,3) toward cell (2,4). The supplied wall layout has no connected edge for that diagonal, so the `closed-or-nonadjacent-edge` rejection is correct. The following samples remain outside the current or immediately connected route corridor; `rejoin-not-route-tail` describes a safe rejection, not evidence of a frozen pointer handler. The log later shows successful acceptance and pointerdown, so the excerpt does not show permanent loss of input.
- The event report says 1,109 earlier events were dropped and the saved route/ink snapshot is from the end of the capture. The exact pre-t=15920 route and ink association cannot be reconstructed reliably. A permanent fixture stores the supplied layout, recorded event excerpt, dropped-event count, and the reproducible t=15919→15920 collision/rejoin decisions. It does not fabricate the missing initial history.
- The serialized wall bits and `maze-7x7-f6f19bbd` fingerprint disagree: the supplied cells (2,4) and (3,4) specify an open east wall on one cell and a closed west wall on its neighbor. The exact supplied flags are retained in the fixture; they produce fingerprint `maze-7x7-758d79f2`. The intended canonical layout remains uncertain until a fresh report resolves that discrepancy. Runtime edge checks now require both cells to agree that a passage is open, and route backtracking checks the edge instead of blindly popping a predecessor.
- Permanent ink and pencil position are separate. Every legal forward or reverse movement appends ink; all marks remain visible until Restart Maze or New Maze. Backtracking changes only the current logical route and pencil position. Ink samples are never consulted to authorize movement. Re-entering after a blocked excursion starts a separate rendered stroke when a connecting line would cross a wall.
- QA regression checks use the supplied report excerpt and deterministic permanent-ink tests for dead ends, repeated traversal, lift/resume, completion, reset, wall collision, no shortcut authorization, and current position independent from the ink tail. These tests do not establish physical iPhone behavior.

### Phase 2F title actions

| Home action | Behavior |
| --- | --- |
| Free Play | Starts a new Easy Quick Play maze. |
| Adventure | Disabled and labeled Coming Soon; story levels are not implemented. |
| Settings | Opens local sound and paper settings. |
| How to Play | Opens instructions and a playable-maze entry. |
| About / Credits | Opens studio/game information and credits. |
| Contact | Opens the device email client with the established Maze Adventure feedback subject and body. |

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
