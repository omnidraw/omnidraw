import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';
import {
  fnCanonicalizeWidgetServerFunctionDescriptors,
} from '@omnidraw/widget-contract';
import type {
  TWidgetManifestV1,
} from '@omnidraw/widget-contract/filesystem';
import {
  fnCreateWidgetReleaseDescriptor,
  fnWidgetExecutableManifestDigest,
  fnWidgetReleaseDirectoryDigest,
} from '@omnidraw/widget-contract/filesystem';
import {
  NodeWidgetCatalogFilesystem,
  NodeWidgetCatalogHash,
  WIDGET_CATALOG_CONTRACTS,
  WidgetFilesystemCatalog,
} from '../../src/widget-filesystem/catalog';
import type {
  TWidgetCatalogCapsuleInspectionPortal,
  TWidgetCatalogDirectoryObservation,
  TWidgetCatalogFilesystemPortal,
  TPinnedWidgetCatalogRoot,
} from '../../src/widget-filesystem/catalog';

const temporaryRoots: string[] = [];
const hashPortal = new NodeWidgetCatalogHash();
const RELEASE_ATTESTATION = Object.freeze({
  algorithm: 'Ed25519' as const,
  keyId: 'release-key',
  signatureBase64: Buffer.alloc(64, 1).toString('base64'),
});

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function manifest(slug: string, name = 'Counter'): TWidgetManifestV1 {
  return {
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name,
    slug,
    description: 'A bounded filesystem widget.',
    tool: { label: name, group: 'examples', priority: 0 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
  };
}

function runtime(
  artifactHash: `sha256:${string}`,
  functionsDigestSha256?: string,
): TWidgetCapsuleRuntimeDescriptor {
  return {
    format: 'omnidraw.capsule-runtime.v2',
    capsuleArtifactHash: artifactHash,
    apiContract: {
      format: 'capsule-api-groups-v1',
      groups: ['DOM'],
      bundleDigest: `sha256:${'b'.repeat(64)}`,
    },
    budgets: {},
    capabilityRequests: functionsDigestSha256 === undefined ? [] : [{
      id: `omnidraw.widget.functions.h${functionsDigestSha256}`,
      versionRange: '1.0.0',
      contractHash: `sha256:${functionsDigestSha256}`,
      required: true,
      operations: ['run'],
    }],
    channels: null,
    parkability: { parkable: false },
    signatureKeyIds: ['release-key'],
  };
}

function capsulePortal(
  observations: Array<readonly string[]> = [],
): TWidgetCatalogCapsuleInspectionPortal {
  return {
    async inspectCapsuleArtifact(args) {
      observations.push(args.expectedApis);
      const text = Buffer.from(args.bytes).toString('utf8');
      if (text === 'rejected-capsule') throw new Error('Capsule signature is not trusted.');
      expect(args.releaseAttestation).toEqual(RELEASE_ATTESTATION);
      expect(args.canonicalUnsignedReleaseJson).not.toContain('releaseAttestation');
      return {
        artifactHash: args.expectedRuntime.capsuleArtifactHash,
        runtime: args.expectedRuntime,
      };
    },
  };
}

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'omnidraw-catalog-'));
  temporaryRoots.push(path);
  await Promise.all([
    mkdir(join(path, 'drafts')),
    mkdir(join(path, 'published')),
  ]);
  return path;
}

async function writeManifest(path: string, value: TWidgetManifestV1): Promise<void> {
  await writeFile(join(path, 'omnidraw.json'), JSON.stringify(value));
}

async function writeDraft(rootPath: string, value: TWidgetManifestV1): Promise<string> {
  const path = join(rootPath, 'drafts', value.slug);
  await mkdir(join(path, 'ui'), { recursive: true });
  await Promise.all([
    writeManifest(path, value),
    writeFile(join(path, 'ui', 'main.ts'), 'export default 1;'),
  ]);
  return path;
}

