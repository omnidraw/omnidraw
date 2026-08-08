import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreviewInspectionBrowserService } from '../../cli/src/services/preview-inspection/PreviewInspectionBrowserService';
import { PreviewInspectionShellServer } from '../../cli/src/services/preview-inspection/PreviewInspectionShellServer';
import { PlaywrightPreviewInspectionShellDriver } from '../../cli/src/services/preview-inspection/PlaywrightPreviewInspectionShellDriver';
import type {
  TPreviewInspectionBrowserJob,
  TPreviewInspectionKeyboardGuardResult,
  TPreviewInspectionShellDriver,
} from '../../cli/src/services/preview-inspection/interface';
import { fnDefaultWidgetPreviewInspectionTheme } from '../../cli/src/services/fn.widget-preview-inspection';

type TFixtureKey = Readonly<{
  keyId: string;
  algorithm: 'Ed25519';
  format: 'raw';
  publicKeyBase64: string;
}>;

type TInspectionArtifact = Readonly<{
  digestSha256: string;
  bytesBase64: string;
  capsuleArtifactHash: `sha256:${string}`;
  runtimeDescriptor: TPreviewInspectionBrowserJob['artifact']['runtimeDescriptor'];
  functionDescriptors: TPreviewInspectionBrowserJob['functionDescriptors'];
  browserFunctionDescriptorsDigestSha256: string;
}>;

type TFixture = Readonly<{
  publicKeys: Readonly<{ preview: TFixtureKey; release: TFixtureKey }>;
  host: Omit<TPreviewInspectionBrowserJob['hostConfiguration'], 'signingKeys'>;
  artifacts: Readonly<{
    previewInspectionRunner: TInspectionArtifact;
    previewInspectionWebgl: TInspectionArtifact;
  }>;
}>;

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map(
    (root) => rm(root, { recursive: true, force: true }),
  ));
});

async function readFixture(): Promise<TFixture> {
  return await Bun.file(join(import.meta.dir, '..', 'generated', 'fixtures.json')).json() as TFixture;
}

