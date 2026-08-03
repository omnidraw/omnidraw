import { describe, expect, test } from 'bun:test';
import { apiWidgetPreviewBuild } from './api.widgetPreview.build';
import { apiWidgetPreviewCancel } from './api.widgetPreview.cancel';
import {
  apiWidgetPreviewDiagnosticReport,
  apiWidgetPreviewDiagnosticResolve,
  apiWidgetPreviewDiagnosticRetest,
  apiWidgetPreviewDiagnosticsGet,
} from './api.widgetPreview.diagnostics';
import {
  apiWidgetPreviewMountAcquire,
  apiWidgetPreviewMountRelease,
  apiWidgetPreviewMountRenew,
} from './api.widgetPreview.mount';
import {
  apiWidgetPreviewOwnerClose,
  apiWidgetPreviewOwnerEnsure,
  apiWidgetPreviewOwnerGet,
  apiWidgetPreviewOwnerList,
} from './api.widgetPreview.owner';
import { apiWidgetPublishPublish } from './api.widgetPublish.publish';
import { apiWidgetPreviewTestReport } from './api.widgetPreview.test';

describe('agent Preview forwarding', () => {
  test('forwards stateless and frame-qualified build identities', async () => {
    const calls: unknown[][] = [];
    const expected = { ready: false, draftId: crypto.randomUUID(), reason: 'not-found', message: 'missing', diagnostics: [] } as const;
    const context = {
      agent: {
        async buildWidgetPreview(...args: unknown[]) {
          calls.push(args);
          return expected;
        },
      },
    } as never;
    expect(await apiWidgetPreviewBuild.callable({ context })({ draftId: expected.draftId })).toEqual(expected);
    const ownerRef = {
      previewId: crypto.randomUUID(),
      canvasId: 'canvas-preview',
      frameNodeId: 'frame-preview',
    };
    expect(await apiWidgetPreviewBuild.callable({ context })({
      draftId: expected.draftId,
      ...ownerRef,
    })).toEqual(expected);
    expect(calls).toEqual([
      [expected.draftId, undefined],
      [expected.draftId, ownerRef],
    ]);
  });

  test('forwards the exact pending Preview build cancellation fence', async () => {
    const calls: unknown[] = [];
    const input = {
      previewId: crypto.randomUUID(),
      canvasId: 'canvas-cancel',
      frameNodeId: 'frame-cancel',
      buildId: crypto.randomUUID(),
      expectedBuildSequence: 7,
    };
    const context = {
      agent: {
        async cancelWidgetPreviewBuild(request: unknown) {
          calls.push(request);
          return true;
        },
      },
    } as never;

    await expect(apiWidgetPreviewCancel.callable({ context })(input))
      .resolves.toBe(true);
    expect(calls).toEqual([input]);
  });

  test('forwards an exact bounded Preview interaction result', async () => {
    const calls: unknown[] = [];
    const input = {
      requestId: crypto.randomUUID(),
      draftId: crypto.randomUUID(),
      previewId: crypto.randomUUID(),
      previewRevisionId: crypto.randomUUID(),
      revision: 'a'.repeat(64),
      committedMutationId: 'mutation-a',
      mountLeaseId: crypto.randomUUID(),
      checks: [{ index: 0, type: 'click' as const, passed: true, evidence: 'Clicked.' }],
    };
    const context = {
      agent: {
        async reportWidgetPreviewTestResult(request: unknown) {
          calls.push(request);
          return true;
        },
      },
    } as never;
    await expect(apiWidgetPreviewTestReport.callable({ context })(input))
      .resolves.toEqual({ accepted: true });
    expect(calls).toEqual([input]);
  });


  test('forwards the stable Preview frame target for publication', async () => {
    const calls: unknown[][] = [];
    const draftId = crypto.randomUUID();
    const input = {
      idempotencyKey: 'publish-mounted-preview',
      draftId,
      previewId: crypto.randomUUID(),
      canvasId: 'canvas-published-preview',
      frameNodeId: 'frame-published-preview',
    };
    const expected = {
      published: false,
      draftId,
      reason: 'publication-conflict',
      message: 'conflict',
      errors: [],
      warnings: [],
    } as const;
    const context = {
      agent: {
        async publishWidgetDraft(...args: unknown[]) {
          calls.push(args);
          return expected;
        },
      },
    } as never;

    await expect(apiWidgetPublishPublish.callable({ context })(input))
      .resolves.toEqual(expected);
    expect(calls).toEqual([[
      draftId,
      {
        idempotencyKey: input.idempotencyKey,
        previewId: input.previewId,
        canvasId: input.canvasId,
        frameNodeId: input.frameNodeId,
      },
    ]]);
  });

  test('forwards exact Preview mount lease identities without caller timing authority', async () => {
    const calls: unknown[] = [];
    const input = {
      leaseId: crypto.randomUUID(),
      previewId: crypto.randomUUID(),
      previewRevisionId: crypto.randomUUID(),
      canvasId: 'canvas-mounted-preview',
      frameNodeId: 'frame-mounted-preview',
    };
    const descriptor = {
      ...input,
      acquiredAtMs: 10,
      renewedAtMs: 20,
      expiresAtMs: 60_020,
    };
    const context = {
      agent: {
        async acquireWidgetPreviewMountLease(request: unknown) {
          calls.push(['acquire', request]);
          return descriptor;
        },
        async renewWidgetPreviewMountLease(request: unknown) {
          calls.push(['renew', request]);
          return descriptor;
        },
        async releaseWidgetPreviewMountLease(request: unknown) {
          calls.push(['release', request]);
          return true;
        },
      },
    } as never;

    await expect(apiWidgetPreviewMountAcquire.callable({ context })(input))
      .resolves.toEqual(descriptor);
    await expect(apiWidgetPreviewMountRenew.callable({ context })(input))
      .resolves.toEqual(descriptor);
    await expect(apiWidgetPreviewMountRelease.callable({ context })(input))
      .resolves.toBe(true);
    expect(calls).toEqual([
      ['acquire', input],
      ['renew', input],
      ['release', input],
    ]);
  });

  test('forwards the exact structured Preview diagnostic without rewriting it', async () => {
    const calls: unknown[] = [];
    const input = {
      previewId: crypto.randomUUID(),
      canvasId: 'canvas-diagnostic',
      frameNodeId: 'frame-diagnostic',
      draftId: crypto.randomUUID(),
      originChatId: crypto.randomUUID(),
      diagnostic: {
        formatVersion: 1 as const,
        fingerprint: 'f'.repeat(64),
        origin: 'host' as const,
        phase: 'mounting',
        code: 'WIDGET_HOST_MOUNT_FAILED',
        severity: 'error' as const,
        message: 'Preview mount failed.',
        trust: 'untrusted' as const,
        draftRevision: 'a'.repeat(64),
        previewRevisionId: crypto.randomUUID(),
        buildId: crypto.randomUUID(),
        buildSequence: 1,
        occurrenceCount: 1,
        retryability: 'retryable' as const,
        timestampMs: 10,
      },
    };
    const expected = {
      accepted: true,
      deduplicated: false,
    } as const;
    const context = {
      agent: {
        async reportWidgetPreviewDiagnostic(request: unknown) {
          calls.push(request);
          return expected;
        },
      },
    } as never;

    await expect(apiWidgetPreviewDiagnosticReport.callable({ context })(input))
      .resolves.toEqual(expected);
    expect(calls).toEqual([input]);
  });

  test('forwards exact diagnostic query, retest, and resolution fences', async () => {
    const calls: Array<readonly [string, unknown]> = [];
    const ownerRef = {
      previewId: crypto.randomUUID(),
      canvasId: 'canvas-diagnostic-lifecycle',
      frameNodeId: 'frame-diagnostic-lifecycle',
    };
    const selection = {
      ...ownerRef,
      previewRevisionId: crypto.randomUUID(),
      fingerprint: 'd'.repeat(64),
    };
    const records = [{
      status: 'awaiting-retest' as const,
      reportedAtMs: 10,
      diagnostic: {
        formatVersion: 1 as const,
        fingerprint: selection.fingerprint,
        origin: 'capability' as const,
        phase: 'runtime',
        code: 'PROVIDER_FAILED',
        severity: 'error' as const,
        message: 'Provider failed.',
        trust: 'untrusted' as const,
        draftRevision: 'a'.repeat(64),
        previewRevisionId: selection.previewRevisionId,
        buildId: selection.previewRevisionId,
        buildSequence: 1,
        occurrenceCount: 1,
        retryability: 'unknown' as const,
        timestampMs: 9,
        operation: 'resource.read',
      },
    }];
    const owner = {
      orgId: 'org-diagnostic-lifecycle',
      id: ownerRef.previewId,
      accountId: 'account-diagnostic-lifecycle',
      canvasId: ownerRef.canvasId,
      frameNodeId: ownerRef.frameNodeId,
      draftId: crypto.randomUUID(),
      originChatId: crypto.randomUUID(),
      role: 'placed' as const,
      status: 'failed' as const,
      activeRevisionId: selection.previewRevisionId,
      pendingBuildId: null,
      buildSequence: 1,
      bindingRevision: 0,
      bindingPlanDigestSha256: 'b'.repeat(64),
      sourceDigestSha256: 'a'.repeat(64),
      committedMutationId: 'mutation-diagnostic-lifecycle',
      runtimeDiagnostics: records,
      publishedPreviewRevisionId: null,
      publishedBindingRevision: null,
      publishedBindingPlanDigestSha256: null,
      publishedWidgetRevisionId: null,
      publishedIdempotencyKey: null,
      lastError: null,
      createdAtMs: 1,
      updatedAtMs: 10,
      closedAtMs: null,
    };
    const context = {
      agent: {
        async getWidgetPreviewDiagnostics(input: unknown) {
          calls.push(['get', input]);
          return records;
        },
        async retestWidgetPreviewDiagnostic(input: unknown) {
          calls.push(['retest', input]);
          return owner;
        },
        async resolveWidgetPreviewDiagnostic(input: unknown) {
          calls.push(['resolve', input]);
          return owner;
        },
      },
    } as never;

    await expect(apiWidgetPreviewDiagnosticsGet.callable({ context })(ownerRef))
      .resolves.toEqual(records);
    await expect(apiWidgetPreviewDiagnosticRetest.callable({ context })({
      ...selection,
      operation: 'resource.read',
    })).resolves.toEqual(owner);
    await expect(apiWidgetPreviewDiagnosticResolve.callable({ context })(selection))
      .resolves.toEqual(owner);
    expect(calls).toEqual([
      ['get', ownerRef],
      ['retest', { ...selection, operation: 'resource.read' }],
      ['resolve', selection],
    ]);
  });


  test('forwards durable owner lifecycle identities without client timestamps', async () => {
    const calls: Array<readonly [string, unknown[]]> = [];
    const expected = {
      orgId: 'org-test',
      id: '00000000-0000-4000-8000-000000000021',
      accountId: 'account-test',
      canvasId: 'canvas-test',
      frameNodeId: 'frame-test',
      draftId: '00000000-0000-4000-8000-000000000022',
      originChatId: '00000000-0000-4000-8000-000000000023',
      role: 'companion',
      status: 'queued',
      activeRevisionId: null,
      pendingBuildId: null,
      buildSequence: 0,
      bindingRevision: 0,
      bindingPlanDigestSha256: null,
      sourceDigestSha256: null,
      committedMutationId: null,
      runtimeDiagnostics: [],
      publishedPreviewRevisionId: null,
      publishedBindingRevision: null,
      publishedBindingPlanDigestSha256: null,
      publishedWidgetRevisionId: null,
      publishedIdempotencyKey: null,
      lastError: null,
      createdAtMs: 10,
      updatedAtMs: 10,
      closedAtMs: null,
    } as const;
    const ensure = {
      previewId: expected.id,
      canvasId: expected.canvasId,
      frameNodeId: expected.frameNodeId,
      draftId: expected.draftId,
      originChatId: expected.originChatId,
      role: expected.role,
    } as const;
    const ownerRef = {
      previewId: expected.id,
      canvasId: expected.canvasId,
      frameNodeId: expected.frameNodeId,
    } as const;
    const list = {
      canvasId: expected.canvasId,
      draftId: expected.draftId,
      includeClosed: true,
    } as const;
    const close = {
      ...ownerRef,
    } as const;
    const context = {
      agent: {
        async ensureWidgetPreviewOwner(...args: unknown[]) {
          calls.push(['ensure', args]);
          return expected;
        },
        async getWidgetPreviewOwner(...args: unknown[]) {
          calls.push(['get', args]);
          return expected;
        },
        async listWidgetPreviewOwners(...args: unknown[]) {
          calls.push(['list', args]);
          return [expected];
        },
        async closeWidgetPreviewOwner(...args: unknown[]) {
          calls.push(['close', args]);
          return true;
        },
      },
    } as never;

    await expect(apiWidgetPreviewOwnerEnsure.callable({ context })(ensure))
      .resolves.toEqual(expected);
    await expect(apiWidgetPreviewOwnerGet.callable({ context })(ownerRef))
      .resolves.toEqual(expected);
    await expect(apiWidgetPreviewOwnerList.callable({ context })(list))
      .resolves.toEqual([expected]);
    await expect(apiWidgetPreviewOwnerClose.callable({ context })(close))
      .resolves.toBe(true);
    expect(calls).toEqual([
      ['ensure', [ensure]],
      ['get', [ownerRef]],
      ['list', [list]],
      ['close', [close]],
    ]);
  });
});
