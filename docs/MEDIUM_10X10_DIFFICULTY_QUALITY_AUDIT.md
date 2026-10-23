# Medium 10×10 Difficulty Quality Audit

**Audit date:** 2026-10-22  
**Production entry point:** `createMazeForDifficulty(difficulty, random)`  
**Samples:** 500 each for Easy, Medium, and Hard; deterministic seeds 0–499  
**Purpose:** Determine whether the reported 16-second Medium completion reflects a weak tail or a broader generator-quality problem. No production generator rule was changed for this audit.

## Executive summary

The sampled Medium distribution is clearly above Easy and below Hard by both route length and choices encountered on the solution route. Medium's median shortest route is 43 edges with 6 meaningful decision points, compared with Easy's 24 edges and 4 decisions, and Hard's 83 edges and 10 decisions.

There is a real lower tail: 23% of sampled Medium mazes have routes no more than five edges above the 28-edge minimum. Some examples combine a minimum-length route with only two or three meaningful decision points. A fast finish around 16 seconds is plausible for this lower tail at the approved 2 cells/second cap; the player's seed is unknown, so the screenshot cannot be matched to one of these samples. The sample does not show a broad failure: no Medium maze had fewer than two meaningful decision points, the median was six, and only one sample met the audit's “large optional area, few choices” flag.

**Recommendation:** Keep current rules for now. The report supports a modest future preference for longer, more decision-rich Medium endpoint pairs, but one observed completion is not enough to justify changing live generation. If the player continues to find the lower tail too easy, evaluate a preference for routes of at least 34 edges and four meaningful decisions while retaining the current 28-edge floor and terminal-exit safeguards. In this sample, 382/500 selected mazes met both values. That would be a post-selection rejection estimate of 23.6% and about 1.31 attempts per accepted maze if implemented as whole-layout resampling; the true retry cost may be lower if selection chooses among alternative endpoint pairs on each topology.

## Current production generation rules

All shipped difficulties use the same reciprocal N/E/S/W perfect-maze representation, DFS topology generation, dynamic non-corner perimeter endpoints, shared terminal exit requirement, and bounded retry loop. Difficulty-specific endpoint selection differs:

| Difficulty | Grid | Minimum solution edges | Preferred route / junctions | Other endpoint quality | Retry limit |
|---|---:|---:|---|---|---:|
| Easy | 7×7 | 18 | No preferred route length; endpoint pool prefers at least 2 interior route junctions when any qualifying pair exists | Terminal exit (internal degree 1); no optional-branch floor | 32 |
| Medium | 10×10 | 28 | No preferred route length; endpoint pool prefers at least 2 interior route junctions when any qualifying pair exists | Terminal exit (internal degree 1); no optional-branch floor | 32 |
| Hard | 15×15 | 42 | Prefers routes ≥50 edges when available; requires at least 6 interior route junctions | Terminal exit; no optional-branch floor | 8 |
| Expert | 20×20 | 100 | Prefers routes ≥120 edges when available; requires at least 12 interior route junctions | Terminal exit; at least 140 off-route cells, 8 optional branches, largest branch at most 200 cells | 12 |

There is no numeric quality score. Easy and Medium filter endpoint pairs by minimum route length, prefer the pair subset with at least two route junctions when available, then select randomly from that pool. Hard and Expert use specialized bounded searches. If a topology has no qualifying pair, generation retries with a new topology. There is no lower-quality fallback: exhausting the bound throws. `generationAttempts` records how many topologies were tried.

## Method and definitions

The audit used the production `createMazeForDifficulty` function with the deterministic Park–Miller sequence already used by the repository's generation audit and regression tests. The same seed range 0–499 was run for Easy, Medium, and Hard to make comparisons reproducible. For each Medium maze, the companion CSV records seed, layout ID, dimensions, start/exit coordinates and sides, shortest route length, route junctions, decisions and alternatives, branch statistics, dead ends, exit degree, gated cells, generation attempts, measured generation duration, and validity.

