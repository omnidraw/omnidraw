import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { AgentService } from '../src/AgentService';
import { WidgetManagement } from '../src/widget-management/WidgetManagement';
import {
  TEST_CAPSULE_BUILD_IDENTITY,
  TEST_CAPSULE_BUILD_POLICY_ID,
  createWidgetAuthoringHarness,
} from './widget-authoring.fixture';
import { createTestTenantEvents, TEST_TENANT } from './tenant.fixture';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function harness(eventPublisher?: ITenantEventPublisherService) {
  const root = await mkdtemp(join(tmpdir(), 'vc-agent-stateless-preview-'));
  roots.push(root);
  return { root, ...await createWidgetAuthoringHarness(root, eventPublisher) };
}

describe('WidgetDraftController stateless Preview', () => {
  test('persists a created draft before publishing its sidebar refresh event', async () => {
    const events = createTestTenantEvents();
    const iterator = events.subscribeAgentEvents()[Symbol.asyncIterator]();
    const nextEvent = iterator.next();
    const { createDraft, store } = await harness(events);

    const draft = await createDraft('Sidebar Clock');

    expect(await store.getDraft(TEST_TENANT, draft.draftId)).toMatchObject({
      id: draft.draftId,
      name: draft.name,
      sourceDigestSha256: draft.revision,
      committedMutationId: draft.committedMutationId,
      buildSequence: 1,
    });
    await expect(nextEvent).resolves.toEqual({
      done: false,
      value: {
        kind: 'widget-draft',
        type: 'created',
        draftId: draft.draftId,
        revision: draft.revision,
        sourceDigestSha256: draft.revision,
        committedMutationId: draft.committedMutationId!,
        buildSequence: draft.buildSequence,
      },
    });
    await iterator.return?.();
  });

  test('allocates one immutable mutation fence for each successful source tool mutation', async () => {
    const events = createTestTenantEvents();
    const { controller, createDraft, store } = await harness(events);
    const draft = await createDraft('Mutation Fence Clock');
    const iterator = events.subscribeAgentEvents()[Symbol.asyncIterator]();

    const first = await controller.handleToolChange({
      name: draft.name,
      type: 'changed',
    });
    const firstEvent = await iterator.next();
    const second = await controller.handleToolChange({
      name: draft.name,
      type: 'changed',
    });
    const secondEvent = await iterator.next();
    if (!first?.committedMutationId || !second?.committedMutationId) {
      throw new Error('Expected each source mutation to allocate an exact fence.');
    }

    expect(first).toMatchObject({
      revision: draft.revision,
      buildSequence: draft.buildSequence + 1,
    });
    expect(second).toMatchObject({
      revision: draft.revision,
      buildSequence: draft.buildSequence + 2,
    });
    expect(first.committedMutationId).not.toBe(draft.committedMutationId);
    expect(second.committedMutationId).not.toBe(first.committedMutationId);
    expect(firstEvent).toEqual({
      done: false,
      value: {
        kind: 'widget-draft',
        type: 'changed',
        draftId: draft.draftId,
        revision: draft.revision,
        sourceDigestSha256: draft.revision,
        committedMutationId: first.committedMutationId,
        buildSequence: first.buildSequence,
      },
    });
    expect(secondEvent).toEqual({
      done: false,
      value: {
        kind: 'widget-draft',
        type: 'changed',
        draftId: draft.draftId,
        revision: draft.revision,
        sourceDigestSha256: draft.revision,
        committedMutationId: second.committedMutationId,
        buildSequence: second.buildSequence,
      },
    });
    expect(await store.getDraft(TEST_TENANT, draft.draftId)).toMatchObject({
      sourceDigestSha256: draft.revision,
      committedMutationId: second?.committedMutationId,
      buildSequence: second?.buildSequence,
    });
    await iterator.return?.();
  });

  test('validation and reconciliation never manufacture a source mutation fence', async () => {
    const { root, controller, createDraft, store } = await harness();
    const draft = await createDraft('Validation Fence Clock');
    const before = await store.getDraft(TEST_TENANT, draft.draftId);
    if (!before?.committedMutationId) {
      throw new Error('Expected the created draft to have a committed mutation fence.');
    }

    await controller.handleToolChange({
      name: draft.name,
      type: 'validated',
    });
    expect(await store.getDraft(TEST_TENANT, draft.draftId)).toMatchObject({
      sourceDigestSha256: before.sourceDigestSha256,
      committedMutationId: before.committedMutationId,
      buildSequence: before.buildSequence,
    });

    await writeFile(
      join(root, 'pi', 'agent', 'widgets', 'drafts', draft.name, 'ui', 'main.ts'),
      'document.body.append(document.createElement("dialog"));\n',
      'utf8',
    );
    await controller.validate(draft.draftId);
    expect(await store.getDraft(TEST_TENANT, draft.draftId)).toMatchObject({
      sourceDigestSha256: before.sourceDigestSha256,
      committedMutationId: before.committedMutationId,
      buildSequence: before.buildSequence,
    });
  });

  test('returns verified UI bytes with no durable Preview identity', async () => {
    const { controller, createDraft } = await harness();
    const draft = await createDraft('Browser Clock');
    const preview = await controller.buildPreview(draft.draftId);

    expect(preview.ready).toBe(true);
    if (!preview.ready) return;
    const bytes = Buffer.from(preview.uiArtifact.bytesBase64, 'base64');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(preview.uiArtifact.digestSha256);
    expect(preview.contract.functions).toEqual([]);
    expect(preview.previewId).toBeNull();
    expect(preview.previewRevisionId).toBeNull();
    expect(preview.buildSequence).toBeNull();
    expect(preview.bindingRevision).toBeNull();
    expect(preview).not.toHaveProperty('expiresAtMs');
  });

  test('rebuilds from the current draft after source changes', async () => {
    const { root, controller, createDraft } = await harness();
    const draft = await createDraft('Refresh Clock');
    const first = await controller.buildPreview(draft.draftId);
    await writeFile(
      join(root, 'pi', 'agent', 'widgets', 'drafts', draft.name, 'ui', 'main.ts'),
      'document.body.append(document.createElement("output"));\n',
      'utf8',
    );
    const changed = await controller.handleToolChange({
      name: draft.name,
      type: 'changed',
    });
    expect(changed).toMatchObject({
      buildSequence: draft.buildSequence + 1,
    });
    const second = await controller.buildPreview(draft.draftId);
    expect(first.ready && second.ready && second.revision).not.toBe(first.ready ? first.revision : '');
  });

  test('preserves bounded successful Capsule diagnostics in the Preview response', async () => {
    const { controller, createDraft, widgets } = await harness();
    const draft = await createDraft('Diagnostic Clock');
    widgets.previewDiagnostics = [{
      severity: 'warning',
      code: 'CAPSULE_BUDGET_NEAR_LIMIT',
      message: '  Widget is close to its DOM budget.  ',
      path: 'ui/main.ts',
      line: 9,
      column: 4,
    }];

    const preview = await controller.buildPreview(draft.draftId);

    expect(preview.ready).toBe(true);
    if (!preview.ready) return;
    expect(preview.diagnostics).toEqual([
      expect.objectContaining({
        formatVersion: 1,
        origin: 'build',
        phase: 'building',
        code: 'CAPSULE_BUDGET_NEAR_LIMIT',
        severity: 'warning',
        message: 'Widget is close to its DOM budget.',
        file: 'widget://ui/main.ts',
        line: 9,
        column: 4,
        draftRevision: draft.revision,
      }),
    ]);
  });

  test('requires no Preview cleanup when the controller closes', async () => {
    const { controller, createDraft } = await harness();
    const draft = await createDraft('Disposable Clock');
    expect((await controller.buildPreview(draft.draftId)).ready).toBe(true);
    await expect(controller.close()).resolves.toBeUndefined();
  });
});

