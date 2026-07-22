import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
} from '@vibecanvas/widget-contract';
import type { TWidgetArtifactDescriptor, TWidgetManifestV2 } from '@vibecanvas/widget-contract';
import { AgentAuthoringStoreTurso } from '../AgentAuthoringStoreTurso';
import { DEFAULT_OSS_ACCOUNT_ID, DEFAULT_OSS_ORGANIZATION_ID } from '../CONSTANTS';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import { WidgetControlStoreTurso } from '../WidgetControlStoreTurso';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const digest = (value: number) => value.toString(16).padStart(64, '0');

const TENANT = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: uuid(800),
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'agent-authoring-store-test',
});

const OTHER_ACCOUNT_TENANT = fnFreezeTenantContext({
  ...TENANT,
  accountId: uuid(801),
  requestId: 'agent-authoring-store-other-account',
});

function artifact(
  id: string,
  kind: 'source' | 'ui',
  digestSha256: string,
  createdAtMs: number,
): TWidgetArtifactDescriptor {
  return {
    orgId: TENANT.orgId,
    id,
    kind,
    digestSha256,
    byteSize: 100,
    retentionState: 'pinned',
    retainUntilMs: null,
    createdAtMs,
  };
}

async function insertPublishedRevision(
  service: DbServiceTurso,
  args: Readonly<{
    definitionId: string;
    revisionId: string;
    uiArtifactId: string;
    sourceArtifactId: string;
    sourceSnapshotId: string;
    sourceDigestSha256: string;
    ordinal: number;
  }>,
): Promise<void> {
  await (await service.db.prepare(`
    INSERT INTO artifact_references (
      org_id, id, kind, digest_sha256, byte_size,
      retention_state, retain_until_ms, created_at_ms
    ) VALUES (?, ?, 'ui', ?, 1, 'pinned', NULL, ?)
  `)).run(TENANT.orgId, args.uiArtifactId, digest(args.ordinal), args.ordinal);
  await (await service.db.prepare(`
    INSERT INTO artifact_references (
      org_id, id, kind, digest_sha256, byte_size,
      retention_state, retain_until_ms, created_at_ms
    ) VALUES (?, ?, 'source', ?, 1, 'pinned', NULL, ?)
  `)).run(TENANT.orgId, args.sourceArtifactId, args.sourceDigestSha256, args.ordinal);
  await (await service.db.prepare(`
    INSERT INTO widget_definitions (
      org_id, id, slug, name, status, active_revision_id, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'draft', NULL, ?, ?)
  `)).run(
    TENANT.orgId,
    args.definitionId,
    `seeded-${args.ordinal}`,
    `Seeded ${args.ordinal}`,
    args.ordinal,
    args.ordinal,
  );
  await (await service.db.prepare(`
    INSERT INTO widget_definition_revisions (
      org_id, id, definition_id, revision_number, ui_artifact_id, ui_artifact_kind,
      server_artifact_id, server_artifact_kind, manifest_json,
      contract_digest_sha256, created_at_ms
    ) VALUES (?, ?, ?, 1, ?, 'ui', NULL, NULL, '{}', ?, ?)
  `)).run(
    TENANT.orgId,
    args.revisionId,
    args.definitionId,
    args.uiArtifactId,
    digest(args.ordinal + 1_000),
    args.ordinal,
  );
  await (await service.db.prepare(`
    INSERT INTO widget_revision_sources (
      org_id, definition_id, revision_id, source_snapshot_id,
      source_artifact_id, source_artifact_kind, source_digest_sha256,
      builder_identity, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, 'source', ?, 'test-builder/1', ?)
  `)).run(
    TENANT.orgId,
    args.definitionId,
    args.revisionId,
    args.sourceSnapshotId,
    args.sourceArtifactId,
    args.sourceDigestSha256,
    args.ordinal,
  );
  await (await service.db.prepare(`
    UPDATE widget_definitions
    SET status = 'published', active_revision_id = ?, updated_at_ms = ?
    WHERE org_id = ? AND id = ?
  `)).run(args.revisionId, args.ordinal, TENANT.orgId, args.definitionId);
}

