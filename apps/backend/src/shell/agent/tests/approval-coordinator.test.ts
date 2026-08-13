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
    const automatic = new ApprovalCoordinator({
      createId: () => 'approval-policy',
      now: () => new Date(),
      policy: () => ({ mode: 'always-approve' }),
      authorize: ({ chatId, toolName }) => chatId === 'chat-a' && toolName === 'approval.resolve',
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
