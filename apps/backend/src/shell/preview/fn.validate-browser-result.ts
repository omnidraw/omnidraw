import { PREVIEW_INSPECTION_LIMITS } from './CONSTANTS';
import { fnUtf8ByteLength } from './fn.validate-browser-job';
import type {
  TPreviewInspectionBrowserJob,
  TPreviewInspectionBrowserTarget,
  TPreviewInspectionBounds,
  TPreviewInspectionKeyboardGuardResult,
  TPreviewInspectionKeyboardGuardTicket,
  TPreviewInspectionKeyboardOperation,
  TPreviewInspectionRuntimeEvent,
  TPreviewInspectionShellFocusedTargetCheck,
  TPreviewInspectionShellPointCheck,
  TPreviewInspectionShellSnapshot,
} from './interface';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SIMPLE_TEXT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;
const TARGET_ROLES = new Set([
  'banner',
  'button',
  'checkbox',
  'combobox',
  'complementary',
  'contentinfo',
  'form',
  'link',
  'listbox',
  'main',
  'menuitem',
  'navigation',
  'option',
  'radio',
  'region',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);
const CANVAS_CONTEXTS = new Set(['2d', 'webgl', 'webgl2', 'webgpu', 'unknown']);
const EVENT_SEVERITIES = new Set(['error', 'warning', 'info']);
const POINT_REASONS = new Set([
  'valid',
  'missing',
  'stale',
  'not_visible',
  'disabled',
  'outside_viewport',
  'occluded',
]);
const FOCUSED_TARGET_REASONS = new Set([
  'valid',
  'missing',
  'stale',
  'not_visible',
  'disabled',
  'sensitive',
  'not_editable',
  'not_focused',
]);
const KEYBOARD_GUARD_OPERATIONS = new Set<TPreviewInspectionKeyboardOperation>([
  'delete_backward',
  'insert_text',
  'commit_enter',
]);
const KEYBOARD_GUARD_REASONS = new Set([
  'valid',
  'focus_redirected',
  'selection_outside_target',
  'event_missing',
  'event_mismatch',
  'stale',
]);

export type TPreviewInspectionShellSnapshotValidation =
  | Readonly<{ ok: true; snapshot: TPreviewInspectionShellSnapshot }>
  | Readonly<{ ok: false; code: 'BROWSER_RESULT_INVALID'; message: string }>;

function fnRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fnExactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const actual = Reflect.ownKeys(value);
  return required.every((key) => actual.includes(key))
    && actual.every(
      (key) => typeof key === 'string' && (required.includes(key) || optional.includes(key)),
    );
}

function fnSafeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function fnBoundedText(
  value: unknown,
  maximumBytes: number,
  allowEmpty = false,
): value is string {
  return typeof value === 'string'
    && (allowEmpty || value.length > 0)
    && fnUtf8ByteLength(value) <= maximumBytes;
}

function fnValidBounds(value: unknown): value is TPreviewInspectionBounds {
  if (!fnRecord(value) || !fnExactKeys(value, ['x', 'y', 'width', 'height'])) {
    return false;
  }
  return Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.width)
    && (value.width as number) >= 0
    && Number.isFinite(value.height)
    && (value.height as number) >= 0;
}

function fnValidTargetState(value: unknown): boolean {
  if (!fnRecord(value) || !fnExactKeys(
    value,
    [],
    ['checked', 'disabled', 'expanded', 'selected'],
  )) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length > 0 && keys.every((key) => typeof value[key as string] === 'boolean');
}

