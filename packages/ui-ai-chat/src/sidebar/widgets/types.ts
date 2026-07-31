import type { TWidgetCatalogProblem, TWidgetPlacementSummary, TWidgetSource, TWidgetVariantSummary } from '@omnidraw/orpc-client';

export type TWidgetSidebarRow = {
  name: string;
  source: TWidgetSource;
  managementSource: TWidgetSource;
  variant: TWidgetVariantSummary;
  placement: TWidgetPlacementSummary | null;
  problem: TWidgetCatalogProblem | null;
  missingGroup: string | null;
};

export type TWidgetSidebarGroup = {
  name: string;
  icon: TWidgetVariantSummary['tool']['icon'];
  rows: TWidgetSidebarRow[];
};

export type TWidgetSidebarProjection = {
  groups: TWidgetSidebarGroup[];
  ungrouped: TWidgetSidebarRow[];
};