Validation used the production wall/connectivity/path validators and the graph derived from reciprocal cell connections. The script aborts on any invalid sample, nonterminal exit, or exit-gated cell. Generation timing comes from the generator's own `performance.now()` measurement and is rounded to hundredths of a millisecond; it is a Node workstation measure, not an iPhone benchmark.

Metrics:

- **Route junctions:** existing production-style count of cells with graph degree ≥3 strictly between start and exit. The start and exit are excluded.
- **Meaningful decision point:** a cell on the shortest solution route, before the exit, where at least one legal off-route continuation exists after excluding the previous solution edge (except at the start) and the next solution edge. A forced corner is not a decision.
- **Alternative continuations:** total number of off-route choices offered at those points. On these perfect-maze trees, each off-route branch is one wrong-turn option.
- **Optional branch:** a connected off-route component after removing the shortest route. Its cell count and depth are measured from its attachment to the solution route.
- **Near-minimum route:** at most 5 edges above the configured 28-edge Medium floor (28–33 edges).
- **Few route junctions:** at most 3 interior route junctions.
- **Few meaningful decisions:** at most 3 decision points.
- **Large, relatively direct route:** at least 40 edges and at most 2 meaningful decision points.
- **Large optional area with few decisions:** at least 50 cells outside the route and at most 2 meaningful decision points.

These last categories are explicit audit flags for comparing samples, not claims of universal human difficulty thresholds.

Reproduce the audit and regenerate the per-maze CSV with:

```sh
node scripts/medium-difficulty-audit.mjs --samples=500 --start-seed=0 --write-csv docs/MEDIUM_10X10_DIFFICULTY_QUALITY_SAMPLES.csv
```

The command also measures Easy and Hard on the same seed range for equivalent comparisons. The per-Medium-sample records are in [MEDIUM_10X10_DIFFICULTY_QUALITY_SAMPLES.csv](MEDIUM_10X10_DIFFICULTY_QUALITY_SAMPLES.csv).

## 500-maze results

### Solution length and route complexity

Edges are shortest legal cell-to-cell transitions. Percentiles use linear interpolation over the sorted sample.

| Difficulty | Solution edges min | P10 | P25 | Median | Mean | P75 | P90 | Max | Route junctions mean / median | Meaningful decisions mean / median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Easy 7×7 | 18 | 19 | 20 | 24 | 24.82 | 28 | 32.1 | 43 | 3.36 / 3 | 4.28 / 4 |
| Medium 10×10 | 28 | 30 | 34 | 43 | 43.71 | 52 | 60 | 80 | 5.44 / 5 | 6.37 / 6 |
| Hard 15×15 | 50 | 56 | 66 | 83 | 84.33 | 99.25 | 115.1 | 155 | 9.30 / 9 | 10.22 / 10 |

Medium clears Easy's measured upper quartile on median route length (43 vs. Easy P75 28) and median decisions (6 vs. Easy P75 5). It also remains clearly below Hard's lower quartile (Hard P25 66 edges and 8 decisions). Grid size is not the sole basis for this conclusion: the route and actual branching choices also separate the distributions.

### Medium route length distribution

| Measure | Result |
|---|---:|
| Minimum / mean / median / maximum | 28 / 43.71 / 43 / 80 edges |
| P10 / P25 / P75 / P90 | 30 / 34 / 52 / 60 edges |
| Near minimum (28–33 edges) | 115/500 (23.0%) |
| At least 40 edges, at most 2 choices | 0/500 (0%) |

### Medium decisions, branches, and dead ends

| Measure | Min | Mean | Median | P10 | P25 | P75 | P90 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Interior route junctions | 2 | 5.44 | 5 | 3 | 4 | 6.25 | 8 | 11 |
| Meaningful decision points | 2 | 6.37 | 6 | 4 | 5 | 7 | 9 | 12 |
| Alternative continuations | 2 | 6.53 | 6 | 4 | 5 | 8 | 9 | 12 |
| Optional branches | 2 | 6.53 | 6 | 4 | 5 | 8 | 9 | 12 |
| Optional cells | 19 | 55.29 | 56 | 39 | 47 | 65 | 69 | 71 |
| Largest optional branch | 4 | 29.20 | 27 | 15 | 20 | 37 | 47 | 69 |
| Deepest optional branch (edges from route) | 3 | 21.34 | 20 | 11 | 14 | 26 | 34 | 57 |
| Graph dead ends | 7 | 11.82 | 12 | 10 | 11 | 13 | 14 | 18 |

