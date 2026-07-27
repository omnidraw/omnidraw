/** @file Canonical Capsule-v3 metadata used by database tests outside the widget repository. */

const hash = (character: string): string => character.repeat(64);

export const WIDGET_CAPSULE_ARTIFACT_HASH = `sha256:${hash('c')}`;
export const WIDGET_CAPSULE_CAPABILITY_DIGEST = hash('d');
export const WIDGET_CAPSULE_CHANNEL_DIGEST = hash('e');
export const WIDGET_CAPSULE_BUILD_POLICY_ID = 'test-capsule-policy-v1';

export const WIDGET_CAPSULE_RUNTIME_JSON = JSON.stringify({
  format: 'vibecanvas.capsule-runtime.v1',
  capsuleArtifactHash: WIDGET_CAPSULE_ARTIFACT_HASH,
  target: {
    runtimeAbi: 'quickjs-release-sync-v1',
    domProfile: 'dom-core-v2',
    featureProfiles: [],
  },
  budgets: {
    cpuMs: 50,
    memoryBytes: 8 * 1_024 * 1_024,
    domNodes: 1_000,
    handles: 1_000,
    messageBytes: 1_024 * 1_024,
    streamBytes: 1_024 * 1_024,
    assetBytes: 4 * 1_024 * 1_024,
    networkBytes: 0,
    gpuBytes: 0,
    lifecycleBytes: 64 * 1_024,
  },
  capabilityRequests: [],
  channels: null,
  parkability: { parkable: false },
  signatureKeyIds: ['vibecanvas-release-v1'],
});

export const WIDGET_CAPSULE_BUILD_IDENTITY_JSON = JSON.stringify({
  packageName: '@omnidraw/capsule',
  packageVersion: '0.9.3',
  packageDigest: `sha256:${hash('a')}`,
  buildApiVersion: 'capsule-build-v1',
  runtimeBuildDigest: `sha256:${hash('b')}`,
});

export function widgetManifestV3Json(args: Readonly<{
  name: string;
  slug: string;
  serverRuntimeAbi?: string;
}>): string {
  return JSON.stringify({
    schemaVersion: 3,
    name: args.name,
    slug: args.slug,
    ui: {
      runtime: 'capsule',
      entry: 'ui.ts',
      target: {
        runtimeAbi: 'quickjs-release-sync-v1',
        domProfile: 'dom-core-v2',
        featureProfiles: [],
      },
    },
    ...(args.serverRuntimeAbi === undefined
      ? {}
      : { server: { entry: 'server.ts', runtimeAbi: args.serverRuntimeAbi } }),
  });
}
