import { describe, expect, test } from 'bun:test'
import {
  packageDecision,
  packageOrder,
  publishCommand,
  type TRegistryPackage,
  type TWorkspacePackage,
} from './list-package-deployments'

function registry(latest: string | null, versions: readonly string[]): TRegistryPackage {
  return {
    distTags: latest === null ? {} : { latest },
    exists: latest !== null || versions.length > 0,
    versions: new Set(versions),
  }
}

describe('packageDecision', () => {
  test('deploys a missing package and a newer unpublished local version', () => {
    expect(packageDecision(
      { name: '@omnidraw/new', version: '0.5.0' },
      registry(null, []),
    ).action).toBe('deploy')
    expect(packageDecision(
      { name: '@omnidraw/newer', version: '0.5.1' },
      registry('0.5.0', ['0.5.0']),
    ).action).toBe('deploy')
  })

  test('never republishes an existing exact version', () => {
    expect(packageDecision(
      { name: '@omnidraw/current', version: '0.5.1' },
      registry('0.5.1', ['0.5.1']),
    ).action).toBe('current')
    expect(packageDecision(
      { name: '@omnidraw/tag', version: '0.5.1' },
      registry('0.5.0', ['0.5.0', '0.5.1']),
    ).action).toBe('fix-tag')
  })

  test('never suggests moving latest backwards to an older existing local version', () => {
    const decision = packageDecision(
      { name: '@omnidraw/behind', version: '0.5.0' },
      registry('0.6.0', ['0.5.0', '0.6.0']),
    )
    expect(decision.action).toBe('fix-local')
    expect(decision.explanation).toContain('instead of moving the tag backwards')
  })

  test('blocks when public latest is newer than local', () => {
    const decision = packageDecision(
      { name: '@omnidraw/behind', version: '0.5.0' },
      registry('0.6.0', ['0.6.0']),
    )
    expect(decision.action).toBe('fix-local')
    expect(decision.explanation).toContain('update the local package version above 0.6.0')
  })
})

describe('packageOrder', () => {
  test('orders packages dependency-first', () => {
    const packageEntry = (name: string, dependencies: Record<string, string> = {}): TWorkspacePackage => ({
      directory: `/repo/packages/${name}`,
      manifest: { name, version: '1.0.0', dependencies },
      name,
      version: '1.0.0',
    })
    const ordered = packageOrder([
      packageEntry('@omnidraw/widget', { '@omnidraw/tenant': 'workspace:*' }),
      packageEntry('@omnidraw/tenant'),
      packageEntry('@omnidraw/sdk', { '@omnidraw/widget': 'workspace:*' }),
    ])
    expect(ordered.map((entry) => entry.name)).toEqual([
      '@omnidraw/tenant',
      '@omnidraw/widget',
      '@omnidraw/sdk',
    ])
  })
})

describe('publishCommand', () => {
  test('prints one locally executable command forced to public npm without provenance', () => {
    const command = publishCommand({
      directory: '/repo/packages/theme-contract',
      manifest: { name: '@omnidraw/theme-contract', version: '0.5.0' },
      name: '@omnidraw/theme-contract',
      version: '0.5.0',
    })

    expect(command).toStartWith("echo 'Publishing @omnidraw/theme-contract@0.5.0' && cd ")
    expect(command.match(/--provenance=false/g)).toHaveLength(2)
    expect(command.match(/--registry=https:\/\/registry\.npmjs\.org\//g)).toHaveLength(2)
    expect(command.match(/'--@omnidraw:registry=https:\/\/registry\.npmjs\.org\/'/g)).toHaveLength(2)
  })
})
