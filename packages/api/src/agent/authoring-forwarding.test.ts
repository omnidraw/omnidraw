import { describe, expect, test } from 'bun:test';
import { apiWidgetDraftGet } from './api.widgetDraft.get';
import { apiWidgetDraftList } from './api.widgetDraft.list';
import { apiWidgetDraftValidate } from './api.widgetDraft.validate';
import { apiWidgetPreviewBuild } from './api.widgetPreview.build';
import { apiWidgetPreviewClose } from './api.widgetPreview.close';
import { apiWidgetPreviewGet } from './api.widgetPreview.get';
import { apiWidgetPreviewCancelInvocation } from './api.widgetPreview.invocation.cancel';
import { apiWidgetPreviewGetInvocation } from './api.widgetPreview.invocation.get';
import { apiWidgetPreviewInvoke } from './api.widgetPreview.invoke';
import { apiWidgetPublishPublish } from './api.widgetPublish.publish';
import { apiWidgetsResolvePlacement } from './api.widgets';

describe('agent authoring API forwarding', () => {
  test('forwards immutable authoring identities without synthesizing actor or instance IDs', async () => {
    const calls: unknown[][] = [];
    const draftId = '00000000-0000-4000-8000-000000000001';
    const previewRevisionId = '00000000-0000-4000-8000-000000000002';
    const invocationId = '00000000-0000-4000-8000-000000000003';
    const revision = 'a'.repeat(64);
    const previewId = '00000000-0000-4000-8000-000000000004';
    const invocation = {
      id: invocationId,
      functionName: 'tick',
      previewId,
      previewRevisionId,
      status: 'queued' as const,
      output: null,
      failure: null,
      createdAtMs: 1,
      startedAtMs: null,
      finishedAtMs: null,
    };
    const previewFailure = {
      ready: false as const,
      draftId,
      previewId,
      reason: 'not-built' as const,
      message: 'Preview has not been built.',
      diagnostics: [],
    };
    const context = {
      agent: {
        async listWidgetDrafts(...args: unknown[]) {
          calls.push(['draft-list', ...args]);
          return [];
        },
        async getWidgetDraft(...args: unknown[]) {
          calls.push(['draft-get', ...args]);
          return null;
        },
        async validateWidgetDraft(...args: unknown[]) {
          calls.push(['draft-validate', ...args]);
          return null;
        },
        async getWidgetPreview(...args: unknown[]) {
          calls.push(['preview-get', ...args]);
          return previewFailure;
        },
        async buildWidgetPreview(...args: unknown[]) {
          calls.push(['preview-build', ...args]);
          return previewFailure;
        },
        async closeWidgetPreview(...args: unknown[]) {
          calls.push(['preview-close', ...args]);
          return { closed: true, draftId, previewId, previewRevisionId };
        },
        async invokeWidgetPreviewFunction(...args: unknown[]) {
          calls.push(['preview-invoke', ...args]);
          return invocation;
        },
        async getWidgetPreviewFunctionInvocation(...args: unknown[]) {
          calls.push(['preview-invocation-get', ...args]);
          return null;
        },
        async cancelWidgetPreviewFunctionInvocation(...args: unknown[]) {
          calls.push(['preview-invocation-cancel', ...args]);
          return invocation;
        },
        async publishWidgetDraft(...args: unknown[]) {
          calls.push(['draft-publish', ...args]);
          return {
            published: false as const,
            draftId,
            reason: 'validation-failed' as const,
            message: 'Draft is not valid.',
            errors: ['invalid'],
            warnings: [],
          };
        },
        async resolveWidgetPlacement(...args: unknown[]) {
          calls.push(['placement-resolve', ...args]);
          return {
            ok: false as const,
            code: 'STALE_REVISION' as const,
            message: 'Draft owner changed.',
          };
        },
      },
    } as never;

    await apiWidgetDraftList.callable({ context })({});
    await apiWidgetDraftGet.callable({ context })({ draftId });
    await apiWidgetDraftValidate.callable({ context })({ draftId, expectedRevision: revision });
    await apiWidgetPreviewGet.callable({ context })({ draftId, previewId });
    await apiWidgetPreviewBuild.callable({ context })({
      draftId,
      previewId,
      expectedDraftRevision: revision,
      expectedActivePreviewRevisionId: null,
    });
    await apiWidgetPreviewClose.callable({ context })({
      draftId,
      previewId,
      expectedPreviewRevisionId: previewRevisionId,
    });
    await apiWidgetPreviewInvoke.callable({ context })({
      draftId,
      previewId,
      previewRevisionId,
      functionName: 'tick',
      input: { amount: 1 },
      idempotencyKey: 'preview:tick:1',
    });
    await apiWidgetPreviewGetInvocation.callable({ context })({
      draftId,
      previewId,
      previewRevisionId,
      invocationId,
    });
    await apiWidgetPreviewCancelInvocation.callable({ context })({
      draftId,
      previewId,
      previewRevisionId,
      invocationId,
    });
    await apiWidgetPublishPublish.callable({ context })({ draftId, expectedRevision: revision });
    const placementReference = { source: 'draft' as const, name: 'Weather', revision };
    await apiWidgetsResolvePlacement.callable({ context })({
      reference: placementReference,
      previewId,
      expectedDraftId: draftId,
    });

    expect(calls).toEqual([
      ['draft-list'],
      ['draft-get', draftId],
      ['draft-validate', draftId, revision],
      ['preview-get', draftId, previewId],
      ['preview-build', draftId, previewId, revision, null],
      ['preview-close', draftId, previewId, previewRevisionId],
      [
        'preview-invoke',
        draftId,
        previewId,
        previewRevisionId,
        'tick',
        { amount: 1 },
        'preview:tick:1',
      ],
      ['preview-invocation-get', draftId, previewId, previewRevisionId, invocationId],
      ['preview-invocation-cancel', draftId, previewId, previewRevisionId, invocationId],
      ['draft-publish', draftId, revision],
      ['placement-resolve', placementReference, previewId, draftId],
    ]);
  });
});
