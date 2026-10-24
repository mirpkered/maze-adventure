const RADIUS = 0.94;
const CORRIDOR_WIDTH = 0.112;
const HALF_WIDTH = CORRIDOR_WIDTH / 2;
// Keep only a small relief at forks so short branches remain visibly joined
// to the shared corridor opening instead of appearing as disconnected dashes.
const JUNCTION_RADIUS = HALF_WIDTH * 0.42;
const SEGMENT_STEP = 0.012;
const RENDER_STEP = 0.009;
const CLEARANCE = CORRIDOR_WIDTH * 1.18;
const WORLD_VIEW_RADIUS = 1.16;
const EPSILON = 1e-9;

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const copy = point => ({ x: point.x, y: point.y });
const pointKey = point => `${point.x.toFixed(4)},${point.y.toFixed(4)}`;

/** Stable small PRNG: the seed controls topology and all geometric variation. */
export function createOrganicRandom(seed = 1) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function fingerprint(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sampleDisk(random, count = 14) {
  const points = [];
  let attempts = 0;
  while (points.length < count && attempts++ < 6000) {
    const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 0.68;
    const point = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    if (points.every(other => distance(point, other) >= 0.28)) points.push(point);
  }
  if (points.length !== count) throw new Error('Organic point placement did not meet its bounded spacing rule.');
  return points;
}

function makeTree(points) {
  const connected = new Set([0]), edges = [];
  while (connected.size < points.length) {
    let choice = null;
    for (const from of connected) for (let to = 0; to < points.length; to++) {
      if (connected.has(to)) continue;
      const d = distance(points[from], points[to]);
      if (!choice || d < choice.length) choice = { from, to, length: d };
    }
    connected.add(choice.to); edges.push({ a: choice.from, b: choice.to, length: choice.length });
  }
  return edges;
}

function bezier(p0, p3, firstOffset, secondOffset = firstOffset) {
  const dx = p3.x - p0.x, dy = p3.y - p0.y, length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length, ny = dx / length;
  const p1 = { x: p0.x + dx / 3 + nx * firstOffset, y: p0.y + dy / 3 + ny * firstOffset };
  const p2 = { x: p0.x + dx * 2 / 3 + nx * secondOffset, y: p0.y + dy * 2 / 3 + ny * secondOffset };
  const count = Math.max(10, Math.ceil(length / SEGMENT_STEP));
  const points = [];
  for (let index = 0; index <= count; index++) {
    const t = index / count, u = 1 - t;
    points.push({
      x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
      y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
    });
  }
  return points;
}

function linePoints(a, b) {
  const count = Math.max(2, Math.ceil(distance(a, b) / SEGMENT_STEP));
  return Array.from({ length: count + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / count, y: a.y + (b.y - a.y) * i / count }));
}

function adjacency(nodes, edges) {
  const result = nodes.map(() => []);
  for (const edge of edges) { result[edge.a].push(edge.b); result[edge.b].push(edge.a); }
  return result;
}

function shortestGraphPath(graph, edges, start, finish) {
  const distances = Array(graph.length).fill(Infinity), parent = Array(graph.length).fill(null), pending = new Set(graph.map((_, id) => id));
  distances[start] = 0;
  while (pending.size) {
    let here = -1;
    for (const id of pending) if (here < 0 || distances[id] < distances[here]) here = id;
    if (here < 0 || !Number.isFinite(distances[here]) || here === finish) break;
    pending.delete(here);
    for (const next of graph[here]) {
      if (!pending.has(next)) continue;
      const edge = edges.find(item => (item.a === here && item.b === next) || (item.a === next && item.b === here));
      if (!edge) continue;
      const candidate = distances[here] + edge.length;
      if (candidate < distances[next]) { distances[next] = candidate; parent[next] = here; }
    }
  }
  if (!Number.isFinite(distances[finish])) return null;
  const result = [];
  for (let at = finish; at !== null; at = parent[at]) result.push(at);
  return result.reverse();
}

