import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  IResourceControlStore,
  TDbResourceApplyRun,
  TDbResourceBackup,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TResourceBindingReference,
  TResourceKind,
} from '@vibecanvas/resource-runtime';
import { fnFreezeTenantContext, type TTenantContext } from '@vibecanvas/tenant-core';
import { DEFAULT_OSS_ACCOUNT_ID, DEFAULT_OSS_ORGANIZATION_ID } from '../CONSTANTS';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import { ResourceControlStoreTurso } from '../ResourceControlStoreTurso';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ORG_B = uuid(101);
const CELL_A = uuid(102);
const CELL_B = uuid(103);
const SHARED_RESOURCE = uuid(104);
const ORG_B_ONLY_RESOURCE = uuid(105);
const ROLLED_BACK_RESOURCE = uuid(106);
const CONFLICT_RESOURCE = uuid(107);
const DB_RESOURCE = uuid(108);
const DRAFT_A = uuid(109);
const DRAFT_B = uuid(110);
const APPLY_A = uuid(111);
const APPLY_B = uuid(112);
const BACKUP_A = uuid(113);
const BACKUP_B = uuid(114);
const DEFINITION = uuid(115);
const REVISION = uuid(116);
const UI_ARTIFACT = uuid(117);
const SECRET_RESOURCE = uuid(118);
const ENCRYPTION_KEY = uuid(119);

const TENANT_A = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: CELL_A,
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'resource-control-a',
});

const TENANT_B = fnFreezeTenantContext({
  orgId: ORG_B,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: CELL_B,
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'resource-control-b',
});

async function insertOrganization(service: DbServiceTurso, tenant: TTenantContext): Promise<void> {
  await (await service.db.prepare(`
    INSERT INTO organizations (id, slug, name, status, created_at_ms, updated_at_ms)
    VALUES (?, 'tenant-b', 'Tenant B', 'active', 0, 0)
  `)).run(tenant.orgId);
}

async function createResource(
  store: IResourceControlStore,
  tenant: TTenantContext,
  args: { id: string; kind?: TResourceKind; name: string; storageKey?: string; nowMs?: number },
) {
  return store.createResource(tenant, {
    id: args.id,
    kind: args.kind ?? 'kv',
    name: args.name,
    cellId: tenant.cellId,
    placementEpoch: tenant.placementEpoch,
    storageKey: args.storageKey ?? `resources/${args.id}.db`,
    nowMs: args.nowMs ?? 10,
  });
}

async function insertWidgetRevision(
  service: DbServiceTurso,
  tenant: TTenantContext,
): Promise<void> {
  await (await service.db.prepare(`
    INSERT INTO artifact_references (
      org_id, id, kind, digest_sha256, byte_size, retention_state, retain_until_ms, created_at_ms
    ) VALUES (?, ?, 'ui', ?, 1, 'pinned', NULL, 1)
  `)).run(tenant.orgId, UI_ARTIFACT, 'a'.repeat(64));
  await (await service.db.prepare(`
    INSERT INTO widget_definitions (
      org_id, id, slug, name, status, active_revision_id, created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'resource-test', 'Resource test', 'draft', NULL, 1, 1)
  `)).run(tenant.orgId, DEFINITION);
  await (await service.db.prepare(`
    INSERT INTO widget_definition_revisions (
      org_id, id, definition_id, revision_number, ui_artifact_id, ui_artifact_kind,
      server_artifact_id, server_artifact_kind, manifest_json, contract_digest_sha256, created_at_ms
    ) VALUES (?, ?, ?, 1, ?, 'ui', NULL, NULL, '{}', ?, 1)
  `)).run(tenant.orgId, REVISION, DEFINITION, UI_ARTIFACT, 'b'.repeat(64));
}

