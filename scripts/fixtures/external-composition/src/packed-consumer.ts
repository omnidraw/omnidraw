import { fnFunctionArtifactAdmission } from '@vibecanvas/function-runtime/local'
import {
  fnResourceKeyValueParse,
  fnResourceKeyValueSerialize,
} from '@vibecanvas/resource-runtime/local'
import { fnScopedKey } from '@vibecanvas/tenant-core/fn.scoped-key'
import { ZWidgetCapsuleRuntimeDescriptor } from '@vibecanvas/widget-contract/browser'
import { fnNormalizeWidgetFrame } from '@vibecanvas/widget-contract/fn.widget-frame'
import { MANAGED_TENANT, createManagedCompositionFixture } from './managed-composition'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function runPackedPublicComposition(): Promise<void> {
  assert(
    fnScopedKey('packed', [MANAGED_TENANT.orgId])
      === `6:packed|${MANAGED_TENANT.orgId.length}:${MANAGED_TENANT.orgId}`,
    'The packed tenant-core subpath returned an unexpected scoped key.',
  )
  assert(
    fnFunctionArtifactAdmission('export const run = () => 1;').allowed,
    'The packed function-runtime local subpath rejected a bounded artifact.',
  )
  const resourceValue = { source: 'packed-consumer', count: 1 }
  assert(
    JSON.stringify(fnResourceKeyValueParse(fnResourceKeyValueSerialize(resourceValue)))
      === JSON.stringify(resourceValue),
    'The packed resource-runtime local subpath failed its JSON round trip.',
  )
  const frame = fnNormalizeWidgetFrame()
  assert(frame.width === 360 && frame.height === 320, 'The packed widget frame subpath changed defaults.')
  const runtimeDescriptor = ZWidgetCapsuleRuntimeDescriptor.parse({
    format: 'vibecanvas.capsule-runtime.v1',
    capsuleArtifactHash: `sha256:${'a'.repeat(64)}`,
    target: {
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
      featureProfiles: [],
    },
    budgets: {
      cpuMs: 100,
      memoryBytes: 16 * 1024 * 1024,
      domNodes: 1_000,
      handles: 2_000,
      messageBytes: 64 * 1024,
      streamBytes: 64 * 1024,
      assetBytes: 0,
      networkBytes: 0,
      gpuBytes: 0,
      lifecycleBytes: 64 * 1024,
    },
    capabilityRequests: [],
    channels: null,
    parkability: { parkable: false },
    signatureKeyIds: ['managed-release-v1'],
  })
  assert(
    runtimeDescriptor.target.runtimeAbi === 'quickjs-release-sync-v1',
    'The packed browser subpath failed to decode trusted Capsule runtime metadata.',
  )

  const fixture = createManagedCompositionFixture()
  await fixture.runtime.boot()
  try {
    assert(fixture.bootEvidence.length === 8, 'The packed managed composition did not boot every fake service.')
    const hostConfiguration = await fixture.services.widgetCapsuleHostConfiguration.read()
    assert(
      hostConfiguration.signingKeys.every((key) => !('privateKey' in key)),
      'The packed managed host configuration exposed private signing material.',
    )
    const resource = await fixture.services.resources.call(MANAGED_TENANT, {
      slot: 'settings',
      effect: 'read',
      operation: 'get',
      input: { key: 'theme' },
    })
    assert(
      (resource.output as { orgId?: string }).orgId === MANAGED_TENANT.orgId,
      'The packed managed resource gateway returned the wrong tenant.',
    )
  } finally {
    await fixture.runtime.shutdown()
  }
}

if (import.meta.main) {
  await runPackedPublicComposition()
  console.log('[packed-public-composition] public roots and documented subpaths passed')
}
