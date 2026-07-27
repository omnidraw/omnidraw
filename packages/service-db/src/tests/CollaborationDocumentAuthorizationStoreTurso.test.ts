import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import { CollaborationDocumentAuthorizationStoreTurso } from '../CollaborationDocumentAuthorizationStoreTurso';
import { DEFAULT_OSS_ACCOUNT_ID, DEFAULT_OSS_ORGANIZATION_ID } from '../CONSTANTS';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import {
  WIDGET_CAPSULE_ARTIFACT_HASH,
  WIDGET_CAPSULE_BUILD_IDENTITY_JSON,
  WIDGET_CAPSULE_BUILD_POLICY_ID,
  WIDGET_CAPSULE_CAPABILITY_DIGEST,
  WIDGET_CAPSULE_CHANNEL_DIGEST,
  WIDGET_CAPSULE_RUNTIME_JSON,
  widgetManifestV3Json,
} from './widget-capsule-fixture';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const CANVAS_ID = uuid(910);
const DEFINITION_ID = uuid(911);
const REVISION_ID = uuid(912);
const UI_ARTIFACT_ID = uuid(913);
const INSTANCE_ID = uuid(914);
const STATE_DOCUMENT_ID = uuid(915);
const CANVAS_URL = 'automerge:authorization-canvas';
const STATE_URL = 'automerge:authorization-widget-state';

const TENANT = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: uuid(916),
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'document-authorization-owner',
});

const SAME_ORG_NONMEMBER = fnFreezeTenantContext({
  ...TENANT,
  accountId: uuid(917),
  requestId: 'document-authorization-nonmember',
});

const FOREIGN_TENANT = fnFreezeTenantContext({
  ...TENANT,
  orgId: uuid(918),
  requestId: 'document-authorization-foreign',
});

const WRONG_CANVAS_TENANT = fnFreezeTenantContext({
  ...TENANT,
  canvasId: uuid(919),
  requestId: 'document-authorization-wrong-canvas',
});

const CANVAS_TENANT = fnFreezeTenantContext({
  ...TENANT,
  canvasId: CANVAS_ID,
  requestId: 'document-authorization-canvas-bound',
});

async function seedWidgetStateDocument(service: DbServiceTurso): Promise<void> {
  await (await service.db.prepare(`
    INSERT INTO widget_instance_projection_heads (
      org_id, canvas_id, source_sequence, snapshot_digest_sha256, projected_at_ms
    )
    SELECT org_id, canvas_id, content_version, ?, 1
    FROM collaboration_documents
    WHERE org_id = ? AND canvas_id = ?
  `)).run('c'.repeat(64), TENANT.orgId, CANVAS_ID);
  await (await service.db.prepare(`
    INSERT INTO artifact_references (
      org_id, id, kind, digest_sha256, byte_size,
      retention_state, retain_until_ms, created_at_ms
    ) VALUES (?, ?, 'ui', ?, 1, 'pinned', NULL, 1)
  `)).run(TENANT.orgId, UI_ARTIFACT_ID, 'a'.repeat(64));
  await (await service.db.prepare(`
    INSERT INTO widget_definitions (
      org_id, id, slug, name, status, active_revision_id, created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'authorization-widget', 'Authorization Widget', 'draft', NULL, 1, 1)
  `)).run(TENANT.orgId, DEFINITION_ID);
  await (await service.db.prepare(`
    INSERT INTO widget_definition_revisions (
      org_id, id, definition_id, revision_number, ui_artifact_id,
      ui_artifact_kind, server_artifact_id, server_artifact_kind,
      manifest_json, contract_digest_sha256, created_at_ms,
      ui_runtime_json, capsule_artifact_hash,
      capability_contract_digest_sha256, channel_contract_digest_sha256,
      capsule_build_identity_json, build_policy_id, server_runtime_abi,
      contract_format_version
    ) VALUES (
      ?, ?, ?, 1, ?, 'ui', NULL, NULL, ?, ?, 1,
      ?, ?, ?, ?, ?, ?, NULL, 3
    )
  `)).run(
    TENANT.orgId,
    REVISION_ID,
    DEFINITION_ID,
    UI_ARTIFACT_ID,
    widgetManifestV3Json({
      name: 'Authorization Widget',
      slug: 'authorization-widget',
    }),
    'b'.repeat(64),
    WIDGET_CAPSULE_RUNTIME_JSON,
    WIDGET_CAPSULE_ARTIFACT_HASH,
    WIDGET_CAPSULE_CAPABILITY_DIGEST,
    WIDGET_CAPSULE_CHANNEL_DIGEST,
    WIDGET_CAPSULE_BUILD_IDENTITY_JSON,
    WIDGET_CAPSULE_BUILD_POLICY_ID,
  );
  await (await service.db.prepare(`
    UPDATE widget_definitions
    SET status = 'published', active_revision_id = ?, updated_at_ms = 2
    WHERE org_id = ? AND id = ?
  `)).run(REVISION_ID, TENANT.orgId, DEFINITION_ID);
  await (await service.db.prepare(`
    INSERT INTO widget_instances (
      org_id, id, canvas_id, element_id, definition_id, revision_id,
      status, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, 'authorization-element', ?, ?, 'active', 3, 3)
  `)).run(TENANT.orgId, INSTANCE_ID, CANVAS_ID, DEFINITION_ID, REVISION_ID);
  await (await service.db.prepare(`
    INSERT INTO collaboration_documents (
      org_id, id, canvas_id, widget_instance_id, automerge_url, partition_key,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, NULL, ?, ?, ?, 4, 4)
  `)).run(TENANT.orgId, STATE_DOCUMENT_ID, INSTANCE_ID, STATE_URL, TENANT.orgId);
}

