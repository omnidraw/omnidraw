import type {
  IDirectFunctionInvoker,
  TDirectFunctionInvocationRequest,
} from '@omnidraw/function-runtime'
import type { IResourceGateway } from '@omnidraw/resource-runtime'
import {
  createRuntime,
  createServiceRegistry,
  type IPlugin,
  type IService,
} from '@omnidraw/runtime'
import type {
  IWidgetCapsuleHostConfigurationReader,
  TWidgetCapsuleHostConfiguration,
} from '@omnidraw/widget-contract'

type TManagedService<TCapability> = TCapability & IService

declare module '@omnidraw/runtime' {
  interface IServiceMap {
    managedWidgetCapsuleHostConfiguration:
      TManagedService<IWidgetCapsuleHostConfigurationReader>
    managedFunctions: TManagedService<IDirectFunctionInvoker>
    managedResources: TManagedService<IResourceGateway>
  }
}

const MANAGED_SERVICE_NAMES = [
  'managedWidgetCapsuleHostConfiguration',
  'managedFunctions',
  'managedResources',
] as const

export function createManagedCompositionFixture() {
  const invocationEvidence: TDirectFunctionInvocationRequest[] = []
  const bootEvidence: string[] = []

  const widgetCapsuleHostConfigurationValue: TWidgetCapsuleHostConfiguration =
    Object.freeze({
      generation: 'd'.repeat(64),
      allowedApis: Object.freeze(['DOM'] as const),
      limits: Object.freeze({
        cpuMs: 100,
        memoryBytes: 16 * 1024 * 1024,
        domNodes: 1_000,
        handles: 2_000,
        messageBytes: 64 * 1024,
        streamBytes: 64 * 1024,
        assetBytes: 2 * 1024 * 1024,
        networkBytes: 0,
        gpuBytes: 0,
        lifecycleBytes: 64 * 1024,
      }),
      previewSigningKeyId: 'managed-preview-v1',
      releaseSigningKeyId: 'managed-release-v1',
      signingKeys: Object.freeze([
        Object.freeze({
          keyId: 'managed-preview-v1',
          algorithm: 'Ed25519',
          format: 'raw',
          publicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        }),
        Object.freeze({
          keyId: 'managed-release-v1',
          algorithm: 'Ed25519',
          format: 'raw',
          publicKeyBase64: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
        }),
      ]),
    })
  const widgetCapsuleHostConfiguration:
    TManagedService<IWidgetCapsuleHostConfigurationReader> = {
      name: 'managed-widget-capsule-host-configuration',
      async read() {
        return widgetCapsuleHostConfigurationValue
      },
    }

  const resources: TManagedService<IResourceGateway> = {
    name: 'managed-resources',
    async call(call) {
      return {
        output: {
          managed: true,
          operation: call.operation,
        },
      }
    },
  }

  const functions: TManagedService<IDirectFunctionInvoker> = {
    name: 'managed-functions',
    async invoke(request) {
      invocationEvidence.push(request)
      const call = Object.freeze({
        id: 'managed-call',
        subject: request.subject,
        definition: request.definition,
        input: request.input,
        deadlineAtMs: 1_000,
      })
      const gateway = await request.createResources(call)
      const resource = await gateway.call({
        slot: 'settings',
        effect: 'read',
        operation: 'get',
        input: { key: 'theme' },
      })
      return Object.freeze({
        status: 'succeeded' as const,
        output: Object.freeze({
          managed: true,
          artifactByteSize: request.artifact.byteLength,
          resource: resource.output,
        }),
        diagnostics: Object.freeze({
          code: null,
          message: null,
          logByteSize: 0,
          truncated: false,
        }),
      })
    },
  }

  const services = createServiceRegistry()
  services.provide(
    'managedWidgetCapsuleHostConfiguration',
    30,
    widgetCapsuleHostConfiguration,
  )
  services.provide('managedFunctions', 40, functions)
  services.provide('managedResources', 50, resources)

  const compositionProbe: IPlugin<Pick<
    import('@omnidraw/runtime').IServiceMap,
    typeof MANAGED_SERVICE_NAMES[number]
  >> = {
    name: 'managed-composition-probe',
    apply(context) {
      for (const name of MANAGED_SERVICE_NAMES) {
        bootEvidence.push(context.services.require(name).name)
      }
    },
  }

  const runtime = createRuntime({
    plugins: [compositionProbe],
    config: { mode: 'managed-fixture' },
    hooks: {},
    services,
  })

  return {
    runtime,
    services: {
      widgetCapsuleHostConfiguration,
      functions,
      resources,
    },
    bootEvidence,
    invocationEvidence,
  }
}
