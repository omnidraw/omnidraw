import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WidgetConstructionCache } from '../src/services/WidgetConstructionCache';

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

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'omnidraw-widget-construction-cache-'));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

function construction() {
  return {
    executableInputDigestSha256: RAW_A,
    executableManifestDigestSha256: RAW_B,
    canonicalExecutableManifestJson: '{}',
    distributionDigestSha256: RAW_A,
    construction: {
      sourceSnapshotId: RAW_A,
      sourceDigestSha256: RAW_A,
      sourceArtifact: { kind: 'source', digestSha256: RAW_A, bytes: new Uint8Array([1, 2, 3]) },
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
        unsignedBytes: new Uint8Array([9, 8, 7]),
        capsuleArtifactHash: CAPSULE_HASH,
        runtimeDescriptor: { ...RUNTIME, signatureKeyIds: [] },
        builderIdentity: 'builder-v1',
        capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
      },
      serverArtifact: null,
      diagnostics: [],
    } as unknown as import('@omnidraw/widget-contract').TWidgetArtifactConstructionResult,
    distFiles: [{ path: 'dist/main.js', bytes: new TextEncoder().encode('browser') }],
  };
}

describe('WidgetConstructionCache', () => {
  it('persists and restores an exact construction across a fresh instance', async () => {
    const directory = await root();
    const key = 'builder-v1\u0000' + RAW_A;

    const first = new WidgetConstructionCache(directory);
    await first.write(key, construction());
    await first.close();
    const read = await first.read(key);
    expect(read).not.toBeNull();
    expect(read!.executableInputDigestSha256).toBe(RAW_A);
    expect(read!.construction.uiArtifact.unsignedBytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(read!.distFiles[0]!.bytes).toEqual(new TextEncoder().encode('browser'));

    // A fresh instance (simulating a server restart) reads the same bytes.
    const second = new WidgetConstructionCache(directory);
    const restored = await second.read(key);
    expect(restored).not.toBeNull();
    expect(restored!.construction.sourceArtifact.bytes).toEqual(new Uint8Array([1, 2, 3]));
    await second.close();
  });

  it('returns null for an unknown key', async () => {
    const directory = await root();
    const cache = new WidgetConstructionCache(directory);
    expect(await cache.read('missing')).toBeNull();
    await cache.close();
  });

  it('bounds the on-disk entries and writes an index', async () => {
    const directory = await root();
    const cache = new WidgetConstructionCache(directory);
    for (let index = 0; index < 5; index += 1) {
      await cache.write(`key-${index}`, construction());
    }
    const files = await readdir(directory);
    expect(files).toContain('index.json');
    expect(files.filter((name) => name.endsWith('.json') && name !== 'index.json')).toHaveLength(5);
    await cache.close();
  });
});
