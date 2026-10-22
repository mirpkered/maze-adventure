# Maze generation and exit quality audit

**Audit date:** 2026-10-22  
**Repository revision audited:** `f938bb2ce929488f85d9b2c6cae1f72584223968`  
**Scope:** Read-only generation analysis. No player-facing generation, tracing, or UI behavior was changed.

## Executive summary

The report of 25–30% of a maze being inaccessible before finishing is a recurring generator quality problem. In the 1,500 deterministic production-generated mazes measured here, more than 25% of internal cells were exit-gated in 13.8% of Easy, 17.0% of Medium, and 13.6% of Hard mazes. The worst examples had 53–65% exit-gated.

The cause is exit selection. The generator builds a spanning tree, then selects perimeter endpoints for route length and route junctions. It does not require the selected exit cell to be a leaf. Removing a non-leaf exit from a tree disconnects one or more attached subtrees. Those cells can only be visited by entering the exit, which immediately completes the maze.

A terminal exit (internal graph degree one) guarantees zero exit-gated cells for a connected graph. It is feasible under the current solution-length and decision-point rules in 91.6% of sampled Easy topologies, 99.0% of Medium, and 100% of Hard. All four start sides, all four exit sides, and all 16 side-pair arrangements occurred among terminal candidates across the samples. The evidence supports using a terminal exit as the next implementation candidate, with a bounded retry and existing solution-quality constraints retained.

## Current architecture and verified generator behavior

The authoritative implementation is [`src/maze.js`](../src/maze.js).

- `createMaze` uses iterative depth-first backtracking (a randomized recursive-backtracker equivalent) to visit every cell. It adds exactly one internal edge for each newly visited cell.
- `canMove` accepts an internal passage only when both cells agree that their shared N/E/S/W edge is open. Exterior openings do not add out-of-grid graph edges.
- `getShortestPath` uses breadth-first search on that same passage graph.
- Start and finish are selected from non-corner perimeter cells, are distinct, and are then recorded as the only exterior entrance/exit openings.
- Easy (7×7) and Medium (10×10) require at least 18 and 28 solution edges. The endpoint chooser prefers routes containing at least two internal junctions when such pairs exist, otherwise it falls back to the length-qualified pairs. It has a 32-attempt bound.
- Hard (15×15) requires at least 42 edges and six route junctions, prefers 50-edge routes when available, and has an eight-attempt bound.
- The finish is not currently constrained by internal degree. It may be a leaf, corridor, or junction.

All 500 samples per difficulty had exactly `cells − 1` internal passage edges and cycle rank zero: 48 for Easy, 99 for Medium, and 224 for Hard. This confirms that the production graph is a spanning tree / perfect maze in the sampled generator path, rather than a graph with loops. The analyzer itself uses graph reachability and does not assume a tree, and its loop fixture is tested separately.

## Measurement method

The reproducible analyzer is [`scripts/maze-quality-audit.mjs`](../scripts/maze-quality-audit.mjs). It calls the production `createMazeForDifficulty` path with the same Park–Miller seeded random stream used by `test/maze.test.js`, for seeds 0–499 at each difficulty.

For every maze it:

1. Builds adjacency exclusively through `canMove` over in-bounds cells.
2. Finds cells reachable from start with ordinary graph traversal.
3. Repeats reachability with the exit cell removed.
4. Counts exit-gated cells as cells reachable in the full maze but not in the exit-removed traversal, excluding the exit itself.
5. Uses **all internal grid cells** (`width × height`) as the exit-gated percentage denominator. The exit cell is excluded from the numerator but remains in the denominator.
6. Finds the shortest start-to-exit route with `getShortestPath`.
7. Counts accessible optional cells as pre-exit reachable cells outside that selected shortest route. Optional branch sizes are connected components in the induced optional-cell graph, so loop-connected cells would not be double-counted.
8. Records exit internal degree, type, gated component sizes, distance to nearest graph leaf, start/exit sides, maze fingerprint, and generation time.

