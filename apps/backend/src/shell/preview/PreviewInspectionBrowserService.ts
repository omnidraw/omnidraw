import { createHash } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  PREVIEW_INSPECTION_BROWSER_RUNTIME,
  PREVIEW_INSPECTION_LIMITS,
  PREVIEW_INSPECTION_RESULT_FORMAT,
} from './CONSTANTS';
import { fnValidatePreviewInspectionBrowserJob } from './fn.validate-browser-job';
import { fnPreviewInspectionChromiumLaunchOptions } from './fn.browser-launch';
import {
  fnValidatePreviewInspectionBrowserTargets,
  fnValidatePreviewInspectionKeyboardGuardResult,
  fnValidatePreviewInspectionKeyboardGuardTicket,
  fnValidatePreviewInspectionShellFocusedTargetCheck,
  fnValidatePreviewInspectionShellPointCheck,
  fnValidatePreviewInspectionShellSnapshot,
} from './fn.validate-browser-result';
import { fnValidatePreviewInspectionPng } from './fn.png';
import {
  readPlaywrightRuntimeExecutableEvidence,
  readPlaywrightRuntimeIdentityFromEvidence,
  type TPlaywrightRuntimeExecutableEvidence,
  type TPlaywrightRuntimeIdentity,
} from './playwright-runtime-identity';
import type {
  TPreviewInspectionBrowserAction,
  TPreviewInspectionBrowserActionResult,
  TPreviewInspectionBrowserInternals,
  TPreviewInspectionBrowserJob,
  TPreviewInspectionBrowserLauncher,
  TPreviewInspectionBrowserPort,
  TPreviewInspectionBrowserPreflight,
  TPreviewInspectionBrowserResult,
  TPreviewInspectionBrowserFailureEvidence,
  TPreviewInspectionBrowserTarget,
  TPreviewInspectionFunctionBridge,
  TPreviewInspectionKeyboardGuardResult,
  TPreviewInspectionKeyboardGuardTicket,
  TPreviewInspectionKeyboardOperation,
  TPreviewInspectionShellDriver,
  TPreviewInspectionShellFocusedTargetCheck,
  TPreviewInspectionShellLease,
  TPreviewInspectionShellLeasePort,
} from './interface';
import { PlaywrightPreviewInspectionShellDriver } from './PlaywrightPreviewInspectionShellDriver';

type TQueueEntry = Readonly<{
  job: TPreviewInspectionBrowserJob;
  timeoutMs: number;
  resolve(value: TPreviewInspectionBrowserResult): void;
  reject(error: unknown): void;
  abort(): void;
}>;

type TPreviewInspectionBrowserServiceConfig = Readonly<{
  tempRoot: string;
  shell: TPreviewInspectionShellLeasePort;
  launcher?: TPreviewInspectionBrowserLauncher;
  internals?: TPreviewInspectionBrowserInternals;
  driver?: TPreviewInspectionShellDriver;
  digestSha256?: (bytes: Uint8Array) => string;
}>;

type TBrowserOperationStage = 'mount' | 'settle' | 'actions' | 'capture_screenshot';

const SERVICE_ERROR = Symbol('preview-inspection-service-error');

type TPreviewInspectionServiceError = Error & Readonly<{
  [SERVICE_ERROR]: true;
  code: string;
  retryable: boolean;
  stage?: TBrowserOperationStage;
  evidence?: TPreviewInspectionBrowserFailureEvidence;
}>;

function serviceError(
  code: string,
  message: string,
  retryable = false,
  stage?: TBrowserOperationStage,
  evidence?: TPreviewInspectionBrowserFailureEvidence,
): TPreviewInspectionServiceError {
  return Object.assign(new Error(message), {
    [SERVICE_ERROR]: true as const,
    code,
    retryable,
    ...(stage === undefined ? {} : { stage }),
    ...(evidence === undefined ? {} : { evidence }),
  });
}

function isServiceError(value: unknown): value is TPreviewInspectionServiceError {
  return value instanceof Error
    && SERVICE_ERROR in value
    && value[SERVICE_ERROR] === true;
}

export function isPreviewInspectionBrowserServiceError(
  value: unknown,
): value is TPreviewInspectionServiceError {
  return isServiceError(value);
}

function assertInspectionActive(
  signal: AbortSignal,
  stage: TBrowserOperationStage,
): void {
  if (signal.aborted) {
    throw serviceError(
      'PREVIEW_INSPECTION_CANCELLED',
      'Preview inspection browser job was cancelled.',
      true,
      stage,
    );
  }
}

type TSettledWithin<T> =
  | Readonly<{ status: 'fulfilled'; value: T }>
  | Readonly<{ status: 'rejected' | 'timed_out' }>;

