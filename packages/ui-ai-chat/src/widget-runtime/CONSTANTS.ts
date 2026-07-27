export const WIDGET_UI_MAX_CONCURRENT_LOADS = 8;
export const WIDGET_UI_MAX_QUEUED_LOADS = 512;
export const WIDGET_UI_MAX_OWNER_RECORDS = 10_000;
export const WIDGET_UI_MAX_REPRIORITIZATION_CANDIDATES = 512;
export const WIDGET_UI_MAX_ACTIVE_RUNTIMES = 16;
export const WIDGET_UI_MAX_THROTTLED_RUNTIMES = 8;
export const WIDGET_UI_MAX_FROZEN_RUNTIMES = 16;
export const WIDGET_UI_MAX_LIVE_RUNTIMES = 24;
export const WIDGET_UI_MAX_HEAVY_RUNTIMES = 8;
export const WIDGET_UI_MAX_GPU_RUNTIMES = 2;
export const WIDGET_UI_OFFSCREEN_FREEZE_GRACE_MS = 2_000;
export const WIDGET_UI_FAR_OFFSCREEN_DESTROY_MS = 30_000;
/**
 * Product-owned CSS-pixel retention radius. Capsule defines the delay and
 * population ceilings but intentionally leaves the spatial radius to its host.
 */
export const WIDGET_UI_RETENTION_RADIUS_PX = 2_048;
export const WIDGET_UI_HEAVY_FEATURE_PROFILES = Object.freeze([
  'canvas-2d-v1',
  'canvas-webgl-v1',
  'canvas-webgpu-v1',
]);
export const WIDGET_UI_GPU_FEATURE_PROFILES = Object.freeze([
  'canvas-webgl-v1',
  'canvas-webgpu-v1',
]);
export const WIDGET_UI_OUTPUT_RATE_WINDOW_MS = 10_000;
export const WIDGET_UI_OUTPUT_RATE_MAX_EVENTS = 5;