The analyzer does not mutate maze definitions. Tests cover gated-region splitting, exclusion of the exit cell, an actual graph loop, optional-cell counts, deterministic replay, and non-mutation.

Run the full per-seed JSON report with:

```sh
node scripts/maze-quality-audit.mjs --samples=500 > maze-quality-audit-500.json
```

Use `--summary` for percentile summaries and worst-example diagrams, or `--table` for a compact strategy and performance summary. `--start-seed=N` shifts the deterministic seed range. The generated per-seed JSON is intentionally not committed as a bulk artifact.

## Exit-gated distribution

Each row summarizes 500 mazes; percentile calculations linearly interpolate between adjacent ordered values. Shares are percentages of mazes in the sample.

| Difficulty | Mean | Median | P90 | P95 | Max | 0% gated | >5% | >10% | >20% | >25% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Easy 7×7 | 10.88% | 6.12% | 28.57% | 36.73% | 53.06% | 14.4% | 54.2% | 39.2% | 21.0% | 13.8% |
| Medium 10×10 | 12.35% | 6.00% | 33.00% | 43.00% | 65.00% | 11.6% | 53.6% | 40.6% | 24.2% | 17.0% |
| Hard 15×15 | 9.22% | 3.11% | 29.82% | 40.07% | 61.33% | 12.4% | 41.2% | 28.6% | 15.4% | 13.6% |

The mean gated component size was 5.16 cells for Easy, 11.95 for Medium, and 20.21 for Hard. The exit had at least one other internal connection in 85.6%, 88.4%, and 87.6% of sampled mazes respectively. Across the samples, exits were mostly corridors: 77.0% Easy, 76.2% Medium, and 75.8% Hard; junction exits accounted for 8.6%, 12.2%, and 11.8%. A leaf exit is the only exit type with guaranteed zero gated cells in this tree topology.

## Solution route and optional exploration

The shortest route covered an average of 51.27% of Easy cells, 42.81% of Medium cells, and 37.59% of Hard cells. Separately, a player could explore an average of 18.55, 44.83, and 119.69 non-solution cells before entering the exit. These accessible optional cells are not classified as defects: they are wrong turns and branches that can be explored and retraced before finishing.

The difference matters. An optional branch is reachable without crossing the exit and therefore supports ordinary exploration. An exit-gated region is behind the exit articulation point in the current tree and cannot be visited without first triggering completion.

## Reproducible high-gating examples

The diagrams show canonical walls and cell classes. `S` is start, `E` is exit, `*` is the selected shortest solution path, `o` is an accessible optional cell, and `#` is exit-gated. The external entrance and exit are the breaks in the perimeter.

### Easy — seed 406, layout `maze-7x7-d048dd27`

- Start: `(1,0)` north; exit: `(3,0)` north.
- Exit degree: 2, a corridor. Solution: 18 edges.
- Gated: 26 / 49 = **53.06%**, one region of 26 cells.
- Accessible optional cells before exit: 4; largest component: 2.

```text
+---+   +---+   +---+---+---+
| o   S | *   E   #   # | # |
+---+   +   +---+---+   +   +
| *   * | *   * | #   #   # |
+   +---+   +   +---+---+   +
| * | o   o | *   * | #   # |
+   +---+---+   +   +---+   +
| *   *   * | o | *   * | # |
+---+---+   +---+---+   +   +
| #   # | *   *   *   * | # |
+---+   +---+---+---+---+   +
| #   # | #   #   #   #   # |
+   +---+   +---+---+---+---+
| #   #   #   #   #   #   # |
+---+---+---+---+---+---+---+
```

### Medium — seed 181, layout `maze-10x10-cfb7cb9c`

- Start: `(3,0)` north; exit: `(0,7)` west.
- Exit degree: 2, a corridor. Solution: 28 edges.
- Gated: 65 / 100 = **65%**, one region of 65 cells.
- Accessible optional cells before exit: 6; largest component: 3.

