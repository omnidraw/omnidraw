import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type {
  TWidgetBuildEnvironment,
  TWidgetExecutableInputFile,
  TWidgetManifestV1,
} from '@omnidraw/sdk/contract';
import {
  ZWidgetManifestV1,
  fnCanonicalizeWidgetExecutableInput,
  fnClassifyWidgetChange,
  fnNormalizeWidgetFilesystemRelativePath,
  fnProjectWidgetExecutableManifest,
  fnProjectWidgetPresentation,
  fnWidgetExecutableInputDigest,
  fnWidgetExecutableManifestDigest,
  parseWidgetManifestV1Json,
} from '@omnidraw/sdk/contract';
import { CAPSULE_BUILD_IDENTITY } from './capsule.fixture';

const digestString = (value: string): string => createHash('sha256').update(value).digest('hex');
const digestBytes = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const MANIFEST: TWidgetManifestV1 = Object.freeze({
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
  schemaVersion: 1,
  name: 'Counter',
  slug: 'counter',
  description: 'A shared counter.',
  tool: Object.freeze({
    label: 'Counter',
    icon: Object.freeze({ lucidIcon: 'Gauge' }),
    group: 'utilities',
    priority: 0,
  }),
  ui: Object.freeze({
    runtime: 'capsule',
    entry: 'ui/main.ts',
    apis: Object.freeze(['DOM'] as const),
    budgets: Object.freeze({ cpuMs: 20, memoryBytes: 33_554_432 }),
    state: Object.freeze({ collaborative: true, localStore: 'none' as const }),
    parkability: Object.freeze({ enabled: false as const }),
  }),
  resources: Object.freeze([]),
});

const ENVIRONMENT: TWidgetBuildEnvironment = Object.freeze({
  packageManager: Object.freeze({
    name: 'npm',
    version: '11.0.0',
    lockfile: 'package-lock.json',
    lockFormat: '3',
  }),
  sdkVersion: '0.6.0',
  importMapDigestSha256: '1'.repeat(64),
  transformsDigestSha256: '2'.repeat(64),
  runner: Object.freeze({ kind: 'isolated' as const, identity: 'runner@sha256:fixture' }),
  platform: Object.freeze({ os: 'linux', architecture: 'x64' }),
  capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
  buildPolicyId: 'widget-build-v1',
  signingPolicyId: 'release-signing-v1',
});

const FILES: readonly TWidgetExecutableInputFile[] = Object.freeze([
  Object.freeze({ path: 'package.json', bytes: bytes('{"scripts":{"build":"vite build"}}') }),
  Object.freeze({ path: 'package-lock.json', bytes: bytes('{"lockfileVersion":3}') }),
  Object.freeze({ path: 'ui/main.ts', bytes: bytes('document.body.textContent = "ok"') }),
]);

function classify(
  next: TWidgetManifestV1,
  nextFiles: readonly TWidgetExecutableInputFile[] = FILES,
  nextEnvironment: TWidgetBuildEnvironment = ENVIRONMENT,
) {
  return fnClassifyWidgetChange({
    previous: { manifest: MANIFEST, files: FILES, environment: ENVIRONMENT },
    next: { valid: true, manifest: next, files: nextFiles, environment: nextEnvironment },
  });
}

