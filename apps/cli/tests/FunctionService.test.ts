import { describe, expect, test } from 'bun:test';
import type { Database } from '@tursodatabase/database';
import type {
  IFunctionControlStore,
  TInvocationRecord,
} from '@vibecanvas/function-runtime';
import type { LocalFunctionDispatcher } from '@vibecanvas/function-runtime/local';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { FunctionService } from '../src/services/FunctionService';
import { FunctionServicePool } from '../src/services/FunctionServicePool';

const TENANT: TTenantContext = Object.freeze({
  orgId: '00000000-0000-4000-8000-000000000001',
  accountId: '00000000-0000-4000-8000-000000000002',
  cellId: '00000000-0000-4000-8000-000000000003',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'request-a',
  canvasId: '00000000-0000-4000-8000-000000000004',
});

const WS_TENANT: TTenantContext = Object.freeze({
  orgId: TENANT.orgId,
  accountId: TENANT.accountId,
  cellId: TENANT.cellId,
  placementEpoch: TENANT.placementEpoch,
  roles: TENANT.roles,
  capabilities: TENANT.capabilities,
  requestId: 'request-without-canvas',
});

const OUTSIDER_TENANT: TTenantContext = Object.freeze({
  ...WS_TENANT,
  accountId: '00000000-0000-4000-8000-000000000099',
  requestId: 'request-outsider',
});

const OTHER_MEMBER_TENANT: TTenantContext = Object.freeze({
  ...WS_TENANT,
  accountId: '00000000-0000-4000-8000-000000000098',
  requestId: 'request-other-member',
});

