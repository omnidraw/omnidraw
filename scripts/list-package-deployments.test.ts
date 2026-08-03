import { describe, expect, test } from 'bun:test'
import {
  buildPackages,
  dependencyManifestDrift,
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

  test('requires a version bump when the built dist changed published dependency pins', () => {
    const drift = dependencyManifestDrift(
      {
        dependencies: { '@omnidraw/resource-runtime': '0.5.2' },
        peerDependencies: { '@tursodatabase/database': '0.7.2' },
      },
      {
        dependencies: { '@omnidraw/resource-runtime': '0.5.0' },
        peerDependencies: { '@tursodatabase/database': '0.6.1' },
      },
    )
    const decision = packageDecision(
      { name: '@omnidraw/function-runtime', version: '0.5.0' },
      registry('0.5.0', ['0.5.0']),
      drift,
    )

    expect(decision.action).toBe('bump-dependencies')
    expect(decision.explanation).toContain('catalog mismatch')
    expect(decision.explanation).toContain('npm uses @omnidraw/resource-runtime@0.5.0, but the new build uses @omnidraw/resource-runtime@0.5.2')
    expect(decision.explanation).toContain('npm uses @tursodatabase/database@0.6.1, but the new build uses @tursodatabase/database@0.7.2')
    expect(decision.explanation).toContain('update @omnidraw/function-runtime to 0.5.1 and build again')
  })
})

describe('dependencyManifestDrift', () => {
  test('reports changed, added, and removed dependency entries but ignores other manifest fields', () => {
    expect(dependencyManifestDrift(
      {
        description: 'new description',
        dependencies: { changed: '2.0.0', added: '1.0.0' },
        peerDependencies: {},
      },
      {
        description: 'old description',
        dependencies: { changed: '1.0.0' },
        peerDependencies: { removed: '1.0.0' },
      },
    )).toEqual([
      {
        dependency: 'added',
        distSpecifier: '1.0.0',
        field: 'dependencies',
        publishedSpecifier: undefined,
      },
      {
        dependency: 'changed',
        distSpecifier: '2.0.0',
        field: 'dependencies',
        publishedSpecifier: '1.0.0',
      },
      {
        dependency: 'removed',
        distSpecifier: undefined,
        field: 'peerDependencies',
        publishedSpecifier: '1.0.0',
      },
    ])
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

describe('buildPackages', () => {
  test('builds every package sequentially in the supplied dependency order', async () => {
    const packageEntry = (name: string): TWorkspacePackage => ({
      directory: `/repo/packages/${name}`,
      manifest: { name, version: '1.0.0' },
      name,
      version: '1.0.0',
    })
    const entries = [packageEntry('@omnidraw/base'), packageEntry('@omnidraw/service')]
    const calls: string[] = []

    await buildPackages(entries, async (entry, index, total) => {
      calls.push(`${index + 1}/${total}:${entry.name}`)
    })

    expect(calls).toEqual([
      '1/2:@omnidraw/base',
      '2/2:@omnidraw/service',
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