function angleOf(point) { return Math.atan2(point.y, point.x); }
function angularDistance(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

function radialPortal(point, parent) {
  const dx = point.x - parent.x, dy = point.y - parent.y, length = Math.hypot(dx, dy);
  if (length < EPSILON) return null;
  const direction = { x: dx / length, y: dy / length };
  const projection = point.x * direction.x + point.y * direction.y;
  const discriminant = projection ** 2 + RADIUS ** 2 - point.x ** 2 - point.y ** 2;
  if (discriminant <= 0) return null;
  const extent = -projection + Math.sqrt(discriminant);
  const boundary = { x: point.x + direction.x * extent, y: point.y + direction.y * extent };
  return { angle: angleOf(boundary), boundary, outside: { x: boundary.x + direction.x * 0.125, y: boundary.y + direction.y * 0.125 }, direction };
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t);
}

function segmentDistance(a, b, c, d) {
  // Closest pair of 2D segments (including intersecting segments).
  const cross = (u, v) => u.x * v.y - u.y * v.x;
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(r, s);
  if (Math.abs(denominator) > 1e-10) {
    const q = { x: c.x - a.x, y: c.y - a.y };
    const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

function curvesAreClear(edges, polylines) {
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
    const edge = edges[edgeIndex], points = polylines[edgeIndex];
    // Ignore nearby tessellation segments along the same simple curve; only
    // compare points separated by at least one full corridor diameter.
    const nonlocalOffset = Math.ceil(CORRIDOR_WIDTH * 2.2 / SEGMENT_STEP);
    for (let a = 0; a < points.length - 1; a++) for (let b = a + nonlocalOffset; b < points.length - 1; b++) {
      if (segmentDistance(points[a], points[a + 1], points[b], points[b + 1]) < HALF_WIDTH * 1.7) return false;
    }
    for (let otherIndex = edgeIndex + 1; otherIndex < edges.length; otherIndex++) {
      const other = edges[otherIndex];
      if (edge.a === other.a || edge.a === other.b || edge.b === other.a || edge.b === other.b) continue;
      for (let a = 0; a < points.length - 1; a++) for (let b = 0; b < polylines[otherIndex].length - 1; b++) {
        if (segmentDistance(points[a], points[a + 1], polylines[otherIndex][b], polylines[otherIndex][b + 1]) < CLEARANCE) return false;
      }
    }
  }
  return true;
}

function addOrganicReconnects(random, nodes, tree, curved, graph) {
  const candidates = curved.map((edge, index) => ({ edge, index, order: random() }))
    .filter(item => item.edge.length >= 0.36)
    .sort((a, b) => a.order - b.order);
  const loopEdges = [];
  for (const { edge: base } of candidates) {
    let accepted = null;
    for (const side of [-1, 1]) {
      const bulge = side * Math.min(0.30, Math.max(0.26, base.length * 0.62));
      const curvature = base.curvature + bulge;
      const points = bezier(nodes[base.a], nodes[base.b], curvature);
      if (points.some(point => Math.hypot(point.x, point.y) > RADIUS - HALF_WIDTH)) continue;
      let clear = true;
      for (let index = 0; index < points.length - 1 && clear; index++) {
        for (const existing of curved) {
          const shared = [base.a, base.b].filter(id => id === existing.a || id === existing.b);
          const midpoint = { x: (points[index].x + points[index + 1].x) / 2, y: (points[index].y + points[index + 1].y) / 2 };
          if (shared.some(id => distance(midpoint, nodes[id]) < 0.16)) continue;
          for (let other = 0; other < existing.points.length - 1; other++) {
            const otherMidpoint = { x: (existing.points[other].x + existing.points[other + 1].x) / 2, y: (existing.points[other].y + existing.points[other + 1].y) / 2 };
            if (shared.some(id => distance(otherMidpoint, nodes[id]) < 0.16)) continue;
            if (segmentDistance(points[index], points[index + 1], existing.points[other], existing.points[other + 1]) < CLEARANCE) { clear = false; break; }
          }
          if (!clear) break;
        }
        for (const existing of loopEdges) for (let other = 0; other < existing.points.length - 1; other++) {
          if (segmentDistance(points[index], points[index + 1], existing.points[other], existing.points[other + 1]) < CLEARANCE) { clear = false; break; }
        }
      }
      if (clear && curvesAreClear([{ a: base.a, b: base.b, points }], [points])) { accepted = { points, curvature }; break; }
    }
    if (!accepted) continue;

    // Split the reconnection into two real graph nodes so the alternative
    // passage is explicit and can be traversed or inked like every other edge.
    const firstCut = Math.floor((accepted.points.length - 1) / 3);
    const secondCut = Math.floor((accepted.points.length - 1) * 2 / 3);
    const firstId = nodes.length, secondId = firstId + 1;
    nodes.push(copy(accepted.points[firstCut]), copy(accepted.points[secondCut]));
    graph.push([], []);
    const ids = [base.a, firstId, secondId, base.b], cuts = [0, firstCut, secondCut, accepted.points.length - 1];
    for (let index = 0; index < 3; index++) {
      const points = accepted.points.slice(cuts[index], cuts[index + 1] + 1);
      const part = { a: ids[index], b: ids[index + 1], points, length: points.slice(1).reduce((sum, point, partIndex) => sum + distance(point, points[partIndex]), 0), curvature: accepted.curvature, reconnection: true };
      loopEdges.push(part); graph[part.a].push(part.b); graph[part.b].push(part.a);
    }
    if (loopEdges.length >= 3) break;
  }
  return loopEdges;
}

function extensionIsClear(leafId, extension, edges, polylines) {
  for (let index = 0; index < edges.length; index++) {
    if (edges[index].a === leafId || edges[index].b === leafId) continue;
    const points = polylines[index];
    for (let a = 0; a < extension.length - 1; a++) for (let b = 0; b < points.length - 1; b++) {
      if (segmentDistance(extension[a], extension[a + 1], points[b], points[b + 1]) < CLEARANCE) return false;
    }
  }
  return true;
}

function offsetPolyline(points, side, startTrim = 0, endTrim = 0) {
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) cumulative.push(cumulative.at(-1) + distance(points[index - 1], points[index]));
  const total = cumulative.at(-1);
  const filtered = points.filter((_, index) => cumulative[index] >= startTrim && cumulative[index] <= total - endTrim);
  return filtered.map((point, index) => {
    const before = filtered[Math.max(0, index - 1)], after = filtered[Math.min(filtered.length - 1, index + 1)];
    const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1;
    return { x: point.x - side * dy / length * HALF_WIDTH, y: point.y + side * dx / length * HALF_WIDTH };
  });
}

