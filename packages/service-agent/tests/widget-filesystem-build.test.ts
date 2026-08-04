import { describe, expect, test } from 'bun:test';
import type {
  TWidgetArtifactConstructionRequest,
  TWidgetArtifactConstructionResult,
  TWidgetBuildEnvironment,
  TWidgetBuildResult,
  TWidgetManifestV4,
} from '@omnidraw/widget-contract';
import { WidgetArtifactBuilderCapsule } from '@omnidraw/capsule-omnidraw/build';
import { WidgetFilesystemBuildService } from '../src/widget-filesystem/build';

const RAW_A = 'a'.repeat(64);
const RAW_B = 'b'.repeat(64);
const CAPSULE_HASH = `sha256:${RAW_A}` as const;
const CAPSULE_BUILD_IDENTITY = Object.freeze({
  packageName: '@omnidraw/capsule' as const,
  packageVersion: '0.10.2',
  packageDigest: CAPSULE_HASH,
  buildApiVersion: '0.1.0',
  runtimeBuildDigest: `sha256:${RAW_B}` as const,
});
const RUNTIME = Object.freeze({
  format: 'omnidraw.capsule-runtime.v2' as const,
  capsuleArtifactHash: CAPSULE_HASH,
  apiContract: Object.freeze({
    format: 'capsule-api-groups-v1' as const,
    groups: Object.freeze(['DOM'] as const),
    bundleDigest: `sha256:${RAW_B}` as const,
  }),
  budgets: Object.freeze({}),
  capabilityRequests: Object.freeze([]),
  channels: null,
  parkability: Object.freeze({ parkable: false as const }),
  signatureKeyIds: Object.freeze(['release-key']),
});
const MANIFEST: TWidgetManifestV4 = Object.freeze({
  $schema: 'https://omnidraw.dev/schemas/widget/v4.json',
  schemaVersion: 4,
  name: 'Counter',
  slug: 'counter',
  description: 'A small counter.',
  tool: Object.freeze({ label: 'Counter', group: 'examples', priority: 0 }),
  ui: Object.freeze({
    runtime: 'capsule',
    entry: 'src/main.ts',
    apis: Object.freeze(['DOM'] as const),
  }),
});
const ENVIRONMENT: Omit<TWidgetBuildEnvironment, 'serverRuntimeAbi'> = Object.freeze({
  packageManager: Object.freeze({
    name: 'npm',
    version: '11.0.0',
    lockfile: 'package-lock.json',
    lockFormat: 'npm-lock-v3',
  }),
  sdkVersion: '0.6.0',
  importMapDigestSha256: RAW_A,
  transformsDigestSha256: RAW_B,
  runner: Object.freeze({ kind: 'isolated', identity: 'docker@example' }),
  platform: Object.freeze({ os: 'linux', architecture: 'arm64' }),
  capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
  buildPolicyId: 'omnidraw-capsule-v1',
  signingPolicyId: 'filesystem-signing-v1',
});

