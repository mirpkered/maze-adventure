# Maze Adventure — Roadmap

This roadmap tracks intended phases, current state, priorities, and unresolved choices. Dates and scope beyond Phase 1 are not commitments.

## Phase 1 — Repository and playable foundation

**Priority: P0 · Status: Complete**

- [x] Establish an independent GitHub repository and static web project.
- [x] Add README, roadmap, and concise game design documentation.
- [x] Add Mirpworks identity and responsive Home screen.
- [x] Keep Adventure visible as a future entry; provide Easy Quick Play.
- [x] Generate a small solvable maze and support touch, mouse, and pointer tracing.
- [x] Stop at walls; require route retracing; preserve the endpoint when input lifts.
- [x] Show elapsed time and pause it when the app is not actively in view.
- [x] Add a completion screen with time and Next Maze.
- [x] Define future data boundaries without building the future game systems.
- [x] Add automated generator and input-rule checks.
- [ ] Verify GitHub Pages publication after workflow deployment.

## Phase 1.1 — Official application icon

**Priority: P1 · Status: Complete**

- [x] Integrate the approved Maze Adventure artwork as resized 180, 192, and 512 pixel PNG icons.
- [x] Update Apple and PWA manifest references, avoid unsafe maskable cropping, and version the app shell cache.
- [x] Document iPhone Home Screen icon refresh steps and verify the published assets.

## Phase 2 — Play usability and Free Play controls

**Priority: P1 · Recommended next**

- Test pointer tracing on iPhone portrait and a range of mobile browsers; adjust corridor forgiveness and responsiveness from observed play.
- Decide and implement a pause/resume affordance and clarify timer behavior around every navigation path.
- Add the Free Play entry point with Quick Play and Custom configuration.
- Keep Quick Play at Medium in the intended full mode; continue to use Easy as the first playable validation target.
- Define dimension ranges and how dimensions combine with the four difficulty labels.
- Add keyboard and assistive-technology behavior where it can preserve maze readability.

### Phase 2C — Fluid tracing and family UI

**Status: Complete · October 11, 2026**

- [x] Separate legal cell-route validation from the in-corridor SVG pencil trail; support sampled smooth pointer motion, physical retraction, lift/resume, and keyboard passage navigation.
- [x] Match the Word Search Adventure hub/card structure, settings/about pattern, modal behavior, responsive surfaces, and Mirpworks control labels while retaining maze-specific artwork and gameplay.
- [x] Add functional pause/resume, same-maze restart, new maze, guarded Home navigation, local sound/appearance preferences, instructions, completion replay, and Next Maze actions.
- [x] Mark campaign/progression menus as unavailable until those systems exist; defer music/ambience controls because the maze game has no music catalog.
- [x] Verify source against Word Search Adventure main at `da1857b6420b94ceb0405080b9604950f23b4f49`. The supplied live reference URL returned GitHub Pages 404 during the audit.
- [x] Retain the physical pointer position through wall collisions and constrain recovery to the existing route, with deterministic collision, repeated-contact, lift/resume, corner retrace, and endpoint-sync tests.
- Record the current iPhone size preference: 20×20 is the practical normal maximum for Free Play; 25×25 remains experimental until physical-device testing. Current playable maze remains 7×7.
- [ ] Validate the updated tracing and portrait/landscape layout on a physical iPhone.

### Phase 2D — Touch precision and continuous drag

**Status: Implemented · physical-device validation pending**

- [x] Use the SVG screen transform for client-to-viewBox mapping, with an aspect-ratio-aware fallback; use browser-coalesced pointer samples where available.
- [x] Keep the visible stroke aligned to accepted touch samples, clamping only at the legal wall-safety inset; retain the 0.4-cell capture radius for off-center retracing.
- [x] Verify scaled coordinate mapping, viewport/orientation changes, collision reversal, repeated contacts, corner retracing, off-center turns, corridor isolation, cancellation, and endpoint synchronization with deterministic tests.
- [ ] Validate touch feel and recovery on a physical iPhone portrait PWA. Current automated tests cannot measure finger comfort or Safari hardware behavior.
- Offset Pencil remains a possible future accessibility/input option for discussion; it is not approved or implemented.

### Phase 2F — Tracing reliability and title screen

**Status: Implemented · automated checks and browser viewport review complete · physical iPhone validation pending**

- [x] Remove global historical-stroke projection from recovery decisions; retain route-cell identity on each visual sample and constrain projection to the current legal route tail.
- [x] Permit recovery inside the current or immediately previous legal corridor without requiring a precise match to old ink; reject unrelated cells and illegal edges, and trim backtracking against the matching route tail only.
- [x] Add a deterministic parallel-corridor regression reproducing cross-wall projection risk, plus collision continuation, forward/reverse, endpoint synchronization, and route legality coverage.
- [x] Add opt-in QA tracing state via `?qa=1` and `window.mazeAdventureTraceDiagnostics()`.
- [x] Replace the scrolling Home hub with a compact title screen and functional Free Play, Settings, How to Play, About/Credits, and Contact actions; mark Adventure as disabled Coming Soon.
- [x] Verify no document scrolling at 390×844 portrait and 844×390 landscape in a desktop browser viewport; the test does not substitute for physical iPhone Safari/PWA testing.
- [ ] Validate wall contact, same-gesture reversal, touch capture, and portrait/landscape title fit on a physical iPhone with the installed PWA.
- [ ] Review QA traces from the physical-device scenario that previously locked up before closing this reliability phase.

## Phase 3 — Save and replay foundation

**Priority: P2**

- Choose local-only versus account-backed persistence; prefer local-first until a product need requires a backend.
- Persist settings, cosmetic selection, and level progress using the documented save contract.
- Decide how replays interact with completion history and timer records.
- Add migration/version behavior before expanding persisted data.

## Phase 4 — First adventure prototype

**Priority: P2**

- Choose a story setting and destination collaboratively.
- Prototype one short story page and a small set of single-maze levels.
- Define the balance between authored, constrained-generated, and procedural layouts.
- Support revisiting story text without losing level progress and pause puzzle timing outside active maze play.
- Validate all curated and generated layouts with deterministic connectivity and route checks.

## Phase 5 — Linked-maze experiences

**Priority: P3**

- Define guided linked-maze connectors, animation, and level completion behavior.
- Design mystery clues and sequence definitions with no early correctness feedback.
- Require every maze to be solved before evaluating an order; an incorrect sequence resets that attempt's maze progress.
- Allow any order on every attempt. Keep stored history from constraining player choices.
- Add adversarial tests for information leaks and sequence retries before release.

## Phase 6 — Art, polish, and cosmetic rewards

**Priority: P3**

- Evolve paper surfaces and regional themes while retaining clear walls and pathways.
- Add optional pencil/trail/paper cosmetics and accessibility controls for visual contrast and motion.
- Consider optional special shapes without locking core difficulty tiers.
- Evaluate any AI-assisted assets or narrative through authored review and puzzle validation.

## Open decisions

- Story world, characters, tone, and overarching objective.
- Adventure count, region organization, final level count, and replay model.
- Exact size ranges and objective difficulty criteria.
- Touch forgiveness and alternate controls after device testing.
- Whether an Offset Pencil accessibility/input option would help players who find direct finger contact obscures the stroke.
- Persistence and privacy expectations.
- Hosting ownership, custom domain, and release process.
