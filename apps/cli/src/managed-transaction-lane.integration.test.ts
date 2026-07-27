import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { generateAutomergeUrl, parseAutomergeUrl } from '@automerge/automerge-repo';
import type { Database } from '@tursodatabase/database';
import type { TInvocationCreateRequest } from '@vibecanvas/function-runtime';
import { TursoStorageAdapter } from '@vibecanvas/service-automerge/adapters/turso.adapter';
import { DEFAULT_OSS_ACCOUNT_ID, DEFAULT_OSS_ORGANIZATION_ID } from '@vibecanvas/service-db/CONSTANTS';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { FunctionControlStoreTurso } from '@vibecanvas/service-db/FunctionControlStoreTurso';
import { fnFunctionCanonicalJson } from '@vibecanvas/service-db/FunctionControlStoreTurso/fn.function-json';
import { fnFunctionId } from '@vibecanvas/service-db/FunctionControlStoreTurso/fn.function-id';
import { WidgetControlStoreTurso } from '@vibecanvas/service-db/WidgetControlStoreTurso';
import { WidgetInstanceMetadataStoreTurso } from '@vibecanvas/service-db/WidgetInstanceMetadataStoreTurso';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
} from '@vibecanvas/widget-contract';
import type {
  TWidgetCapsuleBuildIdentity,
  TWidgetCapsuleBudgets,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetManifestV3,
  TWidgetServerFunctionDescriptor,
} from '@vibecanvas/widget-contract';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const CANVAS_ID = uuid(950);
const DEFINITION_ID = uuid(951);
const REVISION_ID = uuid(952);
const UI_ARTIFACT_ID = uuid(953);
const SERVER_ARTIFACT_ID = uuid(954);
const SOURCE_ARTIFACT_ID = uuid(959);
const INSTANCE_ID = uuid(955);
const QUEUED_DEFINITION_ID = uuid(956);
const RECOVERED_DEFINITION_ID = uuid(957);
const CANVAS_URL = generateAutomergeUrl();
const CANVAS_DOCUMENT_KEY = parseAutomergeUrl(CANVAS_URL).documentId;
const UI_DIGEST = sha256('managed-lane-ui');
const SERVER_DIGEST = sha256('managed-lane-server');
const SOURCE_DIGEST = sha256('managed-lane-source');
const CAPABILITY_CONTRACT_DIGEST = sha256(
  fnCanonicalizeWidgetCapsuleCapabilityRequests([]),
);
const CHANNEL_CONTRACT_DIGEST = sha256(
  fnCanonicalizeWidgetCapsuleChannelContract(null),
);
const WIDGET_BUILD_POLICY_ID = 'vibecanvas-capsule-widget-v1';
const CAPSULE_BUILD_IDENTITY: TWidgetCapsuleBuildIdentity = {
  packageName: '@omnidraw/capsule',
  packageVersion: '0.9.4',
  packageDigest: 'sha256:0d39b40a978fc0ce483c64c40f83eb25fd77f6f970d361feb5a4875de6758189',
  buildApiVersion: '0.1.0',
  runtimeBuildDigest: 'sha256:8d6786bf0775f33724c74ea6f71841f5e61dd86d0de7c2b6c3d6c61f9d4ea146',
};
const CAPSULE_BUDGETS: TWidgetCapsuleBudgets = {
  cpuMs: 100,
  memoryBytes: 16 * 1024 * 1024,
  domNodes: 1_000,
  handles: 2_000,
  messageBytes: 64 * 1024,
  streamBytes: 64 * 1024,
  assetBytes: 0,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 64 * 1024,
};

const TENANT = fnFreezeTenantContext({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: uuid(958),
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'managed-transaction-lane',
  canvasId: CANVAS_ID,
});

const FUNCTION_DESCRIPTOR: TWidgetServerFunctionDescriptor = {
  schemaVersion: 1,
  exportName: 'readWeather',
  modulePath: 'server/read-weather.server.ts',
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
  retry: {
    mode: 'none',
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
  },
};

const MANIFEST: TWidgetManifestV3 = {
  schemaVersion: 3,
  name: 'Managed Lane Widget',
  slug: 'managed-lane-widget',
  ui: {
    runtime: 'capsule',
    entry: 'ui.js',
    target: {
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
      featureProfiles: [],
    },
  },
  server: { entry: 'server.js', runtimeAbi: 'vibecanvas:1' },
};
const UI_RUNTIME: TWidgetCapsuleRuntimeDescriptor = {
  format: 'vibecanvas.capsule-runtime.v1',
  capsuleArtifactHash: `sha256:${UI_DIGEST}`,
  target: MANIFEST.ui.target,
  budgets: CAPSULE_BUDGETS,
  capabilityRequests: [],
  channels: null,
  parkability: { parkable: false },
  signatureKeyIds: ['vibecanvas-release-v1'],
};

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function holdNextTransaction(database: Database): Readonly<{
  entered: Promise<void>;
  release: () => void;
}> {
  const entered = deferred();
  const release = deferred();
  const original = database.transaction.bind(database);
  let intercepted = false;
  const transaction = ((operation: Parameters<Database['transaction']>[0]) => {
    if (intercepted) return original(operation);
    intercepted = true;
    return original(async () => {
      entered.resolve();
      await release.promise;
      return operation();
    });
  }) as Database['transaction'];
  Object.defineProperty(database, 'transaction', {
    configurable: true,
    value: transaction,
  });
  return { entered: entered.promise, release: release.resolve };
}

