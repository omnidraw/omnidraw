import { describe, expect, test } from 'bun:test'
import {
  WIDGET_FRAME_FALLBACK,
  ZOmnidrawToolIcon,
  fnNormalizeWidgetFrame,
  fnWidgetPlacementRefKey,
  fnWidgetPlacementToolId,
} from '../index'

describe('neutral widget frame and tool contract', () => {
  test('normalizes frame metadata without runtime ownership', () => {
    expect(fnNormalizeWidgetFrame()).toEqual(WIDGET_FRAME_FALLBACK)
    expect(fnNormalizeWidgetFrame({ width: 480, height: 320 })).toEqual({ width: 480, height: 320 })
  })

  test('derives stable placement keys and tool ids', () => {
    const reference = {
      source: 'published' as const,
      widgetKey: 'weather-board',
      catalogGeneration: 7,
    }
    expect(fnWidgetPlacementRefKey(reference)).toBe('published:weather-board:7')
    expect(fnWidgetPlacementToolId(reference)).toBe('widget-placement:published:weather-board')
  })

  test('validates neutral tool icons through the public schema', () => {
    expect(ZOmnidrawToolIcon.parse({ lucidIcon: 'Cloud' })).toEqual({ lucidIcon: 'Cloud' })
    expect(ZOmnidrawToolIcon.safeParse({}).success).toBe(false)
    expect(ZOmnidrawToolIcon.safeParse({ lucidIcon: 'not-a-real-icon' }).success).toBe(false)
  })
})
