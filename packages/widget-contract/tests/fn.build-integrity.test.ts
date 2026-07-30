import { describe, expect, test } from 'bun:test';
import {
  fnValidateWidgetBuildIntegrity,
  fnWidgetBuildIntegrityDiagnostic,
  fnWidgetSourceSnapshotIdentityMatches,
  type TWidgetBuildIntegrityArgs,
  type TWidgetBuildResult,
} from '../src';

const digest = 'a'.repeat(64);
const capsuleBuildIdentity = {
  packageName: '@omnidraw/capsule' as const,
  packageVersion: '1.0.0',
  packageDigest: `sha256:${'b'.repeat(64)}` as const,
  buildApiVersion: '1',
  runtimeBuildDigest: `sha256:${'c'.repeat(64)}` as const,
};
const trustedBuild = {
  sourceSnapshotId: digest,
  sourceDigestSha256: digest,
  canonicalManifestJson: '{"schemaVersion":3}',
  builderIdentity: 'builder-1',
  capsuleBuildIdentity,
  buildPolicyId: 'policy-1',
  uiArtifact: { kind: 'invalid-for-test' },
} as unknown as TWidgetBuildResult;
const args = {
  snapshot: {
    id: digest,
    digestSha256: digest,
    files: [],
    createdAtMs: 1,
  },
  manifest: {
    schemaVersion: 3,
    name: 'Counter',
    slug: 'counter',
    ui: {
      runtime: 'capsule',
      entry: 'ui/main.ts',
      apis: ['DOM'],
    },
  },
  canonicalManifestJson: '{"schemaVersion":3}',
  builderIdentity: 'builder-1',
  capsuleBuildIdentity,
  buildPolicyId: 'policy-1',
  build: trustedBuild,
  digestSha256: () => digest,
} satisfies TWidgetBuildIntegrityArgs;

describe('widget build immutable-input diagnostics', () => {
  test('matches content-addressed and retained legacy snapshot identities', () => {
    const snapshot = { id: 'legacy-capture-id', digestSha256: digest };

    expect(fnWidgetSourceSnapshotIdentityMatches(snapshot, digest)).toBe(true);
    expect(fnWidgetSourceSnapshotIdentityMatches(snapshot, 'legacy-capture-id')).toBe(true);
    expect(fnWidgetSourceSnapshotIdentityMatches(snapshot, 'other-capture-id')).toBe(false);
  });

  test('identifies each mismatched trusted field without exposing its value', () => {
    const variants = [
      ['source_snapshot_identity', { sourceSnapshotId: 'forged' }],
      ['source_digest', { sourceDigestSha256: 'd'.repeat(64) }],
      ['canonical_manifest', { canonicalManifestJson: '{"changed":true}' }],
      ['builder_identity', { builderIdentity: 'builder-2' }],
      ['capsule_build_identity', {
        capsuleBuildIdentity: { ...capsuleBuildIdentity, packageVersion: '2.0.0' },
      }],
      ['build_policy', { buildPolicyId: 'policy-2' }],
    ] as const;

    for (const [mismatch, change] of variants) {
      const validation = fnValidateWidgetBuildIntegrity({
        ...args,
        build: { ...trustedBuild, ...change },
      });
      expect(validation).toEqual({
        valid: false,
        reason: 'immutable_input_mismatch',
        mismatch,
      });
      if (!validation.valid) {
        const diagnostic = fnWidgetBuildIntegrityDiagnostic(validation);
        expect(diagnostic).toContain('Host widget integrity check failed');
        expect(diagnostic).toContain('Widget source edits cannot repair');
        expect(diagnostic).not.toContain('builder-2');
        expect(diagnostic).not.toContain('policy-2');
      }
    }
  });

  test('accepts a retained legacy capture identity only with the exact source digest', () => {
    const validation = fnValidateWidgetBuildIntegrity({
      ...args,
      snapshot: { ...args.snapshot, id: 'legacy-capture-id' },
      build: { ...trustedBuild, sourceSnapshotId: 'legacy-capture-id' },
    });

    expect(validation).toMatchObject({
      valid: false,
      reason: 'artifact_set_mismatch',
    });
  });
});