function buildSpatialIndex(edges, extensions) {
  const bins = new Map(), binSize = 0.14;
  const segments = [];
  const addPolyline = (points, kind, edgeId) => {
    for (let index = 0; index < points.length - 1; index++) {
      const a = points[index], b = points[index + 1], segment = { a, b, kind, edgeId };
      const minX = Math.floor((Math.min(a.x, b.x) - HALF_WIDTH) / binSize), maxX = Math.floor((Math.max(a.x, b.x) + HALF_WIDTH) / binSize);
      const minY = Math.floor((Math.min(a.y, b.y) - HALF_WIDTH) / binSize), maxY = Math.floor((Math.max(a.y, b.y) + HALF_WIDTH) / binSize);
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
        const key = `${x},${y}`; if (!bins.has(key)) bins.set(key, []); bins.get(key).push(segment);
      }
      segments.push(segment);
    }
  };
  edges.forEach((edge, index) => addPolyline(edge.points, 'graph', index));
  extensions.forEach((item, index) => addPolyline(item.points, item.kind, index));
  return {
    segmentCount: segments.length,
    distanceTo(point) {
      const key = `${Math.floor(point.x / binSize)},${Math.floor(point.y / binSize)}`;
      let closest = Infinity;
      for (const segment of bins.get(key) ?? []) closest = Math.min(closest, pointSegmentDistance(point, segment.a, segment.b));
      return closest;
    },
  };
}

