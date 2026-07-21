import type { TWidgetCatalog, TWidgetSource } from '@vibecanvas/service-agent/widget-management/types';

export type TWidgetGroupMember = {
  name: string;
  source: TWidgetSource;
};

export function fnWidgetGroupMembers(catalog: TWidgetCatalog, groupName: string): TWidgetGroupMember[] {
  return catalog.widgets.flatMap((widget) => [widget.published, widget.draft]
    .filter((variant) => variant?.tool.group === groupName)
    .map((variant) => ({ name: widget.name, source: variant!.source })));
}
