export type TWidgetCatalogEvent = Readonly<{
  generation: number;
  changedWidgetKeys: readonly string[];
  fullResync: boolean;
}>;

export type TWidgetCatalogEventUpdate = Readonly<{
  observedGeneration: number;
  remount: 'all' | 'keys' | 'none';
  widgetKeys: readonly string[];
}>;

export function fnReduceWidgetCatalogEvent(
  observedGeneration: number,
  event: TWidgetCatalogEvent,
): TWidgetCatalogEventUpdate {
  if (event.fullResync) {
    return {
      observedGeneration: event.generation,
      remount: 'all',
      widgetKeys: [],
    };
  }
  if (event.generation <= observedGeneration) {
    return {
      observedGeneration,
      remount: 'none',
      widgetKeys: [],
    };
  }
  return {
    observedGeneration: event.generation,
    remount: 'keys',
    widgetKeys: [...event.changedWidgetKeys],
  };
}