describe('Preview inspection real managed runner', () => {
  test('mounts exact signed bytes, performs bounded native actions, and captures real evidence', async () => {
    const fixture = await readFixture();
    const artifact = fixture.artifacts.previewInspectionRunner;
    expect(artifact).toBeDefined();
    const tempRoot = await mkdtemp(join(tmpdir(), 'omnidraw-preview-runner-acceptance-'));
    cleanupRoots.push(tempRoot);
    const shell = new PreviewInspectionShellServer({
      distPath: join(import.meta.dir, '..', '..', 'preview-inspection-shell', 'dist'),
    });
    const actualDriver = new PlaywrightPreviewInspectionShellDriver();
    const keyboardGuardEvidence: TPreviewInspectionKeyboardGuardResult[] = [];
    const driver: TPreviewInspectionShellDriver = {
      mount: (args) => actualDriver.mount(args),
      async query(args) {
        const result = await actualDriver.query(args);
        if (
          args.target.by === 'css'
          && args.target.selector === '#stale-target'
          && result.length === 1
        ) {
          // Retain the original A116 target, then remove it through another
          // A116-resolved native click before the runner's point revalidation.
          const removers = await actualDriver.query({
            ...args,
            target: { by: 'css', selector: '#stale-remove-target' },
          });
          const remover = removers[0];
          if (removers.length !== 1 || remover === undefined) {
            throw new Error('Stale-target acceptance remover is unavailable.');
          }
          const point = await actualDriver.validateActionPoint({
            page: args.page,
            targetId: remover.id,
            signal: args.signal,
          });
          if (!point.valid || point.centerX === undefined || point.centerY === undefined) {
            throw new Error('Stale-target acceptance remover is not actionable.');
          }
          await args.page.mouse.click(point.centerX, point.centerY);
          await actualDriver.waitFrames({
            page: args.page,
            count: 1,
            timeoutMs: 5_000,
            signal: args.signal,
          });
        }
        return result;
      },
      validateActionPoint: (args) => actualDriver.validateActionPoint(args),
      validateFocusedTarget: (args) => actualDriver.validateFocusedTarget(args),
      armNativeKeyboardGuard: (args) => actualDriver.armNativeKeyboardGuard(args),
      async finishNativeKeyboardGuard(args) {
        const result = await actualDriver.finishNativeKeyboardGuard(args);
        keyboardGuardEvidence.push(result);
        return result;
      },
      waitFrames: (args) => actualDriver.waitFrames(args),
      snapshot: (args) => actualDriver.snapshot(args),
      destroy: (args) => actualDriver.destroy(args),
    };
    const service = new PreviewInspectionBrowserService({
      tempRoot: join(tempRoot, 'jobs'),
      shell,
      driver,
    });
    let bridgeDisposals = 0;
    try {
      const bytes = Uint8Array.from(Buffer.from(artifact.bytesBase64, 'base64'));
      const result = await service.run(Object.freeze({
        format: 'omnidraw.preview-inspection-browser-job.v1',
        jobId: 'real-runner-acceptance',
        ownerKey: 'acceptance-owner',
        widgetKey: 'preview-inspection-runner-acceptance',
        artifact: Object.freeze({
          bytes,
          digestSha256: artifact.digestSha256,
          capsuleArtifactHash: artifact.capsuleArtifactHash,
          runtimeDescriptor: artifact.runtimeDescriptor,
        }),
        hostConfiguration: Object.freeze({
          ...fixture.host,
          signingKeys: Object.freeze([
            fixture.publicKeys.preview,
            fixture.publicKeys.release,
          ]),
        }),
        functionDescriptors: artifact.functionDescriptors,
        browserFunctionDescriptorsDigestSha256:
          artifact.browserFunctionDescriptorsDigestSha256,
        functionBridge: Object.freeze({
          async invoke() {
            throw new Error('The acceptance artifact declares no server functions.');
          },
          dispose() { bridgeDisposals += 1; },
        }),
        theme: fnDefaultWidgetPreviewInspectionTheme(),
        viewport: Object.freeze({ width: 640, height: 480, deviceScaleFactor: 1 }),
        settleFrames: 2,
        settleTimeoutMs: 5_000,
        actions: Object.freeze([
          Object.freeze({
            type: 'click' as const,
            target: Object.freeze({
              by: 'role' as const,
              role: 'button' as const,
              name: 'Increment',
              exact: true,
            }),
          }),
          Object.freeze({
            type: 'input' as const,
            target: Object.freeze({ by: 'label' as const, text: 'None input', exact: true }),
            value: 'alpha',
            commit: 'none' as const,
          }),
          Object.freeze({
            type: 'input' as const,
            target: Object.freeze({ by: 'css' as const, selector: '#blur-input' }),
            value: 'beta',
            commit: 'blur' as const,
          }),
          Object.freeze({ type: 'waitFrames' as const, count: 3 }),
          Object.freeze({
            type: 'input' as const,
            target: Object.freeze({ by: 'label' as const, text: 'Secret input', exact: true }),
            value: 'must-not-be-sent',
          }),
          Object.freeze({
            type: 'click' as const,
            target: Object.freeze({ by: 'css' as const, selector: '#occluded-target' }),
          }),
          Object.freeze({
            type: 'click' as const,
            target: Object.freeze({ by: 'css' as const, selector: '#stale-target' }),
          }),
          Object.freeze({
            type: 'input' as const,
            target: Object.freeze({ by: 'label' as const, text: 'Redirect input', exact: true }),
            value: 'must-not-be-sent',
          }),
          Object.freeze({
            type: 'input' as const,
            target: Object.freeze({ by: 'label' as const, text: 'Key redirect input', exact: true }),
            value: 'must-not-be-sent',
          }),
          Object.freeze({
            type: 'input' as const,
            target: Object.freeze({ by: 'css' as const, selector: '#delete-guard-target' }),
            value: 'must-not-be-sent',
            commit: 'none' as const,
          }),
          Object.freeze({
            type: 'input' as const,
            target: Object.freeze({
              by: 'label' as const,
              text: 'Insert guard target',
              exact: true,
            }),
            value: 'must-not-be-sent',
            commit: 'none' as const,
          }),
          Object.freeze({
            type: 'input' as const,
            target: Object.freeze({
              by: 'label' as const,
              text: 'Enter guard target',
              exact: true,
            }),
            value: 'enter-guard-payload',
            commit: 'enter' as const,
          }),
          Object.freeze({
            type: 'input' as const,
            target: Object.freeze({
              by: 'role' as const,
              role: 'textbox' as const,
              name: 'Enter input',
              exact: true,
            }),
            value: 'gamma',
            commit: 'enter' as const,
          }),
          Object.freeze({
            type: 'click' as const,
            target: Object.freeze({
              by: 'role' as const,
              role: 'button' as const,
              name: 'Request network',
              exact: true,
            }),
          }),
          Object.freeze({
            type: 'click' as const,
            target: Object.freeze({
              by: 'role' as const,
              role: 'button' as const,
              name: 'Runtime error',
              exact: true,
            }),
          }),
          Object.freeze({ type: 'waitFrames' as const, count: 20 }),
        ]),
        continueOnActionError: true,
        timeoutMs: 120_000,
        signal: new AbortController().signal,
      }));

      expect(result).toMatchObject({
        format: 'omnidraw.preview-inspection-browser-result.v1',
        jobId: 'real-runner-acceptance',
        artifactDigestSha256: artifact.digestSha256,
        capsuleArtifactHash: artifact.capsuleArtifactHash,
        screenshotWidth: 640,
        screenshotHeight: 480,
      });
      expect(result.screenshotPng.byteLength).toBeGreaterThan(1_000);
      expect(result.actionResults.map(({ status }) => status)).toEqual([
        'passed',
        'passed',
        'passed',
        'passed',
        'unsupported',
        'occluded',
        'failed',
        'failed',
        'failed',
        'failed',
        'failed',
        'failed',
        'passed',
        'passed',
        'passed',
        'passed',
      ]);
      expect(result.actionResults[4]).toMatchObject({
        target: { sensitive: true, editable: true },
      });
      expect(result.actionResults[6]?.message).toContain('stale');
      expect(result.actionResults[7]?.message).toContain('not focused');
      expect(result.actionResults[8]?.message).toContain('not focused');
      expect(result.actionResults.slice(9, 12).every(
        ({ status }) => status === 'failed',
      )).toBe(true);
      expect(result.actionResults[9]?.message).toContain('selection outside target');
      expect(result.actionResults[12]?.status).toBe('passed');
      expect(keyboardGuardEvidence).toContainEqual(expect.objectContaining({
        operation: 'delete_backward',
        valid: false,
        reason: 'selection_outside_target',
        keydownObserved: true,
        beforeinputObserved: true,
        defaultPrevented: true,
      }));

      const visibleText = result.targets
        .flatMap((target) => [target.name, target.text])
        .filter((value): value is string => value !== undefined)
        .join(' | ');
      expect(visibleText).toContain('click:1');
      expect(visibleText).toContain('none:alpha');
      expect(visibleText).toContain('blur:beta');
      expect(visibleText).toContain('enter:gamma');
      expect(visibleText).toContain('delete-target:intact');
      expect(visibleText).toContain('delete-sink-state:intact');
      expect(visibleText).toContain('insert-target:cleared');
      expect(visibleText).toContain('insert-sink-state:intact');
      expect(visibleText).toContain('enter-target:no-newline');
      expect(visibleText).toContain('enter-sink-state:intact');
      expect(visibleText).toContain('enter-submit:none');
      expect(visibleText).not.toContain('sink:');
      expect(result.canvases.map(({ context }) => context)).toEqual(
        expect.arrayContaining(['2d']),
      );
      // Three hostile stopImmediatePropagation callback terminations, the
      // deliberate Selection-escape throw, and the deliberate runtime throw.
      expect(result.runtimeEvents).toHaveLength(5);
      expect(result.runtimeEvents.every((event) => (
        event.origin === 'guest.callback'
        && event.phase === 'vm'
        && event.code === 'GUEST_EXCEPTION'
        && event.severity === 'warning'
        && event.artifactHash === artifact.capsuleArtifactHash
      ))).toBe(true);
      expect(JSON.stringify(result)).not.toContain('preview-inspection.invalid');
      expect(JSON.stringify(result)).not.toContain(tempRoot);

      const webglArtifact = fixture.artifacts.previewInspectionWebgl;
      const webglBytes = Uint8Array.from(Buffer.from(webglArtifact.bytesBase64, 'base64'));
      const webglResult = await service.run(Object.freeze({
        format: 'omnidraw.preview-inspection-browser-job.v1',
        jobId: 'real-runner-webgl-acceptance',
        ownerKey: 'acceptance-owner',
        widgetKey: 'preview-inspection-webgl-acceptance',
        artifact: Object.freeze({
          bytes: webglBytes,
          digestSha256: webglArtifact.digestSha256,
          capsuleArtifactHash: webglArtifact.capsuleArtifactHash,
          runtimeDescriptor: webglArtifact.runtimeDescriptor,
        }),
        hostConfiguration: Object.freeze({
          ...fixture.host,
          signingKeys: Object.freeze([
            fixture.publicKeys.preview,
            fixture.publicKeys.release,
          ]),
        }),
        functionDescriptors: webglArtifact.functionDescriptors,
        browserFunctionDescriptorsDigestSha256:
          webglArtifact.browserFunctionDescriptorsDigestSha256,
        functionBridge: Object.freeze({
          async invoke() {
            throw new Error('The acceptance artifact declares no server functions.');
          },
          dispose() { bridgeDisposals += 1; },
        }),
        theme: fnDefaultWidgetPreviewInspectionTheme(),
        viewport: Object.freeze({ width: 320, height: 240, deviceScaleFactor: 1 }),
        settleFrames: 2,
        settleTimeoutMs: 5_000,
        actions: Object.freeze([]),
        continueOnActionError: false,
        timeoutMs: 120_000,
        signal: new AbortController().signal,
      }));
      expect(webglResult.canvases.map(({ context }) => context)).toContain('webgl2');
      expect(webglResult).toMatchObject({
        screenshotWidth: 320,
        screenshotHeight: 240,
      });
    } finally {
      await service.stop();
    }
    expect(bridgeDisposals).toBe(2);
  }, 180_000);
});
