type TLegacyWidgetData = Record<string, unknown> & {
  type?: unknown;
  expanded?: unknown;
  window?: unknown;
};

type TLegacyCanvasDocument = {
  elements?: Record<string, {
    data?: TLegacyWidgetData;
  }>;
};

type TPortal = Readonly<{
  read(): unknown;
  change(callback: (document: unknown) => void): void;
}>;

type TArgs = Readonly<Record<never, never>>;

function widgetData(document: unknown): TLegacyWidgetData[] {
  if (typeof document !== "object" || document === null) {
    return [];
  }
  const elements = (document as TLegacyCanvasDocument).elements;
  if (typeof elements !== "object" || elements === null) {
    return [];
  }
  return Object.values(elements).flatMap((element) => {
    const data = element?.data;
    return data?.type === "ui-widget" || data?.type === "widget-instance"
      ? [data]
      : [];
  });
}

/**
 * Collapses the legacy contained/minimized/fullscreen state machine into the
 * durable `expanded` flag. Cangine owns canvas maximize as local presentation.
 */
export function txMigrateWidgetWindow(
  portal: TPortal,
  args: TArgs,
): number {
  void args;
  const legacyCount = widgetData(portal.read()).filter((data) => {
    return typeof data.window === "string";
  }).length;
  if (legacyCount === 0) {
    return 0;
  }
  portal.change((canvasDoc) => {
    for (const data of widgetData(canvasDoc)) {
      if (data.window === "minimized") {
        data.expanded = false;
      } else if (data.window === "fullscreen") {
        data.expanded = true;
      } else if (typeof data.expanded !== "boolean") {
        data.expanded = true;
      }
      delete data.window;
    }
  });
  return legacyCount;
}
