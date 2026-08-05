export const WIDGET_FRAME_MIN_WIDTH = 100
export const WIDGET_FRAME_MIN_HEIGHT = 76
export const WIDGET_FRAME_MAX_WIDTH = 2_048
export const WIDGET_FRAME_MAX_HEIGHT = 2_048
export const WIDGET_FRAME_FALLBACK = Object.freeze({ width: 360, height: 320 })

export const WIDGET_MANIFEST_V1_SCHEMA_URL = 'https://omnidraw.dev/schemas/widget/v1.json' as const
export const WIDGET_RELEASE_FORMAT = 'omnidraw.widget-release.v1' as const
export const WIDGET_SLUG_MAX_BYTES = 100
export const WIDGET_NAME_MAX_CHARACTERS = 200
export const WIDGET_DESCRIPTION_MAX_CHARACTERS = 2_000
export const WIDGET_TOOL_LABEL_MAX_CHARACTERS = 120
export const WIDGET_TOOL_GROUP_MAX_BYTES = 100
export const WIDGET_TOOL_ICON_MAX_BYTES = 16 * 1_024
export const WIDGET_BUILD_PATH_MAX_BYTES = 512
export const WIDGET_BUILD_FILE_COUNT_MAX = 1_024
export const WIDGET_BUILD_FILE_MAX_BYTES = 4 * 1_024 * 1_024
export const WIDGET_BUILD_TOTAL_BYTES_MAX = 32 * 1_024 * 1_024
export const WIDGET_RELEASE_FILE_MAX_BYTES = 256 * 1_024 * 1_024
export const WIDGET_RELEASE_FILE_COUNT_MAX = 10_000

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
