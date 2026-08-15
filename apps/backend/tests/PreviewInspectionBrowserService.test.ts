import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  PREVIEW_INSPECTION_BROWSER_RUNTIME,
  PREVIEW_INSPECTION_JOB_FORMAT,
  PREVIEW_INSPECTION_LIMITS,
} from '../src/shell/preview/CONSTANTS';
import { PreviewInspectionBrowserService } from '../src/shell/preview/PreviewInspectionBrowserService';
import { fnPreviewInspectionChromiumLaunchOptions } from '../src/shell/preview/fn.browser-launch';
import type { TPlaywrightRuntimeExecutableEvidence } from '../src/shell/preview/playwright-runtime-identity';
import type {
  TPreviewInspectionBrowserJob,
  TPreviewInspectionBrowserTarget,
  TPreviewInspectionShellDriver,
  TPreviewInspectionShellLeasePort,
} from '../src/shell/preview/interface';
import { createPngFixture } from './preview-inspection.png-fixture';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const PNG_512_384 = createPngFixture(512, 384);

function target(id = 1): TPreviewInspectionBrowserTarget {
  return Object.freeze({
    id,
    tag: 'button',
    role: 'button',
    name: 'Increment',
    bounds: { x: 10, y: 12, width: 80, height: 30 },
    computed: { display: 'block', visibility: 'visible', opacity: '1' },
    editable: false,
    sensitive: false,
  });
}