function fixture() {
  let captured: TWidgetArtifactConstructionRequest | null = null;
  const unsignedBytes = new TextEncoder().encode('unsigned');
  const signedBytes = new TextEncoder().encode('signed');
  const construction = {
    sourceSnapshotId: RAW_A,
    sourceDigestSha256: RAW_A,
    sourceArtifact: { kind: 'source', digestSha256: RAW_A, bytes: new Uint8Array() },
    sourceMapArtifact: null,
    builderIdentity: 'builder-v1',
    capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    buildPolicyId: 'omnidraw-capsule-v1',
    canonicalManifestJson: '{}',
    distributionProvenance: {
      kind: 'external-distribution',
      producer: { name: 'test', version: '1', digest: `sha256:${RAW_A}` },
      sourceRevision: RAW_A,
      dependencyLockDigest: `sha256:${RAW_A}`,
      buildConfigurationDigest: `sha256:${RAW_B}`,
    },
    distributionFiles: [{ path: 'main.js', bytes: new TextEncoder().encode('browser') }],
    functionDescriptors: [],
    functionDescriptorsDigestSha256: RAW_A,
    capabilityContractDigestSha256: RAW_A,
    channelContractDigestSha256: RAW_A,
    constructionContractDigestSha256: RAW_A,
    uiArtifact: {
      kind: 'unsigned-ui',
      digestSha256: RAW_A,
      unsignedBytes,
      capsuleArtifactHash: CAPSULE_HASH,
      runtimeDescriptor: { ...RUNTIME, signatureKeyIds: [] },
      builderIdentity: 'builder-v1',
      capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    },
    serverArtifact: null,
    diagnostics: [],
  } as unknown as TWidgetArtifactConstructionResult;
  const build = {
    ...construction,
    contractDigestSha256: RAW_B,
    uiArtifact: {
      kind: 'ui',
      digestSha256: RAW_B,
      bytes: signedBytes,
      capsuleArtifactHash: CAPSULE_HASH,
      runtimeDescriptor: RUNTIME,
      builderIdentity: 'builder-v1',
      capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    },
  } as unknown as TWidgetBuildResult;
  const service = new WidgetFilesystemBuildService({
    builderIdentity: 'builder-v1',
    environment: ENVIRONMENT,
    construction: {
      async construct(request) {
        captured = request;
        return construction;
      },
      async signConstruction() {
        return build;
      },
    },
    capsuleInspector: {
      async inspect(bytes) {
        expect(bytes).toEqual(signedBytes);
        return { artifactHash: CAPSULE_HASH, runtime: RUNTIME };
      },
    },
    releaseAttestor: {
      async attest() {
        return {
          algorithm: 'Ed25519',
          keyId: 'release-key',
          signatureBase64: Buffer.alloc(64, 1).toString('base64'),
        };
      },
    },
  });
  return { service, captured: () => captured };
}

