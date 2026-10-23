/**
 * Playable silhouette content is registered here only after its geometry,
 * generator, gameplay adapter, and QA coverage are ready. Concept art and
 * planned shapes do not belong in this registry.
 */
export const SHAPE_REGISTRY = Object.freeze([]);

export function getPlayableShapes(registry = SHAPE_REGISTRY) {
  const seen = new Set();
  return registry.filter(shape => {
    const eligible = shape
    && typeof shape.id === 'string'
    && /^[a-z][a-z0-9-]*$/.test(shape.id)
    && typeof shape.name === 'string'
    && shape.name.trim().length > 0
    && shape.availability === 'playable'
    && shape.validated === true
    && typeof shape.geometryProvider === 'function'
    && typeof shape.generator === 'function'
    && typeof shape.gameplayAdapter === 'function'
    && !seen.has(shape.id);
    if (eligible) seen.add(shape.id);
    return eligible;
  });
}

export function chooseSurpriseShape(registry = SHAPE_REGISTRY, random = Math.random) {
  const eligible = getPlayableShapes(registry);
  if (eligible.length === 0) return null;
  const sample = Number(random());
  const normalized = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON) : 0;
  return eligible[Math.floor(normalized * eligible.length)];
}

/** The route stores shape identity separately from Classic difficulty. */
export function createShapeRoute(shapeId, registry = SHAPE_REGISTRY) {
  const shape = getPlayableShapes(registry).find(candidate => candidate.id === shapeId);
  return shape ? Object.freeze({ category: 'shaped', shapeId: shape.id }) : null;
}
