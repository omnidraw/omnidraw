import { test } from "bun:test";
import { createLiveConformanceHarness } from "./test/harness";
import {
  reconnectConformanceSuite,
  reconnectRecoveryConformanceSuite,
} from "./reconnect.suite";

test("frontend reconnect conformance · live Layer", async () => {
  const harness = createLiveConformanceHarness();
  try {
    reconnectConformanceSuite(harness);
    await reconnectRecoveryConformanceSuite(harness);
  } finally {
    await harness.dispose();
  }
});
