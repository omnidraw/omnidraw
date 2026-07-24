import type { CapsuleParkabilityDeclaration } from '@omnidraw/capsule/protocol';

export const VIBECANVAS_CAPSULE_PREVIEW_SIGNING_KEY_ID = 'vibecanvas-preview-v1';
export const VIBECANVAS_CAPSULE_RELEASE_SIGNING_KEY_ID = 'vibecanvas-release-v1';

/** Snapshot parking remains denied for the first Capsule release. */
export const VIBECANVAS_CAPSULE_PARKABILITY = Object.freeze({
  parkable: false,
}) satisfies CapsuleParkabilityDeclaration;
