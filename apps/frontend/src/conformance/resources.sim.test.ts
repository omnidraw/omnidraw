import { test } from "bun:test";
import { createSimConformanceHarness } from "./test/harness";
import { resourcesConformanceSuite } from "./resources.suite";

test("frontend resources conformance · simulated Layer", async () => {
  const harness = createSimConformanceHarness();
  try { await resourcesConformanceSuite(harness); } finally { await harness.dispose(); }
});
