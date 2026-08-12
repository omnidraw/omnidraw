import {
  PREVIEW_INSPECTION_JOB_FORMAT,
  PREVIEW_INSPECTION_LIMITS,
} from './CONSTANTS';
import type {
  TPreviewInspectionBrowserAction,
  TPreviewInspectionBrowserJob,
  TPreviewInspectionTarget,
} from './interface';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CAPSULE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const WIDGET_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TARGET_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'option',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);

export type TPreviewInspectionBrowserJobValidation =
  | Readonly<{ ok: true; timeoutMs: number }>
  | Readonly<{ ok: false; code: 'BROWSER_JOB_INVALID'; message: string }>;

export function fnUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return Number.POSITIVE_INFINITY;
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return Number.POSITIVE_INFINITY;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function fnExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length
    && actual.every((key) => typeof key === 'string' && keys.includes(key));
}

function fnRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fnAllowedKeys(value: object, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every(
    (key) => typeof key === 'string' && keys.includes(key),
  );
}

function fnValidTarget(target: unknown): target is TPreviewInspectionTarget {
  if (!fnRecord(target) || typeof target.by !== 'string') return false;
  if (target.by === 'css') {
    return fnExactKeys(target, ['by', 'selector'])
      && typeof target.selector === 'string'
      && target.selector.length > 0
      && fnUtf8ByteLength(target.selector)
        <= PREVIEW_INSPECTION_LIMITS.maximumSelectorBytes;
  }
  if (target.by === 'role') {
    if (!fnExactKeys(
      target,
      ['by', 'role', ...(target.name === undefined ? [] : ['name']), ...(target.exact === undefined ? [] : ['exact'])],
    )) return false;
    return typeof target.role === 'string'
      && TARGET_ROLES.has(target.role)
      && (target.name === undefined
      || (typeof target.name === 'string'
        && target.name.length > 0
        && fnUtf8ByteLength(target.name)
          <= PREVIEW_INSPECTION_LIMITS.maximumAccessibleNameBytes))
      && (target.exact === undefined || typeof target.exact === 'boolean');
  }
  if (target.by !== 'label') return false;
  return fnExactKeys(
    target,
    ['by', 'text', ...(target.exact === undefined ? [] : ['exact'])],
  )
    && typeof target.text === 'string'
    && target.text.length > 0
    && fnUtf8ByteLength(target.text)
      <= PREVIEW_INSPECTION_LIMITS.maximumAccessibleNameBytes
    && (target.exact === undefined || typeof target.exact === 'boolean');
}

function fnValidAction(action: unknown): action is TPreviewInspectionBrowserAction {
  if (!fnRecord(action) || typeof action.type !== 'string') return false;
  if (action.type === 'waitFrames') {
    return fnExactKeys(action, ['type', 'count'])
      && typeof action.count === 'number'
      && Number.isSafeInteger(action.count)
      && action.count >= 1
      && action.count <= PREVIEW_INSPECTION_LIMITS.maximumWaitFrames;
  }
  if (action.type === 'click') {
    return fnExactKeys(action, ['type', 'target']) && fnValidTarget(action.target);
  }
  if (action.type === 'assertText') {
    return fnExactKeys(
      action,
      ['type', 'target', 'text', ...(action.exact === undefined ? [] : ['exact'])],
    )
      && fnValidTarget(action.target)
      && typeof action.text === 'string'
      && action.text.length > 0
      && fnUtf8ByteLength(action.text) <= PREVIEW_INSPECTION_LIMITS.maximumInspectionTextBytes
      && (action.exact === undefined || typeof action.exact === 'boolean');
  }
  if (action.type !== 'input') return false;
  return fnExactKeys(
    action,
    ['type', 'target', 'value', ...(action.commit === undefined ? [] : ['commit'])],
  )
    && fnValidTarget(action.target)
    && typeof action.value === 'string'
    && fnUtf8ByteLength(action.value)
      <= PREVIEW_INSPECTION_LIMITS.maximumInputValueBytes
    && (action.commit === undefined
      || action.commit === 'none'
      || action.commit === 'blur'
      || action.commit === 'enter');
}