```text
+---+---+---+   +---+---+---+---+---+---+
| o   o   o   S   *   * | #   #   #   # |
+---+---+---+---+---+   +   +---+   +---+
| *   *   *   * | *   * | #   # | #   # |
+   +---+---+   +   +---+---+---+---+   +
| * | o   o | *   * | #   #   #   #   # |
+   +---+   +---+---+---+   +---+---+   +
| *   *   * | #   #   #   # | #   #   # |
+---+---+   +---+---+   +---+   +---+---+
| *   * | *   *   * | # | # | # | #   # |
+   +   +---+---+   +   +   +   +---+   +
| * | *   o | *   * | # | #   # | #   # |
+   +   +---+   +---+   +   +---+   +   +
| * | *   *   * | #   # | # | #   # | # |
+   +---+---+---+   +---+   +   +---+   +
  E | #   #   # | # | #   # | #   # | # |
+   +   +---+   +   +---+   +---+   +   +
| # | # | #   # | #   # | #   #   # | # |
+   +   +   +---+---+   +---+---+---+   +
| #   # | #   #   #   # | #   #   #   # |
+---+---+---+---+---+---+---+---+---+---+
```

### Hard — seed 69, layout `maze-15x15-61f6ed6f`

- Start: `(11,0)` north; exit: `(14,11)` east.
- Exit degree: 2, a corridor. Solution: 52 edges.
- Gated: 138 / 225 = **61.33%**, one region of 138 cells.
- Accessible optional cells before exit: 34; largest component: 10.

```text
+---+---+---+---+---+---+---+---+---+---+---+   +---+---+
| #   # | #   #   #   #   #   #   # | o | o   S   *   *   * |
+---+   +---+---+---+---+   +---+   +   +   +---+---+---+   +
| # | #   #   # | #   #   # | #   # | o   o | *   *   *   * |
+   +---+---+   +   +---+---+   +---+---+---+   +---+---+   +
| #   #   # | #   # | # | #   # | o   *   * | * | o | o   o |
+   +---+   +---+---+   +   +---+---+   +   +   +   +   +---+
| # | #   #   #   #   # | # | *   *   * | *   * | o   o   o |
+   +   +---+---+   +---+   +   +---+---+   +---+---+---+   +
| # | # | #   #   # | #   # | * | o   o   o | *   *   * | o |
+   +   +---+---+---+   +---+   +---+   +---+   +---+   +   +
| # | #   #   #   #   # | o   *   * | o | *   * | o | * | o |
+   +---+---+---+---+---+   +---+   +---+   +---+   +   +   +
| # | #   #   # | o | o   o   o | *   *   *   o   o | * | o |
+   +   +---+   +   +   +---+---+---+---+---+---+---+   +   +
| #   # | # | # | o   o | #   #   #   # | *   *   * | * | o |
+---+---+   +   +---+   +   +---+---+   +   +---+   +   +---+
| #   #   # | #   # | o | # | # | #   # | *   * | * | *   * |
+---+---+   +---+   +---+   +   +   +---+---+   +   +---+   +
| #   # | #   # | #   #   # | # | # | o   *   * | *   *   * |
+   +   +   +---+---+---+---+   +   +   +   +---+---+---+   +
| # | #   # | #   #   #   #   #   # | o | * | *   * | o   o |
+   +---+   +   +---+---+---+---+---+---+   +   +   +---+---+
| #   # | # | # | #   #   #   # | #   # | *   * | * | *   E  
+   +   +   +   +   +   +---+   +   +   +---+---+   +   +   +
| # | # | # | # | # | #   # | #   # | #   #   # | *   * | # |
+   +   +---+   +---+---+   +---+---+---+---+   +---+---+   +
| # | # | #   # | #   # | #   #   # | #   # | # | #   # | # |
+   +   +   +---+   +   +---+---+   +   +---+   +   +   +   +
| # | #   #   #   # | #   #   #   # | #   #   #   # | #   # |
+---+---+---+---+---+---+---+---+---+---+---+---+---+---+---+
```

## Exit-selection strategy comparison

