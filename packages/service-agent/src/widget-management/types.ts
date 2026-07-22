import type {
  TVibecanvasToolIcon,
  TWidgetBrowserFunctionDescriptor,
  TWidgetFrameBounds,
  TWidgetManifestV2,
  TWidgetPlacementRef,
} from '@vibecanvas/widget-contract';
import type { TWidgetDraftValidation } from '../widget-drafts/types';

export type TWidgetSource = 'published' | 'draft';
export type TWidgetManagementManifest = TWidgetManifestV2;
export type TWidgetRelation = 'published-only' | 'draft-only' | 'same' | 'different' | 'unknown';

export type TWidgetCatalogProblem = {
  code: string;
  message: string;
};

export type TWidgetCatalogGroup = {
  name: string;
  icon: TVibecanvasToolIcon | null;
};

export type TWidgetPlacementSummary = {
  reference: TWidgetPlacementRef;
  bounds: TWidgetFrameBounds;
};

export type TWidgetVariantSummary = {
  draftId: string | null;
  source: TWidgetSource;
  displayName: string;
  kind: 'widget' | null;
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
  placement?: TWidgetPlacementSummary | null;
};

export type TWidgetCatalogPreviewSummary =
  | {
      status: 'ready';
      revision: string;
      placement: TWidgetPlacementSummary;
    }
  | {
      status: 'not-ready' | 'failed';
      revision: string;
      message: string | null;
      placement: null;
    };

export type TWidgetCatalogEntry = {
  name: string;
  relation: TWidgetRelation;
  published: TWidgetVariantSummary | null;
  draft: TWidgetVariantSummary | null;
  preview?: TWidgetCatalogPreviewSummary | null;
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
  manifest: TWidgetManagementManifest | null;
  functions: readonly TWidgetBrowserFunctionDescriptor[];
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

export type TWidgetPlacementErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_MANIFEST'
  | 'STALE_REVISION'
  | 'PREVIEW_NOT_READY'
  | 'PREVIEW_BUILD_FAILED'
  | 'MISSING_RESOURCE_BINDING'
  | 'UNSUPPORTED_BEHAVIOR'
  | 'INVALID_FRAME_BOUNDS';

type TWidgetPlacementDescriptorBase = {
  reference: TWidgetPlacementRef;
  bounds: TWidgetFrameBounds;
};

export type TPublishedWidgetPlacementIdentity = Readonly<{
  definitionId: string;
  revisionId: string;
}>;

export type TPublishedWidgetPlacementTarget = TPublishedWidgetPlacementIdentity & Readonly<{
  name: string;
  slug: string;
  description: string | null;
  contractDigestSha256: string;
  updatedAtMs: number;
  bounds: TWidgetFrameBounds;
}>;

export type TWidgetPlacementDescriptor =
  | (TWidgetPlacementDescriptorBase & {
      kind: 'published';
      draftId: null;
      definitionId: string;
      revisionId: string;
      definitionName: null;
      definitionSlug: string;
    })
  | (TWidgetPlacementDescriptorBase & {
      kind: 'preview';
      draftId: string | null;
      definitionId: null;
      revisionId: null;
      definitionName: null;
      definitionSlug: null;
    });

export type TWidgetPlacementResolveResult =
  | { ok: true; descriptor: TWidgetPlacementDescriptor }
  | {
      ok: false;
      code: TWidgetPlacementErrorCode;
      message: string;
      currentRevision?: string;
    };
