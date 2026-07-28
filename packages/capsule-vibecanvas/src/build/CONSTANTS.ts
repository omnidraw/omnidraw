import {
  CAPSULE_ARTIFACT_RESOURCES_PROFILE,
  CAPSULE_ARTIFACT_RESOURCES_V2_PROFILE,
  CAPSULE_ARTIFACT_RESOURCES_V3_PROFILE,
  CAPSULE_CANVAS_2D_PROFILE,
  CAPSULE_CANVAS_WEBGL_PROFILE,
  CAPSULE_CANVAS_WEBGPU_PROFILE,
  CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
  CAPSULE_DOM_CORE_V2_PROFILE,
  CAPSULE_DOM_SELECTION_PROFILE,
  CAPSULE_RUNTIME_ABI,
  CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
  CAPSULE_SVG_DOM_PROFILE,
} from '@omnidraw/capsule/protocol';

export const VIBECANVAS_CAPSULE_BUILD_POLICY_ID = 'vibecanvas-capsule-widget-v1';

export const VIBECANVAS_CAPSULE_DEFAULT_BUDGETS = Object.freeze({
  cpuMs: 750,
  memoryBytes: 32 * 1024 * 1024,
  domNodes: 10_000,
  // Capsule partitions this total; 22k leaves over 10k DOM object handles.
  handles: 22_000,
  messageBytes: 64 * 1024,
  streamBytes: 256 * 1024,
  assetBytes: 4 * 1024 * 1024,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 256 * 1024,
});

export const VIBECANVAS_CAPSULE_BUDGET_CEILINGS = Object.freeze({
  cpuMs: 2_000,
  memoryBytes: 64 * 1024 * 1024,
  domNodes: 10_000,
  handles: 22_000,
  messageBytes: 1024 * 1024,
  streamBytes: 1024 * 1024,
  assetBytes: 16 * 1024 * 1024,
  networkBytes: 0,
  gpuBytes: 64 * 1024 * 1024,
  lifecycleBytes: 1024 * 1024,
});

export const VIBECANVAS_CAPSULE_ALLOWED_TARGET = Object.freeze({
  runtimeAbi: CAPSULE_RUNTIME_ABI,
  domProfile: CAPSULE_DOM_CORE_V2_PROFILE,
});

export const VIBECANVAS_CAPSULE_ALLOWED_FEATURE_PROFILES = Object.freeze([
  CAPSULE_ARTIFACT_RESOURCES_PROFILE,
  CAPSULE_ARTIFACT_RESOURCES_V2_PROFILE,
  CAPSULE_ARTIFACT_RESOURCES_V3_PROFILE,
  CAPSULE_CANVAS_2D_PROFILE,
  CAPSULE_CANVAS_WEBGL_PROFILE,
  CAPSULE_CANVAS_WEBGPU_PROFILE,
  CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
  CAPSULE_DOM_SELECTION_PROFILE,
  CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
  CAPSULE_SVG_DOM_PROFILE,
]);

export const VIBECANVAS_CAPSULE_BUILD_POLICY = Object.freeze({
  maxFiles: 1_024,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxPathBytes: 256,
  maxPathDepth: 24,
  maxModules: 1_024,
  maxOutputBytes: 16 * 1024 * 1024,
  budgetDefaults: VIBECANVAS_CAPSULE_DEFAULT_BUDGETS,
  budgetCeilings: VIBECANVAS_CAPSULE_BUDGET_CEILINGS,
});

export const VIBECANVAS_CAPSULE_ALLOWED_SERVER_IMPORTS = Object.freeze([
  '@vibecanvas/sdk/server',
  'zod',
]);

export const VIBECANVAS_SERVER_ARTIFACT_FORMAT =
  'vibecanvas.server-artifact.v1';