export function fnValidatePreviewInspectionBrowserJob(
  value: unknown,
): TPreviewInspectionBrowserJobValidation {
  const fail = (message: string): TPreviewInspectionBrowserJobValidation => Object.freeze({
    ok: false,
    code: 'BROWSER_JOB_INVALID',
    message,
  });
  if (!fnRecord(value)) {
    return fail('Preview inspection browser job must be an object.');
  }
  if (!fnAllowedKeys(value, [
    'format',
    'jobId',
    'ownerKey',
    'widgetKey',
    'artifact',
    'hostConfiguration',
    'functionDescriptors',
    'browserFunctionDescriptorsDigestSha256',
    'functionBridge',
    'props',
    'theme',
    'viewport',
    'settleFrames',
    'settleTimeoutMs',
    'actions',
    'continueOnActionError',
    'timeoutMs',
    'signal',
  ])) return fail('Preview inspection browser job contains unsupported fields.');
  const job = value as unknown as TPreviewInspectionBrowserJob;
  if (job.format !== PREVIEW_INSPECTION_JOB_FORMAT) {
    return fail('Preview inspection browser job format is unsupported.');
  }
  if (
    typeof job.jobId !== 'string'
    || !IDENTIFIER_PATTERN.test(job.jobId)
    || fnUtf8ByteLength(job.jobId) > PREVIEW_INSPECTION_LIMITS.maximumIdentifierBytes
    || typeof job.ownerKey !== 'string'
    || !IDENTIFIER_PATTERN.test(job.ownerKey)
    || fnUtf8ByteLength(job.ownerKey) > PREVIEW_INSPECTION_LIMITS.maximumIdentifierBytes
    || typeof job.widgetKey !== 'string'
    || !WIDGET_KEY_PATTERN.test(job.widgetKey)
    || fnUtf8ByteLength(job.widgetKey) > 100
  ) return fail('Preview inspection job identity is invalid.');
  if (
    !fnRecord(job.artifact)
    || !fnExactKeys(job.artifact, [
      'bytes',
      'digestSha256',
      'capsuleArtifactHash',
      'runtimeDescriptor',
    ])
  ) return fail('Preview inspection artifact is invalid.');
  if (
    !(job.artifact.bytes instanceof Uint8Array)
    || job.artifact.bytes.byteLength < 1
    || job.artifact.bytes.byteLength > PREVIEW_INSPECTION_LIMITS.maximumArtifactBytes
    || typeof job.artifact.digestSha256 !== 'string'
    || !SHA256_PATTERN.test(job.artifact.digestSha256)
    || typeof job.artifact.capsuleArtifactHash !== 'string'
    || !CAPSULE_HASH_PATTERN.test(job.artifact.capsuleArtifactHash)
    || !fnRecord(job.artifact.runtimeDescriptor)
    || job.artifact.runtimeDescriptor.capsuleArtifactHash
      !== job.artifact.capsuleArtifactHash
  ) return fail('Preview inspection artifact identity is invalid.');
  if (
    !fnRecord(job.hostConfiguration)
    || !Array.isArray(job.functionDescriptors)
    || typeof job.browserFunctionDescriptorsDigestSha256 !== 'string'
    || !SHA256_PATTERN.test(job.browserFunctionDescriptorsDigestSha256)
    || !fnRecord(job.functionBridge)
    || typeof job.functionBridge.invoke !== 'function'
    || typeof job.functionBridge.dispose !== 'function'
    || (job.props !== undefined && !fnRecord(job.props))
    || !fnRecord(job.theme)
  ) return fail('Preview inspection browser inputs are invalid.');
  if (!fnRecord(job.viewport) || !fnExactKeys(
    job.viewport,
    ['width', 'height', 'deviceScaleFactor'],
  )) return fail('Preview inspection viewport is invalid.');
  if (
    !Number.isSafeInteger(job.viewport.width)
    || job.viewport.width < PREVIEW_INSPECTION_LIMITS.minimumViewportWidth
    || job.viewport.width > PREVIEW_INSPECTION_LIMITS.maximumViewportWidth
    || !Number.isSafeInteger(job.viewport.height)
    || job.viewport.height < PREVIEW_INSPECTION_LIMITS.minimumViewportHeight
    || job.viewport.height > PREVIEW_INSPECTION_LIMITS.maximumViewportHeight
    || (job.viewport.deviceScaleFactor !== 1 && job.viewport.deviceScaleFactor !== 2)
  ) return fail('Preview inspection viewport is invalid.');
  if (
    !Number.isSafeInteger(job.settleFrames)
    || job.settleFrames < PREVIEW_INSPECTION_LIMITS.minimumSettleFrames
    || job.settleFrames > PREVIEW_INSPECTION_LIMITS.maximumSettleFrames
    || !Number.isSafeInteger(job.settleTimeoutMs)
    || job.settleTimeoutMs < PREVIEW_INSPECTION_LIMITS.minimumSettleTimeoutMs
    || job.settleTimeoutMs > PREVIEW_INSPECTION_LIMITS.maximumSettleTimeoutMs
  ) return fail('Preview inspection settlement policy is invalid.');
  if (
    !Array.isArray(job.actions)
    || job.actions.length > PREVIEW_INSPECTION_LIMITS.maximumActions
    || !job.actions.every(fnValidAction)
  ) return fail('Preview inspection action sequence is invalid.');
  if (typeof job.continueOnActionError !== 'boolean') {
    return fail('Preview inspection action error policy is invalid.');
  }
  const timeoutMs = job.timeoutMs ?? PREVIEW_INSPECTION_LIMITS.defaultJobTimeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > PREVIEW_INSPECTION_LIMITS.maximumJobTimeoutMs
  ) return fail('Preview inspection timeout is invalid.');
  if (
    job.signal === null
    || typeof job.signal !== 'object'
    || typeof job.signal.aborted !== 'boolean'
    || typeof job.signal.addEventListener !== 'function'
    || typeof job.signal.removeEventListener !== 'function'
  ) return fail('Preview inspection cancellation signal is invalid.');
  if (job.signal.aborted) return fail('Preview inspection job is already cancelled.');
  return Object.freeze({ ok: true, timeoutMs });
}