async function publishFunctionWidget(store: WidgetControlStoreTurso): Promise<string> {
  await store.createDefinition(TENANT, {
    id: DEFINITION_ID,
    slug: MANIFEST.slug,
    name: MANIFEST.name,
    nowMs: 10,
  });
  const canonicalManifestJson = fnCanonicalizeWidgetManifest(MANIFEST);
  const functionDescriptorsDigestSha256 = sha256(
    fnCanonicalizeWidgetServerFunctionDescriptors([FUNCTION_DESCRIPTOR]),
  );
  const contractDigestSha256 = sha256(fnCanonicalizeWidgetContractPayload({
    canonicalManifestJson,
    uiDigestSha256: UI_DIGEST,
    capsuleArtifactHash: UI_RUNTIME.capsuleArtifactHash,
    target: UI_RUNTIME.target,
    budgets: UI_RUNTIME.budgets,
    capabilityContractDigestSha256: CAPABILITY_CONTRACT_DIGEST,
    channelContractDigestSha256: CHANNEL_CONTRACT_DIGEST,
    signatureKeyIds: UI_RUNTIME.signatureKeyIds,
    serverDigestSha256: SERVER_DIGEST,
    serverRuntimeAbi: MANIFEST.server!.runtimeAbi,
    functionDescriptorsDigestSha256,
    sourceDigestSha256: SOURCE_DIGEST,
    builderIdentity: 'managed-transaction-lane-test',
    capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    buildPolicyId: WIDGET_BUILD_POLICY_ID,
  }));
  const result = await store.commitPublication(TENANT, {
    expectedActiveRevisionId: null,
    revision: {
      id: REVISION_ID,
      definitionId: DEFINITION_ID,
      manifest: MANIFEST,
      canonicalManifestJson,
      functionDescriptors: [FUNCTION_DESCRIPTOR],
      functionDescriptorsDigestSha256,
      capabilityContractDigestSha256: CAPABILITY_CONTRACT_DIGEST,
      channelContractDigestSha256: CHANNEL_CONTRACT_DIGEST,
      contractDigestSha256,
      uiArtifact: {
        orgId: TENANT.orgId,
        id: UI_ARTIFACT_ID,
        kind: 'ui',
        digestSha256: UI_DIGEST,
        byteSize: 10,
        retentionState: 'pinned',
        retainUntilMs: null,
        createdAtMs: 20,
      },
      uiRuntime: UI_RUNTIME,
      serverArtifact: {
        orgId: TENANT.orgId,
        id: SERVER_ARTIFACT_ID,
        kind: 'server',
        digestSha256: SERVER_DIGEST,
        byteSize: 20,
        retentionState: 'pinned',
        retainUntilMs: null,
        createdAtMs: 20,
      },
      serverRuntimeAbi: MANIFEST.server!.runtimeAbi,
      capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
      buildPolicyId: WIDGET_BUILD_POLICY_ID,
      createdAtMs: 20,
    },
    source: {
      sourceSnapshotId: uuid(960),
      sourceDigestSha256: SOURCE_DIGEST,
      sourceArtifact: {
        orgId: TENANT.orgId,
        id: SOURCE_ARTIFACT_ID,
        kind: 'source',
        digestSha256: SOURCE_DIGEST,
        byteSize: 30,
        retentionState: 'pinned',
        retainUntilMs: null,
        createdAtMs: 20,
      },
      builderIdentity: 'managed-transaction-lane-test',
      createdAtMs: 20,
    },
    bindings: [],
    nowMs: 20,
  });
  if (result.status !== 'committed') throw new Error('Managed lane fixture publication conflicted.');
  return contractDigestSha256;
}

