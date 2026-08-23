import { describe, expect, test } from 'bun:test';
import {
  PREVIEW_INSPECTION_JOB_FORMAT,
  PREVIEW_INSPECTION_LIMITS,
} from '../src/shell/preview/CONSTANTS';
import {
  fnValidatePreviewInspectionBrowserTargets,
  fnValidatePreviewInspectionKeyboardGuardResult,
  fnValidatePreviewInspectionKeyboardGuardTicket,
  fnValidatePreviewInspectionShellFocusedTargetCheck,
  fnValidatePreviewInspectionShellPointCheck,
  fnValidatePreviewInspectionShellSnapshot,
} from '../src/shell/preview/fn.validate-browser-result';
import type {
  TPreviewInspectionBrowserJob,
  TPreviewInspectionShellSnapshot,
} from '../src/shell/preview/interface';

const SHA = 'a'.repeat(64);

function job(): TPreviewInspectionBrowserJob {
  return {
    format: PREVIEW_INSPECTION_JOB_FORMAT,
    jobId: 'job-result',
    ownerKey: 'chat-result',
    widgetKey: 'counter',
    artifact: {
      bytes: new Uint8Array([1]),
      digestSha256: SHA,
      artifactHash: `sha256:${SHA}`,
      runtimeDescriptor: {
        artifactHash: `sha256:${SHA}`,
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
  };
}

function snapshot(): TPreviewInspectionShellSnapshot {
  return {
    artifactDigestSha256: SHA,
    artifactHash: `sha256:${SHA}`,
    runtimeGeneration: 1,
    lifecycleGeneration: 2,
    scannedElements: 3,
    targets: [{
      id: 1,
      tag: 'button',
      role: 'button',
      name: 'Increment',
      bounds: { x: 10, y: 12, width: 80, height: 30 },
      computed: { display: 'block', visibility: 'visible', opacity: '1' },
      editable: false,
      sensitive: false,
    }],
    canvases: [{
      id: 1,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      width: 100,
      height: 100,
      context: '2d',
      contextLost: false,
    }],
    runtimeEvents: [{
      origin: 'capsule',
      phase: 'runtime',
      code: 'EXPECTED_WARNING',
      severity: 'warning',
      message: 'capsule EXPECTED_WARNING',
      artifactHash: `sha256:${SHA}`,
      runtimeGeneration: 1,
      lifecycleGeneration: 2,
      location: { module: 'chunks/widget-generated.js', line: 7, column: 3 },
    }],
    droppedCounts: { targets: 0, canvases: 0, runtimeEvents: 0 },
  };
}

describe('preview inspection shell snapshot validation', () => {
  test('validates bounded target queries and exact action-point records', () => {
    expect(fnValidatePreviewInspectionBrowserTargets(snapshot().targets, 2)).toBe(true);
    expect(fnValidatePreviewInspectionBrowserTargets([
      { ...snapshot().targets[0]!, role: 'navigation' },
    ], 2)).toBe(true);
    expect(fnValidatePreviewInspectionBrowserTargets([null], 2)).toBe(false);
    expect(fnValidatePreviewInspectionShellPointCheck({
      targetId: 1,
      valid: true,
      reason: 'valid',
      centerX: 50,
      centerY: 27,
    }, 1)).toBe(true);
    expect(fnValidatePreviewInspectionShellPointCheck({
      targetId: 2,
      valid: true,
      reason: 'valid',
      centerX: 50,
      centerY: 27,
    }, 1)).toBe(false);
    expect(fnValidatePreviewInspectionShellFocusedTargetCheck({
      targetId: 1,
      valid: true,
      reason: 'valid',
    }, 1)).toBe(true);
    expect(fnValidatePreviewInspectionShellFocusedTargetCheck({
      targetId: 1,
      valid: false,
      reason: 'not_focused',
    }, 1)).toBe(true);
    expect(fnValidatePreviewInspectionShellFocusedTargetCheck({
      targetId: 1,
      valid: true,
      reason: 'sensitive',
    }, 1)).toBe(false);
  });

  test('validates exact native keyboard guard identities and evidence', () => {
    const ticket = { guardId: 7, targetId: 3, operation: 'insert_text' as const };
    expect(fnValidatePreviewInspectionKeyboardGuardTicket(
      ticket,
      3,
      'insert_text',
    )).toBe(true);
    expect(fnValidatePreviewInspectionKeyboardGuardTicket(
      { ...ticket, operation: 'delete_backward' },
      3,
      'insert_text',
    )).toBe(false);
    expect(fnValidatePreviewInspectionKeyboardGuardTicket(
      { ...ticket, extra: true },
      3,
      'insert_text',
    )).toBe(false);

    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      valid: true,
      reason: 'valid',
      keydownObserved: false,
      beforeinputObserved: true,
      defaultPrevented: false,
    }, ticket)).toBe(true);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      valid: false,
      reason: 'focus_redirected',
      keydownObserved: false,
      beforeinputObserved: true,
      defaultPrevented: true,
    }, ticket)).toBe(true);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      valid: false,
      reason: 'event_missing',
      keydownObserved: false,
      beforeinputObserved: false,
      defaultPrevented: false,
    }, ticket)).toBe(true);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      valid: false,
      reason: 'event_missing',
      keydownObserved: false,
      beforeinputObserved: true,
      defaultPrevented: false,
    }, ticket)).toBe(false);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      valid: false,
      reason: 'event_missing',
      keydownObserved: false,
      beforeinputObserved: false,
      defaultPrevented: true,
    }, ticket)).toBe(false);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      guardId: 9,
      targetId: 3,
      operation: 'delete_backward',
      valid: false,
      reason: 'event_missing',
      keydownObserved: true,
      beforeinputObserved: false,
      defaultPrevented: false,
    }, {
      guardId: 9,
      targetId: 3,
      operation: 'delete_backward',
    })).toBe(false);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      valid: true,
      reason: 'valid',
      keydownObserved: false,
      beforeinputObserved: false,
      defaultPrevented: false,
    }, ticket)).toBe(false);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      valid: false,
      reason: 'selection_outside_target',
      keydownObserved: false,
      beforeinputObserved: true,
      defaultPrevented: false,
    }, ticket)).toBe(false);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      valid: true,
      reason: 'valid',
      keydownObserved: false,
      beforeinputObserved: true,
      defaultPrevented: true,
    }, ticket)).toBe(false);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      guardId: 8,
      valid: true,
      reason: 'valid',
      keydownObserved: false,
      beforeinputObserved: true,
      defaultPrevented: false,
    }, ticket)).toBe(false);
    expect(fnValidatePreviewInspectionKeyboardGuardResult({
      ...ticket,
      valid: true,
      reason: 'focus_redirected',
      keydownObserved: false,
      beforeinputObserved: true,
      defaultPrevented: true,
    }, ticket)).toBe(false);
  });

  test('accepts the exact bounded snapshot including scanned element count', () => {
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: snapshot(),
    })).toMatchObject({ ok: true });
  });

  test('rejects identity drift, duplicate records, and dishonest scan counts', () => {
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: { ...snapshot(), artifactDigestSha256: 'b'.repeat(64) },
    })).toMatchObject({ ok: false, code: 'BROWSER_RESULT_INVALID' });
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: { ...snapshot(), targets: [snapshot().targets[0]!, snapshot().targets[0]!] },
    })).toMatchObject({ ok: false, code: 'BROWSER_RESULT_INVALID' });
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: { ...snapshot(), scannedElements: 0 },
    })).toMatchObject({ ok: false, code: 'BROWSER_RESULT_INVALID' });
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: {
        ...snapshot(),
        scannedElements: PREVIEW_INSPECTION_LIMITS.maximumScannedElements + 1,
      },
    })).toMatchObject({ ok: false, code: 'BROWSER_RESULT_INVALID' });
  });

  test('rejects the retired capsuleArtifactHash shell-result field', () => {
    const current = snapshot();
    const { artifactHash: _artifactHash, ...withoutArtifactHash } = current;
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: {
        ...withoutArtifactHash,
        capsuleArtifactHash: current.artifactHash,
      },
    })).toMatchObject({ ok: false, code: 'BROWSER_RESULT_INVALID' });
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: {
        ...current,
        capsuleArtifactHash: current.artifactHash,
      },
    })).toMatchObject({ ok: false, code: 'BROWSER_RESULT_INVALID' });
  });

  test('rejects raw messages, locations, malformed nested DTOs, and never throws', () => {
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: {
        ...snapshot(),
        runtimeEvents: [{
          ...snapshot().runtimeEvents[0]!,
          message: 'failed at /Users/person/private/widget.ts?token=secret',
          location: { module: '/Users/person/private/widget.ts', line: 1, column: 1 },
        }],
      },
    })).toMatchObject({ ok: false, code: 'BROWSER_RESULT_INVALID' });
    expect(() => fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: { ...snapshot(), targets: [null] },
    })).not.toThrow();
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: { ...snapshot(), targets: [null] },
    })).toMatchObject({ ok: false, code: 'BROWSER_RESULT_INVALID' });
    expect(fnValidatePreviewInspectionShellSnapshot({
      job: job(),
      snapshot: {
        ...snapshot(),
        runtimeEvents: [{
          ...snapshot().runtimeEvents[0]!,
          runtimeGeneration: 2,
        }],
      },
    })).toMatchObject({ ok: false, code: 'BROWSER_RESULT_INVALID' });
  });
});
