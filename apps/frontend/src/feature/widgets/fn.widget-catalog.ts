import type { TWidgetCatalog, TWidgetSource, TWidgetVariantSummary } from '@vibecanvas/orpc-client';
import type { TWidgetSidebarProjection, TWidgetSidebarRow } from './types';

export function fnWidgetSourceOrder(source: TWidgetSource): number {
  return source === 'published' ? 0 : 1;
}

export function fnSortWidgetRows(rows: TWidgetSidebarRow[]): TWidgetSidebarRow[] {
  return [...rows].sort((left, right) => {
    const name = left.variant.displayName.localeCompare(right.variant.displayName);
    return name || fnWidgetSourceOrder(left.source) - fnWidgetSourceOrder(right.source);
  });
}

export function fnProjectWidgetCatalog(catalog: TWidgetCatalog): TWidgetSidebarProjection {
  const groupMap = new Map(catalog.groups.map((group) => [group.name, {
    name: group.name,
    icon: group.icon,
    rows: [] as TWidgetSidebarRow[],
  }]));
  const ungrouped: TWidgetSidebarRow[] = [];

  const add = (name: string, source: TWidgetSource, variant: TWidgetVariantSummary, problem: TWidgetSidebarRow['problem']) => {
    const groupName = variant.tool.group;
    const missingGroup = groupName && !groupMap.has(groupName) ? groupName : null;
    const row = { name, source, variant, problem, missingGroup };
    if (groupName && groupMap.has(groupName)) groupMap.get(groupName)?.rows.push(row);
    else ungrouped.push(row);
  };

  for (const widget of catalog.widgets) {
    if (widget.published) add(widget.name, 'published', widget.published, widget.problem);
    if (widget.draft && (widget.relation !== 'same' || !widget.published)) add(widget.name, 'draft', widget.draft, widget.problem);
  }

  return {
    groups: [...groupMap.values()]
      .map((group) => ({ ...group, rows: fnSortWidgetRows(group.rows) }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    ungrouped: fnSortWidgetRows(ungrouped),
  };
}

export function fnWidgetSelection(pathname: string): { source: TWidgetSource; encodedName: string } | null {
  const match = pathname.match(/^\/widgets\/(published|draft)\/([^/]+)$/);
  return match ? { source: match[1] as TWidgetSource, encodedName: match[2] ?? '' } : null;
}
