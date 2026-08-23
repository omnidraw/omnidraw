import { describe, expect, test } from 'bun:test';
import { WidgetAuthoringVerificationService } from './WidgetAuthoringVerificationService';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function passedSourceCheck() {
  return Promise.resolve({
    schemaVersion: 1 as const,
    ok: true,
    scope: 'offline-project' as const,
    checks: [],
    limitations: [
      'resource-existence-not-checked' as const,
      'preview-runtime-not-checked' as const,
    ],
    truncated: false,
  });
}

const manifest = Object.freeze({
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json' as const,
  schemaVersion: 1 as const,
  name: 'Clock',
  slug: 'clock',
  description: 'Clock fixture.',
  tool: Object.freeze({ label: 'Clock', group: null, priority: 0 }),
  ui: Object.freeze({ runtime: 'capsule' as const, entry: 'ui/main.ts', apis: ['DOM'] as const }),
});

function catalog() {
  return {
    generation: 3,
    digestSha256: SHA_B,
    entries: {
      clock: {
        slug: 'clock',
        draft: {
          health: 'healthy',
          treeDigestSha256: SHA_A,
          relativePath: 'drafts/clock',
          manifest,
        },
        published: null,
      },
    },
  };
}

function capture() {
  return {
    slug: 'clock',
    manifest,
    canonicalManifestJson: JSON.stringify(manifest),
    treeDigestSha256: SHA_C,
    fileSetDigestSha256: SHA_A,
    files: [{ path: 'ui/main.ts', bytes: new TextEncoder().encode('export default 1;') }],
  };
}

