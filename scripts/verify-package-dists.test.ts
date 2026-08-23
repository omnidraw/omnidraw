import { describe, expect, test } from 'bun:test'
import { packageClosure, type TPackage } from './verify-package-dists'

function packageEntry(name: string, dependencies: Record<string, string> = {}): TPackage {
  return {
    directory: `/repo/packages/${name}`,
    manifest: { name, version: '1.0.0', dependencies },
    name,
    version: '1.0.0',
  }
}

describe('packageClosure', () => {
  test('selects the complete internal dependency closure without unrelated packages', () => {
    const packages = [
      packageEntry('@omnidraw/base'),
      packageEntry('@omnidraw/service', { '@omnidraw/base': 'workspace:*' }),
      packageEntry('@omnidraw/unrelated'),
    ]

    expect(packageClosure(packages, ['@omnidraw/service']).map((entry) => entry.name))
      .toEqual(['@omnidraw/service', '@omnidraw/base'])
  })

  test('rejects unknown selections', () => {
    expect(() => packageClosure([], ['@omnidraw/missing']))
      .toThrow('Unknown versioned package selection')
  })
})
