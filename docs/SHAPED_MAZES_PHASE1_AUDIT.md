# Shaped Mazes Phase 1 — Production Audit

Generated 2026-10-23T03:35:20.125Z.

For each registered shape, generate seeds 0–499 through the production registry generator, validate the canonical mask/wall graph and exact two perimeter openings, traverse the shortest route through createTraceSession.steer, confirm exit-cell entry does not complete, then cross the declared exit. A separate tracer pass attempts one non-exit mask boundary per seed.

| Shape | Grid | Active cells | Valid samples | Unique layouts | Route mean / median / min / P10 / P90 | Decisions mean / median | Branches mean | Generation ms mean / P95 / max | Attempts mean / max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Castle (castle) | 23×21 | 312 | 500/500 | 500/500 | 131.13 / 130 / 77 / 101 / 162 | 16.96 / 17 | 17.93 | 9.26 / 12.74 / 47.95 | 1 / 1 |
| Circle (circle) | 23×23 | 365 | 500/500 | 500/500 | 150.89 / 149 / 82 / 118 / 183 | 19.89 / 20 | 20.81 | 13.01 / 18.55 / 51.49 | 1 / 1 |
| Heart (heart) | 23×21 | 239 | 500/500 | 500/500 | 118.98 / 119 / 73 / 98 / 140 | 19.15 / 19 | 20.1 | 12.82 / 17.92 / 25.85 | 1 / 1 |
| Star (star) | 23×23 | 149 | 500/500 | 500/500 | 66.77 / 66 / 43 / 52 / 82 | 12.96 / 13 | 13.63 | 8.11 / 11.56 / 32.33 | 1 / 1 |
| Diamond (diamond) | 21×21 | 221 | 500/500 | 500/500 | 94.85 / 94 / 56 / 74 / 116 | 18.34 / 18 | 19.6 | 12.17 / 15.8 / 21.94 | 1 / 1 |
| Cross (cross) | 21×21 | 185 | 500/500 | 500/500 | 79.25 / 78 / 49 / 63 / 98 | 11.4 / 11 | 12.34 | 4.84 / 6.92 / 13.11 | 1 / 1 |
| Arrow (arrow) | 23×19 | 122 | 500/500 | 500/500 | 63.67 / 64 / 37 / 49 / 77 | 10.77 / 11 | 11.83 | 4.53 / 6.4 / 7.73 | 1 / 1 |
| Key (key) | 25×19 | 186 | 500/500 | 500/500 | 77.79 / 77 / 49 / 62 / 94 | 13.49 / 13 | 14.28 | 7.71 / 9.98 / 14.76 | 1 / 1 |
| DJ Penguin (dj-penguin) | 15×27 | 219 | 500/500 | 500/500 | 100.8 / 100 / 68 / 80 / 121 | 16.01 / 16 | 16.95 | 8.57 / 11.36 / 14.35 | 1 / 1 |

## Opening-side distributions

| Shape | Start N/E/S/W | Exit N/E/S/W |
|---|---:|---:|
| Castle | 116/110/125/149 | 152/125/98/125 |
| Circle | 135/114/125/126 | 118/128/114/140 |
| Heart | 183/113/60/144 | 185/95/80/140 |
| Star | 131/87/128/154 | 108/97/142/153 |
| Diamond | 146/118/112/124 | 139/115/130/116 |
| Cross | 138/126/110/126 | 154/116/106/124 |
| Arrow | 187/55/117/141 | 174/129/107/90 |
| Key | 91/141/132/136 | 127/134/115/124 |
| DJ Penguin | 97/172/103/128 | 125/153/114/108 |

## Branch quality and generation retries

| Shape | Route junctions mean / median | Branches mean / median | Optional cells mean / median | Largest branch mean / max | Dead ends mean / median | Attempts mean / max | Retry samples |
|---|---:|---:|---:|---:|---:|---:|---:|
| Castle | 16.96 / 17 | 17.93 / 18 | 179.87 / 181 | 68.16 / 149 | 35.2 / 35 | 1 / 1 | 0/500 |
| Circle | 19.89 / 20 | 20.81 / 21 | 213.11 / 215 | 78.44 / 177 | 42.95 / 43 | 1 / 1 | 0/500 |
| Heart | 19.15 / 19 | 20.1 / 20 | 119.02 / 118 | 38.83 / 121 | 34.46 / 34 | 1 / 1 | 0/500 |
| Star | 12.96 / 13 | 13.63 / 14 | 81.23 / 82 | 28.01 / 70 | 23.77 / 24 | 1 / 1 | 0/500 |
| Diamond | 18.34 / 18 | 19.6 / 19 | 125.15 / 126 | 46 / 105 | 35.4 / 35 | 1 / 1 | 0/500 |
| Cross | 11.4 / 11 | 12.34 / 12 | 104.75 / 106 | 39.47 / 105 | 21.19 / 21 | 1 / 1 | 0/500 |
| Arrow | 10.77 / 11 | 11.83 / 12 | 57.33 / 57 | 21 / 57 | 17.68 / 18 | 1 / 1 | 0/500 |
| Key | 13.49 / 13 | 14.28 / 14 | 107.21 / 108 | 46.92 / 86 | 25.26 / 25 | 1 / 1 | 0/500 |
| DJ Penguin | 16.01 / 16 | 16.95 / 17 | 117.2 / 118 | 39.98 / 115 | 28.24 / 28 | 1 / 1 | 0/500 |

- Castle: 500/500 samples had a blocked diagonal corner case exercised through the shared tracer.
- Circle: 500/500 samples had a blocked diagonal corner case exercised through the shared tracer.
- Heart: 500/500 samples had a blocked diagonal corner case exercised through the shared tracer.
- Star: 500/500 samples had a blocked diagonal corner case exercised through the shared tracer.
- Diamond: 500/500 samples had a blocked diagonal corner case exercised through the shared tracer.
- Cross: 500/500 samples had a blocked diagonal corner case exercised through the shared tracer.
- Arrow: 500/500 samples had a blocked diagonal corner case exercised through the shared tracer.
- Key: 500/500 samples had a blocked diagonal corner case exercised through the shared tracer.
- DJ Penguin: 500/500 samples had a blocked diagonal corner case exercised through the shared tracer.

All audited mazes were required to have connected active masks, reciprocal shared walls, exactly the declared entrance and exit external openings, a degree-one internal exit, zero exit-gated cells, a route meeting per-shape computed quality floors, and a single successful outward exit crossing. Each seed also attempted to cross a closed non-exit mask boundary and was rejected.

The source of each raw sample and every generated layout fingerprint is available in the adjacent JSON report for reproducibility.
