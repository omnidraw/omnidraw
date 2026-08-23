import { test } from "bun:test";
import { createLiveConformanceHarness } from "./test/harness";
import { resourcesConformanceSuite } from "./resources.suite";

test("frontend resources conformance · live Layer", async () => {
  const harness = createLiveConformanceHarness();
  try { await resourcesConformanceSuite(harness); } finally { await harness.dispose(); }
});