describe('filesystem widget build service', () => {
  test('stages only executable source plus the runtime projection', async () => {
    const harness = fixture();
    const construction = await harness.service.construct({
      manifest: MANIFEST,
      files: [
        { path: 'src/main.ts', bytes: new TextEncoder().encode('export default 1;') },
        { path: 'package.json', bytes: new TextEncoder().encode('{}') },
      ],
    });
    const captured = harness.captured()!;
    expect(captured.snapshot.files.map((file) => file.path)).toEqual([
      '.omnidraw/build-manifest.json',
      'package.json',
      'src/main.ts',
    ]);
    const staged = new TextDecoder().decode(captured.snapshot.files[0]!.bytes);
    expect(staged).not.toContain('Counter');
    expect(staged).not.toContain('examples');
    expect(construction.distFiles.map((file) => file.path)).toEqual(['dist/main.js']);
  });

  test('derives the server ABI per manifest so one service builds UI-only and server widgets', async () => {
    const harness = fixture();
    const uiConstruction = await harness.service.construct({
      manifest: MANIFEST,
      files: [{ path: 'src/main.ts', bytes: new TextEncoder().encode('export default 1;') }],
    });
    const uiManifest = harness.captured()?.manifest;

    const serverConstruction = await harness.service.construct({
      manifest: {
        ...MANIFEST,
        server: { entry: 'server/main.ts', runtimeAbi: 'bun-v1' },
      },
      files: [
        { path: 'src/main.ts', bytes: new TextEncoder().encode('export default 1;') },
        { path: 'server/main.ts', bytes: new TextEncoder().encode('export default {};') },
      ],
    });

    expect(uiConstruction.executableInputDigestSha256)
      .not.toBe(serverConstruction.executableInputDigestSha256);
    expect(uiManifest?.server).toBeNull();
    expect(harness.captured()?.manifest.server?.runtimeAbi).toBe('bun-v1');
  });

  test('publishes presentation separately and validates exact runtime files', async () => {
    const harness = fixture();
    const construction = await harness.service.construct({
      manifest: MANIFEST,
      files: [{ path: 'src/main.ts', bytes: new TextEncoder().encode('export default 1;') }],
    });
    const prepared = await harness.service.preparePublication({
      manifest: { ...MANIFEST, description: 'Presentation changed safely.' },
      construction,
    });
    expect(prepared.manifestJson).toContain('Presentation changed safely.');
    expect(prepared.files.map((file) => file.path)).toEqual([
      'capsule.artifact',
      'dist/main.js',
    ]);
    expect(prepared.release.descriptor.complete).toBe(true);
    expect(prepared.release.canonicalJson).not.toContain('Presentation changed safely.');
  });

  test('rejects authored manifests and generated output in executable inputs', async () => {
    const { service } = fixture();
    await expect(service.construct({
      manifest: MANIFEST,
      files: [{ path: 'omnidraw.json', bytes: new Uint8Array() }],
    })).rejects.toThrow('excluded path');
    await expect(service.construct({
      manifest: MANIFEST,
      files: [{ path: 'dist/main.js', bytes: new Uint8Array() }],
    })).rejects.toThrow('excluded path');
  });

  test('digest-fences retained distribution bytes before release signing', async () => {
    const harness = fixture();
    const construction = await harness.service.construct({
      manifest: MANIFEST,
      files: [{ path: 'src/main.ts', bytes: new TextEncoder().encode('export default 1;') }],
    });
    construction.distFiles[0]!.bytes[0] ^= 0xff;
    await expect(harness.service.preparePublication({
      manifest: MANIFEST,
      construction,
    })).rejects.toThrow('distribution changed');
  });

  test('composes the tenant-free facade with the real Capsule constructor and signer', async () => {
    let inspection: Readonly<{ artifactHash: typeof CAPSULE_HASH; runtime: typeof RUNTIME }> | null = null;
    const artifactBuilder = new WidgetArtifactBuilderCapsule({
      tempRoot: '/tmp',
      builderIdentity: 'builder-v1',
      capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
      buildPolicyId: 'omnidraw-capsule-v1',
      functionDescriptorExtractor: {
        async extractServerFunctionDescriptors() { return []; },
      },
      async loadSigningKeys() {
        return [{ keyId: 'release-key', privateKey: {} as CryptoKey }];
      },
      async capsuleSign(bytes) {
        return new Uint8Array([...bytes, 0xff]);
      },
      async distributionBuild(request) {
        return {
          kind: 'external-distribution',
          snapshot: { files: [{ path: 'main.js', bytes: new Uint8Array([1, 2, 3]) }] },
          entry: 'main.js',
          producer: {
            name: 'filesystem-integration-test',
            version: '1',
            digest: `sha256:${RAW_A}`,
          },
          sourceRevision: request.sourceRevision,
          dependencyLockDigest: `sha256:${RAW_A}`,
          buildConfigurationDigest: `sha256:${RAW_B}`,
        };
      },
      async capsuleBuild() {
        return {
          artifactBytes: new Uint8Array([4, 5, 6]),
          artifactHash: CAPSULE_HASH,
          diagnostics: [],
        };
      },
    });
    const constructionPort = {
      construct: artifactBuilder.construct.bind(artifactBuilder) as (
        request: TWidgetArtifactConstructionRequest,
      ) => Promise<TWidgetArtifactConstructionResult>,
      async signConstruction(
        request: import('@omnidraw/widget-contract').TWidgetArtifactConstructionSignRequest,
      ) {
        const build = await artifactBuilder.signConstruction(request);
        inspection = {
          artifactHash: build.uiArtifact.capsuleArtifactHash as typeof CAPSULE_HASH,
          runtime: build.uiArtifact.runtimeDescriptor as typeof RUNTIME,
        };
        return build;
      },
      closeWorkspace: artifactBuilder.closeWorkspace.bind(artifactBuilder) as (
        request: Readonly<{ workspaceKey: string }>,
      ) => Promise<void>,
      close: artifactBuilder.close.bind(artifactBuilder),
    };
    const service = new WidgetFilesystemBuildService({
      builderIdentity: 'builder-v1',
      environment: ENVIRONMENT,
      construction: constructionPort,
      capsuleInspector: {
        async inspect() {
          if (inspection === null) throw new Error('Signed Capsule was not produced.');
          return inspection;
        },
      },
      releaseAttestor: {
        async attest() {
          return {
            algorithm: 'Ed25519',
            keyId: 'release-key',
            signatureBase64: Buffer.alloc(64, 1).toString('base64'),
          };
        },
      },
    });
    const construction = await service.construct({
      manifest: MANIFEST,
      files: [{ path: 'src/main.ts', bytes: new TextEncoder().encode('export default 1;') }],
    });
    const signed = await service.sign(construction, 'release');
    expect(construction.distFiles).toEqual([{
      path: 'dist/main.js',
      bytes: new Uint8Array([1, 2, 3]),
    }]);
    expect(signed.capsule.artifactBytes).toEqual(new Uint8Array([4, 5, 6, 0xff]));
    expect(signed.capsule.runtime.signatureKeyIds).toEqual(['release-key']);
    await service.close();
  });
});