describe('ResourceControlStoreTurso', () => {
  let service: DbServiceTurso;
  let store: IResourceControlStore;

  beforeEach(async () => {
    service = new DbServiceTurso({ databasePath: ':memory:', dataDir: '.', cacheDir: '.' });
    await service.start();
    await insertOrganization(service, TENANT_B);
    store = new ResourceControlStoreTurso(service.db);
  });

  afterEach(async () => {
    await service.stop();
  });

  test('keeps catalog, placement, and bindings isolated across organizations', async () => {
    await createResource(store, TENANT_A, {
      id: SHARED_RESOURCE,
      name: ' Preferences ',
      storageKey: 'resources/shared.db',
    });
    await createResource(store, TENANT_B, {
      id: SHARED_RESOURCE,
      name: 'Preferences',
      storageKey: 'resources/shared.db',
    });
    await createResource(store, TENANT_B, {
      id: ORG_B_ONLY_RESOURCE,
      name: 'Tenant B only',
    });

    expect(await store.listResources(TENANT_A)).toEqual([
      expect.objectContaining({ orgId: TENANT_A.orgId, id: SHARED_RESOURCE, name: 'Preferences' }),
    ]);
    expect(await store.listResources(TENANT_B)).toHaveLength(2);
    expect(await store.getResource(TENANT_A, ORG_B_ONLY_RESOURCE)).toBeNull();
    await expect(store.renameResource(TENANT_A, {
      resourceId: SHARED_RESOURCE,
      name: ' Workspace ',
      nowMs: 11,
    })).resolves.toMatchObject({ name: 'Workspace', updatedAtMs: 11 });
    await expect(store.getResource(TENANT_B, SHARED_RESOURCE)).resolves.toMatchObject({ name: 'Preferences' });

    expect(await store.updateResourceState(TENANT_A, {
      resourceId: SHARED_RESOURCE,
      expectedStatus: 'ready',
      status: 'error',
      lastError: { code: 'RESOURCE_UNAVAILABLE', message: 'stale write' },
      nowMs: 12,
    })).toBeNull();
    await expect(store.updateResourceState(TENANT_A, {
      resourceId: SHARED_RESOURCE,
      expectedStatus: 'created',
      status: 'ready',
      lastError: null,
      nowMs: 13,
    })).resolves.toMatchObject({ status: 'ready', updatedAtMs: 13 });
    expect(await store.listResources(TENANT_A, { kind: 'kv', status: 'ready' })).toHaveLength(1);
    await expect(store.getResource(TENANT_B, SHARED_RESOURCE)).resolves.toMatchObject({ status: 'created' });

    expect(await store.updatePlacement(TENANT_A, {
      resourceId: SHARED_RESOURCE,
      expectedEpoch: 9,
      placementEpoch: 10,
      cellId: CELL_B,
      status: 'moving',
      storageKey: 'resources/moved.db',
      nowMs: 14,
    })).toBeNull();
    await expect(store.updatePlacement(TENANT_A, {
      resourceId: SHARED_RESOURCE,
      expectedEpoch: 1,
      placementEpoch: 2,
      cellId: CELL_B,
      status: 'active',
      storageKey: 'resources/moved.db',
      nowMs: 15,
    })).resolves.toMatchObject({ placementEpoch: 2, storageKey: 'resources/moved.db' });
    await expect(store.getPlacement(TENANT_B, SHARED_RESOURCE)).resolves.toMatchObject({
      placementEpoch: 1,
      storageKey: 'resources/shared.db',
    });

    await expect(createResource(store, TENANT_A, {
      id: CONFLICT_RESOURCE,
      name: 'workspace',
    })).rejects.toMatchObject({ code: 'RESOURCE_NAME_CONFLICT' });
    await createResource(store, TENANT_B, {
      id: CONFLICT_RESOURCE,
      name: 'A-only name',
    });
    await expect(createResource(store, TENANT_A, {
      id: ROLLED_BACK_RESOURCE,
      name: 'Rolled back',
      storageKey: 'resources/moved.db',
    })).rejects.toThrow();
    expect(await store.getResource(TENANT_A, ROLLED_BACK_RESOURCE)).toBeNull();

    await Promise.all([
      insertWidgetRevision(service, TENANT_A),
      insertWidgetRevision(service, TENANT_B),
    ]);
    const bindingA: TResourceBindingReference = {
      definitionId: DEFINITION,
      revisionId: REVISION,
      slot: 'preferences',
      resourceId: SHARED_RESOURCE,
      kind: 'kv',
      required: true,
      manifestAllowRead: true,
      manifestAllowWrite: true,
      allowRead: true,
      allowWrite: false,
      createdAtMs: 20,
      updatedAtMs: 20,
    };
    await store.putBinding(TENANT_A, bindingA);
    await store.putBinding(TENANT_B, { ...bindingA, allowWrite: true });
    expect(await store.listBindingsForResource(TENANT_A, SHARED_RESOURCE)).toHaveLength(1);
    await expect(store.resolveBinding(TENANT_A, bindingA)).resolves.toMatchObject({ allowWrite: false });
    await expect(store.resolveBinding(TENANT_B, bindingA)).resolves.toMatchObject({ allowWrite: true });
    expect(await store.deleteBinding(TENANT_A, bindingA)).toBe(true);
    expect(await store.resolveBinding(TENANT_A, bindingA)).toBeNull();
    expect(await store.resolveBinding(TENANT_B, bindingA)).not.toBeNull();

    await expect(store.putBinding(TENANT_A, {
      ...bindingA,
      slot: 'invalid-permissions',
      manifestAllowWrite: false,
      allowWrite: true,
    })).rejects.toThrow();

    expect(await store.deletePlacement(TENANT_B, ORG_B_ONLY_RESOURCE)).toBe(true);
    expect(await store.getPlacement(TENANT_B, ORG_B_ONLY_RESOURCE)).toBeNull();
    await expect(store.reservePlacement(TENANT_B, {
      resourceId: ORG_B_ONLY_RESOURCE,
      cellId: CELL_B,
      placementEpoch: 2,
      storageKey: 'resources/tenant-b-only-relocated.db',
      nowMs: 30,
    })).resolves.toMatchObject({ status: 'reserved', placementEpoch: 2 });

    await store.updateResourceState(TENANT_A, {
      resourceId: SHARED_RESOURCE,
      expectedStatus: 'ready',
      status: 'deleting',
      lastError: null,
      nowMs: 31,
    });
    expect(await store.deleteResource(TENANT_A, SHARED_RESOURCE)).toBe(true);
    expect(await store.getResource(TENANT_A, SHARED_RESOURCE)).toBeNull();
    expect(await store.getResource(TENANT_B, SHARED_RESOURCE)).not.toBeNull();
  });

  test('round-trips DB lifecycle records, honors constraints, and exposes neutral key custody', async () => {
    await createResource(store, TENANT_A, { id: DB_RESOURCE, kind: 'db', name: 'Application DB' });
    await store.updateResourceState(TENANT_A, {
      resourceId: DB_RESOURCE,
      expectedStatus: 'created',
      status: 'ready',
      lastError: null,
      nowMs: 11,
    });

    const draft: TDbResourceDraft = {
      orgId: TENANT_A.orgId,
      id: DRAFT_A,
      resourceId: DB_RESOURCE,
      name: 'Add items',
      status: 'editing',
      lastError: null,
      createdAtMs: 100,
      updatedAtMs: 100,
      appliedAtMs: null,
    };
    await expect(store.createDbDraft(TENANT_A, draft)).resolves.toEqual(draft);
    await expect(store.createDbDraft(TENANT_B, draft)).rejects.toThrow('different organization');
    await expect(store.createDbDraft(TENANT_A, { ...draft, id: DRAFT_B })).rejects.toThrow();

    const change: TDbResourceDraftChange = {
      orgId: TENANT_A.orgId,
      draftId: DRAFT_A,
      sequence: 1,
      kind: 'structure',
      operation: {
        kind: 'createTable',
        table: 'items',
        columns: [{ name: 'id', declaredType: 'INTEGER', primaryKeyOrder: 1 }],
      },
      sql: 'CREATE TABLE items (id INTEGER PRIMARY KEY)',
      createdAtMs: 101,
    };
    await expect(store.appendDbDraftChange(TENANT_A, change)).resolves.toEqual(change);
    expect(await store.listDbDrafts(TENANT_A, { resourceId: DB_RESOURCE, status: 'editing' })).toEqual([draft]);
    expect(await store.listDbDraftChanges(TENANT_B, DRAFT_A)).toEqual([]);

    const apply: TDbResourceApplyRun = {
      orgId: TENANT_A.orgId,
      id: APPLY_A,
      resourceId: DB_RESOURCE,
      draftId: DRAFT_A,
      sourceApplyId: null,
      status: 'preparing',
      lastError: null,
      backupRetained: false,
      createdAtMs: 110,
      completedAtMs: null,
    };
    await expect(store.createDbApply(TENANT_A, apply)).resolves.toEqual(apply);
    expect(await store.listDbApplies(TENANT_A, { resourceId: DB_RESOURCE })).toEqual([apply]);
    expect(await store.updateDbApply(TENANT_A, {
      applyId: APPLY_A,
      expectedStatus: 'applying',
      status: 'succeeded',
      lastError: null,
      backupRetained: true,
      completedAtMs: 120,
    })).toBeNull();
    await expect(store.updateDbApply(TENANT_A, {
      applyId: APPLY_A,
      expectedStatus: ['preparing', 'stopping'],
      status: 'succeeded',
      lastError: null,
      backupRetained: true,
      completedAtMs: 120,
    })).resolves.toMatchObject({ status: 'succeeded', backupRetained: true, completedAtMs: 120 });
    await expect(store.updateDbDraft(TENANT_A, {
      draftId: DRAFT_A,
      expectedStatus: 'editing',
      status: 'applied',
      lastError: null,
      appliedAtMs: 121,
      nowMs: 121,
    })).resolves.toMatchObject({ status: 'applied', appliedAtMs: 121 });

    const backup: TDbResourceBackup = {
      orgId: TENANT_A.orgId,
      id: BACKUP_A,
      resourceId: DB_RESOURCE,
      applyRunId: APPLY_A,
      storageKey: 'resources/backups/apply-a.db',
      digestSha256: 'c'.repeat(64),
      byteSize: 42,
      state: 'retained',
      createdAtMs: 130,
      verifiedAtMs: 131,
      deleteAfterMs: 1_000,
    };
    await expect(store.createDbBackup(TENANT_A, backup)).resolves.toEqual(backup);
    expect(await store.getDbBackup(TENANT_B, {
      resourceId: DB_RESOURCE,
      applyRunId: APPLY_A,
    })).toBeNull();
    await expect(store.updateDbBackup(TENANT_A, {
      ...backup,
      state: 'deleting',
      deleteAfterMs: null,
    })).resolves.toMatchObject({ state: 'deleting', deleteAfterMs: null });

    const completedApply: TDbResourceApplyRun = {
      ...apply,
      id: APPLY_B,
      draftId: null,
      status: 'succeeded',
      backupRetained: true,
      createdAtMs: 140,
      completedAtMs: 140,
    };
    await store.createDbApply(TENANT_A, completedApply);
    await expect(store.createDbBackup(TENANT_A, {
      ...backup,
      id: BACKUP_B,
      applyRunId: APPLY_B,
      storageKey: 'resources/backups/apply-b.db',
      digestSha256: 'invalid',
    })).rejects.toThrow();
    expect(await store.listDbBackups(TENANT_A, DB_RESOURCE)).toEqual([
      expect.objectContaining({ id: BACKUP_A, state: 'deleting' }),
    ]);

    await createResource(store, TENANT_A, {
      id: SECRET_RESOURCE,
      kind: 'secretStore',
      name: 'Secrets',
    });
    const tenantDb = service.forTenant(TENANT_A);
    const key = await tenantDb.resourceEncryptionKey.getOrCreate({
      resourceId: SECRET_RESOURCE,
      keyId: ENCRYPTION_KEY,
      purpose: 'actor-resource-secret-store',
      algorithm: 'aegis256',
      keyHex: 'd'.repeat(64),
    });
    expect(key.key_hex).toBe('d'.repeat(64));
    await expect(tenantDb.actorResourceEncryptionKey.get({ resourceId: SECRET_RESOURCE }))
      .resolves.toEqual(key);
    await expect(service.forTenant(TENANT_B).resourceEncryptionKey.get({ resourceId: SECRET_RESOURCE }))
      .resolves.toBeNull();
  });
});
