import type {
  TWidgetCapsuleBuildIdentity,
  TWidgetCapsuleApiContract,
  TWidgetCapsuleBudgets,
  TWidgetNativeCapsuleRuntimeDescriptor,
} from '../index';
import type { TWidgetExecutableManifestProjection } from './filesystem/typed';

export const CAPSULE_HASH_A = `sha256:${'a'.repeat(64)}` as const;
export const CAPSULE_HASH_B = `sha256:${'b'.repeat(64)}` as const;
export const RAW_DIGEST_A = 'a'.repeat(64);
export const RAW_DIGEST_B = 'b'.repeat(64);

export const CAPSULE_API_CONTRACT: TWidgetCapsuleApiContract = Object.freeze({
  format: 'capsule-api-groups-v1',
  groups: Object.freeze(['DOM'] as const),
  bundleDigest: CAPSULE_HASH_B,
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
  packageVersion: '0.10.2',
  packageDigest: CAPSULE_HASH_A,
  buildApiVersion: '0.1.0',
  runtimeBuildDigest: CAPSULE_HASH_B,
});

export const CAPSULE_RUNTIME_DESCRIPTOR: TWidgetNativeCapsuleRuntimeDescriptor = Object.freeze({
  format: 'omnidraw.capsule-runtime.v2',
  capsuleArtifactHash: CAPSULE_HASH_A,
  apiContract: CAPSULE_API_CONTRACT,
  budgets: Object.freeze({}),
  capabilityRequests: Object.freeze([]),
  channels: null,
  parkability: Object.freeze({ parkable: false }),
  signatureKeyIds: Object.freeze(['omnidraw-preview-v1']),
});

export const CAPSULE_MANIFEST: TWidgetExecutableManifestProjection = Object.freeze({
  schemaVersion: 1,
  ui: Object.freeze({
    runtime: 'capsule',
    entry: 'src/ui.tsx',
    apis: Object.freeze(['DOM'] as const),
  }),
  server: null,
  resources: Object.freeze([]),
});
