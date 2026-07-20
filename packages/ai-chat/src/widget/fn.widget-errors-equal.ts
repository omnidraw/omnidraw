import type { TWidgetError } from "@vibecanvas/service-db/model";

export function fnWidgetErrorsEqual(left: TWidgetError | null, right: TWidgetError | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.phase === right.phase
    && left.code === right.code
    && left.message === right.message
    && left.retryable === right.retryable
    && left.occurredAt === right.occurredAt
    && JSON.stringify(left.details) === JSON.stringify(right.details);
}
