import { test } from "bun:test";
import { createSimConformanceHarness } from "./test/harness";
import { widgetPlacementConformanceSuite } from "./widget-placement.suite";

test("frontend widget placement conformance · simulated Layer", async () => {
  const harness = createSimConformanceHarness();
  try { widgetPlacementConformanceSuite(harness); } finally { await harness.dispose(); }
});
