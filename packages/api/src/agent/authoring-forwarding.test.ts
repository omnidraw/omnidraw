import { describe, expect, test } from 'bun:test';
import { apiWidgetPreviewBuild } from './api.widgetPreview.build';

describe('agent Preview forwarding', () => {
  test('forwards only the durable draft identity', async () => {
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
    expect(calls).toEqual([[expected.draftId]]);
  });
});
