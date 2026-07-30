import type {
  TWidgetCapsuleApiGroup,
  TWidgetCapsuleRuntimeDescriptor,
} from '@vibecanvas/widget-contract';

const API_ORDER = [
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
] as const satisfies readonly TWidgetCapsuleApiGroup[];

function legacyProfileApi(profile: string): TWidgetCapsuleApiGroup | null {
  switch (profile) {
    case 'artifact-resources-v1':
    case 'artifact-resources-v2':
    case 'artifact-resources-v3':
    case 'shadow-browser-css-v1':
    case 'svg-dom-v1':
      return null;
    case 'css-network-images-v1':
    case 'fetch-buffered-v1':
      return 'NETWORK';
    case 'canvas-2d-v1':
      return 'CANVAS_2D';
    case 'canvas-webgl-v1':
      return 'WEBGL';
    case 'canvas-webgpu-v1':
      return 'WEBGPU';
    default:
      throw new TypeError(`Unsupported retained Capsule 0.9.4 profile: ${profile}`);
  }
}

/**
 * Returns public authority for native artifacts and a bounded compatibility
 * projection for immutable 0.9.4 artifacts.
 */
export function fnWidgetCapsuleRuntimeApis(
  descriptor: TWidgetCapsuleRuntimeDescriptor,
): readonly TWidgetCapsuleApiGroup[] {
  if (descriptor.format === 'vibecanvas.capsule-runtime.v2') {
    return descriptor.apiContract.groups;
  }
  if (
    descriptor.target.runtimeAbi !== 'quickjs-release-sync-v1'
    || descriptor.target.domProfile !== 'dom-core-v2'
  ) {
    throw new TypeError('Unsupported retained Capsule 0.9.4 target.');
  }
  const selected = new Set<TWidgetCapsuleApiGroup>(['DOM']);
  for (const profile of descriptor.target.featureProfiles) {
    const api = legacyProfileApi(profile);
    if (api !== null) selected.add(api);
  }
  const renderingApis = ['CANVAS_2D', 'WEBGL', 'WEBGPU']
    .filter((api) => selected.has(api as TWidgetCapsuleApiGroup));
  if (renderingApis.length > 1) {
    throw new TypeError('Retained Capsule artifact has conflicting rendering authority.');
  }
  return Object.freeze(API_ORDER.filter((api) => selected.has(api)));
}
