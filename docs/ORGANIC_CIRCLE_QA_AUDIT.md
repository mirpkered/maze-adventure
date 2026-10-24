# Organic Circle QA Prototype — 500-Seed Audit

Generated 2026-10-24T12:01:50.088Z. Seeds 0–499 through the production Organic Circle generator and geometry trace session.

Every sample replays its full solution through the authoritative tracer, confirms completion only at the final outward portal crossing, then attempts a post-completion movement. Separate tracer sessions test an illegal entrance exit, a high-speed curved-wall strike, legal redirection/backtracking, and retained ink.

| Metric | Result |
|---|---:|
| Valid samples | 500/500 |
| Unique fingerprints | 500/500 |
| Solution length mean / median / min / P10 / P90 | 3.580 / 3.541 / 2.949 / 3.162 / 4.060 world units |
| Meaningful decisions mean / median / min | 4.07 / 4 / 2 |
| Optional branches mean; largest branch mean / max | 4.31; 0.895 / 1.797 world units |
| Generation duration mean / P95 / max | 82.395 / 222.084 / 369.339 ms |
| Attempts mean / max; retried seeds | 6.37 / 28; 427/500 |
| Rejected candidates total; reasons | 2683; no-safe-reconnection 275, portal-or-route-quality 2393, point-spacing 15 |
| Tracer replay mean / max | 0.906 / 10.381 ms |
| Entrance side N/E/S/W | 129/138/126/107 |
| Exit side N/E/S/W | 146/115/112/127 |
| Route replays / valid exits / wall stops / redirects / illegal entrance rejects | 500 / 500 / 500 / 500 / 500 |

## Acceptance interpretation

All 500 seeds passed the implemented structural generator checks and tracer replays. Start and exit portals vary around the circular boundary; only the exit portal permits outward crossing. The wall renderer uses offset samples from the same curved centerline representation whose corridor tubes define collision. Times are from this development environment, not an iPhone. The adjacent JSON contains the measured record for every seed.
