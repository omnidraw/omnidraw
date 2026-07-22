import { describe, expect, test } from 'bun:test';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import { apiApprovalResolve } from './api.approval.resolve';
import { apiChatApprovalResolve } from './api.chat.approval.resolve';
import { apiChatConnect } from './api.chat.connect';

const tenant = fnFreezeTenantContext({
  orgId: 'org-agent-api',
  accountId: 'account-agent-api',
  cellId: 'cell-agent-api',
  placementEpoch: 4,
  roles: ['member'],
  capabilities: ['agent:write'],
  requestId: 'request-agent-api',
});

const expectedAuthorization = {
  accountId: tenant.accountId,
  requestId: tenant.requestId,
};

describe('agent API authorization forwarding', () => {
  test('forwards the trusted account and request to chat connection entry points', async () => {
    const calls: unknown[][] = [];
    const context = {
      tenant,
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
      ['connect', 'widget-1', 'session-1', expectedAuthorization, 'replace'],
    ]);
  });

  test('forwards the trusted account and request through both approval routes', async () => {
    const calls: unknown[][] = [];
    const context = {
      tenant,
      agent: {
        async resolveChatApproval(...args: unknown[]) {
          calls.push(args);
          return { resolved: true as const, decision: args[3] };
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
      ['widget-1', 'session-1', 'approval-1', 'approve', expectedAuthorization],
      ['widget-1', 'session-1', 'approval-2', 'reject', expectedAuthorization],
    ]);
  });
});
