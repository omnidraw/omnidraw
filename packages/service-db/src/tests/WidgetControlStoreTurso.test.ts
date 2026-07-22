import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetServerFunctionDescriptors,
} from '@vibecanvas/widget-contract';
import type {
  IWidgetArtifactMutationCoordinator,
  IWidgetControlStore,
  TWidgetArtifactDescriptor,
  TWidgetManifestV2,
  TWidgetPublicationCommitResult,
  TWidgetRevisionDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@vibecanvas/widget-contract';
import { DEFAULT_OSS_ACCOUNT_ID, DEFAULT_OSS_ORGANIZATION_ID } from '../CONSTANTS';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import { fnFunctionId } from '../FunctionControlStoreTurso/fn.function-id';
import { WidgetControlStoreTurso } from '../WidgetControlStoreTurso';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const digest = (value: number) => value.toString(16).padStart(64, '0');

const ORG_B = uuid(401);
const CELL_A = uuid(402);
const CELL_B = uuid(403);
const DEFINITION_A = uuid(404);
const DEFINITION_B = uuid(405);
const RESOURCE_KV_A = uuid(406);
const RESOURCE_DB_A = uuid(407);
const RESOURCE_FOREIGN = uuid(408);
const CANVAS_A = uuid(409);

const TENANT_A = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: CELL_A,
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'widget-store-a',
});

const TENANT_B = fnFreezeTenantContext({
  orgId: ORG_B,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: CELL_B,
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'widget-store-b',
});

function artifact(
  tenant: TTenantContext,
  args: Readonly<{
    id: string;
    kind: 'source' | 'ui' | 'server';
    digest: string;
    byteSize?: number;
    nowMs?: number;
  }>,
): TWidgetArtifactDescriptor {
  return {
    orgId: tenant.orgId,
    id: args.id,
    kind: args.kind,
    digestSha256: args.digest,
    byteSize: args.byteSize ?? 100,
    retentionState: 'pinned',
    retainUntilMs: null,
    createdAtMs: args.nowMs ?? 10,
  };
}

function manifest(
  args: Readonly<{
    slug?: string;
    name?: string;
    server?: boolean;
    resources?: TWidgetManifestV2['resources'];
  }> = {},
): TWidgetManifestV2 {
  return {
    schemaVersion: 2,
    name: args.name ?? 'Weather',
    slug: args.slug ?? 'weather',
    ui: { entry: 'src/ui.tsx' },
    ...(args.server ? { server: { entry: 'src/server.ts', runtimeAbi: 'vibecanvas:1' } } : {}),
    ...(args.resources ? { resources: args.resources } : {}),
  };
}

async function publish(
  store: IWidgetControlStore,
  tenant: TTenantContext,
  args: Readonly<{
    definitionId?: string;
    revisionId: string;
    expectedActiveRevisionId?: string | null;
    manifest?: TWidgetManifestV2;
    canonicalManifestJson?: string;
    contractDigestSha256?: string;
    uiArtifact?: TWidgetArtifactDescriptor;
    serverArtifact?: TWidgetArtifactDescriptor | null;
    sourceArtifact?: TWidgetArtifactDescriptor;
    sourceSnapshotId?: string;
    sourceDigestSha256?: string;
    builderIdentity?: string;
    bindings?: Parameters<IWidgetControlStore['commitPublication']>[1]['bindings'];
    functionDescriptors?: readonly TWidgetServerFunctionDescriptor[];
    nowMs?: number;
  }>,
): Promise<TWidgetPublicationCommitResult> {
  const value = args.manifest ?? manifest({ server: args.serverArtifact !== undefined && args.serverArtifact !== null });
  const nowMs = args.nowMs ?? 20;
  const canonicalManifestJson = args.canonicalManifestJson ?? JSON.stringify(value);
  const uiArtifact = args.uiArtifact ?? artifact(tenant, {
    id: uuid(500 + nowMs),
    kind: 'ui',
    digest: digest(500 + nowMs),
    nowMs,
  });
  const serverArtifact = args.serverArtifact ?? null;
  const sourceArtifact = args.sourceArtifact ?? artifact(tenant, {
    id: uuid(900_000 + nowMs),
    kind: 'source',
    digest: digest(900_000 + nowMs),
    nowMs,
  });
  const functionDescriptors = args.functionDescriptors ?? (value.server ? [{
    schemaVersion: 1 as const,
    exportName: 'run',
    modulePath: 'server/run.server.ts',
    effect: 'fn' as const,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    resources: [],
    limits: {
      timeoutMs: 1_000,
      memoryTier: 'small' as const,
      outputByteLimit: 1_024,
      logByteLimit: 1_024,
    },
    retry: {
      mode: 'none' as const,
      maxAttempts: 1,
      initialBackoffMs: 0,
      maxBackoffMs: 0,
    },
  }] : []);
  const functionDescriptorsDigestSha256 = createHash('sha256')
    .update(fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors))
    .digest('hex');
  const contractDigestSha256 = args.contractDigestSha256 ?? createHash('sha256')
    .update(fnCanonicalizeWidgetContractPayload({
      canonicalManifestJson,
      uiDigestSha256: uiArtifact.digestSha256,
      serverDigestSha256: serverArtifact?.digestSha256 ?? null,
      runtimeAbi: value.server?.runtimeAbi ?? null,
      functionDescriptorsDigestSha256,
    }))
    .digest('hex');
  return store.commitPublication(tenant, {
    expectedActiveRevisionId: args.expectedActiveRevisionId ?? null,
    revision: {
      id: args.revisionId,
      definitionId: args.definitionId ?? DEFINITION_A,
      manifest: value,
      canonicalManifestJson,
      functionDescriptors,
      functionDescriptorsDigestSha256,
      contractDigestSha256,
      uiArtifact,
      serverArtifact,
      createdAtMs: nowMs,
    },
    source: {
      sourceSnapshotId: args.sourceSnapshotId ?? uuid(910_000 + nowMs),
      sourceDigestSha256: args.sourceDigestSha256 ?? digest(910_000 + nowMs),
      sourceArtifact,
      builderIdentity: args.builderIdentity ?? 'widget-control-store-test',
      createdAtMs: nowMs,
    },
    bindings: args.bindings ?? [],
    nowMs,
  });
}

function committed(result: TWidgetPublicationCommitResult): TWidgetRevisionDescriptor {
  if (result.status !== 'committed') throw new Error('Expected publication to commit.');
  return result.revision;
}

async function insertOrganization(service: DbServiceTurso): Promise<void> {
  await (await service.db.prepare(`
    INSERT INTO organizations (id, slug, name, status, created_at_ms, updated_at_ms)
    VALUES (?, 'tenant-b', 'Tenant B', 'active', 0, 0)
  `)).run(ORG_B);
}

async function insertResource(
  service: DbServiceTurso,
  tenant: TTenantContext,
  args: Readonly<{ id: string; kind: 'kv' | 'db'; name: string }>,
): Promise<void> {
  await (await service.db.prepare(`
    INSERT INTO resource_catalog (
      org_id, id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'ready', NULL, 1, 1)
  `)).run(tenant.orgId, args.id, args.kind, args.name);
}

async function rowCount(service: DbServiceTurso, table: string, orgId = TENANT_A.orgId): Promise<number> {
  const allowed = new Set([
    'artifact_references',
    'resource_bindings',
    'widget_definition_revisions',
    'widget_definitions',
  ]);
  if (!allowed.has(table)) throw new Error('Unexpected table.');
  const row = await (await service.db.prepare(`SELECT count(*) AS count FROM ${table} WHERE org_id = ?`)).get(orgId);
  return Number((row as { count: unknown }).count);
}

