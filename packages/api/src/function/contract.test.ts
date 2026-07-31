import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@omnidraw/tenant-core';
import { router } from '../router';
import {
  functionContract,
  ZFunctionInvocationIdentity,
  ZFunctionInvocationView,
  ZInvokeFunctionInput,
} from './contract';
import type {
  IFunctionInvocationApiCapability,
  TFunctionApiContext,
  TFunctionInvocationView,
} from './types';

const tenant: TTenantContext = Object.freeze({
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-a',
});

const queued: TFunctionInvocationView = Object.freeze({
  id: 'invocation-a',
  functionName: 'count',
  widgetRevisionId: 'revision-a',
  widgetInstanceId: 'instance-a',
  status: 'queued',
  output: null,
  failure: null,
  createdAtMs: 1,
  startedAtMs: null,
  finishedAtMs: null,
});

describe('function API contract', () => {
  test('accepts only bounded invoke/get/cancel authority-free inputs', () => {
    const input = {
      widgetInstanceId: 'instance-a',
      widgetRevisionId: 'revision-a',
      functionName: 'count',
      input: { text: 'hello' },
      idempotencyKey: 'key-a',
    };
    expect(ZInvokeFunctionInput.parse(input)).toEqual(input);
    expect(ZInvokeFunctionInput.safeParse({
      ...input,
      widgetRevisionId: '',
    }).success).toBe(false);
    expect(ZInvokeFunctionInput.safeParse({
      ...input,
      functionId: 'caller-selected-function',
    }).success).toBe(false);
    expect(ZInvokeFunctionInput.safeParse({
      ...input,
      artifactDigestSha256: 'a'.repeat(64),
    }).success).toBe(false);
    expect(ZInvokeFunctionInput.safeParse({
      ...input,
      canvasId: 'caller-selected-canvas',
    }).success).toBe(false);
    expect(ZFunctionInvocationIdentity.safeParse({
      invocationId: 'invocation-a',
      canvasId: 'caller-selected-canvas',
    }).success).toBe(false);
    expect(ZInvokeFunctionInput.safeParse({ ...input, waitUntilMs: 100 }).success).toBe(false);
    expect(ZInvokeFunctionInput.safeParse({ ...input, schedule: 'daily' }).success).toBe(false);
    expect(ZInvokeFunctionInput.safeParse({ ...input, durableContinuation: true }).success).toBe(false);
    expect(ZInvokeFunctionInput.safeParse({
      ...input,
      input: { text: 'x'.repeat(1_048_577) },
    }).success).toBe(false);
    expect(ZInvokeFunctionInput.safeParse({
      ...input,
      input: { text: '😀'.repeat(300_000) },
    }).success).toBe(false);
    expect(functionContract.invoke['~orpc'].inputSchema).toBeDefined();
    expect(ZFunctionInvocationView.parse(queued)).toEqual(queued);
  });

  test('forwards the server-derived tenant and stable idempotency key through a narrow capability', async () => {
    const calls: Array<Readonly<{ tenant: TTenantContext; input: unknown }>> = [];
    const capability: IFunctionInvocationApiCapability = {
      invokeFunction: async (receivedTenant, input) => {
        calls.push({ tenant: receivedTenant, input });
        return queued;
      },
      getFunctionInvocation: async () => queued,
      cancelFunctionInvocation: async () => ({ ...queued, status: 'cancelled', finishedAtMs: 2 }),
    };
    const context: TFunctionApiContext = { tenant, functionInvocation: capability };
    const invoke = router.api.function.invoke.callable({ context });
    const get = router.api.function.get.callable({ context });
    const cancel = router.api.function.cancel.callable({ context });
    const request = {
      widgetInstanceId: 'instance-a',
      widgetRevisionId: 'revision-a',
      functionName: 'count',
      input: { text: 'hello' },
      idempotencyKey: 'stable-key-a',
    };

    await expect(invoke(request)).resolves.toEqual(queued);
    await expect(get({ invocationId: 'invocation-a' })).resolves.toEqual(queued);
    await expect(cancel({ invocationId: 'invocation-a' })).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(calls).toEqual([{ tenant, input: request }]);
    expect(calls[0]?.tenant).toBe(tenant);
  });

  test('maps tenant-scoped missing or unauthorized get/cancel results to NOT_FOUND', async () => {
    const context: TFunctionApiContext = {
      tenant,
      functionInvocation: {
        invokeFunction: async () => queued,
        getFunctionInvocation: async () => null,
        cancelFunctionInvocation: async () => null,
      },
    };
    const get = router.api.function.get.callable({ context });
    const cancel = router.api.function.cancel.callable({ context });
    await expect(get({ invocationId: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(cancel({ invocationId: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('maps domain failures to stable sanitized API errors', async () => {
    const sentinel = '/organizations/org-a/resources/secret/data.db';
    const cases = [
      ['FUNCTION_INPUT_SCHEMA_INVALID', 'BAD_REQUEST'],
      ['WIDGET_INSTANCE_NOT_FOUND', 'NOT_FOUND'],
      ['WIDGET_INSTANCE_FOREIGN', 'NOT_FOUND'],
      ['FUNCTION_NOT_FOUND', 'NOT_FOUND'],
      ['IDEMPOTENCY_CONFLICT', 'CONFLICT'],
      ['FUNCTION_RUNTIME_UNAVAILABLE', 'SERVICE_UNAVAILABLE'],
      ['FUNCTION_CANCELLATION_CONFLICT', 'CONFLICT'],
      ['UNEXPECTED_INTERNAL_FAILURE', 'INTERNAL_SERVER_ERROR'],
    ] as const;
    for (const [domainCode, apiCode] of cases) {
      const context: TFunctionApiContext = {
        tenant,
        functionInvocation: {
          invokeFunction: async () => {
            throw Object.assign(new Error(sentinel), { code: domainCode, path: sentinel });
          },
          getFunctionInvocation: async () => null,
          cancelFunctionInvocation: async () => null,
        },
      };
      const invoke = router.api.function.invoke.callable({ context });
      try {
        await invoke({
          widgetInstanceId: 'instance-a',
          widgetRevisionId: 'revision-a',
          functionName: 'count',
          input: {},
          idempotencyKey: 'key-a',
        });
        throw new Error('Expected invocation rejection.');
      } catch (error) {
        expect(error).toMatchObject({ code: apiCode });
        expect(JSON.stringify(error)).not.toContain(sentinel);
      }
    }
  });
});
