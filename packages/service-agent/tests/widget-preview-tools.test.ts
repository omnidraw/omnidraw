import { describe, expect, mock, test } from 'bun:test';
import { createWidgetPreviewTools } from '../src/tools/tool.widget-preview';
import { executeTool } from './tool.test-helpers';

const revision = 'a'.repeat(64);
const unavailableStatus = {
  state: 'unavailable' as const,
  draftId: null,
  previewId: null,
  canvasId: null,
  frameNodeId: null,
  attemptedRevision: null,
  attemptedCommittedMutationId: null,
  attemptedPreviewRevisionId: null,
  displayedPreviewRevisionId: null,
  displayedDraftRevision: null,
  bindingRevision: null,
  buildSequence: null,
  ownerBuildSequence: null,
  diagnostics: [],
  message: 'No companion Preview.',
};

describe('agent Preview tools', () => {
  test('forwards exact status and wait identities with cancellation', async () => {
    const calls: unknown[] = [];
    const tools = createWidgetPreviewTools({
      chatId: 'chat-a',
      authorize: async () => true,
      preview: {
        previewStatus: async (...args) => {
          calls.push(['status', ...args]);
          return unavailableStatus;
        },
        waitForPreview: async (request) => {
          calls.push(['wait', request]);
          return {
            outcome: 'canceled',
            status: unavailableStatus,
          };
        },
        testPreview: async () => { throw new Error('unused'); },
      },
    });
    const status = await executeTool(tools[0]!, {});
    expect(status.isError).not.toBe(true);
    expect(status.content[0]?.text).toContain('No companion Preview');

    const controller = new AbortController();
    controller.abort();
    await tools[1]!.execute('tool-call', {
      expectedRevision: revision,
      expectedCommittedMutationId: 'mutation-a',
      timeoutMs: 500,
    }, controller.signal, undefined, {} as never);
    expect(calls[0]).toEqual(['status', 'chat-a', undefined]);
    expect(calls[1]).toEqual(['wait', expect.objectContaining({
      chatId: 'chat-a',
      expectedRevision: revision,
      expectedCommittedMutationId: 'mutation-a',
      timeoutMs: 500,
      signal: controller.signal,
    })]);
  });

  test('rejects arbitrary scripts and forwards only declared exact checks', async () => {
    const testPreview = mock(async (request: {
      draftId: string;
      expectedPreviewRevisionId: string;
      expectedRevision: string;
      expectedCommittedMutationId: string;
    }) => ({
      outcome: 'passed' as const,
      draftId: request.draftId,
      previewId: 'preview-a',
      previewRevisionId: request.expectedPreviewRevisionId,
      revision: request.expectedRevision,
      committedMutationId: request.expectedCommittedMutationId,
      checks: [{ index: 0, type: 'click' as const, passed: true, evidence: 'Clicked.' }],
    }));
    const tools = createWidgetPreviewTools({
      chatId: 'chat-a',
      authorize: async () => true,
      preview: {
        previewStatus: async () => { throw new Error('unused'); },
        waitForPreview: async () => { throw new Error('unused'); },
        testPreview,
      },
    });
    const invalid = await executeTool(tools[2]!, {
      draftId: 'draft-a',
      expectedRevision: revision,
      expectedCommittedMutationId: 'mutation-a',
      expectedPreviewRevisionId: 'preview-revision-a',
      checks: [{ type: 'script', source: 'document.body.remove()' }],
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]?.text).toContain('WIDGET_PREVIEW_TEST_INPUT_INVALID');
    expect(testPreview).not.toHaveBeenCalled();

    const valid = await executeTool(tools[2]!, {
      draftId: 'draft-a',
      expectedRevision: revision,
      expectedCommittedMutationId: 'mutation-a',
      expectedPreviewRevisionId: 'preview-revision-a',
      checks: [{ type: 'click', name: 'Increment' }],
    });
    expect(valid.isError).not.toBe(true);
    expect(testPreview).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-a',
      checks: [{ type: 'click', name: 'Increment' }],
    }));
  });
});
