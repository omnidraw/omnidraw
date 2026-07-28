import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  fnCanonicalizeWidgetPreviewBuildKey,
  fnCanonicalizeWidgetPreviewConstructionKey,
  fnWidgetPreviewBuildKey,
  fnWidgetPreviewConstructionKey,
  type TWidgetPreviewBuildKeyInput,
  type TWidgetPreviewConstructionKeyInput,
} from '../src';

const input: TWidgetPreviewBuildKeyInput = {
  sourceDigestSha256: '1'.repeat(64),
  canonicalManifestJson: '{"schemaVersion":3}',
  dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
  sdkContractIdentity: '@vibecanvas/sdk@1',
  generatedContractDigest: `sha256:${'3'.repeat(64)}`,
  builderIdentity: 'vibecanvas-build-adapter/v2',
  capsuleBuildIdentity: {
    packageName: '@omnidraw/capsule',
    packageVersion: '0.9.4',
    packageDigest: `sha256:${'4'.repeat(64)}`,
    buildApiVersion: '0.1.0',
    runtimeBuildDigest: `sha256:${'5'.repeat(64)}`,
  },
  buildPolicyId: 'vibecanvas-capsule-widget-v1',
  approvedTransformsDigest: `sha256:${'6'.repeat(64)}`,
  buildConfigurationDigest: `sha256:${'7'.repeat(64)}`,
  environment: {
    runnerIdentity: 'host-v1',
    nodeVersion: 'v24.1.0',
    packageManager: 'npm',
    packageManagerVersion: '11.4.0',
    platform: 'darwin',
    architecture: 'arm64',
  },
};

const constructionInput: TWidgetPreviewConstructionKeyInput = {
  tenant: {
    orgId: 'org-1',
    accountId: 'account-1',
    cellId: 'cell-1',
    placementEpoch: 1,
  },
  sourceDigestSha256: '1'.repeat(64),
  canonicalManifestJson: '{"schemaVersion":3}',
  builderIdentity: 'vibecanvas-build-adapter/v2',
  capsuleBuildIdentity: input.capsuleBuildIdentity,
  buildPolicyId: 'vibecanvas-capsule-widget-v1',
  environmentIdentity: '{"format":"test-environment-v1"}',
};

describe('Preview build key', () => {
  test('binds the complete trusted build environment deterministically', () => {
    const digestSha256 = (value: string) => createHash('sha256').update(value).digest('hex');
    const key = fnWidgetPreviewBuildKey({ input, digestSha256 });

    expect(key).toHaveLength(64);
    expect(fnWidgetPreviewBuildKey({
      input: {
        ...input,
        environment: { ...input.environment, nodeVersion: 'v24.2.0' },
      },
      digestSha256,
    })).not.toBe(key);
    expect(fnCanonicalizeWidgetPreviewBuildKey(input)).toContain(
      '"dependencyLockDigest"',
    );

    const variants: TWidgetPreviewBuildKeyInput[] = [
      { ...input, sourceDigestSha256: '8'.repeat(64) },
      { ...input, canonicalManifestJson: '{"schemaVersion":3,"name":"Changed"}' },
      { ...input, dependencyLockDigest: `sha256:${'8'.repeat(64)}` },
      { ...input, sdkContractIdentity: '@vibecanvas/sdk@2' },
      { ...input, generatedContractDigest: `sha256:${'8'.repeat(64)}` },
      { ...input, builderIdentity: 'vibecanvas-build-adapter/v3' },
      {
        ...input,
        capsuleBuildIdentity: {
          ...input.capsuleBuildIdentity,
          runtimeBuildDigest: `sha256:${'8'.repeat(64)}`,
        },
      },
      { ...input, buildPolicyId: 'vibecanvas-capsule-widget-v2' },
      { ...input, approvedTransformsDigest: `sha256:${'8'.repeat(64)}` },
      { ...input, buildConfigurationDigest: `sha256:${'8'.repeat(64)}` },
      {
        ...input,
        environment: { ...input.environment, runnerIdentity: 'docker-v1' },
      },
      {
        ...input,
        environment: { ...input.environment, nodeVersion: 'v24.2.0' },
      },
      {
        ...input,
        environment: { ...input.environment, packageManager: 'pnpm' },
      },
      {
        ...input,
        environment: { ...input.environment, packageManagerVersion: '11.5.0' },
      },
      {
        ...input,
        environment: { ...input.environment, platform: 'linux' },
      },
      {
        ...input,
        environment: { ...input.environment, architecture: 'x64' },
      },
    ];
    for (const variant of variants) {
      expect(fnWidgetPreviewBuildKey({
        input: variant,
        digestSha256,
      })).not.toBe(key);
    }
  });

  test('binds every authoritative pre-build construction input', () => {
    const digestSha256 = (value: string) => createHash('sha256').update(value).digest('hex');
    const key = fnWidgetPreviewConstructionKey({
      input: constructionInput,
      digestSha256,
    });
    const variants: TWidgetPreviewConstructionKeyInput[] = [
      {
        ...constructionInput,
        tenant: { ...constructionInput.tenant, accountId: 'account-2' },
      },
      { ...constructionInput, sourceDigestSha256: '9'.repeat(64) },
      {
        ...constructionInput,
        canonicalManifestJson: '{"schemaVersion":3,"name":"Changed"}',
      },
      { ...constructionInput, builderIdentity: 'vibecanvas-build-adapter/v3' },
      {
        ...constructionInput,
        capsuleBuildIdentity: {
          ...constructionInput.capsuleBuildIdentity,
          packageVersion: '0.9.5',
        },
      },
      { ...constructionInput, buildPolicyId: 'vibecanvas-capsule-widget-v2' },
      {
        ...constructionInput,
        environmentIdentity: '{"format":"test-environment-v2"}',
      },
    ];

    expect(key).toHaveLength(64);
    expect(fnCanonicalizeWidgetPreviewConstructionKey(constructionInput))
      .toContain('"environmentIdentity"');
    for (const variant of variants) {
      expect(fnWidgetPreviewConstructionKey({
        input: variant,
        digestSha256,
      })).not.toBe(key);
    }
  });
});
