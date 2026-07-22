import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  type IWidgetArtifactBuilder,
  type IWidgetArtifactMutationCoordinator,
  type IWidgetArtifactStore,
  type IWidgetPreviewStore,
  type TWidgetArtifactDescriptor,
  type TWidgetArtifactPut,
  type TWidgetBuildResult,
  type TWidgetManifestV2,
  type TWidgetPreviewCommitInput,
  type TWidgetPreviewRevisionDescriptor,
  type TWidgetSourceSnapshot,
} from '../src';
import { WidgetPreviewService, WidgetSourceSnapshot } from '../src/local';
import { TEST_SERVER_FUNCTION_DESCRIPTOR } from './function-descriptor.fixture';

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-preview',
  accountId: 'account-preview',
  cellId: 'cell-preview',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'request-preview',
});

const uiManifest: TWidgetManifestV2 = Object.freeze({
  schemaVersion: 2,
  name: 'Preview widget',
  slug: 'preview-widget',
  ui: Object.freeze({ entry: 'src/ui.ts' }),
});

const serverManifest: TWidgetManifestV2 = Object.freeze({
  ...uiManifest,
  name: 'Server preview widget',
  slug: 'server-preview-widget',
  server: Object.freeze({ entry: 'server/run.server.ts', runtimeAbi: 'vibecanvas:1' }),
});

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function snapshotDigest(files: TWidgetSourceSnapshot['files']): string {
  const hash = createHash('sha256');
  for (const file of files) {
    const pathBytes = Buffer.from(file.path, 'utf8');
    hash.update(`${pathBytes.byteLength}:`);
    hash.update(pathBytes);
    hash.update(`:${file.bytes.byteLength}:`);
    hash.update(file.bytes);
    hash.update(';');
  }
  return hash.digest('hex');
}