function invocationRequest(
  invocationId: string,
  idempotencyRecordId: string,
  idempotencyKey: string,
  contractDigestSha256: string,
): TInvocationCreateRequest {
  const input = { city: 'Berlin', invocationId };
  const inputDigestSha256 = sha256(fnFunctionCanonicalJson(input));
  return {
    envelope: {
      id: invocationId,
      tenant: TENANT,
      widgetDefinitionId: DEFINITION_ID,
      widgetRevisionId: REVISION_ID,
      subject: {
        kind: 'widget_instance',
        canvasId: CANVAS_ID,
        widgetInstanceId: INSTANCE_ID,
      },
      functionId: fnFunctionId(DEFINITION_ID, FUNCTION_DESCRIPTOR.exportName),
      functionName: FUNCTION_DESCRIPTOR.exportName,
      definitionRevision: 1,
      artifactDigestSha256: SERVER_DIGEST,
      contractDigestSha256,
      runtimeAbi: MANIFEST.server!.runtimeAbi,
      input,
      inputDigestSha256,
      idempotencyKey,
      policyVersion: 1,
      priority: 10,
      limits: FUNCTION_DESCRIPTOR.limits,
      retry: FUNCTION_DESCRIPTOR.retry,
      createdAtMs: 100,
      deadlineAtMs: 1_100,
    },
    idempotencyRecordId,
    idempotencyScope: { kind: 'widget_instance', widgetInstanceId: INSTANCE_ID },
    requestFingerprintSha256: inputDigestSha256,
    idempotencyExpiresAtMs: 2_000,
  };
}

