import {
  CAPSULE_API_GROUP_BUNDLE_DIGEST,
  CAPSULE_API_GROUP_CONTRACT_FORMAT,
  CAPSULE_API_GROUPS,
  type CapsuleBudgetRequest,
  type CapsuleParkabilityDeclaration,
} from '@omnidraw/capsule/protocol';

export const VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID = 'vibecanvas-preview-v1';
export const VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID = 'vibecanvas-release-v1';
export const VIBECANVAS_CAPSULE_TESTED_THREE_VERSION = '0.185.1';

/** Product API admission ceiling; each host receives one valid artifact subset. */
export const VIBECANVAS_CAPSULE_ALLOWED_APIS = Object.freeze([
  ...CAPSULE_API_GROUPS,
]);
export const VIBECANVAS_CAPSULE_AUTHORING_APIS = Object.freeze(['DOM'] as const);

/** Product-owned overrides only; omitted dimensions use Capsule group policy. */
export const VIBECANVAS_CAPSULE_LIMITS = Object.freeze({
  gpuBytes: 64 * 1024 * 1024,
}) satisfies CapsuleBudgetRequest;

/** Host groups use Capsule's own defaults unless Vibecanvas measures a need to narrow them. */
export const VIBECANVAS_CAPSULE_HOST_LIMITS = Object.freeze(
  {},
) satisfies CapsuleBudgetRequest;

export const VIBECANVAS_CAPSULE_API_CONTRACT_FORMAT =
  CAPSULE_API_GROUP_CONTRACT_FORMAT;
export const VIBECANVAS_CAPSULE_API_BUNDLE_DIGEST =
  CAPSULE_API_GROUP_BUNDLE_DIGEST;

/** Snapshot parking remains denied for the first Capsule release. */
export const VIBECANVAS_CAPSULE_PARKABILITY = Object.freeze({
  parkable: false,
}) satisfies CapsuleParkabilityDeclaration;
