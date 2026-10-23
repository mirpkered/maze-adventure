const rowsFromPredicate = (width, height, predicate) => Array.from({ length: height }, (_, y) =>
  Array.from({ length: width }, (_, x) => Boolean(predicate(x, y))));

const normalizedPoint = (x, y, width, height) => ({
  x: (x - (width - 1) / 2) / ((width - 1) / 2),
  y: (y - (height - 1) / 2) / ((height - 1) / 2),
});

const pointInPolygon = (x, y, points) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

function castleMask() {
  const width = 23, height = 21;
  return rowsFromPredicate(width, height, (x, y) => {
    const keep = x >= 5 && x <= 17 && y >= 7;
    const leftTower = x >= 1 && x <= 7 && y >= 2 && y <= 9;
    const rightTower = x >= 15 && x <= 21 && y >= 2 && y <= 9;
    const centralTower = x >= 8 && x <= 14 && y >= 3 && y <= 9;
    const battlements = y === 1 && ((x >= 2 && x <= 3) || (x >= 5 && x <= 6)
      || (x >= 16 && x <= 17) || (x >= 19 && x <= 20));
    const gate = x >= 10 && x <= 12 && y >= 17;
    return keep || leftTower || rightTower || centralTower || battlements || gate;
  });
}

function heartMask() {
  const width = 23, height = 21;
  const outline = [
    [0, -.38], [.22, -.58], [.58, -.95], [.88, -.96], [1, -.66], [.96, -.34], [.76, .02],
    [0, .98], [-.76, .02], [-.96, -.34], [-1, -.66], [-.88, -.96], [-.58, -.95], [-.22, -.58],
  ];
  return rowsFromPredicate(width, height, (x, y) => {
    const { x: nx, y: ny } = normalizedPoint(x, y, width, height);
    return pointInPolygon(nx, ny, outline);
  });
}

function starMask() {
  const width = 23, height = 23;
  const outline = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? .98 : .43;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
  const mask = rowsFromPredicate(width, height, (x, y) => {
    const { x: nx, y: ny } = normalizedPoint(x, y, width, height);
    return pointInPolygon(nx, ny, outline);
  });
  // Pixel sampling leaves two one-cell gaps at the lower star points. Fill
  // those edge pixels so each point remains part of the orthogonal maze graph.
  mask[18][5] = true;
  mask[18][17] = true;
  return mask;
}

function diamondMask() {
  const width = 21, height = 21;
  return rowsFromPredicate(width, height, (x, y) => {
    const { x: nx, y: ny } = normalizedPoint(x, y, width, height);
    return Math.abs(nx) + Math.abs(ny) <= 1.04;
  });
}

function crossMask() {
  const width = 21, height = 21;
  return rowsFromPredicate(width, height, (x, y) => {
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    return Math.abs(x - cx) <= 2 || Math.abs(y - cy) <= 2;
  });
}

function arrowMask() {
  const width = 23, height = 19;
  return rowsFromPredicate(width, height, (x, y) => {
    const { x: nx, y: ny } = normalizedPoint(x, y, width, height);
    const shaft = nx <= 0.25 && nx >= -1 && Math.abs(ny) <= 0.2;
    const head = nx >= 0.05 && Math.abs(ny) <= (0.98 - nx) * 0.98;
    return shaft || head;
  });
}

function keyMask() {
  const width = 25, height = 19;
  return rowsFromPredicate(width, height, (x, y) => {
    const dx = x - 6, dy = y - 9;
    const radius = Math.hypot(dx, dy);
    const bow = radius >= 3.1 && radius <= 7.2;
    const shaft = x >= 11 && x <= 24 && Math.abs(y - 9) <= 1;
    const teeth = ((x >= 15 && x <= 17) || (x >= 21 && x <= 23)) && y >= 9 && y <= 14;
    return bow || shaft || teeth;
  });
}

function penguinMask() {
  // 15×27 cell mask sampled from the original Mirpworks mascot asset after
  // filling its outlined silhouette. See docs/SHAPED_MAZES_PHASE1.md.
  return [
    '          ##   ', '          ###  ', '       ####### ', '       ######  ',
    '        #####  ', '       ######  ', '         ##### ', '         ##### ',
    '        ###### ', '        ###### ', '       ####### ', '       ####### ',
    '      #########', '      #########', '      #########', '      #########',
    '     ##########', '     ##########', '     ##########', '     ##########',
    '     ######### ', '   ########### ', ' ############# ', '############## ',
    '############## ', '   ##########  ', '   #######     ',
  ].map(row => Array.from({ length: 15 }, (_, index) => row[index] === '#'));
}

const entries = [
  ['castle', 'Castle', castleMask(), { symbol: '♜', theme: 'A stone keep with four crenellated towers.' }],
  ['circle', 'Circle', rowsFromPredicate(23, 23, (x, y) => Math.hypot(...Object.values(normalizedPoint(x, y, 23, 23))) <= 0.98), { symbol: '◉', theme: 'A rounded garden of winding lanes.' }],
  ['heart', 'Heart', heartMask(), { symbol: '♥', theme: 'Two soft lobes meet in a pointed trail.' }],
  ['star', 'Star', starMask(), { symbol: '✦', theme: 'Five points surround a connected center.' }],
  ['diamond', 'Diamond', diamondMask(), { symbol: '◇', theme: 'Four clear points frame the maze.' }],
  ['cross', 'Cross', crossMask(), { symbol: '✚', theme: 'Four arms meet through the middle.' }],
  ['arrow', 'Arrow', arrowMask(), { symbol: '➤', theme: 'A broad arrowhead leads into its shaft.' }],
  ['key', 'Key', keyMask(), { symbol: '⚿', theme: 'A looped bow joins a notched shaft.' }],
  ['dj-penguin', 'DJ Penguin', penguinMask(), { symbol: '🐧', theme: 'Original Mirpworks mascot silhouette.' }],
];

export const SHAPE_MASKS = Object.freeze(Object.fromEntries(entries.map(([id, name, mask, display]) => [
  id,
  Object.freeze({
    id, name, width: mask[0].length, height: mask.length,
    mask: Object.freeze(mask.map(row => Object.freeze([...row]))),
    display: Object.freeze(display),
    sourceAsset: id === 'dj-penguin' ? './art/shapes/dj-penguin-reference.png' : null,
  }),
])));

export function getShapeMask(shapeId) {
  const definition = SHAPE_MASKS[shapeId];
  return definition ? definition.mask.map(row => [...row]) : null;
}
