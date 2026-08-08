import type {
  TPreviewInspectionBrowserJob,
  TPreviewInspectionBrowserTarget,
  TPreviewInspectionKeyboardGuardResult,
  TPreviewInspectionKeyboardGuardTicket,
  TPreviewInspectionKeyboardOperation,
  TPreviewInspectionShellDriver,
  TPreviewInspectionShellFocusedTargetCheck,
  TPreviewInspectionShellPointCheck,
  TPreviewInspectionShellSnapshot,
} from './interface';
import { PREVIEW_INSPECTION_SHELL_FORMAT } from './CONSTANTS';

type TBrowserMountJob = Readonly<{
  jobId: string;
  widgetKey: string;
  artifact: Readonly<{
    bytesBase64: string;
    digestSha256: string;
    capsuleArtifactHash: `sha256:${string}`;
    runtimeDescriptor: TPreviewInspectionBrowserJob['artifact']['runtimeDescriptor'];
  }>;
  hostConfiguration: TPreviewInspectionBrowserJob['hostConfiguration'];
  functionDescriptors: TPreviewInspectionBrowserJob['functionDescriptors'];
  browserFunctionDescriptorsDigestSha256: string;
  props?: TPreviewInspectionBrowserJob['props'];
  theme: TPreviewInspectionBrowserJob['theme'];
  viewport: TPreviewInspectionBrowserJob['viewport'];
}>;

type TInspectionWindow = Window & Readonly<{
  __OMNIDRAW_PREVIEW_INSPECTION_SHELL__?: Readonly<{
    format: string;
    mount(job: TBrowserMountJob): Promise<void>;
    query(target: unknown): readonly TPreviewInspectionBrowserTarget[];
    validateActionPoint(targetId: number): TPreviewInspectionShellPointCheck;
    validateFocusedTarget(targetId: number): TPreviewInspectionShellFocusedTargetCheck;
    armNativeKeyboardGuard(
      targetId: number,
      operation: TPreviewInspectionKeyboardOperation,
    ): TPreviewInspectionKeyboardGuardTicket;
    finishNativeKeyboardGuard(guardId: number): TPreviewInspectionKeyboardGuardResult;
    waitFrames(count: number, timeoutMs: number): Promise<void>;
    snapshot(): TPreviewInspectionShellSnapshot;
    destroy(reason: string): Promise<void>;
  }>;
}>;

function serializedJob(job: TPreviewInspectionBrowserJob): TBrowserMountJob {
  return Object.freeze({
    jobId: job.jobId,
    widgetKey: job.widgetKey,
    artifact: Object.freeze({
      bytesBase64: Buffer.from(job.artifact.bytes).toString('base64'),
      digestSha256: job.artifact.digestSha256,
      capsuleArtifactHash: job.artifact.capsuleArtifactHash,
      runtimeDescriptor: job.artifact.runtimeDescriptor,
    }),
    hostConfiguration: job.hostConfiguration,
    functionDescriptors: job.functionDescriptors,
    browserFunctionDescriptorsDigestSha256:
      job.browserFunctionDescriptorsDigestSha256,
    ...(job.props === undefined ? {} : { props: job.props }),
    theme: job.theme,
    viewport: job.viewport,
  });
}

