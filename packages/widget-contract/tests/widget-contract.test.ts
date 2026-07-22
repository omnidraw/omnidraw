import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  ZWidgetManifestV2,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnGenerateWidgetServerFunctionClientModule,
  fnNormalizeWidgetRelativePath,
  fnValidateWidgetResourceBindings,
  fnValidateWidgetServerFunctionDescriptors,
  fnWidgetManifestAllowsResource,
  fnWidgetRevisionArtifactsMatchManifest,
  type IWidgetArtifactBuilder,
  type IWidgetRevisionReader,
  type TWidgetBuildRequest,
  type TWidgetManifestV2,
  type TWidgetRevisionDescriptor,
} from '../src';
import { TEST_SERVER_FUNCTION_DESCRIPTOR } from './function-descriptor.fixture';

const tenant: TTenantContext = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-a',
};

const serverManifest: TWidgetManifestV2 = {
  schemaVersion: 2,
  name: 'Example',
  slug: 'example',
  ui: { entry: 'src/ui.tsx' },
  server: { entry: 'src/server.ts', runtimeAbi: 'vibecanvas:1' },
  resources: [{
    slot: 'preferences',
    kind: 'kv',
    effect: 'read',
    required: true,
  }],
};

const revision: TWidgetRevisionDescriptor = {
  orgId: 'org-a',
  id: 'revision-a',
  definitionId: 'definition-a',
  revisionNumber: 1,
  manifest: serverManifest,
  canonicalManifestJson: fnCanonicalizeWidgetManifest(serverManifest),
  functionDescriptors: [TEST_SERVER_FUNCTION_DESCRIPTOR],
  functionDescriptorsDigestSha256: 'functions-digest',
  contractDigestSha256: 'contract-digest',
  uiArtifact: {
    orgId: 'org-a',
    id: 'artifact-ui',
    kind: 'ui',
    digestSha256: 'ui-digest',
    byteSize: 100,
    retentionState: 'pinned',
    retainUntilMs: null,
    createdAtMs: 1,
  },
  serverArtifact: {
    orgId: 'org-a',
    id: 'artifact-server',
    kind: 'server',
    digestSha256: 'server-digest',
    byteSize: 200,
    retentionState: 'pinned',
    retainUntilMs: null,
    createdAtMs: 1,
  },
  createdAtMs: 1,
};

