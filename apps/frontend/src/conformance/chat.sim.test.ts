import { test } from "bun:test";
import { createSimConformanceHarness } from "./test/harness";
import { chatConformanceSuite } from "./chat.suite";

test("frontend chat conformance · simulated Layer", async () => {
  const harness = createSimConformanceHarness();
  try { await chatConformanceSuite(harness); } finally { await harness.dispose(); }
});
