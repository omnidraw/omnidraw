import { describe, expect, test } from 'bun:test';
import type {
  TWidgetManifestV1,
  TWidgetReleaseDescriptor,
  TWidgetReleaseObservation,
  TWidgetReleaseValidation,
} from '../src';
import {
  fnCanonicalizeWidgetReleaseDirectoryFiles,
  ZWidgetReleaseDescriptor,
  fnCanonicalizeWidgetReleaseDescriptor,
  fnCreateWidgetReleaseDescriptor,
  fnValidateWidgetRelease,
  fnWidgetReleaseDirectoryDigest,
  parseWidgetReleaseJson,
} from '../src';
import {
  CAPSULE_API_CONTRACT,
  CAPSULE_HASH_A,
  CAPSULE_RUNTIME_DESCRIPTOR,
  RAW_DIGEST_A,
  RAW_DIGEST_B,
} from './capsule.fixture';
import { TEST_SERVER_FUNCTION_DESCRIPTOR } from './function-descriptor.fixture';

const FUNCTIONS_DIGEST = 'c'.repeat(64);
const SERVER_DIST_DIGEST = 'd'.repeat(64);
const RELEASE_ATTESTATION = Object.freeze({
  algorithm: 'Ed25519' as const,
  keyId: 'release-key',
  signatureBase64: Buffer.alloc(64, 1).toString('base64'),
});
const MANIFEST: TWidgetManifestV1 = {
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
  schemaVersion: 1,
  name: 'Server widget',
  slug: 'server-widget',
  description: 'Calls one bounded server function.',
  tool: { label: 'Server widget', group: 'utilities', priority: 0 },
  ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
  server: { entry: 'server/main.ts', runtimeAbi: 'bun-v1' },
  resources: [],
};

const RUNTIME = {
  ...CAPSULE_RUNTIME_DESCRIPTOR,
  apiContract: CAPSULE_API_CONTRACT,
  capabilityRequests: [{
    id: `omnidraw.widget.functions.h${FUNCTIONS_DIGEST}`,
    versionRange: '1.0.0',
    contractHash: `sha256:${FUNCTIONS_DIGEST}` as const,
    required: true,
    operations: ['run'],
  }],
};

const RELEASE = fnCreateWidgetReleaseDescriptor({
  executableManifestDigestSha256: RAW_DIGEST_A,
  files: [
    { path: 'server-dist/main.js', byteSize: 40, sha256: RAW_DIGEST_B },
    { path: 'functions.json', byteSize: 30, sha256: FUNCTIONS_DIGEST },
    { path: 'dist/main.js', byteSize: 20, sha256: RAW_DIGEST_A },
    { path: 'capsule.artifact', byteSize: 10, sha256: RAW_DIGEST_B },
  ],
  capsule: { path: 'capsule.artifact', artifactHash: CAPSULE_HASH_A, runtime: RUNTIME },
  server: {
    entry: 'server-dist/main.js',
    runtimeAbi: 'bun-v1',
    functionsPath: 'functions.json',
    serverDistDigestSha256: SERVER_DIST_DIGEST,
    functionsDigestSha256: FUNCTIONS_DIGEST,
  },
  releaseAttestation: RELEASE_ATTESTATION,
});

const OBSERVATION: TWidgetReleaseObservation = {
  files: [...RELEASE.files].reverse(),
  capsule: { artifactHash: CAPSULE_HASH_A, runtime: RUNTIME },
  server: {
    serverDistDigestSha256: SERVER_DIST_DIGEST,
    functionsDigestSha256: FUNCTIONS_DIGEST,
    functions: [TEST_SERVER_FUNCTION_DESCRIPTOR],
  },
};

function validate(
  release: TWidgetReleaseDescriptor = RELEASE,
  observation: TWidgetReleaseObservation = OBSERVATION,
) {
  return fnValidateWidgetRelease({
    manifest: MANIFEST,
    expectedExecutableManifestDigestSha256: RAW_DIGEST_A,
    release,
    observation,
  });
}

function failureReason(validation: TWidgetReleaseValidation): string {
  if (validation.valid) throw new TypeError('Expected release validation to fail.');
  return validation.reason;
}

