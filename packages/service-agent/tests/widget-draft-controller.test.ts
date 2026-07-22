import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { ZWidgetManifestV2 } from '@vibecanvas/widget-contract';
import { AgentService } from '../src/AgentService';
import { txAppendWidgetDraftResourceBindingSelectionRecord } from '../src/core/tx.session-records';
import { WidgetDraftController } from '../src/widget-drafts/WidgetDraftController';
import type { TWidgetAuthoringResourceSelection } from '../src/widget-drafts/types';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import { createWidgetAuthoringHarness } from './widget-authoring.fixture';
import { TEST_TENANT, createTestTenantEvents } from './tenant.fixture';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function harness(eventPublisher = createTestTenantEvents()) {
  const root = await mkdtemp(join(tmpdir(), 'vc-agent-v2-authoring-'));
  roots.push(root);
  return { ...await createWidgetAuthoringHarness(root, eventPublisher), root };
}

async function symlinkedHarness(eventPublisher = createTestTenantEvents()) {
  const container = await mkdtemp(join(tmpdir(), 'vc-agent-v2-authoring-symlink-'));
  roots.push(container);
  const physicalRoot = join(container, 'physical');
  const linkedRoot = join(container, 'linked');
  await mkdir(physicalRoot);
  await symlink(physicalRoot, linkedRoot, 'dir');
  return { ...await createWidgetAuthoringHarness(linkedRoot, eventPublisher), root: linkedRoot };
}

