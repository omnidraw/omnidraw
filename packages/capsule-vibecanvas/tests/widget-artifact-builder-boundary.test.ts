import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCapsuleGuest,
  type CapsuleBuildOutput,
  type CapsuleBuildRequest,
} from '@omnidraw/capsule/build';
import {
  CAPSULE_ARTIFACT_RESOURCES_PROFILE,
  CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
  CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
  type CapsuleBuildInput,
} from '@omnidraw/capsule/protocol';
import type { CapsuleArtifactSigningKey } from '@omnidraw/capsule/sign';
import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnProjectWidgetBrowserFunctionDescriptors,
  type TWidgetBuildRequest,
  type TWidgetCapsuleBuildIdentity,
  type TWidgetManifestV3,
  type TWidgetServerFunctionDescriptor,
  type TWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract';
import {
  VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
  WidgetArtifactBuilderCapsule,
  type TWidgetArtifactBuilderCapsuleConfig,
} from '../src/build';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BUILDER_IDENTITY = 'capsule-boundary-test';
const CAPSULE_ARTIFACT_HASH =
  `sha256:${'a'.repeat(64)}` as const;
const CAPSULE_BUILD_IDENTITY: TWidgetCapsuleBuildIdentity = Object.freeze({
  packageName: '@omnidraw/capsule',
  packageVersion: '0.9.4',
  packageDigest: `sha256:${'b'.repeat(64)}`,
  buildApiVersion: '0.1.0',
  runtimeBuildDigest: `sha256:${'c'.repeat(64)}`,
});
const SIGNING_KEY = Object.freeze({
  keyId: 'capsule-boundary-test-key',
  privateKey: {} as CryptoKey,
}) satisfies CapsuleArtifactSigningKey;
const TENANT = Object.freeze({
  orgId: 'capsule-boundary-org',
  accountId: 'capsule-boundary-account',
  cellId: 'capsule-boundary-cell',
  placementEpoch: 1,
  roles: Object.freeze([]),
  capabilities: Object.freeze([]),
  requestId: 'capsule-boundary-request',
}) satisfies TTenantContext;
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
  retry: Object.freeze({
    mode: 'none',
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
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
    id: `capsule-boundary-${digestSha256}`,
    digestSha256,
    files: Object.freeze(normalized),
    createdAtMs: 0,
  });
}

function manifest(args: Readonly<{
  entry: string;
  featureProfiles?: readonly string[];
  serverEntry?: string;
}>): TWidgetManifestV3 {
  return Object.freeze({
    schemaVersion: 3,
    name: 'Capsule boundary fixture',
    slug: 'capsule-boundary-fixture',
    ui: Object.freeze({
      runtime: 'capsule',
      entry: args.entry,
      target: Object.freeze({
        runtimeAbi: 'quickjs-release-sync-v1',
        domProfile: 'dom-core-v2',
        featureProfiles: Object.freeze([...(args.featureProfiles ?? [])]),
      }),
    }),
    ...(args.serverEntry === undefined
      ? {}
      : {
          server: Object.freeze({
            entry: args.serverEntry,
            runtimeAbi: 'bun-v1',
          }),
        }),
  });
}

function request(
  sourceSnapshot: TWidgetSourceSnapshot,
  widgetManifest: TWidgetManifestV3,
): TWidgetBuildRequest {
  return Object.freeze({
    snapshot: sourceSnapshot,
    manifest: widgetManifest,
    canonicalManifestJson: fnCanonicalizeWidgetManifest(widgetManifest),
    builderIdentity: BUILDER_IDENTITY,
    capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    buildPolicyId: VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
    signingPurpose: 'preview',
  });
}

function builder(args: Readonly<{
  tempRoot: string;
  capsuleBuild(request: CapsuleBuildRequest): Promise<
    Pick<CapsuleBuildOutput, 'artifactBytes' | 'artifactHash' | 'diagnostics'>
  >;
  descriptors?: readonly TWidgetServerFunctionDescriptor[];
  bunBuild?: typeof Bun.build;
  distributionBuild?: TWidgetArtifactBuilderCapsuleConfig['distributionBuild'];
}>): WidgetArtifactBuilderCapsule {
  return new WidgetArtifactBuilderCapsule({
    tempRoot: args.tempRoot,
    builderIdentity: BUILDER_IDENTITY,
    capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    buildPolicyId: VIBECANVAS_CAPSULE_BUILD_POLICY_ID,
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
    async loadSigningKeys() {
      return Object.freeze([SIGNING_KEY]);
    },
    capsuleSign: async (bytes) => new Uint8Array(bytes),
    ...(args.bunBuild === undefined ? {} : { bunBuild: args.bunBuild }),
  });
}

function sourceFiles(requestValue: CapsuleBuildRequest): readonly Readonly<{
  path: string;
  bytes: Uint8Array;
}>[] {
  return requestValue.input.snapshot.files;
}

