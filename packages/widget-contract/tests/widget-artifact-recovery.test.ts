import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  type IWidgetArtifactBuilder,
  type IWidgetArtifactMutationCoordinator,
  type IWidgetArtifactStore,
  type IWidgetControlStore,
  type TWidgetArtifactDescriptor,
  type TWidgetArtifactPut,
  type TWidgetBuildRequest,
  type TWidgetBuildResult,
  type TWidgetManifestV3,
  type TWidgetPublicationCommitInput,
  type TWidgetPublicationCommitResult,
} from '../src';
import {
  LocalWidgetArtifactStore,
  WidgetArtifactGarbageCollector,
  WidgetArtifactOperationLane,
  WidgetPublicationService,
} from '../src/local';
import {
  CAPSULE_BUILD_IDENTITY,
  CAPSULE_MANIFEST,
  CAPSULE_RUNTIME_DESCRIPTOR,
} from './capsule.fixture';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const roots = new Set<string>();
const children = new Set<ReturnType<typeof Bun.spawn>>();

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-recovery',
  accountId: 'account-recovery',
  cellId: 'cell-recovery',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'request-recovery',
});

const manifest: TWidgetManifestV3 = Object.freeze({
  ...CAPSULE_MANIFEST,
  name: 'Recovery widget',
  slug: 'recovery-widget',
  ui: Object.freeze({ ...CAPSULE_MANIFEST.ui, entry: 'src/ui.ts' }),
});

const snapshotFiles = Object.freeze([
  Object.freeze({ path: 'src/ui.ts', bytes: new TextEncoder().encode('export const ui = true;') }),
]);
const snapshotHash = createHash('sha256');
for (const file of snapshotFiles) {
  const pathBytes = Buffer.from(file.path, 'utf8');
  snapshotHash.update(`${pathBytes.byteLength}:`);
  snapshotHash.update(pathBytes);
  snapshotHash.update(`:${file.bytes.byteLength}:`);
  snapshotHash.update(file.bytes);
  snapshotHash.update(';');
}
const snapshot = Object.freeze({
  id: 'snapshot-recovery',
  digestSha256: snapshotHash.digest('hex'),
  files: snapshotFiles,
  createdAtMs: 1,
});

const directMutationCoordinator: IWidgetArtifactMutationCoordinator = Object.freeze({
  runArtifactMutation: async <T>(_tenant: TTenantContext, operation: () => Promise<T>) => operation(),
});

type TDeferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}>;

type TCrashCheckpoint = Readonly<{
  type: 'widget-artifact-fsync-checkpoint';
  pid: number;
  digestSha256: string;
  byteSize: number;
}>;

function deferred<T>(): TDeferred<T> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return Object.freeze({ promise, resolve: resolvePromise, reject: rejectPromise });
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vibecanvas-widget-recovery-'));
  roots.add(root);
  return root;
}

function bounded<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        rejectPromise(error);
      },
    );
  });
}

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let value = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) throw new Error('Orphan writer exited before the durable checkpoint.');
      value += decoder.decode(next.value, { stream: true });
      const newline = value.indexOf('\n');
      if (newline >= 0) return value.slice(0, newline);
    }
  } finally {
    reader.releaseLock();
  }
}

