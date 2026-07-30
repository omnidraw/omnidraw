import type { CapsuleApiGroup } from '@omnidraw/capsule/protocol';
import type { TVibecanvasCapsuleApiGroup } from './types';
import { VIBECANVAS_CAPSULE_ALLOWED_APIS } from './CONSTANTS';

/** Copies and normalizes author-selected public API groups. */
export function fnMapCapsuleApis(
  apis: readonly TVibecanvasCapsuleApiGroup[],
): readonly CapsuleApiGroup[] {
  const selected = new Set(apis);
  if (selected.size !== apis.length || !selected.has('DOM')) {
    throw new TypeError('Capsule API groups must be unique and explicitly include DOM.');
  }
  const renderingGroups = ['CANVAS_2D', 'WEBGL', 'WEBGPU']
    .filter((api) => selected.has(api as TVibecanvasCapsuleApiGroup));
  if (renderingGroups.length > 1) {
    throw new TypeError('CANVAS_2D, WEBGL, and WEBGPU are mutually exclusive.');
  }
  const normalized = VIBECANVAS_CAPSULE_ALLOWED_APIS
    .filter((api) => selected.has(api));
  if (normalized.length !== apis.length) {
    throw new TypeError('Widget Capsule API request is outside Vibecanvas policy.');
  }
  return Object.freeze(normalized);
}
