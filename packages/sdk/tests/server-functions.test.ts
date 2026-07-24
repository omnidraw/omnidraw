import { afterEach, describe, expect, test } from 'bun:test';
import {
  collectServerFunctionDescriptors,
  defineServerFunction,
  type TServerFunctionContext,
  type TServerFunctionRuntimeSchema,
} from '../src/server';
import {
  capsuleGuestMock,
  loadWidgetSdk,
} from './capsule-guest.mock';

const { createServerFunctionProxy } = await loadWidgetSdk();
const selector = Object.freeze({
  id: 'vibecanvas.widget.functions',
  versionRange: '^1.0.0',
  contractHash: `sha256:${'a'.repeat(64)}` as const,
});

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
  subject: {
    kind: 'widget_instance',
    canvasId: 'canvas-a',
    widgetInstanceId: 'instance-a',
  },
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

afterEach(() => {
  capsuleGuestMock.reset();
});

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
    const instanceIdentity = defineServerFunction({
      effect: 'fn',
      input: inputSchema,
      output: outputSchema,
    }, async (serverContext) => ({
      length: serverContext.subject.widgetInstanceId.length,
    }));
    await expect(instanceIdentity.__vibecanvasExecute(context, { text: 'hello' }))
      .resolves.toEqual({ length: 'instance-a'.length });
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
  test('calls the exact revision-scoped Capsule operation with raw function input', async () => {
    const attempts: unknown[][] = [];
    capsuleGuestMock.callCapabilityAsync = async (...args) => {
      attempts.push(args);
      return { length: String((args[2] as { text: string }).text).length };
    };
    const count = createServerFunctionProxy<{ text: string }, { length: number }>(
      'count',
      selector,
    );

    await expect(count({ text: 'hello' })).resolves.toEqual({ length: 5 });
    expect(attempts).toEqual([[
      selector,
      'count',
      { text: 'hello' },
      {},
    ]]);
  });

  test('forwards timeout and cancellation to Capsule', async () => {
    let receivedOptions: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> | undefined;
    capsuleGuestMock.callCapabilityAsync = async (_selector, _operation, _input, options) => {
      receivedOptions = options;
      return await new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    };
    const count = createServerFunctionProxy<{}, {}>('count', selector);
    const controller = new AbortController();
    const pending = count({}, { signal: controller.signal, timeoutMs: 250 });

    expect(receivedOptions?.timeoutMs).toBe(250);
    expect(receivedOptions?.signal).toBe(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  test('rejects invalid operation names before entering Capsule', () => {
    expect(() => createServerFunctionProxy('not a function name', selector))
      .toThrow('name is invalid');
  });
});
