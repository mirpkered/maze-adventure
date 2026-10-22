# Expert 20×20 implementation and generator audit

**Audit date:** 2026-10-22  
**Production entry point:** `createMazeForDifficulty('expert', random)`  
**Sample:** Park–Miller seeds 0–499 (500 mazes)  
**Result:** all 500 Expert samples passed the acceptance checks.

## Expert generation contract

Expert is a 20×20 square-grid difficulty. It uses the existing reciprocal N/E/S/W wall model, depth-first perfect-maze topology, dynamic non-corner perimeter endpoints, shared renderer, tracer, collision checks, route history, and permanent ink.

The generator keeps candidate selection bounded to 12 complete maze attempts. Each endpoint candidate must have a terminal exit (exactly one internal neighbor), at least 100 solution edges, and at least 12 intermediate route junctions. If a route with at least 120 edges exists in the accepted candidate pool, it is preferred. The selected route must also leave at least 140 cells in at least 8 optional branches, with no optional branch larger than 200 cells. A failed attempt is retried; retry exhaustion throws and never returns a lower-quality fallback.

These rules make the measured Expert route meaningfully longer and more decision-rich than the existing Hard range. The 200-cell largest-branch cap limits the common 20×20 failure mode where nearly all remaining play space becomes one irrelevant side region.

## Audit method and validation

The audit called the production difficulty API for seeds 0–499. For every maze it measured the selected perimeter sides, solution route, route junctions, optional cells and branches, generation time, retry count, and layout fingerprint. It also independently checked `validateMaze`, full connectivity, reciprocal shared walls, terminal exit degree, zero exit-gated cells, and `validatePath` to the selected flower.

Reproduce the full deterministic batch with:

```sh
node scripts/maze-quality-audit.mjs --samples=500 --start-seed=0 --summary
```

The audit throws on any invalid Expert sample or quality-threshold violation. The detailed analyzer is separate from gameplay generation and does not run at application startup.

### Acceptance result

| Check | Result |
| --- | ---: |
| Generated / validated | 500 / 500 |
| Connected cells | 400 in every maze |
| Reciprocal internal walls and valid perimeter openings | 500 / 500 |
| Valid shortest completion paths | 500 / 500 |
| Terminal exits (degree 1) | 500 / 500 (100%) |
| Exit-gated cells | 0 in every maze (mean 0, maximum 0) |
| Solution length floor ≥100 edges | 500 / 500; minimum 101 |
| Route junction floor ≥12 | 500 / 500; minimum 12 |
| Optional cells floor ≥140 | 500 / 500; minimum 143 |
| Optional branch floor ≥8 | 500 / 500; minimum 12 |
| Largest optional branch ≤200 cells | 500 / 500; maximum 199 |
| Distinct layouts | 500 / 500 |
| Generation retries | 7 samples retried; maximum 2 attempts |
| Fallback layouts / exhausted attempts | 0 / 0 |

All four start and exit edges appeared. Start counts N/E/S/W were 158/81/92/169; exit counts were 138/81/93/188. This is observed variation, not a promise of uniform side frequencies.

## Difficulty comparison

Hard and Expert statistics below use the same 500 seeds and audit run. Solution edges are the shortest legal cell transitions. Route junctions exclude the start and exit cells. Optional branches are connected components remaining after removing the solution route.

| Metric | Hard 15×15 | Expert 20×20 |
| --- | ---: | ---: |
| Solution edges, mean / median | 84.33 / 83 | 163.47 / 158 |
| Solution edges, P10 / P90 / min / max | 56 / 115.1 / 50 / 155 | 128 / 205.1 / 101 / 256 |
| Route junctions, mean / median | 9.30 / 9 | 16.32 / 16 |
| Route junctions, P10 / P90 | 6 / 13 | 12 / 21 |
| Optional cells, mean | 139.67 | 235.53 |
| Optional branches, mean / minimum | 10.45 / 6 | 17.53 / 12 |
| Largest optional branch, mean / maximum | 72.01 / 149 | 101.55 / 199 |
| Terminal exits / zero-gated mazes | 100% / 100% | 100% / 100% |

Expert's median shortest path is about 1.90× Hard's, and its median route has 7 additional junctions. The measured lower tail also clears Hard's observed P90 route length and P90 junction count.

## Generation performance and optimization

The pre-Expert 20×20 path fell through generic all-pairs endpoint selection: it ran map-based breadth-first searches from perimeter openings and reconstructed paths for each endpoint pair. That path did not apply Expert quality rules and was not suitable for this difficulty. A 20-seed baseline replay of the prior production implementation measured mean 243.84 ms, median 247.74 ms, P95 293.24 ms, and maximum 295.60 ms per 20×20 generation.

Expert now has a dedicated quality search. It uses typed-array distance, predecessor, and junction-prefix buffers, evaluates each entrance with one BFS, filters route candidates before optional-branch analysis, and performs expensive branch checks only on quality-eligible candidates. It preserves the same DFS topology and endpoint data model. A paired 20-seed run measured mean 9.42 ms, median 7.66 ms, P95 14.46 ms, and maximum 23.31 ms. In the final full 500-maze audit, generation averaged 8.07 ms and P95 was 10.01 ms. One isolated scheduler outlier reached 59.99 ms; the preceding full batch peaked at 18.43 ms. These are Node workstation results, not iPhone timings.

The full batch averaged 1.014 generation attempts per maze: 493 completed on the first attempt and 7 on the second. The 12-attempt ceiling was never approached. No fallback is implemented; failure to find a qualifying maze within the bound is an explicit error.

## Steering and mobile presentation

Expert uses the centralized Continuous Steering cap of 3.000 cells/second. The established 10 CSS-pixel dead zone, 76 CSS-pixel full-speed displacement, 1.15 response exponent, 50 ms frame cap, shared swept tracer, and collision behavior remain unchanged. A controller-and-tracer regression test verifies the Expert speed cap, bounded frame movement, closed-wall stop, no duplicate ink while blocked, and legal redirection after collision.

The Expert difficulty card is available alongside Easy, Medium, and Hard. At a simulated 390×844 portrait viewport, the 20×20 maze fits fully in the overview panel; the entrance, flower, walls, and steering pad remained visible and legible, with no horizontal overflow observed. This is browser simulation only. Physical iPhone acceptance remains outstanding.

## Implementation and release details

- Quality thresholds and Expert endpoint selection: `src/maze.js`.
- Deterministic 500-seed analyzer: `scripts/maze-quality-audit.mjs`.
- Regression coverage: `test/maze.test.js`, `test/maze-quality-audit.test.js`, `test/continuous-steering.test.js`, `test/tracing.test.js`, `test/ui.test.js`, and `test/qa-diagnostics-store.test.js`.
- QA diagnostics include difficulty, dimensions, reproducible layout fingerprint, terminal-exit degree, gated-cell count, solution length, generation attempts and duration, Expert branch metrics, and the active 3 cells/second steering cap.
- Expert uses the existing `shell-v43` service-worker cache and build ID `2026.10.22-expert-20x20-1`.

The earlier exit-quality and terminal-exit audits remain unchanged as historical evidence. This report is the Expert-specific acceptance record; it does not replace or rewrite them.