function abortError(): Error {
  return Object.assign(new Error('Preview inspection browser job was cancelled.'), {
    code: 'PREVIEW_INSPECTION_CANCELLED',
  });
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export class PlaywrightPreviewInspectionShellDriver
implements TPreviewInspectionShellDriver {
  async mount(args: Parameters<TPreviewInspectionShellDriver['mount']>[0]): Promise<void> {
    assertActive(args.signal);
    await args.page.exposeBinding(
      '__OMNIDRAW_PREVIEW_INSPECTION_INVOKE__',
      async (_source, request: unknown) => {
        assertActive(args.signal);
        if (
          request === null
          || typeof request !== 'object'
          || Array.isArray(request)
          || typeof (request as { functionName?: unknown }).functionName !== 'string'
        ) throw new TypeError('Inspection function bridge request is invalid.');
        return args.job.functionBridge.invoke({
          functionName: (request as { functionName: string }).functionName,
          input: (request as { input?: unknown }).input,
          signal: args.signal,
        });
      },
    );
    await args.page.goto(args.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await args.page.waitForFunction(
      (format) => (
        (window as TInspectionWindow).__OMNIDRAW_PREVIEW_INSPECTION_SHELL__?.format
          === format
      ),
      PREVIEW_INSPECTION_SHELL_FORMAT,
      { timeout: 30_000 },
    );
    assertActive(args.signal);
    const serialized: unknown = serializedJob(args.job);
    await args.page.evaluate(async (job: unknown) => {
      const shell = (window as TInspectionWindow)
        .__OMNIDRAW_PREVIEW_INSPECTION_SHELL__;
      if (shell === undefined) throw new Error('Preview inspection shell is unavailable.');
      await shell.mount(job as TBrowserMountJob);
    }, serialized);
    assertActive(args.signal);
  }

  async query(
    args: Parameters<TPreviewInspectionShellDriver['query']>[0],
  ): Promise<readonly TPreviewInspectionBrowserTarget[]> {
    assertActive(args.signal);
    const result = await args.page.evaluate((target) => {
      const shell = (window as TInspectionWindow)
        .__OMNIDRAW_PREVIEW_INSPECTION_SHELL__;
      if (shell === undefined) throw new Error('Preview inspection shell is unavailable.');
      return shell.query(target);
    }, args.target);
    assertActive(args.signal);
    return Object.freeze(result.map((target) => Object.freeze(target)));
  }

  async validateActionPoint(
    args: Parameters<TPreviewInspectionShellDriver['validateActionPoint']>[0],
  ): Promise<TPreviewInspectionShellPointCheck> {
    assertActive(args.signal);
    const result = await args.page.evaluate((targetId) => {
      const shell = (window as TInspectionWindow)
        .__OMNIDRAW_PREVIEW_INSPECTION_SHELL__;
      if (shell === undefined) throw new Error('Preview inspection shell is unavailable.');
      return shell.validateActionPoint(targetId);
    }, args.targetId);
    assertActive(args.signal);
    return Object.freeze(result);
  }

  async validateFocusedTarget(
    args: Parameters<TPreviewInspectionShellDriver['validateFocusedTarget']>[0],
  ): Promise<TPreviewInspectionShellFocusedTargetCheck> {
    assertActive(args.signal);
    const result = await args.page.evaluate((targetId) => {
      const shell = (window as TInspectionWindow)
        .__OMNIDRAW_PREVIEW_INSPECTION_SHELL__;
      if (shell === undefined) throw new Error('Preview inspection shell is unavailable.');
      return shell.validateFocusedTarget(targetId);
    }, args.targetId);
    assertActive(args.signal);
    return Object.freeze(result);
  }

  async armNativeKeyboardGuard(
    args: Parameters<TPreviewInspectionShellDriver['armNativeKeyboardGuard']>[0],
  ): Promise<TPreviewInspectionKeyboardGuardTicket> {
    assertActive(args.signal);
    const result = await args.page.evaluate(({ targetId, operation }) => {
      const shell = (window as TInspectionWindow)
        .__OMNIDRAW_PREVIEW_INSPECTION_SHELL__;
      if (shell === undefined) throw new Error('Preview inspection shell is unavailable.');
      return shell.armNativeKeyboardGuard(targetId, operation);
    }, { targetId: args.targetId, operation: args.operation });
    // Once the shell has armed a guard, return its ticket even if cancellation
    // raced the evaluation so the service can finalize it in its independent
    // cleanup budget.
    return Object.freeze(result);
  }

  async finishNativeKeyboardGuard(
    args: Parameters<TPreviewInspectionShellDriver['finishNativeKeyboardGuard']>[0],
  ): Promise<TPreviewInspectionKeyboardGuardResult> {
    const result = await args.page.evaluate((guardId) => {
      const shell = (window as TInspectionWindow)
        .__OMNIDRAW_PREVIEW_INSPECTION_SHELL__;
      if (shell === undefined) throw new Error('Preview inspection shell is unavailable.');
      return shell.finishNativeKeyboardGuard(guardId);
    }, args.guardId);
    return Object.freeze(result);
  }

  async waitFrames(
    args: Parameters<TPreviewInspectionShellDriver['waitFrames']>[0],
  ): Promise<void> {
    assertActive(args.signal);
    await args.page.evaluate(async ({ count, timeoutMs }) => {
      const shell = (window as TInspectionWindow)
        .__OMNIDRAW_PREVIEW_INSPECTION_SHELL__;
      if (shell === undefined) throw new Error('Preview inspection shell is unavailable.');
      await shell.waitFrames(count, timeoutMs);
    }, { count: args.count, timeoutMs: args.timeoutMs });
    assertActive(args.signal);
  }

  async snapshot(
    args: Parameters<TPreviewInspectionShellDriver['snapshot']>[0],
  ): Promise<TPreviewInspectionShellSnapshot> {
    assertActive(args.signal);
    const result = await args.page.evaluate(() => {
      const shell = (window as TInspectionWindow)
        .__OMNIDRAW_PREVIEW_INSPECTION_SHELL__;
      if (shell === undefined) throw new Error('Preview inspection shell is unavailable.');
      return shell.snapshot();
    });
    assertActive(args.signal);
    return Object.freeze(result);
  }

  async destroy(
    args: Parameters<TPreviewInspectionShellDriver['destroy']>[0],
  ): Promise<void> {
    if (args.page.isClosed()) return;
    await args.page.evaluate(async (reason) => {
      await (window as TInspectionWindow)
        .__OMNIDRAW_PREVIEW_INSPECTION_SHELL__?.destroy(reason);
    }, args.reason).catch(() => undefined);
  }
}
