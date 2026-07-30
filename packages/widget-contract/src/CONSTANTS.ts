export const WIDGET_FRAME_MIN_WIDTH = 100
export const WIDGET_FRAME_MIN_HEIGHT = 76
export const WIDGET_FRAME_MAX_WIDTH = 2_048
export const WIDGET_FRAME_MAX_HEIGHT = 2_048
export const WIDGET_FRAME_FALLBACK = Object.freeze({ width: 360, height: 320 })

export const WIDGET_CAPSULE_API_GROUPS = Object.freeze([
  'DOM',
  'NETWORK',
  'FILES',
  'CLIPBOARD',
  'DIALOGS',
  'CANVAS_2D',
  'WEBGL',
  'WEBGPU',
  'AUDIO',
  'VIDEO',
] as const)
