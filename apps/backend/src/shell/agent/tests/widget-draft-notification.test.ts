import { describe, expect, test } from 'bun:test';
import { publishWidgetDraftsChangedAfterRefresh } from '../AgentService';

describe('agent widget draft catalog notification', () => {
  test('publishes only after the refreshed catalog is readable', async () => {
    const order: string[] = [];
    let finishRefresh!: () => void;
    const refreshFinished = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const completion = publishWidgetDraftsChangedAfterRefresh({
      refresh: async () => {
        order.push('refresh-started');
        await refreshFinished;
        order.push('refresh-finished');
      },
      publish: () => { order.push('agent-event'); },
    });

    await Promise.resolve();
    expect(order).toEqual(['refresh-started']);
    finishRefresh();
    await completion;
    expect(order).toEqual(['refresh-started', 'refresh-finished', 'agent-event']);
  });

  test('logs a refresh failure without publishing or failing the completed draft write', async () => {
    const failure = new Error('catalog scan failed');
    const observed: unknown[] = [];
    let publishCount = 0;

    await expect(publishWidgetDraftsChangedAfterRefresh({
      refresh: async () => { throw failure; },
      publish: () => { publishCount += 1; },
      onRefreshError: (error) => { observed.push(error); },
    })).resolves.toBeUndefined();

    expect(observed).toEqual([failure]);
    expect(publishCount).toBe(0);
  });
});
