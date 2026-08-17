import { describe, expect, test } from 'bun:test';
import { createContext, runInContext } from 'node:vm';
import {
  ResourceError,
  type IResourceGateway,
  type TResourceCall,
} from '#backend/shell/resources';
import {
  fnDecodePortableResourceResponse,
  fnEncodePortableResourceDbExecute,
  fnEncodePortableResourceDbRows,
  fnEncodePortableResourceRequest,
  fnEncodePortableResourceResult,
  type TPortableResourceFailureCode,
  type TWidgetServerFunctionDescriptor,
} from '@omnidraw/sdk/contract';
import type { TDirectFunctionCall } from '../types';
import { DirectInvocationResourceGateway, fnRoutePortableResourceCall } from './DirectInvocationResourceGateway';
import { EphemeralResourceWritePermitAuthority } from './EphemeralResourceWritePermitAuthority';
import {
  fnDecodeFunctionWorkerResourceOutput,
  fnMaterializeFunctionWorkerError,
  fnMaterializeFunctionWorkerResourceOutput,
} from './function-worker';

const descriptor: TWidgetServerFunctionDescriptor = Object.freeze({
  schemaVersion: 1,
  exportName: 'mutate',
  effect: 'tx',
  inputSchema: Object.freeze({ type: 'object' }),
  outputSchema: Object.freeze({ type: 'object' }),
  resources: Object.freeze([
    Object.freeze({ slot: 'store', effect: 'read_write' as const }),
  ]),
  limits: Object.freeze({
    timeoutMs: 1_000,
    memoryTier: 'small' as const,
    outputByteLimit: 1_024,
    logByteLimit: 1_024,
  }),
});

const directCall: TDirectFunctionCall = Object.freeze({
  id: 'invocation-a',
  subject: Object.freeze({
    canvasId: 'canvas-a',
    elementId: 'element-a',
    widgetInstanceId: 'instance-a',
  }),
  definition: Object.freeze({
    widgetKey: 'widget-a',
    catalogGeneration: 3,
    serverModule: Object.freeze({
      format: 'omnidraw.widget-server-module.v1',
      abi: 'omnidraw.widget-server-abi.v1',
      moduleDigestSha256: 'a'.repeat(64),
      functionDescriptors: Object.freeze([descriptor]),
      functionDescriptorsDigestSha256: 'b'.repeat(64),
    }),
    descriptor,
  }),
  input: Object.freeze({}),
  deadlineAtMs: 100,
});

function failureCode(
  response: Awaited<ReturnType<typeof fnRoutePortableResourceCall>>,
): TPortableResourceFailureCode {
  const decoded = fnDecodePortableResourceResponse(response);
  if (!('failure' in decoded)) throw new Error('Expected a portable resource failure.');
  return decoded.failure.code;
}

function permits(): EphemeralResourceWritePermitAuthority {
  return new EphemeralResourceWritePermitAuthority({
    secret: new Uint8Array(32).fill(4),
    nowMs: () => 10,
    createId: () => 'permit-a',
    createNonce: () => 'nonce-a',
  });
}