There were no samples with 0 or 1 meaningful decision. Twelve samples (2.4%) had at most 3 decision points. Sixty samples (12.0%) had at most 3 interior route junctions. One sample (0.2%) had at least 50 optional cells but no more than 2 decisions. Medium's 55.3 optional cells on average are not automatically “unused”: in a perfect maze they are reached through branches that connect to the solution route. However, when only two choices lead into large branches, the route can still feel direct despite abundant off-route geometry.

### Junction and branch-count distributions

| Count | Route junctions: mazes | Meaningful choices: mazes | Optional branches: mazes | Dead ends: mazes |
|---:|---:|---:|---:|---:|
| 2 | 12 | 1 | 1 | — |
| 3 | 48 | 11 | 9 | — |
| 4 | 93 | 55 | 52 | — |
| 5 | 111 | 92 | 87 | — |
| 6 | 111 | 113 | 105 | — |
| 7 | 70 | 110 | 112 | 2 |
| 8 | 34 | 67 | 68 | 11 |
| 9 | 15 | 31 | 36 | 35 |
| 10 | 5 | 14 | 21 | 60 |
| 11 | 1 | 5 | 7 | 112 |
| 12 | — | 1 | 2 | 108 |
| 13 | — | — | — | 91 |
| 14 | — | — | — | 45 |
| 15 | — | — | — | 29 |
| 16 | — | — | — | 5 |
| 17 | — | — | — | 1 |
| 18 | — | — | — | 1 |

### Maze integrity and generation cost

| Check | Medium result |
|---|---:|
| Generated and validated | 500 / 500 |
| Connected / valid reciprocal walls / valid solution | 500 / 500 |
| Terminal exits (internal graph degree 1) | 500 / 500 |
| Exit-gated cells | 0 in every maze |
| Mean generation attempts | 1.010 |
| Attempt counts | 495 first try; 5 second try; 0 beyond second |
| Retry limit / fallback | 32 / no fallback; exhaustion throws |
| Mean / maximum generation duration | 8.82 ms / 18.41 ms |
| Selected exit sides N / E / S / W | 136 / 101 / 78 / 185 |

The side counts show a west-heavy result in this finite batch, not an enforced side rule. Generation did not approach its retry bound. Timing includes only production generation as measured on the development workstation; it is not a mobile-device benchmark.

## Reproducible low-tail and stronger examples

The seed stream is deterministic. These are illustrative samples from the bottom of this batch by route complexity, not a claim that any matches the player's unknown maze.

| Seed / layout ID | Start → exit | Edges | Route junctions | Meaningful decisions / alternatives | Optional branches / cells | Largest branch | Dead ends | Reading |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 56 · `maze-10x10-1576c0a7` | N (2,0) → E (9,6) | 29 | 2 | 2 / 2 | 2 / 70 | 43 | 11 | Near-minimum route, only two choice points, much of the grid is off that route. |
| 135 · `maze-10x10-2b0c1b87` | N (1,0) → N (5,0) | 28 | 2 | 3 / 3 | 3 / 71 | 69 | 10 | At the route floor; choices exist but one wrong branch contains most optional cells. |
| 314 · `maze-10x10-116adbf1` | E (9,8) → W (0,1) | 28 | 2 | 3 / 4 | 4 / 71 | 43 | 14 | Minimum-length route with only three decision locations. |

One compact wall-and-route diagram for seed 56 (`S` start, `E` exit, `·` solution cells; omitted marks are optional cells):

