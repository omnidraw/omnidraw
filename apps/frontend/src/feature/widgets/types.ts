import type { TWidgetCatalogProblem, TWidgetSource, TWidgetVariantSummary } from '@vibecanvas/orpc-client';

export type TWidgetSidebarRow = {
  name: string;
  source: TWidgetSource;
  variant: TWidgetVariantSummary;
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
