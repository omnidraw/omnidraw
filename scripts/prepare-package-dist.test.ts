import { describe, expect, test } from 'bun:test'
import { resolveDependencySpec } from './prepare-package-dist'

describe('resolveDependencySpec', () => {
  const workspaces = new Map<string, { version?: string }>()

  test('resolves both Bun catalog spellings to a public version', () => {
    const catalog = { zod: '4.4.3' }

    expect(resolveDependencySpec('zod', 'catalog', catalog, workspaces)).toBe('4.4.3')
    expect(resolveDependencySpec('zod', 'catalog:', catalog, workspaces)).toBe('4.4.3')
  })

  test('rejects unresolved local dependency protocols', () => {
    expect(() => resolveDependencySpec('@private/pkg', 'workspace:*', {}, workspaces))
      .toThrow('unsupported public dependency specifier')
  })
})