```text
+---+---+   +---+---+---+---+---+---+---+
|       | S   · | ·   · | ·   ·   ·   · |
+---+   +---+   +   +   +   +---+---+   +
|   |       | ·   · | · | · |       | · |
+   +---+   +---+---+   +   +   +   +   +
|       |       | ·   · | · |   |     · |
+---+   +---+   +   +---+   +   +---+   +
|           |   | ·   ·   · |   | ·   · |
+   +---+---+   +---+---+---+   +   +---+
|   |           |       |       | ·   · |
+   +   +---+---+   +   +   +---+---+   +
|   |       |       |       |   | ·   · |
+   +---+   +   +---+---+---+   +   +---+
|       |       |               | · | E  
+---+   +---+---+   +---+   +   +   +   +
|               |       |   |   | ·   · |
+   +---+---+---+---+   +   +   +---+   +
|       |           |   |   |   |       |
+   +   +   +---+   +   +   +---+   +---+
|   |           |       |               |
+---+---+---+---+---+---+---+---+---+---+
```

Stronger examples from the same batch:

| Seed / layout ID | Start → exit | Edges | Route junctions | Meaningful decisions | Optional branches / cells | Largest branch | Dead ends |
|---|---|---:|---:|---:|---:|---:|---:|
| 232 · `maze-10x10-2b807121` | E (9,8) → W (0,1) | 54 | 11 | 12 | 12 / 45 | 14 | 15 |
| 94 · `maze-10x10-92bae663` | N (2,0) → S (2,9) | 79 | 10 | 11 | 11 / 20 | 4 | 12 |
| 246 · `maze-10x10-ff3d1a5d` | N (6,0) → W (0,3) | 65 | 10 | 11 | 11 / 34 | 14 | 13 |

## Candidate rule simulation and recommendation

This is a simulation on the **already selected** 500 Medium results. It measures how many would survive a hypothetical post-selection floor, then estimates independent resampling. It does not change the generator and does not measure whether an alternative endpoint pair on the same topology could satisfy the rule; actual candidate-pool selection could lower retry cost.

| Hypothetical minimum edges | Meaningful decisions | Samples accepted | Rejected share | Estimated attempts if post-selection resampled | Estimated exhaustion in 32 independent attempts |
|---:|---:|---:|---:|---:|---:|
| 28 | 3 | 499/500 (99.8%) | 0.2% | 1.002 | effectively 0% |
| 32 | 3 | 421/500 (84.2%) | 15.8% | 1.188 | effectively 0% |
| 34 | 4 | 382/500 (76.4%) | 23.6% | 1.309 | effectively 0% |
| 36 | 4 | 348/500 (69.6%) | 30.4% | 1.437 | effectively 0% |
| 36 | 5 | 334/500 (66.8%) | 33.2% | 1.497 | effectively 0% |
| 40 | 5 | 277/500 (55.4%) | 44.6% | 1.805 | effectively 0% |
| 42 | 5 | 264/500 (52.8%) | 47.2% | 1.894 | effectively 0% |

The least disruptive future quality pass to prototype would be a **preference**, not a raised hard minimum: prefer candidate endpoint pairs that offer roughly 34+ edges and 4+ meaningful choices when available, preserving the current 28-edge / existing decision floor as the safe acceptance tier. This should be measured on topology candidate availability before implementation. Current evidence does not justify altering generation in this release.

## Conclusion

The player's result is credible as a lower-tail Medium maze: a 28–29 edge solution at the 2 cells/second cap can finish near 16 seconds, and those routes can offer fewer decisions than the median. The deterministic batch indicates that this is an occasional quality-tail issue rather than the central Medium experience: median complexity clearly exceeds Easy and is clearly below Hard, and only a small share has very few route decisions. Keep the production rules unchanged unless subsequent device reports show this lower tail is unacceptable.

## Artifacts and scope

- Read-only production audit implementation: `scripts/medium-difficulty-audit.mjs`.
- Existing production generator: `src/maze.js` (not modified by this audit).
- Per-seed Medium records: `docs/MEDIUM_10X10_DIFFICULTY_QUALITY_SAMPLES.csv`.
- Regression checks for reproducibility and decision semantics: `test/medium-difficulty-audit.test.js`.
- Historical Easy/Medium/Hard/Expert generator audits remain preserved and unmodified.