describe('strict widget manifest v2 schema', () => {
  test('accepts and normalizes a browser-only widget', () => {
    const parsed = ZWidgetManifestV2.parse({
      schemaVersion: 2,
      name: '  Browser only  ',
      slug: 'browser-only',
      ui: { entry: './src/ui.tsx' },
    });

    expect(parsed).toEqual({
      schemaVersion: 2,
      name: 'Browser only',
      slug: 'browser-only',
      ui: { entry: 'src/ui.tsx' },
    });
    expect(parsed.server).toBeUndefined();
  });

  test('accepts separate UI and server entries with a required runtime ABI', () => {
    expect(ZWidgetManifestV2.parse(serverManifest)).toEqual(serverManifest);
    expect(ZWidgetManifestV2.safeParse({
      ...serverManifest,
      server: { entry: 'src/server.ts' },
    }).success).toBe(false);
  });

  test('rejects actor/v1 manifests and unknown keys instead of accepting a union branch', () => {
    expect(ZWidgetManifestV2.safeParse({
      schemaVersion: 1,
      name: 'Legacy',
      slug: 'legacy',
      actor: { entry: 'src/actor.ts' },
      widget: { entry: 'src/ui.tsx' },
    }).success).toBe(false);
    expect(ZWidgetManifestV2.safeParse({
      ...serverManifest,
      actor: { entry: 'src/actor.ts' },
    }).success).toBe(false);
    expect(ZWidgetManifestV2.safeParse({
      ...serverManifest,
      ui: { entry: 'src/ui.tsx', extra: true },
    }).success).toBe(false);
    expect(ZWidgetManifestV2.safeParse({
      ...serverManifest,
      resources: [{
        slot: 'preferences',
        kind: 'kv',
        effect: 'read',
        resourceId: 'physical-resource-must-not-be-declared',
      }],
    }).success).toBe(false);
  });

  test('rejects unsafe build entry paths', () => {
    const unsafeEntries = [
      '../src/ui.tsx',
      'src/../ui.tsx',
      '/src/ui.tsx',
      'file:///tmp/ui.tsx',
      'https://example.test/ui.tsx',
      'src\\ui.tsx',
      'src//ui.tsx',
      ' src/ui.tsx',
    ];

    for (const entry of unsafeEntries) {
      expect(fnNormalizeWidgetRelativePath(entry)).toBeNull();
      expect(ZWidgetManifestV2.safeParse({
        schemaVersion: 2,
        name: 'Unsafe',
        slug: 'unsafe',
        ui: { entry },
      }).success).toBe(false);
    }
  });

  test('rejects non-JavaScript entry formats whose transitive graph cannot be preflighted', () => {
    for (const entry of ['src/ui.html', 'src/ui.css', 'src/ui.json', 'src/ui.wasm']) {
      expect(ZWidgetManifestV2.safeParse({
        schemaVersion: 2,
        name: 'Unsupported entry',
        slug: 'unsupported-entry',
        ui: { entry },
      }).success).toBe(false);
      expect(ZWidgetManifestV2.safeParse({
        ...serverManifest,
        server: { entry, runtimeAbi: 'vibecanvas:1' },
      }).success).toBe(false);
    }
  });

  test('rejects duplicate logical resource slots', () => {
    expect(ZWidgetManifestV2.safeParse({
      schemaVersion: 2,
      name: 'Duplicate',
      slug: 'duplicate',
      ui: { entry: 'src/ui.tsx' },
      resources: [
        { slot: 'data', kind: 'kv', effect: 'read' },
        { slot: 'data', kind: 'db', effect: 'write' },
      ],
    }).success).toBe(false);
  });

  test('rejects SQL declarations on non-database slots and operations above the effect ceiling', () => {
    expect(ZWidgetManifestV2.safeParse({
      schemaVersion: 2,
      name: 'Invalid KV SQL',
      slug: 'invalid-kv-sql',
      ui: { entry: 'src/ui.tsx' },
      resources: [{
        slot: 'preferences',
        kind: 'kv',
        effect: 'read',
        operations: {
          getSetting: { effect: 'read', sql: 'SELECT 1', result: 'rows' },
        },
      }],
    }).success).toBe(false);
    expect(ZWidgetManifestV2.safeParse({
      schemaVersion: 2,
      name: 'Invalid DB effect',
      slug: 'invalid-db-effect',
      ui: { entry: 'src/ui.tsx' },
      resources: [{
        slot: 'database',
        kind: 'db',
        effect: 'read',
        operations: {
          updateNote: { effect: 'write', sql: 'UPDATE notes SET title = :title', result: 'execute' },
        },
      }],
    }).success).toBe(false);
  });

  test('produces one deterministic canonical contract for equivalent input ordering', () => {
    const first = ZWidgetManifestV2.parse({
      schemaVersion: 2,
      name: 'Canonical',
      slug: 'canonical',
      ui: { entry: './src/ui.tsx' },
      resources: [
        { slot: 'zeta', kind: 'secretStore', effect: 'read' },
        {
          slot: 'alpha',
          kind: 'db',
          effect: 'read_write',
          operations: {
            update: {
              effect: 'write',
              sql: 'UPDATE notes SET title = :title WHERE id = :id',
              parameters: {
                title: { type: 'string' },
                id: { type: 'string', required: true },
              },
              result: 'execute',
            },
            list: { effect: 'read', sql: 'SELECT * FROM notes', result: 'rows' },
          },
        },
      ],
    });
    const second = ZWidgetManifestV2.parse({
      ui: { entry: 'src/ui.tsx' },
      slug: 'canonical',
      name: 'Canonical',
      resources: [
        {
          operations: {
            list: { result: 'rows', sql: 'SELECT * FROM notes', effect: 'read' },
            update: {
              result: 'execute',
              parameters: {
                id: { required: true, type: 'string' },
                title: { type: 'string' },
              },
              sql: 'UPDATE notes SET title = :title WHERE id = :id',
              effect: 'write',
            },
          },
          effect: 'read_write',
          kind: 'db',
          slot: 'alpha',
        },
        { effect: 'read', kind: 'secretStore', slot: 'zeta' },
      ],
      schemaVersion: 2,
    });

    expect(fnCanonicalizeWidgetManifest(first)).toBe(fnCanonicalizeWidgetManifest(second));
    expect(first.resources?.map((requirement) => requirement.slot)).toEqual(['alpha', 'zeta']);
    expect(Object.keys(first.resources?.[0]?.operations ?? {})).toEqual(['list', 'update']);
  });
});