describe('portable widget manifest v1', () => {
  test('strictly parses, normalizes, and separates presentation from executable facts', () => {
    const parsed = ZWidgetManifestV1.parse({
      ...MANIFEST,
      name: '  Counter  ',
      tool: { ...MANIFEST.tool, label: '  Counter tool  ' },
      ui: { ...MANIFEST.ui, apis: ['DOM'] },
    });
    expect(parsed.name).toBe('Counter');
    expect(parsed.tool.label).toBe('Counter tool');
    expect(fnProjectWidgetPresentation(parsed)).toEqual({
      $schema: MANIFEST.$schema,
      name: 'Counter',
      description: MANIFEST.description,
      tool: { ...parsed.tool, icon: parsed.tool.icon ?? null },
    });
    expect(fnProjectWidgetPresentation(parsed)).not.toHaveProperty('slug');
    expect(fnProjectWidgetExecutableManifest(parsed)).toEqual({
      schemaVersion: 1,
      ui: parsed.ui,
      server: null,
      resources: [],
    });
    expect(fnProjectWidgetExecutableManifest(parsed)).not.toHaveProperty('name');
    expect(parseWidgetManifestV1Json(JSON.stringify(parsed))).toEqual(parsed);
  });

  test('rejects retired versions, unknown fields, unsafe paths, and bad portable identity', () => {
    const retiredVersions = [1 + 2, 1 + 3];
    const invalid = [
      ...retiredVersions.map((schemaVersion) => ({ ...MANIFEST, schemaVersion })),
      { ...MANIFEST, $schema: MANIFEST.$schema.replace('/v1.', '/v9.') },
      { ...MANIFEST, $schema: 'https://example.test/widget.json' },
      { ...MANIFEST, extra: true },
      { ...MANIFEST, slug: 'Counter' },
      { ...MANIFEST, slug: '-counter' },
      { ...MANIFEST, description: '' },
      { ...MANIFEST, tool: { ...MANIFEST.tool, group: 'Utilities' } },
      { ...MANIFEST, tool: { ...MANIFEST.tool, priority: 1_001 } },
      { ...MANIFEST, tool: { ...MANIFEST.tool, unknown: true } },
      { ...MANIFEST, ui: { ...MANIFEST.ui, entry: '../main.ts' } },
      { ...MANIFEST, ui: { ...MANIFEST.ui, entry: '/tmp/main.ts' } },
      { ...MANIFEST, ui: { ...MANIFEST.ui, entry: 'C:/main.ts' } },
      { ...MANIFEST, ui: { ...MANIFEST.ui, entry: 'ui\\main.ts' } },
      { ...MANIFEST, ui: { ...MANIFEST.ui, entry: 'ui/ma\nin.ts' } },
      { ...MANIFEST, server: { entry: 'server/main.ts', runtimeAbi: 'bun-v1' } },
    ];
    for (const candidate of invalid) expect(ZWidgetManifestV1.safeParse(candidate).success).toBe(false);
    expect(ZWidgetManifestV1.parse({
      ...MANIFEST,
      server: { entry: 'server/main.ts' },
    }).server).toEqual({ entry: 'server/main.ts' });
  });

  test('bounds and shape-checks icons while retaining render-time sanitization as a separate edge', () => {
    for (const svgIcon of [
      'ab',
      '<svg><script>alert(1)</script></svg>',
      '<svg onclick="alert(1)"></svg>',
      '<svg><image href="https://example.test/x" /></svg>',
      '😀'.repeat(4_097),
    ]) {
      expect(ZWidgetManifestV1.safeParse({
        ...MANIFEST,
        tool: { ...MANIFEST.tool, icon: { svgIcon } },
      }).success).toBe(false);
    }
    expect(ZWidgetManifestV1.parse({
      ...MANIFEST,
      tool: { ...MANIFEST.tool, icon: { svgIcon: '👨‍👩‍👧‍👦' } },
    }).tool.icon).toEqual({ svgIcon: '👨‍👩‍👧‍👦' });
    expect(ZWidgetManifestV1.parse({
      ...MANIFEST,
      tool: { ...MANIFEST.tool, icon: { svgIcon: '<svg viewBox="0 0 1 1"></svg>' } },
    }).tool.icon).toEqual({ svgIcon: '<svg viewBox="0 0 1 1"></svg>' });
    expect(ZWidgetManifestV1.safeParse({
      ...MANIFEST,
      tool: { ...MANIFEST.tool, icon: { lucidIcon: 'NotAPinnedLucideIcon' } },
    }).success).toBe(false);
  });

  test('rejects duplicate and invalid resource contracts', () => {
    const resource = { slot: 'todos', kind: 'kv' as const, effect: 'read_write' as const, required: true };
    expect(ZWidgetManifestV1.safeParse({ ...MANIFEST, resources: [resource, resource] }).success)
      .toBe(false);
    expect(ZWidgetManifestV1.safeParse({
      ...MANIFEST,
      resources: [{ ...resource, arbitrarySql: true }],
    }).success).toBe(false);
    expect(ZWidgetManifestV1.parse({
      ...MANIFEST,
      resources: [{ ...resource, resourceId: '4c884964-1ddb-4be7-af8d-4b3e095fcf47' }],
    }).resources?.[0]?.resourceId).toBe('4c884964-1ddb-4be7-af8d-4b3e095fcf47');
    for (const resourceId of ['', ' has-space', 'has/slash', 'x'.repeat(129)]) {
      expect(ZWidgetManifestV1.safeParse({
        ...MANIFEST,
        resources: [{ ...resource, resourceId }],
      }).success).toBe(false);
    }
  });

  test('normalizes declared database JSON result columns and rejects invalid declarations', () => {
    const database = {
      slot: 'data',
      kind: 'db' as const,
      effect: 'read' as const,
      required: true,
      operations: {
        readJson: {
          effect: 'read' as const,
          sql: 'SELECT :value AS payload, :value AS metadata',
          parameters: { value: { type: 'json' as const } },
          result: 'rows' as const,
          jsonColumns: ['payload', 'metadata'],
        },
      },
    };
    expect(ZWidgetManifestV1.parse({ ...MANIFEST, resources: [database] })
      .resources?.[0]?.operations?.readJson?.jsonColumns).toEqual(['metadata', 'payload']);
    for (const jsonColumns of [[], ['payload', 'payload']]) {
      expect(ZWidgetManifestV1.safeParse({
        ...MANIFEST,
        resources: [{
          ...database,
          operations: {
            readJson: { ...database.operations.readJson, jsonColumns },
          },
        }],
      }).success).toBe(false);
    }
    expect(ZWidgetManifestV1.safeParse({
      ...MANIFEST,
      resources: [{
        ...database,
        operations: {
          writeJson: {
            effect: 'read',
            sql: 'SELECT 1',
            result: 'execute',
            jsonColumns: ['payload'],
          },
        },
      }],
    }).success).toBe(false);
  });
});

