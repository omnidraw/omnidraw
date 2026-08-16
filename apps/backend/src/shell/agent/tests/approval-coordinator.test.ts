import { describe, expect, test } from 'bun:test';
import { ApprovalCoordinator, ApprovalRejectedError } from '../approval/ApprovalCoordinator';

async function waitForApproval(): Promise<void> {
  await Promise.resolve();
}

describe('process-local approvals', () => {
  test('executes immutable server-side arguments exactly once after approval', async () => {
    const executed: unknown[] = [];
    const coordinator = new ApprovalCoordinator({
      createId: () => 'approval-1',
      now: () => new Date('2026-08-04T12:30:15.987Z'),
    });
    const input = {
      resourceId: 'kv-1',
      operation: { kind: 'kv', operation: 'set', key: 'theme', value: 'dark' },
    };
    const toolResult = coordinator.request({
      chatId: 'chat-a',
      toolCallId: 'tool-call-1',
      kind: 'resource-data-write',
      exactArgs: input,
      summary: 'Write one KV entry',
      risk: 'high',
      safeDetails: { resourceId: 'kv-1', key: 'theme' },
      execute: async (args) => {
        executed.push(args);
        return { ok: true };
      },
    });
    input.operation.key = 'tampered';

    expect(coordinator.list('chat-a')).toEqual([
      expect.objectContaining({
        id: 'approval-1',
        createdAtSec: '2026-08-04T12:30:15.000Z',
      }),
    ]);
    await expect(coordinator.resolve('chat-a', 'approval-1', 'approve')).resolves.toEqual({
      resolved: true,
      decision: 'approve',
      decisionSource: 'user',
    });
    await expect(toolResult).resolves.toEqual({ ok: true });
    expect(executed).toEqual([{
      resourceId: 'kv-1',
      operation: { kind: 'kv', operation: 'set', key: 'theme', value: 'dark' },
    }]);
    await expect(coordinator.resolve('chat-a', 'approval-1', 'approve')).rejects.toThrow('not found');
  });

  test('rejects, cancels, and forgets pending approvals', async () => {
    let id = 0;
    const coordinator = new ApprovalCoordinator({
      createId: () => `approval-${++id}`,
      now: () => new Date(),
    });
    const request = () => coordinator.request({
      chatId: 'chat-a',
      toolCallId: `tool-call-${id + 1}`,
      kind: 'resource-delete' as const,
      exactArgs: { resourceId: 'kv-1' },
      summary: 'Delete resource',
      risk: 'high' as const,
      safeDetails: { resourceId: 'kv-1' },
      execute: async () => undefined,
    });

    const rejected = request();
    await coordinator.resolve('chat-a', 'approval-1', 'reject');
    await expect(rejected).rejects.toBeInstanceOf(ApprovalRejectedError);

    const disconnected = request();
    expect(coordinator.cancelChat('chat-a')).toBe(1);
    await expect(disconnected).rejects.toThrow('disconnected');
    expect(coordinator.list('chat-a')).toEqual([]);
  });

  test('always-approve and reviewer decisions preserve decision provenance', async () => {
    const automaticEvents: unknown[] = [];
    const automatic = new ApprovalCoordinator({
      createId: () => 'approval-policy',
      now: () => new Date(),
      policy: () => ({ mode: 'always-approve' }),
      authorize: ({ chatId, toolName }) => chatId === 'chat-a' && toolName === 'approval.resolve',
      onChanged: (event) => automaticEvents.push(event),
    });
    await expect(automatic.request({
      chatId: 'chat-a',
      toolCallId: 'tool-policy',
      kind: 'resource-create',
      exactArgs: { name: 'Cache' },
      summary: 'Create cache',
      risk: 'medium',
      safeDetails: { name: 'Cache' },
      execute: async () => ({ ok: true }),
    })).resolves.toEqual({ ok: true });
    expect(automaticEvents).toEqual([
      expect.objectContaining({
        type: 'resolved',
        decision: 'approve',
        approval: expect.objectContaining({
          decisionSource: 'policy',
        }),
      }),
    ]);

    const events: unknown[] = [];
    const reviewed = new ApprovalCoordinator({
      createId: () => 'approval-reviewer',
      now: () => new Date(),
      policy: () => ({
        mode: 'ai-review',
        reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
      }),
      reviewer: {
        review: async () => ({ decision: 'reject', reason: 'Scope is too broad.' }),
      },
      onChanged: (event) => events.push(event),
    });
    await expect(reviewed.request({
      chatId: 'chat-a',
      toolCallId: 'tool-reviewer',
      kind: 'resource-data-write',
      exactArgs: { secret: 'must-never-leak' },
      summary: 'Write records',
      risk: 'high',
      safeDetails: { secret: '[redacted]' },
      execute: async () => ({ ok: true }),
    })).rejects.toThrow('Scope is too broad');
    expect(JSON.stringify(events)).not.toContain('must-never-leak');
    expect(events).toEqual([
      expect.objectContaining({
        type: 'resolved',
        decision: 'reject',
        approval: expect.objectContaining({
          decisionSource: 'reviewer',
          reviewerReason: 'Scope is too broad.',
        }),
      }),
    ]);
  });

  test('makes reviewer failure manually actionable only in the owning chat', async () => {
    const events: unknown[] = [];
    const coordinator = new ApprovalCoordinator({
      createId: () => 'approval-fallback',
      now: () => new Date(),
      policy: () => ({
        mode: 'ai-review',
        reviewerModel: { provider: 'provider-a', modelId: 'retired-model' },
      }),
      reviewer: { review: async () => { throw new Error('Reviewer unavailable'); } },
      onChanged: (event) => events.push(event),
    });
    const result = coordinator.request({
      chatId: 'chat-owner',
      toolCallId: 'tool-fallback',
      kind: 'resource-update',
      exactArgs: { resourceId: 'resource-a' },
      summary: 'Update resource',
      risk: 'medium',
      safeDetails: { resourceId: 'resource-a' },
      execute: async () => 'executed',
    });
    await waitForApproval();
    await waitForApproval();

    expect(coordinator.list('chat-owner')).toEqual([
      expect.objectContaining({ id: 'approval-fallback', policyMode: 'ai-review' }),
    ]);
    expect(coordinator.list('chat-sibling')).toEqual([]);
    await expect(coordinator.resolve('chat-sibling', 'approval-fallback', 'approve'))
      .rejects.toThrow('not found');
    await coordinator.resolve('chat-owner', 'approval-fallback', 'approve');
    await expect(result).resolves.toBe('executed');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'created',
      reason: 'reviewer-unavailable',
    }));
  });

  test('isolates chat policies and captures each policy when the request is created', async () => {
    const policies = new Map([
      ['chat-a', { mode: 'manual' } as const],
      ['chat-b', { mode: 'always-approve' } as const],
    ]);
    let nextId = 0;
    let executions = 0;
    const coordinator = new ApprovalCoordinator({
      createId: () => `approval-${++nextId}`,
      now: () => new Date('2026-08-16T12:00:00.000Z'),
      policy: (chatId) => policies.get(chatId) ?? { mode: 'manual' },
    });
    const request = (chatId: string) => coordinator.request({
      chatId,
      toolCallId: `tool-${chatId}-${nextId + 1}`,
      kind: 'resource-create' as const,
      exactArgs: { chatId },
      summary: `Create for ${chatId}`,
      risk: 'medium' as const,
      safeDetails: { chatId },
      execute: async () => { executions += 1; },
    });

    const capturedManual = request('chat-a');
    policies.set('chat-a', { mode: 'always-approve' });
    const futureAutomatic = request('chat-a');
    const siblingAutomatic = request('chat-b');
    await expect(Promise.all([futureAutomatic, siblingAutomatic])).resolves.toEqual([undefined, undefined]);
    expect(executions).toBe(2);
    expect(coordinator.list('chat-a')).toEqual([
      expect.objectContaining({ id: 'approval-1', policyMode: 'manual' }),
    ]);
    expect(coordinator.list('chat-b')).toEqual([]);

    await coordinator.resolve('chat-a', 'approval-1', 'approve');
    await expect(capturedManual).resolves.toBeUndefined();
    expect(executions).toBe(3);
  });

  test('cancellation wins while automatic approval authorization is pending', async () => {
    let releaseAuthorization!: (allowed: boolean) => void;
    let executions = 0;
    const authorization = new Promise<boolean>((resolve) => {
      releaseAuthorization = resolve;
    });
    const controller = new AbortController();
    const coordinator = new ApprovalCoordinator({
      createId: () => 'approval-cancel',
      now: () => new Date(),
      policy: () => ({ mode: 'always-approve' }),
      authorize: () => authorization,
    });
    const result = coordinator.request({
      chatId: 'chat-a',
      toolCallId: 'tool-cancel',
      kind: 'resource-delete',
      exactArgs: { id: 'resource-a' },
      summary: 'Delete resource',
      risk: 'high',
      safeDetails: { id: 'resource-a' },
      signal: controller.signal,
      execute: async () => { executions += 1; },
    });
    await waitForApproval();
    controller.abort();
    releaseAuthorization(true);

    await expect(result).rejects.toThrow('canceled');
    expect(executions).toBe(0);
  });
});