describe('WidgetAuthoringVerificationService', () => {
  test('threads caller cancellation through initial resolution for every verification operation', async () => {
    const operations = [
      {
        name: 'resolve',
        run: (service: WidgetAuthoringVerificationService, signal: AbortSignal) => service.resolve(
          { widgetKey: 'clock' },
          signal,
        ),
      },
      {
        name: 'validate',
        run: (service: WidgetAuthoringVerificationService, signal: AbortSignal) => service.validate({
          widgetKey: 'clock',
          signal,
        }),
      },
      {
        name: 'inspect',
        run: (service: WidgetAuthoringVerificationService, signal: AbortSignal) => service.inspect({
          widgetKey: 'clock',
          expectedDraftDigestSha256: SHA_C,
          expectedAcceptedGeneration: 7,
          expectedBuildIdentity: SHA_B,
          mode: 'artifact',
          includeScreenshot: false,
          operationId: 'operation-1',
          signal,
        }),
      },
    ] as const;

    for (const operation of operations) {
      let captures = 0;
      let rebuilds = 0;
      let acceptedLookups = 0;
      let inspections = 0;
      let markCaptureStarted: (() => void) | undefined;
      const captureStarted = new Promise<void>((resolve) => {
        markCaptureStarted = resolve;
      });
      const controller = new AbortController();
      const service = new WidgetAuthoringVerificationService({
        catalog: { current: catalog, refresh: async () => catalog() },
        workspace: Promise.resolve({
          rootPath: '/srv/selected/widgets',
          captureDraftBuildInput: async (args: { signal: AbortSignal }) => {
            captures += 1;
            expect(args.signal).toBe(controller.signal);
            markCaptureStarted?.();
            return await new Promise<never>((_resolve, reject) => {
              const rejectCancelled = (): void => reject(Object.assign(
                new Error(`${operation.name} cancelled`),
                { code: 'ABORT_ERR' },
              ));
              if (args.signal.aborted) rejectCancelled();
              else args.signal.addEventListener('abort', rejectCancelled, { once: true });
            });
          },
        }),
        buildGenerations: {
          async rebuild() {
            rebuilds += 1;
            throw new Error('must not build');
          },
          async requireCurrent() {
            acceptedLookups += 1;
            throw new Error('must not inspect accepted state');
          },
          async view() { return { diagnostics: [] }; },
        },
        sourceCheck: passedSourceCheck,
        preview: {
          async inspect() {
            inspections += 1;
            throw new Error('must not inspect');
          },
        },
        screenshotLeases: { issue() { throw new Error('must not issue'); } },
      } as never);

      const pending = operation.run(service, controller.signal);
      await captureStarted;
      controller.abort('test-cancelled');

      await expect(pending).rejects.toMatchObject({ code: 'ABORT_ERR' });
      expect(captures).toBe(1);
      expect(rebuilds).toBe(0);
      expect(acceptedLookups).toBe(0);
      expect(inspections).toBe(0);
    }
  });

  test('reports source success separately when the real accepted host build fails', async () => {
    let rebuilds = 0;
    const service = new WidgetAuthoringVerificationService({
      catalog: { current: catalog, refresh: async () => catalog() },
      workspace: Promise.resolve({
        rootPath: '/srv/selected/widgets',
        captureDraftBuildInput: async () => capture(),
      }),
      buildGenerations: {
        async rebuild() {
          rebuilds += 1;
          throw Object.assign(new Error('/private/build/path failed'), { code: 'BUILD_IMPORT_FAILED' });
        },
        async requireCurrent() { throw new Error('not used'); },
        async view() {
          return {
            diagnostics: [{
              code: 'BUILD_IMPORT_FAILED',
              message: 'C:\\Users\\operator\\private-build failed token=private-value',
              path: 'C:/Users/operator/private-build.ts',
            }],
          };
        },
      },
      sourceCheck: passedSourceCheck,
      preview: { async inspect() { throw new Error('not used'); } },
      screenshotLeases: { issue() { throw new Error('not used'); } },
    } as never);

    const resolved = await service.resolve({ widgetKey: 'clock' });
    expect(resolved).toMatchObject({
      widgetKey: 'clock',
      draftPath: '/srv/selected/widgets/drafts/clock',
      catalogGeneration: 3,
      draftDigestSha256: SHA_C,
    });

    const result = await service.validate({ widgetKey: 'clock' });
    expect(rebuilds).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      sourceValidation: { status: 'passed' },
      acceptedArtifactBuild: {
        status: 'failed',
        diagnostics: [{
          code: 'BUILD_IMPORT_FAILED',
          message: 'widget://project failed token=[redacted]',
          path: null,
        }],
      },
      livePreviewRuntime: 'not_exercised',
      resources: 'not_exercised',
    });
  });

  test('rejects an accepted-generation fence before browser inspection', async () => {
    let inspections = 0;
    const service = new WidgetAuthoringVerificationService({
      catalog: { current: catalog, refresh: async () => catalog() },
      workspace: Promise.resolve({
        rootPath: '/srv/selected/widgets',
        captureDraftBuildInput: async () => capture(),
      }),
      buildGenerations: {
        async rebuild() { throw new Error('not used'); },
        async requireCurrent() {
          return {
            generation: 8,
            receipt: { buildIdentity: SHA_B },
            capture: capture(),
          };
        },
        async view() { return { diagnostics: [] }; },
      },
      sourceCheck: passedSourceCheck,
      preview: {
        async inspect() {
          inspections += 1;
          throw new Error('must not inspect');
        },
      },
      screenshotLeases: { issue() { throw new Error('not used'); } },
    } as never);

    await expect(service.inspect({
      widgetKey: 'clock',
      expectedDraftDigestSha256: SHA_C,
      expectedAcceptedGeneration: 7,
      expectedBuildIdentity: SHA_B,
      mode: 'artifact',
      includeScreenshot: false,
      operationId: 'operation-1',
    })).rejects.toMatchObject({ code: 'PREVIEW_GENERATION_CHANGED' });
    expect(inspections).toBe(0);
  });

  test('uses the captured build-tree digest while fencing catalog file-set identity', async () => {
    const service = new WidgetAuthoringVerificationService({
      catalog: { current: catalog, refresh: async () => catalog() },
      workspace: Promise.resolve({
        rootPath: '/srv/selected/widgets',
        captureDraftBuildInput: async () => capture(),
      }),
      buildGenerations: {
        async rebuild() {
          return {
            widgetKey: 'clock',
            generation: 9,
            capture: capture(),
            receipt: {
              executableInputDigestSha256: SHA_B,
              buildIdentity: SHA_A,
            },
          };
        },
        async requireCurrent() { throw new Error('not used'); },
        async view() { return { diagnostics: [] }; },
      },
      sourceCheck: passedSourceCheck,
      preview: { async inspect() { throw new Error('not used'); } },
      screenshotLeases: { issue() { throw new Error('not used'); } },
    } as never);

    const result = await service.validate({
      widgetKey: 'clock',
      expectedDraftDigestSha256: SHA_C,
    });
    expect(result).toMatchObject({
      ok: true,
      capturedDraftDigestSha256: SHA_C,
      acceptedGeneration: 9,
      buildIdentity: SHA_A,
    });
  });

  test('rejects current SDK source-policy diagnostics before host build acceptance', async () => {
    let rebuilds = 0;
    const service = new WidgetAuthoringVerificationService({
      catalog: { current: catalog, refresh: async () => catalog() },
      workspace: Promise.resolve({
        rootPath: '/srv/selected/widgets',
        captureDraftBuildInput: async () => capture(),
      }),
      buildGenerations: {
        async rebuild() {
          rebuilds += 1;
          throw new Error('must not build rejected source');
        },
        async requireCurrent() { throw new Error('not used'); },
        async view() { return { diagnostics: [] }; },
      },
      sourceCheck: async ({ files, canonicalManifestJson }) => {
        expect(files.map((file) => file.path)).toEqual(['ui/main.ts']);
        expect(JSON.parse(canonicalManifestJson)).toMatchObject({ slug: 'clock' });
        return {
          schemaVersion: 1,
          ok: false,
          scope: 'offline-project',
          checks: [{
            phase: 'policy',
            code: 'SOURCE_DOM_EVENT_UNSUPPORTED',
            severity: 'error',
            summary: 'window.addEventListener("pagehide", ...) is unsupported by this widget API profile. Remove it and rely on host disposal for cleanup.',
            location: { file: 'widget://ui/main.ts', line: 173, column: 1 },
          }],
          limitations: ['resource-existence-not-checked', 'preview-runtime-not-checked'],
          truncated: false,
        };
      },
      preview: { async inspect() { throw new Error('not used'); } },
      screenshotLeases: { issue() { throw new Error('not used'); } },
    } as never);

    const result = await service.validate({ widgetKey: 'clock' });
    expect(rebuilds).toBe(0);
    expect(result).toMatchObject({
      ok: false,
      sourceValidation: {
        status: 'failed',
        diagnostics: [{
          code: 'SOURCE_DOM_EVENT_UNSUPPORTED',
          path: 'ui/main.ts',
          message: 'Line 173, column 1: window.addEventListener("pagehide", ...) is unsupported by this widget API profile. Remove it and rely on host disposal for cleanup.',
        }],
      },
      acceptedArtifactBuild: { status: 'not_run', diagnostics: [] },
    });
  });
});
