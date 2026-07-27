import type {
  TWidgetCapsuleBuildIdentity,
  TWidgetCapsuleBudgets,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetCapsuleTarget,
  TWidgetManifestV3,
} from '../src';

export const CAPSULE_HASH_A = `sha256:${'a'.repeat(64)}` as const;
export const CAPSULE_HASH_B = `sha256:${'b'.repeat(64)}` as const;
export const RAW_DIGEST_A = 'a'.repeat(64);
export const RAW_DIGEST_B = 'b'.repeat(64);

export const CAPSULE_TARGET: TWidgetCapsuleTarget = Object.freeze({
  runtimeAbi: 'quickjs-release-sync-v1',
  domProfile: 'dom-core-v2',
  featureProfiles: Object.freeze([]),
});

export const CAPSULE_BUDGETS: TWidgetCapsuleBudgets = Object.freeze({
  cpuMs: 100,
  memoryBytes: 16 * 1024 * 1024,
  domNodes: 1_000,
  handles: 2_000,
  messageBytes: 64 * 1024,
  streamBytes: 0,
  assetBytes: 0,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 64 * 1024,
});

export const CAPSULE_BUILD_IDENTITY: TWidgetCapsuleBuildIdentity = Object.freeze({
  packageName: '@omnidraw/capsule',
  packageVersion: '0.9.4',
  packageDigest: CAPSULE_HASH_A,
  buildApiVersion: '0.1.0',
  runtimeBuildDigest: CAPSULE_HASH_B,
});

export const CAPSULE_RUNTIME_DESCRIPTOR: TWidgetCapsuleRuntimeDescriptor = Object.freeze({
  format: 'vibecanvas.capsule-runtime.v1',
  capsuleArtifactHash: CAPSULE_HASH_A,
  target: CAPSULE_TARGET,
  budgets: CAPSULE_BUDGETS,
  capabilityRequests: Object.freeze([]),
  channels: null,
  parkability: Object.freeze({ parkable: false }),
  signatureKeyIds: Object.freeze(['vibecanvas-preview-v1']),
});

export const CAPSULE_MANIFEST: TWidgetManifestV3 = Object.freeze({
  schemaVersion: 3,
  name: 'Example',
  slug: 'example',
  ui: Object.freeze({
    runtime: 'capsule',
    entry: 'src/ui.tsx',
    target: CAPSULE_TARGET,
  }),
});
