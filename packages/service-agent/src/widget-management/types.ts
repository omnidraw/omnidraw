import type { TVibecanvasToolIcon } from '@vibecanvas/service-actor/core/tool-icon';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TWidgetDraftValidation } from '../widget-drafts/types';

export type TWidgetSource = 'published' | 'draft';
export type TWidgetRelation = 'published-only' | 'draft-only' | 'same' | 'different' | 'unknown';

export type TWidgetCatalogProblem = {
  code: string;
  message: string;
};

export type TWidgetCatalogGroup = {
  name: string;
  icon: TVibecanvasToolIcon | null;
};

export type TWidgetVariantSummary = {
  source: TWidgetSource;
  displayName: string;
  kind: 'widget' | 'actor-widget' | null;
  slug: string | null;
  description: string | null;
  revision: string;
  contentFingerprint: string | null;
  updatedAt: string | null;
  tool: {
    label: string | null;
    icon: TVibecanvasToolIcon | null;
    group: string | null;
    priority: number | null;
    behaviorType: 'mode' | 'action' | 'modal' | null;
  };
  validation: TWidgetDraftValidation | null;
};

export type TWidgetCatalogEntry = {
  name: string;
  relation: TWidgetRelation;
  published: TWidgetVariantSummary | null;
  draft: TWidgetVariantSummary | null;
  problem: TWidgetCatalogProblem | null;
};

export type TWidgetCatalog = {
  generation: string;
  groups: TWidgetCatalogGroup[];
  widgets: TWidgetCatalogEntry[];
};

export type TWidgetDetail = {
  name: string;
  source: TWidgetSource;
  relation: TWidgetRelation;
  variant: TWidgetVariantSummary;
  sibling: TWidgetVariantSummary | null;
  manifest: TVibecanvasJson | null;
  problem: TWidgetCatalogProblem | null;
};

export type TWidgetFileEntry = {
  path: string;
  kind: 'file' | 'directory';
  size: number;
};

export type TWidgetFilePreview = {
  path: string;
  size: number;
  binary: boolean;
  text: string | null;
  truncated: boolean;
};

export type TWidgetDraftToolPatch = {
  icon?: TVibecanvasToolIcon | null;
  group?: string | null;
};

export type TWidgetDraftMetadataPatch = {
  name?: string;
  description?: string;
  tool?: {
    label?: string;
    icon?: TVibecanvasToolIcon | null;
    group?: string | null;
    priority?: number | null;
  };
};

export type TWidgetDraftMetadataPatchResult = {
  name: string;
  variant: TWidgetVariantSummary;
};

export type TWidgetDeleteResult = {
  name: string;
  source: TWidgetSource;
  deletedDefinition: boolean;
  deletedPublished: boolean;
  deletedDraft: boolean;
  deletedInstances: boolean;
  issues: {
    target: 'runtime-definition' | 'published-source' | 'draft-source';
    message: string;
  }[];
};
