import { describe, expect, test } from "bun:test";
import { buildActorIpcCommand } from "../src/actor-ipc-command";

describe("buildActorIpcCommand", () => {
  test("uses Bun executable plus source child script in source mode", () => {
    expect(buildActorIpcCommand({
      functionPath: "/tmp/functions.ts",
      compiled: false,
      execPath: "/bin/bun",
      icpClientPath: "/repo/packages/service-actor/src/icp-client.ts",
    })).toEqual([
      "/bin/bun",
      "/repo/packages/service-actor/src/icp-client.ts",
      "--icp-client",
      "--functionPath",
      "/tmp/functions.ts",
    ]);
  });

  test("uses the executable directly in compiled mode", () => {
    expect(buildActorIpcCommand({
      functionPath: "/tmp/functions.ts",
      compiled: true,
      execPath: "/usr/local/bin/vibecanvas",
      icpClientPath: "/repo/packages/service-actor/src/icp-client.ts",
    })).toEqual([
      "/usr/local/bin/vibecanvas",
      "--icp-client",
      "--functionPath",
      "/tmp/functions.ts",
    ]);
  });
});
