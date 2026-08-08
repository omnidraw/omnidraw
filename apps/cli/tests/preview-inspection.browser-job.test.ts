import { describe, expect, test } from 'bun:test';
import {
  PREVIEW_INSPECTION_JOB_FORMAT,
  PREVIEW_INSPECTION_LIMITS,
} from '../src/services/preview-inspection/CONSTANTS';
import {
  fnUtf8ByteLength,
  fnValidatePreviewInspectionBrowserJob,
} from '../src/services/preview-inspection/fn.validate-browser-job';
import type {
  TPreviewInspectionBrowserJob,
} from '../src/services/preview-inspection/interface';

const SHA = 'a'.repeat(64);

function job(
  override: Partial<TPreviewInspectionBrowserJob> = {},
): TPreviewInspectionBrowserJob {
  return {
    format: PREVIEW_INSPECTION_JOB_FORMAT,
    jobId: 'job-1',
    ownerKey: 'chat-1',
    widgetKey: 'counter',
    artifact: {
      bytes: new Uint8Array([1, 2, 3]),
      digestSha256: SHA,
      capsuleArtifactHash: `sha256:${SHA}`,
      runtimeDescriptor: {
        capsuleArtifactHash: `sha256:${SHA}`,
      } as TPreviewInspectionBrowserJob['artifact']['runtimeDescriptor'],
    },
    hostConfiguration: {} as TPreviewInspectionBrowserJob['hostConfiguration'],
    functionDescriptors: [],
    browserFunctionDescriptorsDigestSha256: SHA,
    functionBridge: { invoke: async () => null, dispose() {} },
    theme: {} as TPreviewInspectionBrowserJob['theme'],
    viewport: { width: 512, height: 384, deviceScaleFactor: 1 },
    settleFrames: 2,
    settleTimeoutMs: 5_000,
    actions: [],
    continueOnActionError: false,
    signal: new AbortController().signal,
    ...override,
  };
}

describe('preview inspection browser job validation', () => {
  test('accepts the bounded default job and resolves its timeout', () => {
    expect(fnValidatePreviewInspectionBrowserJob(job())).toEqual({
      ok: true,
      timeoutMs: PREVIEW_INSPECTION_LIMITS.defaultJobTimeoutMs,
    });
  });

  test('counts UTF-8 bytes and rejects unpaired surrogates', () => {
    expect(fnUtf8ByteLength('abc')).toBe(3);
    expect(fnUtf8ByteLength('é')).toBe(2);
    expect(fnUtf8ByteLength('😀')).toBe(4);
    expect(fnUtf8ByteLength('\ud800')).toBe(Number.POSITIVE_INFINITY);
  });

  test('rejects malformed identities, oversized artifacts, and cancelled jobs', () => {
    expect(fnValidatePreviewInspectionBrowserJob(job({ jobId: '../escape' })).ok)
      .toBe(false);
    expect(fnValidatePreviewInspectionBrowserJob(job({
      artifact: {
        ...job().artifact,
        bytes: new Uint8Array(PREVIEW_INSPECTION_LIMITS.maximumArtifactBytes + 1),
      },
    })).ok).toBe(false);
    const controller = new AbortController();
    controller.abort();
    expect(fnValidatePreviewInspectionBrowserJob(job({ signal: controller.signal })).ok)
      .toBe(false);
  });

  test('enforces viewport, settlement, action, and UTF-8 limits', () => {
    expect(fnValidatePreviewInspectionBrowserJob(job({
      viewport: { width: 159, height: 384, deviceScaleFactor: 1 },
    })).ok).toBe(false);
    expect(fnValidatePreviewInspectionBrowserJob(job({ settleFrames: 9 })).ok)
      .toBe(false);
    expect(fnValidatePreviewInspectionBrowserJob(job({
      actions: [{ type: 'waitFrames', count: 121 }],
    })).ok).toBe(false);
    expect(fnValidatePreviewInspectionBrowserJob(job({
      actions: [{ type: 'click', target: { by: 'css', selector: 'é'.repeat(257) } }],
    })).ok).toBe(false);
    expect(fnValidatePreviewInspectionBrowserJob(job({
      actions: [{
        type: 'input',
        target: { by: 'role', role: 'textbox' },
        value: 'x'.repeat(PREVIEW_INSPECTION_LIMITS.maximumInputValueBytes + 1),
      }],
    })).ok).toBe(false);
  });

  test('rejects decorated target records and unsupported commits', () => {
    expect(fnValidatePreviewInspectionBrowserJob(job({
      actions: [{
        type: 'click',
        target: { by: 'css', selector: 'button', hostSelector: 'body' } as never,
      }],
    })).ok).toBe(false);
    expect(fnValidatePreviewInspectionBrowserJob(job({
      actions: [{
        type: 'input',
        target: { by: 'label', text: 'Name' },
        value: 'Ada',
        commit: 'submit' as never,
      }],
    })).ok).toBe(false);
  });

  test('returns a bounded error for malformed runtime values instead of throwing', () => {
    const malformed = [
      null,
      {},
      { ...job(), artifact: null },
      { ...job(), viewport: null },
      { ...job(), actions: [null] },
      { ...job(), actions: [{ type: 'unknown' }] },
      {
        ...job(),
        actions: [{ type: 'click', target: { by: 'unsupported' } }],
      },
      { ...job(), signal: {} },
      { ...job(), leakedPath: '/private/widget.ts' },
    ];

    for (const value of malformed) {
      expect(() => fnValidatePreviewInspectionBrowserJob(value)).not.toThrow();
      expect(fnValidatePreviewInspectionBrowserJob(value)).toMatchObject({
        ok: false,
        code: 'BROWSER_JOB_INVALID',
      });
    }
  });

  test('rejects unsupported roles and Capsule artifact identity drift', () => {
    expect(fnValidatePreviewInspectionBrowserJob(job({
      actions: [{
        type: 'click',
        target: { by: 'role', role: 'tree' as never },
      }],
    })).ok).toBe(false);
    expect(fnValidatePreviewInspectionBrowserJob(job({
      artifact: {
        ...job().artifact,
        runtimeDescriptor: {
          ...job().artifact.runtimeDescriptor,
          capsuleArtifactHash: `sha256:${'b'.repeat(64)}`,
        },
      },
    })).ok).toBe(false);
  });
});