describe('widget publication contract invariants', () => {
  test('canonicalizes only persisted contract fields in a fixed order', () => {
    expect(fnCanonicalizeWidgetContractPayload({
      canonicalManifestJson: '{"schemaVersion":2}',
      uiDigestSha256: 'ui-digest',
      serverDigestSha256: 'server-digest',
      runtimeAbi: 'vibecanvas:1',
      functionDescriptorsDigestSha256: 'functions-digest',
    })).toBe(
      '{"format":"vibecanvas.widget-contract.v2","canonicalManifestJson":"{\\"schemaVersion\\":2}","uiDigestSha256":"ui-digest","serverDigestSha256":"server-digest","runtimeAbi":"vibecanvas:1","functionDescriptorsDigestSha256":"functions-digest"}',
    );
  });

  test('normalizes generated descriptors and enforces fn/fx/tx resource ceilings', () => {
    expect(ZWidgetServerFunctionDescriptors.parse([TEST_SERVER_FUNCTION_DESCRIPTOR]))
      .toEqual([TEST_SERVER_FUNCTION_DESCRIPTOR]);
    expect(fnValidateWidgetServerFunctionDescriptors(serverManifest, [{
      ...TEST_SERVER_FUNCTION_DESCRIPTOR,
      modulePath: undefined,
    }])).toMatchObject({ valid: false, reason: 'missing_module_path' });
    expect(ZWidgetServerFunctionDescriptors.safeParse([{
      ...TEST_SERVER_FUNCTION_DESCRIPTOR,
      modulePath: '../server/run.server.ts',
    }]).success).toBe(false);
    expect(fnValidateWidgetServerFunctionDescriptors(serverManifest, [{
      ...TEST_SERVER_FUNCTION_DESCRIPTOR,
      effect: 'fx',
      resources: [{ slot: 'preferences', effect: 'read' }],
    }])).toEqual({ valid: true });
    expect(fnValidateWidgetServerFunctionDescriptors(serverManifest, [{
      ...TEST_SERVER_FUNCTION_DESCRIPTOR,
      effect: 'fx',
      resources: [{ slot: 'preferences', effect: 'write' }],
    }])).toMatchObject({ valid: false, reason: 'fx_has_write_resource' });
    expect(ZWidgetServerFunctionDescriptors.safeParse([{
      ...TEST_SERVER_FUNCTION_DESCRIPTOR,
      wait: { until: 'tomorrow' },
    }]).success).toBe(false);
    expect(fnCanonicalizeWidgetServerFunctionDescriptors([
      { ...TEST_SERVER_FUNCTION_DESCRIPTOR, exportName: 'zeta' },
      { ...TEST_SERVER_FUNCTION_DESCRIPTOR, exportName: 'alpha' },
    ])).toContain('"exportName":"alpha"');
    expect(fnGenerateWidgetServerFunctionClientModule({
      descriptors: [
        { ...TEST_SERVER_FUNCTION_DESCRIPTOR, exportName: 'zeta' },
        { ...TEST_SERVER_FUNCTION_DESCRIPTOR, exportName: 'alpha' },
      ],
      serverModuleSpecifier: '../server/index',
    })).toBe([
      'import { createServerFunctionProxy as __vibecanvasCreateProxy } from "@vibecanvas/sdk/function-client";',
      'import type { TServerFunctionClientOf as __VibecanvasClientOf } from "@vibecanvas/sdk/function-client";',
      'export const alpha: __VibecanvasClientOf<typeof import("../server/index")["alpha"]> = __vibecanvasCreateProxy("alpha");',
      'export const zeta: __VibecanvasClientOf<typeof import("../server/index")["zeta"]> = __vibecanvasCreateProxy("zeta");',
      '',
    ].join('\n'));
  });

  test('declares only logical resource access', () => {
    expect(fnWidgetManifestAllowsResource(revision.manifest, {
      slot: 'preferences',
      kind: 'kv',
      effect: 'read',
    })).toBe(true);
    expect(fnWidgetManifestAllowsResource(revision.manifest, {
      slot: 'preferences',
      kind: 'kv',
      effect: 'write',
    })).toBe(false);
  });

  test('validates binding completeness, uniqueness, kind, and manifest permission ceilings', () => {
    expect(fnValidateWidgetResourceBindings(serverManifest, [{
      slot: 'preferences',
      resourceId: 'resource-a',
      kind: 'kv',
      allowRead: true,
      allowWrite: false,
    }])).toEqual({ valid: true });
    expect(fnValidateWidgetResourceBindings(serverManifest, [])).toEqual({
      valid: false,
      reason: 'missing_required_slot',
      slot: 'preferences',
    });
    expect(fnValidateWidgetResourceBindings(serverManifest, [{
      slot: 'preferences',
      resourceId: 'resource-a',
      kind: 'kv',
      allowRead: false,
      allowWrite: true,
    }])).toEqual({
      valid: false,
      reason: 'permission_exceeded',
      slot: 'preferences',
    });
    expect(fnValidateWidgetResourceBindings(serverManifest, [
      {
        slot: 'preferences',
        resourceId: 'resource-a',
        kind: 'kv',
        allowRead: true,
        allowWrite: false,
      },
      {
        slot: 'preferences',
        resourceId: 'resource-b',
        kind: 'kv',
        allowRead: true,
        allowWrite: false,
      },
    ])).toEqual({
      valid: false,
      reason: 'duplicate_binding_slot',
      slot: 'preferences',
    });
  });

  test('keeps required UI and optional server artifacts internally consistent', () => {
    expect(fnWidgetRevisionArtifactsMatchManifest(revision)).toBe(true);
    expect(fnWidgetRevisionArtifactsMatchManifest({
      ...revision,
      serverArtifact: null,
    })).toBe(false);

    const browserManifest = ZWidgetManifestV2.parse({
      schemaVersion: 2,
      name: 'Browser',
      slug: 'browser',
      ui: { entry: 'src/ui.tsx' },
    });
    expect(fnWidgetRevisionArtifactsMatchManifest({
      ...revision,
      manifest: browserManifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(browserManifest),
      serverArtifact: null,
    })).toBe(true);
  });

  test('supports fake immutable reader and builder capabilities without actor contracts', async () => {
    const reader: IWidgetRevisionReader = {
      getRevision: async (_tenant, id) => id === revision.id ? revision : null,
      getActiveRevision: async (_tenant, definitionId) => (
        definitionId === revision.definitionId ? revision : null
      ),
    };
    const builder: IWidgetArtifactBuilder = {
      build: async (_tenant, request: TWidgetBuildRequest) => ({
        sourceSnapshotId: request.snapshot.id,
        sourceDigestSha256: request.snapshot.digestSha256,
        builderIdentity: request.builderIdentity,
        canonicalManifestJson: request.canonicalManifestJson,
        functionDescriptors: request.manifest.server === undefined
          ? []
          : [TEST_SERVER_FUNCTION_DESCRIPTOR],
        functionDescriptorsDigestSha256: 'functions-digest',
        contractDigestSha256: 'contract-digest',
        uiArtifact: { kind: 'ui', digestSha256: 'ui-digest', bytes: new Uint8Array([1]) },
        serverArtifact: request.manifest.server === undefined
          ? null
          : { kind: 'server', digestSha256: 'server-digest', bytes: new Uint8Array([2]) },
      }),
    };

    expect(await reader.getRevision(tenant, 'revision-a')).toEqual(revision);
    expect(await reader.getRevision(tenant, 'missing')).toBeNull();
    const build = await builder.build(tenant, {
      snapshot: {
        id: 'source-a',
        digestSha256: 'source-digest',
        files: [{ path: 'src/ui.tsx', bytes: new Uint8Array([1]) }],
        createdAtMs: 1,
      },
      manifest: serverManifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifest(serverManifest),
      builderIdentity: 'builder-a',
    });
    expect(build.sourceSnapshotId).toBe('source-a');
    expect(build.serverArtifact?.kind).toBe('server');
  });
});
