export const PREVIEW_INSPECTION_BROWSER_RUNTIME = Object.freeze({
  packageName: 'playwright',
  packageVersion: '1.61.1',
  browserName: 'chromium',
  browserRevision: '1228',
  browserVersion: '149.0.7827.55',
});

export const PREVIEW_INSPECTION_BROWSER_LAUNCH_ARGS = Object.freeze([
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--deny-permission-prompts',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--no-service-autorun',
  '--use-angle=swiftshader',
]);

export const PREVIEW_INSPECTION_LIMITS = Object.freeze({
  maximumArtifactBytes: 16 * 1_024 * 1_024,
  maximumScreenshotBytes: 8 * 1_024 * 1_024,
  maximumActions: 16,
  maximumQueueLength: 16,
  maximumConcurrency: 2,
  maximumOwnerConcurrency: 1,
  maximumRuntimeEvents: 100,
  maximumTargets: 128,
  maximumCanvases: 16,
  maximumScannedElements: 4_096,
  minimumViewportWidth: 160,
  maximumViewportWidth: 1_280,
  minimumViewportHeight: 120,
  maximumViewportHeight: 1_024,
  minimumSettleFrames: 1,
  maximumSettleFrames: 8,
  minimumSettleTimeoutMs: 100,
  maximumSettleTimeoutMs: 10_000,
  maximumWaitFrames: 120,
  maximumJobTimeoutMs: 180_000,
  defaultJobTimeoutMs: 120_000,
  startupTimeoutMs: 30_000,
  cleanupTimeoutMs: 5_000,
  maximumSelectorBytes: 512,
  maximumAccessibleNameBytes: 256,
  maximumInspectionTextBytes: 512,
  maximumInputValueBytes: 4_096,
  maximumIdentifierBytes: 200,
});

export const PREVIEW_INSPECTION_SHELL_FORMAT =
  'omnidraw.preview-inspection-shell.v1';

export const PREVIEW_INSPECTION_JOB_FORMAT =
  'omnidraw.preview-inspection-browser-job.v1';

export const PREVIEW_INSPECTION_RESULT_FORMAT =
  'omnidraw.preview-inspection-browser-result.v1';
