import { describe, expect, test } from 'bun:test';
import { ApprovalCoordinator, ApprovalRejectedError } from '../src/approval/ApprovalCoordinator';

async function waitForApproval() {
  await Promise.resolve();
}

describe('process-local approvals', () => {
  test('executes the immutable server-side arguments exactly once after approval', async () => {
    const executed: unknown[] = [];
    const coordinator = new ApprovalCoordinator({ createId: () => 'approval-1' });
    const input = { resourceId: 'kv-1', operation: { kind: 'kv', operation: 'set', key: 'theme', value: 'dark' } };
    const toolResult = coordinator.request({
      chatId: 'chat-a',
      toolCallId: 'tool-call-1',
      kind: 'resource-data-write',
      authorization: { accountId: 'user-a' },
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
    await waitForApproval();

    expect(coordinator.list('chat-a')).toHaveLength(1);
    await expect(coordinator.resolve('chat-a', 'approval-1', 'approve', { accountId: 'user-a' })).resolves.toEqual({ resolved: true, decision: 'approve' });
    await expect(toolResult).resolves.toEqual({ ok: true });
    expect(executed).toEqual([{ resourceId: 'kv-1', operation: { kind: 'kv', operation: 'set', key: 'theme', value: 'dark' } }]);
    await expect(coordinator.resolve('chat-a', 'approval-1', 'approve', { accountId: 'user-a' })).rejects.toThrow('not found');
  });

  test('rejects, times out, aborts, and disconnects without executing', async () => {
    let id = 0;
    let executions = 0;
    const coordinator = new ApprovalCoordinator({ createId: () => `approval-${++id}`, timeoutMs: 10 });
    const request = (signal?: AbortSignal) => coordinator.request({
      chatId: 'chat-a',
      toolCallId: `tool-call-${id + 1}`,
      kind: 'resource-delete',
      authorization: {},
      exactArgs: { resourceId: 'kv-1' },
      summary: 'Delete resource',
      risk: 'high',
      safeDetails: { resourceId: 'kv-1' },
      signal,
      execute: async () => { executions += 1; },
    });

    const rejected = request();
    await coordinator.resolve('chat-a', 'approval-1', 'reject', {});
    await expect(rejected).rejects.toBeInstanceOf(ApprovalRejectedError);

    const controller = new AbortController();
    const aborted = request(controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow('canceled');

    const disconnected = request();
    expect(coordinator.cancelChat('chat-a')).toBe(1);
    await expect(disconnected).rejects.toThrow('disconnected');

    const timedOut = request();
    await expect(timedOut).rejects.toThrow('timed out');
    expect(executions).toBe(0);
  });

  test('rechecks authorization at approval time and never exposes secret values in the view', async () => {
    let allow = true;
    const coordinator = new ApprovalCoordinator({
      createId: () => 'approval-secret',
      authorize: () => allow,
    });
    const result = coordinator.request({
      chatId: 'chat-a',
      toolCallId: 'tool-call-secret',
      kind: 'resource-data-write',
      authorization: { accountId: 'user-a' },
      exactArgs: { resourceId: 'secret-1', operation: { kind: 'secretStore', operation: 'set', key: 'TOKEN', value: 'plaintext' } },
      summary: 'Rotate one secret',
      risk: 'high',
      safeDetails: { resourceId: 'secret-1', operation: 'set', key: 'TOKEN', value: '[redacted]' },
      execute: async () => ({ ok: true }),
    });
    expect(JSON.stringify(coordinator.get('chat-a', 'approval-secret'))).not.toContain('plaintext');
    const observedResult = result.then(
      () => null,
      (error: unknown) => error,
    );
    allow = false;
    await expect(coordinator.resolve('chat-a', 'approval-secret', 'approve', { accountId: 'user-a' })).rejects.toThrow('Not authorized');
    expect(await observedResult).toBeInstanceOf(ApprovalRejectedError);
  });

  test('fails closed when authorization throws and does not cancel an already claimed execution', async () => {
    const failed = new ApprovalCoordinator({
      createId: () => 'approval-auth-error',
      authorize: () => { throw new Error('authorization backend unavailable'); },
    });
    const failedResult = failed.request({
      chatId: 'chat-a',
      toolCallId: 'tool-call-auth-error',
      kind: 'resource-create',
      authorization: {},
      exactArgs: { kind: 'kv', name: 'Cache' },
      summary: 'Create cache',
      risk: 'medium',
      safeDetails: { kind: 'kv', name: 'Cache' },
      execute: async () => ({ ok: true }),
    });
    const observedFailure = failedResult.then(
      () => null,
      (error: unknown) => error,
    );
    await expect(failed.resolve('chat-a', 'approval-auth-error', 'approve', {})).rejects.toThrow('authorization backend unavailable');
    const authorizationFailure = await observedFailure;
    expect(authorizationFailure).toBeInstanceOf(ApprovalRejectedError);
    expect((authorizationFailure as Error).message).toContain('Authorization could not be rechecked');
    expect(failed.list('chat-a')).toEqual([]);

    let releaseExecution: (() => void) | undefined;
    const executing = new ApprovalCoordinator({ createId: () => 'approval-executing' });
    const result = executing.request({
      chatId: 'chat-a',
      toolCallId: 'tool-call-executing',
      kind: 'resource-delete',
      authorization: {},
      exactArgs: { resourceId: 'kv-1' },
      summary: 'Delete cache',
      risk: 'high',
      safeDetails: { resourceId: 'kv-1' },
      execute: () => new Promise<{ ok: true }>((resolve) => { releaseExecution = () => resolve({ ok: true }); }),
    });
    const resolution = executing.resolve('chat-a', 'approval-executing', 'approve', {});
    await waitForApproval();
    expect(executing.cancelChat('chat-a')).toBe(0);
    releaseExecution?.();
    await expect(resolution).resolves.toEqual({ resolved: true, decision: 'approve' });
    await expect(result).resolves.toEqual({ ok: true });
  });

  test('starts empty after restart because approval state is process-local', async () => {
    const first = new ApprovalCoordinator({ createId: () => 'approval-1' });
    const pending = first.request({
      chatId: 'chat-a',
      toolCallId: 'tool-call-restart',
      kind: 'resource-create',
      authorization: {},
      exactArgs: { kind: 'kv', name: 'Preferences' },
      summary: 'Create resource',
      risk: 'medium',
      safeDetails: { kind: 'kv', name: 'Preferences' },
      execute: async () => ({ ok: true }),
    });
    const restarted = new ApprovalCoordinator();
    expect(restarted.list('chat-a')).toEqual([]);
    first.close();
    await expect(pending).rejects.toThrow('stopped');
  });
});
