import type {
  TWidgetPublicCatalogEntry,
  TWidgetPublicCatalogForm,
  TWidgetPublicIssue,
  TWidgetPublicPlacement,
} from '@omnidraw/orpc-client';

export type TWidgetSource = 'draft' | 'published';

export type TWidgetSidebarRow = {
  widgetKey: string;
  source: TWidgetSource;
  form: TWidgetPublicCatalogForm;
  entry: TWidgetPublicCatalogEntry;
  placement: TWidgetPublicPlacement | null;
  problem: TWidgetPublicIssue | null;
};

export type TWidgetSidebarGroup = {
  name: string;
  rows: TWidgetSidebarRow[];
};

export type TWidgetSidebarProjection = {
  groups: TWidgetSidebarGroup[];
  ungrouped: TWidgetSidebarRow[];
};
