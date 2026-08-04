import type {
  TWidgetPublicCatalog,
  TWidgetPublicCatalogForm,
} from '@omnidraw/orpc-client';
import type {
  TWidgetSidebarProjection,
  TWidgetSidebarRow,
  TWidgetSource,
} from './types';

export function fnWidgetSourceOrder(source: TWidgetSource): number {
  return source === 'published' ? 0 : 1;
}

export function fnSortWidgetRows(rows: TWidgetSidebarRow[]): TWidgetSidebarRow[] {
  return [...rows].sort((left, right) => {
    const priority = (left.form.config?.tool.priority ?? 0)
      - (right.form.config?.tool.priority ?? 0);
    const name = (left.form.config?.name ?? left.widgetKey)
      .localeCompare(right.form.config?.name ?? right.widgetKey);
    return priority
      || name
      || left.widgetKey.localeCompare(right.widgetKey)
      || fnWidgetSourceOrder(left.source) - fnWidgetSourceOrder(right.source);
  });
}

const DRAFT_PLACEMENT_BOUNDS = Object.freeze({ width: 360, height: 320 });

export function fnProjectWidgetCatalog(catalog: TWidgetPublicCatalog): TWidgetSidebarProjection {
  const groupMap = new Map(catalog.groups.map((name) => [name, {
    name,
    rows: [] as TWidgetSidebarRow[],
  }]));
  const ungrouped: TWidgetSidebarRow[] = [];
  const add = (
    entry: TWidgetPublicCatalog['entries'][number],
    source: TWidgetSource,
    form: TWidgetPublicCatalogForm,
  ) => {
    const row: TWidgetSidebarRow = {
      widgetKey: entry.widgetKey,
      source,
      form,
      entry,
      placement: source === 'published'
        ? entry.placement
        : form.health === 'healthy'
          ? {
            reference: {
              source: 'draft' as const,
              widgetKey: entry.widgetKey,
              catalogGeneration: catalog.generation,
            },
            bounds: DRAFT_PLACEMENT_BOUNDS,
          }
          : null,
      problem: form.issues[0] ?? null,
    };
    const groupName = form.config?.tool.group;
    if (groupName && groupMap.has(groupName)) groupMap.get(groupName)!.rows.push(row);
    else ungrouped.push(row);
  };
  for (const entry of catalog.entries) {
    if (entry.published) add(entry, 'published', entry.published);
    if (entry.draft) add(entry, 'draft', entry.draft);
  }
  return {
    groups: [...groupMap.values()]
      .map((group) => ({ ...group, rows: fnSortWidgetRows(group.rows) }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    ungrouped: fnSortWidgetRows(ungrouped),
  };
}

export function fnFindWidgetSelectionGroup(
  projection: TWidgetSidebarProjection,
  source: TWidgetSource,
  widgetKey: string,
): string | null {
  return projection.groups.find((group) => group.rows.some((row) => (
    row.source === source && row.widgetKey === widgetKey
  )))?.name ?? null;
}

export function fnWidgetSelection(
  pathname: string,
): { source: TWidgetSource; encodedWidgetKey: string } | null {
  const match = pathname.match(/^\/widgets\/(published|draft)\/([^/]+)$/);
  return match
    ? { source: match[1] as TWidgetSource, encodedWidgetKey: match[2] ?? '' }
    : null;
}
