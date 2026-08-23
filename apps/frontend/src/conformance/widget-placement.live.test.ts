import { test } from "bun:test";
import { createLiveConformanceHarness } from "./test/harness";
import { widgetPlacementConformanceSuite } from "./widget-placement.suite";

test("frontend widget placement conformance · live Layer", async () => {
  const harness = createLiveConformanceHarness();
  try { widgetPlacementConformanceSuite(harness); } finally { await harness.dispose(); }
});
