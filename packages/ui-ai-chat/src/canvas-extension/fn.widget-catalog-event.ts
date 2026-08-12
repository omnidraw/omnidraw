export type TWidgetCatalogEvent = Readonly<{
  generation: number;
  changedWidgetKeys: readonly string[];
  previewWidgetKeys: readonly string[];
  fullResync: boolean;
}>;

export type TWidgetCatalogEventUpdate = Readonly<{
  observedGeneration: number;
  remount: 'all' | 'keys' | 'none';
  widgetKeys: readonly string[];
  previewWidgetKeys: readonly string[];
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
      previewWidgetKeys: [],
    };
  }
  if (event.generation <= observedGeneration) {
    return {
      observedGeneration,
      remount: 'none',
      widgetKeys: [],
      previewWidgetKeys: [],
    };
  }
  return {
    observedGeneration: event.generation,
    remount: event.changedWidgetKeys.length === 0 ? 'none' : 'keys',
    widgetKeys: [...event.changedWidgetKeys],
    previewWidgetKeys: [...event.previewWidgetKeys],
  };
}