describe('managed database transaction lane', () => {
  let service: DbServiceTurso;
  let storage: TursoStorageAdapter | undefined;

  beforeEach(async () => {
    service = new DbServiceTurso({ databasePath: ':memory:', dataDir: '.', cacheDir: '.' });
    await service.start();
    await service.canvas.create(TENANT, {
      id: CANVAS_ID,
      name: 'Managed Transaction Lane',
      automerge_url: CANVAS_URL,
    });
  });

  afterEach(async () => {
    storage?.dispose();
    storage = undefined;
    await service.stop();
  });

  test('queues function and publication writes behind projection and recovers after rejection', async () => {
    const widgetStore = new WidgetControlStoreTurso(service.db);
    const projectionStore = new WidgetInstanceMetadataStoreTurso(service.db);
    const functionStore = new FunctionControlStoreTurso(service.db, { nowMs: () => 100 });
    const contractDigestSha256 = await publishFunctionWidget(widgetStore);
    const instance = {
      instanceId: INSTANCE_ID,
      elementId: 'managed-lane-element',
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
      stateDocumentId: null,
    } as const;
    await (await service.db.prepare(`
      UPDATE collaboration_documents SET content_version = 1
      WHERE org_id = ? AND canvas_id = ?
    `)).run(TENANT.orgId, CANVAS_ID);
    await projectionStore.applyProjectionBatch(TENANT, {
      snapshots: [{ canvasId: CANVAS_ID, sourceSequence: 1, projectedAtMs: 30, instances: [instance] }],
    });

    await (await service.db.prepare(`
      UPDATE collaboration_documents SET content_version = 2
      WHERE org_id = ? AND canvas_id = ?
    `)).run(TENANT.orgId, CANVAS_ID);
    const gate = holdNextTransaction(service.db);
    const projection = projectionStore.applyProjectionBatch(TENANT, {
      snapshots: [{ canvasId: CANVAS_ID, sourceSequence: 2, projectedAtMs: 31, instances: [instance] }],
    });
    await gate.entered;

    let invocationSettled = false;
    let publicationSettled = false;
    const invocation = functionStore.createOrReplayInvocation(TENANT, invocationRequest(
      uuid(959),
      uuid(960),
      'managed-lane-first',
      contractDigestSha256,
    )).finally(() => { invocationSettled = true; });
    const publication = widgetStore.createDefinition(TENANT, {
      id: QUEUED_DEFINITION_ID,
      slug: 'managed-lane-queued',
      name: 'Managed Lane Queued',
      nowMs: 40,
    }).finally(() => { publicationSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(invocationSettled).toBe(false);
    expect(publicationSettled).toBe(false);

    gate.release();
    await expect(projection).resolves.toEqual([
      expect.objectContaining({ status: 'applied', sourceSequence: 2 }),
    ]);
    await expect(invocation).resolves.toMatchObject({ status: 'created' });
    await expect(publication).resolves.toMatchObject({ id: QUEUED_DEFINITION_ID });

    await expect(widgetStore.createDefinition(TENANT, {
      id: uuid(961),
      slug: 'managed-lane-queued',
      name: 'Duplicate Managed Lane',
      nowMs: 41,
    })).rejects.toThrow();
    await expect(functionStore.createOrReplayInvocation(TENANT, invocationRequest(
      uuid(962),
      uuid(963),
      'managed-lane-after-rejection',
      contractDigestSha256,
    ))).resolves.toMatchObject({ status: 'created' });
  });

  test('commits a direct DbService write only after a rejected projection rolls back', async () => {
    const widgetStore = new WidgetControlStoreTurso(service.db);
    const projectionStore = new WidgetInstanceMetadataStoreTurso(service.db);
    await publishFunctionWidget(widgetStore);
    const instance = {
      instanceId: INSTANCE_ID,
      elementId: 'managed-lane-element',
      definitionId: DEFINITION_ID,
      revisionId: REVISION_ID,
      stateDocumentId: null,
    } as const;
    await (await service.db.prepare(`
      UPDATE collaboration_documents SET content_version = 1
      WHERE org_id = ? AND canvas_id = ?
    `)).run(TENANT.orgId, CANVAS_ID);
    await projectionStore.applyProjectionBatch(TENANT, {
      snapshots: [{ canvasId: CANVAS_ID, sourceSequence: 1, projectedAtMs: 30, instances: [instance] }],
    });

    await (await service.db.prepare(`
      UPDATE collaboration_documents SET content_version = 2
      WHERE org_id = ? AND canvas_id = ?
    `)).run(TENANT.orgId, CANVAS_ID);
    const gate = holdNextTransaction(service.db);
    const rejectedProjection = projectionStore.applyProjectionBatch(TENANT, {
      snapshots: [{
        canvasId: CANVAS_ID,
        sourceSequence: 2,
        projectedAtMs: 31,
        instances: [{ ...instance, elementId: 'conflicting-element' }],
      }],
    });
    await gate.entered;
    let renameSettled = false;
    const rename = service.canvas.renameById(TENANT, {
      id: CANVAS_ID,
      name: 'Rename Survives Projection Rollback',
    }).finally(() => { renameSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(renameSettled).toBe(false);

    gate.release();
    await expect(rejectedProjection).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_PROJECTION_IDENTITY_CONFLICT',
    });
    await expect(rename).resolves.toMatchObject({
      id: CANVAS_ID,
      name: 'Rename Survives Projection Rollback',
    });
    await expect(service.canvas.findById(TENANT, { id: CANVAS_ID })).resolves.toMatchObject({
      name: 'Rename Survives Projection Rollback',
    });
  });

  test('queues control writes behind Automerge persistence on the same database', async () => {
    const widgetStore = new WidgetControlStoreTurso(service.db);
    storage = new TursoStorageAdapter(service.db);
    await expect(storage.admitDocument(TENANT, CANVAS_URL)).resolves.toBe(true);

    const gate = holdNextTransaction(service.db);
    const persistence = storage.save(
      [CANVAS_DOCUMENT_KEY, 'snapshot', 'lane'],
      new Uint8Array([1, 2, 3]),
    );
    await gate.entered;
    let controlSettled = false;
    const control = widgetStore.createDefinition(TENANT, {
      id: RECOVERED_DEFINITION_ID,
      slug: 'managed-lane-after-automerge',
      name: 'Managed Lane After Automerge',
      nowMs: 50,
    }).finally(() => { controlSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(controlSettled).toBe(false);

    gate.release();
    await expect(persistence).resolves.toBeUndefined();
    await expect(control).resolves.toMatchObject({ id: RECOVERED_DEFINITION_ID });
    await expect(storage.load(
      [CANVAS_DOCUMENT_KEY, 'snapshot', 'lane'],
    )).resolves.toEqual(new Uint8Array([1, 2, 3]));

    const storageRollbackGate = holdNextTransaction(service.db);
    const rejectedPersistence = storage.save(
      [CANVAS_DOCUMENT_KEY, 'snapshot', 'empty'],
      new Uint8Array(),
    );
    await storageRollbackGate.entered;
    let renameSettled = false;
    const rename = service.canvas.renameById(TENANT, {
      id: CANVAS_ID,
      name: 'Rename Survives Automerge Rollback',
    }).finally(() => { renameSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(renameSettled).toBe(false);
    storageRollbackGate.release();
    await expect(rejectedPersistence).rejects.toThrow();
    await expect(rename).resolves.toMatchObject({ name: 'Rename Survives Automerge Rollback' });
    await expect(service.canvas.findById(TENANT, { id: CANVAS_ID })).resolves.toMatchObject({
      name: 'Rename Survives Automerge Rollback',
    });

    const controlRollbackGate = holdNextTransaction(service.db);
    const rejectedControl = widgetStore.createDefinition(TENANT, {
      id: uuid(964),
      slug: 'managed-lane-after-automerge',
      name: 'Duplicate Managed Lane Definition',
      nowMs: 51,
    });
    await controlRollbackGate.entered;
    let removalSettled = false;
    const removal = storage.remove(
      [CANVAS_DOCUMENT_KEY, 'snapshot', 'lane'],
    ).finally(() => { removalSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(removalSettled).toBe(false);
    controlRollbackGate.release();
    await expect(rejectedControl).rejects.toThrow();
    await expect(removal).resolves.toBeUndefined();
    await expect(storage.load(
      [CANVAS_DOCUMENT_KEY, 'snapshot', 'lane'],
    )).resolves.toBeUndefined();
  });
});
