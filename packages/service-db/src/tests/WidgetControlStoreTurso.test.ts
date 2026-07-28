import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnWidgetPreviewBindingPlanDigest,
} from '@vibecanvas/widget-contract';
import type {
  IWidgetArtifactMutationCoordinator,
  IWidgetControlStore,
  TWidgetArtifactDescriptor,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetDistributionBuildProvenance,
  TWidgetManifestV3,
  TWidgetPublicationCommitResult,
  TWidgetRevisionDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@vibecanvas/widget-contract';
import { AgentAuthoringStoreTurso } from '../AgentAuthoringStoreTurso';
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
const CAPSULE_TARGET = Object.freeze({
  runtimeAbi: 'quickjs-release-sync-v1',
  domProfile: 'dom-core-v2',
  featureProfiles: ['artifact-resources-v1'],
});
const CAPSULE_BUDGETS = Object.freeze({
  cpuMs: 50,
  memoryBytes: 8 * 1_024 * 1_024,
  domNodes: 1_000,
  handles: 1_000,
  messageBytes: 1_024 * 1_024,
  streamBytes: 1_024 * 1_024,
  assetBytes: 4 * 1_024 * 1_024,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 64 * 1_024,
});
const CAPSULE_BUILD_IDENTITY = Object.freeze({
  packageName: '@omnidraw/capsule' as const,
  packageVersion: '0.9.4',
  packageDigest: `sha256:${'a'.repeat(64)}` as const,
  buildApiVersion: 'capsule-build-v1',
  runtimeBuildDigest: `sha256:${'b'.repeat(64)}` as const,
});

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
    resources?: TWidgetManifestV3['resources'];
  }> = {},
): TWidgetManifestV3 {
  return {
    schemaVersion: 3,
    name: args.name ?? 'Weather',
    slug: args.slug ?? 'weather',
    ui: {
      runtime: 'capsule',
      entry: 'src/ui.tsx',
      target: CAPSULE_TARGET,
    },
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
    manifest?: TWidgetManifestV3;
    canonicalManifestJson?: string;
    constructionContractDigestSha256?: string;
    contractDigestSha256?: string;
    distributionProvenance?: TWidgetDistributionBuildProvenance;
    uiArtifact?: TWidgetArtifactDescriptor;
    serverArtifact?: TWidgetArtifactDescriptor | null;
    sourceArtifact?: TWidgetArtifactDescriptor;
    sourceSnapshotId?: string;
    sourceDigestSha256?: string;
    builderIdentity?: string;
    uiRuntime?: TWidgetCapsuleRuntimeDescriptor;
    bindings?: Parameters<IWidgetControlStore['commitPublication']>[1]['bindings'];
    functionDescriptors?: readonly TWidgetServerFunctionDescriptor[];
    publicationIdempotencyKey?: string;
    previewRevisionId?: string;
    nowMs?: number;
  }>,
): Promise<TWidgetPublicationCommitResult> {
  const value = args.manifest ?? manifest({ server: args.serverArtifact !== undefined && args.serverArtifact !== null });
  const nowMs = args.nowMs ?? 20;
  const canonicalManifestJson = args.canonicalManifestJson
    ?? fnCanonicalizeWidgetManifest(value);
  const sourceSnapshotId = args.sourceSnapshotId ?? uuid(910_000 + nowMs);
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
  const sourceDigestSha256 = args.sourceDigestSha256 ?? sourceArtifact.digestSha256;
  const builderIdentity = args.builderIdentity ?? 'widget-control-store-test';
  const constructionContractDigestSha256 =
    args.constructionContractDigestSha256 ?? digest(800_000 + nowMs);
  const distributionProvenance: TWidgetDistributionBuildProvenance =
    args.distributionProvenance ?? {
    kind: 'external-distribution',
    producer: {
      name: 'widget-control-store-test',
      version: '1',
      digest: `sha256:${'c'.repeat(64)}`,
    },
    sourceRevision: sourceDigestSha256,
    dependencyLockDigest: `sha256:${'d'.repeat(64)}`,
    buildConfigurationDigest: `sha256:${'e'.repeat(64)}`,
  };
  const uiRuntime = args.uiRuntime ?? {
    format: 'vibecanvas.capsule-runtime.v1',
    capsuleArtifactHash: `sha256:${uiArtifact.digestSha256}`,
    target: CAPSULE_TARGET,
    budgets: CAPSULE_BUDGETS,
    capabilityRequests: [],
    channels: null,
    parkability: { parkable: false },
    signatureKeyIds: ['vibecanvas-release-v1'],
  };
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
  const capabilityContractDigestSha256 = createHash('sha256')
    .update(fnCanonicalizeWidgetCapsuleCapabilityRequests(uiRuntime.capabilityRequests))
    .digest('hex');
  const channelContractDigestSha256 = createHash('sha256')
    .update(fnCanonicalizeWidgetCapsuleChannelContract(uiRuntime.channels))
    .digest('hex');
  const contractDigestSha256 = args.contractDigestSha256 ?? createHash('sha256')
    .update(fnCanonicalizeWidgetContractPayload({
      canonicalManifestJson,
      uiDigestSha256: uiArtifact.digestSha256,
      capsuleArtifactHash: uiRuntime.capsuleArtifactHash,
      target: uiRuntime.target,
      budgets: uiRuntime.budgets,
      capabilityContractDigestSha256,
      channelContractDigestSha256,
      signatureKeyIds: uiRuntime.signatureKeyIds,
      serverDigestSha256: serverArtifact?.digestSha256 ?? null,
      serverRuntimeAbi: value.server?.runtimeAbi ?? null,
      functionDescriptorsDigestSha256,
      sourceDigestSha256,
      builderIdentity,
      capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
      buildPolicyId: 'vibecanvas-release-v1',
    }))
    .digest('hex');
  const bindings = args.bindings ?? [];
  return store.commitPublication(tenant, {
    expectedActiveRevisionId: args.expectedActiveRevisionId ?? null,
    revision: {
      id: args.revisionId,
      definitionId: args.definitionId ?? DEFINITION_A,
      manifest: value,
      canonicalManifestJson,
      functionDescriptors,
      functionDescriptorsDigestSha256,
      capabilityContractDigestSha256,
      channelContractDigestSha256,
      constructionContractDigestSha256,
      contractDigestSha256,
      distributionProvenance,
      uiArtifact,
      uiRuntime,
      serverArtifact,
      serverRuntimeAbi: value.server?.runtimeAbi ?? null,
      capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
      buildPolicyId: 'vibecanvas-release-v1',
      createdAtMs: nowMs,
    },
    source: {
      sourceSnapshotId,
      sourceDigestSha256,
      sourceArtifact,
      builderIdentity,
      createdAtMs: nowMs,
    },
    bindings,
    ...(args.publicationIdempotencyKey === undefined
      ? {}
      : {
          publicationIdentity: {
            idempotencyKey: args.publicationIdempotencyKey,
            previewId: uuid(920_001),
            previewRevisionId: args.previewRevisionId ?? uuid(920_002),
            canvasId: CANVAS_A,
            frameNodeId: 'frame-publication-idempotency',
            draftId: uuid(920_003),
            draftRevisionSha256: sourceDigestSha256,
            committedMutationId: 'mutation-publication-replay',
            definitionId: args.definitionId ?? DEFINITION_A,
            expectedActiveRevisionId: args.expectedActiveRevisionId ?? null,
            bindingRevision: 2,
            bindingPlanDigestSha256: fnWidgetPreviewBindingPlanDigest({
              bindings,
              digestSha256: (input) =>
                createHash('sha256').update(input).digest('hex'),
            }),
            sourceSnapshotId,
            sourceDigestSha256,
            sourceArtifactDigestSha256: sourceArtifact.digestSha256,
            canonicalManifestDigestSha256:
              createHash('sha256').update(canonicalManifestJson).digest('hex'),
            functionDescriptorsDigestSha256,
            capabilityContractDigestSha256,
            channelContractDigestSha256,
            constructionContractDigestSha256,
            previewContractDigestSha256: digest(920_004),
            unsignedUiArtifactDigestSha256: digest(920_005),
            previewUiArtifactDigestSha256: digest(920_006),
            capsuleArtifactHash: uiRuntime.capsuleArtifactHash,
            serverArtifactDigestSha256:
              serverArtifact?.digestSha256 ?? null,
            builderIdentity,
            capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
            buildPolicyId: 'vibecanvas-release-v1',
          },
        }),
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
      uiRuntime: {
        format: 'vibecanvas.capsule-runtime.v1',
        signatureKeyIds: ['vibecanvas-release-v1'],
      },
      capsuleBuildIdentity: { packageName: '@omnidraw/capsule' },
      buildPolicyId: 'vibecanvas-release-v1',
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
      uiRuntime: {
        capsuleArtifactHash: `sha256:${digest(1)}`,
        target: CAPSULE_TARGET,
      },
      serverArtifact: { id: uuid(415), kind: 'server', digestSha256: digest(2) },
      serverRuntimeAbi: 'vibecanvas:1',
    });
    expect(await (await service.db.prepare(`
      SELECT capsule_artifact_hash, capability_contract_digest_sha256,
        channel_contract_digest_sha256, build_policy_id, contract_format_version
      FROM widget_definition_revisions
      WHERE org_id = ? AND id = ?
    `)).get(TENANT_A.orgId, uuid(413))).toEqual({
      capsule_artifact_hash: secondRevision.uiRuntime.capsuleArtifactHash,
      capability_contract_digest_sha256: secondRevision.capabilityContractDigestSha256,
      channel_contract_digest_sha256: secondRevision.channelContractDigestSha256,
      build_policy_id: secondRevision.buildPolicyId,
      contract_format_version: 3,
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
      sourceDigestSha256: digest(900_030),
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

  test('replays one exact Preview publication after draft reconciliation and rejects key reuse', async () => {
    const previewId = uuid(920_001);
    const draftId = uuid(920_003);
    const chatId = uuid(4_010);
    await (await service.db.prepare(`
      INSERT INTO canvases (
        org_id, id, name, access_policy, created_by_account_id,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'Publication replay canvas', 'org', ?, 1, 1)
    `)).run(TENANT_A.orgId, CANVAS_A, TENANT_A.accountId);
    await (await service.db.prepare(`
      INSERT INTO canvas_members (
        org_id, canvas_id, account_id, role, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'owner', 1, 1)
    `)).run(TENANT_A.orgId, CANVAS_A, TENANT_A.accountId);
    const authoringStore = new AgentAuthoringStoreTurso(service.db, store);
    await authoringStore.createChat(TENANT_A, {
      id: chatId,
      canvasId: CANVAS_A,
      externalSessionKey: 'publication-replay-chat',
      name: 'Publication replay chat',
      workspaceRelativePath: 'chats/publication-replay',
      historyRelativePath: 'history/publication-replay.jsonl',
      nowMs: 1,
    });
    await authoringStore.createDraft(TENANT_A, {
      id: draftId,
      chatId,
      definitionId: DEFINITION_A,
      name: 'Publication replay draft',
      sourceRelativePath: 'drafts/publication-replay',
      nowMs: 2,
    });
    await authoringStore.ensurePreviewOwner(TENANT_A, {
      id: previewId,
      canvasId: CANVAS_A,
      frameNodeId: 'frame-publication-idempotency',
      draftId,
      originChatId: chatId,
      role: 'placed',
      nowMs: 3,
    });
    const reviewedPreviewRevisionId = uuid(920_002);
    const reviewedBindingPlanDigestSha256 = fnWidgetPreviewBindingPlanDigest({
      bindings: [],
      digestSha256: (input) =>
        createHash('sha256').update(input).digest('hex'),
    });
    await (await service.db.prepare(`
      UPDATE agent_drafts
      SET status = 'ready', source_digest_sha256 = ?,
        committed_mutation_id = 'mutation-publication-replay',
        build_sequence = 1, updated_at_ms = 4
      WHERE org_id = ? AND id = ?
    `)).run(
      digest(4_006),
      TENANT_A.orgId,
      draftId,
    );
    await (await service.db.prepare(`
      UPDATE agent_previews
      SET status = 'ready', active_revision_id = ?,
        binding_revision = 2, binding_plan_digest_sha256 = ?,
        source_digest_sha256 = ?,
        committed_mutation_id = 'mutation-publication-replay',
        build_sequence = 1,
        updated_at_ms = 4
      WHERE org_id = ? AND account_id = ? AND id = ?
    `)).run(
      reviewedPreviewRevisionId,
      reviewedBindingPlanDigestSha256,
      digest(4_006),
      TENANT_A.orgId,
      TENANT_A.accountId,
      previewId,
    );

    const publishedRevisionId = uuid(4_001);
    const uiArtifact = artifact(TENANT_A, {
      id: uuid(4_003),
      kind: 'ui',
      digest: digest(4_004),
      nowMs: 55,
    });
    const sourceArtifact = artifact(TENANT_A, {
      id: uuid(4_005),
      kind: 'source',
      digest: digest(4_006),
      nowMs: 55,
    });
    const common = {
      publicationIdempotencyKey: 'publish-reviewed-preview-once',
      uiArtifact,
      sourceArtifact,
      sourceSnapshotId: uuid(4_007),
      sourceDigestSha256: sourceArtifact.digestSha256,
      nowMs: 55,
    } as const;
    const first = await publish(store, TENANT_A, {
      ...common,
      revisionId: publishedRevisionId,
    });
    expect(first).toMatchObject({
      status: 'committed',
      revision: { id: publishedRevisionId },
      previousActiveRevisionId: null,
    });
    expect(await authoringStore.getPreviewOwner(TENANT_A, previewId))
      .toMatchObject({
        publishedPreviewRevisionId: reviewedPreviewRevisionId,
        publishedBindingRevision: 2,
        publishedBindingPlanDigestSha256: reviewedBindingPlanDigestSha256,
        publishedWidgetRevisionId: publishedRevisionId,
        publishedIdempotencyKey: common.publicationIdempotencyKey,
      });

    const restartedStore = new WidgetControlStoreTurso(service.db);
    const replay = await publish(restartedStore, TENANT_A, {
      ...common,
      revisionId: uuid(4_002),
      expectedActiveRevisionId: publishedRevisionId,
    });
    expect(replay).toMatchObject({
      status: 'committed',
      revision: { id: publishedRevisionId },
      previousActiveRevisionId: null,
    });
    expect(await rowCount(service, 'widget_definition_revisions')).toBe(1);
    const replayRows = await (await service.db.prepare(`
      SELECT count(*) AS count
      FROM widget_preview_publication_idempotency
      WHERE org_id = ? AND account_id = ?
    `)).get(TENANT_A.orgId, TENANT_A.accountId) as { count: unknown };
    expect(Number(replayRows.count)).toBe(1);

    await expect(publish(restartedStore, TENANT_A, {
      ...common,
      publicationIdempotencyKey: 'publish-reviewed-preview-twice',
      revisionId: uuid(4_010),
      expectedActiveRevisionId: publishedRevisionId,
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_ALREADY_PUBLISHED',
    });
    expect(await rowCount(service, 'widget_definition_revisions')).toBe(1);
    await (await service.db.prepare(`
      UPDATE agent_previews
      SET committed_mutation_id = 'mutation-publication-advanced'
      WHERE org_id = ? AND account_id = ? AND id = ?
    `)).run(TENANT_A.orgId, TENANT_A.accountId, previewId);
    await expect(publish(restartedStore, TENANT_A, {
      ...common,
      publicationIdempotencyKey: 'publish-stale-mutation-fence',
      revisionId: uuid(4_014),
      expectedActiveRevisionId: publishedRevisionId,
      nowMs: 55,
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_PUBLICATION_STALE',
    });
    await (await service.db.prepare(`
      UPDATE agent_previews
      SET committed_mutation_id = 'mutation-publication-replay'
      WHERE org_id = ? AND account_id = ? AND id = ?
    `)).run(TENANT_A.orgId, TENANT_A.accountId, previewId);

    const nextReviewedPreviewRevisionId = uuid(920_010);
    await (await service.db.prepare(`
      UPDATE agent_previews
      SET active_revision_id = ?, updated_at_ms = 55
      WHERE org_id = ? AND account_id = ? AND id = ?
    `)).run(
      nextReviewedPreviewRevisionId,
      TENANT_A.orgId,
      TENANT_A.accountId,
      previewId,
    );
    await (await service.db.prepare(`
      CREATE TRIGGER test_publication_owner_selection_race
      AFTER INSERT ON widget_preview_publication_idempotency
      WHEN NEW.idempotency_key = 'publish-owner-selection-race'
      BEGIN
        UPDATE agent_previews
        SET active_revision_id = 'raced-preview-revision'
        WHERE org_id = NEW.org_id
          AND account_id = NEW.account_id
          AND id = json_extract(NEW.publication_identity_json, '$.previewId');
      END
    `)).run();
    await expect(publish(restartedStore, TENANT_A, {
      ...common,
      publicationIdempotencyKey: 'publish-owner-selection-race',
      previewRevisionId: nextReviewedPreviewRevisionId,
      revisionId: uuid(4_013),
      expectedActiveRevisionId: publishedRevisionId,
      nowMs: 55,
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_PUBLICATION_STALE',
      message:
        'The reviewed Preview revision or binding plan changed before publication committed.',
    });
    expect(await rowCount(service, 'widget_definition_revisions')).toBe(1);
    expect(await restartedStore.getActiveRevision(TENANT_A, DEFINITION_A))
      .toMatchObject({ id: publishedRevisionId });
    expect(await (await service.db.prepare(`
      SELECT count(*) AS count
      FROM widget_preview_publication_idempotency
      WHERE org_id = ? AND account_id = ?
    `)).get(TENANT_A.orgId, TENANT_A.accountId)).toMatchObject({ count: 1 });
    expect(await authoringStore.getPreviewOwner(TENANT_A, previewId))
      .toMatchObject({ activeRevisionId: nextReviewedPreviewRevisionId });
    await (await service.db.prepare(`
      DROP TRIGGER test_publication_owner_selection_race
    `)).run();
    await (await service.db.prepare(`
      UPDATE agent_previews
      SET active_revision_id = ?, updated_at_ms = 57
      WHERE org_id = ? AND account_id = ? AND id = ?
    `)).run(
      reviewedPreviewRevisionId,
      TENANT_A.orgId,
      TENANT_A.accountId,
      previewId,
    );

    await expect(publish(store, TENANT_A, {
      ...common,
      revisionId: uuid(4_008),
      expectedActiveRevisionId: publishedRevisionId,
      previewRevisionId: uuid(4_009),
    })).rejects.toMatchObject({
      code: 'WIDGET_PUBLICATION_IDEMPOTENCY_CONFLICT',
    });

    const newerRevisionId = uuid(4_011);
    committed(await publish(store, TENANT_A, {
      revisionId: newerRevisionId,
      expectedActiveRevisionId: publishedRevisionId,
      nowMs: 60,
    }));
    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 60,
      inactiveBeforeMs: 60,
      limit: 100,
    })).prunedRevisionIds).toEqual([]);
    await expect(publish(store, TENANT_A, {
      ...common,
      revisionId: uuid(4_012),
      expectedActiveRevisionId: publishedRevisionId,
    })).resolves.toMatchObject({
      status: 'committed',
      revision: { id: publishedRevisionId },
    });

    await expect(authoringStore.closePreviewOwner(TENANT_A, {
      previewId,
      frameNodeId: 'frame-publication-idempotency',
      nowMs: 61,
    })).resolves.toBe(true);
    expect(await (await service.db.prepare(`
      SELECT count(*) AS count
      FROM widget_preview_publication_idempotency
      WHERE org_id = ? AND account_id = ?
    `)).get(TENANT_A.orgId, TENANT_A.accountId)).toMatchObject({ count: 0 });
    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 61,
      inactiveBeforeMs: 60,
      limit: 100,
    })).prunedRevisionIds).toEqual([publishedRevisionId]);
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
    } as unknown as TWidgetManifestV3;
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

    await (await service.db.prepare(`
      UPDATE widget_definition_revisions
      SET contract_digest_sha256 = ?, ui_runtime_json = ?
      WHERE org_id = ? AND id = ?
    `)).run(
      published.contractDigestSha256,
      JSON.stringify({
        ...published.uiRuntime,
        target: {
          ...published.uiRuntime.target,
          featureProfiles: ['artifact-resources-v1', 'canvas-2d-v1'],
        },
      }),
      TENANT_A.orgId,
      revisionId,
    );
    await expect(store.getRevision(TENANT_A, revisionId)).rejects.toMatchObject({
      code: 'WIDGET_REVISION_INTEGRITY_FAILED',
    });

    await expect((await service.db.prepare(`
      UPDATE widget_definition_revisions
      SET capsule_build_identity_json = ?
      WHERE org_id = ? AND id = ?
    `)).run(
      JSON.stringify({ ...published.capsuleBuildIdentity, privateKey: 'forbidden' }),
      TENANT_A.orgId,
      revisionId,
    )).rejects.toThrow();
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

  test('keeps inactive revisions only while synchronous durable references pin them', async () => {
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
          function_id, function_name, definition_revision,
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
        SELECT ?, ?, ?, 'widget_instance', ?, ?, ?, ?,
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
        idempotency_key,
        request_fingerprint_sha256, widget_definition_id, widget_revision_id,
        invocation_id, created_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, 'organization', NULL, NULL,
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
    expect(firstPrune.prunedRevisionIds).toEqual([revisions[0]]);
    expect(await store.getRevision(TENANT_A, revisions[0])).toBeNull();
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
    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 100,
      inactiveBeforeMs: 100,
      limit: 100,
    })).prunedRevisionIds).toEqual(revisions.slice(1, 4));
  });

  test('keeps a rolled-back revision while an active widget instance references it', async () => {
    const firstRevisionId = uuid(620);
    const rolledBackRevisionId = uuid(621);
    committed(await publish(store, TENANT_A, {
      definitionId: DEFINITION_B,
      revisionId: firstRevisionId,
      manifest: manifest({ slug: 'instance-pin', name: 'Instance pin' }),
      nowMs: 10,
    }));
    committed(await publish(store, TENANT_A, {
      definitionId: DEFINITION_B,
      revisionId: rolledBackRevisionId,
      expectedActiveRevisionId: firstRevisionId,
      manifest: manifest({ slug: 'instance-pin', name: 'Instance pin' }),
      nowMs: 20,
    }));
    await (await service.db.prepare(`
      INSERT INTO canvases (
        org_id, id, name, access_policy, created_by_account_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'Instance pin canvas', 'org', ?, 20, 20)
    `)).run(TENANT_A.orgId, CANVAS_A, TENANT_A.accountId);
    expect((await store.rollbackPublication(TENANT_A, {
      definitionId: DEFINITION_B,
      expectedActiveRevisionId: rolledBackRevisionId,
      targetRevisionId: firstRevisionId,
      nowMs: 30,
    })).status).toBe('updated');

    const instanceId = uuid(622);
    await (await service.db.prepare(`
      INSERT INTO widget_instances (
        org_id, id, canvas_id, element_id, definition_id, revision_id,
        status, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'instance-pin-element', ?, ?, 'active', 40, 40)
    `)).run(
      TENANT_A.orgId,
      instanceId,
      CANVAS_A,
      DEFINITION_B,
      rolledBackRevisionId,
    );
    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 40,
      inactiveBeforeMs: 40,
      limit: 100,
    })).prunedRevisionIds).toEqual([]);
    expect(await store.getRevision(TENANT_A, rolledBackRevisionId)).not.toBeNull();

    await (await service.db.prepare(`DELETE FROM widget_instances WHERE org_id = ? AND id = ?`))
      .run(TENANT_A.orgId, instanceId);
    expect((await store.pruneInactiveRevisions(TENANT_A, {
      nowMs: 40,
      inactiveBeforeMs: 40,
      limit: 100,
    })).prunedRevisionIds).toEqual([rolledBackRevisionId]);
  });


});
