import { test } from "bun:test";
import { createLiveConformanceHarness } from "./test/harness";
import { startupConformanceSuite } from "./startup.suite";

test("frontend startup conformance · live Layer", async () => {
  const harness = createLiveConformanceHarness();
  try { await startupConformanceSuite(harness); } finally { await harness.dispose(); }
});
