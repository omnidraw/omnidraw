import { describe, expect, test } from 'bun:test'
import { resolveDependencySpec } from './prepare-package-dist'

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
