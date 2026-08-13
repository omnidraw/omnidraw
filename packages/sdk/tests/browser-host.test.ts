import { describe, expect, test } from 'bun:test';
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
      // Existing transports used this name; the SDK normalizes it at the edge.
      runtimeDescriptor: {
        format: 'omnidraw.capsule-runtime.v2',
        artifactHash: artifactHash,
        apiContract: {
          format: 'capsule-api-groups-v1',
          groups: ['DOM'],
          bundleDigest: 'sha256:8f783ee2e4986636c959eee25b2c4c3da0a81323bb023e87388a5aca59480b48',
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

    const legacy = await host.validateArtifact({
      ...artifact,
      artifactHash: undefined,
      capsuleArtifactHash: artifactHash,
      runtime: {
        ...artifact.runtime,
        artifactHash: undefined,
        capsuleArtifactHash: artifactHash,
      },
    });
    expect(legacy.artifactHash).toBe(artifactHash);
    expect(legacy.runtime.artifactHash).toBe(artifactHash);
    expect('capsuleArtifactHash' in legacy).toBe(false);

    await expect(host.validateArtifact({ ...artifact, digestSha256: 'c'.repeat(64) }))
      .rejects.toThrow('digest verification');
    await host.dispose();
  });
});
