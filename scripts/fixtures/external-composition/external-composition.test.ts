import { describe, expect, test } from 'bun:test'
import { MANAGED_TENANT, createManagedCompositionFixture } from './src/managed-composition'

describe('external private-style managed composition', () => {
  test('registers every managed capability through documented public contracts', async () => {
    const fixture = createManagedCompositionFixture()
    await fixture.runtime.boot()

    expect(fixture.bootEvidence).toEqual([
      'managed-identity',
      'managed-placement',
      'managed-widget-capsule-host-configuration',
      'managed-functions',
      'managed-resources',
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

  test('composes one direct call with exact bytes and no history/status surface', async () => {
    const fixture = createManagedCompositionFixture()
    await fixture.runtime.boot()
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

    await expect(fixture.services.functions.invoke({
      tenant: MANAGED_TENANT,
      subject: {
        canvasId: 'canvas-managed',
        elementId: 'element-managed',
        widgetInstanceId: 'instance-managed',
      },
      definition,
      artifact: new Uint8Array([1, 2, 3]),
      input: { key: 'theme' },
      createResources: () => fixture.services.resources,
    })).resolves.toEqual({
      status: 'succeeded',
      output: {
        managed: true,
        artifactByteSize: 3,
        resource: {
          managed: true,
          orgId: MANAGED_TENANT.orgId,
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
    expect(fixture.invocationEvidence[0]?.definition).toBe(definition)
    expect('get' in fixture.services.functions).toBe(false)
    expect('cancel' in fixture.services.functions).toBe(false)
    expect('listUsage' in fixture.services.functions).toBe(false)

    await fixture.runtime.shutdown()
  })
})
