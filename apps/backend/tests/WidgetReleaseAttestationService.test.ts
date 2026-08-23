import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TWidgetRuntimeDescriptor } from '@omnidraw/sdk/contract';
import { OMNIDRAW_CAPSULE_API_BUNDLE_DIGEST } from '#backend/shell/widget-runtime/contract';
import { WidgetCapsuleHostConfigurationService } from '../src/shell/widget/WidgetCapsuleHostConfigurationService';
import { WidgetCapsuleSigningKeyStore } from '../src/shell/widget/WidgetCapsuleSigningKeyStore';
import { WidgetReleaseAttestationService } from '../src/shell/widget/WidgetReleaseAttestationService';

const roots: string[] = [];
const HASH = `sha256:${'a'.repeat(64)}` as const;
const RUNTIME: TWidgetRuntimeDescriptor = Object.freeze({
  format: 'omnidraw.capsule-runtime.v2',
  artifactHash: HASH,
  apiContract: Object.freeze({
    format: 'capsule-api-groups-v1',
    groups: Object.freeze(['DOM'] as const),
    bundleDigest: OMNIDRAW_CAPSULE_API_BUNDLE_DIGEST,
  }),
  budgets: Object.freeze({}),
  capabilityRequests: Object.freeze([]),
  channels: null,
  parkability: Object.freeze({ parkable: false }),
  signatureKeyIds: Object.freeze(['omnidraw-release-v1']),
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-release-attestation-'));
  roots.push(root);
  const service = new WidgetReleaseAttestationService(
    new WidgetCapsuleSigningKeyStore(root),
    new WidgetCapsuleHostConfigurationService(
      new WidgetCapsuleSigningKeyStore(root),
    ),
  );
  const canonicalUnsignedReleaseJson = JSON.stringify({
    format: 'omnidraw.widget-release.v1',
    complete: true,
    executableManifestDigestSha256: 'c'.repeat(64),
    files: [{ path: 'capsule.artifact', byteSize: 3, sha256: 'd'.repeat(64) }],
    capsule: { path: 'capsule.artifact', artifactHash: HASH, runtime: RUNTIME },
    server: null,
  });
  const releaseAttestation = await service.attest(canonicalUnsignedReleaseJson);
  return { service, canonicalUnsignedReleaseJson, releaseAttestation };
}

describe('WidgetReleaseAttestationService', () => {
  test('authenticates one canonical complete release without parsing or executing guest bytes', async () => {
    const harness = await fixture();
    await expect(harness.service.inspectCapsuleArtifact({
      bytes: new Uint8Array([1, 2, 3]),
      expectedCapsuleFile: {
        path: 'capsule.artifact',
        byteSize: 3,
        sha256: createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex'),
      },
      expectedApis: ['DOM'],
      expectedRuntime: RUNTIME,
      canonicalUnsignedReleaseJson: harness.canonicalUnsignedReleaseJson,
      releaseAttestation: harness.releaseAttestation,
    })).resolves.toEqual({ artifactHash: HASH, runtime: RUNTIME });
  });

  test('rejects release metadata, signature, key, API, and embedded-signature-policy drift', async () => {
    const harness = await fixture();
    const base = {
      bytes: new Uint8Array([1, 2, 3]),
      expectedCapsuleFile: {
        path: 'capsule.artifact' as const,
        byteSize: 3,
        sha256: createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex'),
      },
      expectedApis: ['DOM'] as const,
      expectedRuntime: RUNTIME,
      canonicalUnsignedReleaseJson: harness.canonicalUnsignedReleaseJson,
      releaseAttestation: harness.releaseAttestation,
    };
    await expect(harness.service.inspectCapsuleArtifact({
      ...base,
      canonicalUnsignedReleaseJson: `${base.canonicalUnsignedReleaseJson} `,
    })).rejects.toThrow('not trusted');
    await expect(harness.service.inspectCapsuleArtifact({
      ...base,
      releaseAttestation: {
        ...base.releaseAttestation,
        signatureBase64: Buffer.alloc(64, 9).toString('base64'),
      },
    })).rejects.toThrow('not trusted');
    await expect(harness.service.inspectCapsuleArtifact({
      ...base,
      releaseAttestation: { ...base.releaseAttestation, keyId: 'old-release-key' },
    })).rejects.toThrow('policy');
    await expect(harness.service.inspectCapsuleArtifact({
      ...base,
      expectedApis: ['DOM', 'NETWORK'],
    })).rejects.toThrow('policy');
    await expect(harness.service.inspectCapsuleArtifact({
      ...base,
      expectedRuntime: { ...RUNTIME, signatureKeyIds: ['old-release-key'] },
    })).rejects.toThrow('policy');
    await expect(harness.service.inspectCapsuleArtifact({
      ...base,
      bytes: new Uint8Array([1, 2, 4]),
    })).rejects.toThrow('policy');
    await expect(harness.service.inspectCapsuleArtifact({
      ...base,
      bytes: new Uint8Array([1, 2]),
    })).rejects.toThrow('policy');
  });
});