describe('canonical widget change classification', () => {
  test('classifies every presentation field without changing executable identity', () => {
    const mutations: readonly TWidgetManifestV1[] = [
      { ...MANIFEST, name: 'Renamed counter' },
      { ...MANIFEST, description: 'Changed description.' },
      { ...MANIFEST, tool: { ...MANIFEST.tool, label: 'Changed label' } },
      { ...MANIFEST, tool: { ...MANIFEST.tool, icon: { lucidIcon: 'Activity' } } },
      { ...MANIFEST, tool: { ...MANIFEST.tool, group: 'data' } },
      { ...MANIFEST, tool: { ...MANIFEST.tool, priority: 5 } },
    ];
    const baseline = fnWidgetExecutableManifestDigest({ manifest: MANIFEST, digestSha256: digestString });
    for (const manifest of mutations) {
      expect(classify(manifest).class).toBe('presentation-only');
      expect(fnWidgetExecutableManifestDigest({ manifest, digestSha256: digestString })).toBe(baseline);
    }
  });

  test('classifies identity, resource, runtime, dependency, unknown, environment, and invalid changes', () => {
    expect(classify({ ...MANIFEST, slug: 'counter-two' }).class).toBe('identity');
    expect(classify({
      ...MANIFEST,
      resources: [{ slot: 'todos', kind: 'kv', effect: 'read', required: true }],
    }).class).toBe('resource-contract');
    const bound = {
      ...MANIFEST,
      resources: [{
        slot: 'todos',
        kind: 'kv' as const,
        effect: 'read' as const,
        required: true,
        resourceId: 'resource-a',
      }],
    };
    expect(fnClassifyWidgetChange({
      previous: {
        manifest: { ...bound, resources: [{ ...bound.resources[0]!, resourceId: 'resource-a' }] },
        files: FILES,
        environment: ENVIRONMENT,
      },
      next: {
        valid: true,
        manifest: { ...bound, resources: [{ ...bound.resources[0]!, resourceId: 'resource-b' }] },
        files: FILES,
        environment: ENVIRONMENT,
      },
    }).class).toBe('resource-binding');
    expect(fnWidgetExecutableManifestDigest({
      manifest: { ...bound, resources: [{ ...bound.resources[0]!, resourceId: 'resource-a' }] },
      digestSha256: digestString,
    })).toBe(fnWidgetExecutableManifestDigest({
      manifest: { ...bound, resources: [{ ...bound.resources[0]!, resourceId: 'resource-b' }] },
      digestSha256: digestString,
    }));
    expect(classify({
      ...MANIFEST,
      ui: { ...MANIFEST.ui, budgets: { ...MANIFEST.ui.budgets, cpuMs: 21 } },
    }).class).toBe('executable');
    expect(classify(MANIFEST, FILES.map((file) => (
      file.path === 'package-lock.json' ? { ...file, bytes: bytes('changed lock') } : file
    ))).class).toBe('dependency');
    expect(classify(MANIFEST, [...FILES, { path: 'README.md', bytes: bytes('changed') }]).class)
      .toBe('ambiguous');
    expect(classify(MANIFEST, FILES, { ...ENVIRONMENT, signingPolicyId: 'rotated' }).class)
      .toBe('ambiguous');
    expect(fnClassifyWidgetChange({
      previous: { manifest: MANIFEST },
      next: { valid: false, reason: 'bad schema URL' },
    })).toEqual({ class: 'invalid', changedPaths: [], reason: 'bad schema URL' });
  });

  test('uses exact file bytes and ignores the authored manifest as a build input', () => {
    const previous = [...FILES, { path: 'omnidraw.json', bytes: bytes('{"name":"old"}') }];
    const next = [...FILES, { path: 'omnidraw.json', bytes: bytes('{"name":"new"}') }];
    expect(fnClassifyWidgetChange({
      previous: { manifest: MANIFEST, files: previous, environment: ENVIRONMENT },
      next: { valid: true, manifest: { ...MANIFEST, name: 'New' }, files: next, environment: ENVIRONMENT },
    }).class).toBe('presentation-only');
    expect(classify(MANIFEST, FILES.map((file) => ({ ...file, bytes: file.bytes.slice() }))).class)
      .toBe('presentation-only');
  });
});

