import type { TWidgetRuntimeSnapshot } from './mount-arrow-sandbox';

export type TWidgetRuntimeHostEvent =
  | { readonly cursor?: string; readonly type: 'snapshot'; readonly snapshot: TWidgetRuntimeSnapshot }
  | { readonly cursor?: string; readonly type: 'noop' };

/** Bounds the compatibility bridge queue while a legacy guest is not polling. */
export function fnEnqueueLatestWidgetRuntimeSnapshot(
  queue: readonly TWidgetRuntimeHostEvent[],
  event: TWidgetRuntimeHostEvent,
): TWidgetRuntimeHostEvent[] {
  if (event.type !== 'snapshot' || queue.at(-1)?.type !== 'snapshot') {
    return [...queue, event];
  }
  return [...queue.slice(0, -1), event];
}
