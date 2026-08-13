import { test } from "bun:test";
import { createLiveConformanceHarness } from "./test/harness";
import { chatConformanceSuite } from "./chat.suite";

test("frontend chat conformance · live Layer", async () => {
  const harness = createLiveConformanceHarness();
  try { await chatConformanceSuite(harness); } finally { await harness.dispose(); }
});
