import { describe, expect, test } from 'bun:test'
import { MANAGED_PUBLIC_PACKAGE_NAMES } from './src/managed-composition'
import { runPackedPublicComposition } from './src/packed-consumer'

describe('external managed composition', () => {
  test('uses exactly the five public Omnidraw packages', () => {
    expect(MANAGED_PUBLIC_PACKAGE_NAMES).toEqual([
      '@omnidraw/canvas-contract',
      '@omnidraw/canvas',
      '@omnidraw/sdk',
      '@omnidraw/component-ai-chat',
      '@omnidraw/theme',
    ])
  })

  test('runs deterministic Canvas and widget conformance values', () => {
    const evidence = runPackedPublicComposition()
    expect(evidence).toMatchObject({
      packageCount: 5,
      themeId: 'light',
    })
    expect(evidence.canvasBytes).toBeGreaterThan(100)
    expect(evidence.widgetBytes).toBeGreaterThan(100)
  })
})
