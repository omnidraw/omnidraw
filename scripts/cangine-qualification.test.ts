import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CANGINE_VERSION = '0.7.0'
const CANGINE_INTEGRITY = 'sha512-mxVflwyy/q1oF0u3XeIQnB7RK6Xkncnh7VSzhsGSLdfzgKdr7TQmwtUV4aPmgPoLA3UkV7O9tt4CuI66nnW6sQ=='
const ENTRYPOINTS = [
  '@omnidraw/cangine',
  '@omnidraw/cangine/types',
  '@omnidraw/cangine/geometry',
  '@omnidraw/cangine/scene',
  '@omnidraw/cangine/testing',
  '@omnidraw/cangine/backend',
  '@omnidraw/cangine/editor',
] as const

describe('Cangine public qualification', () => {
  test('resolves every supported public entrypoint at exact 0.7.0', async () => {
    const packageJsonPath = fileURLToPath(import.meta.resolve('@omnidraw/cangine/package.json'))
    const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      version?: unknown
    }
    expect(manifest.version).toBe(CANGINE_VERSION)

    for (const entrypoint of ENTRYPOINTS) {
      expect(fileURLToPath(import.meta.resolve(entrypoint)).startsWith(dirname(packageJsonPath)))
        .toBe(true)
      expect(await import(entrypoint)).toBeDefined()
    }
  })

  test('ships the qualified attachment and fixed-segment declarations', async () => {
    const packageJsonPath = fileURLToPath(import.meta.resolve('@omnidraw/cangine/package.json'))
    const declarations = await readFile(join(dirname(packageJsonPath), 'dist/types.d.ts'), 'utf8')
    expect(declarations).toContain('mode: "inside" | "orbit";')
    expect(declarations).toContain('fixedPoint: TVec2;')
    expect(declarations).toContain('fixedSegments?: TConnectorFixedSegment[];')
  })

  test('locks the immutable public package integrity', async () => {
    const lockfile = await readFile(join(import.meta.dir, '..', 'bun.lock'), 'utf8')
    const cangineLine = lockfile.split('\n').find((line) => (
      line.includes('"@omnidraw/cangine": ["@omnidraw/cangine@0.7.0"')
    ))
    expect(cangineLine).toContain(CANGINE_INTEGRITY)
  })
})
