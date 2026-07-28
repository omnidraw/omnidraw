import { describe, expect, test } from 'bun:test'
import { router } from '../packages/api/src/router'
import type {
  IFunctionInvocationApiCapability,
  TFunctionInvocationView,
} from '../packages/api/src/function/types'
import {
  MANAGED_TENANT,
  createManagedCompositionFixture,
} from './fixtures/external-composition/src/managed-composition'

type TManagedFixture = ReturnType<typeof createManagedCompositionFixture>
type TManagedDispatcher = TManagedFixture['services']['dispatcher']
type TManagedDispatchResult = Awaited<ReturnType<TManagedDispatcher['invoke']>>
type TManagedInvocationRecord = Extract<
  TManagedDispatchResult,
  Readonly<{ status: 'created' | 'replayed' }>
>['invocation']

const MANAGED_FUNCTION_TARGET = Object.freeze({
  widgetDefinitionId: 'managed-definition',
  widgetRevisionId: 'managed-revision',
  canvasId: 'managed-canvas',
})

function invocationView(record: TManagedInvocationRecord): TFunctionInvocationView {
  if (record.envelope.subject.kind !== 'widget_instance') {
    throw new Error('The public function API exposes widget-instance invocations only.')
  }
  return Object.freeze({
    id: record.envelope.id,
    functionName: record.envelope.functionName,
    widgetRevisionId: record.envelope.widgetRevisionId,
    widgetInstanceId: record.envelope.subject.widgetInstanceId,
    status: record.status,
    output: record.output,
    failure: record.failure,
    createdAtMs: record.envelope.createdAtMs,
    startedAtMs: record.startedAtMs,
    finishedAtMs: record.finishedAtMs,
  })
}

function createManagedFunctionApiAdapter(
  dispatcher: TManagedDispatcher,
): IFunctionInvocationApiCapability {
  const views = new Map<string, TFunctionInvocationView>()
  const adapter: IFunctionInvocationApiCapability = {
    async invokeFunction(tenant, request) {
      const result = await dispatcher.invoke(tenant, {
        widgetDefinitionId: MANAGED_FUNCTION_TARGET.widgetDefinitionId,
        widgetRevisionId: request.widgetRevisionId,
        subject: {
          kind: 'widget_instance',
          canvasId: MANAGED_FUNCTION_TARGET.canvasId,
          widgetInstanceId: request.widgetInstanceId,
        },
        functionName: request.functionName,
        input: request.input,
        idempotencyKey: request.idempotencyKey,
      })
      if (result.status === 'conflict') {
        throw Object.assign(new Error('Managed dispatcher rejected the idempotency key.'), {
          code: 'IDEMPOTENCY_CONFLICT',
        })
      }
      const view = invocationView(result.invocation)
      views.set(view.id, view)
      return view
    },
    async getFunctionInvocation(_tenant, invocationId) {
      return views.get(invocationId) ?? null
    },
    async cancelFunctionInvocation(_tenant, invocationId) {
      const current = views.get(invocationId)
      if (!current) return null
      const cancelled: TFunctionInvocationView = Object.freeze({
        ...current,
        status: 'cancelled',
        finishedAtMs: 2,
      })
      views.set(invocationId, cancelled)
      return cancelled
    },
  }
  return Object.freeze(adapter)
}

describe('external managed composition through unchanged OSS API handlers', () => {
  test('routes function invoke, get, and cancel through the external dispatcher adapter', async () => {
    const fixture = createManagedCompositionFixture()
    await fixture.runtime.boot()
    try {
      const context = {
        tenant: MANAGED_TENANT,
        functionInvocation: createManagedFunctionApiAdapter(fixture.services.dispatcher),
      }
      const invoke = router.api.function.invoke.callable({ context })
      const get = router.api.function.get.callable({ context })
      const cancel = router.api.function.cancel.callable({ context })
      const request = {
        widgetInstanceId: 'managed-instance',
        widgetRevisionId: MANAGED_FUNCTION_TARGET.widgetRevisionId,
        functionName: 'run',
        input: { value: 7 },
        idempotencyKey: 'managed-api-key',
      }

      const created = await invoke(request)
      expect(created).toEqual({
        id: 'managed-invocation:managed-api-key',
        functionName: 'run',
        widgetRevisionId: MANAGED_FUNCTION_TARGET.widgetRevisionId,
        widgetInstanceId: 'managed-instance',
        status: 'queued',
        output: null,
        failure: null,
        createdAtMs: 1,
        startedAtMs: null,
        finishedAtMs: null,
      })
      await expect(invoke(request)).resolves.toEqual(created)
      await expect(get({ invocationId: created.id })).resolves.toEqual(created)
      await expect(cancel({ invocationId: created.id })).resolves.toMatchObject({
        id: created.id,
        status: 'cancelled',
        finishedAtMs: 2,
      })

      expect(fixture.dispatchEvidence).toHaveLength(2)
      expect(fixture.dispatchEvidence[0]?.tenant).toBe(MANAGED_TENANT)
      expect(fixture.dispatchEvidence[0]?.request).toEqual({
        widgetDefinitionId: MANAGED_FUNCTION_TARGET.widgetDefinitionId,
        widgetRevisionId: MANAGED_FUNCTION_TARGET.widgetRevisionId,
        subject: {
          kind: 'widget_instance',
          canvasId: MANAGED_FUNCTION_TARGET.canvasId,
          widgetInstanceId: 'managed-instance',
        },
        functionName: 'run',
        input: { value: 7 },
        idempotencyKey: 'managed-api-key',
      })
    } finally {
      await fixture.runtime.shutdown()
    }
  })

  test('preserves the unchanged handler error mapping for managed idempotency conflicts', async () => {
    const fixture = createManagedCompositionFixture()
    await fixture.runtime.boot()
    try {
      const context = {
        tenant: MANAGED_TENANT,
        functionInvocation: createManagedFunctionApiAdapter(fixture.services.dispatcher),
      }
      const invoke = router.api.function.invoke.callable({ context })
      const request = {
        widgetInstanceId: 'managed-instance',
        widgetRevisionId: MANAGED_FUNCTION_TARGET.widgetRevisionId,
        functionName: 'run',
        input: { value: 7 },
        idempotencyKey: 'managed-conflict-key',
      }

      await expect(invoke(request)).resolves.toMatchObject({ status: 'queued' })
      await expect(invoke({ ...request, input: { value: 8 } })).rejects.toMatchObject({
        code: 'CONFLICT',
      })
      expect(fixture.dispatchEvidence).toHaveLength(2)
    } finally {
      await fixture.runtime.shutdown()
    }
  })
})