describe('minimal widget release v1', () => {
  test('uses one canonical directory digest framing for publisher and scanner', () => {
    const files = [
      { path: 'nested/chunk.js', byteSize: 2, sha256: RAW_DIGEST_B },
      { path: 'main.js', byteSize: 1, sha256: RAW_DIGEST_A },
    ];
    expect(fnCanonicalizeWidgetReleaseDirectoryFiles(files)).toBe(JSON.stringify([
      files[1],
      files[0],
    ]));
    expect(fnWidgetReleaseDirectoryDigest({
      files,
      digestSha256: () => SERVER_DIST_DIGEST,
    })).toBe(SERVER_DIST_DIGEST);
    expect(() => fnCanonicalizeWidgetReleaseDirectoryFiles([
      ...files,
      { path: 'Main.js', byteSize: 1, sha256: RAW_DIGEST_A },
    ])).toThrow('Duplicate');
  });

  test('constructs sorted generated metadata with no authored or historical facts', () => {
    expect(RELEASE.files.map((file) => file.path)).toEqual([
      'capsule.artifact',
      'dist/main.js',
      'functions.json',
      'server-dist/main.js',
    ]);
    const serialized = fnCanonicalizeWidgetReleaseDescriptor(RELEASE);
    for (const forbidden of ['Server widget', 'description', '"tool"', 'revision', 'timestamp', 'releaseId']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(parseWidgetReleaseJson(serialized)).toEqual(RELEASE);
    expect(ZWidgetReleaseDescriptor.safeParse({ ...RELEASE, extra: true }).success).toBe(false);
  });

  test('validates the exact file set, signed-byte hashes, Capsule identity, server output, and descriptors', () => {
    expect(validate()).toEqual({ valid: true });
    expect(RELEASE.files.find((file) => file.path === 'capsule.artifact')!.sha256)
      .not.toBe(RELEASE.capsule.artifactHash.slice('sha256:'.length));
  });

  test('rejects stale digests, extras, missing files, byte drift, Capsule drift, and server drift', () => {
    expect(fnValidateWidgetRelease({
      manifest: MANIFEST,
      expectedExecutableManifestDigestSha256: RAW_DIGEST_B,
      release: RELEASE,
      observation: OBSERVATION,
    })).toEqual({ valid: false, reason: 'executable_manifest_digest_mismatch' });

    expect(failureReason(validate(RELEASE, {
      ...OBSERVATION,
      files: [...OBSERVATION.files, { path: 'dist/extra.js', byteSize: 1, sha256: RAW_DIGEST_A }],
    }))).toBe('release_file_set_mismatch');
    expect(failureReason(validate(RELEASE, {
      ...OBSERVATION,
      files: OBSERVATION.files.filter((file) => file.path !== 'dist/main.js'),
    }))).toBe('release_file_set_mismatch');
    expect(failureReason(validate(RELEASE, {
      ...OBSERVATION,
      files: OBSERVATION.files.map((file) => file.path === 'dist/main.js'
        ? { ...file, sha256: RAW_DIGEST_B }
        : file),
    }))).toBe('release_file_hash_mismatch');
    expect(failureReason(validate(RELEASE, {
      ...OBSERVATION,
      capsule: { ...OBSERVATION.capsule, artifactHash: `sha256:${RAW_DIGEST_B}` },
    }))).toBe('capsule_identity_mismatch');
    expect(failureReason(validate(RELEASE, {
      ...OBSERVATION,
      server: { ...OBSERVATION.server!, serverDistDigestSha256: RAW_DIGEST_A },
    }))).toBe('server_digest_mismatch');
  });

  test('rejects unsorted, case-colliding, and unlisted release paths', () => {
    expect(failureReason(validate({ ...RELEASE, files: [...RELEASE.files].reverse() })))
      .toBe('release_file_order_invalid');
    expect(ZWidgetReleaseDescriptor.safeParse({
      ...RELEASE,
      files: [...RELEASE.files, { path: 'source/main.ts', byteSize: 1, sha256: RAW_DIGEST_A }],
    }).success).toBe(false);
    expect(failureReason(validate({
      ...RELEASE,
      files: [
        ...RELEASE.files,
        { path: 'dist/Main.js', byteSize: 1, sha256: RAW_DIGEST_A },
      ].sort((left, right) => left.path.localeCompare(right.path)),
    }))).toBe('release_file_path_invalid');
  });

  test('requires server presence to agree across manifest, release, and observations', () => {
    const browserManifest = { ...MANIFEST, server: undefined };
    expect(failureReason(fnValidateWidgetRelease({
      manifest: browserManifest,
      expectedExecutableManifestDigestSha256: RAW_DIGEST_A,
      release: RELEASE,
      observation: OBSERVATION,
    }))).toBe('server_contract_mismatch');
    expect(failureReason(validate({ ...RELEASE, server: null }))).toBe('server_contract_mismatch');
  });
});
