import { describe, expect, test } from 'bun:test';
import { apiInvokeFunction } from './api.invoke-function';
import { functionContract, ZDirectFunctionResult, ZInvokeFunctionInput } from './contract';
import type { IFunctionInvocationApiCapability, TFunctionApiContext } from './types';

const success = Object.freeze({
  status: 'succeeded' as const,
  output: { count: 1 },
  diagnostics: { code: null, message: null, logByteSize: 0, truncated: false },
});

const request = Object.freeze({
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
  widgetKey: 'counter',
  catalogGeneration: 2,
  functionName: 'count',
  input: { amount: 1 },
});

describe('direct function API contract', () => {
  test('exposes only one bounded synchronous invoke operation', () => {
    expect(ZInvokeFunctionInput.parse(request)).toEqual(request);
    for (const legacy of [
      { invocationId: 'invocation-a' },
      { widgetRevisionId: 'revision-a' },
      { idempotencyKey: 'key-a' },
      { retry: true },
      { waitUntilMs: 100 },
    ]) {
      expect(ZInvokeFunctionInput.safeParse({ ...request, ...legacy }).success).toBe(false);
    }
    expect(ZInvokeFunctionInput.safeParse({ ...request, input: { text: 'x'.repeat(1_048_577) } }).success)
      .toBe(false);
    expect(ZDirectFunctionResult.parse(success)).toEqual(success);
    expect(functionContract.invoke['~orpc'].inputSchema).toBeDefined();
    expect(Object.keys(functionContract)).toEqual(['invoke']);
  });

  test('forwards the request and live cancellation through the narrow capability', async () => {
    const calls: Array<Readonly<{ input: unknown; signal: AbortSignal | undefined }>> = [];
    const capability: IFunctionInvocationApiCapability = {
      invokeFunction: async (input, signal) => {
        calls.push({ input, signal });
        return success;
      },
    };
    const context: TFunctionApiContext = { functionInvocation: capability };
    const invoke = apiInvokeFunction.callable({ context });
    await expect(invoke(request)).resolves.toEqual(success);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toEqual(request);
  });

  test('maps direct-call failures to stable path-free errors', async () => {
    const cases = [
      ['FUNCTION_INPUT_SCHEMA_INVALID', 'BAD_REQUEST'],
      ['WIDGET_INSTANCE_NOT_FOUND', 'NOT_FOUND'],
      ['FUNCTION_NOT_FOUND', 'NOT_FOUND'],
      ['RESOURCE_EXHAUSTED', 'TOO_MANY_REQUESTS'],
      ['FUNCTION_RUNTIME_UNAVAILABLE', 'SERVICE_UNAVAILABLE'],
      ['UNEXPECTED_INTERNAL_FAILURE', 'INTERNAL_SERVER_ERROR'],
    ] as const;
    for (const [domainCode, apiCode] of cases) {
      const secret = '/private/widgets/counter/server-dist/main.artifact';
      const context: TFunctionApiContext = {
        functionInvocation: {
          invokeFunction: async () => {
            throw Object.assign(new Error(secret), { code: domainCode, path: secret });
          },
        },
      };
      const invoke = apiInvokeFunction.callable({ context });
      try {
        await invoke(request);
        throw new Error('Expected direct function rejection.');
      } catch (error) {
        expect(error).toMatchObject({ code: apiCode });
        expect(JSON.stringify(error)).not.toContain(secret);
      }
    }
  });
});