describe('WidgetControlStoreTurso', () => {
  let databasePath: string;
  let serviceRoot: string;
  let service: DbServiceTurso;
  let store: IWidgetControlStore & IWidgetArtifactMutationCoordinator;

  beforeEach(async () => {
    serviceRoot = await mkdtemp(path.join(tmpdir(), 'vibecanvas-widget-control-store-'));
    databasePath = path.join(serviceRoot, 'main.db');
    service = new DbServiceTurso({
      databasePath,
      dataDir: serviceRoot,
      cacheDir: path.join(serviceRoot, 'cache'),
    });
    await service.start();
    await insertOrganization(service);
    store = new WidgetControlStoreTurso(service.db);
  });

  afterEach(async () => {
    await service.stop();
    await rm(serviceRoot, { recursive: true, force: true });
  });

  test('publishes UI-only and server-backed immutable revisions with tenant-scoped artifact resolution', async () => {
    await insertResource(service, TENANT_A, { id: RESOURCE_KV_A, kind: 'kv', name: 'Preferences' });
    await insertResource(service, TENANT_A, { id: RESOURCE_DB_A, kind: 'db', name: 'Application DB' });

    const firstManifest = manifest({
      resources: [{ slot: 'preferences', kind: 'kv', effect: 'read', required: true }],
    });
    const first = await publish(store, TENANT_A, {
      revisionId: uuid(411),
      manifest: firstManifest,
      uiArtifact: artifact(TENANT_A, { id: uuid(412), kind: 'ui', digest: digest(1) }),
      bindings: [{
        slot: 'preferences',
        resourceId: RESOURCE_KV_A,
        kind: 'kv',
        allowRead: true,
        allowWrite: false,
      }],
      nowMs: 20,
    });
    const firstRevision = committed(first);
    expect(firstRevision).toMatchObject({
      definitionId: DEFINITION_A,
      revisionNumber: 1,
      serverArtifact: null,
      uiArtifact: { id: uuid(412), kind: 'ui', retentionState: 'pinned' },
    });
    expect(first.status === 'committed' && first.definition).toMatchObject({
      id: DEFINITION_A,
      slug: 'weather',
      status: 'published',
      activeRevisionId: uuid(411),
      createdAtMs: 20,
      updatedAtMs: 20,
    });
    await store.createDefinition(TENANT_B, {
      id: DEFINITION_A,
      slug: 'weather',
      name: 'Weather',
      nowMs: 21,
    });
    await expect(store.getDefinitionBySlug(TENANT_A, 'weather')).resolves.toMatchObject({
      orgId: TENANT_A.orgId,
      id: DEFINITION_A,
      status: 'published',
    });
    await expect(store.getDefinitionBySlug(TENANT_B, 'weather')).resolves.toMatchObject({
      orgId: TENANT_B.orgId,
      id: DEFINITION_A,
      status: 'draft',
    });

    const secondManifest = manifest({
      server: true,
      resources: [{ slot: 'data', kind: 'db', effect: 'read_write' }],
    });
    const second = await publish(store, TENANT_A, {
      revisionId: uuid(413),
      expectedActiveRevisionId: uuid(411),
      manifest: secondManifest,
      uiArtifact: artifact(TENANT_A, {
        id: uuid(414),
        kind: 'ui',
        digest: digest(1),
      }),
      serverArtifact: artifact(TENANT_A, {
        id: uuid(415),
        kind: 'server',
        digest: digest(2),
        byteSize: 200,
      }),
      bindings: [{
        slot: 'data',
        resourceId: RESOURCE_DB_A,
        kind: 'db',
        allowRead: false,
        allowWrite: true,
      }],
      nowMs: 30,
    });
    const secondRevision = committed(second);
    expect(secondRevision).toMatchObject({
      revisionNumber: 2,
      functionDescriptors: [{ exportName: 'run', effect: 'fn' }],
      uiArtifact: { id: uuid(412), digestSha256: digest(1) },
      serverArtifact: { id: uuid(415), kind: 'server', digestSha256: digest(2) },
    });
    expect(await (await service.db.prepare(`
      SELECT id, export_name, effect, definition_revision, artifact_digest_sha256,
        contract_digest_sha256, runtime_abi
      FROM function_definitions
      WHERE org_id = ? AND widget_definition_id = ? AND widget_revision_id = ?
    `)).get(TENANT_A.orgId, DEFINITION_A, uuid(413))).toEqual({
      id: fnFunctionId(DEFINITION_A, 'run'),
      export_name: 'run',
      effect: 'fn',
      definition_revision: 2,
      artifact_digest_sha256: digest(2),
      contract_digest_sha256: secondRevision.contractDigestSha256,
      runtime_abi: 'vibecanvas:1',
    });
    expect(await rowCount(service, 'artifact_references')).toBe(4);
    expect(await store.getActiveRevision(TENANT_A, DEFINITION_A)).toMatchObject({ id: uuid(413) });

    expect(await (await service.db.prepare(`
      SELECT is_required, manifest_allow_read, manifest_allow_write, allow_read, allow_write
      FROM resource_bindings
      WHERE org_id = ? AND definition_id = ? AND revision_id = ? AND slot_name = 'data'
    `)).get(TENANT_A.orgId, DEFINITION_A, uuid(413))).toEqual({
      is_required: 0,
      manifest_allow_read: 1,
      manifest_allow_write: 1,
      allow_read: 0,
      allow_write: 1,
    });

    const resolution = {
      definitionId: DEFINITION_A,
      revisionId: uuid(413),
      artifactId: uuid(415),
      kind: 'server' as const,
      digestSha256: digest(2),
    };
    await expect(store.resolveArtifactReference(TENANT_A, resolution)).resolves.toMatchObject({
      id: uuid(415),
      kind: 'server',
    });
    await expect(store.resolveArtifactReference(TENANT_A, {
      ...resolution,
      digestSha256: digest(3),
    })).resolves.toBeNull();
    await expect(store.resolveArtifactReference(TENANT_A, {
      ...resolution,
      definitionId: DEFINITION_B,
    })).resolves.toBeNull();
    await expect(store.resolveArtifactReference(TENANT_B, resolution)).resolves.toBeNull();
    await expect(store.getRevisionSource(TENANT_A, uuid(413))).resolves.toMatchObject({
      definitionId: DEFINITION_A,
      revisionId: uuid(413),
      sourceSnapshotId: uuid(910_030),
      sourceDigestSha256: digest(910_030),
      sourceArtifact: { id: uuid(900_030), kind: 'source', digestSha256: digest(900_030) },
      builderIdentity: 'widget-control-store-test',
    });
    await expect(store.resolveArtifactReference(TENANT_A, {
      definitionId: DEFINITION_A,
      revisionId: uuid(413),
      artifactId: uuid(900_030),
      kind: 'source',
      digestSha256: digest(900_030),
    })).resolves.toMatchObject({ id: uuid(900_030), kind: 'source' });
    await expect(store.resolveArtifactReference(TENANT_A, {
      ...resolution,
      kind: 'source',
    })).resolves.toBeNull();
    await expect(store.isArtifactDigestReferenced(TENANT_A, { digestSha256: digest(2) })).resolves.toBe(true);
    await expect(store.isArtifactDigestReferenced(TENANT_B, { digestSha256: digest(2) })).resolves.toBe(false);
  });

  test('rolls back every publication write on CAS, binding, identity, and artifact-scope failures', async () => {
    await insertResource(service, TENANT_A, { id: RESOURCE_KV_A, kind: 'kv', name: 'Preferences' });
    await insertResource(service, TENANT_B, { id: RESOURCE_FOREIGN, kind: 'kv', name: 'Foreign preferences' });
    const firstRevision = uuid(421);
    committed(await publish(store, TENANT_A, {
      revisionId: firstRevision,
      uiArtifact: artifact(TENANT_A, { id: uuid(422), kind: 'ui', digest: digest(21) }),
      nowMs: 20,
    }));
    const before = {
      definitions: await rowCount(service, 'widget_definitions'),
      revisions: await rowCount(service, 'widget_definition_revisions'),
      artifacts: await rowCount(service, 'artifact_references'),
      bindings: await rowCount(service, 'resource_bindings'),
    };

    const stale = await publish(store, TENANT_A, {
      revisionId: uuid(423),
      expectedActiveRevisionId: null,
      uiArtifact: artifact(TENANT_A, { id: uuid(424), kind: 'ui', digest: digest(22) }),
      nowMs: 30,
    });
    expect(stale).toEqual({ status: 'conflict', currentActiveRevisionId: firstRevision });
    expect(await rowCount(service, 'artifact_references')).toBe(before.artifacts);

    const requiredManifest = manifest({
      resources: [{ slot: 'preferences', kind: 'kv', effect: 'read', required: true }],
    });
    await expect(publish(store, TENANT_A, {
      revisionId: uuid(425),
      expectedActiveRevisionId: firstRevision,
      manifest: requiredManifest,
      uiArtifact: artifact(TENANT_A, { id: uuid(426), kind: 'ui', digest: digest(23) }),
      bindings: [{
        slot: 'preferences',
        resourceId: RESOURCE_FOREIGN,
        kind: 'kv',
        allowRead: true,
        allowWrite: false,
      }],
      nowMs: 40,
    })).rejects.toMatchObject({ code: 'WIDGET_RESOURCE_NOT_FOUND' });

    await expect(publish(store, TENANT_A, {
      revisionId: uuid(427),
      expectedActiveRevisionId: firstRevision,
      manifest: requiredManifest,
      bindings: [{
        slot: 'preferences',
        resourceId: RESOURCE_KV_A,
        kind: 'kv',
        allowRead: false,
        allowWrite: true,
      }],
      nowMs: 41,
    })).rejects.toMatchObject({ code: 'WIDGET_RESOURCE_BINDING_EXCEEDS_MANIFEST' });

    await expect(publish(store, TENANT_A, {
      revisionId: uuid(428),
      expectedActiveRevisionId: firstRevision,
      manifest: requiredManifest,
      bindings: [],
      nowMs: 42,
    })).rejects.toMatchObject({ code: 'WIDGET_RESOURCE_BINDING_REQUIRED' });

    await expect(publish(store, TENANT_A, {
      revisionId: uuid(429),
      expectedActiveRevisionId: firstRevision,
      manifest: manifest({ slug: 'forged-slug' }),
      nowMs: 43,
    })).rejects.toMatchObject({ code: 'WIDGET_DEFINITION_IDENTITY_MISMATCH' });

    await expect(publish(store, TENANT_A, {
      revisionId: uuid(430),
      expectedActiveRevisionId: firstRevision,
      uiArtifact: artifact(TENANT_B, { id: uuid(431), kind: 'ui', digest: digest(24) }),
      nowMs: 44,
    })).rejects.toMatchObject({ code: 'WIDGET_ARTIFACT_SCOPE_INVALID' });

    expect({
      definitions: await rowCount(service, 'widget_definitions'),
      revisions: await rowCount(service, 'widget_definition_revisions'),
      artifacts: await rowCount(service, 'artifact_references'),
      bindings: await rowCount(service, 'resource_bindings'),
    }).toEqual(before);
    await expect(store.getActiveRevision(TENANT_A, DEFINITION_A)).resolves.toMatchObject({ id: firstRevision });

    await expect(publish(store, TENANT_A, {
      definitionId: DEFINITION_B,
      revisionId: uuid(432),
      manifest: manifest({ slug: 'new-widget', name: 'New widget' }),
      uiArtifact: artifact(TENANT_A, { id: uuid(433), kind: 'ui', digest: digest(25), byteSize: -1 }),
      nowMs: 50,
    })).rejects.toThrow();
    expect(await store.getDefinition(TENANT_A, DEFINITION_B)).toBeNull();

    const legacyManifest = {
      ...manifest({ slug: 'legacy-widget', name: 'Legacy widget' }),
      actors: [{ name: 'legacy' }],
    } as unknown as TWidgetManifestV2;
    await expect(publish(store, TENANT_A, {
      definitionId: uuid(434),
      revisionId: uuid(435),
      manifest: legacyManifest,
      nowMs: 51,
    })).rejects.toMatchObject({ code: 'WIDGET_MANIFEST_INVALID' });
    expect(await store.getDefinition(TENANT_A, uuid(434))).toBeNull();

    const canonicalMismatch = manifest({ slug: 'canonical-mismatch', name: 'Canonical mismatch' });
    await expect(publish(store, TENANT_A, {
      definitionId: uuid(436),
      revisionId: uuid(437),
      manifest: canonicalMismatch,
      canonicalManifestJson: `${JSON.stringify(canonicalMismatch)}\n`,
      nowMs: 52,
    })).rejects.toMatchObject({ code: 'WIDGET_MANIFEST_MISMATCH' });
    expect(await store.getDefinition(TENANT_A, uuid(436))).toBeNull();
  });

  test('rolls the active pointer back only to a same-organization revision of the same definition', async () => {
    const revisionOne = uuid(441);
    const revisionTwo = uuid(442);
    committed(await publish(store, TENANT_A, { revisionId: revisionOne, nowMs: 10 }));
    committed(await publish(store, TENANT_A, {
      revisionId: revisionTwo,
      expectedActiveRevisionId: revisionOne,
      nowMs: 20,
    }));
    committed(await publish(store, TENANT_A, {
      definitionId: DEFINITION_B,
      revisionId: uuid(443),
      manifest: manifest({ slug: 'other-widget', name: 'Other widget' }),
      nowMs: 30,
    }));

    expect(await store.rollbackPublication(TENANT_A, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: revisionTwo,
      targetRevisionId: uuid(443),
      nowMs: 40,
    })).toEqual({ status: 'conflict', currentActiveRevisionId: revisionTwo });
    expect(await store.rollbackPublication(TENANT_A, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: revisionOne,
      targetRevisionId: revisionOne,
      nowMs: 41,
    })).toEqual({ status: 'conflict', currentActiveRevisionId: revisionTwo });

    const rolledBack = await store.rollbackPublication(TENANT_A, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: revisionTwo,
      targetRevisionId: revisionOne,
      nowMs: 42,
    });
    expect(rolledBack).toMatchObject({
      status: 'updated',
      previousActiveRevisionId: revisionTwo,
      activeRevisionId: revisionOne,
      definition: { activeRevisionId: revisionOne, updatedAtMs: 42 },
    });
    expect(await store.getActiveRevision(TENANT_B, DEFINITION_A)).toBeNull();
  });

  test('archives only the exact tenant-owned active publication and retains immutable provenance', async () => {
    const revisionId = uuid(1_644);
    committed(await publish(store, TENANT_A, { revisionId, nowMs: 10 }));

    expect(await store.archiveDefinition(TENANT_B, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: revisionId,
      nowMs: 11,
    })).toEqual({ status: 'conflict', currentActiveRevisionId: null });
    expect(await store.archiveDefinition(TENANT_A, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: uuid(1_645),
      nowMs: 11,
    })).toEqual({ status: 'conflict', currentActiveRevisionId: revisionId });

    expect(await store.archiveDefinition(TENANT_A, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: revisionId,
      nowMs: 11,
    })).toMatchObject({
      status: 'archived',
      previousActiveRevisionId: revisionId,
      definition: { status: 'archived', activeRevisionId: null, updatedAtMs: 11 },
    });
    expect(await store.listPublishedDefinitions(TENANT_A, 10)).toEqual([]);
    expect(await store.getActiveRevision(TENANT_A, DEFINITION_A)).toBeNull();
    expect(await store.getRevision(TENANT_A, revisionId)).toMatchObject({ id: revisionId });
    expect(await store.getRevisionSource(TENANT_A, revisionId)).toMatchObject({ revisionId });
  });

  test('rejects mismatched publication contracts and fails closed on stored revision tampering', async () => {
    const rejectedDefinition = uuid(444);
    await expect(publish(store, TENANT_A, {
      definitionId: rejectedDefinition,
      revisionId: uuid(445),
      manifest: manifest({ slug: 'bad-contract', name: 'Bad contract' }),
      contractDigestSha256: digest(999),
      nowMs: 10,
    })).rejects.toMatchObject({ code: 'WIDGET_REVISION_INTEGRITY_FAILED' });
    expect(await store.getDefinition(TENANT_A, rejectedDefinition)).toBeNull();

    const revisionId = uuid(446);
    const published = committed(await publish(store, TENANT_A, {
      revisionId,
      nowMs: 20,
    }));
    await (await service.db.prepare(`
      UPDATE widget_definition_revisions
      SET manifest_json = ?
      WHERE org_id = ? AND id = ?
    `)).run(
      JSON.stringify({ ...published.manifest, actor: { entry: 'legacy.ts' } }),
      TENANT_A.orgId,
      revisionId,
    );
    await expect(store.getRevision(TENANT_A, revisionId)).rejects.toMatchObject({
      code: 'WIDGET_REVISION_INTEGRITY_FAILED',
    });

    await (await service.db.prepare(`
      UPDATE widget_definition_revisions
      SET manifest_json = ?
      WHERE org_id = ? AND id = ?
    `)).run(
      JSON.stringify({ ...published.manifest, description: 'noncanonical ordering' }),
      TENANT_A.orgId,
      revisionId,
    );
    await expect(store.getRevision(TENANT_A, revisionId)).rejects.toMatchObject({
      code: 'WIDGET_REVISION_INTEGRITY_FAILED',
    });

    await (await service.db.prepare(`
      UPDATE widget_definition_revisions
      SET manifest_json = ?, contract_digest_sha256 = ?
      WHERE org_id = ? AND id = ?
    `)).run(
      published.canonicalManifestJson,
      digest(998),
      TENANT_A.orgId,
      revisionId,
    );
    await expect(store.getActiveRevision(TENANT_A, DEFINITION_A)).rejects.toMatchObject({
      code: 'WIDGET_REVISION_INTEGRITY_FAILED',
    });
  });

  test('reads pre-M6 v1 revisions only with the canonical empty function set', async () => {
    const active = committed(await publish(store, TENANT_A, {
      revisionId: uuid(641),
      nowMs: 10,
    }));
    const legacyRevisionId = uuid(642);
    const legacyArtifactId = uuid(643);
    const legacyArtifactDigest = digest(643);
    const legacyContractDigest = createHash('sha256').update(JSON.stringify({
      format: 'vibecanvas.widget-contract.v1',
      canonicalManifestJson: active.canonicalManifestJson,
      uiDigestSha256: legacyArtifactDigest,
      serverDigestSha256: null,
      runtimeAbi: null,
    })).digest('hex');
    await (await service.db.prepare(`
      INSERT INTO artifact_references (
        org_id, id, kind, digest_sha256, byte_size,
        retention_state, retain_until_ms, created_at_ms
      ) VALUES (?, ?, 'ui', ?, 10, 'pinned', NULL, 11)
    `)).run(TENANT_A.orgId, legacyArtifactId, legacyArtifactDigest);
    await (await service.db.prepare(`
      INSERT INTO widget_definition_revisions (
        org_id, id, definition_id, revision_number, ui_artifact_id, ui_artifact_kind,
        server_artifact_id, server_artifact_kind, manifest_json,
        contract_digest_sha256, created_at_ms
      ) VALUES (?, ?, ?, 2, ?, 'ui', NULL, NULL, ?, ?, 11)
    `)).run(
      TENANT_A.orgId,
      legacyRevisionId,
      DEFINITION_A,
      legacyArtifactId,
      active.canonicalManifestJson,
      legacyContractDigest,
    );
    await expect(store.getRevision(TENANT_A, legacyRevisionId)).resolves.toMatchObject({
      id: legacyRevisionId,
      functionDescriptors: [],
      functionDescriptorsDigestSha256: '2ffcc4002f0abc5490138a0da6fcce85b1ee82bc9e56f0000fb552953839f40b',
      contractDigestSha256: legacyContractDigest,
    });

    const forgedDescriptors = fnCanonicalizeWidgetServerFunctionDescriptors([{
      schemaVersion: 1,
      exportName: 'forged',
      effect: 'fn',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      resources: [],
      limits: {
        timeoutMs: 1_000,
        memoryTier: 'small',
        outputByteLimit: 1_024,
        logByteLimit: 1_024,
      },
      retry: { mode: 'none', maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    }]);
    await (await service.db.prepare(`
      UPDATE widget_definition_revisions
      SET function_descriptors_json = ?, function_descriptors_digest_sha256 = ?
      WHERE org_id = ? AND id = ?
    `)).run(
      forgedDescriptors,
      createHash('sha256').update(forgedDescriptors).digest('hex'),
      TENANT_A.orgId,
      legacyRevisionId,
    );
    await expect(store.getRevision(TENANT_A, legacyRevisionId)).rejects.toMatchObject({
      code: 'WIDGET_REVISION_INTEGRITY_FAILED',
    });
  });

  test('starts rollback grace at the latest pointer transition, prunes the latest inactive revision, and never reuses numbers after restart', async () => {
    const revisionOne = uuid(447);
    const revisionTwo = uuid(448);
    const revisionThree = uuid(449);
    committed(await publish(store, TENANT_A, { revisionId: revisionOne, nowMs: 10 }));
    committed(await publish(store, TENANT_A, {
      revisionId: revisionTwo,
      expectedActiveRevisionId: revisionOne,
      nowMs: 20,
    }));
    committed(await publish(store, TENANT_A, {
      revisionId: revisionThree,
      expectedActiveRevisionId: revisionTwo,
      nowMs: 30,
    }));
    const regressingPublicationRevision = uuid(451);
    await expect(publish(store, TENANT_A, {
      revisionId: regressingPublicationRevision,
      expectedActiveRevisionId: revisionThree,
      nowMs: 29,
    })).rejects.toMatchObject({ code: 'WIDGET_TRANSITION_TIMESTAMP_REGRESSION' });
    expect(await store.getRevision(TENANT_A, regressingPublicationRevision)).toBeNull();
    expect((await store.rollbackPublication(TENANT_A, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: revisionThree,
      targetRevisionId: revisionTwo,
      nowMs: 100,
    })).status).toBe('updated');
    await expect(store.rollbackPublication(TENANT_A, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: revisionTwo,
      targetRevisionId: revisionOne,
      nowMs: 99,
    })).rejects.toMatchObject({ code: 'WIDGET_TRANSITION_TIMESTAMP_REGRESSION' });
    expect((await store.getDefinition(TENANT_A, DEFINITION_A))?.updatedAtMs).toBe(100);
    expect((await store.rollbackPublication(TENANT_A, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: revisionTwo,
      targetRevisionId: revisionOne,
      nowMs: 1_000,
    })).status).toBe('updated');

    expect(await store.rollbackPublication(TENANT_A, {
      definitionId: DEFINITION_A,
      expectedActiveRevisionId: revisionOne,
      targetRevisionId: revisionOne,
      nowMs: 1_900,
    })).toEqual({ status: 'conflict', currentActiveRevisionId: revisionOne });
    expect((await store.getDefinition(TENANT_A, DEFINITION_A))?.updatedAtMs).toBe(1_000);

    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 2_000,
      inactiveBeforeMs: 999,
      limit: 100,
    })).prunedRevisionIds).toEqual([]);
    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 2_000,
      inactiveBeforeMs: 1_000,
      limit: 100,
    })).prunedRevisionIds).toEqual([revisionTwo, revisionThree]);

    expect(await store.getRevision(TENANT_A, revisionThree)).toBeNull();
    await service.stop();
    service = new DbServiceTurso({
      databasePath,
      dataDir: serviceRoot,
      cacheDir: path.join(serviceRoot, 'cache'),
    });
    await service.start();
    store = new WidgetControlStoreTurso(service.db);
    const next = committed(await publish(store, TENANT_A, {
      revisionId: uuid(450),
      expectedActiveRevisionId: revisionOne,
      nowMs: 1_100,
    }));
    expect(next.revisionNumber).toBe(4);
  });

  test('rejects bindings to every non-ready resource state inside publication', async () => {
    await insertResource(service, TENANT_A, {
      id: RESOURCE_KV_A,
      kind: 'kv',
      name: 'Unavailable preferences',
    });
    const requiredManifest = manifest({
      slug: 'resource-readiness',
      name: 'Resource readiness',
      resources: [{ slot: 'preferences', kind: 'kv', effect: 'read', required: true }],
    });
    const binding = [{
      slot: 'preferences',
      resourceId: RESOURCE_KV_A,
      kind: 'kv' as const,
      allowRead: true,
      allowWrite: false,
    }];
    const nonReadyStates = ['created', 'provisioning', 'migrating', 'error', 'deleting'] as const;
    for (const [index, status] of nonReadyStates.entries()) {
      await (await service.db.prepare(`
        UPDATE resource_catalog SET status = ? WHERE org_id = ? AND id = ?
      `)).run(status, TENANT_A.orgId, RESOURCE_KV_A);
      await expect(publish(store, TENANT_A, {
        definitionId: DEFINITION_B,
        revisionId: uuid(551 + index),
        manifest: requiredManifest,
        bindings: binding,
        nowMs: 100 + index,
      })).rejects.toMatchObject({ code: 'WIDGET_RESOURCE_NOT_FOUND' });
      expect(await store.getDefinition(TENANT_A, DEFINITION_B)).toBeNull();
    }

    await (await service.db.prepare(`
      UPDATE resource_catalog SET status = 'ready' WHERE org_id = ? AND id = ?
    `)).run(TENANT_A.orgId, RESOURCE_KV_A);
    expect((await publish(store, TENANT_A, {
      definitionId: DEFINITION_B,
      revisionId: uuid(556),
      manifest: requiredManifest,
      bindings: binding,
      nowMs: 200,
    })).status).toBe('committed');
  });

  test('keeps a preview-pinned UI revision and its paired server artifact together', async () => {
    const serverRevisionId = uuid(557);
    const serverRevision = committed(await publish(store, TENANT_A, {
      revisionId: serverRevisionId,
      manifest: manifest({ server: true }),
      uiArtifact: artifact(TENANT_A, {
        id: uuid(558),
        kind: 'ui',
        digest: digest(111),
      }),
      serverArtifact: artifact(TENANT_A, {
        id: uuid(559),
        kind: 'server',
        digest: digest(112),
      }),
      nowMs: 10,
    }));
    committed(await publish(store, TENANT_A, {
      revisionId: uuid(560),
      expectedActiveRevisionId: serverRevisionId,
      uiArtifact: artifact(TENANT_A, {
        id: uuid(561),
        kind: 'ui',
        digest: digest(113),
      }),
      nowMs: 20,
    }));

    const chatId = uuid(562);
    const draftId = uuid(563);
    const previewId = uuid(564);
    await (await service.db.prepare(`
      INSERT INTO agent_chats (
        org_id, id, account_id, canvas_id, name, status,
        workspace_relative_path, history_relative_path, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, NULL, 'Paired preview', 'active',
        'chats/paired-preview', 'history/paired-preview.jsonl', 1, 1)
    `)).run(TENANT_A.orgId, chatId, TENANT_A.accountId);
    await (await service.db.prepare(`
      INSERT INTO agent_drafts (
        org_id, id, chat_id, name, status, source_relative_path,
        source_digest_sha256, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'Paired preview', 'ready', 'drafts/paired-preview', ?, NULL, 1, 1)
    `)).run(TENANT_A.orgId, draftId, chatId, digest(114));
    await (await service.db.prepare(`
      INSERT INTO agent_previews (
        org_id, id, draft_id, artifact_id, artifact_kind, relative_path,
        status, last_error_json, created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, ?, 'ui', 'previews/paired', 'ready', NULL, 1, 1, 1000)
    `)).run(TENANT_A.orgId, previewId, draftId, serverRevision.uiArtifact.id);

    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 100,
      inactiveBeforeMs: 100,
      limit: 100,
    })).prunedRevisionIds).toEqual([]);
    expect(await store.getRevision(TENANT_A, serverRevisionId)).toMatchObject({
      serverArtifact: { id: serverRevision.serverArtifact!.id },
    });

    await (await service.db.prepare(`
      UPDATE agent_previews SET status = 'stopped', updated_at_ms = 100
      WHERE org_id = ? AND id = ?
    `)).run(TENANT_A.orgId, previewId);
    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 100,
      inactiveBeforeMs: 100,
      limit: 100,
    })).prunedRevisionIds).toEqual([serverRevisionId]);
    const reconciled = await store.reconcileArtifactRetention(TENANT_A, {
      nowMs: 100,
      gracePeriodMs: 0,
      limit: 100,
    });
    expect(reconciled.eligibleArtifactIds).toContain(serverRevision.uiArtifact.id);
    expect(reconciled.eligibleArtifactIds).toContain(serverRevision.serverArtifact!.id);
  });

  test('activates preview artifacts behind the GC tombstone fence', async () => {
    const chatId = uuid(568);
    const draftId = uuid(569);
    const eligibleArtifactId = uuid(570);
    const deletingArtifactId = uuid(571);
    const expiredArtifactId = uuid(578);
    const eligiblePreviewId = uuid(572);
    const deletingPreviewId = uuid(573);
    const regressingPreviewId = uuid(574);
    const pinnedPreviewId = uuid(575);
    const expiredPreviewId = uuid(576);
    await (await service.db.prepare(`
      INSERT INTO artifact_references (
        org_id, id, kind, digest_sha256, byte_size,
        retention_state, retain_until_ms, created_at_ms
      ) VALUES
        (?, ?, 'ui', ?, 10, 'eligible', 100, 1),
        (?, ?, 'ui', ?, 10, 'deleting', 100, 1),
        (?, ?, 'ui', ?, 10, 'eligible', 100, 1)
    `)).run(
      TENANT_A.orgId, eligibleArtifactId, digest(115),
      TENANT_A.orgId, deletingArtifactId, digest(116),
      TENANT_A.orgId, expiredArtifactId, digest(118),
    );
    await (await service.db.prepare(`
      INSERT INTO agent_chats (
        org_id, id, account_id, canvas_id, name, status,
        workspace_relative_path, history_relative_path, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, NULL, 'Activation fence', 'active',
        'chats/activation-fence', 'history/activation-fence.jsonl', 1, 1)
    `)).run(TENANT_A.orgId, chatId, TENANT_A.accountId);
    await (await service.db.prepare(`
      INSERT INTO agent_drafts (
        org_id, id, chat_id, name, status, source_relative_path,
        source_digest_sha256, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'Activation fence', 'ready',
        'drafts/activation-fence', ?, NULL, 1, 1)
    `)).run(TENANT_A.orgId, draftId, chatId, digest(117));
    await (await service.db.prepare(`
      INSERT INTO agent_previews (
        org_id, id, draft_id, artifact_id, artifact_kind, relative_path,
        status, last_error_json, created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES
        (?, ?, ?, NULL, NULL, 'previews/activation-eligible', 'stopped', NULL, 1, 10, 1000),
        (?, ?, ?, ?, 'ui', 'previews/activation-deleting', 'stopped', NULL, 1, 10, 1000),
        (?, ?, ?, NULL, NULL, 'previews/activation-regressing', 'failed', NULL, 1, 50, 1000),
        (?, ?, ?, NULL, NULL, 'previews/activation-pinned', 'building', NULL, 1, 10, 1000),
        (?, ?, ?, NULL, NULL, 'previews/activation-expired', 'stopped', NULL, 1, 10, 20)
    `)).run(
      TENANT_A.orgId, eligiblePreviewId, draftId,
      TENANT_A.orgId, deletingPreviewId, draftId, deletingArtifactId,
      TENANT_A.orgId, regressingPreviewId, draftId,
      TENANT_A.orgId, pinnedPreviewId, draftId,
      TENANT_A.orgId, expiredPreviewId, draftId,
    );

    expect(await store.activatePreviewArtifact(TENANT_A, {
      previewId: eligiblePreviewId,
      artifactId: eligibleArtifactId,
      expectedDigestSha256: digest(115),
      nowMs: 20,
    })).toBe(true);
    expect(await (await service.db.prepare(`
      SELECT status, artifact_id, artifact_kind, updated_at_ms
      FROM agent_previews WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, eligiblePreviewId)).toEqual({
      status: 'ready',
      artifact_id: eligibleArtifactId,
      artifact_kind: 'ui',
      updated_at_ms: 20,
    });
    expect(await (await service.db.prepare(`
      SELECT retention_state, retain_until_ms
      FROM artifact_references WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, eligibleArtifactId)).toEqual({
      retention_state: 'pinned',
      retain_until_ms: null,
    });
    expect(await store.activatePreviewArtifact(TENANT_A, {
      previewId: pinnedPreviewId,
      artifactId: eligibleArtifactId,
      expectedDigestSha256: digest(115),
      nowMs: 21,
    })).toBe(true);
    expect(await store.activatePreviewArtifact(TENANT_A, {
      previewId: eligiblePreviewId,
      artifactId: eligibleArtifactId,
      expectedDigestSha256: digest(115),
      nowMs: 21,
    })).toBe(false);
    expect(await store.activatePreviewArtifact(TENANT_A, {
      previewId: expiredPreviewId,
      artifactId: expiredArtifactId,
      expectedDigestSha256: digest(118),
      nowMs: 20,
    })).toBe(false);
    expect(await (await service.db.prepare(`
      SELECT status, artifact_id, artifact_kind
      FROM agent_previews WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, expiredPreviewId)).toEqual({
      status: 'stopped',
      artifact_id: null,
      artifact_kind: null,
    });
    expect(await (await service.db.prepare(`
      SELECT retention_state, retain_until_ms
      FROM artifact_references WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, expiredArtifactId)).toEqual({
      retention_state: 'eligible',
      retain_until_ms: 100,
    });

    expect(await store.activatePreviewArtifact(TENANT_A, {
      previewId: deletingPreviewId,
      artifactId: deletingArtifactId,
      expectedDigestSha256: digest(116),
      nowMs: 20,
    })).toBe(false);
    expect(await store.activatePreviewArtifact(TENANT_A, {
      previewId: regressingPreviewId,
      artifactId: eligibleArtifactId,
      expectedDigestSha256: digest(115),
      nowMs: 49,
    })).toBe(false);
    expect(await store.activatePreviewArtifact(TENANT_A, {
      previewId: uuid(579),
      artifactId: eligibleArtifactId,
      expectedDigestSha256: digest(115),
      nowMs: 60,
    })).toBe(false);
    expect(await store.activatePreviewArtifact(TENANT_A, {
      previewId: regressingPreviewId,
      artifactId: uuid(579),
      expectedDigestSha256: digest(999),
      nowMs: 60,
    })).toBe(false);
    expect(await (await service.db.prepare(`
      SELECT status, artifact_id FROM agent_previews WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, deletingPreviewId)).toEqual({
      status: 'stopped',
      artifact_id: deletingArtifactId,
    });
    expect(await (await service.db.prepare(`
      SELECT retention_state FROM artifact_references WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, deletingArtifactId)).toEqual({ retention_state: 'deleting' });
  });

  test('serializes artifact mutation fences, rolls back nested work, and rejects cross-org nesting', async () => {
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
    const order: string[] = [];
    const first = store.runArtifactMutation(TENANT_A, async () => {
      order.push('first-entered');
      await store.createDefinition(TENANT_A, {
        id: uuid(565),
        slug: 'fenced-first',
        name: 'Fenced first',
        nowMs: 1,
      });
      markFirstEntered();
      await holdFirst;
      order.push('first-released');
    });
    await firstEntered;

    const competingStore = new WidgetControlStoreTurso(service.db);
    const second = competingStore.runArtifactMutation(TENANT_A, async () => {
      order.push('second-entered');
      await competingStore.createDefinition(TENANT_A, {
        id: uuid(566),
        slug: 'fenced-second',
        name: 'Fenced second',
        nowMs: 2,
      });
    });
    await Bun.sleep(20);
    expect(order).toEqual(['first-entered']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-entered', 'first-released', 'second-entered']);

    await expect(store.runArtifactMutation(TENANT_A, async () => {
      await store.createDefinition(TENANT_A, {
        id: uuid(567),
        slug: 'fenced-rollback',
        name: 'Fenced rollback',
        nowMs: 3,
      });
      throw new Error('rollback artifact mutation');
    })).rejects.toThrow('rollback artifact mutation');
    expect(await store.getDefinition(TENANT_A, uuid(567))).toBeNull();

    await expect(store.runArtifactMutation(TENANT_A, () => (
      store.runArtifactMutation(TENANT_B, async () => undefined)
    ))).rejects.toMatchObject({ code: 'WIDGET_ARTIFACT_MUTATION_SCOPE_MISMATCH' });
  });

  test('keeps revision pins behind the conservative durable-canvas pruning fence', async () => {
    const revisions = [uuid(451), uuid(452), uuid(453), uuid(454), uuid(455)];
    const serverArtifacts = revisions.map((_, index) => artifact(TENANT_A, {
      id: uuid(470 + index),
      kind: 'server',
      digest: digest(470 + index),
      nowMs: 10 + index,
    }));
    let active: string | null = null;
    for (const [index, revisionId] of revisions.entries()) {
      committed(await publish(store, TENANT_A, {
        revisionId,
        expectedActiveRevisionId: active,
        manifest: manifest({ server: true }),
        serverArtifact: serverArtifacts[index],
        nowMs: 10 + index,
      }));
      active = revisionId;
    }
    await (await service.db.prepare(`
      INSERT INTO canvases (
        org_id, id, name, access_policy, created_by_account_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'Retention canvas', 'org', ?, 20, 20)
    `)).run(TENANT_A.orgId, CANVAS_A, TENANT_A.accountId);

    const instances = [uuid(456), uuid(457), uuid(458)];
    for (const [index, instanceId] of instances.entries()) {
      await (await service.db.prepare(`
        INSERT INTO widget_instances (
          org_id, id, canvas_id, element_id, definition_id, revision_id,
          status, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 21, 21)
      `)).run(
        TENANT_A.orgId,
        instanceId,
        CANVAS_A,
        `element-${index}`,
        DEFINITION_A,
        revisions[index + 1],
      );
    }
    const invocationA = uuid(459);
    const invocationB = uuid(460);
    for (const [index, invocationId] of [invocationA, invocationB].entries()) {
      await (await service.db.prepare(`
        INSERT INTO function_invocations (
          org_id, id, account_id, subject_kind, canvas_id,
          widget_definition_id, widget_revision_id, widget_instance_id,
          preview_id, preview_revision_id, function_id, function_name, definition_revision,
          artifact_digest_sha256, contract_digest_sha256, runtime_abi,
          tenant_cell_id, tenant_placement_epoch, tenant_request_id,
          tenant_roles_json, tenant_capabilities_json, input_json, input_digest_sha256,
          idempotency_key, policy_version, priority, timeout_ms, memory_tier,
          output_byte_limit, log_byte_limit, retry_mode, max_attempts,
          initial_backoff_ms, max_backoff_ms, status, result_json, failure_json,
          result_digest_sha256, output_byte_size, log_byte_size, body_state,
          retains_revision, created_at_ms, available_at_ms, deadline_at_ms,
          cancel_requested_at_ms, started_at_ms, finished_at_ms, bodies_compacted_at_ms
        )
        SELECT ?, ?, ?, 'widget_instance', ?, ?, ?, ?, NULL, NULL,
          definition.id, definition.export_name,
          definition.definition_revision, definition.artifact_digest_sha256,
          definition.contract_digest_sha256, definition.runtime_abi,
          ?, 1, ?, '["owner"]', '["*"]', '{}', ?, ?, 1, 0,
          definition.timeout_ms, definition.memory_tier, definition.output_byte_limit,
          definition.log_byte_limit, definition.retry_mode, definition.max_attempts,
          definition.initial_backoff_ms, definition.max_backoff_ms,
          'queued', NULL, NULL, NULL, 0, 0, 'full', 1, 22, 22, 100,
          NULL, NULL, NULL, NULL
        FROM function_definitions AS definition
        WHERE definition.org_id = ? AND definition.widget_definition_id = ?
          AND definition.widget_revision_id = ? AND definition.export_name = 'run'
      `)).run(
        TENANT_A.orgId,
        invocationId,
        TENANT_A.accountId,
        CANVAS_A,
        DEFINITION_A,
        revisions[index + 2],
        instances[index + 1],
        TENANT_A.cellId,
        `retention-request-${index}`,
        digest(80 + index),
        `retention-key-${index}`,
        TENANT_A.orgId,
        DEFINITION_A,
        revisions[index + 2],
      );
    }
    await (await service.db.prepare(`
      INSERT INTO idempotency_records (
        org_id, id, function_id, scope_kind, canvas_id, widget_instance_id,
        preview_id, preview_revision_id, idempotency_key,
        request_fingerprint_sha256, widget_definition_id, widget_revision_id,
        invocation_id, created_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, 'organization', NULL, NULL, NULL, NULL,
        'retention-pin', ?, ?, ?, ?, 23, NULL)
    `)).run(
      TENANT_A.orgId,
      uuid(461),
      fnFunctionId(DEFINITION_A, 'run'),
      digest(82),
      DEFINITION_A,
      revisions[3],
      invocationB,
    );

    const firstPrune = await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 100,
      inactiveBeforeMs: 100,
      limit: 100,
    });
    expect(firstPrune.prunedRevisionIds).toEqual([]);
    expect(await store.getRevision(TENANT_A, revisions[0])).not.toBeNull();
    expect(await store.getRevision(TENANT_A, revisions[1])).not.toBeNull();
    expect(await store.getRevision(TENANT_A, revisions[2])).not.toBeNull();
    expect(await store.getRevision(TENANT_A, revisions[3])).not.toBeNull();
    expect(await store.getRevision(TENANT_A, revisions[4])).not.toBeNull();

    await (await service.db.prepare(`DELETE FROM idempotency_records WHERE org_id = ? AND id = ?`))
      .run(TENANT_A.orgId, uuid(461));
    await (await service.db.prepare(`DELETE FROM function_invocations WHERE org_id = ?`))
      .run(TENANT_A.orgId);
    await (await service.db.prepare(`DELETE FROM widget_instances WHERE org_id = ?`))
      .run(TENANT_A.orgId);
    await (await service.db.prepare(`DELETE FROM canvases WHERE org_id = ? AND id = ?`))
      .run(TENANT_A.orgId, CANVAS_A);
    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 100,
      inactiveBeforeMs: 100,
      limit: 100,
    })).prunedRevisionIds).toEqual(revisions.slice(0, 4));
  });

  test('keeps a rolled-back revision until an offline canvas placement can reach projection', async () => {
    const firstRevisionId = uuid(620);
    const rolledBackRevisionId = uuid(621);
    committed(await publish(store, TENANT_A, {
      definitionId: DEFINITION_B,
      revisionId: firstRevisionId,
      manifest: manifest({ slug: 'offline-placement', name: 'Offline placement' }),
      nowMs: 10,
    }));
    committed(await publish(store, TENANT_A, {
      definitionId: DEFINITION_B,
      revisionId: rolledBackRevisionId,
      expectedActiveRevisionId: firstRevisionId,
      manifest: manifest({ slug: 'offline-placement', name: 'Offline placement' }),
      nowMs: 20,
    }));
    await (await service.db.prepare(`
      INSERT INTO canvases (
        org_id, id, name, access_policy, created_by_account_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'Offline canvas', 'org', ?, 20, 20)
    `)).run(TENANT_A.orgId, CANVAS_A, TENANT_A.accountId);
    expect((await store.rollbackPublication(TENANT_A, {
      definitionId: DEFINITION_B,
      expectedActiveRevisionId: rolledBackRevisionId,
      targetRevisionId: firstRevisionId,
      nowMs: 30,
    })).status).toBe('updated');

    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 30,
      inactiveBeforeMs: 30,
      limit: 100,
    })).prunedRevisionIds).toEqual([]);
    expect(await store.getRevision(TENANT_A, rolledBackRevisionId)).not.toBeNull();

    const projectedInstanceId = uuid(622);
    await (await service.db.prepare(`
      INSERT INTO widget_instances (
        org_id, id, canvas_id, element_id, definition_id, revision_id,
        status, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'offline-element', ?, ?, 'active', 40, 40)
    `)).run(
      TENANT_A.orgId,
      projectedInstanceId,
      CANVAS_A,
      DEFINITION_B,
      rolledBackRevisionId,
    );
    expect(await store.getRevision(TENANT_A, rolledBackRevisionId)).not.toBeNull();

    await (await service.db.prepare(`DELETE FROM widget_instances WHERE org_id = ? AND id = ?`))
      .run(TENANT_A.orgId, projectedInstanceId);
    await (await service.db.prepare(`DELETE FROM canvases WHERE org_id = ? AND id = ?`))
      .run(TENANT_A.orgId, CANVAS_A);
    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 40,
      inactiveBeforeMs: 40,
      limit: 100,
    })).prunedRevisionIds).toEqual([rolledBackRevisionId]);
  });

  test('retires expired live previews at the exact boundary before artifact grace begins', async () => {
    const queuedArtifactId = uuid(580);
    const buildingArtifactId = uuid(581);
    const readyArtifactId = uuid(582);
    const unexpiredArtifactId = uuid(583);
    const queuedPreviewId = uuid(584);
    const buildingPreviewId = uuid(585);
    const readyPreviewId = uuid(586);
    const unexpiredPreviewId = uuid(587);
    const chatId = uuid(588);
    const draftId = uuid(589);
    await (await service.db.prepare(`
      INSERT INTO artifact_references (
        org_id, id, kind, digest_sha256, byte_size,
        retention_state, retain_until_ms, created_at_ms
      ) VALUES
        (?, ?, 'ui', ?, 10, 'pinned', NULL, 1),
        (?, ?, 'ui', ?, 10, 'pinned', NULL, 1),
        (?, ?, 'ui', ?, 10, 'pinned', NULL, 1),
        (?, ?, 'ui', ?, 10, 'pinned', NULL, 1)
    `)).run(
      TENANT_A.orgId, queuedArtifactId, digest(120),
      TENANT_A.orgId, buildingArtifactId, digest(121),
      TENANT_A.orgId, readyArtifactId, digest(122),
      TENANT_A.orgId, unexpiredArtifactId, digest(123),
    );
    await (await service.db.prepare(`
      INSERT INTO agent_chats (
        org_id, id, account_id, canvas_id, name, status,
        workspace_relative_path, history_relative_path, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, NULL, 'Expiry preview', 'active',
        'chats/expiry-preview', 'history/expiry-preview.jsonl', 1, 1)
    `)).run(TENANT_A.orgId, chatId, TENANT_A.accountId);
    await (await service.db.prepare(`
      INSERT INTO agent_drafts (
        org_id, id, chat_id, name, status, source_relative_path,
        source_digest_sha256, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'Expiry preview', 'ready',
        'drafts/expiry-preview', ?, NULL, 1, 1)
    `)).run(TENANT_A.orgId, draftId, chatId, digest(124));
    await (await service.db.prepare(`
      INSERT INTO agent_previews (
        org_id, id, draft_id, artifact_id, artifact_kind, relative_path,
        status, last_error_json, created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES
        (?, ?, ?, ?, 'ui', 'previews/expiry-queued', 'queued', NULL, 1, 10, 99),
        (?, ?, ?, ?, 'ui', 'previews/expiry-building', 'building', NULL, 1, 120, 100),
        (?, ?, ?, ?, 'ui', 'previews/expiry-ready', 'ready', NULL, 1, 20, 100),
        (?, ?, ?, ?, 'ui', 'previews/expiry-unexpired', 'ready', NULL, 1, 30, 101)
    `)).run(
      TENANT_A.orgId, queuedPreviewId, draftId, queuedArtifactId,
      TENANT_A.orgId, buildingPreviewId, draftId, buildingArtifactId,
      TENANT_A.orgId, readyPreviewId, draftId, readyArtifactId,
      TENANT_A.orgId, unexpiredPreviewId, draftId, unexpiredArtifactId,
    );

    const reconciled = await store.reconcileArtifactRetention(TENANT_A, {
      nowMs: 100,
      gracePeriodMs: 50,
      limit: 100,
    });
    expect([...reconciled.eligibleArtifactIds].sort()).toEqual(
      [queuedArtifactId, buildingArtifactId, readyArtifactId].sort(),
    );
    expect(await (await service.db.prepare(`
      SELECT id, status, updated_at_ms
      FROM agent_previews
      WHERE org_id = ?
      ORDER BY id ASC
    `)).all(TENANT_A.orgId)).toEqual([
      { id: queuedPreviewId, status: 'stopped', updated_at_ms: 100 },
      { id: buildingPreviewId, status: 'stopped', updated_at_ms: 120 },
      { id: readyPreviewId, status: 'stopped', updated_at_ms: 100 },
      { id: unexpiredPreviewId, status: 'ready', updated_at_ms: 30 },
    ]);
    expect(await (await service.db.prepare(`
      SELECT id, retention_state, retain_until_ms
      FROM artifact_references
      WHERE org_id = ?
      ORDER BY id ASC
    `)).all(TENANT_A.orgId)).toEqual([
      { id: queuedArtifactId, retention_state: 'eligible', retain_until_ms: 150 },
      { id: buildingArtifactId, retention_state: 'eligible', retain_until_ms: 150 },
      { id: readyArtifactId, retention_state: 'eligible', retain_until_ms: 150 },
      { id: unexpiredArtifactId, retention_state: 'pinned', retain_until_ms: null },
    ]);

    expect(await store.listArtifactGcCandidates(TENANT_A, {
      nowMs: 149,
      limit: 100,
    })).toEqual([]);
    expect(await store.claimArtifactDeletion(TENANT_A, {
      artifactId: readyArtifactId,
      expectedDigestSha256: digest(122),
      expectedRetainUntilMs: 150,
      nowMs: 149,
    })).toBeNull();
    expect(await store.claimArtifactDeletion(TENANT_A, {
      artifactId: readyArtifactId,
      expectedDigestSha256: digest(122),
      expectedRetainUntilMs: 150,
      nowMs: 150,
    })).toMatchObject({ retentionState: 'deleting' });
    expect((await store.listArtifactGcCandidates(TENANT_A, {
      nowMs: 150,
      limit: 100,
    })).map((candidate) => candidate.id).sort()).toEqual(
      [queuedArtifactId, buildingArtifactId, readyArtifactId].sort(),
    );
  });

  test('expires preview pins before the collector prunes and reconciles in one pass', async () => {
    const definitionId = uuid(590);
    const expiredRevisionId = uuid(591);
    const activeRevisionId = uuid(592);
    const expiredArtifactId = uuid(593);
    const expiredSourceArtifactId = uuid(900_010);
    const activeArtifactId = uuid(594);
    const unexpiredArtifactId = uuid(595);
    const chatId = uuid(596);
    const draftId = uuid(597);
    const expiredPreviewId = uuid(598);
    const unexpiredPreviewId = uuid(599);
    committed(await publish(store, TENANT_A, {
      definitionId,
      revisionId: expiredRevisionId,
      manifest: manifest({ slug: 'collector-expiry', name: 'Collector expiry' }),
      uiArtifact: artifact(TENANT_A, {
        id: expiredArtifactId,
        kind: 'ui',
        digest: digest(125),
        nowMs: 10,
      }),
      nowMs: 10,
    }));
    committed(await publish(store, TENANT_A, {
      definitionId,
      revisionId: activeRevisionId,
      expectedActiveRevisionId: expiredRevisionId,
      manifest: manifest({ slug: 'collector-expiry', name: 'Collector expiry' }),
      uiArtifact: artifact(TENANT_A, {
        id: activeArtifactId,
        kind: 'ui',
        digest: digest(126),
        nowMs: 20,
      }),
      nowMs: 20,
    }));
    await (await service.db.prepare(`
      INSERT INTO artifact_references (
        org_id, id, kind, digest_sha256, byte_size,
        retention_state, retain_until_ms, created_at_ms
      ) VALUES (?, ?, 'ui', ?, 10, 'pinned', NULL, 1)
    `)).run(TENANT_A.orgId, unexpiredArtifactId, digest(127));
    await (await service.db.prepare(`
      INSERT INTO agent_chats (
        org_id, id, account_id, canvas_id, name, status,
        workspace_relative_path, history_relative_path, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, NULL, 'Collector expiry', 'active',
        'chats/collector-expiry', 'history/collector-expiry.jsonl', 1, 1)
    `)).run(TENANT_A.orgId, chatId, TENANT_A.accountId);
    await (await service.db.prepare(`
      INSERT INTO agent_drafts (
        org_id, id, chat_id, name, status, source_relative_path,
        source_digest_sha256, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'Collector expiry', 'ready',
        'drafts/collector-expiry', ?, NULL, 1, 1)
    `)).run(TENANT_A.orgId, draftId, chatId, digest(128));
    await (await service.db.prepare(`
      INSERT INTO agent_previews (
        org_id, id, draft_id, artifact_id, artifact_kind, relative_path,
        status, last_error_json, created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES
        (?, ?, ?, ?, 'ui', 'previews/collector-expired', 'ready', NULL, 1, 10, 100),
        (?, ?, ?, ?, 'ui', 'previews/collector-unexpired', 'ready', NULL, 1, 10, 101)
    `)).run(
      TENANT_A.orgId, expiredPreviewId, draftId, expiredArtifactId,
      TENANT_A.orgId, unexpiredPreviewId, draftId, unexpiredArtifactId,
    );

    const pass = await store.runArtifactMutation(TENANT_A, async () => {
      const pruned = await store.pruneInactiveRevisions(TENANT_A, {
        nowMs: 100,
        inactiveBeforeMs: 100,
        limit: 100,
      });
      const reconciled = await store.reconcileArtifactRetention(TENANT_A, {
        nowMs: 100,
        gracePeriodMs: 50,
        limit: 100,
      });
      return { pruned, reconciled };
    });

    expect(pass.pruned.prunedRevisionIds).toEqual([expiredRevisionId]);
    expect([...pass.reconciled.eligibleArtifactIds].sort()).toEqual(
      [expiredArtifactId, expiredSourceArtifactId].sort(),
    );
    expect(await store.getRevision(TENANT_A, expiredRevisionId)).toBeNull();
    expect(await store.getRevision(TENANT_A, activeRevisionId)).not.toBeNull();
    expect(await (await service.db.prepare(`
      SELECT id, status, updated_at_ms
      FROM agent_previews
      WHERE org_id = ?
      ORDER BY id ASC
    `)).all(TENANT_A.orgId)).toEqual([
      { id: expiredPreviewId, status: 'stopped', updated_at_ms: 100 },
      { id: unexpiredPreviewId, status: 'ready', updated_at_ms: 10 },
    ]);
    expect(await (await service.db.prepare(`
      SELECT id, retention_state, retain_until_ms
      FROM artifact_references
      WHERE org_id = ? AND id IN (?, ?)
      ORDER BY id ASC
    `)).all(TENANT_A.orgId, expiredArtifactId, unexpiredArtifactId)).toEqual([
      { id: expiredArtifactId, retention_state: 'eligible', retain_until_ms: 150 },
      { id: unexpiredArtifactId, retention_state: 'pinned', retain_until_ms: null },
    ]);
  });

  test('reconciles preview pins and performs grace, second-check, and last-digest-reference deletion', async () => {
    const previewArtifact = uuid(471);
    const orphanUi = uuid(472);
    const sharedUi = uuid(473);
    const sharedServer = uuid(474);
    const republishArtifact = uuid(478);
    await (await service.db.prepare(`
      INSERT INTO artifact_references (
        org_id, id, kind, digest_sha256, byte_size, retention_state, retain_until_ms, created_at_ms
      ) VALUES
        (?, ?, 'ui', ?, 10, 'pinned', NULL, 1),
        (?, ?, 'ui', ?, 10, 'pinned', NULL, 1),
        (?, ?, 'ui', ?, 10, 'pinned', NULL, 1),
        (?, ?, 'server', ?, 10, 'pinned', NULL, 1),
        (?, ?, 'ui', ?, 10, 'pinned', NULL, 1)
    `)).run(
      TENANT_A.orgId, previewArtifact, digest(91),
      TENANT_A.orgId, orphanUi, digest(92),
      TENANT_A.orgId, sharedUi, digest(93),
      TENANT_A.orgId, sharedServer, digest(93),
      TENANT_A.orgId, republishArtifact, digest(95),
    );
    const chatId = uuid(475);
    const draftId = uuid(476);
    await (await service.db.prepare(`
      INSERT INTO agent_chats (
        org_id, id, account_id, canvas_id, name, status,
        workspace_relative_path, history_relative_path, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, NULL, 'Preview chat', 'active', 'chats/preview', 'history/preview.jsonl', 1, 1)
    `)).run(TENANT_A.orgId, chatId, TENANT_A.accountId);
    await (await service.db.prepare(`
      INSERT INTO agent_drafts (
        org_id, id, chat_id, name, status, source_relative_path,
        source_digest_sha256, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'Preview draft', 'ready', 'drafts/preview', ?, NULL, 1, 1)
    `)).run(TENANT_A.orgId, draftId, chatId, digest(94));
    await (await service.db.prepare(`
      INSERT INTO agent_previews (
        org_id, id, draft_id, artifact_id, artifact_kind, relative_path,
        status, last_error_json, created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, ?, 'ui', 'previews/ready', 'ready', NULL, 1, 1, 1000)
    `)).run(TENANT_A.orgId, uuid(477), draftId, previewArtifact);

    const reconciled = await store.reconcileArtifactRetention(TENANT_A, {
      nowMs: 100,
      gracePeriodMs: 50,
      limit: 100,
    });
    expect([...reconciled.eligibleArtifactIds].sort()).toEqual(
      [orphanUi, sharedUi, sharedServer, republishArtifact].sort(),
    );
    expect(reconciled.eligibleArtifactIds).not.toContain(previewArtifact);
    expect(await store.listArtifactGcCandidates(TENANT_A, { nowMs: 149, limit: 100 })).toEqual([]);

    const candidates = await store.listArtifactGcCandidates(TENANT_A, { nowMs: 150, limit: 100 });
    expect(candidates.map((candidate) => candidate.id).sort()).toEqual(
      [orphanUi, sharedUi, sharedServer, republishArtifact].sort(),
    );
    await expect(store.claimArtifactDeletion(TENANT_A, {
      artifactId: orphanUi,
      expectedDigestSha256: digest(999),
      expectedRetainUntilMs: 150,
      nowMs: 150,
    })).resolves.toBeNull();
    const orphanClaim = await store.claimArtifactDeletion(TENANT_A, {
      artifactId: orphanUi,
      expectedDigestSha256: digest(92),
      expectedRetainUntilMs: 150,
      nowMs: 150,
    });
    expect(orphanClaim).toMatchObject({ retentionState: 'deleting' });
    await (await service.db.prepare(`
      INSERT INTO agent_previews (
        org_id, id, draft_id, artifact_id, artifact_kind, relative_path,
        status, last_error_json, created_at_ms, updated_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, ?, 'ui', 'previews/late-pin', 'stopped', NULL, 1, 1, 1000)
    `)).run(TENANT_A.orgId, uuid(481), draftId, orphanUi);
    expect(await store.activatePreviewArtifact(TENANT_A, {
      previewId: uuid(481),
      artifactId: orphanUi,
      expectedDigestSha256: digest(92),
      nowMs: 150,
    })).toBe(false);
    expect(await store.completeArtifactDeletion(TENANT_A, {
      artifactId: orphanUi,
      expectedDigestSha256: digest(92),
    })).toEqual({ completed: true, deleteBlob: true });
    expect(await (await service.db.prepare(`
      SELECT artifact_id, artifact_kind, status
      FROM agent_previews WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, uuid(481))).toEqual({
      artifact_id: null,
      artifact_kind: null,
      status: 'stopped',
    });

    expect(await store.claimArtifactDeletion(TENANT_A, {
      artifactId: republishArtifact,
      expectedDigestSha256: digest(95),
      expectedRetainUntilMs: 150,
      nowMs: 150,
    })).not.toBeNull();
    expect(await store.restoreArtifactRetention(TENANT_A, {
      artifactId: republishArtifact,
      expectedDigestSha256: digest(95),
    })).toBe(true);
    expect((await store.reconcileArtifactRetention(TENANT_A, {
      nowMs: 151,
      gracePeriodMs: 0,
      limit: 100,
    })).eligibleArtifactIds).toContain(republishArtifact);
    expect(await store.claimArtifactDeletion(TENANT_A, {
      artifactId: republishArtifact,
      expectedDigestSha256: digest(95),
      expectedRetainUntilMs: 151,
      nowMs: 151,
    })).not.toBeNull();
    const republishedDefinition = uuid(479);
    await expect(publish(store, TENANT_A, {
      definitionId: republishedDefinition,
      revisionId: uuid(480),
      manifest: manifest({ slug: 'republished', name: 'Republished' }),
      uiArtifact: artifact(TENANT_A, {
        id: republishArtifact,
        kind: 'ui',
        digest: digest(95),
        byteSize: 10,
        nowMs: 1,
      }),
      nowMs: 151,
    })).rejects.toMatchObject({ code: 'WIDGET_ARTIFACT_DELETION_IN_PROGRESS' });
    expect(await store.getDefinition(TENANT_A, republishedDefinition)).toBeNull();
    expect(await store.completeArtifactDeletion(TENANT_A, {
      artifactId: republishArtifact,
      expectedDigestSha256: digest(95),
    })).toEqual({ completed: true, deleteBlob: true });
    committed(await publish(store, TENANT_A, {
      definitionId: republishedDefinition,
      revisionId: uuid(480),
      manifest: manifest({ slug: 'republished', name: 'Republished' }),
      uiArtifact: artifact(TENANT_A, {
        id: republishArtifact,
        kind: 'ui',
        digest: digest(95),
        byteSize: 10,
        nowMs: 1,
      }),
      nowMs: 151,
    }));

    const sharedUiClaim = await store.claimArtifactDeletion(TENANT_A, {
      artifactId: sharedUi,
      expectedDigestSha256: digest(93),
      expectedRetainUntilMs: 150,
      nowMs: 150,
    });
    const sharedServerClaim = await store.claimArtifactDeletion(TENANT_A, {
      artifactId: sharedServer,
      expectedDigestSha256: digest(93),
      expectedRetainUntilMs: 150,
      nowMs: 150,
    });
    expect(sharedUiClaim).not.toBeNull();
    expect(sharedServerClaim).not.toBeNull();
    expect(await store.completeArtifactDeletion(TENANT_A, {
      artifactId: sharedUi,
      expectedDigestSha256: digest(93),
    })).toEqual({ completed: true, deleteBlob: false });
    expect(await store.completeArtifactDeletion(TENANT_A, {
      artifactId: sharedServer,
      expectedDigestSha256: digest(93),
    })).toEqual({ completed: true, deleteBlob: true });

    await (await service.db.prepare(`
      UPDATE agent_previews SET status = 'stopped', updated_at_ms = 151
      WHERE org_id = ? AND artifact_id = ?
    `)).run(TENANT_A.orgId, previewArtifact);
    expect((await store.reconcileArtifactRetention(TENANT_A, {
      nowMs: 151,
      gracePeriodMs: 20,
      limit: 100,
    })).eligibleArtifactIds).toContain(previewArtifact);
    expect(await store.claimArtifactDeletion(TENANT_A, {
      artifactId: previewArtifact,
      expectedDigestSha256: digest(91),
      expectedRetainUntilMs: 171,
      nowMs: 171,
    })).not.toBeNull();
    expect(await store.completeArtifactDeletion(TENANT_A, {
      artifactId: previewArtifact,
      expectedDigestSha256: digest(91),
    })).toEqual({ completed: true, deleteBlob: true });
    expect(await (await service.db.prepare(`
      SELECT artifact_id, artifact_kind
      FROM agent_previews
      WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, uuid(477))).toEqual({ artifact_id: null, artifact_kind: null });
  });
});
