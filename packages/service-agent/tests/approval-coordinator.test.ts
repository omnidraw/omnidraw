import { describe, expect, test } from 'bun:test';
import { ApprovalCoordinator, ApprovalRejectedError } from '../src/approval/ApprovalCoordinator';
import type { TApprovalPolicy } from '../src/approval/types';

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
    await expect(coordinator.resolve('chat-a', 'approval-1', 'approve', { accountId: 'user-a' })).resolves.toEqual({ resolved: true, decision: 'approve', decisionSource: 'user' });
    await expect(toolResult).resolves.toEqual({ ok: true });
    expect(executed).toEqual([{ resourceId: 'kv-1', operation: { kind: 'kv', operation: 'set', key: 'theme', value: 'dark' } }]);
    await expect(coordinator.resolve('chat-a', 'approval-1', 'approve', { accountId: 'user-a' })).rejects.toThrow('not found');
  });

  test('manual review has no wall-clock expiry and rejects explicit lifecycle retirement', async () => {
    let id = 0;
    let executions = 0;
    let nowMs = 0;
    const coordinator = new ApprovalCoordinator({
      createId: () => `approval-${++id}`,
      now: () => new Date(nowMs),
    });
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

    const unexpired = request();
    nowMs += 365 * 24 * 60 * 60 * 1_000;
    expect(coordinator.list('chat-a').map((approval) => approval.id))
      .toEqual(['approval-4']);
    coordinator.close();
    await expect(unexpired).rejects.toThrow('stopped');
    expect(executions).toBe(0);
  });

  test('always approve and independent reviewer decisions use guarded provenance paths', async () => {
    const events: unknown[] = [];
    const automatic = new ApprovalCoordinator({
      createId: () => 'approval-policy',
      policy: () => ({ mode: 'always-approve' }),
      authorize: () => true,
      onChanged: (event) => events.push(event),
    });
    await expect(automatic.request({
      chatId: 'chat-a',
      toolCallId: 'tool-policy',
      kind: 'resource-create',
      authorization: {},
      exactArgs: { name: 'Cache' },
      summary: 'Create cache',
      risk: 'medium',
      safeDetails: { name: 'Cache' },
      execute: async () => ({ ok: true }),
    })).resolves.toEqual({ ok: true });
    expect(events).toEqual([expect.objectContaining({
      type: 'resolved',
      decision: 'approve',
      approval: expect.objectContaining({
        policyMode: 'always-approve',
        decisionSource: 'policy',
      }),
    })]);

    let reviewedInput: unknown;
    const reviewerEvents: unknown[] = [];
    const reviewed = new ApprovalCoordinator({
      createId: () => 'approval-reviewer',
      policy: () => ({
        mode: 'ai-review',
        reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
      }),
      reviewer: {
        review: async (input) => {
          reviewedInput = input;
          return { decision: 'reject', reason: 'Scope is too broad.' };
        },
      },
      onChanged: (event) => reviewerEvents.push(event),
    });
    await expect(reviewed.request({
      chatId: 'chat-a',
      toolCallId: 'tool-reviewer',
      kind: 'resource-data-write',
      authorization: {},
      exactArgs: { secret: 'must-never-leak' },
      summary: 'Write records',
      risk: 'high',
      warnings: ['Broad write'],
      safeDetails: { secret: '[redacted]' },
      execute: async () => ({ ok: true }),
    })).rejects.toThrow('Scope is too broad');
    expect(JSON.stringify(reviewedInput)).not.toContain('must-never-leak');
    expect(reviewerEvents).toEqual([expect.objectContaining({
      type: 'resolved',
      decision: 'reject',
      approval: expect.objectContaining({
        decisionSource: 'reviewer',
        reviewerReason: 'Scope is too broad.',
      }),
    })]);
  });

  test('cancels automatic approval while authorization is still pending', async () => {
    let releaseAuthorization!: (authorized: boolean) => void;
    let executions = 0;
    const authorization = new Promise<boolean>((resolve) => {
      releaseAuthorization = resolve;
    });
    const controller = new AbortController();
    const coordinator = new ApprovalCoordinator({
      createId: () => 'approval-cancel-automatic',
      policy: () => ({ mode: 'always-approve' }),
      authorize: () => authorization,
    });
    const result = coordinator.request({
      chatId: 'chat-a',
      toolCallId: 'tool-cancel-automatic',
      kind: 'resource-delete',
      authorization: {},
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
    await waitForApproval();
    expect(executions).toBe(0);
  });

  test('reviewer failure falls back to an unexpired manual request', async () => {
    const coordinator = new ApprovalCoordinator({
      createId: () => 'approval-fallback',
      policy: () => ({
        mode: 'ai-review',
        reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
      }),
      reviewer: { review: async () => { throw new Error('malformed'); } },
    });
    const result = coordinator.request({
      chatId: 'chat-a',
      toolCallId: 'tool-fallback',
      kind: 'resource-delete',
      authorization: {},
      exactArgs: { id: 'resource-a' },
      summary: 'Delete cache',
      risk: 'high',
      safeDetails: { id: 'resource-a' },
      execute: async () => ({ ok: true }),
    });
    await waitForApproval();
    await waitForApproval();
    expect(coordinator.get('chat-a', 'approval-fallback')).toEqual(
      expect.objectContaining({ policyMode: 'ai-review' }),
    );
    await coordinator.resolve('chat-a', 'approval-fallback', 'reject', {});
    await expect(result).rejects.toBeInstanceOf(ApprovalRejectedError);
  });

  test('captures policy at creation and applies a changed mode only to future requests', async () => {
    let id = 0;
    let policy: TApprovalPolicy = { mode: 'manual' };
    const coordinator = new ApprovalCoordinator({
      createId: () => `approval-capture-${++id}`,
      policy: () => policy,
    });
    const manual = coordinator.request({
      chatId: 'chat-a',
      toolCallId: 'tool-manual',
      kind: 'resource-create',
      authorization: {},
      exactArgs: { name: 'manual' },
      summary: 'Create manually reviewed resource',
      risk: 'medium',
      safeDetails: { name: 'manual' },
      execute: async () => 'manual-executed',
    });
    policy = { mode: 'always-approve' };
    await expect(coordinator.request({
      chatId: 'chat-a',
      toolCallId: 'tool-automatic',
      kind: 'resource-create',
      authorization: {},
      exactArgs: { name: 'automatic' },
      summary: 'Create automatically reviewed resource',
      risk: 'medium',
      safeDetails: { name: 'automatic' },
      execute: async () => 'automatic-executed',
    })).resolves.toBe('automatic-executed');
    expect(coordinator.list('chat-a')).toEqual([
      expect.objectContaining({
        id: 'approval-capture-1',
        policyMode: 'manual',
      }),
    ]);
    await coordinator.resolve('chat-a', 'approval-capture-1', 'reject', {});
    await expect(manual).rejects.toBeInstanceOf(ApprovalRejectedError);
  });

  test('fails guarded automatic approval on authorization or execution errors', async () => {
    let executions = 0;
    const unauthorized = new ApprovalCoordinator({
      createId: () => 'approval-auto-auth',
      policy: () => ({ mode: 'always-approve' }),
      authorize: () => false,
    });
    await expect(unauthorized.request({
      chatId: 'chat-a',
      toolCallId: 'tool-auth',
      kind: 'resource-delete',
      authorization: {},
      exactArgs: { id: 'resource-a' },
      summary: 'Delete resource',
      risk: 'high',
      safeDetails: { id: 'resource-a' },
      execute: async () => { executions += 1; },
    })).rejects.toThrow('Authorization changed');
    expect(executions).toBe(0);

    const executionFailure = new ApprovalCoordinator({
      createId: () => 'approval-auto-execution',
      policy: () => ({ mode: 'always-approve' }),
    });
    await expect(executionFailure.request({
      chatId: 'chat-a',
      toolCallId: 'tool-execution',
      kind: 'resource-data-write',
      authorization: {},
      exactArgs: { id: 'resource-a' },
      summary: 'Write resource',
      risk: 'high',
      safeDetails: { id: 'resource-a' },
      execute: async () => { throw new Error('write failed'); },
    })).rejects.toThrow('write failed');
  });

  test('accepts a valid reviewer approval and falls back to manual on malformed output', async () => {
    const events: unknown[] = [];
    const approved = new ApprovalCoordinator({
      createId: () => 'approval-review-approved',
      policy: () => ({
        mode: 'ai-review',
        reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
      }),
      reviewer: {
        review: async () => ({ decision: 'approve', reason: 'Bounded operation.' }),
      },
      onChanged: (event) => events.push(event),
    });
    await expect(approved.request({
      chatId: 'chat-a',
      toolCallId: 'tool-review-approved',
      kind: 'resource-create',
      authorization: {},
      exactArgs: { name: 'Cache' },
      summary: 'Create cache',
      risk: 'medium',
      safeDetails: { name: 'Cache' },
      execute: async () => ({ ok: true }),
    })).resolves.toEqual({ ok: true });
    expect(events).toEqual([expect.objectContaining({
      type: 'resolved',
      decision: 'approve',
      approval: expect.objectContaining({
        decisionSource: 'reviewer',
        reviewerReason: 'Bounded operation.',
      }),
    })]);

    const malformed = new ApprovalCoordinator({
      createId: () => 'approval-review-malformed',
      policy: () => ({
        mode: 'ai-review',
        reviewerModel: { provider: 'provider-a', modelId: 'model-a' },
      }),
      reviewer: {
        review: async () => ({
          decision: 'approve',
          reason: 'Looks safe.',
          hidden: 'unexpected',
        } as never),
      },
    });
    const pending = malformed.request({
      chatId: 'chat-a',
      toolCallId: 'tool-review-malformed',
      kind: 'resource-create',
      authorization: {},
      exactArgs: { name: 'Cache' },
      summary: 'Create cache',
      risk: 'medium',
      safeDetails: { name: 'Cache' },
      execute: async () => ({ ok: true }),
    });
    await waitForApproval();
    await waitForApproval();
    expect(malformed.list('chat-a')).toEqual([
      expect.objectContaining({ id: 'approval-review-malformed' }),
    ]);
    await malformed.resolve('chat-a', 'approval-review-malformed', 'reject', {});
    await expect(pending).rejects.toBeInstanceOf(ApprovalRejectedError);
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
    await expect(resolution).resolves.toEqual({ resolved: true, decision: 'approve', decisionSource: 'user' });
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
