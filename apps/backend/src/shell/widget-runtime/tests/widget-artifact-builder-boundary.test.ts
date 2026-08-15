import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCapsuleGuest,
  type CapsuleBuildOutput,
  type CapsuleApiGroupBuildRequest,
} from '@omnidraw/capsule/build';
import {
  type CapsuleApiGroup,
  type CapsuleBuildInput,
} from '@omnidraw/capsule/protocol';
import type { CapsuleArtifactSigningKey } from '@omnidraw/capsule/sign';
import { describe, expect, test } from 'bun:test';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnProjectWidgetBrowserFunctionDescriptors,
  type TWidgetBuildRequest,
  type TWidgetRuntimeBuildIdentity,
  type TWidgetExecutableManifestProjection,
  type TWidgetServerFunctionDescriptor,
  type TWidgetSourceSnapshot,
} from '@omnidraw/sdk/contract';
import {
  OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
  WidgetArtifactBuilderCapsule,
  type TWidgetArtifactBuilderCapsuleConfig,
} from '../build';
import { WidgetSourceSnapshot } from '#backend/shell/widget-domain/local';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sha256 = (value: Uint8Array | string): string => (
  createHash('sha256').update(value).digest('hex')
);
const BUILDER_IDENTITY = 'capsule-boundary-test';
const CAPSULE_ARTIFACT_HASH =
  `sha256:${'a'.repeat(64)}` as const;
const CAPSULE_BUILD_IDENTITY: TWidgetRuntimeBuildIdentity = Object.freeze({
  packageName: '@omnidraw/capsule',
  packageVersion: '0.10.2',
  packageDigest: `sha256:${'b'.repeat(64)}`,
  buildApiVersion: '0.1.0',
  runtimeBuildDigest: `sha256:${'c'.repeat(64)}`,
});
const SIGNING_KEY = Object.freeze({
  keyId: 'capsule-boundary-test-key',
  privateKey: {} as CryptoKey,
}) satisfies CapsuleArtifactSigningKey;
const EMPTY_CAPSULE_OUTPUT = Object.freeze({
  artifactBytes: Uint8Array.of(1, 2, 3),
  artifactHash: CAPSULE_ARTIFACT_HASH,
  diagnostics: Object.freeze([]),
}) satisfies CapsuleBuildOutput;
const FN_HELLO_DESCRIPTOR = Object.freeze({
  schemaVersion: 1,
  exportName: 'fnHello',
  effect: 'fn',
  inputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({}),
  }),
  outputSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({}),
  }),
  resources: Object.freeze([]),
  limits: Object.freeze({
    timeoutMs: 1_000,
    memoryTier: 'small',
    outputByteLimit: 1_024,
    logByteLimit: 0,
  }),
}) satisfies TWidgetServerFunctionDescriptor;
const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
);

type TSourceFile = Readonly<{
  path: string;
  value: string | Uint8Array;
}>;

function snapshot(files: readonly TSourceFile[]): TWidgetSourceSnapshot {
  const normalized = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, value }) => Object.freeze({
      path,
      bytes: typeof value === 'string'
        ? encoder.encode(value)
        : new Uint8Array(value),
    }));
  const hash = createHash('sha256');
  for (const file of normalized) {
    const pathBytes = encoder.encode(file.path);
    hash.update(`${pathBytes.byteLength}:`);
    hash.update(pathBytes);
    hash.update(`:${file.bytes.byteLength}:`);
    hash.update(file.bytes);
    hash.update(';');
  }
  const digestSha256 = hash.digest('hex');
  return Object.freeze({
    id: digestSha256,
    digestSha256,
    files: Object.freeze(normalized),
    createdAtMs: 0,
  });
}

