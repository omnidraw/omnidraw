import { test } from "bun:test";
import { createSimConformanceHarness } from "./test/harness";
import { rpcConformanceSuite } from "./rpc.suite";

test("frontend RPC conformance · simulated Layer", async () => {
  const harness = createSimConformanceHarness();
  try { await rpcConformanceSuite(harness); } finally { await harness.dispose(); }
});