describe('WidgetArtifactBuilderCapsule trust boundary', () => {
  test('forwards hostile UI syntax unchanged only to the injected Capsule build port', async () => {
    let captured: CapsuleBuildRequest | undefined;
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

    await artifactBuilder.build(TENANT, request(sourceSnapshot, widgetManifest));

    expect(bunBuildCalls).toBe(0);
    expect(captured).toBeDefined();
    const files = sourceFiles(captured!);
    expect(files.map(({ path }) => path)).toEqual(['ui/main.ts', 'ui/styles.css']);
    expect(decoder.decode(files[0]!.bytes)).toBe(hostileTypeScript);
    expect(decoder.decode(files[1]!.bytes)).toBe(hostileCss);
  });

  test('lets Capsule close CSS imports and URL assets from the immutable source snapshot', async () => {
    let captured: CapsuleBuildRequest | undefined;
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
    const widgetManifest = manifest({
      entry: 'ui/main.ts',
      featureProfiles: [CAPSULE_ARTIFACT_RESOURCES_PROFILE],
    });
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
        expect(value.target.featureProfiles).toEqual([
          CAPSULE_ARTIFACT_RESOURCES_PROFILE,
        ]);
        return await buildCapsuleGuest(value);
      },
    });

    const result = await artifactBuilder.build(
      TENANT,
      request(sourceSnapshot, widgetManifest),
    );

    expect(sourceFiles(captured!).map(({ path }) => path)).toEqual([
      'main.js',
      'styles/main.css',
      'styles/theme.css',
      'pixel.png',
    ]);
    expect(result.uiArtifact.capsuleArtifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'CAPSULE_EXTERNAL_DISTRIBUTION_INGESTED',
    }));
  });

  test('adopts native Shadow CSS and separately signed browser image URLs', async () => {
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
      '  background-image: url("https://images.example.test/counter.png");',
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
    const nativeManifest = manifest({
      entry: 'ui/main.ts',
      featureProfiles: [
        CAPSULE_ARTIFACT_RESOURCES_PROFILE,
        CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
        CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
      ],
    });

    const result = await artifactBuilder.build(
      TENANT,
      request(sourceSnapshot, nativeManifest),
    );

    expect(result.uiArtifact.runtimeDescriptor.target.featureProfiles).toEqual([
      CAPSULE_ARTIFACT_RESOURCES_PROFILE,
      CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
      CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
    ]);

    const conservativeManifest = manifest({
      entry: 'ui/main.ts',
      featureProfiles: [CAPSULE_ARTIFACT_RESOURCES_PROFILE],
    });
    await expect(artifactBuilder.build(
      TENANT,
      request(sourceSnapshot, conservativeManifest),
    )).rejects.toMatchObject({
      code: 'WIDGET_BUILD_FAILED',
      diagnostic: {
        code: 'CSS_PROFILE_REQUIRED',
        path: 'app/assets/main.css',
        requiredProfile: CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
      },
    });

    const localOnlyManifest = manifest({
      entry: 'ui/main.ts',
      featureProfiles: [
        CAPSULE_ARTIFACT_RESOURCES_PROFILE,
        CAPSULE_SHADOW_BROWSER_CSS_PROFILE,
      ],
    });
    await expect(artifactBuilder.build(
      TENANT,
      request(sourceSnapshot, localOnlyManifest),
    )).rejects.toMatchObject({
      code: 'WIDGET_BUILD_FAILED',
      diagnostic: {
        code: 'CSS_PROFILE_REQUIRED',
        path: 'app/assets/main.css',
        requiredProfile: CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
      },
    });

    const substitutionBuilder = builder({
      tempRoot: join(tmpdir(), 'capsule-boundary-unused'),
      distributionBuild: distribution([
        ':root { --network-image: url("https://images.example.test/counter.png"); }',
        '.counter { background-image: var(--network-image); }',
      ].join('\n')),
      capsuleBuild: buildCapsuleGuest,
    });
    await expect(substitutionBuilder.build(
      TENANT,
      request(sourceSnapshot, nativeManifest),
    )).rejects.toMatchObject({
      code: 'WIDGET_BUILD_FAILED',
      diagnostic: {
        code: 'CSS_POLICY_DENIED',
        path: 'app/assets/main.css',
        construct: '--network-image: url()',
        activeCssProfile: CAPSULE_CSS_NETWORK_IMAGES_PROFILE,
      },
    });
  });

  test('replaces server-function modules with proxies and withholds all other server source', async () => {
    let captured: CapsuleBuildRequest | undefined;
    const tempRoot = await mkdtemp(join(tmpdir(), 'capsule-boundary-server-'));
    try {
      const sourceSnapshot = snapshot([
        {
          path: 'ui/main.ts',
          value: [
            'import { fnHello } from "../server/functions.server";',
            'import { sharedValue } from "../shared/model.shared";',
            'void fnHello; void sharedValue;',
          ].join('\n'),
        },
        {
          path: 'server/entry.ts',
          value: [
            'import "./functions.server";',
            'import "./private.server";',
            'import { sharedValue } from "../shared/model.shared";',
            'void sharedValue;',
          ].join('\n'),
        },
        {
          path: 'server/functions.server.ts',
          value: 'export function fnHello(value: unknown): unknown { return value; }',
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
        serverEntry: 'server/entry.ts',
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
        TENANT,
        request(sourceSnapshot, widgetManifest),
      );

      const files = sourceFiles(captured!);
      expect(files.map(({ path }) => path)).toEqual([
        'shared/model.shared.ts',
        'ui/main.ts',
        'server/functions.server.ts',
      ]);
      const byPath = new Map(files.map((file) => [file.path, decoder.decode(file.bytes)]));
      expect(byPath.get('server/functions.server.ts')).toContain(
        'createServerFunctionProxy',
      );
      expect(byPath.get('server/functions.server.ts')).toContain(
        'export const fnHello',
      );
      expect([...byPath.values()].join('\n')).not.toContain('must-not-reach-capsule');
      expect([...byPath.values()].join('\n')).not.toContain('also-private');
      expect([...byPath.values()].join('\n')).not.toContain(
        'function fnHello(value: unknown)',
      );
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
        id: `vibecanvas.widget.functions.h${browserDigestSha256}`,
        versionRange: '1.0.0',
        contractHash: `sha256:${browserDigestSha256}`,
        required: true,
        operations: ['fnHello'],
      }]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