describe('WidgetDraftController durable Preview owners', () => {
  test('activates a durable revision and publishes that exact mounted Preview without another trusted build', async () => {
    const { controller, createDraft, store, widgets } = await harness();
    const draft = await createDraft('Promoted Clock');
    const owner = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000106',
      canvasId: 'canvas-promoted-clock',
      frameNodeId: 'frame-promoted-clock',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'companion',
    });

    const preview = await controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });

    expect(preview).toMatchObject({
      ready: true,
      previewId: owner.id,
      buildSequence: 1,
      bindingRevision: 1,
      revision: draft.revision,
    });
    if (!preview.ready || preview.previewRevisionId === null) return;
    expect(await store.getPreviewOwner(TEST_TENANT, owner.id)).toMatchObject({
      status: 'ready',
      activeRevisionId: preview.previewRevisionId,
      pendingBuildId: null,
    });
    expect(widgets.validateBuildCount).toBe(0);

    const publication = await controller.publish(
      draft.draftId,
      draft.revision,
      {
        idempotencyKey: 'publish-reviewed-preview',
        previewId: owner.id,
        previewRevisionId: preview.previewRevisionId,
        canvasId: owner.canvasId,
        frameNodeId: owner.frameNodeId,
        expectedBindingRevision: preview.bindingRevision!,
        expectedBindingPlanDigestSha256: preview.bindingPlanDigestSha256!,
      },
    );

    expect(publication).toMatchObject({
      published: true,
      draftId: draft.draftId,
      revision: draft.revision,
    });
    expect(widgets.publishCount).toBe(1);
    expect(widgets.validateBuildCount).toBe(0);
  });

  test('invalidates ready state when the selected binding plan changes', async () => {
    const {
      controller,
      createDraft,
      setResourceBindings,
      store,
    } = await harness();
    const draft = await createDraft('Binding Fence Clock');
    const owner = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000107',
      canvasId: 'canvas-binding-fence',
      frameNodeId: 'frame-binding-fence',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'placed',
    });
    const reviewed = await controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });
    if (
      !reviewed.ready
      || reviewed.previewRevisionId === null
      || reviewed.bindingRevision === null
      || reviewed.bindingPlanDigestSha256 === null
    ) throw new Error('Expected a ready reviewed Preview.');

    setResourceBindings([{
      slot: 'preferences',
      resourceId: 'resource-preferences-v2',
      kind: 'kv',
      allowRead: true,
      allowWrite: false,
    }]);
    await controller.invalidatePreviewBindingsForChat('external-chat');
    expect(await store.getPreviewOwner(TEST_TENANT, owner.id)).toMatchObject({
      status: 'queued',
      activeRevisionId: reviewed.previewRevisionId,
      bindingRevision: reviewed.bindingRevision + 1,
      bindingPlanDigestSha256: null,
    });
    await expect(controller.publish(draft.draftId, draft.revision, {
      idempotencyKey: 'publish-stale-binding-plan',
      previewId: owner.id,
      previewRevisionId: reviewed.previewRevisionId,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      expectedBindingRevision: reviewed.bindingRevision,
      expectedBindingPlanDigestSha256: reviewed.bindingPlanDigestSha256,
    })).resolves.toMatchObject({
      published: false,
      reason: 'resource-binding-invalid',
    });

    const rebuilt = await controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });
    expect(rebuilt).toMatchObject({
      ready: true,
      previewId: owner.id,
    });
    if (!rebuilt.ready) return;
    expect(rebuilt.previewRevisionId).not.toBe(reviewed.previewRevisionId);
    expect(rebuilt.bindingRevision).toBeGreaterThan(reviewed.bindingRevision);
    expect(rebuilt.bindingPlanDigestSha256)
      .not.toBe(reviewed.bindingPlanDigestSha256);
  });

  test('streams owner-fenced install, build, validation, and ready progress', async () => {
    const events = createTestTenantEvents();
    const { controller, createDraft } = await harness(events);
    const draft = await createDraft('Progress Clock');
    const owner = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000109',
      canvasId: 'canvas-progress-clock',
      frameNodeId: 'frame-progress-clock',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'placed',
    });
    const phases: string[] = [];
    const collect = (async () => {
      for await (const event of events.subscribeAgentEvents()) {
        if (
          !('kind' in event)
          || event.kind !== 'widget-preview'
          || event.type !== 'progress'
          || event.previewId !== owner.id
        ) continue;
        phases.push(event.phase);
        expect(event).toMatchObject({
          draftId: draft.draftId,
          revision: draft.revision,
          previewId: owner.id,
          buildSequence: 1,
        });
        if (event.phase === 'ready') return;
      }
    })();

    const preview = await controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });
    await collect;

    expect(preview.ready).toBe(true);
    expect(phases).toEqual([
      'queued',
      'installing',
      'building',
      'validating',
      'ready',
    ]);
  });

  test('cancels only the exact pending build and restores the last-good owner', async () => {
    const events = createTestTenantEvents();
    const { root, controller, createDraft, store, widgets } = await harness(events);
    const draft = await createDraft('Cancelable Clock');
    const owner = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000119',
      canvasId: 'canvas-cancelable-clock',
      frameNodeId: 'frame-cancelable-clock',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'placed',
    });
    const first = await controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });
    if (!first.ready || first.previewRevisionId === null) {
      throw new Error('Expected a last-good Preview revision.');
    }
    await writeFile(
      join(root, 'pi', 'agent', 'widgets', 'drafts', draft.name, 'ui', 'main.ts'),
      'document.body.append(document.createElement("aside"));\n',
      'utf8',
    );
    const changed = await controller.handleToolChange({
      name: draft.name,
      type: 'changed',
    });
    expect(changed).toMatchObject({
      buildSequence: draft.buildSequence + 1,
    });

    let startBuild!: () => void;
    const buildStarted = new Promise<void>((resolve) => {
      startBuild = resolve;
    });
    let rejectBuild!: (error: unknown) => void;
    const buildGate = new Promise<void>((_resolve, reject) => {
      rejectBuild = reject;
    });
    let buildSignal: AbortSignal | undefined;
    widgets.beforeBuildPreview = async (request) => {
      buildSignal = request.signal;
      startBuild();
      await buildGate;
    };
    const replacement = controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });
    await buildStarted;
    const building = await store.getPreviewOwner(TEST_TENANT, owner.id);
    if (building === null || building.pendingBuildId === null) {
      throw new Error('Expected an exact pending Preview build.');
    }

    await expect(controller.cancelPreviewBuild({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      buildId: `${building.pendingBuildId}-stale`,
      expectedBuildSequence: building.buildSequence,
    })).resolves.toBe(false);
    expect(buildSignal?.aborted).toBe(false);
    await expect(controller.cancelPreviewBuild({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      buildId: building.pendingBuildId,
      expectedBuildSequence: building.buildSequence + 1,
    })).resolves.toBe(false);

    const iterator = events.subscribeAgentEvents()[Symbol.asyncIterator]();
    const supersededEvent = (async () => {
      for (;;) {
        const next = await iterator.next();
        if (next.done) throw new Error('Preview event stream ended unexpectedly.');
        if (
          'kind' in next.value
          && next.value.kind === 'widget-preview'
          && next.value.type === 'progress'
          && next.value.previewId === owner.id
          && next.value.phase === 'superseded'
        ) return next.value;
      }
    })();
    await expect(controller.cancelPreviewBuild({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      buildId: building.pendingBuildId,
      expectedBuildSequence: building.buildSequence,
    })).resolves.toBe(true);
    expect(buildSignal?.aborted).toBe(true);
    await expect(supersededEvent).resolves.toMatchObject({
      draftId: draft.draftId,
      previewId: owner.id,
      buildId: building.pendingBuildId,
      buildSequence: building.buildSequence,
      phase: 'superseded',
    });
    await iterator.return?.();

    rejectBuild(Object.assign(new Error('Preview build was superseded.'), {
      code: 'WIDGET_BUILD_SUPERSEDED',
    }));
    await expect(replacement).resolves.toMatchObject({
      ready: false,
      reason: 'build-failed',
    });
    await Promise.resolve();
    expect(await store.getPreviewOwner(TEST_TENANT, owner.id)).toMatchObject({
      status: 'ready',
      activeRevisionId: first.previewRevisionId,
      pendingBuildId: null,
      buildSequence: building.buildSequence,
    });
  });

  test('aborts an obsolete guest build before serializing a committed edit', async () => {
    const { root, controller, createDraft, store, widgets } = await harness();
    const draft = await createDraft('Rapid Edit Clock');
    const owner = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000120',
      canvasId: 'canvas-rapid-edit',
      frameNodeId: 'frame-rapid-edit',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'placed',
    });
    let startBuild!: () => void;
    const buildStarted = new Promise<void>((resolve) => {
      startBuild = resolve;
    });
    let aborted = false;
    widgets.beforeBuildPreview = async (request) => {
      startBuild();
      await new Promise<void>((_resolve, reject) => {
        const rejectSuperseded = () => {
          aborted = true;
          reject(Object.assign(new Error('Preview build was superseded.'), {
            code: 'WIDGET_BUILD_SUPERSEDED',
          }));
        };
        if (request.signal?.aborted) {
          rejectSuperseded();
          return;
        }
        request.signal?.addEventListener('abort', rejectSuperseded, { once: true });
      });
    };

    const obsolete = controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });
    await buildStarted;
    await writeFile(
      join(root, 'pi', 'agent', 'widgets', 'drafts', draft.name, 'ui', 'main.ts'),
      'document.body.append(document.createElement("section"));\n',
      'utf8',
    );
    const changed = controller.handleToolChange({
      name: draft.name,
      type: 'changed',
    });

    await expect(obsolete).resolves.toMatchObject({
      ready: false,
      reason: 'build-failed',
    });
    await expect(changed).resolves.toMatchObject({
      draftId: draft.draftId,
    });
    expect(aborted).toBe(true);
    expect(await store.getPreviewOwner(TEST_TENANT, owner.id)).toMatchObject({
      status: 'failed',
      activeRevisionId: null,
      pendingBuildId: null,
      lastError: {
        code: 'WIDGET_BUILD_SUPERSEDED',
      },
    });
  });

  test('accepts only current untrusted runtime diagnostics and durably deduplicates them', async () => {
    const { controller, createDraft, store } = await harness();
    const draft = await createDraft('Runtime Diagnostic Clock');
    const owner = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000107',
      canvasId: 'canvas-runtime-diagnostic',
      frameNodeId: 'frame-runtime-diagnostic',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'companion',
    });
    const preview = await controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });
    if (!preview.ready || preview.previewRevisionId === null) {
      throw new Error('Expected a durable Preview revision.');
    }
    const diagnostic = {
      formatVersion: 1 as const,
      fingerprint: 'f'.repeat(64),
      origin: 'guest' as const,
      phase: 'runtime',
      code: 'WIDGET_GUEST_RUNTIME_FAILED',
      severity: 'error' as const,
      message: 'Guest render failed safely.',
      trust: 'untrusted' as const,
      draftRevision: preview.revision,
      previewRevisionId: preview.previewRevisionId,
      buildId: preview.previewRevisionId,
      buildSequence: preview.buildSequence!,
      occurrenceCount: 1,
      retryability: 'unknown' as const,
      timestampMs: 20_000,
      file: 'widget://ui/main.ts',
      line: 4,
      column: 2,
    };
    const request = {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      draftId: draft.draftId,
      originChatId: draft.chatId,
      diagnostic,
    };

    await expect(controller.reportPreviewDiagnostic(request)).resolves.toMatchObject({
      deduplicated: false,
      owner: {
        status: 'failed',
        activeRevisionId: preview.previewRevisionId,
      },
    });
    await expect(controller.reportPreviewDiagnostic(request)).resolves.toMatchObject({
      deduplicated: true,
    });
    const latestDiagnostic = {
      ...diagnostic,
      fingerprint: 'e'.repeat(64),
      code: 'WIDGET_GUEST_EVENT_FAILED',
      message: 'The latest guest event failed safely.',
      timestampMs: diagnostic.timestampMs + 1,
      operation: 'event.dispatch',
    };
    await expect(controller.reportPreviewDiagnostic({
      ...request,
      diagnostic: latestDiagnostic,
    })).resolves.toMatchObject({ deduplicated: false });
    const diagnosticOwner = await store.getPreviewOwner(TEST_TENANT, owner.id);
    expect(diagnosticOwner?.status).toBe('failed');
    expect(diagnosticOwner?.activeRevisionId).toBe(preview.previewRevisionId);
    const storedDiagnostics = diagnosticOwner?.runtimeDiagnostics
      .map((record) => record.diagnostic) as Array<typeof diagnostic>;
    expect(storedDiagnostics.map((value) => ({
      fingerprint: value.fingerprint,
      occurrenceCount: value.occurrenceCount,
    }))).toEqual([
      { fingerprint: diagnostic.fingerprint, occurrenceCount: 2 },
      { fingerprint: latestDiagnostic.fingerprint, occurrenceCount: 1 },
    ]);
    expect((await controller.getPreviewOwner({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    }))?.activeRevisionId).toBe(preview.previewRevisionId);
    expect(storedDiagnostics[0]?.previewRevisionId).toBe(preview.previewRevisionId);
    await expect(controller.getPreviewDiagnostics({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    })).resolves.toHaveLength(2);
    await expect(controller.retestPreviewDiagnostic({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      previewRevisionId: preview.previewRevisionId,
      fingerprint: diagnostic.fingerprint,
      operation: 'guest.render',
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_DIAGNOSTIC_RETEST_UNAVAILABLE',
    });
    await expect(controller.retestPreviewDiagnostic({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      previewRevisionId: preview.previewRevisionId,
      fingerprint: latestDiagnostic.fingerprint,
      operation: 'event.render',
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_DIAGNOSTIC_STALE',
    });
    await expect(controller.retestPreviewDiagnostic({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      previewRevisionId: preview.previewRevisionId,
      fingerprint: latestDiagnostic.fingerprint,
      operation: latestDiagnostic.operation,
    })).resolves.toMatchObject({
      status: 'failed',
      runtimeDiagnostics: [{
        status: 'awaiting-retest',
        diagnostic: { fingerprint: diagnostic.fingerprint },
      }],
    });
    await expect(controller.retestPreviewDiagnostic({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      previewRevisionId: preview.previewRevisionId,
      fingerprint: latestDiagnostic.fingerprint,
      operation: latestDiagnostic.operation,
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_DIAGNOSTIC_STALE',
    });
    await expect(controller.resolvePreviewDiagnostic({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      previewRevisionId: preview.previewRevisionId,
      fingerprint: diagnostic.fingerprint,
    })).resolves.toMatchObject({
      status: 'ready',
      runtimeDiagnostics: [],
    });
    await expect(controller.resolvePreviewDiagnostic({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: 'wrong-frame',
      previewRevisionId: preview.previewRevisionId,
      fingerprint: diagnostic.fingerprint,
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_DIAGNOSTIC_SCOPE_INVALID',
    });
    await expect(controller.reportPreviewDiagnostic({
      ...request,
      diagnostic: {
        ...diagnostic,
        buildId: '00000000-0000-4000-8000-000000000998',
      },
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_DIAGNOSTIC_STALE',
    });
    let lastFloodFingerprint = '';
    for (let index = 0; index < 28; index += 1) {
      lastFloodFingerprint = createHash('sha256')
        .update(`bounded-runtime-diagnostic-${index}`)
        .digest('hex');
      await expect(controller.reportPreviewDiagnostic({
        ...request,
        diagnostic: {
          ...diagnostic,
          fingerprint: lastFloodFingerprint,
          message: 'x'.repeat(2_000),
          timestampMs: diagnostic.timestampMs + 10 + index,
          file: `widget://${'a'.repeat(980)}`,
          capability: 'a'.repeat(299),
          operation: 'b'.repeat(299),
        },
      })).resolves.toMatchObject({ deduplicated: false });
    }
    const boundedOwner = await store.getPreviewOwner(TEST_TENANT, owner.id);
    const boundedDiagnostics = boundedOwner?.runtimeDiagnostics
      .map((record) => record.diagnostic);
    expect(Array.isArray(boundedDiagnostics)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(boundedDiagnostics), 'utf8'))
      .toBeLessThanOrEqual(64 * 1_024);
    expect((boundedDiagnostics as Array<typeof diagnostic>).at(-1)?.fingerprint)
      .toBe(lastFloodFingerprint);
    await expect(controller.reportPreviewDiagnostic({
      ...request,
      diagnostic: {
        ...diagnostic,
        fingerprint: createHash('sha256')
          .update('rate-limited-runtime-diagnostic')
          .digest('hex'),
        timestampMs: diagnostic.timestampMs + 100,
      },
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_DIAGNOSTIC_RATE_LIMITED',
    });
    await expect(controller.reportPreviewDiagnostic({
      ...request,
      diagnostic: {
        ...diagnostic,
        previewRevisionId: '00000000-0000-4000-8000-000000000999',
      },
    })).rejects.toMatchObject({
      code: 'WIDGET_PREVIEW_DIAGNOSTIC_SCOPE_INVALID',
    });
  });

  test('records a last-good runtime diagnostic without cancelling a newer build fence', async () => {
    const { controller, createDraft, store } = await harness();
    const draft = await createDraft('Runtime Diagnostic Race Clock');
    const owner = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000117',
      canvasId: 'canvas-runtime-diagnostic-race',
      frameNodeId: 'frame-runtime-diagnostic-race',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'companion',
    });
    const preview = await controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });
    if (
      !preview.ready
      || preview.previewRevisionId === null
      || preview.buildSequence === null
    ) {
      throw new Error('Expected a durable Preview revision.');
    }
    const pendingBuildId = '00000000-0000-4000-8000-000000000118';
    await expect(store.compareAndSetPreviewOwner(TEST_TENANT, {
      previewId: owner.id,
      expectedBuildSequence: preview.buildSequence,
      expectedStatus: 'ready',
      expectedPendingBuildId: null,
      nextBuildSequence: preview.buildSequence + 1,
      status: 'building',
      pendingBuildId,
      nowMs: 30_000,
    })).resolves.toMatchObject({
      status: 'building',
      activeRevisionId: preview.previewRevisionId,
      pendingBuildId,
      buildSequence: preview.buildSequence + 1,
    });

    await expect(controller.reportPreviewDiagnostic({
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
      draftId: draft.draftId,
      originChatId: draft.chatId,
      diagnostic: {
        formatVersion: 1,
        fingerprint: 'd'.repeat(64),
        origin: 'guest',
        phase: 'runtime',
        code: 'WIDGET_GUEST_RUNTIME_FAILED',
        severity: 'error',
        message: 'The last-good guest failed while its replacement was building.',
        trust: 'untrusted',
        draftRevision: preview.revision,
        previewRevisionId: preview.previewRevisionId,
        buildId: preview.previewRevisionId,
        buildSequence: preview.buildSequence,
        occurrenceCount: 1,
        retryability: 'unknown',
        timestampMs: 30_001,
      },
    })).resolves.toMatchObject({
      owner: {
        status: 'building',
        activeRevisionId: preview.previewRevisionId,
        pendingBuildId,
        buildSequence: preview.buildSequence + 1,
        lastError: null,
        runtimeDiagnostics: [{
          status: 'awaiting-retest',
          diagnostic: {
            previewRevisionId: preview.previewRevisionId,
          },
        }],
      },
    });
  });

  test('ensures, deduplicates, queries, and closes frame-owned Preview identities', async () => {
    const { controller, createDraft } = await harness();
    const draft = await createDraft('Owned Clock');
    const companion = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000101',
      canvasId: 'canvas-owned-clock',
      frameNodeId: 'frame-owned-clock',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'companion',
    });

    expect(companion).toMatchObject({
      id: '00000000-0000-4000-8000-000000000101',
      canvasId: 'canvas-owned-clock',
      frameNodeId: 'frame-owned-clock',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'companion',
      status: 'queued',
      activeRevisionId: null,
      buildSequence: 0,
    });
    expect(await controller.getPreviewOwner({
      previewId: companion.id,
      canvasId: companion.canvasId,
      frameNodeId: companion.frameNodeId,
    })).toEqual(companion);
    expect(await controller.getPreviewOwner({
      previewId: companion.id,
      canvasId: 'another-canvas',
      frameNodeId: companion.frameNodeId,
    })).toBeNull();

    const deduplicated = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000102',
      canvasId: 'canvas-owned-clock',
      frameNodeId: 'frame-raced-companion',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'companion',
    });
    expect(deduplicated).toEqual(companion);

    const placed = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000103',
      canvasId: 'canvas-owned-clock',
      frameNodeId: 'frame-placed-clock',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'placed',
    });
    expect(placed.id).not.toBe(companion.id);
    expect(await controller.listPreviewOwners({
      canvasId: companion.canvasId,
      draftId: draft.draftId,
    })).toEqual([
      companion,
      placed,
    ]);
    expect(await controller.listPreviewOwners({
      canvasId: 'another-canvas',
      draftId: draft.draftId,
    })).toEqual([]);

    await expect(controller.closePreviewOwner({
      previewId: companion.id,
      canvasId: companion.canvasId,
      frameNodeId: 'another-frame',
    })).resolves.toBe(false);
    await expect(controller.closePreviewOwner({
      previewId: companion.id,
      canvasId: 'another-canvas',
      frameNodeId: companion.frameNodeId,
    })).resolves.toBe(false);
    await expect(controller.closePreviewOwner({
      previewId: companion.id,
      canvasId: companion.canvasId,
      frameNodeId: companion.frameNodeId,
    })).resolves.toBe(true);

    expect(await controller.listPreviewOwners({
      canvasId: companion.canvasId,
      draftId: draft.draftId,
    })).toEqual([placed]);
    expect(await controller.listPreviewOwners({
      canvasId: companion.canvasId,
      draftId: draft.draftId,
      includeClosed: true,
    })).toEqual([
      expect.objectContaining({
        id: companion.id,
        status: 'closed',
        closedAtMs: expect.any(Number),
      }),
      placed,
    ]);
  });

  test('discard closes every owner and releases its warm Preview workspace', async () => {
    const { controller, createDraft, store, widgets } = await harness();
    const draft = await createDraft('Discarded Preview Clock');
    const owner = await controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000121',
      canvasId: 'canvas-discarded-preview',
      frameNodeId: 'frame-discarded-preview',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'placed',
    });
    const preview = await controller.buildPreview(draft.draftId, {
      previewId: owner.id,
      canvasId: owner.canvasId,
      frameNodeId: owner.frameNodeId,
    });
    expect(preview.ready).toBe(true);

    await controller.withDraftDeletion(
      draft.name,
      async (_cleanup, discardBeforeRemoval) => {
        await discardBeforeRemoval();
      },
    );

    expect(await store.getDraft(TEST_TENANT, draft.draftId)).toMatchObject({
      status: 'discarded',
    });
    expect(await store.getPreviewOwner(TEST_TENANT, owner.id)).toMatchObject({
      status: 'closed',
      activeRevisionId: null,
      pendingBuildId: null,
    });
    expect(await controller.listPreviewOwners({
      canvasId: owner.canvasId,
      draftId: draft.draftId,
    })).toEqual([]);
    expect(widgets.closePreviewWorkspaceRequests).toEqual([draft.draftId]);
    await expect(controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000122',
      canvasId: owner.canvasId,
      frameNodeId: 'frame-after-discard',
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'placed',
    })).rejects.toThrow('Preview owner does not match its durable draft and chat.');
  });

  test('rejects an owner whose origin chat does not own the durable draft', async () => {
    const { controller, createDraft } = await harness();
    const draft = await createDraft('Scoped Clock');

    await expect(controller.ensurePreviewOwner({
      previewId: '00000000-0000-4000-8000-000000000104',
      canvasId: 'canvas-scoped-clock',
      frameNodeId: 'frame-scoped-clock',
      draftId: draft.draftId,
      originChatId: '00000000-0000-4000-8000-000000000105',
      role: 'placed',
    })).rejects.toThrow('Preview owner does not match its durable draft and chat.');
  });
});

