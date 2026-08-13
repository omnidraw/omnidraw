import type { TResourceEffect, TResourceKind } from '#backend/shell/resources';

export type TWidgetReferenceInput = Readonly<{
  name: string;
  source: 'draft' | 'published';
}>;

export type TWidgetReferenceRequirementSummary = Readonly<{
  slot: string;
  kind: TResourceKind;
  effect: TResourceEffect;
  required: boolean;
}>;

export type TResolvedWidgetReference = Readonly<{
  widgetKey: string;
  requestedVariant: 'draft' | 'published';
  displayName: string;
  health: 'healthy';
  draftAvailable: boolean;
  publicationAvailable: boolean;
  requirements: readonly TWidgetReferenceRequirementSummary[];
  editableDraft: null | Readonly<{
    name: string;
    slug: string;
    treeDigestSha256: string;
    buildPhase: 'unbuilt' | 'build_required' | 'building' | 'validating' | 'ready' | 'rejected';
    acceptedGeneration: number | null;
    acceptedCurrent: boolean;
  }>;
}>;

export type TWidgetReferenceResolution = Readonly<{
  catalogGeneration: number;
  catalogDigestSha256: string;
  references: readonly TResolvedWidgetReference[];
}>;

export type TWidgetReferenceResolver = Readonly<{
  resolve(references: readonly TWidgetReferenceInput[]): Promise<TWidgetReferenceResolution>;
  assertCurrent(resolution: TWidgetReferenceResolution): Promise<void>;
}>;

export type TWidgetPromptSelectionContext = Readonly<{
  canvasId: string;
  explicitlyMentioned: readonly TResolvedWidgetReference[];
  activeEditableTarget: null | Readonly<{
    widgetKey: string;
    name: string;
    mountedPath: string;
  }>;
}>;
