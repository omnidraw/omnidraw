export type TWidgetAuthoringDraftSelector =
  | Readonly<{ widgetKey: string; name?: never }>
  | Readonly<{ name: string; widgetKey?: never }>;

export type TWidgetAuthoringCatalogEntry = Readonly<{
  widgetKey: string;
  displayName: string;
  draft: null | Readonly<{
    health: 'healthy' | 'unhealthy';
    digestSha256: string;
    relativePath: string;
  }>;
  published: boolean;
}>;

export type TWidgetAuthoringCatalog = Readonly<{
  generation: number;
  digestSha256: string;
  entries: readonly TWidgetAuthoringCatalogEntry[];
}>;

export type TWidgetAuthoringDraftResolution = Readonly<{
  catalogGeneration: number;
  catalogDigestSha256: string;
  widgetKey: string;
  displayName: string;
  draftDigestSha256: string;
  draftRelativePath: string;
}>;

export type TWidgetAuthoringDraftResolutionFailure = Readonly<{
  code:
    | 'WIDGET_NOT_FOUND'
    | 'WIDGET_NAME_AMBIGUOUS'
    | 'WIDGET_NAME_CASE_COLLISION'
    | 'DRAFT_REQUIRED'
    | 'DRAFT_UNHEALTHY';
  message: string;
}>;

export type TWidgetAuthoringDraftResolutionDecision =
  | Readonly<{ ok: true; resolution: TWidgetAuthoringDraftResolution }>
  | Readonly<{ ok: false; failure: TWidgetAuthoringDraftResolutionFailure }>;
