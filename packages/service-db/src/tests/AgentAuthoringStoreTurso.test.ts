import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetConstructionContractPayload,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnWidgetPreviewBindingPlanDigest,
} from '@vibecanvas/widget-contract';
import type {
  TWidgetArtifactDescriptor,
  TWidgetCapsuleBuildIdentity,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetDistributionBuildProvenance,
  TWidgetManifestV3,
  TWidgetPreviewRevisionCreate,
} from '@vibecanvas/widget-contract';
import {
  AgentAuthoringStoreTurso,
  type TWidgetPreviewRuntimeDiagnosticRecord,
} from '../AgentAuthoringStoreTurso';
import { DEFAULT_OSS_ACCOUNT_ID, DEFAULT_OSS_ORGANIZATION_ID } from '../CONSTANTS';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import { WidgetControlStoreTurso } from '../WidgetControlStoreTurso';
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

const OTHER_ORGANIZATION_TENANT = fnFreezeTenantContext({
  ...TENANT,
  orgId: uuid(802),
  requestId: 'agent-authoring-store-other-organization',
});

function artifact(
  id: string,
  kind: 'source' | 'unsigned_ui' | 'ui' | 'server',
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function previewRevision(args: Readonly<{
  id: string;
  previewId: string;
  draftId: string;
  definitionId: string;
  sourceSnapshotId: string;
  sourceDigestSha256: string;
  committedMutationId: string;
  sourceArtifactId: string;
  unsignedUiArtifactId: string;
  uiArtifactId: string;
  buildSequence: number;
  bindingRevision?: number;
  bindingPlanDigestSha256?: string;
  createdAtMs: number;
  withResource?: boolean;
}>): TWidgetPreviewRevisionCreate {
  const manifest = {
    ...JSON.parse(widgetManifestV3Json({
      name: 'Preview timer',
      slug: 'preview-timer',
    })),
    ...(args.withResource === true
      ? {
          resources: [{
            slot: 'preferences',
            kind: 'kv',
            effect: 'read',
            required: true,
          }],
        }
      : {}),
  } as TWidgetManifestV3;
  const canonicalManifestJson = fnCanonicalizeWidgetManifest(manifest);
  const functionDescriptors:
    TWidgetPreviewRevisionCreate['functionDescriptors'] = [];
  const functionDescriptorsJson =
    fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors);
  const capsuleBuildIdentity =
    JSON.parse(WIDGET_CAPSULE_BUILD_IDENTITY_JSON) as TWidgetCapsuleBuildIdentity;
  const uiRuntime = {
    ...JSON.parse(WIDGET_CAPSULE_RUNTIME_JSON),
    signatureKeyIds: ['vibecanvas-preview-v1'],
  } as TWidgetCapsuleRuntimeDescriptor;
  const distributionProvenance: TWidgetDistributionBuildProvenance = {
    kind: 'external-distribution',
    producer: {
      name: 'service-db-preview-test',
      version: '1.0.0',
      digest: `sha256:${'1'.repeat(64)}`,
    },
    sourceRevision: args.sourceDigestSha256,
    dependencyLockDigest: `sha256:${'2'.repeat(64)}`,
    buildConfigurationDigest: `sha256:${'3'.repeat(64)}`,
  };
  const sourceArtifact = artifact(
    args.sourceArtifactId,
    'source',
    args.sourceDigestSha256,
    args.createdAtMs,
  );
  const unsignedUiArtifact = artifact(
    args.unsignedUiArtifactId,
    'unsigned_ui',
    digest(args.buildSequence + 1_000),
    args.createdAtMs,
  );
  const uiArtifact = artifact(
    args.uiArtifactId,
    'ui',
    digest(args.buildSequence + 2_000),
    args.createdAtMs,
  );
  const capabilityContractDigestSha256 = sha256(
    fnCanonicalizeWidgetCapsuleCapabilityRequests(uiRuntime.capabilityRequests),
  );
  const channelContractDigestSha256 = sha256(
    fnCanonicalizeWidgetCapsuleChannelContract(uiRuntime.channels),
  );
  const functionDescriptorsDigestSha256 = sha256(functionDescriptorsJson);
  const constructionContractDigestSha256 = sha256(
    fnCanonicalizeWidgetConstructionContractPayload({
      sourceSnapshotId: args.sourceSnapshotId,
      sourceDigestSha256: args.sourceDigestSha256,
      sourceArtifactDigestSha256: sourceArtifact.digestSha256,
      canonicalManifestJson,
      unsignedUiDigestSha256: unsignedUiArtifact.digestSha256,
      capsuleArtifactHash: uiRuntime.capsuleArtifactHash,
      target: uiRuntime.target,
      budgets: uiRuntime.budgets,
      capabilityContractDigestSha256,
      channelContractDigestSha256,
      serverDigestSha256: null,
      serverRuntimeAbi: null,
      functionDescriptorsDigestSha256,
      builderIdentity: 'service-db-preview-test/1',
      capsuleBuildIdentity,
      buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
      distributionProvenance,
    }),
  );
  const previewContractDigestSha256 = sha256(
    fnCanonicalizeWidgetContractPayload({
      canonicalManifestJson,
      uiDigestSha256: uiArtifact.digestSha256,
      capsuleArtifactHash: uiRuntime.capsuleArtifactHash,
      target: uiRuntime.target,
      budgets: uiRuntime.budgets,
      capabilityContractDigestSha256,
      channelContractDigestSha256,
      signatureKeyIds: uiRuntime.signatureKeyIds,
      serverDigestSha256: null,
      serverRuntimeAbi: null,
      functionDescriptorsDigestSha256,
      sourceDigestSha256: args.sourceDigestSha256,
      builderIdentity: 'service-db-preview-test/1',
      capsuleBuildIdentity,
      buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
    }),
  );
  return {
    id: args.id,
    previewId: args.previewId,
    draftId: args.draftId,
    definitionId: args.definitionId,
    draftRevisionSha256: args.sourceDigestSha256,
    committedMutationId: args.committedMutationId,
    sourceSnapshotId: args.sourceSnapshotId,
    sourceDigestSha256: args.sourceDigestSha256,
    sourceArtifact,
    manifest,
    canonicalManifestJson,
    functionDescriptors,
    functionDescriptorsDigestSha256,
    capabilityContractDigestSha256,
    channelContractDigestSha256,
    constructionContractDigestSha256,
    previewContractDigestSha256,
    builderIdentity: 'service-db-preview-test/1',
    capsuleBuildIdentity,
    buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
    distributionProvenance,
    unsignedUiArtifact,
    uiArtifact,
    uiRuntime,
    serverArtifact: null,
    serverRuntimeAbi: null,
    bindingRevision: args.bindingRevision ?? 0,
    bindingPlanDigestSha256: args.bindingPlanDigestSha256 ?? sha256('[]'),
    buildSequence: args.buildSequence,
    diagnostics: [],
    createdAtMs: args.createdAtMs,
  };
}

