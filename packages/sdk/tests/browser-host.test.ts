import { describe, expect, test } from 'bun:test';
import { CAPSULE_API_GROUP_BUNDLE_DIGEST } from '@omnidraw/capsule/protocol';
import { createWidgetBrowserHost } from '../src/host';

const digest = 'b'.repeat(64);
const artifactHash = `sha256:${'a'.repeat(64)}` as const;

describe('@omnidraw/sdk/host', () => {
  test('validates and copies transport-decoded artifacts without exposing the engine', async () => {
    const host = await createWidgetBrowserHost({
      document: {} as Document,
      digestSha256: () => digest,
      catalog: {
        generation: 'test-1',
        allowedApis: ['DOM'],
        limits: {},
        previewSigningKeyId: 'preview',
        releaseSigningKeyId: 'release',
        signingKeys: [{
          keyId: 'preview',
          algorithm: 'Ed25519',
          format: 'raw',
          publicKeyBase64: 'unused-by-validation',
        }],
      },
    });
    const bytes = Uint8Array.of(1, 2, 3);
    const artifact = await host.validateArtifact({
      bytes,
      digestSha256: digest,
      artifactHash: artifactHash,
      runtime: {
        format: 'omnidraw.capsule-runtime.v2',
        artifactHash: artifactHash,
        apiContract: {
          format: 'capsule-api-groups-v1',
          groups: ['DOM'],
          bundleDigest: CAPSULE_API_GROUP_BUNDLE_DIGEST,
        },
        budgets: {},
        capabilityRequests: [],
        channels: null,
        parkability: { parkable: false },
        signatureKeyIds: ['preview'],
      },
      functions: [],
    });
    bytes[0] = 9;
    expect([...artifact.bytes]).toEqual([1, 2, 3]);
    expect(artifact.runtime.artifactHash).toBe(artifactHash);

    await expect(host.validateArtifact({
      ...artifact,
      artifactHash: undefined,
      capsuleArtifactHash: artifactHash,
      runtime: {
        ...artifact.runtime,
        artifactHash: undefined,
        capsuleArtifactHash: artifactHash,
      },
    })).rejects.toThrow('runtime hash');

    await expect(host.validateArtifact({ ...artifact, digestSha256: 'c'.repeat(64) }))
      .rejects.toThrow('digest verification');
    expect(host.diagnostics()).toEqual({
      liveHosts: 0,
      liveMounts: 0,
      hostCreations: 0,
      artifactCache: {
        entries: 0,
        totalBytes: 0,
        hits: 0,
        misses: 0,
        puts: 0,
        evictions: 0,
      },
      pendingArtifactAdmissions: 0,
    });
    expect(JSON.stringify(host.diagnostics())).not.toMatch(/sha256|CryptoKey|Effect/);
    await host.dispose();
    expect(host.diagnostics().artifactCache.entries).toBe(0);
  });
});
