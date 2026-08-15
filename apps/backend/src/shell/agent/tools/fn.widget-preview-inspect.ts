import { fnNormalizeWidgetName } from '../workspace/fn.names';
import type {
  TWidgetPreviewInspectAction,
  TWidgetPreviewInspectNormalizedAction,
  TWidgetPreviewInspectNormalizedInput,
  TWidgetPreviewInspectResult,
  TWidgetPreviewInspectTarget,
  TInspectDiagnostic,
  TInspectElement,
  TInspectFunctional,
  TInspectActionResult,
} from './types';

type TNormalizeResult =
  | Readonly<{ ok: true; value: TWidgetPreviewInspectNormalizedInput }>
  | Readonly<{ ok: false; message: string }>;

type TObservedPng = Readonly<{
  byteSize: number;
  digestSha256: string;
  width: number;
  height: number;
}>;

type TProtocolArgs = Readonly<{
  result: TWidgetPreviewInspectResult;
  expectedName: string;
  expectedWidgetKey: string;
  input: TWidgetPreviewInspectNormalizedInput;
  observedPng?: TObservedPng;
}>;

type TProtocolResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; message: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) length += 1;
    else if (codePoint <= 0x7ff) length += 2;
    else if (codePoint <= 0xffff) length += 3;
    else length += 4;
  }
  return length;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isSafeWidgetLocation(value: string): boolean {
  if (!value.startsWith('widget://')) return false;
  const path = value.slice('widget://'.length);
  return path.length >= 1
    && path.length <= 500
    && /^(?!(?:\.{1,2})(?:\/|$))[A-Za-z0-9@_+.,=~-]+(?:\/(?!(?:\.{1,2})(?:\/|$))[A-Za-z0-9@_+.,=~-]+)*$/u.test(path);
}

function isRole(value: unknown): value is Extract<TWidgetPreviewInspectTarget, Readonly<{ by: 'role' }>>['role'] {
  return value === 'button'
    || value === 'checkbox'
    || value === 'combobox'
    || value === 'link'
    || value === 'listbox'
    || value === 'menuitem'
    || value === 'option'
    || value === 'radio'
    || value === 'slider'
    || value === 'spinbutton'
    || value === 'switch'
    || value === 'tab'
    || value === 'textbox';
}

function normalizeTarget(value: unknown, path: string): TWidgetPreviewInspectTarget | string {
  if (!isRecord(value) || !hasOwn(value, 'by')) return `${path} must be a CSS, role, or label target.`;
  if (value.by === 'css') {
    if (!hasOnlyKeys(value, ['by', 'selector']) || !hasOwn(value, 'selector')) {
      return `${path} CSS targets accept only by and selector.`;
    }
    if (typeof value.selector !== 'string' || utf8ByteLength(value.selector) < 1 || utf8ByteLength(value.selector) > 512) {
      return `${path}.selector must contain between 1 and 512 UTF-8 bytes.`;
    }
    return Object.freeze({ by: 'css' as const, selector: value.selector });
  }
  if (value.by === 'role') {
    if (!hasOnlyKeys(value, ['by', 'role', 'name', 'exact']) || !hasOwn(value, 'role') || !isRole(value.role)) {
      return `${path} role target is invalid.`;
    }
    if (hasOwn(value, 'name') && (typeof value.name !== 'string' || utf8ByteLength(value.name) > 256)) {
      return `${path}.name must contain at most 256 UTF-8 bytes.`;
    }
    if (hasOwn(value, 'exact') && typeof value.exact !== 'boolean') {
      return `${path}.exact must be a boolean.`;
    }
    return Object.freeze({
      by: 'role' as const,
      role: value.role,
      ...(typeof value.name === 'string' ? { name: value.name } : {}),
      ...(typeof value.exact === 'boolean' ? { exact: value.exact } : {}),
    });
  }
  if (value.by === 'label') {
    if (!hasOnlyKeys(value, ['by', 'text', 'exact']) || !hasOwn(value, 'text')) {
      return `${path} label targets accept only by, text, and exact.`;
    }
    if (typeof value.text !== 'string' || utf8ByteLength(value.text) < 1 || utf8ByteLength(value.text) > 256) {
      return `${path}.text must contain between 1 and 256 UTF-8 bytes.`;
    }
    if (hasOwn(value, 'exact') && typeof value.exact !== 'boolean') {
      return `${path}.exact must be a boolean.`;
    }
    return Object.freeze({
      by: 'label' as const,
      text: value.text,
      ...(typeof value.exact === 'boolean' ? { exact: value.exact } : {}),
    });
  }
  return `${path}.by must be css, role, or label.`;
}

