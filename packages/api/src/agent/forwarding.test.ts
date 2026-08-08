import { describe, expect, test } from 'bun:test';
import { apiApprovalResolve } from './api.approval.resolve';
import { apiChatApprovalResolve } from './api.chat.approval.resolve';
import { apiChatConnect } from './api.chat.connect';
import { apiChatEdit } from './api.chat.edit';
import { apiChatHistory } from './api.chat.history';

describe('agent API forwarding', () => {
  test('forwards chat connection arguments to the agent capability', async () => {
    const calls: unknown[][] = [];
    const context = {
      agent: {
        async connectChat(...args: unknown[]) {
          calls.push(['connect', ...args]);
          return { vcJson: null, messageHistory: [] };
        },
      },
    } as never;
    const connect = apiChatConnect.callable({ context });

    await connect({ widgetId: 'widget-1', sessionId: 'session-1', mode: 'replace' });

    expect(calls).toEqual([
      ['connect', 'widget-1', 'session-1', 'replace'],
    ]);
  });

  test('forwards canonical history reads and edit selections by entry ID', async () => {
    const calls: unknown[][] = [];
    const context = {
      agent: {
        getChatHistory(...args: unknown[]) {
          calls.push(['history', ...args]);
          return [];
        },
        async editChatMessage(...args: unknown[]) {
          calls.push(['edit', ...args]);
          return [];
        },
      },
    } as never;
    const history = apiChatHistory.callable({ context });
    const edit = apiChatEdit.callable({ context });

    await history({ widgetId: 'widget-1', sessionId: 'session-1' });
    await edit({
      widgetId: 'widget-1',
      sessionId: 'session-1',
      entryId: 'entry-1',
      text: 'corrected',
      model: { provider: 'openai-codex', modelId: 'gpt-test' },
      thinkingLevel: 'high',
    });

    expect(calls).toEqual([
      ['history', 'widget-1', 'session-1'],
      ['edit', 'widget-1', 'session-1', 'entry-1', 'corrected', {
        model: { provider: 'openai-codex', modelId: 'gpt-test' },
        thinkingLevel: 'high',
      }],
    ]);
  });

  test('forwards approval decisions through both approval routes', async () => {
    const calls: unknown[][] = [];
    const context = {
      agent: {
        async resolveChatApproval(...args: unknown[]) {
          calls.push(args);
          return {
            resolved: true as const,
            decision: args[3],
            decisionSource: 'user' as const,
          };
        },
      },
    } as never;
    const resolveApproval = apiApprovalResolve.callable({ context });
    const resolveChatApproval = apiChatApprovalResolve.callable({ context });

    await resolveApproval({
      widgetId: 'widget-1',
      sessionId: 'session-1',
      approvalId: 'approval-1',
      decision: 'approve',
    });
    await resolveChatApproval({
      widgetId: 'widget-1',
      sessionId: 'session-1',
      approvalId: 'approval-2',
      decision: 'reject',
    });

    expect(calls).toEqual([
      ['widget-1', 'session-1', 'approval-1', 'approve'],
      ['widget-1', 'session-1', 'approval-2', 'reject'],
    ]);
  });
});