describe('AgentAuthoringStoreTurso', () => {
  let root: string;
  let service: DbServiceTurso;
  let controlStore: WidgetControlStoreTurso;
  let store: AgentAuthoringStoreTurso;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vibecanvas-agent-authoring-store-'));
    service = new DbServiceTurso({
      databasePath: path.join(root, 'main.db'),
      dataDir: root,
      cacheDir: path.join(root, 'cache'),
    });
    await service.start();
    controlStore = new WidgetControlStoreTurso(service.db);
    store = new AgentAuthoringStoreTurso(service.db, controlStore);
  });

  afterEach(async () => {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  });

  test('owns account-qualified chats and stable drafts through rename, preview, discard, and GC', async () => {
    const chatId = uuid(802);
    const draftId = uuid(803);
    const definitionId = uuid(804);
    const previewId = uuid(805);
    const previewRevisionId = uuid(806);
    const sourceArtifactId = uuid(807);
    const uiArtifactId = uuid(808);
    const initialDigest = digest(809);
    const renamedDigest = digest(810);
    const restartRenamedDigest = digest(899);

    await store.createChat(TENANT, {
      id: chatId,
      canvasId: null,
      externalSessionKey: 'external-session-1',
      name: 'Weather',
      workspaceRelativePath: 'chats/weather',
      historyRelativePath: 'history/weather.jsonl',
      nowMs: 1,
    });
    expect(await store.getChatByExternalSessionKey(TENANT, 'external-session-1'))
      .toMatchObject({ id: chatId, accountId: TENANT.accountId });
    expect(await store.getChat(OTHER_ACCOUNT_TENANT, chatId)).toBeNull();

    await store.createDraft(TENANT, {
      id: draftId,
      chatId,
      definitionId,
      name: 'Weather',
      sourceRelativePath: 'drafts/weather',
      nowMs: 2,
    });
    const initialized = await store.compareAndSetDraft(TENANT, {
      draftId,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: initialDigest,
      nextStatus: 'ready',
      nowMs: 3,
    });
    expect(initialized).toMatchObject({ status: 'updated', draft: { definitionId } });

    const renamed = await store.renameDraft(TENANT, {
      draftId,
      expectedName: 'Weather',
      nextName: 'Weather Plus',
      nextSourceRelativePath: 'drafts/weather-plus',
      expectedSourceDigestSha256: initialDigest,
      nextSourceDigestSha256: renamedDigest,
      nowMs: 4,
    });
    expect(renamed).toMatchObject({
      status: 'updated',
      draft: { id: draftId, definitionId, name: 'Weather Plus', sourceDigestSha256: renamedDigest },
    });
    expect(await store.getDraftByName(TENANT, 'Weather Plus')).toMatchObject({ id: draftId });
    expect(await store.listDrafts(TENANT)).toHaveLength(1);

    const manifest: TWidgetManifestV2 = {
      schemaVersion: 2,
      name: 'Weather Plus',
      slug: 'weather-plus',
      ui: { entry: 'src/ui.tsx' },
    };
    const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
    const canonicalFunctions = fnCanonicalizeWidgetServerFunctionDescriptors([]);
    const functionDescriptorsDigestSha256 = createHash('sha256')
      .update(canonicalFunctions)
      .digest('hex');
    const uiDigest = digest(811);
    const contractDigestSha256 = createHash('sha256')
      .update(fnCanonicalizeWidgetContractPayload({
        canonicalManifestJson,
        uiDigestSha256: uiDigest,
        serverDigestSha256: null,
        runtimeAbi: null,
        functionDescriptorsDigestSha256,
      }))
      .digest('hex');
    const committed = await store.commitPreview(TENANT, {
      expectedActiveRevisionId: null,
      revision: {
        id: previewRevisionId,
        previewId,
        draftId,
        definitionId,
        draftRevisionSha256: renamedDigest,
        sourceSnapshotId: uuid(812),
        sourceDigestSha256: renamedDigest,
        sourceArtifact: artifact(sourceArtifactId, 'source', digest(813), 20),
        manifest,
        canonicalManifestJson,
        functionDescriptors: [],
        functionDescriptorsDigestSha256,
        contractDigestSha256,
        builderIdentity: 'agent-authoring-test-builder',
        uiArtifact: artifact(uiArtifactId, 'ui', uiDigest, 20),
        serverArtifact: null,
        createdAtMs: 20,
        retainUntilMs: 200,
        expiresAtMs: 100,
      },
      bindings: [],
      nowMs: 20,
    });
    expect(committed).toMatchObject({
      status: 'committed',
      revision: { id: previewRevisionId, previewId, draftId, definitionId },
    });
    if (committed.status !== 'committed') throw new Error('Expected Preview commit.');
    expect(await store.getPreview(TENANT, { previewId, nowMs: 21 }))
      .toMatchObject({ id: previewRevisionId, sourceArtifact: { id: sourceArtifactId } });
    expect(await store.getPreview(OTHER_ACCOUNT_TENANT, { previewId, nowMs: 21 })).toBeNull();

    expect(await store.renameDraft(TENANT, {
      draftId,
      expectedName: 'Weather Plus',
      nextName: 'Weather Restart Renamed',
      nextSourceRelativePath: 'drafts/weather-restart-renamed',
      expectedSourceDigestSha256: renamedDigest,
      nextSourceDigestSha256: restartRenamedDigest,
      nowMs: 22,
    })).toMatchObject({
      status: 'updated',
      draft: { id: draftId, name: 'Weather Restart Renamed' },
    });
    expect(await store.getPreview(TENANT, { previewId, nowMs: 23 })).toBeNull();
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId: previewRevisionId,
      nowMs: 23,
    })).toMatchObject({ id: previewRevisionId });

    const discarded = await store.discardDraft(TENANT, {
      draftId,
      expectedSourceDigestSha256: restartRenamedDigest,
      nowMs: 30,
    });
    expect(discarded).toMatchObject({ status: 'updated', draft: { status: 'discarded' } });
    expect(await store.getPreview(TENANT, { previewId, nowMs: 31 })).toBeNull();
    expect(await store.compareAndSetDraft(TENANT, {
      draftId,
      expectedSourceDigestSha256: restartRenamedDigest,
      nextSourceDigestSha256: digest(814),
      nextStatus: 'ready',
      nowMs: 31,
    })).toMatchObject({ status: 'conflict', current: { status: 'discarded' } });
    await expect(store.commitPreview(TENANT, {
      expectedActiveRevisionId: null,
      revision: {
        ...committed.revision,
        id: uuid(815),
        previewId: uuid(816),
        createdAtMs: 32,
        retainUntilMs: 200,
        expiresAtMs: 100,
      },
      bindings: [],
      nowMs: 32,
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_DRAFT_STALE' });
    expect(await store.getPreview(TENANT, { previewId: uuid(816), nowMs: 33 })).toBeNull();
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId: previewRevisionId,
      nowMs: 199,
    })).toMatchObject({ id: previewRevisionId });

    const retained = await controlStore.reconcileArtifactRetention(TENANT, {
      nowMs: 199,
      gracePeriodMs: 10,
      limit: 100,
    });
    expect(retained.eligibleArtifactIds).not.toContain(sourceArtifactId);
    expect(retained.eligibleArtifactIds).not.toContain(uiArtifactId);
    const released = await controlStore.reconcileArtifactRetention(TENANT, {
      nowMs: 200,
      gracePeriodMs: 10,
      limit: 100,
    });
    expect([...released.eligibleArtifactIds].sort()).toEqual(
      [sourceArtifactId, uiArtifactId].sort(),
    );
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId: previewRevisionId,
      nowMs: 200,
    })).toBeNull();
  });

  test('recreates a discarded source path by reviving its stable durable identity', async () => {
    const chatId = uuid(830);
    const draftId = uuid(831);
    const definitionId = uuid(832);
    await store.createChat(TENANT, {
      id: chatId,
      canvasId: null,
      externalSessionKey: 'recreate-discarded-draft',
      name: 'Recreate draft',
      workspaceRelativePath: 'chats/recreate',
      historyRelativePath: 'history/recreate.jsonl',
      nowMs: 1,
    });
    await store.createDraft(TENANT, {
      id: draftId,
      chatId,
      definitionId,
      name: 'Timer',
      sourceRelativePath: 'drafts/timer',
      nowMs: 2,
    });
    const initialized = await store.compareAndSetDraft(TENANT, {
      draftId,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: digest(833),
      nextStatus: 'ready',
      nowMs: 3,
    });
    expect(initialized).toMatchObject({ status: 'updated' });
    expect(await store.discardDraft(TENANT, {
      draftId,
      expectedSourceDigestSha256: digest(833),
      nowMs: 4,
    })).toMatchObject({ status: 'updated', draft: { status: 'discarded' } });

    const recreated = await store.createDraft(TENANT, {
      id: uuid(834),
      chatId,
      definitionId: uuid(835),
      name: 'Timer',
      sourceRelativePath: 'drafts/timer',
      nowMs: 5,
    });

    expect(recreated).toMatchObject({
      id: draftId,
      definitionId,
      name: 'Timer',
      status: 'editing',
      sourceDigestSha256: null,
      publishedRevisionId: null,
    });
    expect(await store.listDrafts(TENANT)).toHaveLength(1);
  });

  test('atomically creates and revives a draft from an exact publication seed', async () => {
    const chatId = uuid(840);
    const draftId = uuid(841);
    const firstDefinitionId = uuid(842);
    const firstRevisionId = uuid(843);
    const firstDigest = digest(844);
    const secondDefinitionId = uuid(845);
    const secondRevisionId = uuid(846);
    const secondDigest = digest(847);
    await store.createChat(TENANT, {
      id: chatId,
      canvasId: null,
      externalSessionKey: 'publication-seed-draft',
      name: 'Publication seed draft',
      workspaceRelativePath: 'chats/publication-seed',
      historyRelativePath: 'history/publication-seed.jsonl',
      nowMs: 1,
    });
    await insertPublishedRevision(service, {
      definitionId: firstDefinitionId,
      revisionId: firstRevisionId,
      uiArtifactId: uuid(848),
      sourceArtifactId: uuid(852),
      sourceSnapshotId: uuid(854),
      sourceDigestSha256: firstDigest,
      ordinal: 10,
    });
    await insertPublishedRevision(service, {
      definitionId: secondDefinitionId,
      revisionId: secondRevisionId,
      uiArtifactId: uuid(849),
      sourceArtifactId: uuid(853),
      sourceSnapshotId: uuid(855),
      sourceDigestSha256: secondDigest,
      ordinal: 20,
    });

    await expect(store.createDraft(TENANT, {
      id: uuid(856),
      chatId,
      name: 'False Seeded Timer',
      sourceRelativePath: 'drafts/false-seeded-timer',
      publicationSeed: {
        definitionId: firstDefinitionId,
        publishedRevisionId: firstRevisionId,
        sourceDigestSha256: secondDigest,
      },
      nowMs: 29,
    })).rejects.toMatchObject({ code: 'AGENT_DRAFT_PUBLICATION_NOT_FOUND' });
    await (await service.db.prepare(`
      UPDATE widget_definitions
      SET status = 'archived', active_revision_id = NULL
      WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, firstDefinitionId);
    await expect(store.createDraft(TENANT, {
      id: uuid(857),
      chatId,
      name: 'Archived Seeded Timer',
      sourceRelativePath: 'drafts/archived-seeded-timer',
      publicationSeed: {
        definitionId: firstDefinitionId,
        publishedRevisionId: firstRevisionId,
        sourceDigestSha256: firstDigest,
      },
      nowMs: 29,
    })).rejects.toMatchObject({ code: 'AGENT_DRAFT_PUBLICATION_NOT_FOUND' });
    await (await service.db.prepare(`
      UPDATE widget_definitions
      SET status = 'published', active_revision_id = ?
      WHERE org_id = ? AND id = ?
    `)).run(firstRevisionId, TENANT.orgId, firstDefinitionId);

    const created = await store.createDraft(TENANT, {
      id: draftId,
      chatId,
      name: 'Seeded Timer',
      sourceRelativePath: 'drafts/seeded-timer',
      publicationSeed: {
        definitionId: firstDefinitionId,
        publishedRevisionId: firstRevisionId,
        sourceDigestSha256: firstDigest,
      },
      nowMs: 30,
    });
    expect(created).toMatchObject({
      id: draftId,
      definitionId: firstDefinitionId,
      publishedRevisionId: firstRevisionId,
      sourceDigestSha256: firstDigest,
      status: 'published',
    });
    expect(await store.discardDraft(TENANT, {
      draftId,
      expectedSourceDigestSha256: firstDigest,
      nowMs: 31,
    })).toMatchObject({ status: 'updated' });

    await expect(store.createDraft(TENANT, {
      id: uuid(850),
      chatId,
      name: 'Seeded Timer',
      sourceRelativePath: 'drafts/seeded-timer',
      publicationSeed: {
        definitionId: secondDefinitionId,
        publishedRevisionId: firstRevisionId,
        sourceDigestSha256: secondDigest,
      },
      nowMs: 32,
    })).rejects.toMatchObject({ code: 'AGENT_DRAFT_PUBLICATION_NOT_FOUND' });
    expect(await store.getDraft(TENANT, draftId)).toMatchObject({
      status: 'discarded',
      definitionId: firstDefinitionId,
    });

    const revived = await store.createDraft(TENANT, {
      id: uuid(851),
      chatId,
      name: 'Seeded Timer',
      sourceRelativePath: 'drafts/seeded-timer',
      publicationSeed: {
        definitionId: secondDefinitionId,
        publishedRevisionId: secondRevisionId,
        sourceDigestSha256: secondDigest,
      },
      nowMs: 33,
    });
    expect(revived).toMatchObject({
      id: draftId,
      definitionId: secondDefinitionId,
      publishedRevisionId: secondRevisionId,
      sourceDigestSha256: secondDigest,
      status: 'published',
    });
  });
});