function normalizeAction(value: unknown, index: number): TWidgetPreviewInspectNormalizedAction | string {
  const path = `actions[${index}]`;
  if (!isRecord(value) || !hasOwn(value, 'type')) return `${path} must be an action object.`;
  if (value.type === 'waitFrames') {
    if (!hasOnlyKeys(value, ['type', 'count']) || !hasOwn(value, 'count') || !isIntegerInRange(value.count, 1, 120)) {
      return `${path}.count must be an integer from 1 through 120.`;
    }
    return Object.freeze({ type: 'waitFrames' as const, count: value.count });
  }
  if (value.type === 'click') {
    if (!hasOnlyKeys(value, ['type', 'target']) || !hasOwn(value, 'target')) {
      return `${path} click actions accept only type and target.`;
    }
    const target = normalizeTarget(value.target, `${path}.target`);
    if (typeof target === 'string') return target;
    return Object.freeze({ type: 'click' as const, target });
  }
  if (value.type === 'input') {
    if (!hasOnlyKeys(value, ['type', 'target', 'value', 'commit']) || !hasOwn(value, 'target') || !hasOwn(value, 'value')) {
      return `${path} input actions accept only type, target, value, and commit.`;
    }
    const target = normalizeTarget(value.target, `${path}.target`);
    if (typeof target === 'string') return target;
    if (typeof value.value !== 'string' || utf8ByteLength(value.value) > 4_096) {
      return `${path}.value must contain at most 4,096 UTF-8 bytes.`;
    }
    if (hasOwn(value, 'commit') && value.commit !== 'none' && value.commit !== 'blur' && value.commit !== 'enter') {
      return `${path}.commit must be none, blur, or enter.`;
    }
    return Object.freeze({
      type: 'input' as const,
      target,
      value: value.value,
      commit: value.commit === 'none' || value.commit === 'enter' ? value.commit : 'blur',
    });
  }
  if (value.type === 'assertText') {
    if (!hasOnlyKeys(value, ['type', 'target', 'text', 'exact']) || !hasOwn(value, 'target') || !hasOwn(value, 'text')) {
      return `${path} assertText actions accept only type, target, text, and exact.`;
    }
    const target = normalizeTarget(value.target, `${path}.target`);
    if (typeof target === 'string') return target;
    if (typeof value.text !== 'string' || utf8ByteLength(value.text) < 1 || utf8ByteLength(value.text) > 512) {
      return `${path}.text must contain between 1 and 512 UTF-8 bytes.`;
    }
    if (hasOwn(value, 'exact') && typeof value.exact !== 'boolean') {
      return `${path}.exact must be a boolean.`;
    }
    return Object.freeze({
      type: 'assertText' as const,
      target,
      text: value.text,
      ...(typeof value.exact === 'boolean' ? { exact: value.exact } : {}),
    });
  }
  return `${path}.type must be assertText, click, input, or waitFrames.`;
}

