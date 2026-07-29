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
  type CapsuleCompleteBudgetMaximums,
  type CapsuleParkabilityDeclaration,
} from '@omnidraw/capsule/protocol';

export const VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID = 'vibecanvas-preview-v1';
export const VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID = 'vibecanvas-release-v1';
export const VIBECANVAS_CAPSULE_TESTED_THREE_VERSION = '0.185.1';

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
}) satisfies CapsuleCompleteBudgetMaximums;

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
}) satisfies CapsuleCompleteBudgetMaximums;

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

export const VIBECANVAS_CAPSULE_GPU_FEATURE_PROFILES = Object.freeze([
  CAPSULE_CANVAS_WEBGL_PROFILE,
  CAPSULE_CANVAS_WEBGPU_PROFILE,
]);

export const VIBECANVAS_CAPSULE_AUTHORING_TARGET = Object.freeze({
  ...VIBECANVAS_CAPSULE_ALLOWED_TARGET,
  featureProfiles: Object.freeze([
    CAPSULE_ARTIFACT_RESOURCES_PROFILE,
    CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
    CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
  ]),
});

/** Snapshot parking remains denied for the first Capsule release. */
export const VIBECANVAS_CAPSULE_PARKABILITY = Object.freeze({
  parkable: false,
}) satisfies CapsuleParkabilityDeclaration;