function fnValidTarget(value: unknown): value is TPreviewInspectionBrowserTarget {
  if (!fnRecord(value) || !fnExactKeys(
    value,
    ['id', 'tag', 'bounds', 'computed', 'editable', 'sensitive'],
    ['role', 'name', 'text', 'state'],
  )) return false;
  if (
    !fnSafeInteger(value.id, 1)
    || !fnBoundedText(value.tag, 64)
    || !TAG_PATTERN.test(value.tag)
    || (value.role !== undefined
      && (typeof value.role !== 'string' || !TARGET_ROLES.has(value.role)))
    || (value.name !== undefined
      && !fnBoundedText(
        value.name,
        PREVIEW_INSPECTION_LIMITS.maximumInspectionTextBytes,
        true,
      ))
    || (value.text !== undefined
      && !fnBoundedText(
        value.text,
        PREVIEW_INSPECTION_LIMITS.maximumInspectionTextBytes,
        true,
      ))
    || !fnValidBounds(value.bounds)
    || !fnRecord(value.computed)
    || !fnExactKeys(value.computed, ['display', 'visibility', 'opacity'])
    || !fnBoundedText(value.computed.display, 64)
    || !fnBoundedText(value.computed.visibility, 64)
    || !fnBoundedText(value.computed.opacity, 64)
    || typeof value.editable !== 'boolean'
    || typeof value.sensitive !== 'boolean'
    || (value.state !== undefined && !fnValidTargetState(value.state))
  ) return false;
  return true;
}

export function fnValidatePreviewInspectionBrowserTargets(
  value: unknown,
  maximumResults: number = PREVIEW_INSPECTION_LIMITS.maximumTargets,
): value is readonly TPreviewInspectionBrowserTarget[] {
  return Number.isSafeInteger(maximumResults)
    && maximumResults >= 0
    && maximumResults <= PREVIEW_INSPECTION_LIMITS.maximumTargets
    && Array.isArray(value)
    && value.length <= maximumResults
    && value.every(fnValidTarget)
    && fnUniqueIds(value);
}

export function fnValidatePreviewInspectionShellPointCheck(
  value: unknown,
  expectedTargetId: number,
): value is TPreviewInspectionShellPointCheck {
  if (!fnRecord(value) || !fnExactKeys(
    value,
    ['targetId', 'valid', 'reason'],
    ['centerX', 'centerY'],
  )) return false;
  if (
    !fnSafeInteger(value.targetId, 1)
    || value.targetId !== expectedTargetId
    || typeof value.valid !== 'boolean'
    || typeof value.reason !== 'string'
    || !POINT_REASONS.has(value.reason)
  ) return false;
  if (value.valid) {
    return value.reason === 'valid'
      && Number.isFinite(value.centerX)
      && Number.isFinite(value.centerY);
  }
  return value.reason !== 'valid'
    && value.centerX === undefined
    && value.centerY === undefined;
}

export function fnValidatePreviewInspectionShellFocusedTargetCheck(
  value: unknown,
  expectedTargetId: number,
): value is TPreviewInspectionShellFocusedTargetCheck {
  if (!fnRecord(value) || !fnExactKeys(value, ['targetId', 'valid', 'reason'])) {
    return false;
  }
  return fnSafeInteger(value.targetId, 1)
    && value.targetId === expectedTargetId
    && typeof value.valid === 'boolean'
    && typeof value.reason === 'string'
    && FOCUSED_TARGET_REASONS.has(value.reason)
    && (value.valid ? value.reason === 'valid' : value.reason !== 'valid');
}

export function fnValidatePreviewInspectionKeyboardGuardTicket(
  value: unknown,
  expectedTargetId: number,
  expectedOperation: TPreviewInspectionKeyboardOperation,
): value is TPreviewInspectionKeyboardGuardTicket {
  if (!fnRecord(value) || !fnExactKeys(
    value,
    ['guardId', 'targetId', 'operation'],
  )) return false;
  return fnSafeInteger(value.guardId, 1)
    && fnSafeInteger(value.targetId, 1)
    && value.targetId === expectedTargetId
    && typeof value.operation === 'string'
    && KEYBOARD_GUARD_OPERATIONS.has(value.operation as TPreviewInspectionKeyboardOperation)
    && value.operation === expectedOperation;
}