function manifest(args: Readonly<{
  entry: string;
  apis?: readonly CapsuleApiGroup[];
  serverEntry?: string;
}>): TWidgetExecutableManifestProjection {
  return Object.freeze({
    schemaVersion: 1,
    ui: Object.freeze({
      runtime: 'capsule',
      entry: args.entry,
      apis: Object.freeze(['DOM' as const, ...(args.apis ?? [])]),
    }),
    server: args.serverEntry === undefined
      ? null
      : Object.freeze({
          entry: args.serverEntry,
          runtimeAbi: 'bun-v1',
        }),
    resources: Object.freeze([]),
  });
}

function request(
  sourceSnapshot: TWidgetSourceSnapshot,
  widgetManifest: TWidgetExecutableManifestProjection,
): TWidgetBuildRequest {
  return Object.freeze({
    snapshot: sourceSnapshot,
    manifest: widgetManifest,
    canonicalManifestJson: fnCanonicalizeWidgetExecutableProjection(widgetManifest),
    builderIdentity: BUILDER_IDENTITY,
    capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    buildPolicyId: OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
    signingPurpose: 'preview',
  });
}

function builder(args: Readonly<{
  tempRoot: string;
  capsuleBuild(request: CapsuleApiGroupBuildRequest): Promise<
    Pick<CapsuleBuildOutput, 'artifactBytes' | 'artifactHash' | 'diagnostics'>
  >;
  descriptors?: readonly TWidgetServerFunctionDescriptor[];
  bunBuild?: typeof Bun.build;
  distributionBuild?: TWidgetArtifactBuilderCapsuleConfig['distributionBuild'];
  loadSigningKeys?: TWidgetArtifactBuilderCapsuleConfig['loadSigningKeys'];
  capsuleSign?: TWidgetArtifactBuilderCapsuleConfig['capsuleSign'];
}>): WidgetArtifactBuilderCapsule {
  return new WidgetArtifactBuilderCapsule({
    tempRoot: args.tempRoot,
    builderIdentity: BUILDER_IDENTITY,
    capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    buildPolicyId: OMNIDRAW_CAPSULE_BUILD_POLICY_ID,
    snapshotService: new WidgetSourceSnapshot({ nowMs: () => 0 }),
    resolveTrustedPackageImport: (specifier) => Bun.resolveSync(specifier, import.meta.dir),
    capsuleBuild: args.capsuleBuild,
    distributionBuild: args.distributionBuild ?? (async (value) => Object.freeze({
      kind: 'external-distribution',
      snapshot: Object.freeze({ files: value.files }),
      entry: value.entry,
      producer: Object.freeze({
        name: 'test',
        version: '1',
        digest: `sha256:${'1'.repeat(64)}`,
      }),
      sourceRevision: value.sourceRevision,
      dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
      buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
    }) satisfies CapsuleBuildInput),
    functionDescriptorExtractor: Object.freeze({
      async extractServerFunctionDescriptors() {
        return args.descriptors ?? Object.freeze([]);
      },
    }),
    loadSigningKeys: args.loadSigningKeys ?? (async () => Object.freeze([SIGNING_KEY])),
    capsuleSign: args.capsuleSign ?? (async (bytes) => new Uint8Array(bytes)),
    bunBuild: args.bunBuild ?? Bun.build,
  });
}

function sourceFiles(requestValue: CapsuleApiGroupBuildRequest): readonly Readonly<{
  path: string;
  bytes: Uint8Array;
}>[] {
  return requestValue.input.snapshot.files;
}

