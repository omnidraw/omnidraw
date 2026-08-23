import type { TWidgetFrameBounds, TWidgetPlacementRef } from "@omnidraw/sdk";

const MIN_SIZE = 64;
const MAX_SIZE = 4_096;

export type TWidgetPlacementDescriptor = Readonly<{
  reference: TWidgetPlacementRef;
  bounds: TWidgetFrameBounds;
}>;

export function fnValidateWidgetPlacementDescriptor(
  value: unknown,
): TWidgetPlacementDescriptor | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Partial<TWidgetPlacementDescriptor>;
  const reference = input.reference;
  const bounds = input.bounds;
  if (
    typeof reference !== "object" || reference === null
    || (reference.source !== "draft" && reference.source !== "published")
    || typeof reference.widgetKey !== "string" || reference.widgetKey.length === 0
    || !Number.isInteger(reference.catalogGeneration) || reference.catalogGeneration < 1
    || typeof bounds !== "object" || bounds === null
    || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)
    || bounds.width < MIN_SIZE || bounds.height < MIN_SIZE
    || bounds.width > MAX_SIZE || bounds.height > MAX_SIZE
  ) return null;
  return {
    reference: { ...reference },
    bounds: { width: bounds.width, height: bounds.height },
  };
}
