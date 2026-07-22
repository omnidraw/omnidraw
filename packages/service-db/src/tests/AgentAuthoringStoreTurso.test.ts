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
    expect(await store.getPreview(TENANT, { previewId, nowMs: 21 }))
      .toMatchObject({ id: previewRevisionId, sourceArtifact: { id: sourceArtifactId } });
    expect(await store.getPreview(OTHER_ACCOUNT_TENANT, { previewId, nowMs: 21 })).toBeNull();

    const discarded = await store.discardDraft(TENANT, {
      draftId,
      expectedSourceDigestSha256: renamedDigest,
      nowMs: 30,
    });
    expect(discarded).toMatchObject({ status: 'updated', draft: { status: 'discarded' } });
    expect(await store.getPreview(TENANT, { previewId, nowMs: 31 })).toBeNull();
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
});
