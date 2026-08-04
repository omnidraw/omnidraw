import { fnFunctionArtifactAdmission } from '@omnidraw/function-runtime/local'
import {
  fnResourceKeyValueParse,
  fnResourceKeyValueSerialize,
} from '@omnidraw/resource-runtime/local'
import { ZWidgetCapsuleRuntimeDescriptor } from '@omnidraw/widget-contract/browser'
import { fnNormalizeWidgetFrame } from '@omnidraw/widget-contract/fn.widget-frame'
import { createManagedCompositionFixture } from './managed-composition'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function runPackedPublicComposition(): Promise<void> {
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
    format: 'omnidraw.capsule-runtime.v2',
    capsuleArtifactHash: `sha256:${'a'.repeat(64)}`,
    apiContract: {
      format: 'capsule-api-groups-v1',
      groups: ['DOM'],
      bundleDigest: `sha256:${'b'.repeat(64)}`,
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
    runtimeDescriptor.format === 'omnidraw.capsule-runtime.v2'
      && runtimeDescriptor.apiContract.groups[0] === 'DOM',
    'The packed browser subpath failed to decode trusted Capsule runtime metadata.',
  )

  const fixture = createManagedCompositionFixture()
  await fixture.runtime.boot()
  try {
    assert(fixture.bootEvidence.length === 3, 'The packed managed composition did not boot every fake service.')
    const hostConfiguration = await fixture.services.widgetCapsuleHostConfiguration.read()
    assert(
      hostConfiguration.signingKeys.every((key) => !('privateKey' in key)),
      'The packed managed host configuration exposed private signing material.',
    )
    const resource = await fixture.services.resources.call({
      slot: 'settings',
      effect: 'read',
      operation: 'get',
      input: { key: 'theme' },
    })
    assert(
      (resource.output as { operation?: string }).operation === 'get',
      'The packed managed resource gateway returned the wrong operation.',
    )
  } finally {
    await fixture.runtime.shutdown()
  }
}

if (import.meta.main) {
  await runPackedPublicComposition()
  console.log('[packed-public-composition] public roots and documented subpaths passed')
}