export function fnNormalizeWidgetPreviewInspectInput(input: unknown): TNormalizeResult {
  if (!isRecord(input) || !hasOnlyKeys(input, [
    'name',
    'mode',
    'expectedDraftDigestSha256',
    'expectedAcceptedGeneration',
    'expectedBuildIdentity',
    'viewport',
    'settle',
    'actions',
    'continueOnActionError',
    'timeoutMs',
  ])) {
    return { ok: false, message: 'Inspection input contains unknown fields or is not an object.' };
  }

  if (!hasOwn(input, 'name') || typeof input.name !== 'string') {
    return { ok: false, message: 'Inspection name must be a string.' };
  }
  const normalizedName = fnNormalizeWidgetName(input.name);
  if (!normalizedName.ok) return { ok: false, message: normalizedName.message };

  const mode = input.mode ?? 'artifact';
  if (mode !== 'artifact' && mode !== 'preview') {
    return { ok: false, message: 'mode must be artifact or preview.' };
  }

  if (hasOwn(input, 'expectedDraftDigestSha256') && (
    typeof input.expectedDraftDigestSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(input.expectedDraftDigestSha256)
  )) {
    return { ok: false, message: 'expectedDraftDigestSha256 must be one lowercase SHA-256 digest.' };
  }
  if (hasOwn(input, 'expectedAcceptedGeneration') && !isIntegerInRange(
    input.expectedAcceptedGeneration,
    1,
    Number.MAX_SAFE_INTEGER,
  )) {
    return { ok: false, message: 'expectedAcceptedGeneration must be a positive safe integer.' };
  }
  if (hasOwn(input, 'expectedBuildIdentity') && (
    typeof input.expectedBuildIdentity !== 'string'
    || !/^[a-f0-9]{64}$/.test(input.expectedBuildIdentity)
  )) {
    return { ok: false, message: 'expectedBuildIdentity must be one lowercase SHA-256 digest.' };
  }

  const viewport = input.viewport ?? {};
  if (!isRecord(viewport) || !hasOnlyKeys(viewport, ['width', 'height', 'deviceScaleFactor'])) {
    return { ok: false, message: 'viewport accepts only width, height, and deviceScaleFactor.' };
  }
  const width = viewport.width ?? 512;
  const height = viewport.height ?? 384;
  const deviceScaleFactor = viewport.deviceScaleFactor ?? 1;
  if (!isIntegerInRange(width, 160, 1_280)) {
    return { ok: false, message: 'viewport.width must be an integer from 160 through 1,280.' };
  }
  if (!isIntegerInRange(height, 120, 1_024)) {
    return { ok: false, message: 'viewport.height must be an integer from 120 through 1,024.' };
  }
  if (deviceScaleFactor !== 1 && deviceScaleFactor !== 2) {
    return { ok: false, message: 'viewport.deviceScaleFactor must be 1 or 2.' };
  }

  const settle = input.settle ?? {};
  if (!isRecord(settle) || !hasOnlyKeys(settle, ['frames', 'timeoutMs'])) {
    return { ok: false, message: 'settle accepts only frames and timeoutMs.' };
  }
  const settleFrames = settle.frames ?? 2;
  const settleTimeoutMs = settle.timeoutMs ?? 5_000;
  if (!isIntegerInRange(settleFrames, 1, 8)) {
    return { ok: false, message: 'settle.frames must be an integer from 1 through 8.' };
  }
  if (!isIntegerInRange(settleTimeoutMs, 100, 10_000)) {
    return { ok: false, message: 'settle.timeoutMs must be an integer from 100 through 10,000.' };
  }

  const actions = input.actions ?? [];
  if (!Array.isArray(actions) || actions.length > 16) {
    return { ok: false, message: 'actions must be an array containing at most 16 actions.' };
  }
  const normalizedActions: TWidgetPreviewInspectNormalizedAction[] = [];
  for (let index = 0; index < actions.length; index += 1) {
    const normalized = normalizeAction(actions[index], index);
    if (typeof normalized === 'string') return { ok: false, message: normalized };
    normalizedActions.push(normalized);
  }

  const continueOnActionError = input.continueOnActionError ?? false;
  if (typeof continueOnActionError !== 'boolean') {
    return { ok: false, message: 'continueOnActionError must be a boolean.' };
  }
  const timeoutMs = input.timeoutMs ?? 120_000;
  if (!isIntegerInRange(timeoutMs, 1, 180_000)) {
    return { ok: false, message: 'timeoutMs must be an integer from 1 through 180,000.' };
  }

  return {
    ok: true,
    value: Object.freeze({
      name: normalizedName.value,
      mode,
      ...(typeof input.expectedDraftDigestSha256 === 'string'
        ? { expectedDraftDigestSha256: input.expectedDraftDigestSha256 }
        : {}),
      ...(typeof input.expectedAcceptedGeneration === 'number'
        ? { expectedAcceptedGeneration: input.expectedAcceptedGeneration }
        : {}),
      ...(typeof input.expectedBuildIdentity === 'string'
        ? { expectedBuildIdentity: input.expectedBuildIdentity }
        : {}),
      viewport: Object.freeze({ width, height, deviceScaleFactor }),
      settle: Object.freeze({ frames: settleFrames, timeoutMs: settleTimeoutMs }),
      actions: Object.freeze(normalizedActions),
      continueOnActionError,
      timeoutMs,
    }),
  };
}