function runtimeDiagnosticRecord(
  revision: TWidgetPreviewRevisionCreate,
  fingerprint = 'f'.repeat(64),
): TWidgetPreviewRuntimeDiagnosticRecord {
  return {
    status: 'awaiting-retest',
    reportedAtMs: revision.createdAtMs + 1,
    diagnostic: {
      formatVersion: 1,
      fingerprint,
      origin: 'guest',
      phase: 'runtime',
      code: 'WIDGET_GUEST_RUNTIME_FAILED',
      severity: 'error',
      message: 'Guest render failed safely.',
      trust: 'untrusted',
      draftRevision: revision.draftRevisionSha256,
      previewRevisionId: revision.id,
      buildId: revision.id,
      buildSequence: revision.buildSequence,
      occurrenceCount: 1,
      retryability: 'unknown',
      timestampMs: revision.createdAtMs + 1,
    },
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
      contract_digest_sha256, created_at_ms, ui_runtime_json,
      capsule_artifact_hash, capability_contract_digest_sha256,
      channel_contract_digest_sha256, capsule_build_identity_json,
      build_policy_id, server_runtime_abi, contract_format_version
    ) VALUES (
      ?, ?, ?, 1, ?, 'ui', NULL, NULL, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, NULL, 3
    )
  `)).run(
    TENANT.orgId,
    args.revisionId,
    args.definitionId,
    args.uiArtifactId,
    widgetManifestV3Json({
      name: `Seeded ${args.ordinal}`,
      slug: `seeded-${args.ordinal}`,
    }),
    digest(args.ordinal + 1_000),
    args.ordinal,
    WIDGET_CAPSULE_RUNTIME_JSON,
    WIDGET_CAPSULE_ARTIFACT_HASH,
    WIDGET_CAPSULE_CAPABILITY_DIGEST,
    WIDGET_CAPSULE_CHANNEL_DIGEST,
    WIDGET_CAPSULE_BUILD_IDENTITY_JSON,
    WIDGET_CAPSULE_BUILD_POLICY_ID,
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

async function createPreviewContext(
  service: DbServiceTurso,
  store: AgentAuthoringStoreTurso,
  seed: number,
): Promise<Readonly<{
  canvasId: string;
  chatId: string;
  draftId: string;
  definitionId: string;
  aiFrameId: string;
}>> {
  const canvasId = uuid(seed);
  const chatId = uuid(seed + 1);
  const draftId = uuid(seed + 2);
  const definitionId = uuid(seed + 3);
  const aiFrameId = `ai-chat-frame-${seed}`;
  const externalSessionKey = `preview-session-${seed}`;
  await service.forTenant(TENANT).canvas.create({
    id: canvasId,
    name: `Preview canvas ${seed}`,
  });
  await store.createChat(TENANT, {
    id: chatId,
    canvasId,
    externalSessionKey,
    name: `Preview chat ${seed}`,
    workspaceRelativePath: `chats/preview-${seed}`,
    historyRelativePath: `history/preview-${seed}.jsonl`,
    nowMs: 1,
  });
  await (await service.db.prepare(`
    INSERT INTO canvas_items (
      org_id, canvas_id, id, item_json, item_revision,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 0, 1, 1)
  `)).run(
    TENANT.orgId,
    canvasId,
    aiFrameId,
    JSON.stringify({
      id: aiFrameId,
      kind: 'widget-frame',
      parentId: null,
      orderKey: 'ai-chat',
      extensions: {
        'vibecanvas:widget': {
          schemaVersion: 1,
          type: 'ui-widget',
          kind: 'ai',
          payload: { sessionId: externalSessionKey },
        },
      },
    }),
  );
  await store.createDraft(TENANT, {
    id: draftId,
    chatId,
    definitionId,
    name: `Preview draft ${seed}`,
    sourceRelativePath: `drafts/preview-${seed}`,
    nowMs: 2,
  });
  await (await service.db.prepare(`
    INSERT INTO widget_definitions (
      org_id, id, slug, name, status, active_revision_id,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'draft', NULL, 2, 2)
  `)).run(
    TENANT.orgId,
    definitionId,
    `preview-${seed}`,
    `Preview ${seed}`,
  );
  return { canvasId, chatId, draftId, definitionId, aiFrameId };
}

async function commitDraftMutation(
  store: AgentAuthoringStoreTurso,
  args: Readonly<{
    draftId: string;
    seed: number;
    nowMs: number;
    expected?: Readonly<{
      sourceDigestSha256: string;
      committedMutationId: string;
      buildSequence: number;
    }>;
  }>,
): Promise<Readonly<{
  sourceDigestSha256: string;
  committedMutationId: string;
  buildSequence: number;
}>> {
  const next = Object.freeze({
    sourceDigestSha256: digest(args.seed),
    committedMutationId: `mutation:${args.seed}`,
    buildSequence: (args.expected?.buildSequence ?? 0) + 1,
  });
  const result = await store.compareAndSetDraft(TENANT, {
    draftId: args.draftId,
    expectedSourceDigestSha256: args.expected?.sourceDigestSha256 ?? null,
    nextSourceDigestSha256: next.sourceDigestSha256,
    expectedCommittedMutationId: args.expected?.committedMutationId ?? null,
    nextCommittedMutationId: next.committedMutationId,
    expectedBuildSequence: args.expected?.buildSequence ?? 0,
    nextBuildSequence: next.buildSequence,
    nextStatus: 'editing',
    nowMs: args.nowMs,
  });
  expect(result).toMatchObject({ status: 'updated', draft: next });
  return next;
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
      expectedCommittedMutationId: null,
      nextCommittedMutationId: 'mutation:833',
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
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
        committedMutationId: 'mutation:false-seed',
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
        committedMutationId: 'mutation:archived-seed',
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
        committedMutationId: 'mutation:first-seed',
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
        committedMutationId: 'mutation:wrong-definition',
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
        committedMutationId: 'mutation:second-seed',
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

  test('idempotently owns one companion while allowing distinct placed Preview frames', async () => {
    const context = await createPreviewContext(service, store, 900);
    const companionRequest = {
      id: uuid(904),
      canvasId: context.canvasId,
      frameNodeId: uuid(905),
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'companion' as const,
      nowMs: 10,
    };

    const companion = await store.ensurePreviewOwner(TENANT, companionRequest);
    expect(await store.ensurePreviewOwner(TENANT, {
      ...companionRequest,
      nowMs: 11,
    })).toEqual(companion);
    expect(await store.ensurePreviewOwner(TENANT, {
      ...companionRequest,
      id: uuid(906),
      frameNodeId: uuid(907),
      nowMs: 12,
    })).toEqual(companion);

    const placedOne = await store.ensurePreviewOwner(TENANT, {
      ...companionRequest,
      id: uuid(908),
      frameNodeId: uuid(909),
      role: 'placed',
      nowMs: 13,
    });
    const placedTwo = await store.ensurePreviewOwner(TENANT, {
      ...companionRequest,
      id: uuid(910),
      frameNodeId: uuid(911),
      role: 'placed',
      nowMs: 14,
    });
    expect([placedOne.id, placedTwo.id]).toEqual([uuid(908), uuid(910)]);
    expect(await store.listPreviewOwners(TENANT, {
      draftId: context.draftId,
    })).toHaveLength(3);

    await expect(store.ensurePreviewOwner(TENANT, {
      ...companionRequest,
      frameNodeId: uuid(912),
      nowMs: 15,
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_OWNER_CONFLICT' });

    const wrongCanvasId = uuid(913);
    await service.forTenant(TENANT).canvas.create({
      id: wrongCanvasId,
      name: 'Wrong Preview canvas',
    });
    await expect(store.ensurePreviewOwner(TENANT, {
      ...companionRequest,
      id: uuid(914),
      canvasId: wrongCanvasId,
      frameNodeId: uuid(915),
      role: 'placed',
      nowMs: 16,
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_OWNER_UNAUTHORIZED' });

    expect(await store.closePreviewOwner(TENANT, {
      previewId: companion.id,
      frameNodeId: companion.frameNodeId,
      nowMs: 17,
    })).toBe(true);
    const replacement = await store.ensurePreviewOwner(TENANT, {
      ...companionRequest,
      id: uuid(916),
      frameNodeId: uuid(917),
      nowMs: 18,
    });
    expect(replacement).toMatchObject({
      id: uuid(916),
      role: 'companion',
      status: 'queued',
    });
    expect(await store.listPreviewOwners(TENANT, {
      draftId: context.draftId,
      includeClosed: true,
    })).toHaveLength(4);
  });

  test('requires a durable same-canvas AI Chat frame for companion reservations only', async () => {
    const seed = 1_750;
    const context = await createPreviewContext(service, store, seed);
    const aiItem = (sessionId: string) => JSON.stringify({
      id: context.aiFrameId,
      kind: 'widget-frame',
      parentId: null,
      orderKey: 'ai-chat',
      extensions: {
        'vibecanvas:widget': {
          schemaVersion: 1,
          type: 'ui-widget',
          kind: 'ai',
          payload: { sessionId },
        },
      },
    });
    const request = {
      id: uuid(1_754),
      canvasId: context.canvasId,
      frameNodeId: uuid(1_755),
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'companion' as const,
      nowMs: 10,
    };

    await (await service.db.prepare(`
      UPDATE canvas_items
      SET item_json = ?, item_revision = item_revision + 1, updated_at_ms = 3
      WHERE org_id = ? AND canvas_id = ? AND id = ?
    `)).run(
      aiItem('different-external-session'),
      TENANT.orgId,
      context.canvasId,
      context.aiFrameId,
    );
    await expect(store.ensurePreviewOwner(TENANT, request)).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_OWNER_UNAUTHORIZED',
    });

    await expect(store.ensurePreviewOwner(TENANT, {
      ...request,
      id: uuid(1_756),
      frameNodeId: uuid(1_757),
      role: 'placed',
      nowMs: 11,
    })).resolves.toMatchObject({
      role: 'placed',
      canvasId: context.canvasId,
    });

    await (await service.db.prepare(`
      UPDATE canvas_items
      SET item_json = ?, item_revision = item_revision + 1, updated_at_ms = 4
      WHERE org_id = ? AND canvas_id = ? AND id = ?
    `)).run(
      aiItem(`preview-session-${seed}`),
      TENANT.orgId,
      context.canvasId,
      context.aiFrameId,
    );
    await expect(store.ensurePreviewOwner(TENANT, request)).resolves.toMatchObject({
      id: request.id,
      role: 'companion',
    });

    await (await service.db.prepare(`
      DELETE FROM canvas_items
      WHERE org_id = ? AND canvas_id = ? AND id = ?
    `)).run(TENANT.orgId, context.canvasId, context.aiFrameId);
    await expect(store.ensurePreviewOwner(TENANT, {
      ...request,
      nowMs: 12,
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_OWNER_UNAUTHORIZED',
    });
  });

  test('binds a canvas-less WebSocket chat on first Preview reservation and rejects rebinding', async () => {
    const firstCanvasId = uuid(1_700);
    const secondCanvasId = uuid(1_701);
    const chatId = uuid(1_702);
    const draftId = uuid(1_703);
    await service.forTenant(TENANT).canvas.create({
      id: firstCanvasId,
      name: 'First reservation canvas',
    });
    await service.forTenant(TENANT).canvas.create({
      id: secondCanvasId,
      name: 'Second reservation canvas',
    });
    await store.createChat(TENANT, {
      id: chatId,
      canvasId: null,
      externalSessionKey: 'canvas-less-websocket-chat',
      name: 'Canvas-less WebSocket chat',
      workspaceRelativePath: 'chats/canvas-less-websocket',
      historyRelativePath: 'history/canvas-less-websocket.jsonl',
      nowMs: 1,
    });
    await store.createDraft(TENANT, {
      id: draftId,
      chatId,
      definitionId: uuid(1_704),
      name: 'Canvas reservation draft',
      sourceRelativePath: 'drafts/canvas-reservation',
      nowMs: 2,
    });

    await expect(store.ensurePreviewOwner(TENANT, {
      id: uuid(1_705),
      canvasId: firstCanvasId,
      frameNodeId: uuid(1_706),
      draftId,
      originChatId: chatId,
      role: 'placed',
      nowMs: 3,
    })).resolves.toMatchObject({
      canvasId: firstCanvasId,
      draftId,
    });
    await expect(store.getChat(TENANT, chatId)).resolves.toMatchObject({
      canvasId: firstCanvasId,
    });
    await expect(store.ensurePreviewOwner(TENANT, {
      id: uuid(1_707),
      canvasId: secondCanvasId,
      frameNodeId: uuid(1_708),
      draftId,
      originChatId: chatId,
      role: 'placed',
      nowMs: 4,
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_OWNER_UNAUTHORIZED',
    });
  });

  test('atomically closes Preview owners when their draft is discarded', async () => {
    const context = await createPreviewContext(service, store, 905);
    const sourceFence = await commitDraftMutation(store, {
      draftId: context.draftId,
      seed: 9_050,
      nowMs: 3,
    });
    const owner = await store.ensurePreviewOwner(TENANT, {
      id: uuid(909),
      canvasId: context.canvasId,
      frameNodeId: uuid(910),
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'placed',
      nowMs: 10,
    });
    const buildId = uuid(911);
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceFence.sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: sourceFence.committedMutationId,
      status: 'building',
      pendingBuildId: buildId,
      nowMs: 11,
    })).toMatchObject({
      status: 'building',
      pendingBuildId: buildId,
      buildSequence: 1,
    });

    expect(await store.discardDraft(TENANT, {
      draftId: context.draftId,
      expectedSourceDigestSha256: sourceFence.sourceDigestSha256,
      nowMs: 12,
    })).toMatchObject({
      status: 'updated',
      draft: { status: 'discarded' },
    });
    expect(await store.getPreviewOwner(TENANT, owner.id)).toMatchObject({
      status: 'closed',
      activeRevisionId: null,
      pendingBuildId: null,
      closedAtMs: 12,
    });
    expect(await store.listPreviewOwners(TENANT, {
      draftId: context.draftId,
    })).toEqual([]);
    await expect(store.ensurePreviewOwner(TENANT, {
      id: uuid(912),
      canvasId: context.canvasId,
      frameNodeId: uuid(913),
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'placed',
      nowMs: 13,
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_OWNER_UNAUTHORIZED' });
  });

  test('applies latest-wins build sequence CAS while retaining the last good revision', async () => {
    const context = await createPreviewContext(service, store, 920);
    const firstSourceFence = await commitDraftMutation(store, {
      draftId: context.draftId,
      seed: 9_200,
      nowMs: 3,
    });
    const owner = await store.ensurePreviewOwner(TENANT, {
      id: uuid(924),
      canvasId: context.canvasId,
      frameNodeId: uuid(925),
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'placed',
      nowMs: 10,
    });

    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: firstSourceFence.sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: firstSourceFence.committedMutationId,
      status: 'building',
      pendingBuildId: uuid(926),
      nowMs: 11,
    })).toMatchObject({
      status: 'building',
      buildSequence: 1,
      pendingBuildId: uuid(926),
    });
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 0,
      nextBuildSequence: 0,
      status: 'ready',
      activeRevisionId: uuid(927),
      nowMs: 12,
    })).toBeNull();
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 1,
      expectedStatus: 'building',
      expectedPendingBuildId: uuid(999),
      nextBuildSequence: 1,
      status: 'failed',
      pendingBuildId: null,
      nowMs: 12,
    })).toBeNull();
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 1,
      expectedStatus: 'ready',
      expectedPendingBuildId: uuid(926),
      nextBuildSequence: 1,
      status: 'failed',
      pendingBuildId: null,
      nowMs: 12,
    })).toBeNull();

    const ready = await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 1,
      expectedStatus: 'building',
      expectedPendingBuildId: uuid(926),
      nextBuildSequence: 1,
      status: 'ready',
      activeRevisionId: uuid(928),
      pendingBuildId: null,
      lastError: null,
      nowMs: 13,
    });
    expect(ready).toMatchObject({
      status: 'ready',
      activeRevisionId: uuid(928),
      pendingBuildId: null,
      buildSequence: 1,
    });

    const secondSourceFence = await commitDraftMutation(store, {
      draftId: context.draftId,
      seed: 9_201,
      nowMs: 14,
      expected: firstSourceFence,
    });
    await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 1,
      nextBuildSequence: 2,
      expectedSourceDigestSha256: firstSourceFence.sourceDigestSha256,
      nextSourceDigestSha256: secondSourceFence.sourceDigestSha256,
      expectedCommittedMutationId: firstSourceFence.committedMutationId,
      nextCommittedMutationId: secondSourceFence.committedMutationId,
      status: 'building',
      pendingBuildId: uuid(929),
      nowMs: 14,
    });
    const failed = await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 2,
      nextBuildSequence: 2,
      status: 'failed',
      pendingBuildId: null,
      lastError: { code: 'CAPSULE_BUILD_FAILED', retryable: true },
      nowMs: 15,
    });
    expect(failed).toMatchObject({
      status: 'failed',
      activeRevisionId: uuid(928),
      pendingBuildId: null,
      buildSequence: 2,
      lastError: { code: 'CAPSULE_BUILD_FAILED', retryable: true },
    });
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 2,
      nextBuildSequence: 2,
      status: 'building',
      nowMs: 14,
    })).toBeNull();
  });

  test('rejects invalid draft and Preview-owner mutation fence transitions', async () => {
    const context = await createPreviewContext(service, store, 930);
    const sourceFence = await commitDraftMutation(store, {
      draftId: context.draftId,
      seed: 9_300,
      nowMs: 3,
    });
    const invalidDigest = digest(9_301);

    await expect(store.compareAndSetDraft(TENANT, {
      draftId: context.draftId,
      expectedSourceDigestSha256: sourceFence.sourceDigestSha256,
      nextSourceDigestSha256: invalidDigest,
      expectedCommittedMutationId: sourceFence.committedMutationId,
      nextCommittedMutationId: sourceFence.committedMutationId,
      expectedBuildSequence: 1,
      nextBuildSequence: 1,
      nextStatus: 'editing',
      nowMs: 4,
    })).rejects.toThrow('cannot identify multiple source digests');
    await expect(store.compareAndSetDraft(TENANT, {
      draftId: context.draftId,
      expectedSourceDigestSha256: sourceFence.sourceDigestSha256,
      nextSourceDigestSha256: invalidDigest,
      expectedCommittedMutationId: sourceFence.committedMutationId,
      nextCommittedMutationId: 'mutation:invalid-same-sequence',
      expectedBuildSequence: 1,
      nextBuildSequence: 1,
      nextStatus: 'editing',
      nowMs: 4,
    })).rejects.toThrow('requires the next build sequence');
    await expect(store.compareAndSetDraft(TENANT, {
      draftId: context.draftId,
      expectedSourceDigestSha256: sourceFence.sourceDigestSha256,
      nextSourceDigestSha256: invalidDigest,
      expectedCommittedMutationId: sourceFence.committedMutationId,
      nextCommittedMutationId: 'mutation:invalid-sequence-jump',
      expectedBuildSequence: 1,
      nextBuildSequence: 3,
      nextStatus: 'editing',
      nowMs: 4,
    })).rejects.toThrow('requires the next build sequence');

    const owner = await store.ensurePreviewOwner(TENANT, {
      id: uuid(934),
      canvasId: context.canvasId,
      frameNodeId: uuid(935),
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'placed',
      nowMs: 10,
    });
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceFence.sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: sourceFence.committedMutationId,
      status: 'building',
      nowMs: 11,
    })).toMatchObject({
      sourceDigestSha256: sourceFence.sourceDigestSha256,
      committedMutationId: sourceFence.committedMutationId,
      buildSequence: 1,
    });

    await expect(store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 1,
      nextBuildSequence: 1,
      expectedSourceDigestSha256: sourceFence.sourceDigestSha256,
      nextSourceDigestSha256: null,
      expectedCommittedMutationId: sourceFence.committedMutationId,
      nextCommittedMutationId: null,
      status: 'building',
      nowMs: 12,
    })).rejects.toThrow('cannot be cleared');
    await expect(store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 1,
      nextBuildSequence: 1,
      expectedSourceDigestSha256: sourceFence.sourceDigestSha256,
      nextSourceDigestSha256: invalidDigest,
      expectedCommittedMutationId: sourceFence.committedMutationId,
      nextCommittedMutationId: sourceFence.committedMutationId,
      status: 'building',
      nowMs: 12,
    })).rejects.toThrow('cannot identify multiple source digests');
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 1,
      nextBuildSequence: 2,
      expectedSourceDigestSha256: sourceFence.sourceDigestSha256,
      nextSourceDigestSha256: invalidDigest,
      expectedCommittedMutationId: sourceFence.committedMutationId,
      nextCommittedMutationId: 'mutation:not-on-durable-draft',
      status: 'building',
      nowMs: 12,
    })).toBeNull();
    expect(await store.getPreviewOwner(TENANT, owner.id)).toMatchObject({
      sourceDigestSha256: sourceFence.sourceDigestSha256,
      committedMutationId: sourceFence.committedMutationId,
      buildSequence: 1,
    });
  });

  test('persists mounted Preview revisions across restart and reclaims them after lease expiry', async () => {
    const context = await createPreviewContext(service, store, 980);
    await (await service.db.prepare(`
      DELETE FROM widget_definitions WHERE org_id = ? AND id = ?
    `)).run(TENANT.orgId, context.definitionId);
    expect(await controlStore.getDefinition(
      TENANT,
      context.definitionId,
    )).toBeNull();
    const sourceDigestSha256 = digest(9_800);
    const previewId = uuid(984);
    const frameNodeId = uuid(985);
    const revisionId = uuid(986);
    const resourceId = uuid(987);
    const sourceArtifactId = uuid(988);
    const unsignedUiArtifactId = uuid(989);
    const uiArtifactId = uuid(990);
    const committedMutationId = 'mutation:preview-9800';

    expect(await store.compareAndSetDraft(TENANT, {
      draftId: context.draftId,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: committedMutationId,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      nextStatus: 'ready',
      nowMs: 3,
    })).toMatchObject({ status: 'updated' });
    await (await service.db.prepare(`
      INSERT INTO resource_catalog (
        org_id, id, kind, name, status, last_error_json,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'kv', 'Preview preferences', 'ready', NULL, 3, 3)
    `)).run(TENANT.orgId, resourceId);
    await store.ensurePreviewOwner(TENANT, {
      id: previewId,
      canvasId: context.canvasId,
      frameNodeId,
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'companion',
      nowMs: 10,
    });
    const bindingPlanDigestSha256 = fnWidgetPreviewBindingPlanDigest({
      bindings: [{
        slot: 'preferences',
        resourceId,
        kind: 'kv',
        allowRead: true,
        allowWrite: false,
      }],
      digestSha256: sha256,
    });
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      status: 'building',
      pendingBuildId: revisionId,
      expectedBindingRevision: 0,
      nextBindingRevision: 0,
      expectedBindingPlanDigestSha256: null,
      nextBindingPlanDigestSha256: bindingPlanDigestSha256,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: committedMutationId,
      nowMs: 11,
    })).toMatchObject({ status: 'building', buildSequence: 1 });

    const revision = previewRevision({
      id: revisionId,
      previewId,
      draftId: context.draftId,
      definitionId: context.definitionId,
      sourceSnapshotId: uuid(991),
      sourceDigestSha256,
      committedMutationId,
      sourceArtifactId,
      unsignedUiArtifactId,
      uiArtifactId,
      buildSequence: 1,
      createdAtMs: 12,
      withResource: true,
      bindingPlanDigestSha256,
    });
    const binding = {
      slot: 'preferences',
      resourceId,
      kind: 'kv' as const,
      allowRead: true,
      allowWrite: false,
    };
    const crossMutationRevision = {
      ...revision,
      id: uuid(996),
      committedMutationId: 'mutation:wrong-preview-9800',
    };
    expect(await store.commitPreview(TENANT, {
      expectedActiveRevisionId: null,
      expectedBuildSequence: 1,
      revision: crossMutationRevision,
      bindings: [binding],
      nowMs: 12,
    })).toEqual({
      status: 'conflict',
      currentActiveRevisionId: null,
      currentBuildSequence: 1,
    });
    const crossDigestRevision = previewRevision({
      id: uuid(997),
      previewId,
      draftId: context.draftId,
      definitionId: context.definitionId,
      sourceSnapshotId: uuid(998),
      sourceDigestSha256: digest(9_801),
      committedMutationId,
      sourceArtifactId: uuid(999),
      unsignedUiArtifactId: uuid(1_000),
      uiArtifactId: uuid(1_001),
      buildSequence: 1,
      createdAtMs: 12,
      withResource: true,
      bindingPlanDigestSha256,
    });
    expect(await store.commitPreview(TENANT, {
      expectedActiveRevisionId: null,
      expectedBuildSequence: 1,
      revision: crossDigestRevision,
      bindings: [binding],
      nowMs: 12,
    })).toEqual({
      status: 'conflict',
      currentActiveRevisionId: null,
      currentBuildSequence: 1,
    });
    expect(await store.commitPreview(TENANT, {
      expectedActiveRevisionId: null,
      expectedBuildSequence: 1,
      revision,
      bindings: [binding],
      nowMs: 12,
    })).toMatchObject({
      status: 'committed',
      revision: {
        id: revisionId,
        previewId,
        sourceDigestSha256,
        buildSequence: 1,
        bindingRevision: 0,
      },
      previousActiveRevisionId: null,
    });
    expect(await store.getPreview(TENANT, { previewId })).toMatchObject({
      id: revisionId,
      uiRuntime: { signatureKeyIds: ['vibecanvas-preview-v1'] },
    });
    expect(await store.getPreviewBindings(TENANT, {
      previewId,
      revisionId,
    })).toEqual([binding]);

    for (const descriptor of [
      revision.sourceArtifact,
      revision.unsignedUiArtifact,
      revision.uiArtifact,
    ]) {
      expect(await store.resolvePreviewArtifact(TENANT, {
        previewId,
        revisionId,
        artifactId: descriptor.id,
        kind: descriptor.kind as 'source' | 'unsigned_ui' | 'ui',
        digestSha256: descriptor.digestSha256,
      })).toMatchObject({
        id: descriptor.id,
        kind: descriptor.kind,
        digestSha256: descriptor.digestSha256,
        retentionState: 'pinned',
      });
    }
    for (const foreignTenant of [OTHER_ACCOUNT_TENANT, OTHER_ORGANIZATION_TENANT]) {
      expect(await store.getPreview(foreignTenant, { previewId })).toBeNull();
      expect(await store.getPreviewRevision(foreignTenant, {
        previewId,
        revisionId,
      })).toBeNull();
      expect(await store.getPreviewBindings(foreignTenant, {
        previewId,
        revisionId,
      })).toEqual([]);
      expect(await store.resolvePreviewArtifact(foreignTenant, {
        previewId,
        revisionId,
        artifactId: revision.uiArtifact.id,
        kind: 'ui',
        digestSha256: revision.uiArtifact.digestSha256,
      })).toBeNull();
    }
    expect(await controlStore.reconcileArtifactRetention(TENANT, {
      nowMs: 13,
      gracePeriodMs: 10,
      limit: 20,
    })).toMatchObject({ eligibleArtifactIds: [] });
    expect(await store.acquirePreviewMountLease(TENANT, {
      leaseId: uuid(992),
      previewId,
      previewRevisionId: revisionId,
      canvasId: context.canvasId,
      frameNodeId,
      nowMs: 13,
      ttlMs: 1_000,
    })).toMatchObject({
      leaseId: uuid(992),
      previewId,
      previewRevisionId: revisionId,
      expiresAtMs: 1_013,
    });
    const persistedRuntimeDiagnostic = runtimeDiagnosticRecord(revision);
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId,
      expectedBuildSequence: 1,
      expectedStatus: 'ready',
      expectedPendingBuildId: null,
      nextBuildSequence: 1,
      status: 'failed',
      activeRevisionId: revisionId,
      pendingBuildId: null,
      runtimeDiagnostics: [persistedRuntimeDiagnostic],
      nowMs: 13,
    })).toMatchObject({
      status: 'failed',
      lastError: null,
      runtimeDiagnostics: [persistedRuntimeDiagnostic],
    });

    await service.stop();
    service = new DbServiceTurso({
      databasePath: path.join(root, 'main.db'),
      dataDir: root,
      cacheDir: path.join(root, 'cache'),
    });
    await service.start();
    controlStore = new WidgetControlStoreTurso(service.db);
    store = new AgentAuthoringStoreTurso(service.db, controlStore);
    expect(await store.getPreview(TENANT, { previewId })).toMatchObject({
      id: revisionId,
      previewId,
      sourceDigestSha256,
      buildSequence: 1,
    });
    expect(await store.getPreviewBindings(TENANT, {
      previewId,
      revisionId,
    })).toEqual([binding]);
    expect(await store.getPreviewOwner(TENANT, previewId)).toMatchObject({
      status: 'failed',
      lastError: null,
      runtimeDiagnostics: [persistedRuntimeDiagnostic],
    });

    expect(await store.closePreviewOwner(TENANT, {
      previewId,
      frameNodeId,
      nowMs: 14,
    })).toBe(true);
    expect(await store.getPreviewOwner(TENANT, previewId)).toMatchObject({
      status: 'closed',
      activeRevisionId: null,
      pendingBuildId: null,
      runtimeDiagnostics: [],
    });
    expect(await store.getPreview(TENANT, { previewId })).toBeNull();
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId,
    })).toMatchObject({ id: revisionId });
    expect(await store.getPreviewBindings(TENANT, {
      previewId,
      revisionId,
    })).toEqual([binding]);
    await controlStore.pruneInactiveRevisions(TENANT, {
      nowMs: 1_013,
      inactiveBeforeMs: 1_013,
      limit: 20,
    });
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId,
    })).toBeNull();
    expect(await store.getPreviewBindings(TENANT, {
      previewId,
      revisionId,
    })).toEqual([]);
    expect(await (await service.db.prepare(`
      SELECT count(*) AS count
      FROM agent_preview_revisions
      WHERE org_id = ? AND preview_id = ?
    `)).get(TENANT.orgId, previewId)).toMatchObject({ count: 0 });
    expect(await (await service.db.prepare(`
      SELECT count(*) AS count
      FROM agent_preview_resource_bindings
      WHERE org_id = ? AND preview_id = ?
    `)).get(TENANT.orgId, previewId)).toMatchObject({ count: 0 });

    const released = await controlStore.reconcileArtifactRetention(TENANT, {
      nowMs: 1_014,
      gracePeriodMs: 10,
      limit: 20,
    });
    expect(new Set(released.eligibleArtifactIds)).toEqual(new Set([
      sourceArtifactId,
      unsignedUiArtifactId,
      uiArtifactId,
    ]));
    expect(await (await service.db.prepare(`
      SELECT count(*) AS count
      FROM artifact_references
      WHERE org_id = ? AND id IN (?, ?, ?)
        AND retention_state = 'eligible' AND retain_until_ms = 1024
    `)).get(
      TENANT.orgId,
      sourceArtifactId,
      unsignedUiArtifactId,
      uiArtifactId,
    )).toMatchObject({ count: 3 });
    expect(await store.closePreviewOwner(TENANT, {
      previewId,
      frameNodeId,
      nowMs: 1_015,
    })).toBe(true);
  });

  test('keeps superseded and closed revisions until every exact viewer lease releases', async () => {
    const context = await createPreviewContext(service, store, 1_300);
    const sourceDigestSha256 = digest(13_000);
    const previewId = uuid(1_304);
    const frameNodeId = uuid(1_305);
    const firstRevisionId = uuid(1_306);
    const secondRevisionId = uuid(1_310);
    const firstLeaseId = uuid(1_314);
    const secondLeaseId = uuid(1_315);
    const activeLeaseId = uuid(1_316);
    const committedMutationId = 'mutation:preview-13000';
    expect(await store.compareAndSetDraft(TENANT, {
      draftId: context.draftId,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: committedMutationId,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      nextStatus: 'ready',
      nowMs: 3,
    })).toMatchObject({ status: 'updated' });
    await store.ensurePreviewOwner(TENANT, {
      id: previewId,
      canvasId: context.canvasId,
      frameNodeId,
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'placed',
      nowMs: 10,
    });
    await store.compareAndSetPreviewOwner(TENANT, {
      previewId,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      status: 'building',
      pendingBuildId: firstRevisionId,
      expectedBindingRevision: 0,
      nextBindingRevision: 0,
      expectedBindingPlanDigestSha256: null,
      nextBindingPlanDigestSha256: sha256('[]'),
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: committedMutationId,
      nowMs: 11,
    });
    const firstRevision = previewRevision({
      id: firstRevisionId,
      previewId,
      draftId: context.draftId,
      definitionId: context.definitionId,
      sourceSnapshotId: uuid(1_307),
      sourceDigestSha256,
      committedMutationId,
      sourceArtifactId: uuid(1_308),
      unsignedUiArtifactId: uuid(1_309),
      uiArtifactId: uuid(1_311),
      buildSequence: 1,
      createdAtMs: 12,
    });
    expect(await store.commitPreview(TENANT, {
      expectedActiveRevisionId: null,
      expectedBuildSequence: 1,
      revision: firstRevision,
      bindings: [],
      nowMs: 12,
    })).toMatchObject({ status: 'committed' });
    const unresolvedRuntimeDiagnostic = runtimeDiagnosticRecord(
      firstRevision,
      'e'.repeat(64),
    );
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId,
      expectedBuildSequence: 1,
      expectedStatus: 'ready',
      expectedPendingBuildId: null,
      nextBuildSequence: 1,
      status: 'failed',
      activeRevisionId: firstRevisionId,
      pendingBuildId: null,
      runtimeDiagnostics: [unresolvedRuntimeDiagnostic],
      nowMs: 13,
    })).toMatchObject({
      status: 'failed',
      lastError: null,
      runtimeDiagnostics: [unresolvedRuntimeDiagnostic],
    });

    const leaseRequest = {
      previewId,
      previewRevisionId: firstRevisionId,
      canvasId: context.canvasId,
      frameNodeId,
      nowMs: 13,
      ttlMs: 1_000,
    };
    await expect(store.acquirePreviewMountLease(TENANT, {
      ...leaseRequest,
      leaseId: uuid(1_321),
      ttlMs: 999,
    })).rejects.toThrow('outside the safe bound');
    await expect(store.acquirePreviewMountLease(TENANT, {
      ...leaseRequest,
      leaseId: uuid(1_322),
      ttlMs: 300_001,
    })).rejects.toThrow('outside the safe bound');
    expect(await store.acquirePreviewMountLease(TENANT, {
      ...leaseRequest,
      leaseId: firstLeaseId,
    })).toMatchObject({ leaseId: firstLeaseId });
    expect(await store.acquirePreviewMountLease(TENANT, {
      ...leaseRequest,
      leaseId: secondLeaseId,
    })).toMatchObject({ leaseId: secondLeaseId });
    expect(await store.acquirePreviewMountLease(OTHER_ACCOUNT_TENANT, {
      ...leaseRequest,
      leaseId: uuid(1_317),
    })).toBeNull();

    await store.compareAndSetPreviewOwner(TENANT, {
      previewId,
      expectedBuildSequence: 1,
      nextBuildSequence: 1,
      status: 'building',
      pendingBuildId: secondRevisionId,
      nowMs: 14,
    });
    const secondRevision = previewRevision({
      id: secondRevisionId,
      previewId,
      draftId: context.draftId,
      definitionId: context.definitionId,
      sourceSnapshotId: uuid(1_312),
      sourceDigestSha256,
      committedMutationId,
      sourceArtifactId: uuid(1_313),
      unsignedUiArtifactId: uuid(1_318),
      uiArtifactId: uuid(1_319),
      buildSequence: 1,
      createdAtMs: 15,
    });
    expect(await store.commitPreview(TENANT, {
      expectedActiveRevisionId: firstRevisionId,
      expectedBuildSequence: 1,
      revision: secondRevision,
      bindings: [],
      nowMs: 15,
    })).toMatchObject({ status: 'committed' });
    expect(await store.getPreviewOwner(TENANT, previewId)).toMatchObject({
      status: 'ready',
      lastError: null,
      runtimeDiagnostics: [unresolvedRuntimeDiagnostic],
    });
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId,
      expectedBuildSequence: 1,
      expectedStatus: 'ready',
      expectedPendingBuildId: null,
      nextBuildSequence: 1,
      status: 'ready',
      activeRevisionId: secondRevisionId,
      pendingBuildId: null,
      runtimeDiagnostics: [],
      nowMs: 15,
    })).toMatchObject({
      status: 'ready',
      runtimeDiagnostics: [],
    });
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId: firstRevisionId,
    })).toMatchObject({ id: firstRevisionId });

    expect(await store.releasePreviewMountLease(TENANT, {
      leaseId: firstLeaseId,
      previewId,
      previewRevisionId: firstRevisionId,
      canvasId: context.canvasId,
      frameNodeId,
      nowMs: 16,
    })).toBe(true);
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId: firstRevisionId,
    })).toMatchObject({ id: firstRevisionId });
    expect(await store.renewPreviewMountLease(TENANT, {
      ...leaseRequest,
      leaseId: secondLeaseId,
      nowMs: 17,
    })).toMatchObject({
      leaseId: secondLeaseId,
      renewedAtMs: 17,
      expiresAtMs: 1_017,
    });
    expect(await store.acquirePreviewMountLease(TENANT, {
      ...leaseRequest,
      leaseId: uuid(1_320),
      nowMs: 18,
    })).toBeNull();
    expect(await store.acquirePreviewMountLease(TENANT, {
      leaseId: activeLeaseId,
      previewId,
      previewRevisionId: secondRevisionId,
      canvasId: context.canvasId,
      frameNodeId,
      nowMs: 18,
      ttlMs: 1_000,
    })).toMatchObject({ leaseId: activeLeaseId });
    expect(await store.releasePreviewMountLease(TENANT, {
      leaseId: secondLeaseId,
      previewId,
      previewRevisionId: firstRevisionId,
      canvasId: context.canvasId,
      frameNodeId,
      nowMs: 19,
    })).toBe(true);
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId: firstRevisionId,
    })).toBeNull();

    expect(await store.closePreviewOwner(TENANT, {
      previewId,
      frameNodeId,
      nowMs: 20,
    })).toBe(true);
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId: secondRevisionId,
    })).toMatchObject({ id: secondRevisionId });
    expect(await store.renewPreviewMountLease(TENANT, {
      leaseId: activeLeaseId,
      previewId,
      previewRevisionId: secondRevisionId,
      canvasId: context.canvasId,
      frameNodeId,
      nowMs: 21,
      ttlMs: 1_000,
    })).toBeNull();
    expect(await store.releasePreviewMountLease(TENANT, {
      leaseId: activeLeaseId,
      previewId,
      previewRevisionId: secondRevisionId,
      canvasId: context.canvasId,
      frameNodeId,
      nowMs: 22,
    })).toBe(true);
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId: secondRevisionId,
    })).toBeNull();

    const reconciled = await controlStore.reconcileArtifactRetention(TENANT, {
      nowMs: 23,
      gracePeriodMs: 10,
      limit: 20,
    });
    expect(reconciled.eligibleArtifactIds.length).toBeGreaterThanOrEqual(3);
  });

  test('rejects stale build and binding revisions without replacing the last good Preview', async () => {
    const context = await createPreviewContext(service, store, 1_000);
    const sourceDigestSha256 = digest(10_000);
    const previewId = uuid(1_004);
    const firstRevisionId = uuid(1_006);
    const committedMutationId = 'mutation:preview-10000';
    expect(await store.compareAndSetDraft(TENANT, {
      draftId: context.draftId,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: committedMutationId,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      nextStatus: 'ready',
      nowMs: 3,
    })).toMatchObject({ status: 'updated' });
    await store.ensurePreviewOwner(TENANT, {
      id: previewId,
      canvasId: context.canvasId,
      frameNodeId: uuid(1_005),
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'placed',
      nowMs: 10,
    });
    await store.compareAndSetPreviewOwner(TENANT, {
      previewId,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      status: 'building',
      pendingBuildId: firstRevisionId,
      expectedBindingRevision: 0,
      nextBindingRevision: 0,
      expectedBindingPlanDigestSha256: null,
      nextBindingPlanDigestSha256: sha256('[]'),
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: committedMutationId,
      nowMs: 11,
    });
    const firstRevision = previewRevision({
      id: firstRevisionId,
      previewId,
      draftId: context.draftId,
      definitionId: context.definitionId,
      sourceSnapshotId: uuid(1_007),
      sourceDigestSha256,
      committedMutationId,
      sourceArtifactId: uuid(1_008),
      unsignedUiArtifactId: uuid(1_009),
      uiArtifactId: uuid(1_010),
      buildSequence: 1,
      createdAtMs: 12,
    });
    expect(await store.commitPreview(TENANT, {
      expectedActiveRevisionId: null,
      expectedBuildSequence: 1,
      revision: firstRevision,
      bindings: [],
      nowMs: 12,
    })).toMatchObject({ status: 'committed' });

    const staleRevision = previewRevision({
      id: uuid(1_011),
      previewId,
      draftId: context.draftId,
      definitionId: context.definitionId,
      sourceSnapshotId: uuid(1_012),
      sourceDigestSha256,
      committedMutationId,
      sourceArtifactId: uuid(1_013),
      unsignedUiArtifactId: uuid(1_014),
      uiArtifactId: uuid(1_015),
      buildSequence: 2,
      createdAtMs: 13,
    });
    expect(await store.commitPreview(TENANT, {
      expectedActiveRevisionId: firstRevisionId,
      expectedBuildSequence: 2,
      revision: staleRevision,
      bindings: [],
      nowMs: 13,
    })).toEqual({
      status: 'conflict',
      currentActiveRevisionId: firstRevisionId,
      currentBuildSequence: 1,
    });
    expect(await (await service.db.prepare(`
      SELECT count(*) AS count FROM artifact_references
      WHERE org_id = ? AND id IN (?, ?, ?)
    `)).get(
      TENANT.orgId,
      staleRevision.sourceArtifact.id,
      staleRevision.unsignedUiArtifact.id,
      staleRevision.uiArtifact.id,
    )).toMatchObject({ count: 0 });

    const secondSourceFence = await commitDraftMutation(store, {
      draftId: context.draftId,
      seed: 10_001,
      nowMs: 14,
      expected: {
        sourceDigestSha256,
        committedMutationId,
        buildSequence: 1,
      },
    });
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId,
      expectedBuildSequence: 1,
      nextBuildSequence: 2,
      expectedSourceDigestSha256: sourceDigestSha256,
      nextSourceDigestSha256: secondSourceFence.sourceDigestSha256,
      expectedCommittedMutationId: committedMutationId,
      nextCommittedMutationId: secondSourceFence.committedMutationId,
      status: 'building',
      pendingBuildId: uuid(1_016),
      nowMs: 14,
    })).toMatchObject({
      status: 'building',
      activeRevisionId: firstRevisionId,
      buildSequence: 2,
    });
    const wrongBindingRevision = previewRevision({
      id: uuid(1_016),
      previewId,
      draftId: context.draftId,
      definitionId: context.definitionId,
      sourceSnapshotId: uuid(1_017),
      sourceDigestSha256: secondSourceFence.sourceDigestSha256,
      committedMutationId: secondSourceFence.committedMutationId,
      sourceArtifactId: uuid(1_018),
      unsignedUiArtifactId: uuid(1_019),
      uiArtifactId: uuid(1_020),
      buildSequence: 2,
      bindingRevision: 1,
      createdAtMs: 15,
    });
    expect(await store.commitPreview(TENANT, {
      expectedActiveRevisionId: firstRevisionId,
      expectedBuildSequence: 2,
      revision: wrongBindingRevision,
      bindings: [],
      nowMs: 15,
    })).toEqual({
      status: 'conflict',
      currentActiveRevisionId: firstRevisionId,
      currentBuildSequence: 2,
    });
    const failed = await store.compareAndSetPreviewOwner(TENANT, {
      previewId,
      expectedBuildSequence: 2,
      nextBuildSequence: 2,
      status: 'failed',
      pendingBuildId: null,
      lastError: { code: 'CAPSULE_BUILD_FAILED', retryable: true },
      nowMs: 16,
    });
    expect(failed).toMatchObject({
      status: 'failed',
      activeRevisionId: firstRevisionId,
      buildSequence: 2,
    });
    expect(await store.getPreview(TENANT, { previewId })).toMatchObject({
      id: firstRevisionId,
      previewId,
      buildSequence: 1,
    });
    expect(await store.getPreviewRevision(TENANT, {
      previewId,
      revisionId: wrongBindingRevision.id,
    })).toBeNull();
  });

  test('rehydrates ready and idempotently closed Preview owners across restarts', async () => {
    const context = await createPreviewContext(service, store, 940);
    const sourceFence = await commitDraftMutation(store, {
      draftId: context.draftId,
      seed: 9_400,
      nowMs: 3,
    });
    const owner = await store.ensurePreviewOwner(TENANT, {
      id: uuid(944),
      canvasId: context.canvasId,
      frameNodeId: uuid(945),
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'companion',
      nowMs: 10,
    });
    await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      expectedSourceDigestSha256: null,
      nextSourceDigestSha256: sourceFence.sourceDigestSha256,
      expectedCommittedMutationId: null,
      nextCommittedMutationId: sourceFence.committedMutationId,
      status: 'ready',
      activeRevisionId: uuid(946),
      nowMs: 11,
    });

    const reopen = async (): Promise<void> => {
      await service.stop();
      service = new DbServiceTurso({
        databasePath: path.join(root, 'main.db'),
        dataDir: root,
        cacheDir: path.join(root, 'cache'),
      });
      await service.start();
      controlStore = new WidgetControlStoreTurso(service.db);
      store = new AgentAuthoringStoreTurso(service.db, controlStore);
    };
    await reopen();
    expect(await store.getPreviewOwner(TENANT, owner.id)).toMatchObject({
      status: 'ready',
      activeRevisionId: uuid(946),
      buildSequence: 1,
    });

    expect(await store.closePreviewOwner(TENANT, {
      previewId: owner.id,
      frameNodeId: uuid(947),
      nowMs: 12,
    })).toBe(false);
    expect(await store.closePreviewOwner(TENANT, {
      previewId: owner.id,
      frameNodeId: owner.frameNodeId,
      nowMs: 12,
    })).toBe(true);
    expect(await store.closePreviewOwner(TENANT, {
      previewId: owner.id,
      frameNodeId: owner.frameNodeId,
      nowMs: 13,
    })).toBe(true);

    await reopen();
    expect(await store.getPreviewOwner(TENANT, owner.id)).toMatchObject({
      status: 'closed',
      activeRevisionId: null,
      pendingBuildId: null,
      closedAtMs: 12,
    });
    expect(await store.listPreviewOwners(TENANT)).toEqual([]);
    expect(await store.listPreviewOwners(TENANT, {
      includeClosed: true,
    })).toHaveLength(1);
    expect(await store.compareAndSetPreviewOwner(TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 1,
      nextBuildSequence: 1,
      status: 'building',
      nowMs: 14,
    })).toBeNull();
  });

  test('fails closed for cross-account and cross-organization Preview access', async () => {
    const context = await createPreviewContext(service, store, 960);
    const owner = await store.ensurePreviewOwner(TENANT, {
      id: uuid(964),
      canvasId: context.canvasId,
      frameNodeId: uuid(965),
      draftId: context.draftId,
      originChatId: context.chatId,
      role: 'placed',
      nowMs: 10,
    });

    for (const foreignTenant of [OTHER_ACCOUNT_TENANT, OTHER_ORGANIZATION_TENANT]) {
      expect(await store.getPreviewOwner(foreignTenant, owner.id)).toBeNull();
      expect(await store.listPreviewOwners(foreignTenant, {
        includeClosed: true,
      })).toEqual([]);
      expect(await store.compareAndSetPreviewOwner(foreignTenant, {
        previewId: owner.id,
        expectedBuildSequence: 0,
        nextBuildSequence: 0,
        status: 'building',
        nowMs: 11,
      })).toBeNull();
      expect(await store.closePreviewOwner(foreignTenant, {
        previewId: owner.id,
        frameNodeId: owner.frameNodeId,
        nowMs: 11,
      })).toBe(false);
      await expect(store.ensurePreviewOwner(foreignTenant, {
        id: uuid(966),
        canvasId: context.canvasId,
        frameNodeId: uuid(967),
        draftId: context.draftId,
        originChatId: context.chatId,
        role: 'placed',
        nowMs: 11,
      })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_OWNER_UNAUTHORIZED' });
    }
    expect(await store.getPreviewOwner(TENANT, owner.id)).toEqual(owner);
  });
});