describe('WidgetArtifactBuilderCapsule trust boundary', () => {
  test('retains hidden generated maps outside the exact Capsule input', async () => {
    let captured: CapsuleApiGroupBuildRequest | undefined;
    const sourceSnapshot = snapshot([
      { path: 'src/App.tsx', value: 'export const App = () => <main />;' },
    ]);
    const widgetManifest = manifest({ entry: 'src/App.tsx' });
    const mapBytes = encoder.encode(JSON.stringify({
      version: 3,
      sources: ['src/App.tsx'],
      names: [],
      mappings: 'AAAA',
    }));
    const artifactBuilder = builder({
      tempRoot: join(tmpdir(), 'capsule-boundary-unused'),
      distributionBuild: async (value) => ({
        kind: 'external-distribution',
        snapshot: {
          files: [{ path: 'main.js', bytes: encoder.encode('export const App=()=>0;') }],
        },
        sourceMaps: [{ module: 'main.js', bytes: mapBytes }],
        entry: 'main.js',
        producer: {
          name: 'test',
          version: '1',
          digest: `sha256:${'1'.repeat(64)}`,
        },
        sourceRevision: value.sourceRevision,
        dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
        buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
      }),
      capsuleBuild: async (value) => {
        captured = value;
        expect('sourceMaps' in value.input).toBe(false);
        expect(value.input.snapshot.files.map(({ path }) => path)).toEqual(['main.js']);
        return EMPTY_CAPSULE_OUTPUT;
      },
    });

    const result = await artifactBuilder.build(
      request(sourceSnapshot, widgetManifest),
    );
    expect(captured).toBeDefined();
    expect(result.sourceMapArtifact).not.toBeNull();
    expect(result.sourceMapArtifact?.kind).toBe('source_map');
    expect(result.sourceMapArtifact?.digestSha256)
      .toBe(sha256(result.sourceMapArtifact!.bytes));
    expect(decoder.decode(result.sourceMapArtifact!.bytes)).not.toContain(
      decoder.decode(result.uiArtifact.bytes),
    );

    const mapped = await artifactBuilder.construct(
      request(sourceSnapshot, widgetManifest),
    );
    const durable = artifactBuilder.prepareDurableCacheConstruction(mapped);
    expect(mapped.sourceMapArtifact).not.toBeNull();
    expect(durable.sourceMapArtifact).toBeNull();
    expect(durable.constructionContractDigestSha256)
      .not.toBe(mapped.constructionContractDigestSha256);
    await expect(artifactBuilder.signConstruction({
      construction: durable,
      signingPurpose: 'preview',
    })).resolves.toMatchObject({ sourceMapArtifact: null });
  });

  test('forwards hostile UI syntax unchanged only to the injected Capsule build port', async () => {
    let captured: CapsuleApiGroupBuildRequest | undefined;
    let bunBuildCalls = 0;
    const hostileTypeScript = [
      'const deliberatelyInvalid: = ;',
      'import("./runtime-selected.js");',
      'require("node:fs");',
    ].join('\n');
    const hostileCss = '@import url("https://attacker.invalid/style.css"); .x{background:url("file:///etc/passwd")}';
    const sourceSnapshot = snapshot([
      { path: 'ui/main.ts', value: hostileTypeScript },
      { path: 'ui/styles.css', value: hostileCss },
      { path: 'server/private.server.ts', value: 'throw new Error("server source");' },
    ]);
    const widgetManifest = manifest({ entry: 'ui/main.ts' });
    const artifactBuilder = builder({
      tempRoot: join(tmpdir(), 'capsule-boundary-unused'),
      capsuleBuild: async (value) => {
        captured = value;
        return EMPTY_CAPSULE_OUTPUT;
      },
      bunBuild: async () => {
        bunBuildCalls += 1;
        throw new Error('The server compiler must not run for a UI-only build.');
      },
    });

    await artifactBuilder.build(request(sourceSnapshot, widgetManifest));

    expect(bunBuildCalls).toBe(0);
    expect(captured).toBeDefined();
    const files = sourceFiles(captured!);
    expect(files.map(({ path }) => path)).toEqual(['ui/main.ts', 'ui/styles.css']);
    expect(decoder.decode(files[0]!.bytes)).toBe(hostileTypeScript);
    expect(decoder.decode(files[1]!.bytes)).toBe(hostileCss);
  });

  test('lets Capsule close CSS imports and URL assets from the immutable source snapshot', async () => {
    let captured: CapsuleApiGroupBuildRequest | undefined;
    const sourceSnapshot = snapshot([
      {
        path: 'ui/main.ts',
        value: 'import "./styles/main.css";\ndocument.body.className = "hero";',
      },
      {
        path: 'ui/styles/main.css',
        value: '@import "./theme.css";\n.hero{background-image:url("../pixel.png")}',
      },
      { path: 'ui/styles/theme.css', value: '.hero{color:rgb(1 2 3)}' },
      { path: 'ui/pixel.png', value: PNG_BYTES },
    ]);
    const widgetManifest = manifest({ entry: 'ui/main.ts' });
    const artifactBuilder = builder({
      tempRoot: join(tmpdir(), 'capsule-boundary-unused'),
      distributionBuild: async (value) => ({
        kind: 'external-distribution',
        snapshot: {
          files: [
            {
              path: 'main.js',
              bytes: encoder.encode('document.body.className = "hero";'),
            },
            {
              path: 'styles/main.css',
              bytes: encoder.encode('@import "./theme.css";\n.hero{background-image:url("../pixel.png")}'),
            },
            {
              path: 'styles/theme.css',
              bytes: encoder.encode('.hero{color:rgb(1 2 3)}'),
            },
            { path: 'pixel.png', bytes: PNG_BYTES },
          ],
        },
        entry: 'main.js',
        cssRoots: ['styles/main.css'],
        producer: {
          name: 'test',
          version: '1',
          digest: `sha256:${'1'.repeat(64)}`,
        },
        sourceRevision: value.sourceRevision,
        dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
        buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
      }),
      capsuleBuild: async (value) => {
        captured = value;
        expect(value.apis).toEqual(['DOM']);
        return await buildCapsuleGuest(value);
      },
    });

    const result = await artifactBuilder.build(
      request(sourceSnapshot, widgetManifest),
    );

    expect(sourceFiles(captured!).map(({ path }) => path)).toEqual([
      'main.js',
      'styles/main.css',
      'styles/theme.css',
      'pixel.png',
    ]);
    expect(result.uiArtifact.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'CAPSULE_EXTERNAL_DISTRIBUTION_INGESTED',
    }));
  });

  test('infers native Shadow CSS from declared CSS roots', async () => {
    const sourceSnapshot = snapshot([
      { path: 'ui/main.ts', value: 'import "./styles.css";' },
      {
        path: 'ui/styles.css',
        value: '.placeholder { color: red; }',
      },
    ]);
    const modernCss = [
      ':root { --accent: #123456; }',
      '.counter {',
      '  container-type: inline-size;',
      '  display: grid;',
      '  inline-size: clamp(12rem, 60vi, 42rem);',
      '  padding-inline: max(1rem, 2vi);',
      '  color: var(--accent, CanvasText);',
      '  background: linear-gradient(Canvas, CanvasText);',
      '  font-variant-numeric: tabular-nums;',
      '  transition: opacity 120ms ease;',
      '}',
      '.counter button { font: inherit; }',
      '@media (min-width: 20rem) { .counter { display: flex; } }',
      '@container (min-width: 12rem) { .counter { gap: min(2vi, 1rem); } }',
      '@supports (display: grid) { .counter { display: grid; } }',
      '@keyframes pulse { from { opacity: .5 } to { opacity: 1 } }',
    ].join('\n');
    const distribution = (
      css: string,
    ): TWidgetArtifactBuilderCapsuleConfig['distributionBuild'] => async (value) => ({
        kind: 'external-distribution',
        snapshot: {
          files: [
            {
              path: 'main.js',
              bytes: encoder.encode('document.body.className = "counter";'),
            },
            {
              path: 'assets/main.css',
              bytes: encoder.encode(css),
            },
          ],
        },
        entry: 'main.js',
        cssRoots: ['assets/main.css'],
        producer: {
          name: 'test',
          version: '1',
          digest: `sha256:${'1'.repeat(64)}`,
        },
        sourceRevision: value.sourceRevision,
        dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
        buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
      });
    const distributionBuild = distribution(modernCss);
    const artifactBuilder = builder({
      tempRoot: join(tmpdir(), 'capsule-boundary-unused'),
      distributionBuild,
      capsuleBuild: buildCapsuleGuest,
    });
    const nativeManifest = manifest({ entry: 'ui/main.ts' });

    const result = await artifactBuilder.build(
      request(sourceSnapshot, nativeManifest),
    );

    expect(result.uiArtifact.runtimeDescriptor.apiContract.groups).toEqual(['DOM']);
  });

  test('replaces the exact manifest server entry with named proxies and withholds private source', async () => {
    let captured: CapsuleApiGroupBuildRequest | undefined;
    const tempRoot = await mkdtemp(join(tmpdir(), 'capsule-boundary-server-'));
    try {
      const sourceSnapshot = snapshot([
        {
          path: 'ui/main.ts',
          value: [
            'import { fnHello } from "../server/main.server";',
            'import { sharedValue } from "../shared/model.shared";',
            'void fnHello; void sharedValue;',
          ].join('\n'),
        },
        {
          path: 'server/main.server.ts',
          value: [
            'import "./private.server";',
            'import { sharedValue } from "../shared/model.shared";',
            'export function fnHello(value: unknown): unknown { return { value, sharedValue }; }',
          ].join('\n'),
        },
        {
          path: 'server/private.server.ts',
          value: 'const serverSecret = "must-not-reach-capsule"; void serverSecret;',
        },
        {
          path: 'server/unreachable.server.ts',
          value: 'export const unreachableServerSecret = "also-private";',
        },
        {
          path: 'shared/model.shared.ts',
          value: 'export const sharedValue = 1;',
        },
      ]);
      const widgetManifest = manifest({
        entry: 'ui/main.ts',
        serverEntry: 'server/main.server.ts',
      });
      const artifactBuilder = builder({
        tempRoot,
        descriptors: Object.freeze([FN_HELLO_DESCRIPTOR]),
        capsuleBuild: async (value) => {
          captured = value;
          return EMPTY_CAPSULE_OUTPUT;
        },
      });

      const result = await artifactBuilder.build(
        request(sourceSnapshot, widgetManifest),
      );

      const files = sourceFiles(captured!);
      expect(files.map(({ path }) => path)).toEqual([
        'shared/model.shared.ts',
        'ui/main.ts',
        'server/main.server.ts',
      ]);
      const byPath = new Map(files.map((file) => [file.path, decoder.decode(file.bytes)]));
      expect(byPath.get('server/main.server.ts')).toContain(
        'createServerFunctionProxy',
      );
      expect(byPath.get('server/main.server.ts')).toContain(
        'export const fnHello',
      );
      expect([...byPath.values()].join('\n')).not.toContain('must-not-reach-capsule');
      expect([...byPath.values()].join('\n')).not.toContain('also-private');
      expect([...byPath.values()].join('\n')).not.toContain(
        'function fnHello(value: unknown)',
      );
      expect([...byPath.values()].join('\n')).not.toContain('registerServerFunction');
      const browserFunctionDescriptors = fnProjectWidgetBrowserFunctionDescriptors(
        result.functionDescriptors,
      );
      const browserDigestSha256 = createHash('sha256')
        .update(fnCanonicalizeWidgetBrowserFunctionDescriptors(browserFunctionDescriptors))
        .digest('hex');
      const serverDigestSha256 = createHash('sha256')
        .update(fnCanonicalizeWidgetServerFunctionDescriptors(result.functionDescriptors))
        .digest('hex');
      expect(result.functionDescriptorsDigestSha256).toBe(serverDigestSha256);
      expect(browserDigestSha256).not.toBe(serverDigestSha256);
      expect(captured!.capabilityRequests).toEqual([{
        id: `omnidraw.widget.functions.h${serverDigestSha256}`,
        versionRange: '1.0.0',
        contractHash: `sha256:${serverDigestSha256}`,
        required: true,
        operations: ['fnHello'],
      }]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('constructs full-stack outputs once and signs exact Preview and release envelopes', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'capsule-construction-'));
    let distributionBuildCalls = 0;
    let capsuleBuildCalls = 0;
    let serverBuildCalls = 0;
    let signingCalls = 0;
    const previewKey = Object.freeze({
      keyId: 'capsule-preview-key',
      privateKey: {} as CryptoKey,
    }) satisfies CapsuleArtifactSigningKey;
    const releaseKey = Object.freeze({
      keyId: 'capsule-release-key',
      privateKey: {} as CryptoKey,
    }) satisfies CapsuleArtifactSigningKey;
    const countedBunBuild = (async (
      options: Parameters<typeof Bun.build>[0],
    ) => {
      serverBuildCalls += 1;
      return await Bun.build(options);
    }) as typeof Bun.build;
    try {
      const sourceSnapshot = snapshot([
        {
          path: 'ui/main.ts',
          value: [
            'import { fnHello } from "../server/functions.server";',
            'void fnHello;',
          ].join('\n'),
        },
        {
          path: 'server/entry.ts',
          value: 'import "./functions.server";',
        },
        {
          path: 'server/functions.server.ts',
          value: 'export function fnHello(value: unknown): unknown { return value; }',
        },
      ]);
      const widgetManifest = manifest({
        entry: 'ui/main.ts',
        serverEntry: 'server/entry.ts',
      });
      const artifactBuilder = builder({
        tempRoot,
        descriptors: Object.freeze([FN_HELLO_DESCRIPTOR]),
        bunBuild: countedBunBuild,
        distributionBuild: async (value) => {
          distributionBuildCalls += 1;
          return Object.freeze({
            kind: 'external-distribution',
            snapshot: Object.freeze({
              files: Object.freeze([Object.freeze({
                path: 'main.js',
                bytes: new Uint8Array([1, 2, 3]),
              })]),
            }),
            entry: 'main.js',
            producer: Object.freeze({
              name: 'construction-test',
              version: '1',
              digest: `sha256:${'1'.repeat(64)}`,
            }),
            sourceRevision: value.sourceRevision,
            dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
            buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
          });
        },
        capsuleBuild: async () => {
          capsuleBuildCalls += 1;
          return EMPTY_CAPSULE_OUTPUT;
        },
        loadSigningKeys: async (purpose) => Object.freeze([
          purpose === 'preview' ? previewKey : releaseKey,
        ]),
        capsuleSign: async (unsignedBytes, keys) => {
          signingCalls += 1;
          return new Uint8Array([
            ...unsignedBytes,
            ...encoder.encode(keys[0]!.keyId),
          ]);
        },
      });
      const buildRequest = request(sourceSnapshot, widgetManifest);
      const construction = await artifactBuilder.construct({
        snapshot: buildRequest.snapshot,
        manifest: buildRequest.manifest,
        canonicalManifestJson: buildRequest.canonicalManifestJson,
        builderIdentity: buildRequest.builderIdentity,
        capsuleBuildIdentity: buildRequest.capsuleBuildIdentity,
        buildPolicyId: buildRequest.buildPolicyId,
      });

      expect(distributionBuildCalls).toBe(1);
      expect(capsuleBuildCalls).toBe(1);
      expect(serverBuildCalls).toBe(1);
      expect(construction.sourceArtifact.kind).toBe('source');
      expect(construction.sourceArtifact.digestSha256)
        .toBe(sha256(construction.sourceArtifact.bytes));
      expect(construction.uiArtifact.digestSha256)
        .toBe(sha256(construction.uiArtifact.unsignedBytes));
      expect(construction.distributionFiles).toEqual([{
        path: 'main.js',
        bytes: new Uint8Array([1, 2, 3]),
      }]);
      expect(construction.distributionProvenance).toEqual({
        kind: 'external-distribution',
        producer: {
          name: 'construction-test',
          version: '1',
          digest: `sha256:${'1'.repeat(64)}`,
        },
        sourceRevision: sourceSnapshot.digestSha256,
        dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
        buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
      });
      expect(construction.constructionContractDigestSha256)
        .toMatch(/^[0-9a-f]{64}$/);

      const preview = await artifactBuilder.signConstruction({
        construction,
        signingPurpose: 'preview',
      });
      const release = await artifactBuilder.signConstruction({
        construction,
        signingPurpose: 'release',
      });

      expect(distributionBuildCalls).toBe(1);
      expect(capsuleBuildCalls).toBe(1);
      expect(serverBuildCalls).toBe(1);
      expect(signingCalls).toBe(2);
      expect(preview.sourceSnapshotId).toBe(construction.sourceSnapshotId);
      expect(release.sourceSnapshotId).toBe(construction.sourceSnapshotId);
      expect(preview.sourceDigestSha256).toBe(construction.sourceDigestSha256);
      expect(release.sourceDigestSha256).toBe(construction.sourceDigestSha256);
      expect(preview.uiArtifact.artifactHash)
        .toBe(construction.uiArtifact.artifactHash);
      expect(release.uiArtifact.artifactHash)
        .toBe(construction.uiArtifact.artifactHash);
      expect(preview.serverArtifact?.bytes).toEqual(construction.serverArtifact?.bytes);
      expect(release.serverArtifact?.bytes).toEqual(construction.serverArtifact?.bytes);
      expect(preview.functionDescriptors).toEqual(construction.functionDescriptors);
      expect(release.functionDescriptors).toEqual(construction.functionDescriptors);
      expect(preview.uiArtifact.runtimeDescriptor.signatureKeyIds)
        .toEqual([previewKey.keyId]);
      expect(release.uiArtifact.runtimeDescriptor.signatureKeyIds)
        .toEqual([releaseKey.keyId]);
      expect(preview.uiArtifact.bytes).not.toEqual(release.uiArtifact.bytes);
      expect(preview.contractDigestSha256).not.toBe(release.contractDigestSha256);

      const unsignedBytes = new Uint8Array(construction.uiArtifact.unsignedBytes);
      unsignedBytes[0] = (unsignedBytes[0] ?? 0) ^ 0xff;
      await expect(artifactBuilder.signConstruction({
        construction: {
          ...construction,
          uiArtifact: { ...construction.uiArtifact, unsignedBytes },
        },
        signingPurpose: 'release',
      })).rejects.toThrow();
      await expect(artifactBuilder.signConstruction({
        construction: {
          ...construction,
          distributionProvenance: {
            ...construction.distributionProvenance,
            dependencyLockDigest: `sha256:${'9'.repeat(64)}`,
          },
        },
        signingPurpose: 'release',
      })).rejects.toThrow();
      const sourceBytes = new Uint8Array(construction.sourceArtifact.bytes);
      sourceBytes[sourceBytes.byteLength - 1] = (
        sourceBytes[sourceBytes.byteLength - 1] ?? 0
      ) ^ 0xff;
      await expect(artifactBuilder.signConstruction({
        construction: {
          ...construction,
          sourceArtifact: { ...construction.sourceArtifact, bytes: sourceBytes },
        },
        signingPurpose: 'release',
      })).rejects.toThrow();
      const serverBytes = new Uint8Array(construction.serverArtifact!.bytes);
      serverBytes[0] = (serverBytes[0] ?? 0) ^ 0xff;
      await expect(artifactBuilder.signConstruction({
        construction: {
          ...construction,
          serverArtifact: { ...construction.serverArtifact!, bytes: serverBytes },
        },
        signingPurpose: 'release',
      })).rejects.toThrow();
      expect(signingCalls).toBe(2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