async function writePublication(
  rootPath: string,
  value: TWidgetManifestV1,
  capsuleText = 'signed-capsule',
): Promise<string> {
  const path = join(rootPath, 'published', value.slug);
  const distBytes = new Uint8Array(Buffer.from('export default 1;', 'utf8'));
  const capsuleBytes = new Uint8Array(Buffer.from(capsuleText, 'utf8'));
  const artifactHash = `sha256:${sha256(capsuleBytes)}` as const;
  const release = fnCreateWidgetReleaseDescriptor({
    executableManifestDigestSha256: fnWidgetExecutableManifestDigest({
      manifest: value,
      digestSha256: sha256,
    }),
    files: [
      { path: 'capsule.artifact', byteSize: capsuleBytes.byteLength, sha256: sha256(capsuleBytes) },
      { path: 'dist/main.js', byteSize: distBytes.byteLength, sha256: sha256(distBytes) },
    ],
    capsule: {
      path: 'capsule.artifact',
      artifactHash,
      runtime: runtime(artifactHash),
    },
    server: null,
    releaseAttestation: RELEASE_ATTESTATION,
  });
  await mkdir(join(path, 'dist'), { recursive: true });
  await Promise.all([
    writeManifest(path, value),
    writeFile(join(path, 'dist', 'main.js'), distBytes),
    writeFile(join(path, 'capsule.artifact'), capsuleBytes),
  ]);
  await writeFile(join(path, 'release.json'), JSON.stringify(release));
  return path;
}

const SERVER_FUNCTION: TWidgetServerFunctionDescriptor = {
  schemaVersion: 1,
  exportName: 'run',
  modulePath: 'server/main.ts',
  effect: 'fn',
  inputSchema: { type: 'object', additionalProperties: false },
  outputSchema: { type: 'object', additionalProperties: false },
  resources: [],
  limits: {
    timeoutMs: 5_000,
    memoryTier: 'small',
    outputByteLimit: 64 * 1_024,
    logByteLimit: 64 * 1_024,
  },
};