export function fnClassifyWidgetPreviewInspection(args: Readonly<{
  actions: readonly TInspectActionResult[];
  diagnostics: readonly TInspectDiagnostic[];
  elements: readonly TInspectElement[];
}>): TInspectFunctional {
  if (args.actions.some((action) => action.status !== 'passed')) return 'failed';
  const codes = args.diagnostics.map((diagnostic) => diagnostic.code.toUpperCase());
  if (codes.some((code) => /(?:WRITE_APPROVAL|APPROVAL_REQUIRED)/.test(code))) {
    return 'blocked_write_approval';
  }
  if (codes.some((code) => /(?:RESOURCE_REFERENCE_REQUIRED|RESOURCE_BINDING_REQUIRED)/.test(code))) {
    return 'not_verified_missing_reference';
  }
  if (args.diagnostics.some((diagnostic, index) => (
    diagnostic.severity === 'error'
    || /^(?:FUNCTION|RESOURCE|PROVIDER|CAPABILITY|SCHEMA|GUEST_RUNTIME|GUEST_EXCEPTION|DESCRIPTOR)/.test(codes[index] ?? '')
  ))) return 'failed';
  const renderedError = args.elements.some((element) => (
    element.role === 'alert'
    && /\b(?:error|failed|failure|unavailable|invalid|not ready|could not)\b/i.test(
      `${element.name ?? ''} ${element.text ?? ''}`,
    )
  ));
  if (renderedError) return 'failed';
  return args.actions.some((action) => action.type !== 'waitFrames')
    ? 'observed'
    : 'not_exercised';
}