describe('CollaborationDocumentAuthorizationStoreTurso', () => {
  let service: DbServiceTurso;
  let store: CollaborationDocumentAuthorizationStoreTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ databasePath: ':memory:', dataDir: '.', cacheDir: '.' });
    await service.start();
    await service.canvas.create(TENANT, {
      id: CANVAS_ID,
      name: 'Authorization Canvas',
      automerge_url: CANVAS_URL,
    });
    await seedWidgetStateDocument(service);
    store = new CollaborationDocumentAuthorizationStoreTurso(service.db);
  });

  afterEach(async () => {
    await service.stop();
  });

  test('authorizes exact member-owned canvas and active widget-state documents only', async () => {
    expect(await store.authorizeDocument(TENANT, CANVAS_URL)).toBe(true);
    await expect(store.authorizeDocument(TENANT, STATE_URL)).resolves.toBe(true);
    await expect(store.authorizeDocument(CANVAS_TENANT, CANVAS_URL)).resolves.toBe(true);
    await expect(store.authorizeDocument(CANVAS_TENANT, STATE_URL)).resolves.toBe(true);
    await expect(store.authorizeDocument(TENANT, `${STATE_URL}-near-miss`)).resolves.toBe(false);
    await expect(store.authorizeDocument(WRONG_CANVAS_TENANT, CANVAS_URL)).resolves.toBe(false);
    await expect(store.authorizeDocument(WRONG_CANVAS_TENANT, STATE_URL)).resolves.toBe(false);

    await expect(store.authorizeDocument(SAME_ORG_NONMEMBER, CANVAS_URL)).resolves.toBe(false);
    await expect(store.authorizeDocument(SAME_ORG_NONMEMBER, STATE_URL)).resolves.toBe(false);
    await expect(store.authorizeDocument(FOREIGN_TENANT, CANVAS_URL)).resolves.toBe(false);
    await expect(store.authorizeDocument(FOREIGN_TENANT, STATE_URL)).resolves.toBe(false);

    await (await service.db.prepare(`
      UPDATE widget_instances
      SET status = 'archived', updated_at_ms = 5
      WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, INSTANCE_ID);
    await expect(store.authorizeDocument(TENANT, STATE_URL)).resolves.toBe(false);
    await expect(store.authorizeDocument(TENANT, CANVAS_URL)).resolves.toBe(true);
  });

  test('denies widget state while the durable canvas projection is behind', async () => {
    await expect(store.authorizeDocument(TENANT, STATE_URL)).resolves.toBe(true);
    await (await service.db.prepare(`
      UPDATE collaboration_documents
      SET content_version = content_version + 1
      WHERE org_id = ? AND canvas_id = ?
    `)).run(TENANT.orgId, CANVAS_ID);

    await expect(store.authorizeDocument(TENANT, STATE_URL)).resolves.toBe(false);
    await expect(store.authorizeDocument(TENANT, CANVAS_URL)).resolves.toBe(true);
  });
});
