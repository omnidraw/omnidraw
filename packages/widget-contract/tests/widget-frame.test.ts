import { describe, expect, test } from 'bun:test'
import {
  WIDGET_FRAME_FALLBACK,
  ZVibecanvasToolIcon,
  fnNormalizeWidgetFrame,
  fnWidgetPlacementRefKey,
  fnWidgetPlacementToolId,
} from '../src'

describe('neutral widget frame and tool contract', () => {
  test('normalizes frame metadata without actor ownership', () => {
    expect(fnNormalizeWidgetFrame()).toEqual(WIDGET_FRAME_FALLBACK)
    expect(fnNormalizeWidgetFrame({ width: 480, height: 320 })).toEqual({ width: 480, height: 320 })
  })

  test('derives stable placement keys and tool ids', () => {
    const reference = { source: 'published' as const, name: 'Weather board', revision: 'revision:1' }
    expect(fnWidgetPlacementRefKey(reference)).toBe('published:Weather%20board:revision%3A1')
    expect(fnWidgetPlacementToolId(reference)).toBe('widget-placement:published:Weather%20board')
  })

  test('validates neutral tool icons through the public schema', () => {
    expect(ZVibecanvasToolIcon.parse({ lucidIcon: 'Cloud' })).toEqual({ lucidIcon: 'Cloud' })
    expect(ZVibecanvasToolIcon.safeParse({}).success).toBe(false)
    expect(ZVibecanvasToolIcon.safeParse({ lucidIcon: 'not-a-real-icon' }).success).toBe(false)
  })
})