For each sampled production topology, the script re-enumerated perimeter endpoint pairs using the current route-length and junction selection rules, then evaluated each pair with graph reachability after removing its candidate exit. The topology distribution is **conditioned on the existing generator having accepted a maze**; this is a feasibility estimate for a stricter follow-up rule, not an exhaustive claim about every raw random tree.

| Difficulty | Max attempts | Terminal / 0% viability | Mean terminal pairs | ≤2% viability | Mean ≤2% pairs | ≤5% viability | Mean ≤5% pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Easy | 32 | 91.6% | 14.0 | 91.6% | 14.0 | 100% | 45.4 |
| Medium | 32 | 99.0% | 44.2 | 100% | 126.4 | 100% | 188.2 |
| Hard | 8 | 100% | 115.7 | 100% | 370.8 | 100% | 534.2 |

Across all three difficulties, all four start sides, all four exit sides, and all 16 start-side/exit-side arrangements were represented by at least one candidate for each threshold. This is sample-wide diversity; it does not mean every individual maze can offer all 16 arrangements.

### Strategy A — Require a terminal exit

**Best-supported follow-up.** In a connected graph, deleting a degree-one exit leaves every other vertex connected; therefore it guarantees zero exit-gated cells. This guarantee applies to both trees and graphs with loops. In the current tree generator, terminal degree is a cheap local test. It can be applied while collecting already-computed endpoint pairs, without running a reachability search for each pair.

The candidate route lengths still respect the current minimums and route-junction rules. For the eligible terminal pairs, pooled route lengths were: Easy mean 24.78 / median 24 edges; Medium mean 43.28 / median 41; Hard mean 86.04 / median 83. These are candidate-pair-weighted measurements, not predicted per-maze selected-route averages. The full Maze/side combination set stayed represented over the sample. The observed topology viability implies approximately 1.09 independent tree attempts per accepted Easy maze, 1.01 for Medium, and 1.00 for Hard. Those retry estimates are conditional on the sampled already-accepted trees. A stricter implementation should retain a bounded retry and throw or fall back safely if no qualifying pair is found.

An exit leaf may lie close to the start or on the same perimeter side, but the current candidate rules already reject paths below the difficulty floor; Hard's route-junction and preferred 50-edge constraints also remain in force. Endpoint side variety remains possible, though the distribution may shift and should be asserted in a future generator regression.

### Strategy B — Permit a small gated threshold

This trades a small inaccessible tail for greater endpoint candidate availability. A 2% limit matched zero gating on Easy because a single gated cell is already 2.04% of 49; it admitted one or two-cell regions for larger mazes. A 5% limit had candidates in every sampled topology, but can still hide up to 2 Easy, 5 Medium, or 11 Hard cells (integer counts below the exact percentage boundary). Since the terminal rule was feasible in all but five Medium and 42 Easy sample topologies, a nonzero threshold is not needed based on this sample.

### Strategy C — Optimize path quality

Continue enforcing minimum solution lengths and Hard decision-point targets before selecting among viable terminal pairs. Choosing the longest available pair can reduce endpoint variety and can disproportionately pick exits on a subset of sides. Prefer the existing quality pool and randomized choice within that pool over adding a new maximum-route optimization. Future tests should track the selected route-length percentiles as well as edge counts.

### Strategy D — Post-generation validation and retry

The current generator already retries when it cannot find any endpoint pair meeting its quality rules (up to 32 attempts for Easy/Medium, eight for Hard). Terminal-exit filtering can use that mechanism. Based on candidate viability within these sampled trees, expected additional work is modest, but exact stricter-policy attempt counts were not measured because the production function does not expose failed topology attempts for Easy/Medium. The new rule should log or expose its attempt count in QA only if that is useful to diagnose an actual generation stall.

## Performance measurements

Measured in Node.js 24 on the audit workstation; these are code-path timings, not iPhone measurements. Times are per maze over 500 calls and include ordinary production generation for the generation column. The analysis column additionally performs graph metrics and exhaustive current-quality endpoint-pair threshold feasibility checks; it is not the cost of a simple terminal-degree filter.