export function fnValidatePreviewInspectionKeyboardGuardResult(
  value: unknown,
  expectedTicket: TPreviewInspectionKeyboardGuardTicket,
): value is TPreviewInspectionKeyboardGuardResult {
  if (!fnRecord(value) || !fnExactKeys(value, [
    'guardId',
    'targetId',
    'operation',
    'valid',
    'reason',
    'keydownObserved',
    'beforeinputObserved',
    'defaultPrevented',
  ])) return false;
  if (
    !fnSafeInteger(value.guardId, 1)
    || value.guardId !== expectedTicket.guardId
    || !fnSafeInteger(value.targetId, 1)
    || value.targetId !== expectedTicket.targetId
    || typeof value.operation !== 'string'
    || !KEYBOARD_GUARD_OPERATIONS.has(value.operation as TPreviewInspectionKeyboardOperation)
    || value.operation !== expectedTicket.operation
    || typeof value.valid !== 'boolean'
    || typeof value.reason !== 'string'
    || !KEYBOARD_GUARD_REASONS.has(value.reason)
    || typeof value.keydownObserved !== 'boolean'
    || typeof value.beforeinputObserved !== 'boolean'
    || typeof value.defaultPrevented !== 'boolean'
    || (value.valid ? value.reason !== 'valid' : value.reason === 'valid')
    || (value.valid && value.defaultPrevented)
    || (
      !value.valid
      && (
        value.reason === 'focus_redirected'
        || value.reason === 'selection_outside_target'
        || value.reason === 'event_mismatch'
      )
      && !value.defaultPrevented
    )
    || (
      value.reason === 'event_missing'
      && (
        value.defaultPrevented
        || (expectedTicket.operation === 'insert_text'
          ? value.beforeinputObserved
          : value.keydownObserved)
      )
    )
  ) return false;
  if (!value.valid) return true;
  if (expectedTicket.operation === 'insert_text') {
    return value.beforeinputObserved;
  }
  return value.keydownObserved;
}

function fnValidCanvas(value: unknown): boolean {
  if (!fnRecord(value) || !fnExactKeys(
    value,
    ['id', 'bounds', 'width', 'height', 'context', 'contextLost'],
  )) return false;
  return fnSafeInteger(value.id, 1)
    && fnValidBounds(value.bounds)
    && fnSafeInteger(value.width)
    && fnSafeInteger(value.height)
    && typeof value.context === 'string'
    && CANVAS_CONTEXTS.has(value.context)
    && typeof value.contextLost === 'boolean';
}

function fnValidRuntimeEvent(value: unknown): value is TPreviewInspectionRuntimeEvent {
  if (!fnRecord(value) || !fnExactKeys(
    value,
    ['origin', 'phase', 'code', 'severity', 'message'],
    ['artifactHash', 'runtimeGeneration', 'lifecycleGeneration', 'location'],
  )) return false;
  if (
    !fnBoundedText(value.origin, PREVIEW_INSPECTION_LIMITS.maximumIdentifierBytes)
    || !SIMPLE_TEXT_PATTERN.test(value.origin)
    || !fnBoundedText(value.phase, PREVIEW_INSPECTION_LIMITS.maximumIdentifierBytes)
    || !SIMPLE_TEXT_PATTERN.test(value.phase)
    || !fnBoundedText(value.code, PREVIEW_INSPECTION_LIMITS.maximumIdentifierBytes)
    || !SIMPLE_TEXT_PATTERN.test(value.code)
    || typeof value.severity !== 'string'
    || !EVENT_SEVERITIES.has(value.severity)
    || value.message !== `${value.origin} ${value.code}`
    || fnUtf8ByteLength(value.message) > 2 * PREVIEW_INSPECTION_LIMITS.maximumIdentifierBytes + 1
    || (value.artifactHash !== undefined
      && (typeof value.artifactHash !== 'string'
        || !ARTIFACT_HASH_PATTERN.test(value.artifactHash)))
    || (value.runtimeGeneration !== undefined
      && !fnSafeInteger(value.runtimeGeneration, 1))
    || (value.lifecycleGeneration !== undefined
      && !fnSafeInteger(value.lifecycleGeneration, 1))
  ) return false;
  return true;
}

function fnValidGeneratedLocation(value: unknown): boolean {
  if (!fnRecord(value) || !fnExactKeys(value, ['module', 'line', 'column'])) return false;
  return typeof value.module === 'string'
    && value.module.length <= 256
    && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|cjs)$/.test(value.module)
    && fnSafeInteger(value.line, 1)
    && value.line <= 1_000_000
    && fnSafeInteger(value.column)
    && value.column <= 1_000_000;
}