function record(
  status: TInvocationRecord['status'] = 'queued',
  invocationTenant: TTenantContext = TENANT,
): TInvocationRecord {
  return {
    envelope: {
      id: '00000000-0000-4000-8000-000000000010',
      tenant: invocationTenant,
      widgetDefinitionId: '00000000-0000-4000-8000-000000000020',
      widgetRevisionId: '00000000-0000-4000-8000-000000000021',
      widgetInstanceId: '00000000-0000-4000-8000-000000000022',
      functionId: 'fn:definition:run',
      functionName: 'run',
      definitionRevision: 1,
      artifactDigestSha256: 'a'.repeat(64),
      contractDigestSha256: 'b'.repeat(64),
      runtimeAbi: 'vibecanvas.bun.v1',
      input: { value: 1 },
      inputDigestSha256: 'c'.repeat(64),
      idempotencyKey: 'request-key',
      policyVersion: 1,
      priority: 0,
      limits: {
        timeoutMs: 1_000,
        memoryTier: 'small',
        outputByteLimit: 1_024,
        logByteLimit: 1_024,
      },
      retry: { mode: 'none', maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
      createdAtMs: 10,
      deadlineAtMs: 1_010,
    },
    status,
    output: null,
    failure: null,
    resultDigestSha256: null,
    outputByteSize: 0,
    logByteSize: 0,
    bodyState: 'full',
    retainsRevision: true,
    cancelRequestedAtMs: null,
    availableAtMs: 10,
    startedAtMs: null,
    finishedAtMs: null,
    bodiesCompactedAtMs: null,
  };
}

function databaseForTarget(options: Readonly<{
  target?: Partial<{
    canvas_id: string;
    definition_id: string;
    revision_id: string;
    status: string;
  }> | null;
  memberAccountIds?: readonly string[];
  projectionCurrent?: boolean;
}> = {}): Database {
  const row = {
    canvas_id: TENANT.canvasId!,
    definition_id: record().envelope.widgetDefinitionId,
    revision_id: record().envelope.widgetRevisionId,
    status: 'active',
    ...options.target,
  };
  const memberAccountIds = options.memberAccountIds ?? [TENANT.accountId];
  return {
    prepare: (sql: string) => ({
      get: async (...values: unknown[]) => {
        if (sql.includes('FROM widget_instances')) {
          const [accountId, orgId, widgetInstanceId] = values;
          if (
            options.target === null
            || (
              options.projectionCurrent === false
              && sql.includes('widget_instance_projection_heads')
            )
            || orgId !== TENANT.orgId
            || widgetInstanceId !== record().envelope.widgetInstanceId
            || !memberAccountIds.includes(String(accountId))
          ) {
            return undefined;
          }
          return row;
        }
        if (sql.includes('FROM canvas_members')) {
          const [orgId, canvasId, accountId] = values;
          return orgId === TENANT.orgId
            && canvasId === row.canvas_id
            && memberAccountIds.includes(String(accountId))
            ? { present: 1 }
            : undefined;
        }
        throw new Error(`Unexpected FunctionService query: ${sql}`);
      },
    }),
  } as unknown as Database;
}

function createService(args: Readonly<{
  database?: Database;
  invoke?: LocalFunctionDispatcher['invoke'];
  invocation?: TInvocationRecord;
  getInvocation?: IFunctionControlStore['getInvocation'];
  cancellation?: IFunctionControlStore['requestCancellation'];
  idempotencyTtlMs?: number;
  nowMs?: () => number;
}> = {}) {
  const calls: unknown[] = [];
  const cancellationCalls: unknown[] = [];
  const invocation = args.invocation ?? record();
  const dispatcher = {
    start: () => undefined,
    stop: async () => undefined,
    invoke: args.invoke ?? (async (_tenant: TTenantContext, request: unknown) => {
      calls.push(request);
      return { status: 'created' as const, invocation };
    }),
  } as unknown as LocalFunctionDispatcher;
  const store = {
    getInvocation: args.getInvocation ?? (async () => invocation),
    requestCancellation: async (tenant: TTenantContext, request: unknown) => {
      cancellationCalls.push({ tenant, request });
      return args.cancellation
        ? args.cancellation(tenant, request as never)
        : {
            status: 'cancelled' as const,
            invocation: { ...invocation, status: 'cancelled' as const, finishedAtMs: 20 },
          };
    },
  } as unknown as IFunctionControlStore;
  const service = new FunctionService({
    placement: TENANT,
    database: args.database ?? databaseForTarget(),
    store,
    dispatcher,
    idempotencyTtlMs: args.idempotencyTtlMs,
    nowMs: args.nowMs,
  });
  service.start({ hooks: {}, config: {} });
  return { calls, cancellationCalls, service };
}

describe('FunctionService host authority', () => {
  test('bootstraps its trusted placement on startup and again after restart without a request', async () => {
    let createCalls = 0;
    let startCalls = 0;
    let stopCalls = 0;
    const pool = new FunctionServicePool({
      bootstrapTenants: [TENANT],
      create: async () => {
        createCalls += 1;
        return {
          start: async () => { startCalls += 1; },
          stop: async () => { stopCalls += 1; },
        } as unknown as FunctionService;
      },
    });

    await pool.start({ hooks: {}, config: {} });
    expect({ createCalls, startCalls, tenantCount: pool.getTenantCount() }).toEqual({
      createCalls: 1,
      startCalls: 1,
      tenantCount: 1,
    });
    await pool.stop();
    expect(stopCalls).toBe(1);
    await pool.start({ hooks: {}, config: {} });
    expect({ createCalls, startCalls, tenantCount: pool.getTenantCount() }).toEqual({
      createCalls: 2,
      startCalls: 2,
      tenantCount: 1,
    });
    await pool.stop();
    expect(stopCalls).toBe(2);
  });

  test('retires a stale placement before its replacement function dispatcher starts', async () => {
    const events: string[] = [];
    const pool = new FunctionServicePool({
      create: async (placement) => ({
        placementEpoch: placement.placementEpoch,
        start: async () => { events.push(`start:${placement.placementEpoch}`); },
        stop: async () => { events.push(`stop:${placement.placementEpoch}`); },
      } as unknown as FunctionService),
    });
    const replacement = {
      ...TENANT,
      cellId: 'replacement-cell',
      placementEpoch: TENANT.placementEpoch + 1,
      requestId: 'replacement-request',
    };

    await pool.start({ hooks: {}, config: {} });
    await expect(pool.forTenant(TENANT)).resolves.toMatchObject({ placementEpoch: 1 });
    await expect(pool.forTenant(replacement)).resolves.toMatchObject({ placementEpoch: 2 });

    expect(events).toEqual(['start:1', 'stop:1', 'start:2']);
    expect(pool.getTenantCount()).toBe(1);
    await expect(pool.forTenant(TENANT)).rejects.toThrow(
      'rejected stale organization placement epoch 1; current epoch is 2',
    );
    await pool.stop();
    expect(events).toEqual(['start:1', 'stop:1', 'start:2', 'stop:2']);
  });

  test('drains an old-placement API operation before replacement startup', async () => {
    const events: string[] = [];
    let oldOperationEntryCount = 0;
    let markOldOperationEntered: (() => void) | undefined;
    const oldOperationEntered = new Promise<void>((resolve) => {
      markOldOperationEntered = resolve;
    });
    let releaseOldOperation: (() => void) | undefined;
    const oldOperationBlocked = new Promise<void>((resolve) => {
      releaseOldOperation = resolve;
    });
    const pool = new FunctionServicePool({
      create: async (placement) => ({
        start: async () => { events.push(`start:${placement.placementEpoch}`); },
        stop: async () => { events.push(`stop:${placement.placementEpoch}`); },
        getFunctionInvocation: async (_tenant: TTenantContext, invocationId: string) => {
          events.push(`operation:start:${placement.placementEpoch}:${invocationId}`);
          if (placement.placementEpoch === 1) {
            oldOperationEntryCount += 1;
            if (oldOperationEntryCount === 2) markOldOperationEntered?.();
            await oldOperationBlocked;
          }
          events.push(`operation:end:${placement.placementEpoch}:${invocationId}`);
          return null;
        },
      } as unknown as FunctionService),
    });
    const replacement = {
      ...TENANT,
      cellId: 'replacement-cell',
      placementEpoch: TENANT.placementEpoch + 1,
      requestId: 'replacement-request',
    };

    await pool.start({ hooks: {}, config: {} });
    const firstOldOperation = pool.getFunctionInvocation(TENANT, 'old-invocation-a');
    const secondOldOperation = pool.getFunctionInvocation(TENANT, 'old-invocation-b');
    await oldOperationEntered;
    const replacementOperation = pool.getFunctionInvocation(replacement, 'new-invocation');

    expect(events).toEqual([
      'start:1',
      'operation:start:1:old-invocation-a',
      'operation:start:1:old-invocation-b',
    ]);
    releaseOldOperation?.();
    await expect(firstOldOperation).resolves.toBeNull();
    await expect(secondOldOperation).resolves.toBeNull();
    await expect(replacementOperation).resolves.toBeNull();
    expect(events).toEqual([
      'start:1',
      'operation:start:1:old-invocation-a',
      'operation:start:1:old-invocation-b',
      'operation:end:1:old-invocation-a',
      'operation:end:1:old-invocation-b',
      'stop:1',
      'start:2',
      'operation:start:2:new-invocation',
      'operation:end:2:new-invocation',
    ]);
    await pool.stop();
  });

  test('derives definition and revision through membership when WebSocket tenant has no canvas', async () => {
    const { calls, service } = createService({
      idempotencyTtlMs: 60_000,
      nowMs: () => 500,
    });
    await expect(service.invokeFunction(WS_TENANT, {
      widgetInstanceId: record().envelope.widgetInstanceId,
      functionName: 'run',
      input: { value: 1 },
      idempotencyKey: 'request-key',
    })).resolves.toMatchObject({
      widgetRevisionId: record().envelope.widgetRevisionId,
      widgetInstanceId: record().envelope.widgetInstanceId,
      status: 'queued',
    });
    expect(calls).toEqual([expect.objectContaining({
      widgetDefinitionId: record().envelope.widgetDefinitionId,
      widgetRevisionId: record().envelope.widgetRevisionId,
      idempotencyScope: {
        kind: 'widget_instance',
        widgetInstanceId: record().envelope.widgetInstanceId,
      },
      idempotencyExpiresAtMs: 60_500,
    })]);
    await service.stop();
  });

  test('hides unauthorized, context-mismatched, and inactive targets behind stable codes', async () => {
    const unauthorized = createService();
    await expect(unauthorized.service.invokeFunction(OUTSIDER_TENANT, {
      widgetInstanceId: record().envelope.widgetInstanceId,
      functionName: 'run', input: {}, idempotencyKey: 'key',
    })).rejects.toMatchObject({ code: 'WIDGET_INSTANCE_NOT_FOUND' });
    expect(unauthorized.calls).toHaveLength(0);
    await unauthorized.service.stop();

    const mismatched = createService({
      database: databaseForTarget({
        target: { canvas_id: '00000000-0000-4000-8000-000000000098' },
      }),
    });
    await expect(mismatched.service.invokeFunction(TENANT, {
      widgetInstanceId: record().envelope.widgetInstanceId,
      functionName: 'run', input: {}, idempotencyKey: 'key',
    })).rejects.toMatchObject({ code: 'WIDGET_INSTANCE_NOT_FOUND' });
    expect(mismatched.calls).toHaveLength(0);
    await mismatched.service.stop();

    const inactive = createService({
      database: databaseForTarget({ target: { status: 'archived' } }),
    }).service;
    await expect(inactive.invokeFunction(TENANT, {
      widgetInstanceId: record().envelope.widgetInstanceId,
      functionName: 'run', input: {}, idempotencyKey: 'key',
    })).rejects.toMatchObject({ code: 'WIDGET_INSTANCE_ARCHIVED' });
    await inactive.stop();

    const delayedProjection = createService({
      database: databaseForTarget({ projectionCurrent: false }),
    });
    await expect(delayedProjection.service.invokeFunction(TENANT, {
      widgetInstanceId: record().envelope.widgetInstanceId,
      functionName: 'run', input: {}, idempotencyKey: 'key',
    })).rejects.toMatchObject({ code: 'WIDGET_INSTANCE_NOT_FOUND' });
    expect(delayedProjection.calls).toHaveLength(0);
    await delayedProjection.service.stop();

    const conflict = createService({
      invoke: async () => ({
        status: 'conflict',
        invocationId: record().envelope.id,
        reason: 'fingerprint_mismatch',
      }),
    }).service;
    await expect(conflict.invokeFunction(TENANT, {
      widgetInstanceId: record().envelope.widgetInstanceId,
      functionName: 'run', input: {}, idempotencyKey: 'key',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await conflict.stop();
  });

  test('maps a projection race at durable invocation creation to the stable target code', async () => {
    const raced = createService({
      invoke: async () => {
        throw Object.assign(new Error('durable projection moved'), {
          code: 'FUNCTION_WIDGET_INSTANCE_NOT_FOUND',
        });
      },
    }).service;

    await expect(raced.invokeFunction(TENANT, {
      widgetInstanceId: record().envelope.widgetInstanceId,
      functionName: 'run',
      input: {},
      idempotencyKey: 'projection-race',
    })).rejects.toMatchObject({
      code: 'WIDGET_INSTANCE_NOT_FOUND',
      message: 'Widget instance was not found.',
    });
    await raced.stop();
  });

  test('maps durable get and cancellation records to the public view', async () => {
    const { cancellationCalls, service } = createService();
    await expect(service.getFunctionInvocation(WS_TENANT, record().envelope.id)).resolves.toMatchObject({
      id: record().envelope.id,
      status: 'queued',
    });
    await expect(service.cancelFunctionInvocation(WS_TENANT, record().envelope.id)).resolves.toMatchObject({
      id: record().envelope.id,
      status: 'cancelled',
      finishedAtMs: 20,
    });
    expect(cancellationCalls).toHaveLength(1);
    await service.stop();
  });

  test('returns not found and does not cancel outside persisted canvas authority', async () => {
    const unauthorized = createService();
    await expect(unauthorized.service.getFunctionInvocation(
      OUTSIDER_TENANT,
      record().envelope.id,
    )).resolves.toBeNull();
    await expect(unauthorized.service.cancelFunctionInvocation(
      OUTSIDER_TENANT,
      record().envelope.id,
    )).resolves.toBeNull();
    expect(unauthorized.cancellationCalls).toHaveLength(0);
    await unauthorized.service.stop();

    const otherMember = createService({
      database: databaseForTarget({
        memberAccountIds: [TENANT.accountId, OTHER_MEMBER_TENANT.accountId],
      }),
    });
    await expect(otherMember.service.getFunctionInvocation(
      OTHER_MEMBER_TENANT,
      record().envelope.id,
    )).resolves.toBeNull();
    await expect(otherMember.service.cancelFunctionInvocation(
      OTHER_MEMBER_TENANT,
      record().envelope.id,
    )).resolves.toBeNull();
    expect(otherMember.cancellationCalls).toHaveLength(0);
    await otherMember.service.stop();

    const mismatchedTenant: TTenantContext = Object.freeze({
      ...TENANT,
      canvasId: '00000000-0000-4000-8000-000000000098',
    });
    const mismatched = createService();
    await expect(mismatched.service.getFunctionInvocation(
      mismatchedTenant,
      record().envelope.id,
    )).resolves.toBeNull();
    await expect(mismatched.service.cancelFunctionInvocation(
      mismatchedTenant,
      record().envelope.id,
    )).resolves.toBeNull();
    expect(mismatched.cancellationCalls).toHaveLength(0);
    await mismatched.service.stop();

    const missingCanvas = createService({ invocation: record('queued', WS_TENANT) });
    await expect(missingCanvas.service.getFunctionInvocation(
      TENANT,
      record().envelope.id,
    )).resolves.toBeNull();
    await expect(missingCanvas.service.cancelFunctionInvocation(
      TENANT,
      record().envelope.id,
    )).resolves.toBeNull();
    expect(missingCanvas.cancellationCalls).toHaveLength(0);
    await missingCanvas.service.stop();
  });
});
