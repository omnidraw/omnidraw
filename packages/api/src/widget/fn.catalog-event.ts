export type TWidgetCatalogPublicEvent = Readonly<{
  previousGeneration: number | null;
  generation: number;
  fullResync: boolean;
  changedWidgetKeys: readonly string[];
}>;

export function fnWidgetCatalogCatchUpEvent(args: Readonly<{
  afterGeneration: number | undefined;
  currentGeneration: number;
}>): TWidgetCatalogPublicEvent | null {
  if (args.afterGeneration === args.currentGeneration) return null;
  return {
    previousGeneration: args.afterGeneration !== undefined && args.afterGeneration > 0
      ? args.afterGeneration
      : null,
    generation: args.currentGeneration,
    fullResync: true,
    changedWidgetKeys: [],
  };
}

export function fnCoalesceWidgetCatalogEvents(args: Readonly<{
  pending: TWidgetCatalogPublicEvent | null;
  next: TWidgetCatalogPublicEvent;
  maxChangedWidgetKeys: number;
}>): TWidgetCatalogPublicEvent {
  const changed = new Set([
    ...(args.pending?.changedWidgetKeys ?? []),
    ...args.next.changedWidgetKeys,
  ]);
  const fullResync = args.pending?.fullResync === true
    || args.next.fullResync
    || changed.size > args.maxChangedWidgetKeys;
  return {
    previousGeneration: args.pending?.previousGeneration
      ?? args.next.previousGeneration,
    generation: args.next.generation,
    fullResync,
    changedWidgetKeys: fullResync
      ? []
      : [...changed].sort(),
  };
}