describe('portable direct resource bridge', () => {
  test('keeps binding identity and write authority behind the canonical wire envelope', async () => {
    const hostCalls: TResourceCall[] = [];
    const writePermits = permits();
    const gateway = new DirectInvocationResourceGateway({
      call: directCall,
      bindings: {
        resolveBinding: async () => ({
          slot: 'store',
          resourceId: 'resource-private',
          kind: 'kv',
          allowRead: true,
          allowWrite: true,
        }),
      },
      gateway: {
        call: async (call) => {
          hostCalls.push(call);
          return { output: { value: call.input, revision: 1 } };
        },
      },
      writePermits,
      nowMs: () => 10,
    });
    const request = fnEncodePortableResourceRequest({
      correlationId: 'invocation-a:0',
      slot: 'store',
      operation: 'set',
      effect: 'write',
      input: { key: 'counter', value: 2 },
    });

    const response = await fnRoutePortableResourceCall(gateway, request);
    const decoded = fnDecodePortableResourceResponse(response);

    expect(decoded).toMatchObject({
      correlationId: 'invocation-a:0',
      output: { value: { key: 'counter', value: 2 }, revision: 1 },
    });
    expect(hostCalls).toHaveLength(1);
    expect(hostCalls[0]).toMatchObject({
      slot: 'store',
      kind: 'kv',
      operation: 'set',
      effect: 'write',
      operationId: 'invocation-a:0',
    });
    expect((hostCalls[0] as Extract<TResourceCall, { effect: 'write' }>).writeCapability)
      .toEqual(expect.any(String));
    expect(JSON.stringify({ request, response })).not.toContain('resource-private');
    expect(JSON.stringify({ request, response })).not.toContain('permit-a');
    expect(writePermits.activePermitCount()).toBe(0);
  });

  test('rejects malformed and authority-bearing request shapes before the host gateway', async () => {
    let calls = 0;
    const gateway: IResourceGateway = {
      call: async () => {
        calls += 1;
        return { output: null };
      },
    };
    const request = fnEncodePortableResourceRequest({
      correlationId: 'malformed:0',
      slot: 'store',
      operation: 'get',
      effect: 'read',
      input: { key: 'counter' },
    });
    const response = await fnRoutePortableResourceCall(gateway, {
      ...request,
      resourceId: 'guest-selected-resource',
    });
    const overLimit = await fnRoutePortableResourceCall(gateway, {
      ...request,
      correlationId: 'malformed:limit',
      input: { type: 'string', value: 'x'.repeat(1_048_577) },
    });

    expect(failureCode(response)).toBe('RESOURCE_MALFORMED_INPUT');
    expect(failureCode(overLimit)).toBe('RESOURCE_LIMIT_EXCEEDED');
    expect(calls).toBe(0);
    expect(JSON.stringify(response)).not.toContain('guest-selected-resource');
  });

  test('fingerprints bigint and byte database parameters through their canonical tags', async () => {
    let calls = 0;
    const gateway = new DirectInvocationResourceGateway({
      call: directCall,
      bindings: {
        resolveBinding: async () => ({
          slot: 'store', resourceId: 'database-a', kind: 'db',
          allowRead: true, allowWrite: true,
        }),
      },
      gateway: {
        call: async () => {
          calls += 1;
          return {
            output: fnEncodePortableResourceDbExecute({
              rowsAffected: 1,
              lastInsertId: 9n,
            }),
          };
        },
      },
      writePermits: permits(),
      nowMs: () => 10,
    });
    const response = await fnRoutePortableResourceCall(
      gateway,
      fnEncodePortableResourceRequest({
        correlationId: 'database-write:0',
        slot: 'store',
        operation: 'execute',
        effect: 'write',
        input: {
          sql: 'INSERT INTO records(value) VALUES (:value)',
          parameters: { value: 9n, payload: new Uint8Array([1, 2, 3]) },
        },
      }),
    );

    expect(fnDecodePortableResourceResponse(response)).toMatchObject({
      correlationId: 'database-write:0',
    });
    expect(calls).toBe(1);
  });

  test('enforces the fixed operation registry before issuing authority', async () => {
    let calls = 0;
    const gateway = new DirectInvocationResourceGateway({
      call: directCall,
      bindings: {
        resolveBinding: async () => ({
          slot: 'store', resourceId: 'resource-a', kind: 'kv',
          allowRead: true, allowWrite: true,
        }),
      },
      gateway: {
        call: async () => {
          calls += 1;
          return { output: null };
        },
      },
      writePermits: permits(),
      nowMs: () => 10,
    });
    const route = (operation: string, effect: 'read' | 'write', input: unknown) => (
      fnRoutePortableResourceCall(gateway, fnEncodePortableResourceRequest({
        correlationId: `registry:${operation}`,
        slot: 'store',
        operation,
        effect,
        input,
      }))
    );

    expect(failureCode(await route('unknown', 'read', {})))
      .toBe('RESOURCE_OPERATION_UNKNOWN');
    expect(failureCode(await route('set', 'read', { key: 'a', value: 1 })))
      .toBe('RESOURCE_EFFECT_DENIED');
    expect(failureCode(await route('set', 'write', { key: 'a' })))
      .toBe('RESOURCE_MALFORMED_INPUT');
    expect(failureCode(await fnRoutePortableResourceCall(
      gateway,
      fnEncodePortableResourceRequest({
        correlationId: 'registry:undeclared',
        slot: 'other',
        operation: 'get',
        effect: 'read',
        input: { key: 'a' },
      }),
    ))).toBe('RESOURCE_SLOT_UNDECLARED');
    expect(calls).toBe(0);
  });

  test('maps cancellation, conflict, and unclear writes without leaking or retrying', async () => {
    let ambiguousCalls = 0;
    const cancelled = await fnRoutePortableResourceCall({
      call: async () => {
        throw new ResourceError('RESOURCE_CALL_CANCELLED', 'private cancellation detail');
      },
    }, fnEncodePortableResourceRequest({
      correlationId: 'cancelled:0', slot: 'store', operation: 'get', effect: 'read', input: {},
    }));
    const conflict = await fnRoutePortableResourceCall({
      call: async () => {
        throw new ResourceError('KV_ENTRY_CONFLICT', 'private conflict detail');
      },
    }, fnEncodePortableResourceRequest({
      correlationId: 'conflict:0', slot: 'store', operation: 'set', effect: 'write', input: {},
    }));
    const ambiguous = await fnRoutePortableResourceCall({
      call: async () => {
        ambiguousCalls += 1;
        throw new Error('driver failed after dispatch at /private/resource.db');
      },
    }, fnEncodePortableResourceRequest({
      correlationId: 'ambiguous:0', slot: 'store', operation: 'set', effect: 'write', input: {},
    }));

    expect(failureCode(cancelled)).toBe('RESOURCE_CANCELLED');
    expect(failureCode(conflict)).toBe('RESOURCE_CONFLICT');
    expect(failureCode(ambiguous)).toBe('RESOURCE_WRITE_OUTCOME_AMBIGUOUS');
    expect(ambiguousCalls).toBe(1);
    expect(JSON.stringify({ cancelled, conflict, ambiguous })).not.toContain('private');
  });

  test('maps an expired host deadline without dispatching a write', async () => {
    let calls = 0;
    const gateway = new DirectInvocationResourceGateway({
      call: directCall,
      bindings: {
        resolveBinding: async () => ({
          slot: 'store', resourceId: 'resource-a', kind: 'kv',
          allowRead: true, allowWrite: true,
        }),
      },
      gateway: {
        call: async () => {
          calls += 1;
          return { output: { value: 1, revision: 1 } };
        },
      },
      writePermits: permits(),
      nowMs: () => directCall.deadlineAtMs,
    });
    const response = await fnRoutePortableResourceCall(
      gateway,
      fnEncodePortableResourceRequest({
        correlationId: 'expired:0',
        slot: 'store',
        operation: 'set',
        effect: 'write',
        input: { key: 'a', value: 1 },
      }),
    );

    expect(failureCode(response)).toBe('RESOURCE_TIMEOUT');
    expect(calls).toBe(0);
  });

  test('decodes deterministic database rows back to ordinary worker values', () => {
    const rows = fnEncodePortableResourceDbRows({
      columns: ['value', 'value'],
      rows: [[1n, new Uint8Array([1, 2, 3])]],
    });
    const generic = fnEncodePortableResourceResult({
      correlationId: 'database:0',
      output: rows,
    });
    const decoded = fnDecodePortableResourceResponse(generic);
    if (!('output' in decoded)) throw new Error('Expected a resource result.');

    expect(fnDecodeFunctionWorkerResourceOutput('query', decoded.output)).toEqual({
      columns: ['value', 'value'],
      rows: [[1n, new Uint8Array([1, 2, 3])]],
    });

    const guestContext = createContext(Object.create(null));
    Object.defineProperty(guestContext, 'value', {
      configurable: true,
      value: fnMaterializeFunctionWorkerResourceOutput(
        guestContext,
        'query',
        decoded.output,
      ),
    });
    expect(runInContext(`Object.freeze({
      rowsArray: value.rows instanceof Array,
      rowArray: value.rows[0] instanceof Array,
      bytes: value.rows[0][1] instanceof Uint8Array,
      objectPrototype: Object.getPrototypeOf(value) === null,
    })`, guestContext)).toEqual({
      rowsArray: true,
      rowArray: true,
      bytes: true,
      objectPrototype: true,
    });

    Object.defineProperty(guestContext, 'failure', {
      configurable: true,
      value: fnMaterializeFunctionWorkerError(
        guestContext,
        'Portable resource failed.',
        'RESOURCE_PROVIDER_FAILED',
      ),
    });
    expect(runInContext(`Object.freeze({
      error: failure instanceof Error,
      message: failure.message,
      code: failure.code,
    })`, guestContext)).toEqual({
      error: true,
      message: 'Portable resource failed.',
      code: 'RESOURCE_PROVIDER_FAILED',
    });
  });
});