export function fnValidateWidgetPreviewInspectProtocol(args: TProtocolArgs): TProtocolResult {
  if (args.result.identity.name !== args.expectedName || args.result.identity.widgetKey !== args.expectedWidgetKey) {
    return { ok: false, message: 'Inspection identity did not match the mounted draft.' };
  }
  if (
    args.input.expectedDraftDigestSha256 !== undefined
    && args.result.identity.draftDigestSha256 !== args.input.expectedDraftDigestSha256
  ) {
    return { ok: false, message: 'Inspection result did not satisfy the requested draft digest fence.' };
  }
  if (args.result.verification.surface !== args.input.mode) {
    return { ok: false, message: 'Inspection verification surface did not match the requested mode.' };
  }
  if (
    args.result.verification.visibleFrame !== 'not_claimed'
    || args.result.verification.executionTarget !== 'diagnostic_clone'
    || args.result.verification.generation !== 'current'
    || args.result.verification.artifact !== 'exact'
    || args.result.verification.manifest !== 'exact'
  ) return { ok: false, message: 'Inspection verification contained an unsupported authority claim.' };
  if (args.input.mode === 'artifact') {
    if (
      args.result.verification.resources !== 'not_available'
      || args.result.verification.previewState !== 'not_applicable'
      || args.result.verification.nextAction !== 'use_preview_mode_for_resources'
      || args.result.verification.canvasParity !== 'not_claimed'
      || ('fidelity' in args.result && args.result.fidelity.overall !== 'artifact_exact')
    ) return { ok: false, message: 'Artifact inspection claimed Preview or resource parity.' };
  } else if (
    args.result.verification.resources !== 'manifest_bound'
    || args.result.verification.previewState === 'not_applicable'
    || args.result.verification.previewState === 'ambiguous'
    || args.result.verification.previewState === 'mounting'
    || args.result.verification.previewState === 'retired'
    || args.result.verification.previewState === 'generation_mismatch'
    || args.result.verification.canvasParity !== 'same_runtime_policy'
    || ('fidelity' in args.result && args.result.fidelity.overall !== 'preview_policy_exact')
  ) return { ok: false, message: 'Preview inspection did not prove its exact runtime policy.' };

  const screenshot = args.result.screenshot;
  if ((screenshot === undefined) !== (args.observedPng === undefined)) {
    return { ok: false, message: 'Inspection screenshot metadata and PNG bytes must be present together.' };
  }
  if (screenshot !== undefined && args.observedPng !== undefined && (
    screenshot.mimeType !== 'image/png'
    || screenshot.byteSize !== args.observedPng.byteSize
    || screenshot.digestSha256 !== args.observedPng.digestSha256
    || screenshot.width !== args.observedPng.width
    || screenshot.height !== args.observedPng.height
  )) {
    return { ok: false, message: 'Inspection screenshot metadata did not match the PNG bytes.' };
  }
  if (screenshot !== undefined && (
    screenshot.width !== args.input.viewport.width * args.input.viewport.deviceScaleFactor
    || screenshot.height !== args.input.viewport.height * args.input.viewport.deviceScaleFactor
  )) {
    return { ok: false, message: 'Inspection screenshot dimensions did not match the requested viewport and scale factor.' };
  }

  const evidence = args.result.status === 'completed' || args.result.status === 'completed_with_errors'
    ? args.result.evidence
    : args.result.status === 'failed'
      ? args.result.evidence
      : undefined;
  if (evidence?.page !== undefined && (
    evidence.page.width !== args.input.viewport.width
    || evidence.page.height !== args.input.viewport.height
    || evidence.page.deviceScaleFactor !== args.input.viewport.deviceScaleFactor
  )) {
    return { ok: false, message: 'Inspection page evidence did not match the requested viewport.' };
  }
  if (evidence?.actions !== undefined) {
    if (evidence.actions.length > args.input.actions.length) {
      return { ok: false, message: 'Inspection returned more action evidence than requested actions.' };
    }
    for (let index = 0; index < evidence.actions.length; index += 1) {
      const expected = args.input.actions[index];
      const observed = evidence.actions[index];
      if (expected === undefined || observed === undefined || observed.index !== index || observed.type !== expected.type) {
        return { ok: false, message: 'Inspection action evidence was not ordered against the requested actions.' };
      }
    }
  }
  if (evidence?.diagnostics !== undefined) {
    let diagnosticBytes = 0;
    for (const diagnostic of evidence.diagnostics.entries) {
      diagnosticBytes += utf8ByteLength(diagnostic.fingerprint)
        + utf8ByteLength(diagnostic.phase)
        + utf8ByteLength(diagnostic.code)
        + utf8ByteLength(diagnostic.message)
        + (diagnostic.location === undefined ? 0 : utf8ByteLength(diagnostic.location.file))
        + (diagnostic.capability === undefined ? 0 : utf8ByteLength(diagnostic.capability))
        + (diagnostic.operation === undefined ? 0 : utf8ByteLength(diagnostic.operation));
      if (diagnostic.location !== undefined && !isSafeWidgetLocation(diagnostic.location.file)) {
        return { ok: false, message: 'Inspection diagnostic contained an unsafe widget location.' };
      }
    }
    if (diagnosticBytes > 64 * 1_024) {
      return { ok: false, message: 'Inspection diagnostic text exceeded the 64 KiB result limit.' };
    }
  }

  if (args.result.status === 'completed' || args.result.status === 'completed_with_errors') {
    if (
      evidence === undefined
      || evidence.actions === undefined
      || evidence.diagnostics === undefined
      || evidence.elements === undefined
      || evidence.actions.length !== args.input.actions.length
    ) {
      return { ok: false, message: 'Inspection action evidence did not match the requested action count.' };
    }
    const hasActionError = evidence.actions.some((action) => action.status !== 'passed');
    const hasDiagnosticError = evidence.diagnostics?.entries.some((entry) => entry.severity === 'error') ?? false;
    const classified = fnClassifyWidgetPreviewInspection({
      actions: evidence.actions,
      diagnostics: evidence.diagnostics.entries,
      elements: evidence.elements.entries,
    });
    if (args.result.verification.functional !== classified) {
      return { ok: false, message: 'Inspection functional verification did not match its trusted evidence.' };
    }
    if (args.result.status === 'completed' && (hasActionError || hasDiagnosticError || classified === 'failed' || classified === 'blocked_write_approval' || classified === 'not_verified_missing_reference')) {
      return { ok: false, message: 'A completed inspection cannot contain failed actions or error diagnostics.' };
    }
    if (args.result.status === 'completed_with_errors' && !hasActionError && !hasDiagnosticError && classified !== 'failed' && classified !== 'blocked_write_approval' && classified !== 'not_verified_missing_reference') {
      return { ok: false, message: 'A completed_with_errors inspection must contain failed actions or error diagnostics.' };
    }
  } else if (args.result.verification.functional !== 'failed') {
    return { ok: false, message: 'A non-completed inspection must report failed functional verification.' };
  }

  return { ok: true };
}
