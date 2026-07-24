import { describe, expect, test } from 'bun:test'
import type { TFunctionInvocationEnvelope } from '@vibecanvas/function-runtime'
import { MANAGED_TENANT, createManagedCompositionFixture } from './src/managed-composition'

describe('external private-style managed composition', () => {
  test('registers every managed capability through documented public contracts', async () => {
    const fixture = createManagedCompositionFixture()
    await fixture.runtime.boot()

    expect(fixture.bootEvidence).toEqual([
      'managed-identity',
      'managed-placement',
      'managed-artifacts',
      'managed-widget-capsule-host-configuration',
      'managed-dispatcher',
      'managed-executor',
      'managed-resources',
      'managed-collaboration',
      'managed-usage',
    ])
    expect(await fixture.services.identity.resolveIdentity({ requestId: 'request', session: {} }))
      .toMatchObject({ orgId: MANAGED_TENANT.orgId, accountId: MANAGED_TENANT.accountId })
    expect(await fixture.services.placement.resolvePlacement(MANAGED_TENANT.orgId))
      .toEqual({ orgId: MANAGED_TENANT.orgId, cellId: MANAGED_TENANT.cellId, epoch: 7 })
    expect(await fixture.services.widgetCapsuleHostConfiguration.read()).toMatchObject({
      generation: 'd'.repeat(64),
      previewSigningKeyId: 'managed-preview-v1',
      releaseSigningKeyId: 'managed-release-v1',
      signingKeys: [
        {
          keyId: 'managed-preview-v1',
          algorithm: 'Ed25519',
          format: 'raw',
        },
        {
          keyId: 'managed-release-v1',
          algorithm: 'Ed25519',
          format: 'raw',
        },
      ],
    })

    await fixture.runtime.shutdown()
  })

  test('uses managed artifact, dispatcher/executor, resource, collaboration, and usage fakes', async () => {
    const fixture = createManagedCompositionFixture()
    await fixture.runtime.boot()

    const descriptor = await fixture.services.artifacts.putArtifact(MANAGED_TENANT, {
      id: 'artifact-managed',
      kind: 'server',
      digestSha256: 'a'.repeat(64),
      bytes: new Uint8Array([1, 2, 3]),
      retentionState: 'pinned',
      retainUntilMs: null,
      createdAtMs: 1,
    })
    const readRequest = {
      artifactId: descriptor.id,
      readCapability: `managed-read:${MANAGED_TENANT.orgId}:${descriptor.id}`,
      purpose: 'server_execution' as const,
    }
    expect(await fixture.services.artifacts.readArtifact(MANAGED_TENANT, readRequest))
      .toEqual(new Uint8Array([1, 2, 3]))

    const dispatchRequest = {
      widgetDefinitionId: 'definition-managed',
      widgetRevisionId: 'revision-managed',
      subject: { kind: 'widget_instance', canvasId: 'canvas-managed', widgetInstanceId: 'instance-managed' },
      functionName: 'run',
      input: {},
      idempotencyKey: 'idempotency-managed',
    } as const
    const dispatch = await fixture.services.dispatcher.invoke(MANAGED_TENANT, dispatchRequest)
    expect(dispatch).toMatchObject({
      status: 'created',
      invocation: {
        envelope: {
          id: 'managed-invocation:idempotency-managed',
          tenant: MANAGED_TENANT,
          widgetRevisionId: 'revision-managed',
          functionName: 'run',
        },
        status: 'queued',
      },
    })
    expect(await fixture.services.dispatcher.invoke(MANAGED_TENANT, dispatchRequest))
      .toMatchObject({ status: 'replayed' })
    expect(await fixture.services.dispatcher.invoke(MANAGED_TENANT, {
      ...dispatchRequest,
      input: { changed: true },
    })).toEqual({
      status: 'conflict',
      invocationId: 'managed-invocation:idempotency-managed',
      reason: 'fingerprint_mismatch',
    })
    expect(fixture.dispatchEvidence).toHaveLength(3)
    expect(await fixture.services.executor.execute({ id: 'invocation-managed' } as TFunctionInvocationEnvelope))
      .toEqual({ status: 'not_claimed', reason: 'managed-fixture:invocation-managed' })

    expect(await fixture.services.resources.call(MANAGED_TENANT, {
      slot: 'settings',
      effect: 'read',
      operation: 'get',
      input: { key: 'theme' },
    })).toEqual({ output: { managed: true, orgId: MANAGED_TENANT.orgId, operation: 'get' } })

    expect(await fixture.services.collaboration.admitDocument(MANAGED_TENANT, 'document-managed'))
      .toBe(true)
    await fixture.services.collaboration.releaseDocument(MANAGED_TENANT, 'document-managed')

    expect(await fixture.services.usage.listUsageOutbox(MANAGED_TENANT, { limit: 10 })).toEqual([])
    expect(await fixture.services.usage.transitionUsageOutbox(MANAGED_TENANT, {
      ids: ['usage-1'],
      expected: 'pending',
      next: 'importing',
      nowMs: 1,
    })).toBe(1)

    await fixture.runtime.shutdown()
  })
})