function fnValidRuntimeEventFence(
  value: TPreviewInspectionRuntimeEvent,
  expected: Readonly<{
    artifactHash: string;
    runtimeGeneration: number;
    lifecycleGeneration: number;
  }>,
): boolean {
  if (value.location === undefined) return true;
  return fnValidGeneratedLocation(value.location)
    && value.artifactHash === expected.artifactHash
    && value.runtimeGeneration === expected.runtimeGeneration
    && value.lifecycleGeneration === expected.lifecycleGeneration;
}

function fnValidDroppedCounts(value: unknown): boolean {
  return fnRecord(value)
    && fnExactKeys(value, ['targets', 'canvases', 'runtimeEvents'])
    && fnSafeInteger(value.targets)
    && fnSafeInteger(value.canvases)
    && fnSafeInteger(value.runtimeEvents);
}

function fnUniqueIds(values: readonly unknown[]): boolean {
  const ids = values.map((value) => (value as { id: number }).id);
  return new Set(ids).size === ids.length;
}

export function fnValidatePreviewInspectionShellSnapshot(args: Readonly<{
  job: TPreviewInspectionBrowserJob;
  snapshot: unknown;
}>): TPreviewInspectionShellSnapshotValidation {
  const fail = (): TPreviewInspectionShellSnapshotValidation => Object.freeze({
    ok: false,
    code: 'BROWSER_RESULT_INVALID',
    message: 'Preview inspection browser result failed identity, shape, or bounds validation.',
  });
  const value = args.snapshot;
  if (!fnRecord(value) || !fnExactKeys(value, [
    'artifactDigestSha256',
    'artifactHash',
    'runtimeGeneration',
    'lifecycleGeneration',
    'scannedElements',
    'targets',
    'canvases',
    'runtimeEvents',
    'droppedCounts',
  ])) return fail();
  if (
    typeof value.artifactDigestSha256 !== 'string'
    || !SHA256_PATTERN.test(value.artifactDigestSha256)
    || value.artifactDigestSha256 !== args.job.artifact.digestSha256
    || typeof value.artifactHash !== 'string'
    || !ARTIFACT_HASH_PATTERN.test(value.artifactHash)
    || value.artifactHash !== args.job.artifact.artifactHash
    || !fnSafeInteger(value.runtimeGeneration, 1)
    || !fnSafeInteger(value.lifecycleGeneration, 1)
    || !fnSafeInteger(value.scannedElements)
    || value.scannedElements > PREVIEW_INSPECTION_LIMITS.maximumScannedElements
    || !Array.isArray(value.targets)
    || value.targets.length > PREVIEW_INSPECTION_LIMITS.maximumTargets
    || !fnValidatePreviewInspectionBrowserTargets(
      value.targets,
      PREVIEW_INSPECTION_LIMITS.maximumTargets,
    )
    || value.scannedElements < value.targets.length
    || !Array.isArray(value.canvases)
    || value.canvases.length > PREVIEW_INSPECTION_LIMITS.maximumCanvases
    || !value.canvases.every(fnValidCanvas)
    || !fnUniqueIds(value.canvases)
    || !Array.isArray(value.runtimeEvents)
    || value.runtimeEvents.length > PREVIEW_INSPECTION_LIMITS.maximumRuntimeEvents
    || !value.runtimeEvents.every(fnValidRuntimeEvent)
    || !(value.runtimeEvents as readonly TPreviewInspectionRuntimeEvent[]).every(
      (event) => fnValidRuntimeEventFence(event, {
        artifactHash: value.artifactHash as string,
        runtimeGeneration: value.runtimeGeneration as number,
        lifecycleGeneration: value.lifecycleGeneration as number,
      }),
    )
    || !fnValidDroppedCounts(value.droppedCounts)
  ) return fail();
  return Object.freeze({
    ok: true,
    snapshot: value as unknown as TPreviewInspectionShellSnapshot,
  });
}
