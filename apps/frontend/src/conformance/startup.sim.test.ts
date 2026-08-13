import { test } from "bun:test";
import { createSimConformanceHarness } from "./test/harness";
import { startupConformanceSuite } from "./startup.suite";

test("frontend startup conformance · simulated Layer", async () => {
  const harness = createSimConformanceHarness();
  try { await startupConformanceSuite(harness); } finally { await harness.dispose(); }
});
