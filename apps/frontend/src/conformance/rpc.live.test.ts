import { test } from "bun:test";
import { createLiveConformanceHarness } from "./test/harness";
import { rpcConformanceSuite } from "./rpc.suite";

test("frontend RPC conformance · live Layer", async () => {
  const harness = createLiveConformanceHarness();
  try { await rpcConformanceSuite(harness); } finally { await harness.dispose(); }
});
