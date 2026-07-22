#!/usr/bin/env bun

export {};

const args = Bun.argv.slice(2);

if (args.includes('--widget-typecheck-worker')) {
  const { runWidgetTypecheckWorker } = await import(
    './services/widget-typecheck-worker'
  );
  runWidgetTypecheckWorker();
} else if (args.includes('--function-worker')) {
  const { runFunctionWorker } = await import(
    '@vibecanvas/function-runtime/local'
  );
  runFunctionWorker();
} else {
  const { runCliMain } = await import("./main-app");
  await runCliMain();
}