describe('WidgetDraftController v2 authoring', () => {
  test('creates stable account-scoped draft and definition identities', async () => {
    const { controller, store, createDraft } = await harness();
    const created = await createDraft('Stable Clock');
    const again = await controller.getByName('Stable Clock');

    expect(again).toMatchObject({
      draftId: created.draftId,
      definitionId: created.definitionId,
      chatId: created.chatId,
      name: 'Stable Clock',
      state: 'new',
    });
    expect(store.drafts.get(created.draftId)?.orgId).toBe(TEST_TENANT.orgId);
    expect(created.draftId).not.toBe(created.name);
    expect(created.definitionId).not.toBe(created.name);
    expect((await controller.list()).map((draft) => draft.draftId)).toEqual([created.draftId]);
  });

  test('builds a UI-only immutable Preview and returns only verified artifact bytes', async () => {
    const { controller, createDraft } = await harness();
    const draft = await createDraft('Browser Clock');
    const preview = await controller.buildPreview(
      draft.draftId,
      'preview-browser',
      draft.revision,
      null,
    );

    expect(preview.ready).toBe(true);
    if (!preview.ready) return;
    const bytes = Buffer.from(preview.uiArtifact.bytesBase64, 'base64');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(preview.uiArtifact.digestSha256);
    expect(preview.contract.functions).toEqual([]);
    expect(preview.manifest.server).toBeUndefined();
    expect('sources' in preview).toBe(false);
    expect('snapshot' in preview).toBe(false);
    expect('actorId' in preview).toBe(false);
  });

  test('never reports Preview failure after activation commits when event delivery throws', async () => {
    const events = createTestTenantEvents();
    const publishAgentEvent = events.publishAgentEvent.bind(events);
    events.publishAgentEvent = (event) => {
      if ('kind' in event && event.kind === 'widget-preview') {
        throw new Error('event transport unavailable');
      }
      return publishAgentEvent(event);
    };
    const { controller, widgets, createDraft } = await harness(events);
    const draft = await createDraft('Preview Event Failure');

    expect(await controller.buildPreview(
      draft.draftId,
      'preview-event-failure',
      draft.revision,
      null,
    )).toMatchObject({
      ready: true,
      draftId: draft.draftId,
      previewId: 'preview-event-failure',
    });
    expect(widgets.previews.has('preview-event-failure')).toBe(true);
  });

  test('deactivates an exact Preview revision when its committed artifact cannot be read', async () => {
    const { controller, widgets, createDraft } = await harness();
    const draft = await createDraft('Preview Artifact Cleanup');
    widgets.failArtifactRead = true;

    expect(await controller.buildPreview(
      draft.draftId,
      'preview-artifact-cleanup',
      draft.revision,
      null,
    )).toMatchObject({
      ready: false,
      reason: 'artifact-unavailable',
      draftId: draft.draftId,
      previewId: 'preview-artifact-cleanup',
      previewRevisionId: expect.any(String),
    });
    expect(widgets.previews.has('preview-artifact-cleanup')).toBe(false);
    expect(await controller.getPreview(draft.draftId, 'preview-artifact-cleanup')).toMatchObject({
      ready: false,
      reason: 'not-built',
    });
  });

  test('retains failed Preview cleanup ownership until close can exact-stop it', async () => {
    const { controller, widgets, createDraft } = await harness();
    const draft = await createDraft('Preview Cleanup Retry');
    widgets.failArtifactRead = true;
    widgets.stopPreviewFailuresRemaining = 3;

    expect(await controller.buildPreview(
      draft.draftId,
      'preview-cleanup-retry',
      draft.revision,
      null,
    )).toMatchObject({
      ready: false,
      reason: 'artifact-unavailable',
      previewId: 'preview-cleanup-retry',
      previewRevisionId: expect.any(String),
    });
    expect(widgets.stopPreviewCalls).toBe(3);
    expect(widgets.previews.has('preview-cleanup-retry')).toBe(true);

    await controller.close();
    expect(widgets.stopPreviewCalls).toBe(4);
    expect(widgets.previews.has('preview-cleanup-retry')).toBe(false);
  });

  test('releases cleanup ownership when the exact Preview revision is already inactive', async () => {
    const { controller, widgets, createDraft } = await harness();
    const draft = await createDraft('Preview Cleanup Replaced');
    const preview = await controller.buildPreview(
      draft.draftId,
      'preview-cleanup-replaced',
      draft.revision,
      null,
    );
    expect(preview.ready).toBe(true);
    if (!preview.ready) return;
    const replacement = widgets.previews.get(preview.previewId);
    if (!replacement) throw new Error('Expected active Preview fixture.');
    widgets.previews.set(preview.previewId, {
      ...replacement,
      id: '00000000-0000-4000-8000-999999999999',
    });

    await controller.close();
    await controller.close();
    expect(widgets.stopPreviewCalls).toBe(1);
    expect(widgets.previews.get(preview.previewId)?.id)
      .toBe('00000000-0000-4000-8000-999999999999');
  });

  test('compensates activation when the first post-commit durable read throws', async () => {
    const { controller, store, widgets, createDraft } = await harness();
    const draft = await createDraft('Preview Post Commit Read');
    widgets.afterBuildPreviewCommit = async () => {
      store.getDraftFailuresRemaining = 1;
    };

    expect(await controller.buildPreview(
      draft.draftId,
      'preview-post-commit-read',
      draft.revision,
      null,
    )).toMatchObject({
      ready: false,
      reason: 'build-failed',
      message: 'Injected durable draft read failure.',
      previewId: 'preview-post-commit-read',
      previewRevisionId: expect.any(String),
    });
    expect(widgets.previews.has('preview-post-commit-read')).toBe(false);
  });

  test('passes durable chat selections to the host resolver and preserves no-record versus explicit-clear', async () => {
    const { root, workspace, store, widgets, previewFunctions, createDraft } = await harness();
    const draft = await createDraft('Resource Selection Handoff');
    const observed: Array<readonly TWidgetAuthoringResourceSelection[] | undefined> = [];
    let id = 0;
    let nowMs = 20_000;
    const service = new AgentService({
      cachePath: join(root, 'cache'),
      dataPath: root,
      configPath: join(root, 'config'),
      eventPublisherService: createTestTenantEvents(),
      tenant: TEST_TENANT,
      authoringStore: store,
      widgetAuthoringCapability: widgets,
      previewFunctionCapability: previewFunctions,
      resolveWidgetResourceBindings: async (_tenant, request) => {
        observed.push(request.selectedResources);
        return [];
      },
      createId: () => `service-fixture-${++id}`,
      nowMs: () => ++nowMs,
      widgetBuilderIdentity: 'test-widget-builder/1',
    });

    expect((await service.buildWidgetPreview(
      draft.draftId,
      'selection-none',
      draft.revision,
      null,
    )).ready).toBe(true);

    const sessionManager = SessionManager.continueRecent(
      workspace.getChatRoot('external-chat'),
      workspace.getChatHistoryRoot('external-chat'),
    );
    txAppendWidgetDraftResourceBindingSelectionRecord({ sessionManager }, {
      resources: [{ id: 'db-selected', kind: 'db', name: 'Selected DB', status: 'ready' }],
      selectedAt: new Date().toISOString(),
      source: 'mention',
    });
    (sessionManager as unknown as { _rewriteFile?: () => void })._rewriteFile?.();
    expect((await service.buildWidgetPreview(
      draft.draftId,
      'selection-present',
      draft.revision,
      null,
    )).ready).toBe(true);

    txAppendWidgetDraftResourceBindingSelectionRecord({ sessionManager }, {
      resources: [],
      selectedAt: new Date().toISOString(),
      source: 'explicit-clear',
    });
    (sessionManager as unknown as { _rewriteFile?: () => void })._rewriteFile?.();
    expect((await service.buildWidgetPreview(
      draft.draftId,
      'selection-cleared',
      draft.revision,
      null,
    )).ready).toBe(true);

    expect(observed).toEqual([
      undefined,
      [{ id: 'db-selected', kind: 'db', name: 'Selected DB', status: 'ready' }],
      [],
    ]);
  });

  test('strips server module paths and invokes functions only for the owned Preview revision', async () => {
    const { controller, previewFunctions, createDraft } = await harness();
    const draft = await createDraft('Server Lookup', true);
    const preview = await controller.buildPreview(
      draft.draftId,
      'preview-server',
      draft.revision,
      null,
    );
    expect(preview.ready).toBe(true);
    if (!preview.ready) return;

    expect(preview.contract.functions).toHaveLength(1);
    expect(preview.contract.functions[0]?.exportName).toBe('lookup');
    expect('modulePath' in (preview.contract.functions[0] ?? {})).toBe(false);
    const invoked = await controller.invokePreviewFunction(
      draft.draftId,
      preview.previewId,
      preview.previewRevisionId,
      'lookup',
      { query: 'v2' },
      'call-1',
    );
    expect(invoked).toMatchObject({
      id: 'invocation-call-1',
      previewId: preview.previewId,
      previewRevisionId: preview.previewRevisionId,
      status: 'succeeded',
      output: { query: 'v2' },
    });
    expect('subject' in invoked).toBe(false);
    expect(previewFunctions.lastInvocation?.subject.kind).toBe('agent_preview');

    expect(await controller.getPreviewFunctionInvocation(
      draft.draftId,
      preview.previewId,
      'foreign-revision',
      invoked.id,
    )).toBeNull();
    const canceled = await controller.cancelPreviewFunctionInvocation(
      draft.draftId,
      preview.previewId,
      preview.previewRevisionId,
      invoked.id,
    );
    expect(canceled?.status).toBe('cancelled');
  });

  test('rejects stale source and CAS-swaps the Preview owner pointer', async () => {
    const { controller, workspace, createDraft } = await harness();
    const draft = await createDraft('Preview CAS');
    const first = await controller.buildPreview(draft.draftId, 'owner-a', draft.revision, null);
    expect(first.ready).toBe(true);
    if (!first.ready) return;

    const conflict = await controller.buildPreview(draft.draftId, 'owner-a', draft.revision, null);
    expect(conflict).toMatchObject({ ready: false, reason: 'preview-conflict' });
    const replacement = await controller.buildPreview(
      draft.draftId,
      'owner-a',
      draft.revision,
      first.previewRevisionId,
    );
    expect(replacement.ready).toBe(true);

    const source = await workspace.getDraft('Preview CAS');
    await writeFile(join(source!.draftPath, 'ui', 'main.ts'), 'export default () => "changed";\n', 'utf8');
    const stale = await controller.buildPreview(
      draft.draftId,
      'owner-b',
      draft.revision,
      null,
    );
    expect(stale).toMatchObject({
      ready: false,
      reason: 'stale-revision',
      revision: draft.revision,
    });
    expect(stale.currentRevision).not.toBe(draft.revision);
  });

  test('rejects Preview activation when the workspace advances after snapshot validation starts', async () => {
    const { controller, workspace, widgets, createDraft } = await harness();
    const draft = await createDraft('Preview Revision Fence');
    let markValidationStarted!: () => void;
    let releaseValidation!: () => void;
    const validationStarted = new Promise<void>((resolve) => { markValidationStarted = resolve; });
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
    widgets.beforeValidateBuild = async () => {
      markValidationStarted();
      await validationGate;
    };

    const building = controller.buildPreview(
      draft.draftId,
      'preview-revision-fence',
      draft.revision,
      null,
    );
    await validationStarted;
    await workspace.writeMountedFileAtomic(
      'external-chat',
      'widgets/Preview Revision Fence/ui/main.ts',
      'export default function mount() { return "advanced"; }\n',
    );
    releaseValidation();

    const preview = await building;
    expect(preview).toMatchObject({
      ready: false,
      reason: 'stale-revision',
      revision: draft.revision,
      currentRevision: expect.any(String),
    });
    expect(preview.currentRevision).not.toBe(draft.revision);
    expect(widgets.previews.has('preview-revision-fence')).toBe(false);
  });

  test('serializes mounted edits with Preview and publish fences through a symlinked data root', async () => {
    const { controller, workspace, widgets, createDraft } = await symlinkedHarness();
    const previewDraft = await createDraft('Symlink Preview Fence');
    let markPreviewCommitEntered!: () => void;
    let releasePreviewCommit!: () => void;
    const previewCommitEntered = new Promise<void>((resolve) => { markPreviewCommitEntered = resolve; });
    const previewCommitGate = new Promise<void>((resolve) => { releasePreviewCommit = resolve; });
    widgets.beforeBuildPreview = async () => {
      markPreviewCommitEntered();
      await previewCommitGate;
    };
    const building = controller.buildPreview(
      previewDraft.draftId,
      'symlink-preview-fence',
      previewDraft.revision,
      null,
    );
    await previewCommitEntered;
    let previewWriteFinished = false;
    const previewWrite = workspace.writeMountedFileAtomic(
      'external-chat',
      'widgets/Symlink Preview Fence/ui/main.ts',
      'export default function mount() { return "after-preview"; }\n',
    ).then(() => { previewWriteFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(previewWriteFinished).toBe(false);
    releasePreviewCommit();
    expect(await building).toMatchObject({ ready: true, revision: previewDraft.revision });
    await previewWrite;

    const publishDraft = await createDraft('Symlink Publish Fence');
    let markPublishCommitEntered!: () => void;
    let releasePublishCommit!: () => void;
    const publishCommitEntered = new Promise<void>((resolve) => { markPublishCommitEntered = resolve; });
    const publishCommitGate = new Promise<void>((resolve) => { releasePublishCommit = resolve; });
    widgets.beforePublish = async () => {
      markPublishCommitEntered();
      await publishCommitGate;
    };
    const publishing = controller.publish(publishDraft.draftId, publishDraft.revision);
    await publishCommitEntered;
    let publishWriteFinished = false;
    const publishWrite = workspace.writeMountedFileAtomic(
      'external-chat',
      'widgets/Symlink Publish Fence/ui/main.ts',
      'export default function mount() { return "after-publish"; }\n',
    ).then(() => { publishWriteFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(publishWriteFinished).toBe(false);
    releasePublishCommit();
    expect(await publishing).toMatchObject({ published: true, revision: publishDraft.revision });
    await publishWrite;
  });

  test('serializes discard behind an in-flight build and removes the committed Preview', async () => {
    const { controller, store, widgets, createDraft } = await harness();
    const draft = await createDraft('Discard During Build');
    let markBuildStarted!: () => void;
    let releaseBuild!: () => void;
    const buildStarted = new Promise<void>((resolve) => { markBuildStarted = resolve; });
    const buildGate = new Promise<void>((resolve) => { releaseBuild = resolve; });
    widgets.beforeBuildPreview = async () => {
      markBuildStarted();
      await buildGate;
    };

    const building = controller.buildPreview(
      draft.draftId,
      'discard-race-preview',
      draft.revision,
      null,
    );
    await buildStarted;
    let discardFinished = false;
    const discarding = controller.forget(draft.name).then(() => { discardFinished = true; });
    await Promise.resolve();
    expect(discardFinished).toBe(false);

    releaseBuild();
    const preview = await building;
    expect(preview.ready).toBe(true);
    await discarding;

    expect(store.drafts.get(draft.draftId)?.status).toBe('discarded');
    expect(widgets.previews.has('discard-race-preview')).toBe(false);
    expect(await controller.get(draft.draftId)).toBeNull();
  });

  test('fails closed when artifact bytes do not match the committed digest', async () => {
    const { controller, widgets, createDraft } = await harness();
    const draft = await createDraft('Integrity Clock');
    const preview = await controller.buildPreview(draft.draftId, 'integrity-owner', draft.revision, null);
    expect(preview.ready).toBe(true);
    if (!preview.ready) return;

    widgets.tamperRead = true;
    expect(await controller.getPreview(draft.draftId, preview.previewId)).toMatchObject({
      ready: false,
      reason: 'artifact-unavailable',
      previewRevisionId: preview.previewRevisionId,
    });
  });

  test('preserves durable IDs through rename and marks removed drafts discarded', async () => {
    const { controller, workspace, store, createDraft } = await harness();
    const draft = await createDraft('Rename Source');
    const workspaceDraft = await workspace.getDraft('Rename Source');
    await controller.withPreviewRenameCleanup('Rename Source', 'Rename Target', (_cleanup, coordinateCommit) => (
      workspace.updateDraftManifestAndNameAtomic(
        'Rename Source',
        'Rename Target',
        workspaceDraft!.revision,
        (value) => {
          const manifest = ZWidgetManifestV2.parse(value);
          return { ...manifest, name: 'Rename Target', slug: 'rename-target' };
        },
        coordinateCommit,
      )
    ));

    const renamed = await controller.getByName('Rename Target');
    expect(renamed).toMatchObject({
      draftId: draft.draftId,
      definitionId: draft.definitionId,
      name: 'Rename Target',
    });
    expect(await controller.getByName('Rename Source')).toBeNull();

    await controller.withPreviewCleanup('Rename Target', async (_cleanup, discardBeforeRemoval) => {
      await discardBeforeRemoval();
      expect(await workspace.removeDraft('Rename Target')).toBe(true);
    });
    expect(store.drafts.get(draft.draftId)?.status).toBe('discarded');
    expect(await controller.get(draft.draftId)).toBeNull();
  });

  test('rolls back source identity and mounts when durable rename conflicts or throws', async () => {
    for (const fault of ['conflict', 'throw'] as const) {
      const { controller, workspace, store, createDraft } = await harness();
      const draft = await createDraft(`Rename Rollback ${fault}`);
      const nextName = `Rename Rollback ${fault} Target`;
      const workspaceDraft = await workspace.getDraft(draft.name);
      if (fault === 'conflict') store.conflictRenameDraft = true;
      else store.throwRenameDraftError = true;

      await expect(controller.withPreviewRenameCleanup(
        draft.name,
        nextName,
        (_cleanup, coordinateCommit) => workspace.updateDraftManifestAndNameAtomic(
          draft.name,
          nextName,
          workspaceDraft!.revision,
          (value) => {
            const manifest = ZWidgetManifestV2.parse(value);
            return {
              ...manifest,
              name: nextName,
              slug: `${manifest.slug}-${fault}`,
            };
          },
          coordinateCommit,
        ),
      )).rejects.toThrow();

      expect(await workspace.getDraft(nextName)).toBeNull();
      expect(await workspace.getDraft(draft.name)).not.toBeNull();
      expect(JSON.parse(await readFile(
        join(workspace.draftRoot, draft.name, 'vibecanvas.json'),
        'utf8',
      ))).toMatchObject({ name: draft.name });
      expect(await workspace.listMounts('external-chat')).toEqual([
        expect.objectContaining({ name: draft.name, source: 'draft' }),
      ]);
      expect(store.drafts.get(draft.draftId)).toMatchObject({
        id: draft.draftId,
        name: draft.name,
      });
    }
  });

  test('holds the renamed workspace lane until durable rename authority commits', async () => {
    const { controller, workspace, store, createDraft } = await harness();
    const draft = await createDraft('Rename Lane Source');
    const nextName = 'Rename Lane Target';
    const workspaceDraft = await workspace.getDraft(draft.name);
    let markRenameEntered!: () => void;
    let releaseRename!: () => void;
    const renameEntered = new Promise<void>((resolve) => { markRenameEntered = resolve; });
    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve; });
    store.beforeRenameDraft = async () => {
      markRenameEntered();
      await renameGate;
    };

    const renaming = controller.withPreviewRenameCleanup(
      draft.name,
      nextName,
      (_cleanup, coordinateCommit) => workspace.updateDraftManifestAndNameAtomic(
        draft.name,
        nextName,
        workspaceDraft!.revision,
        (value) => ({ ...ZWidgetManifestV2.parse(value), name: nextName, slug: 'rename-lane-target' }),
        coordinateCommit,
      ),
    );
    await renameEntered;
    let writeFinished = false;
    const writing = workspace.writeMountedFileAtomic(
      'external-chat',
      `widgets/${nextName}/ui/main.ts`,
      'export default function mount() { return "after-rename"; }\n',
    ).then(() => { writeFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(writeFinished).toBe(false);

    releaseRename();
    await renaming;
    expect(store.drafts.get(draft.draftId)).toMatchObject({
      id: draft.draftId,
      name: nextName,
    });
    await writing;
    expect((await controller.handleToolChange({ name: nextName, type: 'changed' }))?.draftId)
      .toBe(draft.draftId);
  });

  test('keeps draft source and stable identity when durable discard conflicts or throws', async () => {
    for (const fault of ['conflict', 'throw'] as const) {
      const { controller, workspace, store, createDraft } = await harness();
      const draft = await createDraft(`Delete Rollback ${fault}`);
      if (fault === 'conflict') store.conflictDiscardDraft = true;
      else store.throwDiscardDraftError = true;

      await expect(controller.withPreviewCleanup(
        draft.name,
        async (_cleanup, discardBeforeRemoval) => {
          await discardBeforeRemoval();
          await workspace.removeDraft(draft.name);
        },
      )).rejects.toThrow();

      expect(await workspace.getDraft(draft.name)).not.toBeNull();
      expect(store.drafts.get(draft.draftId)).toMatchObject({
        id: draft.draftId,
        name: draft.name,
        status: 'editing',
      });
    }
  });

  test('publishes exactly the requested immutable revision and rejects stale requests', async () => {
    const { controller, workspace, widgets, createDraft } = await harness();
    const draft = await createDraft('Publish Clock', true);
    const source = await workspace.getDraft('Publish Clock');
    await writeFile(join(source!.draftPath, 'ui', 'main.ts'), 'export default () => "new";\n', 'utf8');

    expect(await controller.publish(draft.draftId, draft.revision)).toMatchObject({
      published: false,
      reason: 'stale-revision',
    });
    expect(widgets.publishCount).toBe(0);

    const current = await controller.get(draft.draftId);
    const published = await controller.publish(draft.draftId, current!.revision);
    expect(published).toMatchObject({
      published: true,
      draftId: draft.draftId,
      definitionId: draft.definitionId,
      revision: current!.revision,
    });
    expect(widgets.publishCount).toBe(1);
    expect((await controller.get(draft.draftId))?.state).toBe('published');
  });

  test('rejects publication when the workspace advances after snapshot validation starts', async () => {
    const { controller, workspace, widgets, createDraft } = await harness();
    const draft = await createDraft('Publish Revision Fence');
    let markValidationStarted!: () => void;
    let releaseValidation!: () => void;
    const validationStarted = new Promise<void>((resolve) => { markValidationStarted = resolve; });
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
    widgets.beforeValidateBuild = async () => {
      markValidationStarted();
      await validationGate;
    };

    const publishing = controller.publish(draft.draftId, draft.revision);
    await validationStarted;
    await workspace.writeMountedFileAtomic(
      'external-chat',
      'widgets/Publish Revision Fence/ui/main.ts',
      'export default function mount() { return "advanced"; }\n',
    );
    releaseValidation();

    const published = await publishing;
    expect(published).toMatchObject({
      published: false,
      reason: 'stale-revision',
      currentRevision: expect.any(String),
    });
    expect(published.published).toBe(false);
    if (published.published) return;
    expect(published.currentRevision).not.toBe(draft.revision);
    expect(widgets.publishCount).toBe(0);
    expect(widgets.activeRevisions.has(draft.definitionId)).toBe(false);
  });

  test('serves and archives the exact published v2 revision through catalog, detail, and files', async () => {
    const { root, controller, store, widgets, previewFunctions, createDraft } = await harness();
    const draft = await createDraft('Published Inspector', true);
    const published = await controller.publish(draft.draftId, draft.revision);
    expect(published.published).toBe(true);
    if (!published.published) return;
    const revision = widgets.revisions.get(published.publishedRevisionId);
    if (!revision) throw new Error('Expected published revision fixture.');
    const target = {
      definitionId: draft.definitionId,
      revisionId: revision.id,
      name: revision.manifest.name,
      slug: revision.manifest.slug,
      description: revision.manifest.description ?? null,
      contractDigestSha256: revision.contractDigestSha256,
      updatedAtMs: revision.createdAtMs,
      bounds: { width: 360, height: 320 },
    } as const;
    let nowMs = revision.createdAtMs + 10;
    const service = new AgentService({
      cachePath: join(root, 'cache'),
      dataPath: root,
      configPath: join(root, 'config'),
      eventPublisherService: createTestTenantEvents(),
      tenant: TEST_TENANT,
      authoringStore: store,
      widgetAuthoringCapability: widgets,
      previewFunctionCapability: previewFunctions,
      resolveWidgetResourceBindings: async () => [],
      createId: () => `published-inspector-${++nowMs}`,
      nowMs: () => ++nowMs,
      widgetBuilderIdentity: 'test-widget-builder/1',
      listPublishedWidgetPlacements: async () => (
        widgets.activeRevisions.get(draft.definitionId) === revision.id ? [target] : []
      ),
      resolvePublishedWidgetPlacement: async (identity) => (
        widgets.activeRevisions.get(identity.definitionId) === identity.revisionId
          ? target
          : null
      ),
    });
    await service.start({ config: {}, hooks: {} });

    const catalogEntry = (await service.getWidgetCatalog([])).widgets.find((entry) => (
      entry.name === target.name
    ));
    expect(catalogEntry).toMatchObject({
      relation: 'same',
      published: { revision: revision.id },
      draft: { draftId: draft.draftId },
    });
    const publishedDetail = await service.getWidgetDetail(target.name, 'published');
    expect(publishedDetail).toMatchObject({
      name: target.name,
      source: 'published',
      relation: 'same',
      manifest: { schemaVersion: 2, slug: target.slug },
      sibling: { draftId: draft.draftId },
      functions: [{ exportName: 'lookup', effect: 'fn' }],
    });
    expect('modulePath' in (publishedDetail?.functions[0] ?? {})).toBe(false);
    expect(await service.listWidgetFiles(target.name, 'published')).toEqual(expect.arrayContaining([
      { path: 'ui/main.ts', kind: 'file', size: expect.any(Number) },
      { path: 'server/main.ts', kind: 'file', size: expect.any(Number) },
      { path: 'vibecanvas.json', kind: 'file', size: expect.any(Number) },
    ]));
    expect(await service.readWidgetFile(target.name, 'published', 'ui/main.ts')).toMatchObject({
      path: 'ui/main.ts',
      binary: false,
      truncated: false,
      text: expect.stringContaining('mount'),
    });
    await expect(
      service.readWidgetFile(target.name, 'published', '../secret'),
    ).rejects.toThrow('UNSAFE_PATH');

    expect(await service.deleteWidget(target.name, 'published')).toMatchObject({
      deletedDefinition: true,
      deletedPublished: true,
      deletedDraft: true,
      deletedInstances: false,
      issues: [],
    });
    expect(widgets.activeRevisions.has(draft.definitionId)).toBe(false);
    expect((await service.getWidgetCatalog([])).widgets.some((entry) => entry.name === target.name)).toBe(false);
    expect(await service.getWidgetDetail(target.name, 'published')).toBeNull();

    await service.stop();
    await controller.close();
  });

  test('materializes and revives an exact published source as one stable editable draft', async () => {
    const { controller, workspace, widgets, createDraft } = await harness();
    const original = await createDraft('Published Edit Seed', true);
    const published = await controller.publish(original.draftId, original.revision);
    expect(published.published).toBe(true);
    if (!published.published) return;
    const snapshot = widgets.revisionSnapshots.get(published.publishedRevisionId);
    if (!snapshot) throw new Error('Expected publication source snapshot.');
    await controller.withPreviewCleanup(
      original.name,
      async (_cleanup, discardBeforeRemoval) => {
        await discardBeforeRemoval();
        expect(await workspace.removeDraft(original.name)).toBe(true);
      },
    );

    const imported = await controller.materializePublishedDraft({
      name: original.name,
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      snapshot,
    });
    expect(imported).toMatchObject({
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      revision: snapshot.digestSha256,
      state: 'published',
    });
    const managementChatKey = `widget-management-${original.definitionId}`;
    expect(await workspace.listMounts(managementChatKey)).toEqual([
      expect.objectContaining({ name: original.name, source: 'draft' }),
    ]);
    expect((await controller.materializePublishedDraft({
      name: original.name,
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      snapshot,
    })).draftId).toBe(imported.draftId);

    await controller.withPreviewCleanup(
      imported.name,
      async (_cleanup, discardBeforeRemoval) => {
        await discardBeforeRemoval();
        expect(await workspace.removeDraft(imported.name)).toBe(true);
      },
    );
    const revived = await controller.materializePublishedDraft({
      name: original.name,
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      snapshot,
    });
    expect(revived).toMatchObject({
      draftId: imported.draftId,
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      revision: snapshot.digestSha256,
      state: 'published',
    });
  });

  test('rolls back a newly materialized source that conflicts with durable publication identity', async () => {
    const { controller, workspace, store, widgets, createDraft } = await harness();
    const durable = await createDraft('Materialized Identity Conflict');
    const source = await workspace.getDraft(durable.name);
    if (!source) throw new Error('Expected draft source fixture.');
    const snapshot = await widgets.captureSource(TEST_TENANT, source.draftPath, {
      id: '00000000-0000-4000-8000-900000000001',
      createdAtMs: 1,
    });
    expect(await workspace.removeDraft(durable.name)).toBe(true);
    const request = {
      name: durable.name,
      definitionId: '00000000-0000-4000-8000-900000000002',
      publishedRevisionId: '00000000-0000-4000-8000-900000000003',
      snapshot,
    } as const;

    await expect(controller.materializePublishedDraft(request))
      .rejects.toMatchObject({ code: 'AGENT_AUTHORING_INTEGRITY_FAILED' });
    expect(await workspace.getDraft(durable.name)).toBeNull();
    await expect(controller.materializePublishedDraft(request))
      .rejects.toMatchObject({ code: 'AGENT_AUTHORING_INTEGRITY_FAILED' });
    expect(await workspace.getDraft(durable.name)).toBeNull();
    expect(store.drafts.get(durable.draftId)).toMatchObject({
      id: durable.draftId,
      definitionId: durable.definitionId,
      status: 'editing',
    });
  });

  test('rejects an unrelated tracked same-name definition without deleting its source', async () => {
    const { controller, workspace, store, widgets, createDraft } = await harness();
    const durable = await createDraft('Tracked Identity Conflict');
    const source = await workspace.getDraft(durable.name);
    if (!source) throw new Error('Expected tracked draft source fixture.');
    const snapshot = await widgets.captureSource(TEST_TENANT, source.draftPath, {
      id: '00000000-0000-4000-8000-910000000001',
      createdAtMs: 1,
    });

    await expect(controller.materializePublishedDraft({
      name: durable.name,
      definitionId: '00000000-0000-4000-8000-910000000002',
      publishedRevisionId: '00000000-0000-4000-8000-910000000003',
      snapshot,
    })).rejects.toMatchObject({ code: 'AGENT_AUTHORING_INTEGRITY_FAILED' });
    expect(await workspace.getDraft(durable.name)).not.toBeNull();
    expect(await workspace.isDraftMaterializationPending(durable.name)).toBe(false);
    expect(store.drafts.get(durable.draftId)).toMatchObject({
      id: durable.draftId,
      definitionId: durable.definitionId,
      status: 'editing',
    });
  });

  test('recovers an exact promoted source with no durable row after workspace restart', async () => {
    const { root, controller, workspace, store, widgets, previewFunctions, createDraft } = await harness();
    const original = await createDraft('Restart Materialization', true);
    const published = await controller.publish(original.draftId, original.revision);
    expect(published.published).toBe(true);
    if (!published.published) return;
    const snapshot = widgets.revisionSnapshots.get(published.publishedRevisionId);
    if (!snapshot) throw new Error('Expected restart publication source snapshot.');
    await controller.withPreviewCleanup(original.name, async (_cleanup, discardBeforeRemoval) => {
      await discardBeforeRemoval();
      expect(await workspace.removeDraft(original.name)).toBe(true);
    });
    await workspace.materializeDraftFromSnapshot(original.name, snapshot, {
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
    });
    expect(await workspace.getDraft(original.name)).toBeNull();
    expect(await workspace.isDraftMaterializationPending(original.name)).toBe(true);
    expect(await readFile(join(workspace.draftRoot, original.name, 'ui', 'main.ts'), 'utf8'))
      .toContain('mount');
    expect(await store.getDraftByName(TEST_TENANT, original.name)).toBeNull();
    await controller.close();

    const restartedWorkspace = new WidgetWorkspace({
      dataPath: root,
      configPath: join(root, 'config'),
    });
    await restartedWorkspace.init();
    let id = 0;
    let nowMs = 50_000;
    const restartedController = new WidgetDraftController({
      tenant: TEST_TENANT,
      workspace: restartedWorkspace,
      eventPublisher: createTestTenantEvents(),
      authoringStore: store,
      widgets,
      resolveResourceBindings: async () => [],
      previewFunctions,
      createId: () => `70000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
      nowMs: () => ++nowMs,
      builderIdentity: 'test-widget-builder/1',
    });
    const recovered = await restartedController.materializePublishedDraft({
      name: original.name,
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      snapshot,
    });

    expect(recovered).toMatchObject({
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      revision: snapshot.digestSha256,
      state: 'published',
    });
    expect(await restartedWorkspace.isDraftMaterializationPending(original.name)).toBe(false);
    expect(await restartedWorkspace.getDraft(original.name)).not.toBeNull();
    expect(await store.getDraftByName(TEST_TENANT, original.name)).toMatchObject({
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      sourceDigestSha256: snapshot.digestSha256,
    });
    await restartedController.close();
  });

  test('rejects and cleans a pending promoted source whose bytes changed before seed recovery', async () => {
    const { controller, workspace, widgets, createDraft } = await harness();
    const original = await createDraft('Mismatched Materialization', true);
    const published = await controller.publish(original.draftId, original.revision);
    expect(published.published).toBe(true);
    if (!published.published) return;
    const snapshot = widgets.revisionSnapshots.get(published.publishedRevisionId);
    if (!snapshot) throw new Error('Expected mismatched publication source snapshot.');
    await controller.withPreviewCleanup(original.name, async (_cleanup, discardBeforeRemoval) => {
      await discardBeforeRemoval();
      expect(await workspace.removeDraft(original.name)).toBe(true);
    });
    await workspace.materializeDraftFromSnapshot(original.name, snapshot, {
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
    });
    await writeFile(
      join(workspace.draftRoot, original.name, 'ui', 'main.ts'),
      'export default function mount() { return "tampered"; }\n',
      'utf8',
    );

    await expect(controller.materializePublishedDraft({
      name: original.name,
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      snapshot,
    })).rejects.toMatchObject({ code: 'WIDGET_DRAFT_MATERIALIZATION_MISMATCH' });
    expect(await lstat(join(workspace.draftRoot, original.name)).catch(() => null)).toBeNull();
    expect(await workspace.isDraftMaterializationPending(original.name)).toBe(false);

    expect(await controller.materializePublishedDraft({
      name: original.name,
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      snapshot,
    })).toMatchObject({
      definitionId: original.definitionId,
      publishedRevisionId: published.publishedRevisionId,
      revision: snapshot.digestSha256,
    });
  });

  test('never reports failure after publication commits when draft metadata advances', async () => {
    const { controller, store, widgets, createDraft } = await harness();
    const draft = await createDraft('Publication Race');
    store.conflictPublishedCasWithAdvancedSource = true;

    const published = await controller.publish(draft.draftId, draft.revision);
    expect(published).toMatchObject({ published: true, draftId: draft.draftId });
    expect(widgets.publishCount).toBe(1);
    expect(store.publishedCasConflicts).toBe(1);
    expect(store.drafts.get(draft.draftId)).toMatchObject({
      status: 'editing',
      sourceDigestSha256: 'f'.repeat(64),
      publishedRevisionId: published.published ? published.publishedRevisionId : null,
    });
  });

  test('never reports failure after publication commits when durable metadata throws', async () => {
    const { controller, store, widgets, createDraft } = await harness();
    const draft = await createDraft('Publication Metadata Failure');
    store.throwPublishedCasError = true;

    expect(await controller.publish(draft.draftId, draft.revision)).toMatchObject({
      published: true,
      draftId: draft.draftId,
    });
    expect(widgets.publishCount).toBe(1);
    expect(store.publishedCasAttempts).toBe(1);
  });

  test('bounds post-publication metadata reconciliation under repeated conflicts', async () => {
    const { controller, store, widgets, createDraft } = await harness();
    const draft = await createDraft('Publication Metadata Conflicts');
    store.alwaysConflictPublishedCas = true;

    expect(await controller.publish(draft.draftId, draft.revision)).toMatchObject({
      published: true,
      draftId: draft.draftId,
    });
    expect(widgets.publishCount).toBe(1);
    expect(store.publishedCasAttempts).toBe(8);
    expect(store.publishedCasConflicts).toBe(8);
  });

  test('treats an active revision with the exact source digest as an idempotent retry', async () => {
    const { controller, store, widgets, createDraft } = await harness();
    const draft = await createDraft('Idempotent Publication');
    const first = await controller.publish(draft.draftId, draft.revision);
    expect(first.published).toBe(true);
    if (!first.published) return;

    const durable = store.drafts.get(draft.draftId)!;
    store.drafts.set(draft.draftId, {
      ...durable,
      status: 'ready',
      publishedRevisionId: null,
    });
    const retried = await controller.publish(draft.draftId, draft.revision);

    expect(retried).toMatchObject({
      published: true,
      publishedRevisionId: first.publishedRevisionId,
      revision: draft.revision,
    });
    expect(widgets.publishCount).toBe(1);
    expect(store.drafts.get(draft.draftId)?.publishedRevisionId).toBe(first.publishedRevisionId);
  });

  test('closes only the selected active Preview revision', async () => {
    const { controller, createDraft } = await harness();
    const draft = await createDraft('Close Preview');
    const preview = await controller.buildPreview(draft.draftId, 'close-owner', draft.revision, null);
    expect(preview.ready).toBe(true);
    if (!preview.ready) return;

    expect(await controller.closePreview(draft.draftId, preview.previewId, 'foreign')).toMatchObject({
      closed: false,
    });
    expect(await controller.closePreview(
      draft.draftId,
      preview.previewId,
      preview.previewRevisionId,
    )).toMatchObject({ closed: true });
    expect(await controller.getPreview(draft.draftId, preview.previewId)).toMatchObject({
      ready: false,
      reason: 'not-built',
    });
  });

  test('bounds public close retries while the exact Preview revision remains active', async () => {
    const { controller, widgets, createDraft } = await harness();
    const draft = await createDraft('Close Preview Retry');
    const preview = await controller.buildPreview(draft.draftId, 'close-retry-owner', draft.revision, null);
    expect(preview.ready).toBe(true);
    if (!preview.ready) return;
    widgets.stopPreviewFalseFailuresRemaining = 3;

    expect(await controller.closePreview(
      draft.draftId,
      preview.previewId,
      preview.previewRevisionId,
    )).toMatchObject({ closed: false });
    expect(widgets.stopPreviewCalls).toBe(3);
    expect(widgets.previews.get(preview.previewId)?.id).toBe(preview.previewRevisionId);

    expect(await controller.closePreview(
      draft.draftId,
      preview.previewId,
      preview.previewRevisionId,
    )).toMatchObject({ closed: true });
    expect(widgets.stopPreviewCalls).toBe(4);
  });

  test('treats public close as complete when the exact Preview revision is already inactive', async () => {
    const { controller, widgets, createDraft } = await harness();
    const draft = await createDraft('Close Preview Replaced');
    const preview = await controller.buildPreview(draft.draftId, 'close-replaced-owner', draft.revision, null);
    expect(preview.ready).toBe(true);
    if (!preview.ready) return;
    const active = widgets.previews.get(preview.previewId);
    if (!active) throw new Error('Expected active Preview fixture.');
    const replacementId = '00000000-0000-4000-8000-888888888888';
    widgets.previews.set(preview.previewId, { ...active, id: replacementId });

    expect(await controller.closePreview(
      draft.draftId,
      preview.previewId,
      preview.previewRevisionId,
    )).toMatchObject({ closed: true });
    expect(widgets.stopPreviewCalls).toBe(1);
    expect(widgets.previews.get(preview.previewId)?.id).toBe(replacementId);
  });

  test('the primary controller has no actor-runtime import or actor lifecycle surface', async () => {
    const source = await readFile(
      join(import.meta.dir, '..', 'src', 'widget-drafts', 'WidgetDraftController.ts'),
      'utf8',
    );
    expect(source).not.toContain('@vibecanvas/service-actor');
    expect(source).not.toContain('new Actor');
    expect(source).not.toContain('sendPreview(');
    expect(source).not.toContain('resetPreview(');
    expect(source).not.toContain('refreshPreview(');
  });
});
