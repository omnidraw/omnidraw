import type { TWidgetCapsuleApiGroup } from '../types';
import { fnNormalizeWidgetCapsuleApis } from './fn.capsule';

export type TWidgetManifestDraftMigration = Readonly<{
  migrated: boolean;
  value: unknown;
}>;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

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
      throw new TypeError(`Unsupported persisted Capsule profile: ${profile}`);
  }
}

/**
 * Trusted compatibility boundary for editable persisted v3 drafts. Normal
 * manifest parsing never accepts the private target form.
 */
export function fnMigrateWidgetManifestDraft(
  value: unknown,
): TWidgetManifestDraftMigration {
  const manifest = record(value);
  const ui = record(manifest?.ui);
  const target = record(ui?.target);
  if (manifest === null || ui === null || target === null) {
    return Object.freeze({ migrated: false, value });
  }
  if (
    manifest.schemaVersion !== 3
    || ui.runtime !== 'capsule'
    || target.runtimeAbi !== 'quickjs-release-sync-v1'
    || target.domProfile !== 'dom-core-v2'
    || !Array.isArray(target.featureProfiles)
    || !target.featureProfiles.every((profile) => typeof profile === 'string')
  ) {
    throw new TypeError('Persisted Capsule draft target cannot be migrated.');
  }
  const selected = new Set<TWidgetCapsuleApiGroup>(['DOM']);
  for (const profile of target.featureProfiles as readonly string[]) {
    const api = legacyProfileApi(profile);
    if (api !== null) selected.add(api);
  }
  const { target: _target, ...publicUi } = ui;
  return Object.freeze({
    migrated: true,
    value: {
      ...manifest,
      ui: {
        ...publicUi,
        apis: fnNormalizeWidgetCapsuleApis([...selected]),
      },
    },
  });
}
