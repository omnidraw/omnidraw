import type {
  IFunctionDispatcher,
  IFunctionExecutor,
  IUsageSink,
  TFunctionDispatchRequest,
  TFunctionInvocationEnvelope,
  TInvocationRecord,
} from '@vibecanvas/function-runtime'
import type { IResourceGateway } from '@vibecanvas/resource-runtime'
import {
  createRuntime,
  createServiceRegistry,
  type IPlugin,
  type IService,
} from '@vibecanvas/runtime'
import type {
  IIdentityProvider,
  IPlacementDirectory,
  TTenantContext,
} from '@vibecanvas/tenant-core'
import type {
  IWidgetCapsuleHostConfigurationReader,
  IWidgetArtifactStore,
  TWidgetCapsuleHostConfiguration,
  TWidgetArtifactDescriptor,
} from '@vibecanvas/widget-contract'

type TManagedService<TCapability> = TCapability & IService

declare module '@vibecanvas/runtime' {
  interface IServiceMap {
    managedIdentity: TManagedService<IIdentityProvider>
    managedPlacement: TManagedService<IPlacementDirectory>
    managedArtifacts: TManagedService<IWidgetArtifactStore>
    managedWidgetCapsuleHostConfiguration:
      TManagedService<IWidgetCapsuleHostConfigurationReader>
    managedDispatcher: TManagedService<IFunctionDispatcher>
    managedExecutor: TManagedService<IFunctionExecutor>
    managedResources: TManagedService<IResourceGateway>
    managedUsage: TManagedService<IUsageSink>
  }
}

export const MANAGED_TENANT: TTenantContext = Object.freeze({
  orgId: 'org-managed-fixture',
  accountId: 'account-managed-fixture',
  cellId: 'cell-managed-fixture',
  placementEpoch: 7,
  roles: ['owner'],
  capabilities: ['widget:publish', 'function:invoke'],
  requestId: 'request-managed-fixture',
})

const MANAGED_SERVICE_NAMES = [
  'managedIdentity',
  'managedPlacement',
  'managedArtifacts',
  'managedWidgetCapsuleHostConfiguration',
  'managedDispatcher',
  'managedExecutor',
  'managedResources',
  'managedUsage',
] as const

function artifactKey(orgId: string, artifactId: string): string {
  return `${orgId}:${artifactId}`
}

function invocationFingerprint(request: TFunctionDispatchRequest): string {
  return JSON.stringify(request)
}

function invocationRecord(
  tenant: TTenantContext,
  request: TFunctionDispatchRequest,
): TInvocationRecord {
  const createdAtMs = 1
  return Object.freeze({
    envelope: Object.freeze({
      id: `managed-invocation:${request.idempotencyKey}`,
      tenant,
      widgetDefinitionId: request.widgetDefinitionId,
      widgetRevisionId: request.widgetRevisionId,
      subject: request.subject,
      functionId: `managed-function:${request.functionName}`,
      functionName: request.functionName,
      definitionRevision: 1,
      artifactDigestSha256: 'a'.repeat(64),
      contractDigestSha256: 'b'.repeat(64),
      runtimeAbi: 'vibecanvas-function-v1',
      input: request.input,
      inputDigestSha256: 'c'.repeat(64),
      idempotencyKey: request.idempotencyKey,
      policyVersion: 1,
      priority: request.priority ?? 0,
      limits: Object.freeze({
        timeoutMs: 1_000,
        memoryTier: 'small',
        outputByteLimit: 1_024,
        logByteLimit: 1_024,
      }),
      retry: Object.freeze({
        mode: 'none',
        maxAttempts: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
      }),
      createdAtMs,
      deadlineAtMs: request.deadlineAtMs ?? createdAtMs + 1_000,
    }),
    status: 'queued',
    output: null,
    failure: null,
    resultDigestSha256: null,
    outputByteSize: 0,
    logByteSize: 0,
    bodyState: 'full',
    retainsRevision: true,
    cancelRequestedAtMs: null,
    availableAtMs: createdAtMs,
    startedAtMs: null,
    finishedAtMs: null,
    bodiesCompactedAtMs: null,
  })
}