| Difficulty | Generate mean / P95 / max | Analyzer mean / P95 / max | Measured attempts mean / max |
| --- | --- | --- | --- |
| Easy | 2.59 / 4.61 / 10.86 ms | 1.95 / 3.72 / 6.67 ms | 1 / 1 |
| Medium | 16.88 / 31.37 / 54.58 ms | 8.25 / 14.10 / 29.11 ms | 1 / 1 |
| Hard | 9.26 / 15.79 / 27.45 ms | 29.94 / 47.45 / 60.64 ms | 1 / 1 |

The generator returns a generation-attempt count for Hard. For Easy and Medium, the audit infers it from the seeded random-call count: each complete DFS tree consumes `cells − 1` random choices and a successful endpoint selection consumes one more. All sampled mazes used one attempt. The measurements show no current gameplay startup concern in this environment. The much larger Hard analyzer time comes from evaluating every exit-removed graph component and candidate pair; do not put that exhaustive audit in the interactive launch path. A production terminal-degree filter should reuse existing BFS/path work and add only a local degree check plus occasional retries.

For planned 20×20 mazes, the perimeter has more candidate endpoints and the graph has 400 cells, so the exhaustive audit's graph work will grow. The production terminal rule itself remains a degree check on exit candidates. Keep the audit out of gameplay and include a 20×20 stress batch before Expert is implemented.

## QA reporting recommendation

For a copied per-maze generator-quality diagnostic, include only:

- Build ID, difficulty, dimensions, seed (when available), and layout fingerprint.
- Start and exit coordinates and perimeter sides.
- Exit internal degree and type.
- Shortest solution length.
- Exit-gated cell count and percentage.
- Accessible optional-cell count and largest optional component.
- Generation attempt count when the generator exposes it.

Keep these values in the QA report/export, not in the normal gameplay interface. The audit script's per-maze output already records these measurements except that Easy/Medium retry count is inferred during this sample; a future production diagnostic should report the actual attempt count rather than infer it.

## Recommended generator acceptance criteria

For a follow-up implementation assignment:

1. Select only an exit with internal degree one. This makes exit-gated cells exactly zero in a connected maze.
2. Preserve current non-corner perimeter openings, start/exit distinction, all-four-side variety, solvability, Easy/Medium minimum path lengths, and Hard's route-junction and target-length rules.
3. Keep a bounded retry, reusing the current limits initially. Record real retry counts in deterministic tests. If the existing limit proves insufficient in broader samples, adjust only with measured evidence.
4. Add seeded batches of at least 500 mazes per difficulty asserting zero gated cells, reciprocal walls, intended exterior openings, path floors, Hard junction targets, and layout/side variety.
5. Add a graph-loop unit fixture to prove the general reachability utility does not falsely label alternate-route cells as gated, even though the current generator emits trees.
6. Preserve physical iPhone steering unchanged. The only device check needed is confirming that generated start/exit markers remain visible at all edges; the graph constraint itself does not change pointer or collision behavior.

**Proposed allowable gated percentage:** 0%. The measured terminal candidate supply is strong, and a terminal exit has a simple correctness proof. Treat this as a recommendation for the next implementation pass, not a change made by this audit.

## Validation and remaining uncertainty

- Full deterministic sample: 500 Easy + 500 Medium + 500 Hard, seeds 0–499.
- Every sample was connected; all 1,500 were trees with the expected edge count.
- Analyzer tests: exit exclusion and component sizes, loop handling, optional cells, deterministic output, and non-mutation.
- The 25–30% user-reported experience is recurring, with 13.6–17.0% of sampled mazes exceeding 25% gated and 15.4–24.2% exceeding 20%.
- Sampling is finite and runs on Node, not mobile hardware. Terminal feasibility percentages are conditioned on current accepted topology generation. Broader seeds and actual iPhone visual marker checks belong in the implementation acceptance pass.
- No production generator change, player-facing change, build update, or deployment was made in this audit.
