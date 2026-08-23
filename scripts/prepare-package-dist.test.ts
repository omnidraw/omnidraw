import { describe, expect, test } from 'bun:test'
import { packageDistDirectories, resolveDependencySpec } from './prepare-package-dist'

describe('resolveDependencySpec', () => {
  const workspaces = new Map<string, { version?: string }>()

  test('resolves both Bun catalog spellings to a public version', () => {
    const catalog = { 'lucide-static': '1.24.0' }

    expect(resolveDependencySpec('lucide-static', 'catalog', catalog, workspaces)).toBe('1.24.0')
    expect(resolveDependencySpec('lucide-static', 'catalog:', catalog, workspaces)).toBe('1.24.0')
  })

  test('rejects unresolved local dependency protocols', () => {
    expect(() => resolveDependencySpec('@private/pkg', 'workspace:*', {}, workspaces))
      .toThrow('unsupported public dependency specifier')
  })
})

describe('packageDistDirectories', () => {
  test('keeps the normal release distribution at package/dist', () => {
    expect(packageDistDirectories([], '/repo/packages/sdk', '/repo')).toEqual({
      packageDirectory: '/repo/packages/sdk',
      distDirectory: '/repo/packages/sdk/dist',
      explicit: false,
    })
  })

  test('accepts an explicit external stage and rejects repository-owned staging', () => {
    expect(packageDistDirectories(
      ['--package-root', '/repo/packages/sdk', '--dist-root', '/tmp/stage/package'],
      '/repo',
      '/repo',
    )).toEqual({
      packageDirectory: '/repo/packages/sdk',
      distDirectory: '/tmp/stage/package',
      explicit: true,
    })
    expect(() => packageDistDirectories(
      ['--package-root', '/repo/packages/sdk', '--dist-root', '/repo/.stage/package'],
      '/repo',
      '/repo',
    )).toThrow('must be outside the source repository')
  })

  test('requires package and distribution roots as one explicit contract', () => {
    expect(() => packageDistDirectories(['--dist-root', '/tmp/stage'], '/repo/packages/sdk', '/repo'))
      .toThrow('must be supplied together')
  })
})