export function createManagedCompositionFixture() {
  const artifactDescriptors = new Map<string, TWidgetArtifactDescriptor>()
  const artifactBytes = new Map<string, Uint8Array>()
  const dispatchEvidence: Array<Readonly<{
    tenant: TTenantContext
    request: TFunctionDispatchRequest
  }>> = []
  const dispatchedInvocations = new Map<string, Readonly<{
    fingerprint: string
    invocation: TInvocationRecord
  }>>()
  const bootEvidence: string[] = []
  let dispatcherStarted = false

  const identity: TManagedService<IIdentityProvider> = {
    name: 'managed-identity',
    async resolveIdentity() {
      return {
        orgId: MANAGED_TENANT.orgId,
        accountId: MANAGED_TENANT.accountId,
        roles: MANAGED_TENANT.roles,
        capabilities: MANAGED_TENANT.capabilities,
      }
    },
  }

  const placement: TManagedService<IPlacementDirectory> = {
    name: 'managed-placement',
    async resolvePlacement(orgId) {
      if (orgId !== MANAGED_TENANT.orgId) return null
      return {
        orgId,
        cellId: MANAGED_TENANT.cellId,
        epoch: MANAGED_TENANT.placementEpoch,
      }
    },
  }

  const artifacts: TManagedService<IWidgetArtifactStore> = {
    name: 'managed-artifacts',
    async putArtifact(tenant, artifact) {
      const descriptor: TWidgetArtifactDescriptor = Object.freeze({
        orgId: tenant.orgId,
        id: artifact.id,
        kind: artifact.kind,
        digestSha256: artifact.digestSha256,
        byteSize: artifact.bytes.byteLength,
        retentionState: artifact.retentionState,
        retainUntilMs: artifact.retainUntilMs,
        createdAtMs: artifact.createdAtMs,
      })
      const key = artifactKey(tenant.orgId, artifact.id)
      artifactDescriptors.set(key, descriptor)
      artifactBytes.set(key, new Uint8Array(artifact.bytes))
      return descriptor
    },
    async getArtifact(tenant, request) {
      if (request.readCapability !== `managed-read:${tenant.orgId}:${request.artifactId}`) return null
      return artifactDescriptors.get(artifactKey(tenant.orgId, request.artifactId)) ?? null
    },
    async readArtifact(tenant, request) {
      if (request.readCapability !== `managed-read:${tenant.orgId}:${request.artifactId}`) return null
      const bytes = artifactBytes.get(artifactKey(tenant.orgId, request.artifactId))
      return bytes ? new Uint8Array(bytes) : null
    },
    async deleteArtifact(tenant, request) {
      const key = artifactKey(tenant.orgId, request.artifactId)
      const descriptor = artifactDescriptors.get(key)
      if (
        !descriptor
        || descriptor.kind !== request.kind
        || descriptor.digestSha256 !== request.digestSha256
      ) return false
      artifactDescriptors.delete(key)
      artifactBytes.delete(key)
      return true
    },
  }

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

  const dispatcher: TManagedService<IFunctionDispatcher> = {
    name: 'managed-dispatcher',
    async start() {
      dispatcherStarted = true
    },
    async stop() {
      dispatcherStarted = false
    },
    async invoke(tenant, request) {
      if (!dispatcherStarted) throw new Error('Managed dispatcher is stopped.')
      dispatchEvidence.push(Object.freeze({ tenant, request }))
      const key = `${tenant.orgId}:${request.idempotencyKey}`
      const fingerprint = invocationFingerprint(request)
      const existing = dispatchedInvocations.get(key)
      if (!existing) {
        const invocation = invocationRecord(tenant, request)
        dispatchedInvocations.set(key, Object.freeze({ fingerprint, invocation }))
        return { status: 'created', invocation }
      }
      if (existing.fingerprint === fingerprint) {
        return { status: 'replayed', invocation: existing.invocation }
      }
      return {
        status: 'conflict',
        invocationId: existing.invocation.envelope.id,
        reason: 'fingerprint_mismatch',
      }
    },
  }

  const executor: TManagedService<IFunctionExecutor> = {
    name: 'managed-executor',
    async execute(envelope: TFunctionInvocationEnvelope) {
      return { status: 'not_claimed', reason: `managed-fixture:${envelope.id}` }
    },
  }

  const resources: TManagedService<IResourceGateway> = {
    name: 'managed-resources',
    async call(tenant, call) {
      return {
        output: {
          managed: true,
          orgId: tenant.orgId,
          operation: call.operation,
        },
      }
    },
  }

  const usage: TManagedService<IUsageSink> = {
    name: 'managed-usage',
    async listUsageOutbox() {
      return []
    },
    async transitionUsageOutbox(_tenant, request) {
      return request.ids.length
    },
  }

  const services = createServiceRegistry()
  services.provide('managedIdentity', 10, identity)
  services.provide('managedPlacement', 20, placement)
  services.provide('managedArtifacts', 30, artifacts)
  services.provide(
    'managedWidgetCapsuleHostConfiguration',
    35,
    widgetCapsuleHostConfiguration,
  )
  services.provide('managedDispatcher', 40, dispatcher)
  services.provide('managedExecutor', 50, executor)
  services.provide('managedResources', 60, resources)
  services.provide('managedUsage', 80, usage)

  const compositionProbe: IPlugin<Pick<
    import('@vibecanvas/runtime').IServiceMap,
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
      identity,
      placement,
      artifacts,
      widgetCapsuleHostConfiguration,
      dispatcher,
      executor,
      resources,
      usage,
    },
    bootEvidence,
    dispatchEvidence,
  }
}