function successfulBuilder(bytes = new TextEncoder().encode('immutable ui artifact')): IWidgetArtifactBuilder {
  return {
    async build(_tenant: TTenantContext, request: TWidgetBuildRequest): Promise<TWidgetBuildResult> {
      const uiDigestSha256 = sha256(bytes);
      const functionDescriptors = Object.freeze([]);
      const functionDescriptorsDigestSha256 = sha256(new TextEncoder().encode(
        fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors),
      ));
      const capabilityContractDigestSha256 = sha256(new TextEncoder().encode(
        fnCanonicalizeWidgetCapsuleCapabilityRequests([]),
      ));
      const channelContractDigestSha256 = sha256(new TextEncoder().encode(
        fnCanonicalizeWidgetCapsuleChannelContract(null),
      ));
      return Object.freeze({
        sourceSnapshotId: request.snapshot.id,
        sourceDigestSha256: request.snapshot.digestSha256,
        builderIdentity: request.builderIdentity,
        capsuleBuildIdentity: request.capsuleBuildIdentity,
        buildPolicyId: request.buildPolicyId,
        canonicalManifestJson: request.canonicalManifestJson,
        constructionContractDigestSha256: sha256(
          new TextEncoder().encode(`construction:${request.snapshot.digestSha256}`),
        ),
        distributionProvenance: Object.freeze({
          kind: 'external-distribution' as const,
          producer: Object.freeze({
            name: 'widget-artifact-recovery-test',
            version: '1',
            digest: `sha256:${'c'.repeat(64)}` as const,
          }),
          sourceRevision: request.snapshot.digestSha256,
          dependencyLockDigest: `sha256:${'d'.repeat(64)}` as const,
          buildConfigurationDigest: `sha256:${'e'.repeat(64)}` as const,
        }),
        functionDescriptors,
        functionDescriptorsDigestSha256,
        capabilityContractDigestSha256,
        channelContractDigestSha256,
        contractDigestSha256: sha256(new TextEncoder().encode(
          fnCanonicalizeWidgetContractPayload({
            canonicalManifestJson: request.canonicalManifestJson,
            uiDigestSha256,
            capsuleArtifactHash: CAPSULE_RUNTIME_DESCRIPTOR.capsuleArtifactHash,
            apiContract: CAPSULE_RUNTIME_DESCRIPTOR.apiContract,
            budgets: CAPSULE_RUNTIME_DESCRIPTOR.budgets,
            capabilityContractDigestSha256,
            channelContractDigestSha256,
            signatureKeyIds: CAPSULE_RUNTIME_DESCRIPTOR.signatureKeyIds,
            serverDigestSha256: null,
            serverRuntimeAbi: null,
            functionDescriptorsDigestSha256,
            sourceDigestSha256: request.snapshot.digestSha256,
            builderIdentity: request.builderIdentity,
            capsuleBuildIdentity: request.capsuleBuildIdentity,
            buildPolicyId: request.buildPolicyId,
          }),
        )),
        uiArtifact: Object.freeze({
          kind: 'ui',
          digestSha256: uiDigestSha256,
          bytes,
          capsuleArtifactHash: CAPSULE_RUNTIME_DESCRIPTOR.capsuleArtifactHash,
          runtimeDescriptor: CAPSULE_RUNTIME_DESCRIPTOR,
          builderIdentity: request.builderIdentity,
          capsuleBuildIdentity: request.capsuleBuildIdentity,
        }),
        serverArtifact: null,
        diagnostics: Object.freeze([]),
      });
    },
  };
}

function committedResult(
  publication: TWidgetPublicationCommitInput,
): TWidgetPublicationCommitResult {
  return Object.freeze({
    status: 'committed',
    previousActiveRevisionId: publication.expectedActiveRevisionId,
    definition: Object.freeze({
      orgId: tenant.orgId,
      id: publication.revision.definitionId,
      slug: publication.revision.manifest.slug,
      name: publication.revision.manifest.name,
      status: 'published',
      activeRevisionId: publication.revision.id,
      createdAtMs: publication.nowMs,
      updatedAtMs: publication.nowMs,
    }),
    revision: Object.freeze({
      orgId: tenant.orgId,
      ...publication.revision,
      revisionNumber: 1,
    }),
  });
}

function controlStoreHarness(overrides: Partial<IWidgetControlStore> = {}): Readonly<{
  store: IWidgetControlStore;
  calls: string[];
}> {
  const calls: string[] = [];
  const store: IWidgetControlStore = {
    async listPublishedDefinitions() {
      calls.push('listPublishedDefinitions');
      return [];
    },
    async createDefinition(callTenant, request) {
      calls.push('createDefinition');
      return {
        orgId: callTenant.orgId,
        id: request.id,
        slug: request.slug,
        name: request.name,
        status: 'draft',
        activeRevisionId: null,
        createdAtMs: request.nowMs,
        updatedAtMs: request.nowMs,
      };
    },
    async getDefinition() {
      calls.push('getDefinition');
      return null;
    },
    async getDefinitionBySlug() {
      calls.push('getDefinitionBySlug');
      return null;
    },
    async archiveDefinition() {
      calls.push('archiveDefinition');
      return { status: 'conflict', currentActiveRevisionId: null };
    },
    async getRevision() {
      calls.push('getRevision');
      return null;
    },
    async getActiveRevision() {
      calls.push('getActiveRevision');
      return null;
    },
    async getRevisionSource() {
      calls.push('getRevisionSource');
      return null;
    },
    async commitPublication() {
      calls.push('commitPublication');
      return { status: 'conflict', currentActiveRevisionId: null };
    },
    async rollbackPublication() {
      calls.push('rollbackPublication');
      return { status: 'conflict', currentActiveRevisionId: null };
    },
    async resolveArtifactReference() {
      calls.push('resolveArtifactReference');
      return null;
    },
    async isArtifactDigestReferenced() {
      calls.push('isArtifactDigestReferenced');
      return false;
    },
    async pruneInactiveRevisions() {
      calls.push('pruneInactiveRevisions');
      return { prunedRevisionIds: [] };
    },
    async reconcileArtifactRetention() {
      calls.push('reconcileArtifactRetention');
      return { pinnedArtifactIds: [], eligibleArtifactIds: [] };
    },
    async listArtifactGcCandidates() {
      calls.push('listArtifactGcCandidates');
      return [];
    },
    async claimArtifactDeletion() {
      calls.push('claimArtifactDeletion');
      return null;
    },
    async completeArtifactDeletion() {
      calls.push('completeArtifactDeletion');
      return { completed: false, deleteBlob: false };
    },
    async restoreArtifactRetention() {
      calls.push('restoreArtifactRetention');
      return false;
    },
    ...overrides,
  };
  return Object.freeze({ store, calls });
}

