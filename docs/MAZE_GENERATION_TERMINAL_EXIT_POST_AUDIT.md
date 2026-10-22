# Terminal-exit generator post-correction audit

**Audit date:** 2026-10-22  
**Baseline generator:** `f938bb2ce929488f85d9b2c6cae1f72584223968`  
**Correction:** terminal-exit selection on shipped Easy, Medium, and Hard grids  
**Sample:** 500 newly generated mazes per difficulty; Park–Miller seeds 0–499  
**Status:** All 1,500 post-correction samples passed the stated acceptance checks.

## Summary

The prior audit found exit-gated cells in 85.6% of Easy, 88.4% of Medium, and 87.6% of Hard samples. The corrected production generator now selects only an exit with exactly one internal passage connection. The fresh post-correction sample had zero exit-gated cells in every maze, and all 1,500 exits were terminal.

The change leaves maze generation topology, wall representation, tracing, themes, and user interface unchanged. Candidate exit pairs still pass the existing path-quality rules before selection. When a generated topology has no qualifying pair, the existing bounded retry path generates another topology. The generator now includes its actual attempt count on all shipped difficulties so this cost is visible and testable. Custom grid dimensions continue using their previous exit-selection behavior.

## Method

The post-correction batch was run through `createMazeForDifficulty`, the production generation entry point, using the same deterministic Park–Miller stream and seeds as the original audit. `scripts/maze-quality-audit.mjs --samples=500 --summary` measured each generated layout. The audit constructs adjacency from reciprocal `canMove` checks, computes reachability with the exit removed, counts exit-gated cells excluding the exit, and records route length, route junctions, perimeter sides, generation time, and actual retry count.

The baseline comparison was freshly replayed from commit `f938bb2` using the same seeds and a direct generator timing harness. The historical report remains available at [`MAZE_GENERATION_EXIT_QUALITY_AUDIT.md`](./MAZE_GENERATION_EXIT_QUALITY_AUDIT.md); its original measurements are retained there. Timings vary with process and workstation load, so the comparison below uses the paired baseline replay rather than substituting the older timing run.

Run the post-correction batch with:

```sh
node scripts/maze-quality-audit.mjs --samples=500 --summary
```

The full per-seed records can be exported by omitting `--summary` and redirecting output to a local file. No bulk sample file is committed.

## Before and after

Exit-gated percentages use all internal cells (`width × height`) as the denominator; the exit itself is excluded from the count but remains in the denominator. `0% gated` is the proportion of mazes with no exit-gated cells. Route length is the shortest legal number of cell-to-cell edges. Route junctions count degree-three-or-higher cells strictly between start and exit.

| Difficulty | Mazes with any gated cells before → after | Zero-gated mazes before → after | Mean gated % before → after | Maximum gated % before → after | Terminal exits before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Easy 7×7 | 85.6% → **0%** | 14.4% → **100%** | 10.88% → **0%** | 53.06% → **0%** | 14.4% → **100%** |
| Medium 10×10 | 88.4% → **0%** | 11.6% → **100%** | 12.35% → **0%** | 65.00% → **0%** | 11.6% → **100%** |
| Hard 15×15 | 87.6% → **0%** | 12.4% → **100%** | 9.22% → **0%** | 61.33% → **0%** | 12.4% → **100%** |

| Difficulty | Solution edges mean before → after | Median before → after | Route junctions mean before → after | Median before → after |
| --- | ---: | ---: | ---: | ---: |
| Easy | 24.12 → **24.82** | 23 → **24** | 2.99 → **3.36** | 3 → **3** |
| Medium | 41.81 → **43.71** | 39 → **43** | 4.71 → **5.44** | 5 → **5** |
| Hard | 83.57 → **84.33** | 82 → **83** | 8.81 → **9.30** | 8 → **9** |

Selected exit-side counts (out of 500) remained represented on every side:

| Difficulty | Before N / E / S / W | After N / E / S / W |
| --- | --- | --- |
| Easy | 171 / 108 / 73 / 148 | **129 / 95 / 83 / 193** |
| Medium | 174 / 99 / 80 / 147 | **136 / 101 / 78 / 185** |
| Hard | 139 / 119 / 105 / 137 | **146 / 102 / 98 / 154** |

