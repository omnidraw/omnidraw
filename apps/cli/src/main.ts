#!/usr/bin/env bun

export {};

const args = Bun.argv.slice(2);

if (args.includes("--icp-client")) {
  const { runActorIpcClient } = await import("@vibecanvas/service-actor/icp-client");
  await runActorIpcClient(args);
  process.exit(process.exitCode ?? 0);
}

const { runCliMain } = await import("./main-app");
await runCliMain();