async function writeServerPublication(
  rootPath: string,
  slug: string,
): Promise<string> {
  const value: TWidgetManifestV1 = {
    ...manifest(slug, 'Server widget'),
    server: { entry: 'server/main.ts', runtimeAbi: 'bun-v1' },
  };
  const path = join(rootPath, 'published', slug);
  const distBytes = new Uint8Array(Buffer.from('export default 1;', 'utf8'));
  const serverBytes = new Uint8Array(Buffer.from('export const run = () => ({});', 'utf8'));
  const functionsBytes = new Uint8Array(Buffer.from(
    fnCanonicalizeWidgetServerFunctionDescriptors([SERVER_FUNCTION]),
    'utf8',
  ));
  const functionsDigestSha256 = sha256(functionsBytes);
  const capsuleBytes = new Uint8Array(Buffer.from(`server:${functionsDigestSha256}`, 'utf8'));
  const artifactHash = `sha256:${sha256(capsuleBytes)}` as const;
  const capsuleRuntime = runtime(artifactHash, functionsDigestSha256);
  const serverFile = {
    path: 'main.js',
    byteSize: serverBytes.byteLength,
    sha256: sha256(serverBytes),
  };
  const release = fnCreateWidgetReleaseDescriptor({
    executableManifestDigestSha256: fnWidgetExecutableManifestDigest({
      manifest: value,
      digestSha256: sha256,
    }),
    files: [
      { path: 'capsule.artifact', byteSize: capsuleBytes.byteLength, sha256: sha256(capsuleBytes) },
      { path: 'dist/main.js', byteSize: distBytes.byteLength, sha256: sha256(distBytes) },
      { path: 'functions.json', byteSize: functionsBytes.byteLength, sha256: functionsDigestSha256 },
      { ...serverFile, path: `server-dist/${serverFile.path}` },
    ],
    capsule: { path: 'capsule.artifact', artifactHash, runtime: capsuleRuntime },
    server: {
      entry: 'server-dist/main.js',
      runtimeAbi: 'bun-v1',
      functionsPath: 'functions.json',
      serverDistDigestSha256: fnWidgetReleaseDirectoryDigest({
        files: [serverFile],
        digestSha256: sha256,
      }),
      functionsDigestSha256,
    },
    releaseAttestation: RELEASE_ATTESTATION,
  });
  await Promise.all([
    mkdir(join(path, 'dist'), { recursive: true }),
    mkdir(join(path, 'server-dist'), { recursive: true }),
  ]);
  await Promise.all([
    writeManifest(path, value),
    writeFile(join(path, 'dist', 'main.js'), distBytes),
    writeFile(join(path, 'server-dist', 'main.js'), serverBytes),
    writeFile(join(path, 'functions.json'), functionsBytes),
    writeFile(join(path, 'capsule.artifact'), capsuleBytes),
  ]);
  await writeFile(join(path, 'release.json'), JSON.stringify(release));
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('filesystem-first widget catalog', () => {
  test('accepts only the canonical generated server-functions envelope', () => {
    const canonical = fnCanonicalizeWidgetServerFunctionDescriptors([SERVER_FUNCTION]);
    expect(WIDGET_CATALOG_CONTRACTS.parseFunctionsJson(canonical)).toEqual([
      SERVER_FUNCTION,
    ]);
    expect(() => WIDGET_CATALOG_CONTRACTS.parseFunctionsJson(
      JSON.stringify([SERVER_FUNCTION]),
    )).toThrow('canonical envelope');
    expect(() => WIDGET_CATALOG_CONTRACTS.parseFunctionsJson(
      JSON.stringify({
        format: 'omnidraw.server-functions.v1',
        functions: [SERVER_FUNCTION],
        extra: true,
      }),
    )).toThrow('not canonical');
  });

  test('returns immutable generations and presentation/executable differences keyed by slug', async () => {
    const rootPath = await root();
    const value = manifest('counter');
    const draftPath = await writeDraft(rootPath, value);
    await writePublication(rootPath, value);
    const inspectedApis: Array<readonly string[]> = [];
    let barrierReads = 0;
    const catalog = new WidgetFilesystemCatalog({
      rootPath,
      filesystem: new NodeWidgetCatalogFilesystem(),
      hash: hashPortal,
      capsule: capsulePortal(inspectedApis),
      barrier: {
        async withRead<T>(operation: () => T | Promise<T>): Promise<T> {
          barrierReads += 1;
          return operation();
        },
      },
    });

    const first = await catalog.refresh();
    expect(first.generation).toBe(1);
    expect(first.healthy).toBe(true);
    expect(Object.keys(first.entries)).toEqual(['counter']);
    expect(first.entries.counter?.placeable).toBe(true);
    expect(first.entries.counter?.differences).toMatchObject({
      manifest: 'same',
      presentation: 'same',
      executableManifest: 'same',
      status: 'matched',
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.entries)).toBe(true);
    expect(Object.isFrozen(first.entries.counter?.published?.release)).toBe(true);
    expect(inspectedApis).toEqual([['DOM']]);

    const unchanged = await catalog.refresh();
    expect(unchanged).toBe(first);
    expect(unchanged.generation).toBe(1);

    await writeManifest(draftPath, manifest('counter', 'Renamed counter'));
    const second = await catalog.refresh();
    expect(second.generation).toBe(2);
    expect(second.digestSha256).not.toBe(first.digestSha256);
    expect(second.entries.counter?.differences).toMatchObject({
      manifest: 'different',
      presentation: 'different',
      executableManifest: 'same',
      status: 'presentation-changed',
    });
    expect(catalog.current()).toBe(second);
    expect(barrierReads).toBe(3);
  });

  test('isolates corrupt and mismatched widgets while a healthy publication remains placeable', async () => {
    const rootPath = await root();
    await writePublication(rootPath, manifest('good', 'Good'));
    const badPath = await writePublication(rootPath, manifest('bad', 'Bad'));
    await writeFile(join(badPath, 'dist', 'main.js'), 'tampered bytes');

    const wrongPath = join(rootPath, 'drafts', 'wrong-folder');
    await mkdir(wrongPath);
    await writeManifest(wrongPath, manifest('another-slug', 'Wrong'));

    const catalog = new WidgetFilesystemCatalog({
      rootPath,
      filesystem: new NodeWidgetCatalogFilesystem(),
      hash: hashPortal,
      capsule: capsulePortal(),
    });
    const snapshot = await catalog.refresh();

    expect(snapshot.healthy).toBe(false);
    expect(snapshot.entries.good).toMatchObject({ health: 'healthy', placeable: true });
    expect(snapshot.entries.bad).toMatchObject({ health: 'unhealthy', placeable: false });
    expect(snapshot.entries.bad?.published?.issues.map((issue) => issue.code))
      .toContain('release_validation_failed');
    expect(snapshot.entries['wrong-folder']?.draft?.issues.map((issue) => issue.code))
      .toContain('manifest_slug_mismatch');
  });

  test('validates exact server-directory, function, and Capsule observations through A108', async () => {
    const rootPath = await root();
    const serverPath = await writeServerPublication(rootPath, 'server-widget');
    await writePublication(rootPath, manifest('bad-capsule', 'Bad Capsule'), 'rejected-capsule');
    const catalog = new WidgetFilesystemCatalog({
      rootPath,
      filesystem: new NodeWidgetCatalogFilesystem(),
      hash: hashPortal,
      capsule: capsulePortal(),
    });

    const first = await catalog.refresh();
    expect(first.entries['server-widget']?.published).toMatchObject({
      health: 'healthy',
      releaseValidation: { valid: true },
    });
    expect(first.entries['server-widget']?.published?.functions?.map(({ exportName }) => exportName))
      .toEqual(['run']);
    expect(first.entries['bad-capsule']?.published?.issues.map((issue) => issue.code))
      .toContain('capsule_inspection_failed');

    const releasePath = join(serverPath, 'release.json');
    const release = JSON.parse(await readFile(releasePath, 'utf8')) as {
      server: { serverDistDigestSha256: string };
    };
    release.server.serverDistDigestSha256 = 'f'.repeat(64);
    await writeFile(releasePath, JSON.stringify(release));
    const second = await catalog.refresh();
    expect(second.entries['server-widget']?.published?.health).toBe('unhealthy');
    expect(second.entries['server-widget']?.published?.releaseValidation).toMatchObject({
      valid: false,
      reason: 'server_digest_mismatch',
    });
  });

  test('rejects traversal and symlinks without losing unrelated draft observations', async () => {
    const rootPath = await root();
    await writeDraft(rootPath, manifest('healthy-draft', 'Healthy draft'));
    const linkedTarget = join(rootPath, 'linked-target');
    await mkdir(linkedTarget);
    await symlink(linkedTarget, join(rootPath, 'drafts', 'linked'));
    const nestedPath = await writeDraft(rootPath, manifest('nested-link', 'Nested link'));
    await symlink(join(rootPath, 'drafts'), join(nestedPath, 'escape'));

    const filesystem = new NodeWidgetCatalogFilesystem();
    const pinned = await filesystem.pinRoot({ requestedPath: rootPath });
    await expect(filesystem.readFile(pinned, {
      relativePath: '../outside',
      maxBytes: 100,
    })).rejects.toThrow('Unsafe widget catalog relative path');

    const catalog = new WidgetFilesystemCatalog({
      rootPath,
      filesystem,
      hash: hashPortal,
      capsule: capsulePortal(),
    });
    const snapshot = await catalog.refresh();
    expect(snapshot.entries['healthy-draft']?.draft?.health).toBe('healthy');
    expect(snapshot.entries.linked?.draft?.issues.map((issue) => issue.code))
      .toContain('symlink_not_allowed');
    expect(snapshot.entries['nested-link']?.draft?.issues.map((issue) => issue.code))
      .toContain('symlink_not_allowed');
  });

  test('bounds recursion per widget and continues scanning its healthy sibling', async () => {
    const rootPath = await root();
    await writeDraft(rootPath, manifest('good-draft', 'Good draft'));
    const deepPath = await writeDraft(rootPath, manifest('deep', 'Deep'));
    await mkdir(join(deepPath, 'a', 'b'), { recursive: true });
    await writeFile(join(deepPath, 'a', 'b', 'value.ts'), 'export const value = 1;');

    const catalog = new WidgetFilesystemCatalog({
      rootPath,
      filesystem: new NodeWidgetCatalogFilesystem(),
      hash: hashPortal,
      capsule: capsulePortal(),
      limits: { maxDepth: 1 },
    });
    const snapshot = await catalog.refresh();
    expect(snapshot.entries['good-draft']?.draft?.health).toBe('healthy');
    expect(snapshot.entries.deep?.draft?.issues.map((issue) => issue.code))
      .toContain('scan_depth_exceeded');
  });

  test('isolates a widget that exhausts its entry budget and still loads a later healthy publication', async () => {
    const rootPath = await root();
    const badPath = join(rootPath, 'published', 'a-bad');
    await mkdir(badPath);
    await Promise.all(Array.from({ length: 9 }, (_, index) => symlink(
      '/etc/passwd',
      join(badPath, `link-${index.toString().padStart(2, '0')}`),
    )));
    await writePublication(rootPath, manifest('z-healthy', 'Healthy'));

    const catalog = new WidgetFilesystemCatalog({
      rootPath,
      filesystem: new NodeWidgetCatalogFilesystem(),
      hash: hashPortal,
      capsule: capsulePortal(),
      limits: {
        maxEntriesPerWidget: 8,
        maxGlobalEntries: 13,
      },
    });
    const snapshot = await catalog.refresh();

    expect(snapshot.entries['a-bad']?.published?.issues.map((issue) => issue.code))
      .toContain('scan_entry_count_exceeded');
    expect(snapshot.entries['z-healthy']).toMatchObject({
      health: 'healthy',
      placeable: true,
    });
  });

  test('rejects case-colliding slugs and special widget entries', async () => {
    const rootObservation: TWidgetCatalogDirectoryObservation = {
      relativePath: '',
      token: 'root',
      entries: [
        { name: 'drafts', kind: 'directory', byteSize: null },
        { name: 'published', kind: 'directory', byteSize: null },
      ],
    };
    const observations: Record<string, TWidgetCatalogDirectoryObservation> = {
      '': rootObservation,
      drafts: {
        relativePath: 'drafts',
        token: 'drafts',
        entries: [
          { name: 'Foo', kind: 'directory', byteSize: null },
          { name: 'foo', kind: 'directory', byteSize: null },
        ],
      },
      published: {
        relativePath: 'published',
        token: 'published',
        entries: [{ name: 'pipe', kind: 'special', byteSize: null }],
      },
    };
    const pinned: TPinnedWidgetCatalogRoot = { canonicalPath: '/virtual', identity: 'virtual' };
    const filesystem: TWidgetCatalogFilesystemPortal = {
      async pinRoot() { return pinned; },
      async assertRoot() {},
      async readDirectory(_root, args) { return observations[args.relativePath]!; },
      async assertDirectoryUnchanged(_root, args) {
        expect(observations[args.observation.relativePath]?.token)
          .toBe(args.observation.token);
      },
      async readFile() { throw new Error('Collision entries must not be read.'); },
      decodeUtf8({ bytes }) { return Buffer.from(bytes).toString('utf8'); },
    };
    const catalog = new WidgetFilesystemCatalog({
      rootPath: '/virtual',
      filesystem,
      hash: hashPortal,
      capsule: capsulePortal(),
    });
    const snapshot = await catalog.refresh();

    expect(snapshot.entries.foo?.draft?.issues.map((issue) => issue.code))
      .toContain('slug_case_collision');
    expect(snapshot.entries.pipe?.published?.issues.map((issue) => issue.code))
      .toContain('special_file_not_allowed');
    expect(snapshot.issues.map((issue) => issue.code)).toContain('unsafe_slug');
  });

  test('keeps the last generation when a later root observation fails', async () => {
    const rootPath = await root();
    await writePublication(rootPath, manifest('stable', 'Stable'));
    const filesystem = new NodeWidgetCatalogFilesystem();
    const catalog = new WidgetFilesystemCatalog({
      rootPath,
      filesystem,
      hash: hashPortal,
      capsule: capsulePortal(),
    });
    const first = await catalog.refresh();
    await rm(join(rootPath, 'published'), { recursive: true });
    await writeFile(join(rootPath, 'published'), 'not a directory');
    const second = await catalog.refresh();
    expect(second.entries.stable).toBeUndefined();
    expect(second.issues.map((issue) => issue.code)).toContain('layout_entry_invalid');
    expect(catalog.current()).toBe(second);

    await rm(rootPath, { recursive: true });
    await expect(catalog.refresh()).rejects.toThrow('Pinned widget catalog root identity changed');
    expect(catalog.current()).toBe(second);
    temporaryRoots.splice(temporaryRoots.indexOf(rootPath), 1);
    expect(first.generation).toBe(1);
  });
});
