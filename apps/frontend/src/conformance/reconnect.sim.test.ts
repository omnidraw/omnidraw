import { test } from "bun:test";
import { createSimConformanceHarness } from "./test/harness";
import {
  reconnectConformanceSuite,
  reconnectRecoveryConformanceSuite,
} from "./reconnect.suite";

test("frontend reconnect conformance · simulated Layer", async () => {
  const harness = createSimConformanceHarness();
  try {
    reconnectConformanceSuite(harness);
    await reconnectRecoveryConformanceSuite(harness);
  } finally {
    await harness.dispose();
  }
});
