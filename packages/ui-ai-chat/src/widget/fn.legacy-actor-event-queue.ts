import type { TActorSnapshot } from './fn.actor-event-snapshot';

export type TLegacyActorHostEvent =
  | { readonly cursor?: string; readonly type: 'snapshot'; readonly snapshot: TActorSnapshot }
  | { readonly cursor?: string; readonly type: 'noop' };

export function fnEnqueueLatestLegacyActorSnapshot(
  queue: readonly TLegacyActorHostEvent[],
  event: TLegacyActorHostEvent,
): TLegacyActorHostEvent[] {
  if (event.type !== 'snapshot' || queue.at(-1)?.type !== 'snapshot') {
    return [...queue, event];
  }
  return [...queue.slice(0, -1), event];
}
