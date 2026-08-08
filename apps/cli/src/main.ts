#!/usr/bin/env bun

export {};

declare const OMNIDRAW_PREVIEW_INSPECTION_PACKAGED_SMOKE: boolean | undefined;

const args = Bun.argv.slice(2);
const packagedPreviewInspectionSmoke = args.includes(
  '--preview-inspection-packaged-smoke',
);
const packagedSmokeAcceptanceBinary =
  typeof OMNIDRAW_PREVIEW_INSPECTION_PACKAGED_SMOKE !== 'undefined'
  && OMNIDRAW_PREVIEW_INSPECTION_PACKAGED_SMOKE === true;

if (packagedPreviewInspectionSmoke) {
  if (!packagedSmokeAcceptanceBinary) {
    process.stdout.write(`${JSON.stringify(Object.freeze({
      format: 'omnidraw.preview-inspection-packaged-smoke-result.v1',
      ok: false,
      code: 'PACKAGED_SMOKE_COMPILED_BINARY_REQUIRED',
    }))}\n`);
    process.exitCode = 1;
  } else {
    const { runPreviewInspectionPackagedSmokeCli } = await import(
      './preview-inspection-packaged-smoke'
    );
    await runPreviewInspectionPackagedSmokeCli();
  }
} else if (args.includes('--function-worker')) {
  const { runFunctionWorker } = await import(
    '@omnidraw/function-runtime/local'
  );
  runFunctionWorker();
} else {
  const { runCliMain } = await import("./main-app");
  await runCliMain();
}
