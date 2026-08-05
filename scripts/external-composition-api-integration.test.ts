import { describe, expect, test } from 'bun:test'
import { apiInvokeFunction } from '../packages/api/src/function/api.invoke-function'
import type { IFunctionInvocationApiCapability } from '../packages/api/src/function/types'
import {
  createManagedCompositionFixture,
} from './fixtures/external-composition/src/managed-composition'

type TManagedFixture = ReturnType<typeof createManagedCompositionFixture>

const definition = Object.freeze({
  widgetKey: 'managed-widget',
  catalogGeneration: 9,
  runtimeAbi: 'omnidraw.function.v1',
  artifactDigestSha256: 'a'.repeat(64),
  descriptor: Object.freeze({
    schemaVersion: 1 as const,
    exportName: 'readSettings',
    modulePath: 'server/main.ts',
    effect: 'fx' as const,
    inputSchema: {},
    outputSchema: {},
    resources: Object.freeze([{ slot: 'settings', effect: 'read' as const }]),
    limits: Object.freeze({
      timeoutMs: 1_000,
      memoryTier: 'small' as const,
      outputByteLimit: 1_024,
      logByteLimit: 1_024,
    }),
  }),
})

function createManagedFunctionApiAdapter(
  fixture: TManagedFixture,
): IFunctionInvocationApiCapability {
  return Object.freeze({
    invokeFunction: (
      request: Parameters<IFunctionInvocationApiCapability['invokeFunction']>[0],
      signal?: AbortSignal,
    ) => fixture.services.functions.invoke({
      subject: {
        canvasId: request.canvasId,
        elementId: request.elementId,
        widgetInstanceId: request.widgetInstanceId,
      },
      definition,
      artifact: new Uint8Array([1, 2, 3]),
      input: request.input,
      signal,
      createResources: () => fixture.services.resources,
    }),
  })
}

describe('external managed composition through the direct OSS API handler', () => {
  test('routes one exact request/response with no get, cancel, or history endpoint', async () => {
    const fixture = createManagedCompositionFixture()
    await fixture.runtime.boot()
    try {
      const context = {
        functionInvocation: createManagedFunctionApiAdapter(fixture),
      }
      const functionRouter = { invoke: apiInvokeFunction } as Record<string, unknown>
      expect(Object.keys(functionRouter)).toEqual(['invoke'])
      const invoke = apiInvokeFunction.callable({ context })
      const request = {
        canvasId: 'managed-canvas',
        elementId: 'managed-element',
        widgetInstanceId: 'managed-instance',
        widgetKey: definition.widgetKey,
        catalogGeneration: definition.catalogGeneration,
        functionName: definition.descriptor.exportName,
        input: { key: 'theme' },
      }

      await expect(invoke(request)).resolves.toEqual({
        status: 'succeeded',
        output: {
          managed: true,
          artifactByteSize: 3,
          resource: {
            managed: true,
            operation: 'get',
          },
        },
        diagnostics: {
          code: null,
          message: null,
          logByteSize: 0,
          truncated: false,
        },
      })
      expect(fixture.invocationEvidence).toHaveLength(1)
      expect(fixture.invocationEvidence[0]).toMatchObject({
        subject: {
          canvasId: request.canvasId,
          elementId: request.elementId,
          widgetInstanceId: request.widgetInstanceId,
        },
        definition,
        input: request.input,
      })
    } finally {
      await fixture.runtime.shutdown()
    }
  })

  test('preserves direct host error mapping without durable conflict semantics', async () => {
    const context = {
      functionInvocation: {
        invokeFunction: async () => {
          throw Object.assign(new Error('Direct capacity is full.'), {
            code: 'RESOURCE_EXHAUSTED',
          })
        },
      },
    }
    const invoke = apiInvokeFunction.callable({ context })
    await expect(invoke({
      canvasId: 'managed-canvas',
      elementId: 'managed-element',
      widgetInstanceId: 'managed-instance',
      widgetKey: definition.widgetKey,
      catalogGeneration: definition.catalogGeneration,
      functionName: definition.descriptor.exportName,
      input: {},
    })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
  })
})