type TFakes = ReturnType<typeof createFakes>;

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function deferredValue<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> {
  let resolve = (_value: T): void => {};
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function createFakes(shellPath: string, executablePath: string) {
  const state = {
    contexts: 0,
    pages: 0,
    clicks: [] as Array<readonly [number, number]>,
    keys: [] as string[],
    inserted: [] as string[],
    guardArms: [] as string[],
    guardFinishes: [] as number[],
    disposals: 0,
    shellReleases: 0,
    launches: 0,
    browserCloses: 0,
    launchedExecutablePaths: [] as string[],
    runtimeEvidenceReads: 0,
    runtimeVersionReads: 0,
    contextCloses: 0,
    pageCloses: 0,
  };
  const browser = {
    isConnected: () => true,
    once() { return browser; },
    async close() { state.browserCloses += 1; },
  } as unknown as Browser;
  const shell: TPreviewInspectionShellLeasePort = {
    path: shellPath,
    async open() {
      return {
        url: 'http://127.0.0.1:44771/token/index.html',
        release() { state.shellReleases += 1; },
      };
    },
    async stop() {},
  };
  let nextGuardId = 1;
  const guards = new Map<number, Readonly<{
    targetId: number;
    operation: 'delete_backward' | 'insert_text' | 'commit_enter';
  }>>();
  const driver: TPreviewInspectionShellDriver = {
    async mount() {},
    async query() { return [target()]; },
    async validateActionPoint() {
      return { targetId: 1, valid: true, reason: 'valid', centerX: 50, centerY: 27 };
    },
    async validateFocusedTarget() {
      return { targetId: 1, valid: true, reason: 'valid' };
    },
    async armNativeKeyboardGuard(args) {
      const ticket = {
        guardId: nextGuardId,
        targetId: args.targetId,
        operation: args.operation,
      } as const;
      nextGuardId += 1;
      guards.set(ticket.guardId, ticket);
      state.guardArms.push(ticket.operation);
      return ticket;
    },
    async finishNativeKeyboardGuard(args) {
      state.guardFinishes.push(args.guardId);
      const ticket = guards.get(args.guardId);
      if (ticket === undefined) {
        return {
          guardId: args.guardId,
          targetId: 1,
          operation: 'delete_backward',
          valid: false,
          reason: 'stale',
          keydownObserved: false,
          beforeinputObserved: false,
          defaultPrevented: false,
        };
      }
      guards.delete(args.guardId);
      return {
        ...ticket,
        valid: true,
        reason: 'valid',
        keydownObserved: ticket.operation !== 'insert_text',
        beforeinputObserved: true,
        defaultPrevented: false,
      };
    },
    async waitFrames() {},
    async snapshot() {
      return {
        artifactDigestSha256: SHA_A,
        artifactHash: `sha256:${SHA_A}`,
        runtimeGeneration: 1,
        lifecycleGeneration: 2,
        scannedElements: 7,
        targets: [target()],
        canvases: [],
        runtimeEvents: [],
        droppedCounts: { targets: 2, canvases: 1, runtimeEvents: 0 },
      };
    },
    async destroy() {},
  };
  return {
    state,
    browser,
    shell,
    driver,
    launcher: {
      runtimeExecutableEvidence: async () => {
        state.runtimeEvidenceReads += 1;
        return {
          packageVersion: PREVIEW_INSPECTION_BROWSER_RUNTIME.packageVersion,
          browserName: 'chromium' as const,
          browserRevision: PREVIEW_INSPECTION_BROWSER_RUNTIME.browserRevision,
          executablePath,
          executableSha256: SHA_A,
        };
      },
      runtimeIdentityFromEvidence: async (evidence: TPlaywrightRuntimeExecutableEvidence) => {
        state.runtimeVersionReads += 1;
        return {
          ...evidence,
          browserVersion: PREVIEW_INSPECTION_BROWSER_RUNTIME.browserVersion,
        };
      },
      launch: async (args: Readonly<{ executablePath: string }>) => {
        state.launches += 1;
        state.launchedExecutablePaths.push(args.executablePath);
        return browser;
      },
    },
    internals: {
      async createContext() {
        state.contexts += 1;
        return {
          async route() {},
          async close() { state.contextCloses += 1; },
        } as unknown as BrowserContext;
      },
      async createPage() {
        state.pages += 1;
        let closed = false;
        const page = {
          on() { return page; },
          async exposeBinding() {},
          async goto() {},
          async waitForFunction() {},
          async evaluate() {},
          locator() {
            return {
              boundingBox: async () => ({ x: 4, y: 5, width: 512, height: 384 }),
              screenshot: async () => PNG_512_384,
            };
          },
          mouse: {
            async click(x: number, y: number) { state.clicks.push([x, y]); },
          },
          keyboard: {
            async press(key: string) { state.keys.push(key); },
            async insertText(value: string) { state.inserted.push(value); },
          },
          async close() { closed = true; state.pageCloses += 1; },
          isClosed: () => closed,
        } as unknown as Page;
        return page;
      },
    },
  };
}

function job(override: Partial<TPreviewInspectionBrowserJob> = {}): TPreviewInspectionBrowserJob {
  return {
    format: PREVIEW_INSPECTION_JOB_FORMAT,
    jobId: 'job-1',
    ownerKey: 'chat-1',
    widgetKey: 'counter',
    artifact: {
      bytes: new Uint8Array([1, 2, 3]),
      digestSha256: SHA_A,
      artifactHash: `sha256:${SHA_A}`,
      runtimeDescriptor: {
        artifactHash: `sha256:${SHA_A}`,
      } as TPreviewInspectionBrowserJob['artifact']['runtimeDescriptor'],
    },
    hostConfiguration: {} as TPreviewInspectionBrowserJob['hostConfiguration'],
    functionDescriptors: [],
    browserFunctionDescriptorsDigestSha256: SHA_A,
    functionBridge: { invoke: async () => null, dispose() {} },
    theme: { appearance: 'light' } as TPreviewInspectionBrowserJob['theme'],
    viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
    settleFrames: 2,
    settleTimeoutMs: 5_000,
    actions: [{ type: 'click', target: { by: 'role', role: 'button', name: 'Increment' } }],
    continueOnActionError: false,
    signal: new AbortController().signal,
    ...override,
  };
}

describe('PreviewInspectionBrowserService', () => {
  let root: string;
  let shellPath: string;
  let executablePath: string;
  let fakes: TFakes;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'omnidraw-preview-browser-test-'));
    shellPath = join(root, 'shell');
    executablePath = join(root, 'chromium');
    await mkdir(shellPath, { recursive: true });
    await writeFile(join(shellPath, 'index.html'), '<!doctype html>');
    await writeFile(executablePath, 'fake');
    fakes = createFakes(shellPath, executablePath);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('pins the full Chromium sandbox and deterministic software WebGL policy', () => {
    expect(fnPreviewInspectionChromiumLaunchOptions({
      downloadsPath: '/task/downloads',
      executablePath: '/managed/chromium',
      timeoutMs: 30_000,
    })).toEqual({
      headless: true,
      chromiumSandbox: true,
      downloadsPath: '/task/downloads',
      executablePath: '/managed/chromium',
      timeout: 30_000,
      args: [
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
      ],
    });
  });

  test('coalesces preflight, retries a repaired shell failure, and caches success', async () => {
    await rm(join(shellPath, 'index.html'));
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'preflight-retry-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: fakes.driver,
    });

    const first = await Promise.all([service.preflight(), service.preflight()]);
    expect(first).toEqual([
      expect.objectContaining({ ok: false, code: 'INSPECTION_SHELL_MISSING' }),
      expect.objectContaining({ ok: false, code: 'INSPECTION_SHELL_MISSING' }),
    ]);
    expect(fakes.state.runtimeEvidenceReads).toBe(1);

    await writeFile(join(shellPath, 'index.html'), '<!doctype html>');
    const repaired = await Promise.all([service.preflight(), service.preflight()]);
    expect(repaired).toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
    expect(fakes.state.runtimeEvidenceReads).toBe(2);

    await expect(service.preflight()).resolves.toMatchObject({ ok: true });
    expect(fakes.state.runtimeEvidenceReads).toBe(2);
    await service.stop();
  });

  test('uses a fresh context/page, native point action, verified PNG, and bounded DTO result', async () => {
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: fakes.driver,
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    let disposed = 0;
    const result = await service.run(job({
      functionBridge: { invoke: async () => null, dispose() { disposed += 1; } },
    }));

    expect(result).toMatchObject({
      format: 'omnidraw.preview-inspection-browser-result.v1',
      jobId: 'job-1',
      artifactDigestSha256: SHA_A,
      artifactHash: `sha256:${SHA_A}`,
      screenshotDigestSha256: SHA_B,
      screenshotWidth: 512,
      screenshotHeight: 384,
      runtimeGeneration: 1,
      lifecycleGeneration: 2,
      scannedElements: 7,
      actionResults: [{ status: 'passed', matchedCount: 1 }],
      droppedCounts: { targets: 2, canvases: 1, runtimeEvents: 0 },
    });
    expect(result).not.toHaveProperty('capsuleArtifactHash');
    expect(fakes.state.contexts).toBe(1);
    expect(fakes.state.pages).toBe(1);
    expect(fakes.state.launchedExecutablePaths).toEqual([executablePath]);
    expect(fakes.state.runtimeEvidenceReads).toBe(1);
    expect(fakes.state.runtimeVersionReads).toBe(1);
    expect(fakes.state.clicks).toEqual([[54, 32]]);
    expect(fakes.state.shellReleases).toBe(1);
    expect(fakes.state.pageCloses).toBe(1);
    expect(fakes.state.contextCloses).toBe(1);
    expect(disposed).toBe(1);
    await service.stop();
  });

  test('does not resolve a successful job until async bridge disposal settles', async () => {
    const disposalStarted = deferred();
    const releaseDisposal = deferred();
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'async-disposal-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: fakes.driver,
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    let settled = false;
    const running = service.run(job({
      jobId: 'job-async-disposal',
      functionBridge: {
        invoke: async () => null,
        async dispose() {
          disposalStarted.resolve();
          await releaseDisposal.promise;
        },
      },
    })).finally(() => { settled = true; });

    await disposalStarted.promise;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseDisposal.resolve();
    await expect(running).resolves.toMatchObject({ jobId: 'job-async-disposal' });
    expect(settled).toBe(true);
    await service.stop();
  });

  test('rejects reused job IDs and artifact identity drift', async () => {
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: fakes.driver,
      digestSha256: () => SHA_B,
    });
    await expect(service.run(job())).rejects.toMatchObject({
      code: 'BROWSER_ARTIFACT_IDENTITY_MISMATCH',
    });
    await expect(service.run(job())).rejects.toMatchObject({
      code: 'BROWSER_JOB_DUPLICATE',
    });
    await service.stop();
  });

  test('disposes the bridge on malformed jobs and thrown preflight checks', async () => {
    let invalidDisposals = 0;
    const invalidService = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'invalid-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: fakes.driver,
    });
    await expect(invalidService.run(job({
      jobId: '',
      functionBridge: {
        invoke: async () => null,
        dispose() { invalidDisposals += 1; },
      },
    }))).rejects.toMatchObject({ code: 'BROWSER_JOB_INVALID', stage: 'mount' });
    expect(invalidDisposals).toBe(1);
    expect(fakes.state.launches).toBe(0);
    await invalidService.stop();

    let preflightDisposals = 0;
    const preflightService = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'preflight-jobs'),
      shell: {
        ...fakes.shell,
        get path() { throw new Error('/private/runtime/path'); },
      },
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: fakes.driver,
    });
    await expect(preflightService.run(job({
      jobId: 'job-preflight-throw',
      functionBridge: {
        invoke: async () => null,
        dispose() { preflightDisposals += 1; },
      },
    }))).rejects.toMatchObject({ code: 'BROWSER_PREFLIGHT_FAILED', stage: 'mount' });
    expect(preflightDisposals).toBe(1);
    await preflightService.stop();
  });

  test('cleans the job directory and bridge when the shell lease fails to open', async () => {
    let disposals = 0;
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'open-failure-jobs'),
      shell: {
        ...fakes.shell,
        async open() { throw new Error('/private/shell/path?token=secret'); },
      },
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: fakes.driver,
      digestSha256: () => SHA_A,
    });
    await expect(service.run(job({
      jobId: 'job-open-failure',
      functionBridge: {
        invoke: async () => null,
        dispose() { disposals += 1; },
      },
    }))).rejects.toMatchObject({ code: 'INSPECTION_SHELL_UNAVAILABLE', stage: 'mount' });
    expect(disposals).toBe(1);
    await expect(stat(join(root, 'open-failure-jobs', 'job-job-open-failure'))).rejects.toBeDefined();
    await service.stop();
  });

  test('cancels promptly while shared preflight is still reading runtime evidence', async () => {
    const evidenceStarted = deferred();
    const pendingEvidence = deferredValue<TPlaywrightRuntimeExecutableEvidence>();
    let disposals = 0;
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'preflight-cancel-jobs'),
      shell: fakes.shell,
      launcher: {
        ...fakes.launcher,
        async runtimeExecutableEvidence() {
          evidenceStarted.resolve();
          return await pendingEvidence.promise;
        },
      },
      internals: fakes.internals,
      driver: fakes.driver,
    });
    const controller = new AbortController();
    const running = service.run(job({
      jobId: 'job-preflight-cancel',
      signal: controller.signal,
      functionBridge: {
        invoke: async () => null,
        dispose() { disposals += 1; },
      },
    }));
    await evidenceStarted.promise;
    controller.abort();
    await expect(running).rejects.toMatchObject({
      code: 'PREVIEW_INSPECTION_CANCELLED',
      stage: 'mount',
    });
    expect(disposals).toBe(1);
    expect(fakes.state.launches).toBe(0);
    pendingEvidence.resolve({
      packageVersion: PREVIEW_INSPECTION_BROWSER_RUNTIME.packageVersion,
      browserName: 'chromium',
      browserRevision: PREVIEW_INSPECTION_BROWSER_RUNTIME.browserRevision,
      executablePath,
      executableSha256: SHA_A,
    });
    await service.preflight();
    await service.stop();
  });

  test('returns an actionable deterministic preflight failure for a missing browser', async () => {
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'jobs'),
      shell: fakes.shell,
      launcher: {
        ...fakes.launcher,
        async runtimeExecutableEvidence() {
          return {
            ...await fakes.launcher.runtimeExecutableEvidence(),
            executablePath: join(root, 'missing'),
          };
        },
      },
      internals: fakes.internals,
      driver: fakes.driver,
    });
    expect(await service.preflight()).toMatchObject({
      ok: false,
      code: 'BROWSER_EXECUTABLE_MISSING',
      remediation: expect.stringContaining('playwright@1.61.1 install chromium'),
    });
    await service.stop();
  });

  test('rejects independently observed runtime version drift before execution', async () => {
    const mismatchService = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'version-mismatch-jobs'),
      shell: fakes.shell,
      launcher: {
        ...fakes.launcher,
        async runtimeExecutableEvidence() {
          return {
            ...await fakes.launcher.runtimeExecutableEvidence(),
            packageVersion: '9.9.9',
          };
        },
      },
      internals: fakes.internals,
      driver: fakes.driver,
    });
    await expect(mismatchService.preflight()).resolves.toMatchObject({
      ok: false,
      code: 'BROWSER_VERSION_MISMATCH',
    });
    expect(fakes.state.runtimeVersionReads).toBe(0);
    await mismatchService.stop();
  });

  test('shares one in-flight browser launch across concurrent fresh contexts', async () => {
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: fakes.driver,
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });

    await Promise.all([
      service.run(job({ jobId: 'job-concurrent-1', ownerKey: 'chat-1' })),
      service.run(job({ jobId: 'job-concurrent-2', ownerKey: 'chat-2' })),
    ]);

    expect(fakes.state.launches).toBe(1);
    expect(fakes.state.contexts).toBe(2);
    expect(fakes.state.pages).toBe(2);
    await service.stop();
    expect(fakes.state.browserCloses).toBe(1);
  });

  test('cancels a hanging browser launch without leaking the bridge or job directory', async () => {
    const launchStarted = deferred();
    const pendingBrowser = deferredValue<Browser>();
    let disposals = 0;
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'launch-cancel-jobs'),
      shell: fakes.shell,
      launcher: {
        ...fakes.launcher,
        async launch() {
          fakes.state.launches += 1;
          launchStarted.resolve();
          return await pendingBrowser.promise;
        },
      },
      internals: fakes.internals,
      driver: fakes.driver,
      digestSha256: () => SHA_A,
    });
    const controller = new AbortController();
    const running = service.run(job({
      jobId: 'job-launch-cancel',
      signal: controller.signal,
      functionBridge: {
        invoke: async () => null,
        dispose() { disposals += 1; },
      },
    }));
    await launchStarted.promise;
    controller.abort();
    await expect(running).rejects.toMatchObject({
      code: 'PREVIEW_INSPECTION_CANCELLED',
      stage: 'mount',
    });
    expect(disposals).toBe(1);
    expect(fakes.state.shellReleases).toBe(1);
    await expect(stat(join(root, 'launch-cancel-jobs', 'job-job-launch-cancel'))).rejects.toBeDefined();
    pendingBrowser.resolve(fakes.browser);
    await Promise.resolve();
    await service.stop();
  });

  test('races hanging context and page acquisition against cancellation and closes late handles', async () => {
    const contextStarted = deferred();
    const contextClosed = deferred();
    const pendingContext = deferredValue<BrowserContext>();
    let lateContextCloses = 0;
    const contextService = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'context-cancel-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: {
        ...fakes.internals,
        async createContext() {
          contextStarted.resolve();
          return await pendingContext.promise;
        },
      },
      driver: fakes.driver,
      digestSha256: () => SHA_A,
    });
    const contextController = new AbortController();
    const contextRun = contextService.run(job({
      jobId: 'job-context-cancel',
      signal: contextController.signal,
    }));
    await contextStarted.promise;
    contextController.abort();
    await expect(contextRun).rejects.toMatchObject({
      code: 'PREVIEW_INSPECTION_CANCELLED',
      stage: 'mount',
    });
    pendingContext.resolve({
      async close() { lateContextCloses += 1; contextClosed.resolve(); },
    } as unknown as BrowserContext);
    await contextClosed.promise;
    expect(lateContextCloses).toBe(1);
    await contextService.stop();

    const pageStarted = deferred();
    const pageClosed = deferred();
    const pendingPage = deferredValue<Page>();
    let latePageCloses = 0;
    const pageService = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'page-cancel-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: {
        ...fakes.internals,
        async createPage() {
          pageStarted.resolve();
          return await pendingPage.promise;
        },
      },
      driver: fakes.driver,
      digestSha256: () => SHA_A,
    });
    const pageController = new AbortController();
    const pageRun = pageService.run(job({
      jobId: 'job-page-cancel',
      signal: pageController.signal,
    }));
    await pageStarted.promise;
    pageController.abort();
    await expect(pageRun).rejects.toMatchObject({
      code: 'PREVIEW_INSPECTION_CANCELLED',
      stage: 'mount',
    });
    pendingPage.resolve({
      async close() { latePageCloses += 1; pageClosed.resolve(); },
    } as unknown as Page);
    await pageClosed.promise;
    expect(latePageCloses).toBe(1);
    await pageService.stop();
  });

  test('revalidates exact safe focus after native click before sending input', async () => {
    const editableTarget: TPreviewInspectionBrowserTarget = Object.freeze({
      ...target(),
      tag: 'input',
      role: 'textbox',
      name: 'Label',
      editable: true,
    });
    const driver: TPreviewInspectionShellDriver = {
      ...fakes.driver,
      async query() { return [editableTarget]; },
      async validateFocusedTarget() {
        return { targetId: 1, valid: false, reason: 'not_focused' };
      },
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'focus-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver,
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    const result = await service.run(job({
      jobId: 'job-hostile-focus-redirect',
      actions: [{
        type: 'input',
        target: { by: 'role', role: 'textbox', name: 'Label' },
        value: 'must-not-be-sent',
      }],
    }));
    expect(result.actionResults).toMatchObject([{
      status: 'failed',
      message: expect.stringContaining('not focused'),
    }]);
    expect(fakes.state.clicks).toEqual([[54, 32]]);
    expect(fakes.state.keys).toEqual([]);
    expect(fakes.state.inserted).toEqual([]);
    await service.stop();
  });

  test('stops before text mutation when select-all redirects keyboard focus', async () => {
    const editableTarget: TPreviewInspectionBrowserTarget = Object.freeze({
      ...target(),
      tag: 'input',
      role: 'textbox',
      name: 'Key redirect input',
      editable: true,
    });
    let focusChecks = 0;
    const driver: TPreviewInspectionShellDriver = {
      ...fakes.driver,
      async query() { return [editableTarget]; },
      async validateFocusedTarget() {
        focusChecks += 1;
        return focusChecks === 1
          ? { targetId: 1, valid: true, reason: 'valid' }
          : { targetId: 1, valid: false, reason: 'not_focused' };
      },
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'key-focus-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver,
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    const result = await service.run(job({
      jobId: 'job-hostile-key-focus-redirect',
      actions: [{
        type: 'input',
        target: { by: 'label', text: 'Key redirect input' },
        value: 'must-not-be-sent',
      }],
    }));
    expect(result.actionResults).toMatchObject([{
      status: 'failed',
      message: expect.stringContaining('not focused'),
    }]);
    expect(focusChecks).toBe(2);
    expect(fakes.state.keys).toEqual([
      process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
    ]);
    expect(fakes.state.inserted).toEqual([]);
    await service.stop();
  });

  test('guards each native text mutation and skips empty insertText calls', async () => {
    const editableTarget: TPreviewInspectionBrowserTarget = Object.freeze({
      ...target(),
      tag: 'input',
      role: 'textbox',
      name: 'Guarded input',
      editable: true,
    });
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'guarded-input-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: {
        ...fakes.driver,
        async query() { return [editableTarget]; },
      },
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    const result = await service.run(job({
      jobId: 'job-guarded-input',
      actions: [{
        type: 'input',
        target: { by: 'label', text: 'Guarded input' },
        value: 'hello',
        commit: 'enter',
      }, {
        type: 'input',
        target: { by: 'label', text: 'Guarded input' },
        value: '',
        commit: 'none',
      }],
    }));
    expect(result.actionResults.map(({ status }) => status)).toEqual(['passed', 'passed']);
    expect(fakes.state.guardArms).toEqual([
      'delete_backward',
      'insert_text',
      'commit_enter',
      'delete_backward',
    ]);
    expect(fakes.state.guardFinishes).toHaveLength(4);
    expect(fakes.state.inserted).toEqual(['hello']);
    expect(fakes.state.keys).toEqual([
      process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
      'Backspace',
      'Enter',
      process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
      'Backspace',
    ]);
    await service.stop();
  });

  for (const blockedOperation of [
    'delete_backward',
    'insert_text',
    'commit_enter',
  ] as const) {
    test(`blocks a hostile ${blockedOperation} default and consumes its guard`, async () => {
      const editableTarget: TPreviewInspectionBrowserTarget = Object.freeze({
        ...target(),
        tag: 'input',
        role: 'textbox',
        name: 'Hostile guarded input',
        editable: true,
      });
      let nextGuardId = 100;
      let blocked = false;
      const tickets = new Map<number, Readonly<{
        targetId: number;
        operation: 'delete_backward' | 'insert_text' | 'commit_enter';
      }>>();
      const driver: TPreviewInspectionShellDriver = {
        ...fakes.driver,
        async query() { return [editableTarget]; },
        async armNativeKeyboardGuard(args) {
          const ticket = {
            guardId: nextGuardId,
            targetId: args.targetId,
            operation: args.operation,
          } as const;
          nextGuardId += 1;
          tickets.set(ticket.guardId, ticket);
          return ticket;
        },
        async finishNativeKeyboardGuard(args) {
          const ticket = tickets.get(args.guardId);
          if (ticket === undefined) throw new Error('missing test guard');
          tickets.delete(args.guardId);
          if (!blocked && ticket.operation === blockedOperation) {
            blocked = true;
            return {
              ...ticket,
              valid: false,
              reason: blockedOperation === 'delete_backward'
                ? 'selection_outside_target'
                : 'focus_redirected',
              keydownObserved: ticket.operation !== 'insert_text',
              beforeinputObserved: true,
              defaultPrevented: true,
            };
          }
          return {
            ...ticket,
            valid: true,
            reason: 'valid',
            keydownObserved: ticket.operation !== 'insert_text',
            beforeinputObserved: true,
            defaultPrevented: false,
          };
        },
      };
      const service = new PreviewInspectionBrowserService({
        tempRoot: join(root, `hostile-${blockedOperation}-jobs`),
        shell: fakes.shell,
        launcher: fakes.launcher,
        internals: fakes.internals,
        driver,
        digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
      });
      const result = await service.run(job({
        jobId: `job-hostile-${blockedOperation}`,
        actions: [{
          type: 'input',
          target: { by: 'label', text: 'Hostile guarded input' },
          value: 'hostile',
          commit: 'enter',
        }, {
          type: 'input',
          target: { by: 'label', text: 'Hostile guarded input' },
          value: 'clean',
          commit: 'enter',
        }],
        continueOnActionError: true,
      }));
      expect(result.actionResults.map(({ status }) => status)).toEqual(['failed', 'passed']);
      expect(result.actionResults[0]?.message).toContain(
        blockedOperation === 'delete_backward'
          ? 'selection outside target'
          : 'focus redirected',
      );
      expect(blocked).toBe(true);
      expect(tickets.size).toBe(0);
      await service.stop();
    });
  }

  test('treats a mismatched guard result as terminal and retires the browser', async () => {
    const editableTarget: TPreviewInspectionBrowserTarget = Object.freeze({
      ...target(),
      tag: 'input',
      role: 'textbox',
      editable: true,
    });
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'invalid-guard-result-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: {
        ...fakes.driver,
        async query() { return [editableTarget]; },
        async finishNativeKeyboardGuard(args) {
          return {
            guardId: args.guardId + 1,
            targetId: 1,
            operation: 'delete_backward',
            valid: true,
            reason: 'valid',
            keydownObserved: true,
            beforeinputObserved: true,
            defaultPrevented: false,
          };
        },
      },
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    await expect(service.run(job({
      jobId: 'job-invalid-guard-result',
      actions: [{
        type: 'input',
        target: { by: 'css', selector: '#input' },
        value: 'unsafe',
        commit: 'none',
      }],
      continueOnActionError: true,
    }))).rejects.toMatchObject({ code: 'BROWSER_RESULT_INVALID', stage: 'actions' });
    expect(fakes.state.browserCloses).toBe(1);
    await service.stop();
  });

  test('prioritizes malformed guard evidence over a concurrent mutation failure', async () => {
    const editableTarget: TPreviewInspectionBrowserTarget = Object.freeze({
      ...target(),
      tag: 'input',
      role: 'textbox',
      editable: true,
    });
    const internals = {
      ...fakes.internals,
      async createPage() {
        const page = await fakes.internals.createPage({} as never);
        const keyboard = page.keyboard;
        const originalPress = keyboard.press.bind(keyboard);
        Object.assign(keyboard, {
          async press(key: string) {
            if (key === 'Backspace') throw new Error('native mutation failed');
            await originalPress(key);
          },
        });
        return page;
      },
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'mutation-and-guard-failure-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals,
      driver: {
        ...fakes.driver,
        async query() { return [editableTarget]; },
        async finishNativeKeyboardGuard(args) {
          return {
            guardId: args.guardId + 1,
            targetId: 1,
            operation: 'delete_backward',
            valid: true,
            reason: 'valid',
            keydownObserved: true,
            beforeinputObserved: true,
            defaultPrevented: false,
          };
        },
      },
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    await expect(service.run(job({
      jobId: 'job-mutation-and-guard-failure',
      actions: [{
        type: 'input',
        target: { by: 'css', selector: '#input' },
        value: 'unsafe',
      }],
    }))).rejects.toMatchObject({ code: 'BROWSER_RESULT_INVALID', stage: 'actions' });
    expect(fakes.state.browserCloses).toBe(1);
    await service.stop();
  });

  test('finalizes an armed guard after caller cancellation', async () => {
    const editableTarget: TPreviewInspectionBrowserTarget = Object.freeze({
      ...target(),
      tag: 'input',
      role: 'textbox',
      editable: true,
    });
    const controller = new AbortController();
    const internals = {
      ...fakes.internals,
      async createPage() {
        const page = await fakes.internals.createPage({} as never);
        const keyboard = page.keyboard;
        const originalPress = keyboard.press.bind(keyboard);
        Object.assign(keyboard, {
          async press(key: string) {
            if (key === 'Backspace') controller.abort();
            await originalPress(key);
          },
        });
        return page;
      },
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'cancelled-guard-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals,
      driver: {
        ...fakes.driver,
        async query() { return [editableTarget]; },
      },
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    await expect(service.run(job({
      jobId: 'job-cancelled-guard',
      signal: controller.signal,
      actions: [{
        type: 'input',
        target: { by: 'css', selector: '#input' },
        value: 'unsafe',
      }],
    }))).rejects.toMatchObject({ code: 'PREVIEW_INSPECTION_CANCELLED', stage: 'actions' });
    expect(fakes.state.guardArms).toEqual(['delete_backward']);
    expect(fakes.state.guardFinishes).toHaveLength(1);
    await service.stop();
  });

  test('retires the browser when a late guard ticket is malformed', async () => {
    const editableTarget: TPreviewInspectionBrowserTarget = Object.freeze({
      ...target(),
      tag: 'input',
      role: 'textbox',
      editable: true,
    });
    const armStarted = deferred();
    const pendingTicket = deferredValue<Awaited<
      ReturnType<TPreviewInspectionShellDriver['armNativeKeyboardGuard']>
    >>();
    const controller = new AbortController();
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'late-invalid-guard-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: {
        ...fakes.driver,
        async query() { return [editableTarget]; },
        async armNativeKeyboardGuard() {
          armStarted.resolve();
          return await pendingTicket.promise;
        },
      },
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    const run = service.run(job({
      jobId: 'job-late-invalid-guard',
      signal: controller.signal,
      actions: [{
        type: 'input',
        target: { by: 'css', selector: '#input' },
        value: 'unsafe',
      }],
    }));
    await armStarted.promise;
    controller.abort();
    await expect(run).rejects.toMatchObject({ code: 'PREVIEW_INSPECTION_CANCELLED' });
    pendingTicket.resolve({
      guardId: 0,
      targetId: 1,
      operation: 'delete_backward',
    });
    for (let attempt = 0; attempt < 20 && fakes.state.browserCloses === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(fakes.state.browserCloses).toBe(1);
    await service.stop();
    expect(fakes.state.browserCloses).toBe(1);
  });

  test('retires a crashed page when guard finalization fails first', async () => {
    const editableTarget: TPreviewInspectionBrowserTarget = Object.freeze({
      ...target(),
      tag: 'input',
      role: 'textbox',
      editable: true,
    });
    let emitCrash = (): void => undefined;
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'guard-crash-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: {
        ...fakes.internals,
        async createPage() {
          const page = await fakes.internals.createPage({} as never);
          Object.assign(page, {
            on(event: string, listener: (...args: readonly unknown[]) => void) {
              if (event === 'crash') emitCrash = () => listener();
              return page;
            },
          });
          return page;
        },
      },
      driver: {
        ...fakes.driver,
        async query() { return [editableTarget]; },
        async finishNativeKeyboardGuard() {
          emitCrash();
          throw new Error('page crashed while finalizing guard');
        },
      },
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    await expect(service.run(job({
      jobId: 'job-guard-crash',
      actions: [{
        type: 'input',
        target: { by: 'css', selector: '#input' },
        value: 'unsafe',
      }],
    }))).rejects.toMatchObject({ code: 'BROWSER_RESULT_INVALID', stage: 'actions' });
    expect(fakes.state.browserCloses).toBe(1);
    await service.stop();
  });

  test('disposes a queued function bridge when its caller cancels', async () => {
    const mounted = deferred();
    const releaseMount = deferred();
    const driver: TPreviewInspectionShellDriver = {
      ...fakes.driver,
      async mount() {
        mounted.resolve();
        await releaseMount.promise;
      },
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver,
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    let firstDisposals = 0;
    let queuedDisposals = 0;
    const queuedDisposalStarted = deferred();
    const releaseQueuedDisposal = deferred();
    const first = service.run(job({
      functionBridge: {
        invoke: async () => null,
        dispose() { firstDisposals += 1; },
      },
    }));
    await mounted.promise;

    const controller = new AbortController();
    const queued = service.run(job({
      jobId: 'job-queued-cancel',
      signal: controller.signal,
      functionBridge: {
        invoke: async () => null,
        async dispose() {
          queuedDisposals += 1;
          queuedDisposalStarted.resolve();
          await releaseQueuedDisposal.promise;
        },
      },
    }));
    const queuedError = queued.then(
      () => null,
      (error: unknown) => error,
    );
    await Promise.resolve();
    controller.abort();
    await queuedDisposalStarted.promise;
    let queuedSettled = false;
    void queuedError.finally(() => { queuedSettled = true; });
    await Promise.resolve();
    expect(queuedSettled).toBe(false);
    releaseQueuedDisposal.resolve();
    releaseMount.resolve();
    expect(await queuedError).toMatchObject({
      code: 'PREVIEW_INSPECTION_CANCELLED',
    });

    expect(queuedDisposals).toBe(1);
    await first;
    expect(firstDisposals).toBe(1);
    await service.stop();
  });

  test('stop disposes queued and active function bridges once', async () => {
    const mounted = deferred();
    const releaseMount = deferred();
    const driver: TPreviewInspectionShellDriver = {
      ...fakes.driver,
      async mount() {
        mounted.resolve();
        await releaseMount.promise;
      },
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver,
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    let activeDisposals = 0;
    let queuedDisposals = 0;
    const active = service.run(job({
      functionBridge: {
        invoke: async () => null,
        dispose() { activeDisposals += 1; },
      },
    }));
    const activeError = active.then(() => null, (error: unknown) => error);
    await mounted.promise;
    const queued = service.run(job({
      jobId: 'job-queued-stop',
      functionBridge: {
        invoke: async () => null,
        dispose() { queuedDisposals += 1; },
      },
    }));
    const queuedError = queued.then(() => null, (error: unknown) => error);
    await Promise.resolve();

    const stopping = service.stop();
    releaseMount.resolve();
    const [activeFailure, queuedFailure] = await Promise.all([
      activeError,
      queuedError,
      stopping,
    ]);
    expect(activeFailure).toMatchObject({ code: 'PREVIEW_INSPECTION_CANCELLED' });
    expect(queuedFailure).toMatchObject({ code: 'BROWSER_RUNNER_STOPPING' });
    expect(activeDisposals).toBe(1);
    expect(queuedDisposals).toBe(1);
  });

  test('bounds the queue and disposes every rejected or stopped bridge', async () => {
    const activeStarted = deferred();
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'queue-limit-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: {
        ...fakes.driver,
        async waitFrames() {
          activeStarted.resolve();
          return await new Promise<void>(() => undefined);
        },
      },
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    let disposals = 0;
    const bridge = Object.freeze({
      invoke: async () => null,
      dispose() { disposals += 1; },
    });
    const active = service.run(job({
      jobId: 'job-queue-active',
      functionBridge: bridge,
    })).catch((error: unknown) => error);
    await activeStarted.promise;
    const queued = Array.from(
      { length: PREVIEW_INSPECTION_LIMITS.maximumQueueLength },
      (_, index) => service.run(job({
        jobId: `job-queue-${index}`,
        functionBridge: bridge,
      })).catch((error: unknown) => error),
    );

    await expect(service.run(job({
      jobId: 'job-queue-overflow',
      functionBridge: bridge,
    }))).rejects.toMatchObject({ code: 'BROWSER_QUEUE_FULL' });
    expect(disposals).toBe(1);

    await service.stop();
    const failures = await Promise.all([active, ...queued]);
    expect(failures.every((error) => (
      error instanceof Error
      && (
        (error as Error & { code?: string }).code === 'PREVIEW_INSPECTION_CANCELLED'
        || (error as Error & { code?: string }).code === 'BROWSER_RUNNER_STOPPING'
      )
    ))).toBe(true);
    expect(disposals).toBe(PREVIEW_INSPECTION_LIMITS.maximumQueueLength + 2);
  });

  test('rejects raw runtime details from the untrusted shell snapshot', async () => {
    const driver: TPreviewInspectionShellDriver = {
      ...fakes.driver,
      async snapshot() {
        const value = await fakes.driver.snapshot({} as never);
        return {
          ...value,
          runtimeEvents: [{
            origin: 'host',
            phase: 'lifecycle',
            code: 'INSPECTION_FATAL',
            severity: 'error',
            message: 'failed at /Users/person/private/widget.ts?token=secret',
            location: { module: '/Users/person/private/widget.ts', line: 1, column: 1 },
          }],
        } as never;
      },
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver,
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    let disposals = 0;
    await expect(service.run(job({
      functionBridge: {
        invoke: async () => null,
        dispose() { disposals += 1; },
      },
    }))).rejects.toMatchObject({ code: 'BROWSER_RESULT_INVALID' });
    expect(disposals).toBe(1);
    await service.stop();
  });

  test('retains only a validated bounded runtime event when shell mount rejects', async () => {
    const driver: TPreviewInspectionShellDriver = {
      ...fakes.driver,
      async mount() {
        throw new Error('/Users/person/private/widget.ts token=secret-value');
      },
      async snapshot() {
        const value = await fakes.driver.snapshot({} as never);
        return {
          ...value,
          runtimeEvents: [{
            origin: 'guest.module',
            phase: 'startup',
            code: 'GUEST_EXCEPTION',
            severity: 'error',
            message: 'guest.module GUEST_EXCEPTION',
            artifactHash: `sha256:${SHA_A}`,
            runtimeGeneration: 1,
            lifecycleGeneration: 2,
            location: {
              module: 'chunks/widget-generated.js',
              line: 7,
              column: 3,
            },
          }],
        };
      },
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'mount-failure-evidence-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver,
      digestSha256: () => SHA_A,
    });

    const failure = await service.run(job({
      jobId: 'job-mount-failure-evidence',
      actions: [],
    })).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'BROWSER_MOUNT_FAILED',
      stage: 'mount',
      evidence: {
        artifactHash: `sha256:${SHA_A}`,
        runtimeGeneration: 1,
        lifecycleGeneration: 2,
        droppedRuntimeEventCount: 0,
        runtimeEvents: [{
          origin: 'guest.module',
          code: 'GUEST_EXCEPTION',
          message: 'guest.module GUEST_EXCEPTION',
        }],
      },
    });
    expect(JSON.stringify(failure)).not.toContain('/Users/person');
    expect(JSON.stringify(failure)).not.toContain('secret-value');
    await service.stop();
  });

  test('reports exact settle, actions, and capture failure stages', async () => {
    const settleService = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'settle-stage-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: {
        ...fakes.driver,
        async waitFrames() { throw new Error('/private/settle/path'); },
      },
      digestSha256: () => SHA_A,
    });
    await expect(settleService.run(job({ jobId: 'job-settle-stage' })))
      .rejects.toMatchObject({ code: 'BROWSER_SETTLE_FAILED', stage: 'settle' });
    await settleService.stop();

    const actionsService = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'actions-stage-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: {
        ...fakes.driver,
        async query() { return [null] as never; },
      },
      digestSha256: () => SHA_A,
    });
    await expect(actionsService.run(job({ jobId: 'job-actions-stage' })))
      .rejects.toMatchObject({ code: 'BROWSER_RESULT_INVALID', stage: 'actions' });
    await actionsService.stop();

    const captureService = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'capture-stage-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver: {
        ...fakes.driver,
        async snapshot() { throw new Error('/private/capture/path'); },
      },
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    await expect(captureService.run(job({
      jobId: 'job-capture-stage',
      actions: [],
    }))).rejects.toMatchObject({ code: 'BROWSER_RESULT_INVALID', stage: 'capture_screenshot' });
    await captureService.stop();
  });

  test('reports a page crash and retires the shared browser', async () => {
    let emitCrash = (): void => undefined;
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'page-crash-jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: {
        ...fakes.internals,
        async createPage() {
          const page = await fakes.internals.createPage({} as never);
          Object.assign(page, {
            on(event: string, listener: (...args: readonly unknown[]) => void) {
              if (event === 'crash') emitCrash = () => listener();
              return page;
            },
          });
          return page;
        },
      },
      driver: {
        ...fakes.driver,
        async snapshot(args) {
          emitCrash();
          return await fakes.driver.snapshot(args);
        },
      },
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });
    let disposals = 0;

    await expect(service.run(job({
      jobId: 'job-page-crash',
      functionBridge: {
        invoke: async () => null,
        dispose() { disposals += 1; },
      },
    }))).rejects.toMatchObject({
      code: 'BROWSER_PAGE_CRASHED',
      stage: 'capture_screenshot',
      retryable: true,
    });
    expect(disposals).toBe(1);
    expect(fakes.state.browserCloses).toBe(1);
    await service.stop();
    expect(fakes.state.browserCloses).toBe(1);
  });

  test('retires the browser after a cleanup failure', async () => {
    const driver: TPreviewInspectionShellDriver = {
      ...fakes.driver,
      async destroy() { throw new Error('cleanup failed'); },
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(root, 'jobs'),
      shell: fakes.shell,
      launcher: fakes.launcher,
      internals: fakes.internals,
      driver,
      digestSha256: (bytes) => bytes.byteLength === 3 ? SHA_A : SHA_B,
    });

    await service.run(job());
    expect(fakes.state.browserCloses).toBe(1);
    await service.stop();
    expect(fakes.state.browserCloses).toBe(1);
  });
});