describe('executable input digest', () => {
  test('is stable across file order and presentation edits', () => {
    const baseline = fnWidgetExecutableInputDigest({
      manifest: MANIFEST,
      files: FILES,
      environment: ENVIRONMENT,
      digestSha256: digestBytes,
    });
    expect(fnWidgetExecutableInputDigest({
      manifest: { ...MANIFEST, name: 'Presentation changed' },
      files: [...FILES].reverse(),
      environment: ENVIRONMENT,
      digestSha256: digestBytes,
    })).toBe(baseline);
  });

  test('changes for exact bytes, runtime, resources, toolchain, runner, platform, Capsule, and policy', () => {
    const baseline = fnWidgetExecutableInputDigest({
      manifest: MANIFEST,
      files: FILES,
      environment: ENVIRONMENT,
      digestSha256: digestBytes,
    });
    const cases = [
      { manifest: MANIFEST, files: [...FILES, { path: 'shared/new.ts', bytes: bytes('x') }], environment: ENVIRONMENT },
      { manifest: { ...MANIFEST, ui: { ...MANIFEST.ui, apis: ['DOM', 'NETWORK'] as const } }, files: FILES, environment: ENVIRONMENT },
      { manifest: { ...MANIFEST, resources: [{ slot: 'data', kind: 'kv' as const, effect: 'read' as const }] }, files: FILES, environment: ENVIRONMENT },
      { manifest: MANIFEST, files: FILES, environment: { ...ENVIRONMENT, sdkVersion: 'next' } },
      { manifest: MANIFEST, files: FILES, environment: { ...ENVIRONMENT, runner: { kind: 'host' as const, identity: 'trusted-local' } } },
      { manifest: MANIFEST, files: FILES, environment: { ...ENVIRONMENT, platform: { os: 'darwin', architecture: 'arm64' } } },
      { manifest: MANIFEST, files: FILES, environment: { ...ENVIRONMENT, buildPolicyId: 'next-policy' } },
      { manifest: MANIFEST, files: FILES, environment: { ...ENVIRONMENT, signingPolicyId: 'rotated-key-policy' } },
    ];
    for (const candidate of cases) {
      expect(fnWidgetExecutableInputDigest({ ...candidate, digestSha256: digestBytes })).not.toBe(baseline);
    }
  });

  test('uses a bounded binary framing and rejects excluded, unsafe, duplicate, and oversized files', () => {
    const framed = fnCanonicalizeWidgetExecutableInput({ manifest: MANIFEST, files: FILES, environment: ENVIRONMENT });
    expect(framed).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(framed.slice(0, 37))).toContain('omnidraw.widget-executable-input.v1');
    for (const files of [
      [{ path: 'omnidraw.json', bytes: bytes('{}') }],
      [{ path: '../escape.ts', bytes: bytes('') }],
      [{ path: 'ui/a.ts', bytes: bytes('') }, { path: 'ui/a.ts', bytes: bytes('') }],
      [{ path: 'ui/huge.ts', bytes: new Uint8Array(4 * 1_024 * 1_024 + 1) }],
    ]) {
      expect(() => fnCanonicalizeWidgetExecutableInput({ manifest: MANIFEST, files, environment: ENVIRONMENT })).toThrow();
    }
    expect(fnNormalizeWidgetFilesystemRelativePath('ui/main.ts')).toBe('ui/main.ts');
    expect(fnNormalizeWidgetFilesystemRelativePath('ui/../main.ts')).toBeNull();
  });
});