function blobArtifactStore(blobs: LocalWidgetArtifactStore): Readonly<{
  store: IWidgetArtifactStore;
  putCount: () => number;
}> {
  let writes = 0;
  const store: IWidgetArtifactStore = {
    async putArtifact(callTenant: TTenantContext, artifact: TWidgetArtifactPut) {
      writes += 1;
      const stored = await blobs.writeArtifact({
        kind: artifact.kind,
        bytes: artifact.bytes,
        expectedDigestSha256: artifact.digestSha256,
      });
      return Object.freeze({
        orgId: callTenant.orgId,
        id: artifact.id,
        kind: artifact.kind,
        digestSha256: stored.digestSha256,
        byteSize: stored.byteSize,
        retentionState: artifact.retentionState,
        retainUntilMs: artifact.retainUntilMs,
        createdAtMs: artifact.createdAtMs,
      });
    },
    async getArtifact() {
      return null;
    },
    async readArtifact() {
      return null;
    },
    async deleteArtifact(callTenant, request) {
      await blobs.deleteArtifact({
        orgId: callTenant.orgId,
        id: request.artifactId,
        kind: request.kind,
        digestSha256: request.digestSha256,
        byteSize: 0,
        retentionState: 'deleting',
        retainUntilMs: null,
        createdAtMs: 0,
      });
      return true;
    },
  };
  return Object.freeze({ store, putCount: () => writes });
}

function publishRequest(expectedActiveRevisionId: string | null = null) {
  return Object.freeze({
    definitionId: 'definition-recovery',
    expectedActiveRevisionId,
    revisionId: 'revision-recovery',
    snapshot,
    manifest,
    bindings: Object.freeze([]),
    builderIdentity: 'recovery-builder-v1',
    capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    buildPolicyId: 'vibecanvas-capsule-widget-v1',
    nowMs: 1_000,
  });
}

function gcRequest(nowMs = Date.now() + 2_000) {
  return Object.freeze({ nowMs, gracePeriodMs: 1_000, limit: 10 });
}

