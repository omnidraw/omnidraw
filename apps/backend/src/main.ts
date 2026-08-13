#!/usr/bin/env bun

export {};

const args = Bun.argv.slice(2);
if (args.includes('--function-worker')) {
  const { runFunctionWorker } = await import(
    '#backend/shell/function-execution/local'
  );
  runFunctionWorker();
} else {
  const { runCliMain } = await import('./shell/cli/main-app');
  await runCliMain();
}
