import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPSULE_API_GROUP_BUNDLE_DIGEST } from '@omnidraw/capsule/protocol';
import type { TWidgetRuntimeDescriptor } from '@omnidraw/sdk/contract';
import { WidgetCapsuleSigningKeyStore } from './WidgetCapsuleSigningKeyStore';
import { WidgetReleaseAttestationService } from './WidgetReleaseAttestationService';
import { WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID as keyId } from './CONSTANTS';

const retainedBundle = 'sha256:3d870fc6ddfc6b4e8326571c6eaeab4ac8357cc91f287cb84b64ddaa67b2482b';

describe('WidgetReleaseAttestationService', () => {
  test('attests current and retained releases without replacing Capsule runtime admission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'widget-attestation-'));
    try {
      const keys = new WidgetCapsuleSigningKeyStore(root);
      const service = new WidgetReleaseAttestationService(keys, {
        read: async () => ({
          generation: 'test', allowedApis: ['DOM'], limits: { cpuMs: 500 },
          previewSigningKeyId: 'preview', releaseSigningKeyId: keyId,
          signingKeys: await keys.publicSigningKeys(),
        }),
      });
      const bytes = Uint8Array.of(1, 2, 3);
      // This service verifies release trust, not the Capsule envelope. Even an
      // unknown signed bundle must still pass Capsule's independent mount gate.
      for (const bundleDigest of [CAPSULE_API_GROUP_BUNDLE_DIGEST, retainedBundle, `sha256:${'f'.repeat(64)}`] as const) {
        const runtime: TWidgetRuntimeDescriptor = {
          format: 'omnidraw.capsule-runtime.v2', artifactHash: `sha256:${'a'.repeat(64)}`,
          apiContract: { format: 'capsule-api-groups-v1', groups: ['DOM'], bundleDigest },
          budgets: { cpuMs: 100 }, capabilityRequests: [], channels: null,
          parkability: { parkable: false }, signatureKeyIds: [keyId],
        };
        const canonicalUnsignedReleaseJson = JSON.stringify({ runtime });
        const args = {
          bytes, expectedApis: ['DOM'] as const, expectedRuntime: runtime,
          expectedCapsuleFile: { path: 'capsule.artifact', byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
          canonicalUnsignedReleaseJson,
          releaseAttestation: await service.attest(canonicalUnsignedReleaseJson),
        };
        expect((await service.inspectCapsuleArtifact(args)).runtime).toEqual(runtime);
        await expect(service.inspectCapsuleArtifact({ ...args, bytes: Uint8Array.of(9, 2, 3) })).rejects.toThrow('policy');
        await expect(service.inspectCapsuleArtifact({ ...args, canonicalUnsignedReleaseJson: `${canonicalUnsignedReleaseJson} ` })).rejects.toThrow('not trusted');
        await expect(service.inspectCapsuleArtifact({ ...args, expectedApis: ['DOM', 'WEBGL'] })).rejects.toThrow('policy');
        await expect(service.inspectCapsuleArtifact({ ...args, expectedRuntime: { ...runtime, budgets: { cpuMs: 501 } } })).rejects.toThrow('policy');
        await expect(service.inspectCapsuleArtifact({ ...args, expectedRuntime: { ...runtime, signatureKeyIds: [] } })).rejects.toThrow('policy');
        await expect(service.inspectCapsuleArtifact({ ...args, releaseAttestation: { ...args.releaseAttestation, signatureBase64: Buffer.alloc(64).toString('base64') } })).rejects.toThrow('not trusted');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
