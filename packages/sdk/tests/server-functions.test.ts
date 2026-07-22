import { afterEach, describe, expect, test } from 'bun:test';
import {
  __setServerFunctionTransport,
  createServerFunctionProxy,
  type IServerFunctionClientTransport,
  type TServerFunctionClientRequest,
} from '../src/widget';
import {
  collectServerFunctionDescriptors,
  defineServerFunction,
  type TServerFunctionContext,
  type TServerFunctionRuntimeSchema,
} from '../src/server';

function runtimeSchema<TValue>(
  parse: (value: unknown) => TValue,
  jsonSchema: Readonly<Record<string, unknown>>,
): TServerFunctionRuntimeSchema<TValue> & Readonly<{ toJSONSchema(): unknown }> {
  return Object.freeze({ parse, toJSONSchema: () => jsonSchema });
}

const inputSchema = runtimeSchema((value) => {
  if (
    value === null
    || typeof value !== 'object'
    || !('text' in value)
    || typeof value.text !== 'string'
    || value.text.length === 0
  ) throw new TypeError('text is required');
  return { text: value.text };
}, {
  type: 'object',
  properties: { text: { type: 'string', minLength: 1 } },
  required: ['text'],
  additionalProperties: false,
});

const outputSchema = runtimeSchema((value) => {
  if (
    value === null
    || typeof value !== 'object'
    || !('length' in value)
    || !Number.isInteger(value.length)
  ) throw new TypeError('length is required');
  return { length: value.length as number };
}, {
  type: 'object',
  properties: { length: { type: 'integer' } },
  required: ['length'],
  additionalProperties: false,
});

const context: TServerFunctionContext<'fn', Record<never, never>> = {
  identity: { orgId: 'org-a', accountId: 'account-a', roles: ['member'] },
  invocationId: 'invocation-a',
  widgetRevisionId: 'revision-a',
  widgetInstanceId: 'instance-a',
  attemptId: 'attempt-a',
  leaseEpoch: 1,
  deadlineAtMs: 10_000,
  signal: new AbortController().signal,
  resources: {},
  log: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
  metrics: { increment: () => undefined },
};

afterEach(() => __setServerFunctionTransport(null));

describe('@vibecanvas/sdk/server', () => {
  test('emits canonical descriptors and validates input and output at execution', async () => {
    const count = defineServerFunction({
      effect: 'fn',
      input: inputSchema,
      output: outputSchema,
      limits: { timeoutMs: 2_000 },
    }, async (serverContext, input) => {
      // @ts-expect-error fn functions intentionally expose no resource read API.
      void serverContext.resources.read;
      return { length: input.text.length };
    });

    const descriptors = collectServerFunctionDescriptors({ count });
    expect(descriptors).toMatchObject([{
      schemaVersion: 1,
      exportName: 'count',
      effect: 'fn',
      resources: [],
      limits: { timeoutMs: 2_000, memoryTier: 'small' },
      retry: { mode: 'none', maxAttempts: 1 },
    }]);
    await expect(count.__vibecanvasExecute(context, { text: 'hello' }))
      .resolves.toEqual({ length: 5 });
    await expect(count.__vibecanvasExecute(context, { text: '' })).rejects.toThrow('text');

    const invalidOutput = defineServerFunction({
      effect: 'fn',
      input: inputSchema,
      output: outputSchema,
    }, () => ({ invalid: true }) as never);
    await expect(invalidOutput.__vibecanvasExecute(context, { text: 'hello' }))
      .rejects.toThrow('length');
    await expect(count({ text: 'hello' })).rejects.toThrow('generated widget client proxy');
  });

  test('enforces fn/fx/tx ceilings and rejects durable-continuation configuration', () => {
    expect(() => defineServerFunction({
      effect: 'fn',
      input: inputSchema,
      output: outputSchema,
      resources: { notes: 'read' },
    } as never, async () => ({ length: 1 }))).toThrow('fn functions cannot declare resources');

    expect(() => defineServerFunction({
      effect: 'fx',
      input: inputSchema,
      output: outputSchema,
      resources: { notes: 'write' },
    } as never, async () => ({ length: 1 }))).toThrow('fx functions may declare only read');

    expect(() => defineServerFunction({
      effect: 'fn',
      input: inputSchema,
      output: outputSchema,
      wait: { untilMs: 100 },
    } as never, async () => ({ length: 1 }))).toThrow("unsupported field 'wait'");
    expect(() => defineServerFunction({
      effect: 'fn',
      input: inputSchema,
      output: outputSchema,
      schedule: 'daily',
    } as never, async () => ({ length: 1 }))).toThrow("unsupported field 'schedule'");
    expect(() => defineServerFunction({
      effect: 'fn',
      input: inputSchema,
      output: outputSchema,
      durableContinuation: true,
    } as never, async () => ({ length: 1 }))).toThrow("unsupported field 'durableContinuation'");
    expect(() => collectServerFunctionDescriptors({ count: () => 1 }))
      .toThrow("export 'count' is not a defined server function");
  });
});

describe('generated widget server-function proxy', () => {
  test('passes one stable idempotency key through transport retries', async () => {
    const attempts: TServerFunctionClientRequest[] = [];
    let keyCount = 0;
    const transport: IServerFunctionClientTransport = {
      createIdempotencyKey: () => {
        keyCount += 1;
        return `key-${keyCount}`;
      },
      invoke: async <TOutput>(request: TServerFunctionClientRequest) => {
        attempts.push(request, { ...request });
        return { length: String((request.input as { text: string }).text).length } as TOutput;
      },
    };
    __setServerFunctionTransport(transport);
    const count = createServerFunctionProxy<{ text: string }, { length: number }>('count');

    await expect(count({ text: 'hello' })).resolves.toEqual({ length: 5 });
    expect(keyCount).toBe(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.idempotencyKey).toBe('key-1');
    expect(attempts[1]?.idempotencyKey).toBe('key-1');
    expect(attempts[0]).toMatchObject({ functionName: 'count', input: { text: 'hello' } });
  });

  test('fails closed without a host transport or with an invalid host key', async () => {
    const count = createServerFunctionProxy<{}, {}>('count');
    await expect(count({})).rejects.toThrow('transport is not connected');
    __setServerFunctionTransport({
      createIdempotencyKey: () => '',
      invoke: async () => ({}),
    });
    await expect(count({})).rejects.toThrow('invalid idempotency key');
    expect(() => createServerFunctionProxy('not a function name')).toThrow('name is invalid');
  });
});
