# Shaped Mazes — Phase 1

## Architecture

Shaped mazes are a distinct Free Play format. `src/shape-masks.js` defines a boolean mask for each silhouette; a `false` cell is not a maze cell. `src/maze.js` builds the canonical reciprocal N/E/S/W wall graph on active cells only. The existing tracer, continuous Steering Pad, ink, timer, exit-crossing completion, completion layout, restart, and rendering consume that same maze object. Rendering and collision use the same mask and wall data.

The production registry is `src/shapes.js`. An entry is playable only when it has a stable ID, mask provider, generator, gameplay adapter, and validated availability. Surprise Me chooses uniformly from that filtered registry with an injectable random source. “Choose a Shape” uses the same registry. A chosen-shape New Maze keeps its shape; New from Surprise Me may select another eligible shape. Restart retains the exact generated maze. No shape is modeled as a Classic difficulty.

## Generation and exit rules

The masked generator uses a randomized spanning-tree maze over the active-cell graph, then samples perimeter boundary edges for entrance and exit. It rejects candidates unless every active cell is connected, the exit has exactly one internal connection, no cells are gated behind the exit, the route and meaningful-decision floors are met, and optional branches stay within bounded quality limits. Generation has a bounded 64-candidate limit. Each shape shares normalized quality rules based on active-cell count: minimum solution length `max(14, ceil(activeCells × .22))`, target length `max(20, ceil(activeCells × .30))`, minimum meaningful decisions `max(3, ceil(sqrt(activeCells) × .35))`, branch floors based on area, and a maximum optional branch of 58% of active cells. These are initial, measured Phase 1 constraints, not difficulty labels.

An entrance and exit are selected from actual active-to-inactive boundary edges, including non-rectangular silhouette edges. Other outer edges remain walls. Entering the exit cell does not complete the maze; only the shared tracer’s legal outward crossing through the declared exit edge does. The final stroke, completion latch, timer stop, and pad transition remain authoritative shared behavior.

## Steering and rendering

Classic speed caps remain Easy 1.725, Medium 2.000, Hard 2.500, and Expert 3.000 cells/s. Shaped mazes use a centralized provisional size profile derived from active-cell count (`getShapedMazeSpeedCap`), bounded between 1.725 and 3.000 cells/s. It leaves the 10 px dead zone, 76 px full-speed deflection, 1.15 response exponent, 50 ms frame cap, and no-inertia controller unchanged. These shape caps still need physical iPhone evaluation.

The rectangular bounding box is fitted without changing cell aspect ratio; inactive areas are transparent paper outside the silhouette. Previews are generated from the exact playable mask. The current Circle is a circular square-cell mask, not a concentric-ring geometric maze. True circular topology remains future work.

## Implemented collection and validation

The nine candidate masks are Castle, Circle, Heart, Star, Diamond, Cross, Arrow, Key, and DJ Penguin. Run `npm run audit:shapes` to regenerate the deterministic 0–499 production audit and its raw JSON records. Results, sample counts, retry rates, timings, route complexity, layout uniqueness, and side distributions are recorded in [SHAPED_MAZES_PHASE1_AUDIT.md](./SHAPED_MAZES_PHASE1_AUDIT.md) and [SHAPED_MAZES_PHASE1_AUDIT.json](./SHAPED_MAZES_PHASE1_AUDIT.json). The audit preserves prior Classic reports and verifies each generated maze by traversing its solution with the shared `createTraceSession` and crossing the declared external exit.

## DJ Penguin provenance and reference inventory

The read-only reference repository was inspected at `mirpkered/why-is-there-a-hole-in-the-middle-of-town`. The adapted local reference image is `art/shapes/dj-penguin-reference.png`, copied from `assets/images/mascots/dj-penguin.png` (471×890, reference Git blob `a608e2019311434157c49f6415403ebb0ceae505`). The source repository also contains `assets/source/mascots/dj-penguin.jpg` (blob `c9e79da57985c778d21d606b97486989e07018cd`). The mask is sampled from that recognizable original character image and then stored as a connected 15×27 active-cell silhouette. No reference repository file was changed. The original asset remains bundled locally and offline; the mask, rather than a decorative backdrop, defines actual playable cells. The reference project’s art backlog identifies DJ Penguin as a custom single asset. No independent license file was found during this inspection; provenance is recorded here for the project owner’s asset review.

| Reference asset | Reference path | Appearance | Mask assessment | Use |
|---|---|---|---|---|
| DJ Penguin | `assets/images/mascots/dj-penguin.png`; source `assets/source/mascots/dj-penguin.jpg` | Original blue penguin with green glasses and orange beak/feet | Distinctive, tall silhouette; converted to a connected 15×27 mask | Used for DJ Penguin mask and bundled as the source reference |
| Duck mascot | Reference mascot artwork | Distinct subject, not DJ Penguin | Could be a later mask candidate after separate connectivity/readability audit | Not imported; never substituted for DJ Penguin |
| Arched small door | Reference object artwork | Recognizable prop | Too small and narrow to define a satisfying maze by itself | Not imported; possible future decoration only |
| “Hole in the middle of town” scene | Reference project’s central subject | Town scene around a hole | Not a single silhouette suitable for the current cell-mask contract | Not imported |
| Heart Attack character/art | Reference character art | Character with heart motif | Not a clean heart silhouette; would misrepresent the shape | Not imported |

Only DJ Penguin was adapted in this phase. The other rows are a small inventory of inspected directions, not an implied asset license or a commitment to reuse them.

## Known limitations and next steps

- Circle uses square cells within a circular mask; no arcs or radial channels exist.
- The character mask is a raster-derived grid silhouette. Its recognizable appearance should be checked on a physical iPhone at all themes and supported sizes.
- Shape movement caps and visual recognizability need device acceptance even though the desktop generator/tracer audit passes.
- Candidate geometry and quality thresholds should be revisited if phone play reveals thin arms or long straight corridors that feel poor.
- Future true circular mazes require a separate graph/geometry design for arc/radial walls, pointer mapping, swept collision, ink, rendering, and camera; they should not be described as this Circle implementation.

