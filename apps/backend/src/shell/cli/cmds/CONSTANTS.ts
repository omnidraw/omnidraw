export const CANVAS_SUBCOMMANDS = Object.freeze([
  'list',
  'query',
  'add',
  'patch',
  'move',
  'group',
  'ungroup',
  'reorder',
  'delete',
] as const);

export const CANVAS_GROUP_TRANSFORM = Object.freeze({
  position: Object.freeze({ x: 0, y: 0 }),
  rotation: 0,
  scale: Object.freeze({ x: 1, y: 1 }),
  skew: Object.freeze({ x: 0, y: 0 }),
  origin: Object.freeze({ x: 0, y: 0 }),
});