function snapshot(id: string, withServer: boolean): TWidgetSourceSnapshot {
  const files = Object.freeze([
    Object.freeze({ path: 'src/ui.ts', bytes: new TextEncoder().encode('export const ui = true;') }),
    ...(withServer
      ? [Object.freeze({
          path: 'server/run.server.ts',
          bytes: new TextEncoder().encode('export const run = true;'),
        })]
      : []),
  ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return Object.freeze({ id, digestSha256: snapshotDigest(files), files, createdAtMs: 1 });
}

function builder(): IWidgetArtifactBuilder {
  const value: IWidgetArtifactBuilder = {
    async build(_tenant, request): Promise<TWidgetBuildResult> {
      const uiBytes = new TextEncoder().encode(`ui:${request.snapshot.digestSha256}`);
      const uiArtifact = Object.freeze({
        kind: 'ui' as const,
        digestSha256: sha256(uiBytes),
        bytes: uiBytes,
      });
      const serverBytes = request.manifest.server === undefined
        ? null
        : new TextEncoder().encode(`server:${request.snapshot.digestSha256}`);
      const serverArtifact = serverBytes === null
        ? null
        : Object.freeze({
            kind: 'server' as const,
            digestSha256: sha256(serverBytes),
            bytes: serverBytes,
          });
      const functionDescriptors = request.manifest.server === undefined
        ? Object.freeze([])
        : Object.freeze([TEST_SERVER_FUNCTION_DESCRIPTOR]);
      const functionDescriptorsDigestSha256 = sha256(
        fnCanonicalizeWidgetServerFunctionDescriptors(functionDescriptors),
      );
      const contractDigestSha256 = sha256(fnCanonicalizeWidgetContractPayload({
        canonicalManifestJson: request.canonicalManifestJson,
        uiDigestSha256: uiArtifact.digestSha256,
        serverDigestSha256: serverArtifact?.digestSha256 ?? null,
        runtimeAbi: request.manifest.server?.runtimeAbi ?? null,
        functionDescriptorsDigestSha256,
      }));
      return Object.freeze({
        sourceSnapshotId: request.snapshot.id,
        sourceDigestSha256: request.snapshot.digestSha256,
        builderIdentity: request.builderIdentity,
        canonicalManifestJson: request.canonicalManifestJson,
        functionDescriptors,
        functionDescriptorsDigestSha256,
        contractDigestSha256,
        uiArtifact,
        serverArtifact,
      });
    },
  };
  return Object.freeze(value);
}

function artifactStore(writes: TWidgetArtifactPut[]): IWidgetArtifactStore {
  const store: IWidgetArtifactStore = {
    async putArtifact(callTenant, artifact): Promise<TWidgetArtifactDescriptor> {
      writes.push(artifact);
      return Object.freeze({
        orgId: callTenant.orgId,
        id: artifact.id,
        kind: artifact.kind,
        digestSha256: artifact.digestSha256,
        byteSize: artifact.bytes.byteLength,
        retentionState: artifact.retentionState,
        retainUntilMs: artifact.retainUntilMs,
        createdAtMs: artifact.createdAtMs,
      });
    },
    async getArtifact() { return null; },
    async readArtifact() { return null; },
    async deleteArtifact() { return false; },
  };
  return Object.freeze(store);
}

function previewStore(commits: TWidgetPreviewCommitInput[]): IWidgetPreviewStore {
  const revisions = new Map<string, TWidgetPreviewRevisionDescriptor>();
  const active = new Map<string, string>();
  const store: IWidgetPreviewStore = {
    async commitPreview(callTenant, request) {
      commits.push(request);
      const current = active.get(request.revision.previewId) ?? null;
      if (current !== request.expectedActiveRevisionId) {
        return { status: 'conflict' as const, currentActiveRevisionId: current };
      }
      const revision = Object.freeze({ orgId: callTenant.orgId, ...request.revision });
      revisions.set(revision.id, revision);
      active.set(revision.previewId, revision.id);
      return Object.freeze({
        status: 'committed' as const,
        revision,
        previousActiveRevisionId: current,
      });
    },
    async getPreview(_callTenant, request) {
      const revisionId = active.get(request.previewId);
      return revisionId === undefined ? null : revisions.get(revisionId) ?? null;
    },
    async getPreviewRevision(_callTenant, request) {
      const revision = revisions.get(request.revisionId);
      return revision !== undefined && revision.previewId === request.previewId ? revision : null;
    },
    async stopPreview(_callTenant, request) {
      if (active.get(request.previewId) !== request.expectedActiveRevisionId) return false;
      active.delete(request.previewId);
      return true;
    },
    async resolvePreviewArtifact(_callTenant, request) {
      const revision = revisions.get(request.revisionId);
      if (!revision || revision.previewId !== request.previewId) return null;
      const artifact = request.kind === 'ui' ? revision.uiArtifact : revision.serverArtifact;
      return artifact !== null
        && artifact.id === request.artifactId
        && artifact.digestSha256 === request.digestSha256
        ? artifact
        : null;
    },
  };
  return Object.freeze(store);
}

const mutationCoordinatorValue: IWidgetArtifactMutationCoordinator = {
  runArtifactMutation: async (_tenant, operation) => operation(),
};
const mutationCoordinator = Object.freeze(mutationCoordinatorValue);

describe('immutable widget previews', () => {
  test('builds UI-only and server-backed previews without actor state', async () => {
    const writes: TWidgetArtifactPut[] = [];
    const commits: TWidgetPreviewCommitInput[] = [];
    let artifactSequence = 0;
    const service = new WidgetPreviewService({
      builder: builder(),
      artifacts: artifactStore(writes),
      previewStore: previewStore(commits),
      mutationCoordinator,
      createId: () => `artifact-${++artifactSequence}`,
    });

    const uiSnapshot = snapshot('source-ui', false);
    const uiResult = await service.buildPreview(tenant, {
      previewId: 'preview-ui',
      expectedActiveRevisionId: null,
      revisionId: 'preview-ui-r1',
      draftId: 'draft-ui',
      definitionId: 'definition-ui',
      draftRevisionSha256: uiSnapshot.digestSha256,
      snapshot: uiSnapshot,
      manifest: uiManifest,
      bindings: [],
      builderIdentity: 'preview-builder-v1',
      nowMs: 10,
      expiresAtMs: 1_000,
      retainUntilMs: 2_000,
    });
    expect(uiResult.status).toBe('committed');
    expect(writes.map((artifact) => artifact.kind)).toEqual(['source', 'ui']);
    expect(commits[0]!.revision.serverArtifact).toBeNull();
    const encodedSource = writes[0]!;
    expect(new WidgetSourceSnapshot().decodeArtifact({
      kind: 'source',
      digestSha256: encodedSource.digestSha256,
      bytes: encodedSource.bytes,
    }, {
      expectedSnapshotId: uiSnapshot.id,
      expectedSourceDigestSha256: uiSnapshot.digestSha256,
      expectedBuilderIdentity: 'preview-builder-v1',
    }).files).toEqual(uiSnapshot.files);

    writes.length = 0;
    const serverSnapshot = snapshot('source-server', true);
    const serverResult = await service.buildPreview(tenant, {
      previewId: 'preview-server',
      expectedActiveRevisionId: null,
      revisionId: 'preview-server-r1',
      draftId: 'draft-server',
      definitionId: 'definition-server',
      draftRevisionSha256: serverSnapshot.digestSha256,
      snapshot: serverSnapshot,
      manifest: serverManifest,
      bindings: [],
      builderIdentity: 'preview-builder-v1',
      nowMs: 20,
      expiresAtMs: 1_000,
      retainUntilMs: 2_000,
    });
    expect(serverResult.status).toBe('committed');
    expect(writes.map((artifact) => artifact.kind)).toEqual(['source', 'ui', 'server']);
    expect(commits[1]!.revision.functionDescriptors).toEqual([
      TEST_SERVER_FUNCTION_DESCRIPTOR,
    ]);
  });

  test('rejects a forged build before any artifact write or preview commit', async () => {
    const writes: TWidgetArtifactPut[] = [];
    const commits: TWidgetPreviewCommitInput[] = [];
    const trusted = builder();
    const service = new WidgetPreviewService({
      builder: {
        async build(callTenant, request) {
          return { ...await trusted.build(callTenant, request), contractDigestSha256: '0'.repeat(64) };
        },
      },
      artifacts: artifactStore(writes),
      previewStore: previewStore(commits),
      mutationCoordinator,
    });
    const source = snapshot('source-forged', false);
    const request = {
      previewId: 'preview-forged',
      expectedActiveRevisionId: null,
      revisionId: 'preview-forged-r1',
      draftId: 'draft-forged',
      definitionId: 'definition-forged',
      snapshot: source,
      manifest: uiManifest,
      bindings: [],
      builderIdentity: 'preview-builder-v1',
      nowMs: 10,
      expiresAtMs: 1_000,
      retainUntilMs: 2_000,
    } as const;
    await expect(service.buildPreview(tenant, {
      ...request,
      draftRevisionSha256: 'c'.repeat(64),
    })).rejects.toMatchObject({ code: 'WIDGET_PREVIEW_DRAFT_STALE' });
    await expect(service.buildPreview(tenant, {
      ...request,
      draftRevisionSha256: source.digestSha256,
    })).rejects.toMatchObject({ code: 'WIDGET_BUILD_INTEGRITY_FAILED' });
    expect(writes).toEqual([]);
    expect(commits).toEqual([]);
  });
});
