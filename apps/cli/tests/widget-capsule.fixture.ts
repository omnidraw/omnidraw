import type {
  TWidgetCapsuleApiGroup,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetManifestV3,
} from '@omnidraw/widget-contract';
import type { TOmnidrawDistributionBuild } from '@omnidraw/capsule-omnidraw/builder';
import { OMNIDRAW_CAPSULE_API_BUNDLE_DIGEST } from '@omnidraw/capsule-omnidraw/contract';
import {
  WIDGET_CAPSULE_BUILD_IDENTITY,
  WIDGET_CAPSULE_BUILD_POLICY_ID,
} from '../src/services/CONSTANTS';

export const CAPSULE_PUBLICATION_IDENTITY = Object.freeze({
  capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
  buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
});

export const testWidgetDistributionBuild: TOmnidrawDistributionBuild = async (request) => {
  const invalid = request.files.find((file) => (
    new TextDecoder().decode(file.bytes).includes('broken: =')
  ));
  if (invalid) {
    throw Object.assign(new Error('test transform failed'), {
      diagnostic: { code: 'TRANSFORM_FAILED', path: invalid.path },
    });
  }
  const hasCss = request.files.some((file) => file.path.endsWith('.css'));
  return {
    kind: 'external-distribution',
    snapshot: {
      files: [{
      path: 'main.js',
      bytes: new TextEncoder().encode(
        'const root=document.createElement("div");document.body.append(root);',
      ),
      }, ...(hasCss ? [{
        path: 'style.css',
        bytes: new TextEncoder().encode('body{color:red}'),
      }] : [])],
    },
    entry: 'main.js',
    ...(hasCss ? { cssRoots: ['style.css'] } : {}),
    producer: {
      name: 'omnidraw-test-build',
      version: '1',
      digest: `sha256:${'1'.repeat(64)}`,
    },
    sourceRevision: request.sourceRevision,
    dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
    buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
  };
};

export function capsuleUi(
  entry: string,
  apis: readonly TWidgetCapsuleApiGroup[] = ['DOM'],
): TWidgetManifestV3['ui'] {
  return {
    runtime: 'capsule',
    entry,
    apis,
  };
}

export function capsuleRuntimeDescriptor(
  manifest: TWidgetManifestV3,
  capsuleArtifactHash: `sha256:${string}`,
  signatureKeyId = 'omnidraw-release-v1',
): TWidgetCapsuleRuntimeDescriptor {
  return {
    format: 'omnidraw.capsule-runtime.v2',
    capsuleArtifactHash,
    apiContract: {
      format: 'capsule-api-groups-v1',
      groups: manifest.ui.apis,
      bundleDigest: OMNIDRAW_CAPSULE_API_BUNDLE_DIGEST,
    },
    budgets: {},
    capabilityRequests: [],
    channels: null,
    parkability: { parkable: false },
    signatureKeyIds: [signatureKeyId],
  };
}
