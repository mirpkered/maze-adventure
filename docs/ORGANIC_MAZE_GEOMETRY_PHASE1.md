# Organic Maze Geometry — Phase 1

## Scope and coexistence

Classic mazes and the nine released silhouette mazes keep the canonical reciprocal N/E/S/W cell graph and grid tracer. `mazeFormat: "organic"` selects a separate geometry-backed session, renderer, and collision predicate for the development-only Organic Circle. The game still shares its steering pad, timer, pause, completion panel, QA reporting, and Back/Restart/New controls. The public shape registry remains the nine released shapes; Organic Circle is not available through public Choose a Shape or Surprise Me.

## Representation and generation

The Circle uses a seeded, embedded passage graph. A bounded Poisson-style sampler places 14 irregular interior sites in a disk. A deterministic Prim minimum-spanning tree joins them. A clearance-checked, curved alternate passage is added as a three-edge reconnect with two explicit graph junctions, creating one real loop. The reconnect is rejected if its sampled curve leaves the playable disk or approaches another corridor too closely. Two terminal leaves are selected as the entrance and exit. The displayed solution is the shortest route by sampled curve length, found with Dijkstra's algorithm. A candidate is accepted only if its route length, route decisions, and optional branches meet the current floors.

Every graph edge is a cubic Bezier centerline sampled into a polyline. A common corridor width (`0.112` world units) defines legal pencil positions as the union of tubes around those segments. The circular rim is a separate wall with two portal gaps. The renderer builds parallel offset wall paths from those same samples, trims only at junctions, and explicitly uses unfilled SVG strokes. The player route is append-only world-space ink.

## Collision and trace behavior

Steering displacement is converted into world units using the displayed SVG scale. The organic cap is `0.42` world units per second; this is provisional and is not a cell-speed value. The established 10 CSS-pixel dead zone, 76-pixel full-speed threshold, 1.15 curve, 50 ms frame cap, no-inertia behavior, and immediate release stop remain shared.

The organic trace adapter divides each proposed movement into bounded segments smaller than the corridor width, checks every candidate against the sampled centerline tube and circular boundary, then bisects a blocked segment to the last legal position. This prevents a large input step from tunneling through a sampled wall. A hit stops movement while leaving the steering gesture active for redirection. Only accepted positions are inked. Completion is committed only after an outward crossing of the declared exit portal; the entrance and all other rim locations remain blocked.

## Determinism and QA access

The input seed controls point placement, graph topology, curve offsets, portal selection, and geometry fingerprint. Restart reuses the generated instance. New advances the seed and asynchronously yields between rejected candidates so the QA screen remains responsive. The QA configuration page exposes the seed field and launch action only while QA is enabled through `?qa=1` or the established activation gesture. The explicit QA session marker is stored in session storage so a safe service-worker refresh does not discard QA after the launch query is consumed; explicitly exiting QA clears that marker. Public shaped-maze selection is unchanged.

## Current quality and limitations

The current acceptance floors are at least `2.35` world units of solution, two meaningful degree-three-or-higher choices on the selected route, and four optional branch components. The exit leaf has one internal graph connection. Generated paths have sampled clearance checks and a deterministic acceptance audit in [ORGANIC_CIRCLE_QA_AUDIT.md](ORGANIC_CIRCLE_QA_AUDIT.md), with a seed-level JSON companion. Seeds 0–499 produced 500/500 valid, unique layouts. Solution length averaged 3.580 units (median 3.541; min 2.949; P10 3.162; P90 4.060). Mean meaningful decisions were 4.07 (minimum 2). Generation took a mean 64.99 ms, P95 161.33 ms, and maximum 288.05 ms in this environment; attempts averaged 6.37 and peaked at 28. These times are not iPhone measurements. The QA launcher yields between rejected candidates; 2,683 candidates were rejected in this audit, mostly for portal/route quality (2,393), then safe reconnection (275), then point spacing (15). The 96-attempt bound was not reached.

This is a prototype geometry, not a device-validated release. The loop is deliberately limited to one per maze; the graph is small to keep corridors legible. Wall contours use sampled offset curves while legal movement uses centerline tubes; they share inputs but still have a finite-width visual approximation that needs close device review. Generation rejection and render readability must be rechecked after geometry changes. The local in-app browser showed a black filled disk before the open SVG paths were explicitly set to `fill="none"`; the renderer now prevents that SVG default. Physical iPhone comfort, fine collision feel, both themes, and smaller mobile viewports remain unverified.

## Future organic silhouettes

Keep domain boundaries and portal candidates as geometry-provider inputs while preserving the existing grid backend. An organic Heart would need a connected interior domain, clearance-aware curve placement, a recognisable outline at phone scale, and the same hard-stop collision audit before QA exposure. Do not use square-cell transitions for organic movement. True concentric-ring mazes remain a separate topology and are out of scope for this adapter.
