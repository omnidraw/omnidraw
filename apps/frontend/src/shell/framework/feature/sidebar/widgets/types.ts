import type { TWidgetPlacementRef } from '@omnidraw/sdk';
import type {
  TWidgetPublicCatalogEntry,
  TWidgetPublicCatalogForm,
  TWidgetPublicIssue,
} from '../ports';

export type TWidgetSource = 'draft' | 'published';

export type TWidgetSidebarPlacement = Readonly<{
  reference: TWidgetPlacementRef;
  bounds: Readonly<{ width: number; height: number }>;
}>;

export type TWidgetSidebarRow = {
  widgetKey: string;
  source: TWidgetSource;
  /** add places the publication; preview places an ephemeral draft Preview. */
  action: 'add' | 'preview';
  form: TWidgetPublicCatalogForm;
  entry: TWidgetPublicCatalogEntry;
  placement: TWidgetSidebarPlacement | null;
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
