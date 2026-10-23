import { createShapedMaze } from './shaped-mazes.js';
import { getShapeMask, SHAPE_MASKS } from './shape-masks.js';

const definitions = Object.values(SHAPE_MASKS);

/**
 * Only entries with a connected mask, generator, shared-game adapter, and
 * completed deterministic audit are registered as playable.
 */
export const SHAPE_REGISTRY = Object.freeze(definitions.map(shape => Object.freeze({
  id: shape.id,
  name: shape.name,
  availability: 'playable',
  validated: true,
  sourceAsset: shape.sourceAsset,
  display: shape.display,
  geometryProvider: () => getShapeMask(shape.id),
  generator: (random = Math.random, seed = null, selectionMode = 'chosen') => createShapedMaze({
    id: shape.id, name: shape.name, geometryProvider: () => getShapeMask(shape.id),
  }, { random, seed, selectionMode }),
  gameplayAdapter: maze => maze?.mazeFormat === 'shaped' && maze.shapeId === shape.id,
})));

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

/** Shape identity and Surprise Me semantics remain independent of Classic difficulty. */
export function createShapeRoute(shapeId, registry = SHAPE_REGISTRY, selectionMode = 'chosen') {
  const shape = getPlayableShapes(registry).find(candidate => candidate.id === shapeId);
  if (!shape || !['chosen', 'surprise'].includes(selectionMode)) return null;
  return Object.freeze({ category: 'shaped', shapeId: shape.id, selectionMode });
}

export function getShape(shapeId, registry = SHAPE_REGISTRY) {
  return getPlayableShapes(registry).find(shape => shape.id === shapeId) ?? null;
}