The start-side counts were also represented on all four sides after correction: Easy `217 / 80 / 57 / 146`, Medium `167 / 104 / 86 / 143`, and Hard `152 / 99 / 106 / 143` (N / E / S / W). Counts demonstrate variation across the batch; they are not a guarantee of uniform distribution.

## Retry cost and generation timing

The paired timings below are generator-only measurements in milliseconds on the audit workstation. They are not mobile-device measurements. “Attempts” includes the successful generation attempt.

| Difficulty | Generation mean / worst before | Mean / worst after | After attempts mean / max | Samples retried | Fallback frequency |
| --- | ---: | ---: | ---: | ---: | ---: |
| Easy | 2.67 / 9.19 ms | **2.33 / 6.68 ms** | 1.088 / 3 | 40 / 500 (8.0%) | 0% |
| Medium | 11.45 / 17.94 ms | **8.59 / 18.15 ms** | 1.010 / 2 | 5 / 500 (1.0%) | 0% |
| Hard | 5.45 / 22.98 ms | **6.15 / 17.50 ms** | 1.000 / 1 | 0 / 500 (0%) | 0% |

The bounded retry limits remain 32 attempts for Easy/Medium and 8 for Hard. No sample exceeded two attempts for Medium or three for Easy; Hard needed one attempt throughout. Production has no fallback layout policy: retry exhaustion throws, so fallback frequency is zero by design. No retry exhausted and no generation failure occurred. The timing sample shows no meaningful slowdown in this batch; individual maxima are sensitive to runtime scheduling.

## Acceptance checks

- **Terminal exit:** 1,500 / 1,500 had exactly one internal neighbor at the exit.
- **Exit-gated regions:** 1,500 / 1,500 had zero gated cells; analyzer maximum and mean were both 0% for all difficulties.
- **Connectivity and walls:** all sampled mazes passed `validateMaze` and `isConnected`; the analyzer also confirmed all cells reachable in the full graph. Existing seeded tests check reciprocal walls and rendered perimeter openings.
- **Solution quality:** all routes met Easy ≥18 edges, Medium ≥28, and Hard ≥42 edges. Hard retained its six-intermediate-junction floor and preference for routes of at least 50 edges when available. Mean/median solution junctions did not decline in any difficulty.
- **Completion path:** each maze had a valid shortest path ending at its selected exit; completion validation continues to use that authoritative route.
- **Retries/fallbacks:** all attempt counts stayed within existing bounds; zero retries exhausted and zero fallbacks used.
- **Endpoint variation:** selected exits appeared on N/E/S/W in all three 500-maze batches. All four start sides were also represented.

The full project validation includes an explicit 500-seed-per-difficulty test for terminal degree, connectivity, maze validation, solution endpoint, and bounded attempt count. The previous graph-fixture tests continue checking that reachability analysis handles loops correctly even though production generation currently produces trees.

## Implementation and scope

`src/maze.js` filters candidate exit cells by internal degree one for the shipped 7×7, 10×10, and 15×15 difficulties. This is applied before route selection, so the exit remains an ordinary perimeter opening geometrically while being a leaf in the internal passage graph. The generator retries through its existing limits when no candidate pair also satisfies its difficulty’s route rules. `generationAttempts` is now recorded for all generated dimensions.

The build identifier is `2026.10.22-terminal-exit-1`; service-worker cache is `shell-v41`. The correction changes no tracing or completion code and does not require physical-device validation for graph reachability. A brief iPhone check should still confirm that generated flower markers remain clear at each perimeter side.

## Recommendation and remaining caveat

The accepted rule is **0% allowable exit-gated cells**. The terminal-exit property guarantees this for any connected passage graph, including graphs with loops: removing a degree-one finish cannot disconnect any other vertex from the start. The current generator remains a tree, and every measured seed passed.

The sample is deterministic but finite. It does not establish endpoint-side balance for every possible seed or prove retry behavior beyond these samples. Keep the 500-seed regression and bounded attempts in place; expand seed ranges if later generator changes alter topology or quality targets.