function makeBoundaryPaths(portals) {
  const sorted = portals.map(portal => portal.angle).sort((a, b) => a - b);
  const gap = HALF_WIDTH / RADIUS * 1.35;
  const paths = [];
  for (let index = 0; index < sorted.length; index++) {
    const start = sorted[index] + gap;
    const end = (sorted[(index + 1) % sorted.length] - gap) + (index === sorted.length - 1 ? Math.PI * 2 : 0);
    const count = Math.max(2, Math.ceil((end - start) * RADIUS / RENDER_STEP));
    paths.push(Array.from({ length: count + 1 }, (_, step) => {
      const angle = start + (end - start) * step / count;
      return { x: RADIUS * Math.cos(angle), y: RADIUS * Math.sin(angle) };
    }));
  }
  return paths;
}

function qualityFor(path, graph, nodes, routeEdges, allEdges) {
  const decisions = path.slice(1, -1).filter(node => graph[node].length >= 3).length;
  const routeSet = new Set(routeEdges);
  const routeNodes = new Set(path), visited = new Set(routeNodes), branches = [];
  for (let node = 0; node < graph.length; node++) {
    if (visited.has(node)) continue;
    const component = [], queue = [node]; visited.add(node);
    for (let index = 0; index < queue.length; index++) {
      const here = queue[index]; component.push(here);
      for (const next of graph[here]) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    const members = new Set(component);
    const length = allEdges.filter(edge => members.has(edge.a) || members.has(edge.b))
      .filter(edge => (members.has(edge.a) || routeNodes.has(edge.a)) && (members.has(edge.b) || routeNodes.has(edge.b)))
      .reduce((sum, edge) => sum + edge.length, 0);
    branches.push({ length, nodes: component.length });
  }
  branches.sort((a, b) => b.length - a.length);
  return {
    solutionLength: routeEdges.reduce((sum, id) => sum + allEdges[id].length, 0),
    meaningfulDecisions: decisions,
    routeJunctions: decisions,
    branchCount: branches.length,
    optionalBranchLengths: branches.map(branch => branch.length),
    optionalBranchNodeCounts: branches.map(branch => branch.nodes),
    largestOptionalBranch: branches[0]?.length ?? 0,
    deadEnds: graph.filter(neighbors => neighbors.length === 1).length,
  };
}

function generateCandidate(seed, attempt) {
  const random = createOrganicRandom((Number(seed) + Math.imul(attempt + 1, 0x9e3779b1)) >>> 0);
  let nodes;
  try { nodes = sampleDisk(random); } catch { return { rejected: 'point-spacing' }; }
  const tree = makeTree(nodes);
  const graph = adjacency(nodes, tree);
  const curved = tree.map(edge => {
    const offsetRange = Math.min(0.14, edge.length * 0.34);
    const firstBend = (random() - 0.5) * 2 * offsetRange, secondBend = (random() - 0.5) * 2 * offsetRange;
    const points = bezier(nodes[edge.a], nodes[edge.b], firstBend, secondBend);
    const length = points.slice(1).reduce((sum, point, index) => sum + distance(point, points[index]), 0);
    return { ...edge, points, length, curvature: (firstBend + secondBend) / 2, firstBend, secondBend };
  });
  if (!curvesAreClear(curved, curved.map(edge => edge.points))) return { rejected: 'curve-clearance' };
  const reconnects = addOrganicReconnects(random, nodes, tree, curved, graph);
  if (reconnects.length < 1) return { rejected: 'no-safe-reconnection' };
  const mazeEdges = [...curved, ...reconnects];
  const allCurves = [...curved, ...reconnects];

  const leafPortals = [];
  for (let nodeId = 0; nodeId < graph.length; nodeId++) {
    if (graph[nodeId].length !== 1) continue;
    const parent = nodes[graph[nodeId][0]], portal = radialPortal(nodes[nodeId], parent);
    if (!portal) continue;
    const points = linePoints(nodes[nodeId], portal.boundary);
    if (!extensionIsClear(nodeId, points, allCurves, allCurves.map(edge => edge.points))) continue;
    leafPortals.push({ nodeId, ...portal, points });
  }
  const pairs = [];
  for (const entrance of leafPortals) for (const exit of leafPortals) {
    if (entrance.nodeId >= exit.nodeId || angularDistance(entrance.angle, exit.angle) < 1.15) continue;
    let portalClear = true;
    for (let a = 0; a < entrance.points.length - 1 && portalClear; a++) for (let b = 0; b < exit.points.length - 1; b++) {
      if (segmentDistance(entrance.points[a], entrance.points[a + 1], exit.points[b], exit.points[b + 1]) < CLEARANCE) { portalClear = false; break; }
    }
    if (!portalClear) continue;
      const path = shortestGraphPath(graph, mazeEdges, entrance.nodeId, exit.nodeId);
    const routeEdges = [];
    for (let index = 1; index < path.length; index++) routeEdges.push(mazeEdges.findIndex(edge => (edge.a === path[index - 1] && edge.b === path[index]) || (edge.b === path[index - 1] && edge.a === path[index])));
    const quality = qualityFor(path, graph, nodes, routeEdges, mazeEdges);
    if (quality.solutionLength < 2.35 || quality.meaningfulDecisions < 2 || quality.branchCount < 4) continue;
    pairs.push({ entrance, exit, path, routeEdges, quality });
  }
  if (!pairs.length) return { rejected: 'portal-or-route-quality' };
  const chosen = pairs[Math.floor(random() * pairs.length)];
  const extensions = [
    { kind: 'entrance', points: chosen.entrance.points },
    { kind: 'exit', points: [...chosen.exit.points, ...linePoints(chosen.exit.boundary, chosen.exit.outside).slice(1)] },
  ];
  const geometryEdges = [...allCurves, ...extensions.map((extension, index) => ({
    a: index === 0 ? 'entrance' : 'exit', b: index === 0 ? chosen.entrance.nodeId : chosen.exit.nodeId,
    points: extension.points, length: extension.points.slice(1).reduce((sum, point, i) => sum + distance(point, extension.points[i]), 0),
  }))];
  const spatial = buildSpatialIndex(allCurves, extensions);
  const wallPaths = [];
  for (const edge of allCurves) {
    const trimA = graph[edge.a].length > 2 ? JUNCTION_RADIUS : 0;
    const trimB = graph[edge.b].length > 2 ? JUNCTION_RADIUS : 0;
    for (const side of [-1, 1]) wallPaths.push(offsetPolyline(edge.points, side, trimA, trimB));
  }
  // Portal connectors have walls up to their intentional openings in the rim.
  for (const extension of extensions) for (const side of [-1, 1]) wallPaths.push(offsetPolyline(extension.points, side, extension.kind === 'entrance' ? 0 : 0, extension.kind === 'exit' ? 0.125 : 0));
  const entrance = { position: chosen.entrance.boundary, angle: chosen.entrance.angle, edge: 'circle' };
  const exit = { position: chosen.exit.boundary, angle: chosen.exit.angle, direction: chosen.exit.direction, outside: chosen.exit.outside, edge: 'circle' };
  const start = { x: chosen.entrance.boundary.x - chosen.entrance.direction.x * 0.018, y: chosen.entrance.boundary.y - chosen.entrance.direction.y * 0.018 };
  const portalLength = chosen.entrance.points.slice(1).reduce((sum, point, i) => sum + distance(point, chosen.entrance.points[i]), 0)
    + chosen.exit.points.slice(1).reduce((sum, point, i) => sum + distance(point, chosen.exit.points[i]), 0);
  const quality = { ...chosen.quality, solutionLength: chosen.quality.solutionLength + portalLength,
    minimumCorridorClearance: CLEARANCE, exitInternalDegree: 1, exitGatedCells: 0 };
  const geometryFingerprint = fingerprint(JSON.stringify({ nodes: nodes.map(pointKey), edges: allCurves.map(edge => [edge.a, edge.b, edge.curvature.toFixed(5), edge.firstBend?.toFixed(5), edge.secondBend?.toFixed(5)]), entrance: chosen.entrance.nodeId, exit: chosen.exit.nodeId }));
  const curveLengths = allCurves.map(edge => edge.points.slice(1).reduce((sum, point, i) => sum + distance(point, edge.points[i]), 0));
  return {
    mazeFormat: 'organic', shapeId: 'organic-circle', shapeName: 'Organic Circle', selectionMode: 'qa-prototype',
    seed: Number(seed) >>> 0, attempt: attempt + 1, width: null, height: null, cells: [], mask: null,
    layoutFingerprint: geometryFingerprint,
    nodes: nodes.map((point, id) => ({ id, ...copy(point), degree: graph[id].length })),
    edges: geometryEdges.map((edge, id) => ({ id, a: edge.a, b: edge.b, points: edge.points.map(copy), length: edge.length ?? curveLengths[id] })),
    graph, solutionNodePath: chosen.path, solutionEdgePath: chosen.routeEdges,
    start, entrance, end: exit.position, exit,
    geometry: {
      radius: RADIUS, corridorWidth: CORRIDOR_WIDTH, halfWidth: HALF_WIDTH,
      worldViewRadius: WORLD_VIEW_RADIUS, segmentStep: SEGMENT_STEP, renderStep: RENDER_STEP,
      edges: allCurves, extensions, spatial, wallPaths, boundaryPaths: makeBoundaryPaths([entrance, exit]),
      isLegalPoint(point, tolerance = 0) {
        const radial = Math.hypot(point.x, point.y);
        if (radial > RADIUS + Math.max(tolerance, 1e-8)) {
          const alongExit = (point.x - exit.position.x) * exit.direction.x + (point.y - exit.position.y) * exit.direction.y;
          const crossExit = Math.abs((point.x - exit.position.x) * exit.direction.y - (point.y - exit.position.y) * exit.direction.x);
          if (alongExit < -tolerance || alongExit > 0.126 + tolerance || crossExit > HALF_WIDTH - 0.002 + tolerance) return false;
        }
        return spatial.distanceTo(point) <= HALF_WIDTH - 0.002 + tolerance;
      },
      containsMazePoint(point) { return this.isLegalPoint(point); },
      get wallSegmentCount() { return spatial.segmentCount; },
    },
    quality, generationAttempts: attempt + 1, generationDurationMs: 0,
    unitsPerSecond: 0.42,
  };
}

/** QA-only Organic Circle. A bounded seeded search rejects poor or unsafe geometry. */
export function createOrganicCircleMaze({ seed = 1, maxAttempts = 96 } = {}) {
  if (!Number.isInteger(Number(seed)) || !Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('Organic maze seed and retry budget must be integers.');
  const started = globalThis.performance?.now?.() ?? Date.now();
  const rejected = {};
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const maze = generateCandidate(seed, attempt);
    if (maze?.rejected) { rejected[maze.rejected] = (rejected[maze.rejected] ?? 0) + 1; continue; }
    if (!maze) continue;
    maze.generationRejections = { ...rejected };
    maze.generationDurationMs = (globalThis.performance?.now?.() ?? Date.now()) - started;
    return maze;
  }
  throw new Error(`Organic Circle seed ${seed} did not meet geometry and route quality limits in ${maxAttempts} attempts (${JSON.stringify(rejected)}).`);
}

/** Async counterpart used by QA UI; yields between rejected candidates to keep input responsive. */
export async function createOrganicCircleMazeAsync({ seed = 1, maxAttempts = 96, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  if (!Number.isInteger(Number(seed)) || !Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('Organic maze seed and retry budget must be integers.');
  const started = globalThis.performance?.now?.() ?? Date.now();
  const rejected = {};
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const maze = generateCandidate(seed, attempt);
    if (maze && !maze.rejected) {
      maze.generationRejections = { ...rejected };
      maze.generationDurationMs = (globalThis.performance?.now?.() ?? Date.now()) - started;
      return maze;
    }
    if (maze?.rejected) rejected[maze.rejected] = (rejected[maze.rejected] ?? 0) + 1;
    if (attempt + 1 < maxAttempts) await yieldControl();
  }
  throw new Error(`Organic Circle seed ${seed} did not meet geometry and route quality limits in ${maxAttempts} attempts (${JSON.stringify(rejected)}).`);
}

export function organicPointToSvg(point, size = 400) {
  const scale = size / (2 * WORLD_VIEW_RADIUS);
  return { x: (point.x + WORLD_VIEW_RADIUS) * scale, y: (point.y + WORLD_VIEW_RADIUS) * scale };
}

export function organicPathD(points, map = organicPointToSvg) {
  return points.map((point, index) => {
    const mapped = map(point);
    return `${index ? 'L' : 'M'}${mapped.x.toFixed(2)},${mapped.y.toFixed(2)}`;
  }).join(' ');
}

export function organicWallGeometry(maze) {
  return {
    boundaries: maze.geometry.boundaryPaths.map(path => organicPathD(path)),
    walls: maze.geometry.wallPaths.map(path => organicPathD(path)),
    entrance: organicPointToSvg(maze.entrance.position),
    exit: organicPointToSvg(maze.exit.position),
    start: organicPointToSvg(maze.start),
  };
}

/** Reconstructs the exact accepted centerline solution, including both portal connectors. */
export function getOrganicSolutionPolyline(maze) {
  const result = [copy(maze.start)];
  const entranceExtension = maze.geometry.extensions.find(item => item.kind === 'entrance').points;
  for (const point of [...entranceExtension].reverse().slice(1)) result.push(copy(point));
  for (let index = 1; index < maze.solutionNodePath.length; index++) {
    const from = maze.solutionNodePath[index - 1], to = maze.solutionNodePath[index];
    const edgeId = maze.solutionEdgePath[index - 1], edge = maze.edges[edgeId];
    const points = edge.a === from ? edge.points : [...edge.points].reverse();
    for (const point of points.slice(1)) result.push(copy(point));
  }
  const exitExtension = maze.geometry.extensions.find(item => item.kind === 'exit').points;
  for (const point of exitExtension.slice(1)) result.push(copy(point));
  return result;
}

/** Structural and geometric checks used by the deterministic prototype audit. */
export function validateOrganicMaze(maze) {
  if (maze?.mazeFormat !== 'organic' || maze.shapeId !== 'organic-circle' || !maze.geometry || !maze.nodes?.length || !maze.edges?.length) return false;
  if (maze.nodes.length < 14 || (maze.nodes.length - 14) % 2 !== 0 || maze.graph.length !== maze.nodes.length) return false;
  if (maze.graph.some(neighbors => neighbors.some(id => !Number.isInteger(id) || !maze.nodes[id]))) return false;
  const reached = new Set([0]), queue = [0];
  for (let index = 0; index < queue.length; index++) for (const next of maze.graph[queue[index]]) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  const internalEdgeCount = maze.edges.length - 2; // Exclude entrance and exit portal connectors.
  if (reached.size !== maze.nodes.length || internalEdgeCount !== maze.graph.reduce((sum, neighbors) => sum + neighbors.length, 0) / 2 || internalEdgeCount < maze.nodes.length) return false;
  if (maze.solutionNodePath.length < 2 || maze.solutionEdgePath.length !== maze.solutionNodePath.length - 1) return false;
  if (maze.graph[maze.solutionNodePath[0]].length !== 1 || maze.graph[maze.solutionNodePath.at(-1)].length !== 1) return false;
  if (!maze.geometry.isLegalPoint(maze.start) || maze.quality.exitInternalDegree !== 1 || maze.quality.exitGatedCells !== 0) return false;
  const solution = getOrganicSolutionPolyline(maze);
  if (solution.length < 3 || solution.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  return maze.quality.solutionLength >= 2.35 && maze.quality.meaningfulDecisions >= 2 && maze.quality.branchCount >= 4;
}

export const ORGANIC_CIRCLE_CONSTANTS = Object.freeze({
  radius: RADIUS, corridorWidth: CORRIDOR_WIDTH, halfWidth: HALF_WIDTH,
  segmentStep: SEGMENT_STEP, renderStep: RENDER_STEP, minimumClearance: CLEARANCE,
  viewRadius: WORLD_VIEW_RADIUS, unitsPerSecond: 0.42,
});
