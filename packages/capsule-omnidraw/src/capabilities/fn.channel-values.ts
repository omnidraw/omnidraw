import type {
  TWidgetCapsuleNotificationOutput,
} from '@omnidraw/widget-contract';

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

/**
 * Narrows the already schema-validated Capsule output before product routing.
 * Keeping this check fail-closed prevents a future schema/wiring mismatch from
 * silently expanding guest authority.
 */
export function fnOmnidrawWidgetNotificationOutput(
  value: unknown,
): TWidgetCapsuleNotificationOutput {
  if (
    !isExactRecord(value, ['message', 'tone', 'type'])
    || value.type !== 'notification'
    || (
      value.tone !== 'info'
      && value.tone !== 'success'
      && value.tone !== 'error'
    )
    || typeof value.message !== 'string'
    || value.message.length < 1
  ) {
    throw new TypeError('Widget Capsule output does not match the notification contract.');
  }
  return Object.freeze({
    type: value.type,
    tone: value.tone,
    message: value.message,
  });
}