async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<TSettledWithin<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TSettledWithin<T>>((resolve) => {
    timer = setTimeout(() => resolve(Object.freeze({ status: 'timed_out' })), timeoutMs);
  });
  const settled = operation.then<TSettledWithin<T>, TSettledWithin<T>>(
    (value) => Object.freeze({ status: 'fulfilled', value }),
    () => Object.freeze({ status: 'rejected' }),
  );
  const result = await Promise.race([settled, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

async function disposeFunctionBridge(
  bridge: TPreviewInspectionFunctionBridge,
): Promise<void> {
  let operation: Promise<void>;
  try {
    operation = Promise.resolve(bridge.dispose());
  } catch {
    // Cleanup is best-effort and must not replace the bounded service error.
    return;
  }
  await settleWithin(operation, PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs);
}

async function disposePossibleFunctionBridge(value: unknown): Promise<void> {
  try {
    if (
      value !== null
      && typeof value === 'object'
      && 'functionBridge' in value
    ) {
      const bridge = value.functionBridge;
      if (
        bridge !== null
        && typeof bridge === 'object'
        && 'dispose' in bridge
        && typeof bridge.dispose === 'function'
      ) {
        await disposeFunctionBridge(bridge as TPreviewInspectionFunctionBridge);
      }
    }
  } catch {
    // Malformed-job cleanup is best-effort and never exposes untrusted errors.
  }
}

type TOperationOutcome<T> =
  | Readonly<{ status: 'aborted' | 'timed_out' }>
  | Readonly<{ status: 'fulfilled'; value: T }>
  | Readonly<{ status: 'rejected'; error: unknown }>;

async function awaitBrowserOperation<T>(args: Readonly<{
  operation: Promise<T>;
  failureCode: string;
  failureMessage: string;
  stage: TBrowserOperationStage;
  retryable?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  timeoutCode?: string;
  timeoutMessage?: string;
  onLateFulfilled?(value: T): void | Promise<void>;
}>): Promise<T> {
  if (args.signal !== undefined) assertInspectionActive(args.signal, args.stage);
  const settled = args.operation.then<TOperationOutcome<T>, TOperationOutcome<T>>(
    (value) => Object.freeze({ status: 'fulfilled', value }),
    (error: unknown) => Object.freeze({ status: 'rejected', error }),
  );
  const contenders: Promise<TOperationOutcome<T>>[] = [settled];
  let abortListener: (() => void) | undefined;
  if (args.signal !== undefined) {
    contenders.push(new Promise<TOperationOutcome<T>>((resolve) => {
      abortListener = (): void => resolve(Object.freeze({ status: 'aborted' }));
      args.signal!.addEventListener('abort', abortListener, { once: true });
    }));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (args.timeoutMs !== undefined) {
    contenders.push(new Promise<TOperationOutcome<T>>((resolve) => {
      timer = setTimeout(
        () => resolve(Object.freeze({ status: 'timed_out' })),
        args.timeoutMs,
      );
    }));
  }

  const outcome = await Promise.race(contenders);
  if (timer !== undefined) clearTimeout(timer);
  if (abortListener !== undefined && args.signal !== undefined) {
    args.signal.removeEventListener('abort', abortListener);
  }
  if (outcome.status === 'fulfilled') return outcome.value;
  if (outcome.status === 'rejected') {
    if (isServiceError(outcome.error)) throw outcome.error;
    throw serviceError(
      args.failureCode,
      args.failureMessage,
      args.retryable ?? false,
      args.stage,
    );
  }
  if (args.onLateFulfilled !== undefined) {
    void settled.then(async (late) => {
      if (late.status !== 'fulfilled') return;
      await args.onLateFulfilled?.(late.value);
    }).catch(() => undefined);
  }
  if (outcome.status === 'timed_out') {
    throw serviceError(
      args.timeoutCode ?? 'BROWSER_OPERATION_TIMED_OUT',
      args.timeoutMessage ?? 'Preview inspection browser operation timed out.',
      true,
      args.stage,
    );
  }
  throw serviceError(
    'PREVIEW_INSPECTION_CANCELLED',
    'Preview inspection browser job was cancelled.',
    true,
    args.stage,
  );
}

const DEFAULT_LAUNCHER: TPreviewInspectionBrowserLauncher = Object.freeze({
  runtimeExecutableEvidence: () => readPlaywrightRuntimeExecutableEvidence(),
  runtimeIdentityFromEvidence: (evidence) => (
    readPlaywrightRuntimeIdentityFromEvidence(evidence)
  ),
  launch: async (args) => chromium.launch(
    fnPreviewInspectionChromiumLaunchOptions(args),
  ),
});

const DEFAULT_INTERNALS: TPreviewInspectionBrowserInternals = Object.freeze({
  createContext: async (browser, job) => browser.newContext({
    acceptDownloads: false,
    colorScheme: job.theme.appearance === 'dark' ? 'dark' : 'light',
    deviceScaleFactor: job.viewport.deviceScaleFactor,
    javaScriptEnabled: true,
    locale: 'en-US',
    permissions: [],
    serviceWorkers: 'block',
    timezoneId: 'UTC',
    viewport: {
      width: job.viewport.width,
      height: job.viewport.height,
    },
  }),
  createPage: async (context) => context.newPage(),
});

function pointFailureStatus(
  reason: Exclude<
    Awaited<ReturnType<TPreviewInspectionShellDriver['validateActionPoint']>>['reason'],
    'valid'
  >,
): TPreviewInspectionBrowserActionResult['status'] {
  if (reason === 'occluded') return 'occluded';
  if (reason === 'disabled') return 'disabled';
  if (reason === 'not_visible' || reason === 'outside_viewport') return 'not_visible';
  return 'failed';
}

/**
 * Process-owned Playwright/Chromium runner. The public port returns only
 * bounded DTOs and verified PNG bytes; Browser, context, page, and shell
 * handles remain private and are retired after every job.
 */
export class PreviewInspectionBrowserService
implements TPreviewInspectionBrowserPort {
  readonly name = 'preview-inspection-browser';
  readonly #config: TPreviewInspectionBrowserServiceConfig;
  readonly #launcher: TPreviewInspectionBrowserLauncher;
  readonly #internals: TPreviewInspectionBrowserInternals;
  readonly #driver: TPreviewInspectionShellDriver;
  readonly #digestSha256: (bytes: Uint8Array) => string;
  readonly #queue: TQueueEntry[] = [];
  readonly #activeOwners = new Set<string>();
  readonly #currentJobIds = new Set<string>();
  readonly #recentJobIds = new Set<string>();
  readonly #recentJobOrder: string[] = [];
  readonly #activeControllers = new Set<AbortController>();
  readonly #activeOperations = new Set<Promise<void>>();
  #activeCount = 0;
  #browserOperation: Promise<Browser> | undefined;
  #preflightOperation: Promise<TPreviewInspectionBrowserPreflight> | undefined;
  #verifiedRuntimeIdentity: TPlaywrightRuntimeIdentity | undefined;
  #stopping = false;

  constructor(config: TPreviewInspectionBrowserServiceConfig) {
    this.#config = config;
    this.#launcher = config.launcher ?? DEFAULT_LAUNCHER;
    this.#internals = config.internals ?? DEFAULT_INTERNALS;
    this.#driver = config.driver ?? new PlaywrightPreviewInspectionShellDriver();
    this.#digestSha256 = config.digestSha256
      ?? ((bytes) => createHash('sha256').update(bytes).digest('hex'));
  }

  preflight(): Promise<TPreviewInspectionBrowserPreflight> {
    this.#preflightOperation ??= this.#preflight();
    return this.#preflightOperation;
  }

  async run(job: TPreviewInspectionBrowserJob): Promise<TPreviewInspectionBrowserResult> {
    const validation = fnValidatePreviewInspectionBrowserJob(job);
    if (!validation.ok) {
      await disposePossibleFunctionBridge(job);
      throw serviceError(validation.code, validation.message, false, 'mount');
    }
    if (this.#stopping) {
      await disposeFunctionBridge(job.functionBridge);
      throw serviceError(
        'BROWSER_RUNNER_STOPPING',
        'Preview inspection browser service is stopping.',
        true,
      );
    }
    let preflight: TPreviewInspectionBrowserPreflight;
    try {
      preflight = await awaitBrowserOperation({
        operation: this.preflight(),
        failureCode: 'BROWSER_PREFLIGHT_FAILED',
        failureMessage: 'Preview inspection browser preflight failed before a job could start.',
        stage: 'mount',
        retryable: true,
        signal: job.signal,
      });
    } catch (error) {
      await disposeFunctionBridge(job.functionBridge);
      if (isServiceError(error)) throw error;
      throw serviceError(
        'BROWSER_PREFLIGHT_FAILED',
        'Preview inspection browser preflight failed before a job could start.',
        true,
        'mount',
      );
    }
    if (!preflight.ok) {
      await disposeFunctionBridge(job.functionBridge);
      throw serviceError(
        preflight.code,
        `${preflight.message} ${preflight.remediation}`,
        true,
        'mount',
      );
    }
    if (this.#stopping) {
      await disposeFunctionBridge(job.functionBridge);
      throw serviceError(
        'BROWSER_RUNNER_STOPPING',
        'Preview inspection browser service is stopping.',
        true,
      );
    }
    if (job.signal.aborted) {
      await disposeFunctionBridge(job.functionBridge);
      throw serviceError(
        'PREVIEW_INSPECTION_CANCELLED',
        'Preview inspection browser job was cancelled before it was queued.',
        true,
      );
    }
    if (this.#currentJobIds.has(job.jobId) || this.#recentJobIds.has(job.jobId)) {
      await disposeFunctionBridge(job.functionBridge);
      throw serviceError(
        'BROWSER_JOB_DUPLICATE',
        'Preview inspection job identity was already used.',
      );
    }
    if (this.#queue.length >= PREVIEW_INSPECTION_LIMITS.maximumQueueLength) {
      await disposeFunctionBridge(job.functionBridge);
      throw serviceError(
        'BROWSER_QUEUE_FULL',
        'Preview inspection browser queue is full. Retry after an active inspection finishes.',
        true,
      );
    }
    this.#rememberJobId(job.jobId);
    this.#currentJobIds.add(job.jobId);
    return new Promise<TPreviewInspectionBrowserResult>((resolve, reject) => {
      const abort = (): void => {
        const index = this.#queue.indexOf(entry);
        if (index < 0) return;
        this.#queue.splice(index, 1);
        job.signal.removeEventListener('abort', abort);
        this.#currentJobIds.delete(job.jobId);
        void disposeFunctionBridge(job.functionBridge).then(() => {
          reject(serviceError(
            'PREVIEW_INSPECTION_CANCELLED',
            'Preview inspection browser job was cancelled while queued.',
            true,
          ));
        });
      };
      const entry: TQueueEntry = Object.freeze({
        job,
        timeoutMs: validation.timeoutMs,
        resolve,
        reject,
        abort,
      });
      job.signal.addEventListener('abort', abort, { once: true });
      this.#queue.push(entry);
      if (job.signal.aborted) abort();
      else this.#drain();
    });
  }

  async stop(): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;
    const queued = this.#queue.splice(0);
    for (const controller of this.#activeControllers) {
      controller.abort('browser-service-stopping');
    }
    await Promise.all(queued.map(async (entry) => {
      entry.job.signal.removeEventListener('abort', entry.abort);
      this.#currentJobIds.delete(entry.job.jobId);
      await disposeFunctionBridge(entry.job.functionBridge);
      entry.reject(serviceError(
        'BROWSER_RUNNER_STOPPING',
        'Preview inspection browser service stopped before the job started.',
        true,
      ));
    }));
    await this.#retireBrowser();
    if (this.#preflightOperation !== undefined) {
      await settleWithin(
        this.#preflightOperation,
        PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs,
      );
    }
    await settleWithin(
      Promise.all([...this.#activeOperations]).then(() => undefined),
      PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs,
    );
    await settleWithin(
      this.#config.shell.stop(),
      PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs,
    );
    await settleWithin(
      rm(this.#config.tempRoot, { recursive: true, force: true }),
      PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs,
    );
  }

  async #preflight(): Promise<TPreviewInspectionBrowserPreflight> {
    let evidence: TPlaywrightRuntimeExecutableEvidence;
    try {
      evidence = await this.#launcher.runtimeExecutableEvidence();
    } catch {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_RUNTIME_IDENTITY_INVALID',
        message: 'The installed Playwright Chromium executable evidence could not be verified.',
        remediation: 'Run `bun --cwd apps/backend x playwright@1.61.1 install chromium`, then restart.',
      });
    }
    if (this.#stopping) {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_RUNTIME_UNAVAILABLE',
        message: 'Preview inspection browser preflight stopped before completion.',
        remediation: 'Restart Omnidraw before retrying Preview inspection.',
      });
    }
    if (
      evidence === null
      || typeof evidence !== 'object'
      || evidence.browserName !== 'chromium'
      || typeof evidence.packageVersion !== 'string'
      || typeof evidence.browserRevision !== 'string'
      || typeof evidence.executablePath !== 'string'
      || evidence.executablePath.length === 0
      || typeof evidence.executableSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(evidence.executableSha256)
    ) {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_RUNTIME_IDENTITY_INVALID',
        message: 'The installed Playwright Chromium executable evidence is malformed.',
        remediation: 'Run `bun --cwd apps/backend x playwright@1.61.1 install chromium`, then restart.',
      });
    }
    if (
      evidence.packageVersion !== PREVIEW_INSPECTION_BROWSER_RUNTIME.packageVersion
      || evidence.browserRevision !== PREVIEW_INSPECTION_BROWSER_RUNTIME.browserRevision
    ) {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_VERSION_MISMATCH',
        message: 'The installed Playwright Chromium version does not match the pinned Preview inspection runtime.',
        remediation: 'Run `bun install` from the Omnidraw workspace and restart.',
      });
    }
    let identity: TPlaywrightRuntimeIdentity;
    try {
      identity = await this.#launcher.runtimeIdentityFromEvidence(evidence);
    } catch {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_RUNTIME_IDENTITY_INVALID',
        message: 'The installed Playwright Chromium version could not be verified.',
        remediation: 'Run `bun --cwd apps/backend x playwright@1.61.1 install chromium`, then restart.',
      });
    }
    if (this.#stopping) {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_RUNTIME_UNAVAILABLE',
        message: 'Preview inspection browser preflight stopped before completion.',
        remediation: 'Restart Omnidraw before retrying Preview inspection.',
      });
    }
    if (
      identity === null
      || typeof identity !== 'object'
      || identity.packageVersion !== evidence.packageVersion
      || identity.browserName !== evidence.browserName
      || identity.browserRevision !== evidence.browserRevision
      || identity.executablePath !== evidence.executablePath
      || identity.executableSha256 !== evidence.executableSha256
      || typeof identity.browserVersion !== 'string'
    ) {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_RUNTIME_IDENTITY_INVALID',
        message: 'The installed Playwright Chromium identity is malformed.',
        remediation: 'Run `bun --cwd apps/backend x playwright@1.61.1 install chromium`, then restart.',
      });
    }
    if (identity.browserVersion !== PREVIEW_INSPECTION_BROWSER_RUNTIME.browserVersion) {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_VERSION_MISMATCH',
        message: 'The installed Playwright Chromium version does not match the pinned Preview inspection runtime.',
        remediation: 'Run `bun install` from the Omnidraw workspace and restart.',
      });
    }
    const executable = await stat(identity.executablePath).catch(() => null);
    if (executable === null || !executable.isFile()) {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_EXECUTABLE_MISSING',
        message: 'The pinned Playwright Chromium executable is not installed.',
        remediation: 'Run `bun --cwd apps/backend x playwright@1.61.1 install chromium` and restart Omnidraw.',
      });
    }
    const shellEntry = await stat(join(this.#config.shell.path, 'index.html'))
      .catch(() => null);
    if (shellEntry === null || !shellEntry.isFile()) {
      return Object.freeze({
        ok: false,
        code: 'INSPECTION_SHELL_MISSING',
        message: 'The internal Preview inspection shell is not built.',
        remediation: 'Build the frontend and restart Omnidraw.',
      });
    }
    if (this.#stopping) {
      return Object.freeze({
        ok: false,
        code: 'BROWSER_RUNTIME_UNAVAILABLE',
        message: 'Preview inspection browser preflight stopped before completion.',
        remediation: 'Restart Omnidraw before retrying Preview inspection.',
      });
    }
    await rm(this.#config.tempRoot, { recursive: true, force: true });
    await mkdir(this.#config.tempRoot, { recursive: true, mode: 0o700 });
    await mkdir(join(this.#config.tempRoot, 'browser-downloads'), {
      recursive: true,
      mode: 0o700,
    });
    this.#verifiedRuntimeIdentity = identity;
    return Object.freeze({
      ok: true,
      runtime: PREVIEW_INSPECTION_BROWSER_RUNTIME,
      executablePath: identity.executablePath,
      shellPath: this.#config.shell.path,
    });
  }

  #rememberJobId(jobId: string): void {
    this.#recentJobIds.add(jobId);
    this.#recentJobOrder.push(jobId);
    while (this.#recentJobOrder.length > 1_024) {
      const removed = this.#recentJobOrder.shift();
      if (removed !== undefined) this.#recentJobIds.delete(removed);
    }
  }

  #drain(): void {
    while (this.#activeCount < PREVIEW_INSPECTION_LIMITS.maximumConcurrency) {
      const index = this.#queue.findIndex(
        (entry) => !this.#activeOwners.has(entry.job.ownerKey),
      );
      if (index < 0) return;
      const [entry] = this.#queue.splice(index, 1);
      if (entry === undefined) return;
      entry.job.signal.removeEventListener('abort', entry.abort);
      if (entry.job.signal.aborted) {
        this.#currentJobIds.delete(entry.job.jobId);
        void disposeFunctionBridge(entry.job.functionBridge).then(() => {
          entry.reject(serviceError(
            'PREVIEW_INSPECTION_CANCELLED',
            'Preview inspection browser job was cancelled while queued.',
            true,
          ));
        });
        continue;
      }
      this.#activeCount += 1;
      this.#activeOwners.add(entry.job.ownerKey);
      let operation: Promise<void>;
      operation = this.#execute(entry).then(entry.resolve, entry.reject).finally(() => {
        this.#activeCount -= 1;
        this.#activeOwners.delete(entry.job.ownerKey);
        this.#currentJobIds.delete(entry.job.jobId);
        this.#activeOperations.delete(operation);
        this.#drain();
      });
      this.#activeOperations.add(operation);
      void operation;
    }
  }

  async #execute(entry: TQueueEntry): Promise<TPreviewInspectionBrowserResult> {
    const controller = new AbortController();
    this.#activeControllers.add(controller);
    const cancel = (): void => controller.abort('caller-cancelled');
    entry.job.signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(
      () => controller.abort('job-timeout'),
      entry.timeoutMs,
    );
    let activeStage: TBrowserOperationStage = 'mount';
    try {
      return await this.#executeInBrowser(
        entry.job,
        controller.signal,
        (stage) => { activeStage = stage; },
      );
    } catch (error) {
      if (controller.signal.aborted) {
        const timedOut = controller.signal.reason === 'job-timeout';
        const stage = isServiceError(error) && error.stage !== undefined
            ? error.stage
            : activeStage;
        throw serviceError(
          timedOut ? 'PREVIEW_INSPECTION_TIMED_OUT' : 'PREVIEW_INSPECTION_CANCELLED',
          timedOut
            ? 'Preview inspection browser job exceeded its whole-call timeout.'
            : 'Preview inspection browser job was cancelled.',
          true,
          stage,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      entry.job.signal.removeEventListener('abort', cancel);
      this.#activeControllers.delete(controller);
      await disposeFunctionBridge(entry.job.functionBridge);
    }
  }

  async #executeInBrowser(
    job: TPreviewInspectionBrowserJob,
    signal: AbortSignal,
    onStage: (stage: TBrowserOperationStage) => void,
  ): Promise<TPreviewInspectionBrowserResult> {
    onStage('mount');
    let artifactDigest: string;
    try {
      artifactDigest = this.#digestSha256(job.artifact.bytes);
    } catch {
      throw serviceError(
        'BROWSER_ARTIFACT_IDENTITY_MISMATCH',
        'Preview inspection artifact identity could not be verified.',
        false,
        'mount',
      );
    }
    if (artifactDigest !== job.artifact.digestSha256) {
      throw serviceError(
        'BROWSER_ARTIFACT_IDENTITY_MISMATCH',
        'Preview inspection artifact bytes do not match their declared digest.',
        false,
        'mount',
      );
    }
    const jobRoot = join(this.#config.tempRoot, `job-${job.jobId}`);
    let shellLease: TPreviewInspectionShellLease | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let retireBrowser = false;
    let crashed = false;
    let mounted = false;
    try {
      await awaitBrowserOperation({
        operation: mkdir(jobRoot, { recursive: true, mode: 0o700 }).then(() => undefined),
        failureCode: 'BROWSER_JOB_DIRECTORY_FAILED',
        failureMessage: 'Preview inspection could not create its isolated job directory.',
        stage: 'mount',
        signal,
        timeoutMs: PREVIEW_INSPECTION_LIMITS.startupTimeoutMs,
      });
      const activeShellLease = await awaitBrowserOperation<TPreviewInspectionShellLease>({
        operation: Promise.resolve().then(() => this.#config.shell.open(job.jobId)),
        failureCode: 'INSPECTION_SHELL_UNAVAILABLE',
        failureMessage: 'Preview inspection shell could not issue a one-time lease.',
        stage: 'mount',
        retryable: true,
        signal,
        timeoutMs: PREVIEW_INSPECTION_LIMITS.startupTimeoutMs,
        onLateFulfilled(lease) {
          try { lease.release(); } catch { /* Best-effort late cleanup. */ }
        },
      });
      shellLease = activeShellLease;
      const browser = await this.#browser(signal);
      const activeContext = await awaitBrowserOperation<BrowserContext>({
        operation: Promise.resolve().then(() => this.#internals.createContext(browser, job)),
        failureCode: 'BROWSER_CONTEXT_FAILED',
        failureMessage: 'Preview inspection could not create an isolated browser context.',
        stage: 'mount',
        retryable: true,
        signal,
        timeoutMs: PREVIEW_INSPECTION_LIMITS.startupTimeoutMs,
        onLateFulfilled: async (lateContext) => {
          await lateContext.close().catch(() => undefined);
        },
      });
      context = activeContext;
      const activePage = await awaitBrowserOperation<Page>({
        operation: Promise.resolve().then(() => this.#internals.createPage(activeContext)),
        failureCode: 'BROWSER_PAGE_FAILED',
        failureMessage: 'Preview inspection could not create an isolated browser page.',
        stage: 'mount',
        retryable: true,
        signal,
        timeoutMs: PREVIEW_INSPECTION_LIMITS.startupTimeoutMs,
        onLateFulfilled: async (latePage) => {
          await latePage.close().catch(() => undefined);
        },
      });
      page = activePage;
      activePage.on('crash', () => { crashed = true; });
      activePage.on('dialog', (dialog) => { void dialog.dismiss(); });
      activePage.on('popup', (popup) => { void popup.close(); });
      const shellOrigin = new URL(activeShellLease.url).origin;
      await awaitBrowserOperation({
        operation: activeContext.route('**/*', async (route) => {
        const url = route.request().url();
        if (!mounted && new URL(url).origin === shellOrigin) {
          await route.continue();
          return;
        }
        await route.abort('blockedbyclient');
        }),
        failureCode: 'BROWSER_NETWORK_POLICY_FAILED',
        failureMessage: 'Preview inspection could not install its deny-by-default network policy.',
        stage: 'mount',
        signal,
        timeoutMs: PREVIEW_INSPECTION_LIMITS.startupTimeoutMs,
      });
      const closeOnAbort = (): void => { void page?.close().catch(() => undefined); };
      signal.addEventListener('abort', closeOnAbort, { once: true });
      try {
        try {
          await awaitBrowserOperation({
            operation: this.#driver.mount({
              page: activePage,
              url: activeShellLease.url,
              job,
              signal,
            }),
            failureCode: 'BROWSER_MOUNT_FAILED',
            failureMessage: 'Preview inspection could not mount the exact artifact in its isolated shell.',
            stage: 'mount',
            signal,
          });
        } catch (mountError) {
          if (!signal.aborted) {
            try {
              const untrustedSnapshot = await this.#driver.snapshot({
                page: activePage,
                signal,
              });
              const snapshotValidation = fnValidatePreviewInspectionShellSnapshot({
                job,
                snapshot: untrustedSnapshot,
              });
              if (snapshotValidation.ok) {
                const snapshot = snapshotValidation.snapshot;
                throw serviceError(
                  'BROWSER_MOUNT_FAILED',
                  'Preview inspection could not mount the exact artifact in its isolated shell.',
                  false,
                  'mount',
                  Object.freeze({
                    artifactHash: snapshot.artifactHash,
                    runtimeGeneration: snapshot.runtimeGeneration,
                    lifecycleGeneration: snapshot.lifecycleGeneration,
                    runtimeEvents: snapshot.runtimeEvents,
                    droppedRuntimeEventCount: snapshot.droppedCounts.runtimeEvents,
                  }),
                );
              }
            } catch (snapshotError) {
              if (isServiceError(snapshotError) && snapshotError.evidence !== undefined) {
                throw snapshotError;
              }
              // A malformed or unavailable failure snapshot is discarded. The
              // bounded mount error below remains authoritative.
            }
          }
          throw mountError;
        }
        assertInspectionActive(signal, 'mount');
        mounted = true;
        onStage('settle');
        await awaitBrowserOperation({
          operation: this.#driver.waitFrames({
            page: activePage,
            count: job.settleFrames,
            timeoutMs: job.settleTimeoutMs,
            signal,
          }),
          failureCode: 'BROWSER_SETTLE_FAILED',
          failureMessage: 'Preview inspection failed while settling the mounted widget.',
          stage: 'settle',
          signal,
          timeoutMs: job.settleTimeoutMs,
        });
        assertInspectionActive(signal, 'settle');
        const actionResults: TPreviewInspectionBrowserActionResult[] = [];
        let priorFailure = false;
        onStage('actions');
        for (let index = 0; index < job.actions.length; index += 1) {
          const action = job.actions[index]!;
          if (priorFailure && !job.continueOnActionError) {
            actionResults.push(Object.freeze({
              index,
              type: action.type,
              status: 'skipped',
              matchedCount: 0,
              message: 'Skipped after the first failed action.',
            }));
            continue;
          }
          const result = await this.#performAction(activePage, job, action, index, signal);
          assertInspectionActive(signal, 'actions');
          actionResults.push(result);
          priorFailure ||= result.status !== 'passed';
          await awaitBrowserOperation({
            operation: this.#driver.waitFrames({
              page: activePage,
              count: job.settleFrames,
              timeoutMs: job.settleTimeoutMs,
              signal,
            }),
            failureCode: 'BROWSER_ACTION_SETTLE_FAILED',
            failureMessage: 'Preview inspection failed while settling an action.',
            stage: 'actions',
            signal,
            timeoutMs: job.settleTimeoutMs,
          });
          assertInspectionActive(signal, 'actions');
        }
        onStage('capture_screenshot');
        const screenshot = Uint8Array.from(await awaitBrowserOperation({
          operation: activePage.locator('#widget-root').screenshot({
            animations: 'allow',
            caret: 'hide',
            type: 'png',
          }),
          failureCode: 'SCREENSHOT_CAPTURE_FAILED',
          failureMessage: 'Preview inspection could not capture the isolated widget screenshot.',
          stage: 'capture_screenshot',
          signal,
        }));
        const png = fnValidatePreviewInspectionPng({
          bytes: screenshot,
          expectedWidth: job.viewport.width * job.viewport.deviceScaleFactor,
          expectedHeight: job.viewport.height * job.viewport.deviceScaleFactor,
        });
        assertInspectionActive(signal, 'capture_screenshot');
        if (!png.ok) throw serviceError(png.code, png.message, false, 'capture_screenshot');
        const untrustedSnapshot = await awaitBrowserOperation({
          operation: this.#driver.snapshot({ page: activePage, signal }),
          failureCode: 'BROWSER_RESULT_INVALID',
          failureMessage: 'Preview inspection shell could not return bounded evidence.',
          stage: 'capture_screenshot',
          signal,
        });
        const snapshotValidation = fnValidatePreviewInspectionShellSnapshot({
          job,
          snapshot: untrustedSnapshot,
        });
        assertInspectionActive(signal, 'capture_screenshot');
        if (!snapshotValidation.ok) {
          throw serviceError(
            snapshotValidation.code,
            snapshotValidation.message,
            false,
            'capture_screenshot',
          );
        }
        const snapshot = snapshotValidation.snapshot;
        if (crashed) {
          retireBrowser = true;
          throw serviceError(
            'BROWSER_PAGE_CRASHED',
            'Preview inspection page crashed.',
            true,
            'capture_screenshot',
          );
        }
        return Object.freeze({
          format: PREVIEW_INSPECTION_RESULT_FORMAT,
          jobId: job.jobId,
          artifactDigestSha256: snapshot.artifactDigestSha256,
          artifactHash: snapshot.artifactHash,
          runtimeGeneration: snapshot.runtimeGeneration,
          lifecycleGeneration: snapshot.lifecycleGeneration,
          screenshotPng: screenshot,
          screenshotDigestSha256: (() => {
            try {
              return this.#digestSha256(screenshot);
            } catch {
              throw serviceError(
                'SCREENSHOT_INVALID',
                'Preview inspection screenshot identity could not be verified.',
                false,
                'capture_screenshot',
              );
            }
          })(),
          screenshotWidth: png.width,
          screenshotHeight: png.height,
          scannedElements: snapshot.scannedElements,
          actionResults: Object.freeze(actionResults),
          targets: Object.freeze([...snapshot.targets]),
          canvases: Object.freeze([...snapshot.canvases]),
          runtimeEvents: Object.freeze([...snapshot.runtimeEvents]),
          droppedCounts: Object.freeze({ ...snapshot.droppedCounts }),
        });
      } finally {
        signal.removeEventListener('abort', closeOnAbort);
      }
    } catch (error) {
      if (crashed) retireBrowser = true;
      if (
        error instanceof Error
        && /Target page, context or browser has been closed|Browser has been closed|crash/i.test(error.message)
      ) retireBrowser = true;
      if (isServiceError(error) && error.code === 'BROWSER_RESULT_INVALID') {
        retireBrowser = true;
      }
      throw error;
    } finally {
      const cleanup = (async (): Promise<boolean> => {
        let succeeded = true;
        try {
          shellLease?.release();
        } catch {
          succeeded = false;
        }
        if (page !== undefined) {
          await this.#driver.destroy({ page, reason: 'inspection-job-finished' })
            .catch(() => { succeeded = false; });
        }
        await page?.close().catch(() => { succeeded = false; });
        await context?.close().catch(() => { succeeded = false; });
        await rm(jobRoot, { recursive: true, force: true })
          .catch(() => { succeeded = false; });
        return succeeded;
      })();
      const cleanupResult = await settleWithin(
        cleanup,
        PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs,
      );
      const cleanupFailed = cleanupResult.status !== 'fulfilled' || !cleanupResult.value;
      if (retireBrowser || cleanupFailed) await this.#retireBrowser();
    }
  }

  async #performAction(
    page: Page,
    job: TPreviewInspectionBrowserJob,
    action: TPreviewInspectionBrowserAction,
    index: number,
    signal: AbortSignal,
  ): Promise<TPreviewInspectionBrowserActionResult> {
    if (action.type === 'waitFrames') {
      try {
        await awaitBrowserOperation({
          operation: this.#driver.waitFrames({
            page,
            count: action.count,
            timeoutMs: job.settleTimeoutMs,
            signal,
          }),
          failureCode: 'BROWSER_ACTION_FAILED',
          failureMessage: 'Preview inspection animation-frame action failed.',
          stage: 'actions',
          signal,
          timeoutMs: job.settleTimeoutMs,
        });
        return Object.freeze({
          index,
          type: action.type,
          status: 'passed',
          matchedCount: 0,
          message: `Waited ${action.count} animation frame${action.count === 1 ? '' : 's'}.`,
        });
      } catch {
        assertInspectionActive(signal, 'actions');
        return Object.freeze({
          index,
          type: action.type,
          status: 'failed',
          matchedCount: 0,
          message: 'Animation-frame wait failed.',
        });
      }
    }
    let queried: unknown;
    try {
      queried = await awaitBrowserOperation({
        operation: this.#driver.query({ page, target: action.target, signal }),
        failureCode: 'BROWSER_ACTION_FAILED',
        failureMessage: 'Preview inspection target query failed.',
        stage: 'actions',
        signal,
      });
    } catch {
      assertInspectionActive(signal, 'actions');
      return Object.freeze({
        index,
        type: action.type,
        status: 'failed',
        matchedCount: 0,
        message: 'Target query failed.',
      });
    }
    if (!fnValidatePreviewInspectionBrowserTargets(queried, 2)) {
      throw serviceError(
        'BROWSER_RESULT_INVALID',
        'Preview inspection target query returned an invalid bounded result.',
        false,
        'actions',
      );
    }
    const targets = queried;
    if (targets.length === 0) {
      return Object.freeze({
        index,
        type: action.type,
        status: 'no_match',
        matchedCount: 0,
        message: 'No visible target matched.',
      });
    }
    if (targets.length !== 1) {
      return Object.freeze({
        index,
        type: action.type,
        status: 'ambiguous',
        matchedCount: targets.length,
        message: 'More than one visible target matched.',
      });
    }
    const target = targets[0]!;
    if (action.type === 'assertText') {
      if (target.sensitive) {
        return Object.freeze({
          index,
          type: action.type,
          status: 'unsupported',
          matchedCount: 1,
          message: 'Sensitive target text cannot be inspected.',
          target,
        });
      }
      const observed = target.text ?? target.name ?? '';
      const passed = action.exact === true
        ? observed === action.text
        : observed.includes(action.text);
      return Object.freeze({
        index,
        type: action.type,
        status: passed ? 'passed' : 'failed',
        matchedCount: 1,
        message: passed
          ? 'Target text assertion passed.'
          : 'Target text assertion failed.',
        target,
      });
    }
    if (action.type === 'input' && (target.sensitive || !target.editable)) {
      return Object.freeze({
        index,
        type: action.type,
        status: 'unsupported',
        matchedCount: 1,
        message: target.sensitive
          ? 'Sensitive controls cannot receive inspection input.'
          : 'The target is not an editable control.',
        target,
      });
    }
    let checked: unknown;
    try {
      checked = await awaitBrowserOperation({
        operation: this.#driver.validateActionPoint({
          page,
          targetId: target.id,
          signal,
        }),
        failureCode: 'BROWSER_ACTION_FAILED',
        failureMessage: 'Preview inspection target action-point validation failed.',
        stage: 'actions',
        signal,
      });
    } catch {
      assertInspectionActive(signal, 'actions');
      return Object.freeze({
        index,
        type: action.type,
        status: 'failed',
        matchedCount: 1,
        message: 'Target action-point validation failed.',
        target,
      });
    }
    if (!fnValidatePreviewInspectionShellPointCheck(checked, target.id)) {
      throw serviceError(
        'BROWSER_RESULT_INVALID',
        'Preview inspection target action-point validation returned an invalid result.',
        false,
        'actions',
      );
    }
    if (
      !checked.valid
      || checked.reason !== 'valid'
      || checked.centerX === undefined
      || checked.centerY === undefined
    ) {
      return Object.freeze({
        index,
        type: action.type,
        status: checked.reason === 'valid' ? 'failed' : pointFailureStatus(checked.reason),
        matchedCount: 1,
        message: `Target action point is ${checked.reason.replaceAll('_', ' ')}.`,
        target,
      });
    }
    const root = await awaitBrowserOperation({
      operation: page.locator('#widget-root').boundingBox(),
      failureCode: 'BROWSER_ACTION_FAILED',
      failureMessage: 'Preview inspection widget bounds could not be read.',
      stage: 'actions',
      signal,
    });
    if (root === null) {
      return Object.freeze({
        index,
        type: action.type,
        status: 'not_visible',
        matchedCount: 1,
        message: 'Widget viewport is not visible.',
        target,
      });
    }
    const x = root.x + checked.centerX;
    const y = root.y + checked.centerY;
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || x < root.x
      || y < root.y
      || x > root.x + root.width
      || y > root.y + root.height
    ) {
      return Object.freeze({
        index,
        type: action.type,
        status: 'not_visible',
        matchedCount: 1,
        message: 'Validated action point is outside the widget viewport.',
        target,
      });
    }
    try {
      await awaitBrowserOperation({
        operation: page.mouse.click(x, y),
        failureCode: 'BROWSER_ACTION_FAILED',
        failureMessage: 'Preview inspection native pointer action failed.',
        stage: 'actions',
        signal,
      });
      if (action.type === 'input') {
        const focusFailure = (
          focused: TPreviewInspectionShellFocusedTargetCheck,
        ): TPreviewInspectionBrowserActionResult => Object.freeze({
            index,
            type: action.type,
            status: focused.reason === 'disabled'
              ? 'disabled'
              : focused.reason === 'not_visible'
                ? 'not_visible'
                : focused.reason === 'sensitive' || focused.reason === 'not_editable'
                  ? 'unsupported'
                  : 'failed',
            matchedCount: 1,
            message: `Target did not retain safe editable focus (${focused.reason.replaceAll('_', ' ')}).`,
            target,
        });
        const requireSafeFocus = async (): Promise<
          TPreviewInspectionBrowserActionResult | undefined
        > => {
          const focused = await awaitBrowserOperation({
            operation: this.#driver.validateFocusedTarget({
              page,
              targetId: target.id,
              signal,
            }),
            failureCode: 'BROWSER_ACTION_FAILED',
            failureMessage: 'Preview inspection focused-target validation failed.',
            stage: 'actions',
            signal,
          });
          if (!fnValidatePreviewInspectionShellFocusedTargetCheck(focused, target.id)) {
            throw serviceError(
              'BROWSER_RESULT_INVALID',
              'Preview inspection focused-target validation returned an invalid result.',
              false,
              'actions',
            );
          }
          return focused.valid && focused.reason === 'valid'
            ? undefined
            : focusFailure(focused);
        };
        const pressKey = async (key: string): Promise<void> => {
          await awaitBrowserOperation({
            operation: page.keyboard.press(key),
            failureCode: 'BROWSER_ACTION_FAILED',
            failureMessage: 'Preview inspection native keyboard action failed.',
            stage: 'actions',
            signal,
          });
        };
        const guardedMutationFailure = (
          guarded: TPreviewInspectionKeyboardGuardResult,
        ): TPreviewInspectionBrowserActionResult | undefined => {
          if (guarded.valid && guarded.reason === 'valid' && !guarded.defaultPrevented) {
            return undefined;
          }
          const reason = guarded.defaultPrevented && guarded.reason === 'valid'
            ? 'default prevented'
            : guarded.reason.replaceAll('_', ' ');
          return Object.freeze({
            index,
            type: action.type,
            status: 'failed',
            matchedCount: 1,
            message: `Native keyboard mutation was blocked by the target-integrity guard (${reason}).`,
            target,
          });
        };

        let failedFocus = await requireSafeFocus();
        if (failedFocus !== undefined) return failedFocus;
        await pressKey(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        failedFocus = await requireSafeFocus();
        if (failedFocus !== undefined) return failedFocus;
        let guarded = await this.#performGuardedKeyboardMutation({
          page,
          targetId: target.id,
          operation: 'delete_backward',
          signal,
          mutate: () => page.keyboard.press('Backspace'),
        });
        let guardedFailure = guardedMutationFailure(guarded);
        if (guardedFailure !== undefined) return guardedFailure;
        failedFocus = await requireSafeFocus();
        if (failedFocus !== undefined) return failedFocus;
        if (action.value.length > 0) {
          guarded = await this.#performGuardedKeyboardMutation({
            page,
            targetId: target.id,
            operation: 'insert_text',
            signal,
            mutate: () => page.keyboard.insertText(action.value),
          });
          guardedFailure = guardedMutationFailure(guarded);
          if (guardedFailure !== undefined) return guardedFailure;
        }
        const commit = action.commit ?? 'blur';
        if (commit !== 'none') {
          failedFocus = await requireSafeFocus();
          if (failedFocus !== undefined) return failedFocus;
          if (commit === 'blur') {
            await pressKey('Tab');
          } else {
            guarded = await this.#performGuardedKeyboardMutation({
              page,
              targetId: target.id,
              operation: 'commit_enter',
              signal,
              mutate: () => page.keyboard.press('Enter'),
            });
            guardedFailure = guardedMutationFailure(guarded);
            if (guardedFailure !== undefined) return guardedFailure;
          }
        }
      }
      return Object.freeze({
        index,
        type: action.type,
        status: 'passed',
        matchedCount: 1,
        message: action.type === 'click'
          ? 'Native pointer click completed.'
          : `Native input completed with ${action.commit ?? 'blur'} commit.`,
        target,
      });
    } catch (error) {
      assertInspectionActive(signal, 'actions');
      if (isServiceError(error) && error.code === 'BROWSER_RESULT_INVALID') {
        throw error;
      }
      return Object.freeze({
        index,
        type: action.type,
        status: 'failed',
        matchedCount: 1,
        message: 'Native browser action failed.',
        target,
      });
    }
  }

  async #performGuardedKeyboardMutation(args: Readonly<{
    page: Page;
    targetId: number;
    operation: TPreviewInspectionKeyboardOperation;
    signal: AbortSignal;
    mutate(): Promise<void>;
  }>): Promise<TPreviewInspectionKeyboardGuardResult> {
    const finishLateTicket = async (
      ticket: TPreviewInspectionKeyboardGuardTicket,
    ): Promise<void> => {
      if (!fnValidatePreviewInspectionKeyboardGuardTicket(
        ticket,
        args.targetId,
        args.operation,
      )) {
        await this.#driver.destroy({
          page: args.page,
          reason: 'invalid-late-keyboard-guard-ticket',
        }).catch(() => undefined);
        await this.#retireBrowser();
        return;
      }
      const finished = await settleWithin(
        Promise.resolve().then(() => this.#driver.finishNativeKeyboardGuard({
          page: args.page,
          guardId: ticket.guardId,
        })),
        PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs,
      );
      if (
        finished.status !== 'fulfilled'
        || !fnValidatePreviewInspectionKeyboardGuardResult(finished.value, ticket)
      ) {
        await this.#driver.destroy({
          page: args.page,
          reason: 'invalid-late-keyboard-guard-result',
        }).catch(() => undefined);
        await this.#retireBrowser();
      }
    };
    const ticket = await awaitBrowserOperation({
      operation: Promise.resolve().then(() => this.#driver.armNativeKeyboardGuard({
        page: args.page,
        targetId: args.targetId,
        operation: args.operation,
        signal: args.signal,
      })),
      failureCode: 'BROWSER_ACTION_FAILED',
      failureMessage: 'Preview inspection could not arm its native keyboard target-integrity guard.',
      stage: 'actions',
      signal: args.signal,
      onLateFulfilled: finishLateTicket,
    });
    if (!fnValidatePreviewInspectionKeyboardGuardTicket(
      ticket,
      args.targetId,
      args.operation,
    )) {
      throw serviceError(
        'BROWSER_RESULT_INVALID',
        'Preview inspection native keyboard guard returned an invalid ticket.',
        false,
        'actions',
      );
    }

    let mutationError: unknown;
    let guardResult: unknown;
    try {
      await awaitBrowserOperation({
        operation: Promise.resolve().then(args.mutate),
        failureCode: 'BROWSER_ACTION_FAILED',
        failureMessage: 'Preview inspection native keyboard mutation failed.',
        stage: 'actions',
        signal: args.signal,
      });
    } catch (error) {
      mutationError = error;
    } finally {
      try {
        guardResult = await awaitBrowserOperation({
          operation: Promise.resolve().then(() => (
            this.#driver.finishNativeKeyboardGuard({
              page: args.page,
              guardId: ticket.guardId,
            })
          )),
          failureCode: 'BROWSER_RESULT_INVALID',
          failureMessage: 'Preview inspection native keyboard guard could not be finalized.',
          timeoutCode: 'BROWSER_RESULT_INVALID',
          timeoutMessage: 'Preview inspection native keyboard guard finalization timed out.',
          timeoutMs: PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs,
          stage: 'actions',
        });
      } catch (finishError) {
        if (mutationError === undefined || !args.signal.aborted) throw finishError;
      }
    }
    if (
      guardResult !== undefined
      && !fnValidatePreviewInspectionKeyboardGuardResult(guardResult, ticket)
    ) {
      throw serviceError(
        'BROWSER_RESULT_INVALID',
        'Preview inspection native keyboard guard returned an invalid final result.',
        false,
        'actions',
      );
    }
    if (mutationError !== undefined) throw mutationError;
    if (guardResult === undefined) {
      throw serviceError(
        'BROWSER_RESULT_INVALID',
        'Preview inspection native keyboard guard returned no final result.',
        false,
        'actions',
      );
    }
    return guardResult;
  }

  async #browser(signal: AbortSignal): Promise<Browser> {
    const identity = this.#verifiedRuntimeIdentity;
    if (identity === undefined) {
      throw serviceError(
        'BROWSER_PREFLIGHT_FAILED',
        'Preview inspection browser launch was attempted before verified preflight.',
        true,
        'mount',
      );
    }
    let current = this.#browserOperation;
    if (current === undefined) {
      const launched = Promise.resolve().then(() => this.#launcher.launch({
        downloadsPath: join(this.#config.tempRoot, 'browser-downloads'),
        executablePath: identity.executablePath,
        timeoutMs: PREVIEW_INSPECTION_LIMITS.startupTimeoutMs,
      }));
      let operation: Promise<Browser>;
      operation = awaitBrowserOperation({
        operation: launched,
        failureCode: 'BROWSER_LAUNCH_FAILED',
        failureMessage: 'The pinned Preview inspection browser could not launch.',
        stage: 'mount',
        retryable: true,
        timeoutMs: PREVIEW_INSPECTION_LIMITS.startupTimeoutMs,
        timeoutCode: 'BROWSER_LAUNCH_TIMED_OUT',
        timeoutMessage: 'The pinned Preview inspection browser did not launch before its deadline.',
        onLateFulfilled: async (browser) => {
          await browser.close().catch(() => undefined);
        },
      }).then((browser) => {
        browser.once('disconnected', () => {
          if (this.#browserOperation === operation) this.#browserOperation = undefined;
        });
        return browser;
      });
      this.#browserOperation = operation;
      void operation.catch(() => {
        if (this.#browserOperation === operation) this.#browserOperation = undefined;
      });
      current = operation;
    }
    return await awaitBrowserOperation({
      operation: current,
      failureCode: 'BROWSER_LAUNCH_FAILED',
      failureMessage: 'The pinned Preview inspection browser could not launch.',
      stage: 'mount',
      retryable: true,
      signal,
    });
  }

  async #retireBrowser(): Promise<void> {
    const operation = this.#browserOperation;
    this.#browserOperation = undefined;
    if (operation === undefined) return;
    const launched = await settleWithin(
      operation,
      PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs,
    );
    if (launched.status === 'fulfilled') {
      await settleWithin(
        launched.value.close(),
        PREVIEW_INSPECTION_LIMITS.cleanupTimeoutMs,
      );
      return;
    }
    if (launched.status === 'timed_out') {
      void operation.then(
        (browser) => browser.close().catch(() => undefined),
        () => undefined,
      );
    }
  }
}

export type { TPreviewInspectionBrowserServiceConfig };
