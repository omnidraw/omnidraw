import { describe, expect, test } from 'bun:test';
import {
  apiWidgetPreviewBuildState,
  apiWidgetPreviewOpen,
  apiWidgetPreviewRebuildDraft,
} from './api.preview';

const rejectedBuildState = Object.freeze({
  phase: 'rejected' as const,
  acceptedGeneration: 4,
  current: false,
  diagnostics: Object.freeze([Object.freeze({
    code: 'WIDGET_BUILD_FAILED',
    message: 'The isolated widget build exited with status 1.',
    path: 'ui/main.ts',
  })]),
});

describe('widget Preview API build failures', () => {
  test('exposes cold admission as restoring for a live Preview status surface', async () => {
    const context = {
      widgetPreview: {
        buildState: async () => ({
          phase: 'restoring' as const,
          acceptedGeneration: 8,
          current: false,
          diagnostics: [],
        }),
      },
    } as never;

    await expect(apiWidgetPreviewBuildState.callable({ context })({
      widgetKey: 'notes-board',
    })).resolves.toMatchObject({
      phase: 'restoring',
      acceptedGeneration: 8,
      current: false,
    });
  });

  test('carries the exact durable build state across a pre-guest open failure', async () => {
    const calls: string[] = [];
    const context = {
      widgetPreview: {
        async open() {
          calls.push('open');
          throw Object.assign(new Error('A newer widget build was rejected.'), {
            code: 'WIDGET_COMMAND_FAILED',
          });
        },
        async buildState(widgetKey: string) {
          calls.push(`state:${widgetKey}`);
          return rejectedBuildState;
        },
      },
    } as never;

    const open = apiWidgetPreviewOpen.callable({ context });
    await expect(open({
      canvasId: 'canvas-1',
      elementId: 'element-1',
      widgetKey: 'notes-board',
    })).rejects.toMatchObject({
      name: 'ProcedureError',
      code: 'CONFLICT',
      status: 409,
      message: 'A newer widget build was rejected.',
      data: {
        kind: 'widget-preview-build-state',
        ...rejectedBuildState,
        diagnostics: [{
          code: 'WIDGET_BUILD_FAILED',
          message: 'The isolated widget build exited with status 1.',
          path: 'ui/main.ts',
        }],
      },
    });
    expect(calls).toEqual(['open', 'state:notes-board']);
  });

  test('reports the current build-required state when an explicit rebuild fails', async () => {
    const buildRequired = {
      phase: 'build_required' as const,
      acceptedGeneration: null,
      current: false,
      diagnostics: [],
    };
    const context = {
      widgetPreview: {
        async rebuildDraft() {
          throw Object.assign(new Error('Widget build is required.'), { code: 'BUILD_REQUIRED' });
        },
        async buildState() { return buildRequired; },
      },
    } as never;

    const rebuild = apiWidgetPreviewRebuildDraft.callable({ context });
    await expect(rebuild({ widgetKey: 'notes-board' })).rejects.toMatchObject({
      name: 'ProcedureError',
      code: 'CONFLICT',
      data: {
        kind: 'widget-preview-build-state',
        phase: 'build_required',
        acceptedGeneration: null,
        current: false,
        diagnostics: [],
      },
    });
  });
});