describe('AgentService durable Preview owners', () => {
  test('forwards the exact canvas and frame authority through the public service surface', async () => {
    const { root, createDraft, store, widgets } = await harness();
    const draft = await createDraft('Service Owned Clock');
    let nowMs = 20_000;
    const service = new AgentService({
      cachePath: join(root, 'cache'),
      dataPath: root,
      configPath: join(root, 'config'),
      eventPublisherService: createTestTenantEvents(),
      tenant: TEST_TENANT,
      authoringStore: store,
      widgetAuthoringCapability: widgets,
      resolveWidgetResourceBindings: async () => [],
      createId: () => crypto.randomUUID(),
      nowMs: () => ++nowMs,
      widgetBuilderIdentity: 'test-widget-builder/1',
      widgetCapsuleBuildIdentity: TEST_CAPSULE_BUILD_IDENTITY,
      widgetBuildPolicyId: TEST_CAPSULE_BUILD_POLICY_ID,
    });
    const identity = {
      previewId: '00000000-0000-4000-8000-000000000201',
      canvasId: 'canvas-service-owner',
      frameNodeId: 'frame-service-owner',
    } as const;

    const owner = await service.ensureWidgetPreviewOwner({
      ...identity,
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'placed',
    });

    await expect(service.getWidgetPreviewOwner(identity)).resolves.toEqual(owner);
    await expect(service.listWidgetPreviewOwners({
      canvasId: identity.canvasId,
      draftId: draft.draftId,
    })).resolves.toEqual([owner]);
    await expect(service.closeWidgetPreviewOwner(identity)).resolves.toBe(true);
  });

  test('forwards an exact pending-build cancellation fence to the controller', async () => {
    const { root, createDraft, store, widgets } = await harness();
    const draft = await createDraft('Service Cancel Clock');
    let nowMs = 30_000;
    const service = new AgentService({
      cachePath: join(root, 'cache'),
      dataPath: root,
      configPath: join(root, 'config'),
      eventPublisherService: createTestTenantEvents(),
      tenant: TEST_TENANT,
      authoringStore: store,
      widgetAuthoringCapability: widgets,
      resolveWidgetResourceBindings: async () => [],
      createId: () => crypto.randomUUID(),
      nowMs: () => ++nowMs,
      widgetBuilderIdentity: 'test-widget-builder/1',
      widgetCapsuleBuildIdentity: TEST_CAPSULE_BUILD_IDENTITY,
      widgetBuildPolicyId: TEST_CAPSULE_BUILD_POLICY_ID,
    });
    const identity = {
      previewId: '00000000-0000-4000-8000-000000000202',
      canvasId: 'canvas-service-cancel',
      frameNodeId: 'frame-service-cancel',
    } as const;
    const owner = await service.ensureWidgetPreviewOwner({
      ...identity,
      draftId: draft.draftId,
      originChatId: draft.chatId,
      role: 'placed',
    });
    const buildId = '00000000-0000-4000-8000-000000000203';
    const building = await store.compareAndSetPreviewOwner(TEST_TENANT, {
      previewId: owner.id,
      expectedBuildSequence: 0,
      nextBuildSequence: 1,
      status: 'building',
      pendingBuildId: buildId,
      nowMs: 30_002,
    });
    expect(building).not.toBeNull();

    await expect(service.cancelWidgetPreviewBuild({
      ...identity,
      buildId,
      expectedBuildSequence: 1,
    })).resolves.toBe(true);
    expect(await store.getPreviewOwner(TEST_TENANT, owner.id)).toMatchObject({
      status: 'failed',
      pendingBuildId: null,
      buildSequence: 1,
    });
  });

  test('supplies trusted time and the bounded TTL for exact Preview mount leases', async () => {
    const { root, store, widgets } = await harness();
    let nowMs = 40_000;
    const calls: unknown[] = [];
    store.acquirePreviewMountLease = async (_tenant, request) => {
      calls.push(['acquire', request]);
      return {
        leaseId: request.leaseId,
        previewId: request.previewId,
        previewRevisionId: request.previewRevisionId,
        canvasId: request.canvasId,
        frameNodeId: request.frameNodeId,
        acquiredAtMs: request.nowMs,
        renewedAtMs: request.nowMs,
        expiresAtMs: request.nowMs + request.ttlMs,
      };
    };
    store.renewPreviewMountLease = async (_tenant, request) => {
      calls.push(['renew', request]);
      return {
        leaseId: request.leaseId,
        previewId: request.previewId,
        previewRevisionId: request.previewRevisionId,
        canvasId: request.canvasId,
        frameNodeId: request.frameNodeId,
        acquiredAtMs: 40_001,
        renewedAtMs: request.nowMs,
        expiresAtMs: request.nowMs + request.ttlMs,
      };
    };
    store.releasePreviewMountLease = async (_tenant, request) => {
      calls.push(['release', request]);
      return true;
    };
    const service = new AgentService({
      cachePath: join(root, 'cache'),
      dataPath: root,
      configPath: join(root, 'config'),
      eventPublisherService: createTestTenantEvents(),
      tenant: TEST_TENANT,
      authoringStore: store,
      widgetAuthoringCapability: widgets,
      resolveWidgetResourceBindings: async () => [],
      createId: () => crypto.randomUUID(),
      nowMs: () => ++nowMs,
      widgetBuilderIdentity: 'test-widget-builder/1',
      widgetCapsuleBuildIdentity: TEST_CAPSULE_BUILD_IDENTITY,
      widgetBuildPolicyId: TEST_CAPSULE_BUILD_POLICY_ID,
    });
    const identity = {
      leaseId: '00000000-0000-4000-8000-000000000211',
      previewId: '00000000-0000-4000-8000-000000000212',
      previewRevisionId: '00000000-0000-4000-8000-000000000213',
      canvasId: 'canvas-service-mount',
      frameNodeId: 'frame-service-mount',
    } as const;

    await expect(service.acquireWidgetPreviewMountLease(identity)).resolves.toMatchObject({
      ...identity,
      acquiredAtMs: 40_001,
      expiresAtMs: 100_001,
    });
    await expect(service.renewWidgetPreviewMountLease(identity)).resolves.toMatchObject({
      ...identity,
      renewedAtMs: 40_002,
      expiresAtMs: 100_002,
    });
    await expect(service.releaseWidgetPreviewMountLease(identity)).resolves.toBe(true);
    expect(calls).toEqual([
      ['acquire', { ...identity, nowMs: 40_001, ttlMs: 60_000 }],
      ['renew', { ...identity, nowMs: 40_002, ttlMs: 60_000 }],
      ['release', { ...identity, nowMs: 40_003 }],
    ]);
  });


  test('exposes draft placement only after the exact revision passes trusted validation', async () => {
    const { workspace, controller, createDraft } = await harness();
    const draft = await createDraft('Validated Clock');
    const management = new WidgetManagement({ workspace, drafts: controller });

    const before = await management.detail(draft.name, 'draft');
    expect(before?.variant.validation?.status).toBe('unknown');
    expect(before?.variant.placement).toBeNull();

    await controller.validate(draft.draftId, draft.revision);

    const after = await management.detail(draft.name, 'draft');
    expect(after?.variant.validation).toMatchObject({
      status: 'valid',
      validatedRevision: draft.revision,
    });
    expect(after?.variant.placement?.reference).toEqual({
      source: 'draft',
      name: draft.name,
      revision: draft.revision,
    });
    expect((await management.catalog([])).widgets[0]?.preview).toMatchObject({
      status: 'ready',
      revision: draft.revision,
      placement: {
        reference: {
          source: 'draft',
          name: draft.name,
          revision: draft.revision,
        },
      },
    });
  });

  test('marks a filesystem-only orphan as needing validation and removes placement', async () => {
    const { workspace, controller } = await harness();
    await workspace.createDraft('orphan-chat', { name: 'Orphan Clock' }, async ({ cwd, name }) => {
      await mkdir(join(cwd, 'ui'), { recursive: true });
      await writeFile(join(cwd, 'ui', 'main.ts'), 'document.body.append(document.createElement("main"));\n', 'utf8');
      await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({
        schemaVersion: 3,
        name,
        slug: 'orphan-clock',
        ui: {
          runtime: 'capsule',
          entry: 'ui/main.ts',
          apis: ['DOM'],
        },
      }, null, 2)}\n`, 'utf8');
      return ['vibecanvas.json', 'ui/main.ts'];
    });
    const management = new WidgetManagement({ workspace, drafts: controller });

    const detail = await management.detail('Orphan Clock', 'draft');

    expect(detail?.variant).toMatchObject({
      draftId: null,
      placement: null,
      validation: null,
    });
    expect(detail?.problem).toEqual({
      code: 'DRAFT_IDENTITY_UNAVAILABLE',
      message: 'Validate this widget again from its owning AI chat before publishing or placing it.',
    });
  });

  test('persists supported manifest metadata', async () => {
    const { workspace, controller, createDraft } = await harness();
    const draft = await createDraft('Editable Clock');
    const management = new WidgetManagement({ workspace, drafts: controller });

    const result = await management.patchDraftMetadata(draft.name, draft.revision, {
      description: 'A precise clock.',
    });

    expect(result.variant.description).toBe('A precise clock.');
    const manifest = JSON.parse(await readFile(
      join(workspace.draftRoot, draft.name, 'vibecanvas.json'),
      'utf8',
    ));
    expect(manifest.description).toBe('A precise clock.');
  });

  test('renames npm-backed drafts without capturing node_modules symlinks', async () => {
    const events = createTestTenantEvents();
    const { workspace, controller, createDraft, store } = await harness(events);
    const draft = await createDraft('Linked Clock');
    const binDirectory = join(
      workspace.draftRoot,
      draft.name,
      'node_modules',
      '.bin',
    );
    await mkdir(binDirectory, { recursive: true });
    await symlink('../vite/bin/vite.js', join(binDirectory, 'vite'));
    const management = new WidgetManagement({ workspace, drafts: controller });
    const before = await store.getDraft(TEST_TENANT, draft.draftId);
    if (!before?.committedMutationId) {
      throw new Error('Expected the renamed draft to start with a committed mutation fence.');
    }
    const iterator = events.subscribeAgentEvents()[Symbol.asyncIterator]();

    const result = await management.patchDraftMetadata(draft.name, draft.revision, {
      name: 'Renamed Clock',
    });
    const renamed = await store.getDraft(TEST_TENANT, draft.draftId);
    if (!renamed?.sourceDigestSha256 || !renamed.committedMutationId) {
      throw new Error('Expected rename to commit one exact source mutation fence.');
    }

    expect(result.name).toBe('Renamed Clock');
    expect(renamed).toMatchObject({
      name: 'Renamed Clock',
      buildSequence: before.buildSequence + 1,
    });
    expect(renamed?.committedMutationId).not.toBe(before.committedMutationId);
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        kind: 'widget-draft',
        type: 'changed',
        draftId: draft.draftId,
        revision: renamed.sourceDigestSha256,
        sourceDigestSha256: renamed.sourceDigestSha256,
        committedMutationId: renamed.committedMutationId,
        buildSequence: renamed.buildSequence,
      },
    });
    expect(await readFile(
      join(workspace.draftRoot, 'Renamed Clock', 'vibecanvas.json'),
      'utf8',
    )).toContain('"name": "Renamed Clock"');
    await iterator.return?.();
  });

  test('rejects tool metadata instead of reporting a successful no-op', async () => {
    const { workspace, controller, createDraft } = await harness();
    const draft = await createDraft('Strict Clock');
    const management = new WidgetManagement({ workspace, drafts: controller });

    await expect(management.patchDraftMetadata(draft.name, draft.revision, {
      tool: { label: 'Ignored label' },
    })).rejects.toThrow('Manifest v3 does not expose tool metadata.');
    await expect(management.patchDraftTool(draft.name, draft.revision, {
      group: 'Ignored group',
    })).rejects.toThrow('Manifest v3 does not expose tool metadata.');
  });
});
