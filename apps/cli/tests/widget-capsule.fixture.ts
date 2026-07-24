import type {
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetManifestV3,
} from '@vibecanvas/widget-contract';
import {
  WIDGET_CAPSULE_BUILD_IDENTITY,
  WIDGET_CAPSULE_BUILD_POLICY_ID,
} from '../src/services/CONSTANTS';

export const CAPSULE_PUBLICATION_IDENTITY = Object.freeze({
  capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
  buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
});

export function capsuleUi(
  entry: string,
  featureProfiles: readonly string[] = [],
): TWidgetManifestV3['ui'] {
  return {
    runtime: 'capsule',
    entry,
    target: {
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
      featureProfiles,
    },
  };
}

export function capsuleRuntimeDescriptor(
  manifest: TWidgetManifestV3,
  capsuleArtifactHash: `sha256:${string}`,
  signatureKeyId = 'vibecanvas-release-v1',
): TWidgetCapsuleRuntimeDescriptor {
  return {
    format: 'vibecanvas.capsule-runtime.v1',
    capsuleArtifactHash,
    target: manifest.ui.target,
    budgets: {
      cpuMs: 100,
      memoryBytes: 16 * 1024 * 1024,
      domNodes: 1_000,
      handles: 2_000,
      messageBytes: 64 * 1024,
      streamBytes: 64 * 1024,
      assetBytes: 2 * 1024 * 1024,
      networkBytes: 0,
      gpuBytes: 0,
      lifecycleBytes: 64 * 1024,
    },
    capabilityRequests: [],
    channels: null,
    parkability: { parkable: false },
    signatureKeyIds: [signatureKeyId],
  };
}
