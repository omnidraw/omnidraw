import {
  fnClampWidgetPlacementPosition,
  fnHasWidgetPlacementDragThreshold,
} from "@/core/widgets/fn.pointer-placement";

export type TWidgetPlacementConformanceHarness = Readonly<{
  threshold: typeof fnHasWidgetPlacementDragThreshold;
  clamp: typeof fnClampWidgetPlacementPosition;
}>;

/** Renderer-neutral placement policy, unchanged for live and simulated worlds. */
export function widgetPlacementConformanceSuite(harness: TWidgetPlacementConformanceHarness): void {
  if (harness.threshold({ origin: { x: 10, y: 10 }, point: { x: 15, y: 10 }, threshold: 6 })) {
    throw new Error("Placement began before the pointer threshold.");
  }
  if (!harness.threshold({ origin: { x: 10, y: 10 }, point: { x: 16, y: 10 }, threshold: 6 })) {
    throw new Error("Placement did not begin at the pointer threshold.");
  }
  const placed = harness.clamp({
    point: { x: 990, y: -20 },
    bounds: { width: 240, height: 160 },
    viewport: { minX: 100, minY: 50, maxX: 1_000, maxY: 800 },
  });
  if (placed.x !== 760 || placed.y !== 50) throw new Error("Placement did not clamp in world coordinates.");
}