afterEach(async () => {
  for (const child of children) {
    child.kill(9);
    await bounded(child.exited, 5_000, 'orphan writer exit');
  }
  children.clear();
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

describe('widget artifact publication and GC recovery', () => {
  test('a build failure performs zero blob and control-store writes', async () => {
    const root = await temporaryRoot();
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: join(root, 'artifacts'),
    });
    const artifacts = blobArtifactStore(blobs);
    const control = controlStoreHarness();
    const publication = new WidgetPublicationService({
      builder: {
        async build() {
          throw Object.assign(new Error('compile failed'), { code: 'WIDGET_BUILD_FAILED' });
        },
      },
      artifacts: artifacts.store,
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
    });

    await expect(publication.publish(tenant, publishRequest())).rejects.toMatchObject({
      code: 'WIDGET_BUILD_FAILED',
    });
    expect(artifacts.putCount()).toBe(0);
    expect(await blobs.listBlobDigests()).toEqual([]);
    expect(control.calls).toEqual([]);
  });

  test('rejects a forged builder contract digest before writing artifact bytes', async () => {
    const root = await temporaryRoot();
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: join(root, 'artifacts'),
    });
    const artifacts = blobArtifactStore(blobs);
    const control = controlStoreHarness();
    const trustedBuilder = successfulBuilder();
    const publication = new WidgetPublicationService({
      builder: {
        async build(callTenant, request) {
          return {
            ...await trustedBuilder.build(callTenant, request),
            contractDigestSha256: '0'.repeat(64),
          };
        },
      },
      artifacts: artifacts.store,
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
    });

    await expect(publication.publish(tenant, publishRequest())).rejects.toMatchObject({
      code: 'WIDGET_BUILD_INTEGRITY_FAILED',
    });
    expect(artifacts.putCount()).toBe(0);
    expect(await blobs.listBlobDigests()).toEqual([]);
    expect(control.calls).toEqual([]);
  });

  test('SIGKILL after blob fsync leaves a durable orphan that restarted GC reconciles', async () => {
    const root = await temporaryRoot();
    const artifactsRoot = join(root, 'artifacts');
    const fixturePath = join(import.meta.dir, 'fixtures', 'widget-artifact-orphan-writer.ts');
    const bunExecutable = Bun.which('bun') ?? process.execPath;
    const writer = Bun.spawn([bunExecutable, fixturePath, artifactsRoot, tenant.orgId], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.add(writer);

    let checkpoint: TCrashCheckpoint;
    try {
      const line = await bounded(readLine(writer.stdout), 10_000, 'artifact fsync checkpoint');
      checkpoint = JSON.parse(line) as TCrashCheckpoint;
    } catch (error) {
      writer.kill(9);
      await bounded(writer.exited, 5_000, 'failed orphan writer exit');
      children.delete(writer);
      const stderr = await new Response(writer.stderr).text();
      throw new Error(`Orphan writer failed before its checkpoint: ${stderr}`, { cause: error });
    }

    expect(checkpoint.type).toBe('widget-artifact-fsync-checkpoint');
    expect(checkpoint.pid).toBe(writer.pid);
    writer.kill(9);
    expect(await bounded(writer.exited, 5_000, 'killed orphan writer exit')).not.toBe(0);
    children.delete(writer);

    const restartedBlobs = new LocalWidgetArtifactStore({ orgId: tenant.orgId, artifactsRoot });
    expect(await restartedBlobs.listBlobDigests()).toEqual([checkpoint.digestSha256]);
    const durable = await restartedBlobs.readArtifact({
      orgId: tenant.orgId,
      id: 'orphan',
      kind: 'ui',
      digestSha256: checkpoint.digestSha256,
      byteSize: checkpoint.byteSize,
      retentionState: 'eligible',
      retainUntilMs: 0,
      createdAtMs: 0,
    });
    expect(new TextDecoder().decode(durable)).toBe('durable orphan written before metadata');

    const control = controlStoreHarness();
    const collector = new WidgetArtifactGarbageCollector({
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
      blobs: restartedBlobs,
      operationLane: new WidgetArtifactOperationLane(),
    });
    expect(await collector.collect(tenant, gcRequest())).toMatchObject({ deleted: 1 });
    expect(await restartedBlobs.listBlobDigests()).toEqual([]);
  }, 20_000);

  test('publication CAS conflict leaves orphan bytes that a later GC pass removes', async () => {
    const root = await temporaryRoot();
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: join(root, 'artifacts'),
    });
    const artifacts = blobArtifactStore(blobs);
    const control = controlStoreHarness({
      async commitPublication() {
        return { status: 'conflict', currentActiveRevisionId: 'revision-winner' };
      },
    });
    const lane = new WidgetArtifactOperationLane();
    const publication = new WidgetPublicationService({
      builder: successfulBuilder(),
      artifacts: artifacts.store,
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
      operationLane: lane,
      createId: () => 'artifact-conflict',
    });

    expect(await publication.publish(tenant, publishRequest())).toEqual({
      status: 'conflict',
      currentActiveRevisionId: 'revision-winner',
    });
    expect(artifacts.putCount()).toBe(2);
    expect(await blobs.listBlobDigests()).toHaveLength(2);

    const collector = new WidgetArtifactGarbageCollector({
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
      blobs,
      operationLane: lane,
    });
    expect(await collector.collect(tenant, gcRequest())).toMatchObject({ deleted: 2 });
    expect(await blobs.listBlobDigests()).toEqual([]);
  });

  test('the shared operation lane is reentrant without releasing serialization', async () => {
    const lane = new WidgetArtifactOperationLane();
    const enteredCompeting = deferred<void>();
    const releaseOuter = deferred<void>();
    const order: string[] = [];

    const outer = lane.run(async () => {
      order.push('outer');
      await lane.run(async () => {
        order.push('nested');
      });
      await releaseOuter.promise;
      order.push('outer-finished');
    });
    await Bun.sleep(0);
    const competing = lane.run(async () => {
      order.push('competing');
      enteredCompeting.resolve(undefined);
    });

    expect(order).toEqual(['outer', 'nested']);
    const observation = await Promise.race([
      enteredCompeting.promise.then(() => 'entered' as const),
      Bun.sleep(25).then(() => 'blocked' as const),
    ]);
    expect(observation).toBe('blocked');
    releaseOuter.resolve(undefined);
    await bounded(Promise.all([outer, competing]), 5_000, 'reentrant lane completion');
    expect(order).toEqual(['outer', 'nested', 'outer-finished', 'competing']);
  });

  test('enumerates immutable final/temp candidates and cleans only files older than grace', async () => {
    const root = await temporaryRoot();
    const artifactsRoot = join(root, 'artifacts');
    const blobs = new LocalWidgetArtifactStore({ orgId: tenant.orgId, artifactsRoot });
    const stored = await blobs.writeArtifact({
      kind: 'ui',
      bytes: new TextEncoder().encode('fresh final orphan'),
    });
    const tempDigest = sha256(new TextEncoder().encode('crash temp bytes'));
    const tempRoot = join(artifactsRoot, 'blobs', 'sha256', tempDigest.slice(0, 2));
    const agedTempPath = join(tempRoot, `${tempDigest}.aged-temp.tmp`);
    const freshTempPath = join(tempRoot, `${tempDigest}.fresh-temp.tmp`);
    await mkdir(tempRoot, { recursive: true });
    await writeFile(agedTempPath, 'aged temp');
    await writeFile(freshTempPath, 'fresh temp');

    const nowMs = Date.now();
    const agedAt = new Date(nowMs - 5_000);
    await utimes(agedTempPath, agedAt, agedAt);
    const candidates = await blobs.listBlobCandidates();
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(candidates.every((candidate) => Object.isFrozen(candidate))).toBe(true);
    expect(candidates.map((candidate) => candidate.form).sort()).toEqual([
      'final',
      'temp',
      'temp',
    ]);
    expect(candidates.every((candidate) => Number.isFinite(candidate.modifiedAtMs))).toBe(true);

    const control = controlStoreHarness({
      async isArtifactDigestReferenced() {
        return false;
      },
    });
    const collector = new WidgetArtifactGarbageCollector({
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
      blobs,
      operationLane: new WidgetArtifactOperationLane(),
    });
    expect(await collector.collect(tenant, {
      nowMs,
      gracePeriodMs: 1_000,
      limit: 10,
    })).toMatchObject({ deleted: 1 });
    expect(await Bun.file(agedTempPath).exists()).toBe(false);
    expect(await Bun.file(freshTempPath).exists()).toBe(true);
    expect(await blobs.listBlobDigests()).toEqual([stored.digestSha256]);

    expect(await collector.collect(tenant, {
      nowMs: nowMs + 5_000,
      gracePeriodMs: 1_000,
      limit: 10,
    })).toMatchObject({ deleted: 2 });
    expect(await Bun.file(freshTempPath).exists()).toBe(false);
    expect(await blobs.listBlobCandidates()).toEqual([]);
  });

  test('the shared operation lane prevents GC from racing between blob write and metadata commit', async () => {
    const root = await temporaryRoot();
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: join(root, 'artifacts'),
    });
    const artifacts = blobArtifactStore(blobs);
    const commitEntered = deferred<void>();
    const releaseCommit = deferred<void>();
    const gcEntered = deferred<void>();
    const referencedDigests = new Set<string>();
    const control = controlStoreHarness({
      async commitPublication(_callTenant, request) {
        commitEntered.resolve(undefined);
        await releaseCommit.promise;
        referencedDigests.add(request.revision.uiArtifact.digestSha256);
        referencedDigests.add(request.source.sourceArtifact.digestSha256);
        return committedResult(request);
      },
      async pruneInactiveRevisions() {
        gcEntered.resolve(undefined);
        return { prunedRevisionIds: [] };
      },
      async isArtifactDigestReferenced(_callTenant, request) {
        return referencedDigests.has(request.digestSha256);
      },
    });
    const lane = new WidgetArtifactOperationLane();
    const publication = new WidgetPublicationService({
      builder: successfulBuilder(),
      artifacts: artifacts.store,
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
      operationLane: lane,
      createId: () => 'artifact-serialized',
    });
    const collector = new WidgetArtifactGarbageCollector({
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
      blobs,
      operationLane: lane,
    });

    const publishing = publication.publish(tenant, publishRequest());
    await bounded(commitEntered.promise, 5_000, 'publication commit entry');
    expect(await blobs.listBlobDigests()).toHaveLength(2);
    const collecting = collector.collect(tenant, gcRequest());
    const laneObservation = await Promise.race([
      gcEntered.promise.then(() => 'gc-entered' as const),
      Bun.sleep(50).then(() => 'gc-blocked' as const),
    ]);
    expect(laneObservation).toBe('gc-blocked');

    releaseCommit.resolve(undefined);
    expect((await bounded(publishing, 5_000, 'publication completion')).status).toBe('committed');
    expect(await bounded(collecting, 5_000, 'serialized GC completion')).toMatchObject({ deleted: 0 });
    expect(await blobs.listBlobDigests()).toHaveLength(2);
  });

  test('a restarted collector safely resumes a durable deleting candidate', async () => {
    const root = await temporaryRoot();
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: join(root, 'artifacts'),
    });
    const bytes = new TextEncoder().encode('delete after collector restart');
    const stored = await blobs.writeArtifact({ kind: 'ui', bytes });
    let candidate: TWidgetArtifactDescriptor | null = {
      orgId: tenant.orgId,
      id: 'artifact-deleting',
      kind: 'ui',
      digestSha256: stored.digestSha256,
      byteSize: stored.byteSize,
      retentionState: 'deleting',
      retainUntilMs: 1,
      createdAtMs: 1,
    };
    let failCompletion = true;
    const control = controlStoreHarness({
      async listArtifactGcCandidates() {
        return candidate ? [candidate] : [];
      },
      async claimArtifactDeletion() {
        return candidate;
      },
      async completeArtifactDeletion() {
        if (failCompletion) throw new Error('simulated collector shutdown');
        candidate = null;
        return { completed: true, deleteBlob: true };
      },
      async isArtifactDigestReferenced() {
        return candidate !== null;
      },
    });
    const interrupted = new WidgetArtifactGarbageCollector({
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
      blobs,
      operationLane: new WidgetArtifactOperationLane(),
    });

    await expect(interrupted.collect(tenant, gcRequest())).rejects.toThrow('simulated collector shutdown');
    expect(candidate?.retentionState).toBe('deleting');
    expect(await blobs.listBlobDigests()).toEqual([stored.digestSha256]);

    failCompletion = false;
    const restarted = new WidgetArtifactGarbageCollector({
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
      blobs,
      operationLane: new WidgetArtifactOperationLane(),
    });
    expect(await restarted.collect(tenant, gcRequest())).toMatchObject({ deleted: 1 });
    expect(candidate).toBeNull();
    expect(await blobs.listBlobDigests()).toEqual([]);
  });

  test('shared digest bytes survive one metadata deletion and disappear after the final reference', async () => {
    const root = await temporaryRoot();
    const blobs = new LocalWidgetArtifactStore({
      orgId: tenant.orgId,
      artifactsRoot: join(root, 'artifacts'),
    });
    const stored = await blobs.writeArtifact({
      kind: 'ui',
      bytes: new TextEncoder().encode('shared immutable bytes'),
    });
    let candidate: TWidgetArtifactDescriptor | null = {
      orgId: tenant.orgId,
      id: 'artifact-first-reference',
      kind: 'ui',
      digestSha256: stored.digestSha256,
      byteSize: stored.byteSize,
      retentionState: 'eligible',
      retainUntilMs: 1,
      createdAtMs: 1,
    };
    let finalReferenceExists = true;
    const control = controlStoreHarness({
      async listArtifactGcCandidates() {
        return candidate ? [candidate] : [];
      },
      async claimArtifactDeletion() {
        return candidate;
      },
      async completeArtifactDeletion() {
        candidate = null;
        return { completed: true, deleteBlob: false };
      },
      async isArtifactDigestReferenced() {
        return finalReferenceExists;
      },
    });
    const collector = new WidgetArtifactGarbageCollector({
      controlStore: control.store,
      mutationCoordinator: directMutationCoordinator,
      blobs,
      operationLane: new WidgetArtifactOperationLane(),
    });

    expect(await collector.collect(tenant, gcRequest())).toMatchObject({ deleted: 1 });
    expect(await blobs.listBlobDigests()).toEqual([stored.digestSha256]);

    finalReferenceExists = false;
    expect(await collector.collect(tenant, gcRequest(Date.now() + 10_000))).toMatchObject({ deleted: 1 });
    expect(await blobs.listBlobDigests()).toEqual([]);
  });
});
