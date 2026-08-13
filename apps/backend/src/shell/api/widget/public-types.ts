import type {
  TResourceRequirement,
} from '#backend/shell/resources';
import type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetPresentationProjection,
} from '@omnidraw/sdk/contract';

export type TWidgetPublicIssue = Readonly<{
  code: string;
  message: string;
}>;

export type TWidgetPublicCatalogForm = Readonly<{
  source: 'draft' | 'published';
  health: 'healthy' | 'unhealthy';
  manifestDigestSha256: string | null;
  config: TWidgetPresentationProjection | null;
  resources: readonly TResourceRequirement[];
  functions: readonly TWidgetBrowserFunctionDescriptor[];
  fileCount: number;
  issues: readonly TWidgetPublicIssue[];
}>;

export type TWidgetPublicCatalogDifferences = Readonly<{
  availability: 'draft-only' | 'published-only' | 'draft-and-published';
  manifest: 'same' | 'different' | 'unavailable';
  presentation: 'same' | 'different' | 'unavailable';
  executableManifest: 'same' | 'different' | 'unavailable';
  status:
    | 'draft-only'
    | 'published-only'
    | 'matched'
    | 'presentation-changed'
    | 'executable-changed'
    | 'unavailable';
}>;

export type TWidgetPublicPlacement = Readonly<{
  reference: Readonly<{
    source: 'published';
    widgetKey: string;
    catalogGeneration: number;
  }>;
  bounds: Readonly<{ width: number; height: number }>;
}>;

export type TWidgetPublicCatalogEntry = Readonly<{
  widgetKey: string;
  health: 'healthy' | 'degraded' | 'unhealthy';
  placeable: boolean;
  differences: TWidgetPublicCatalogDifferences;
  draft: TWidgetPublicCatalogForm | null;
  published: TWidgetPublicCatalogForm | null;
  placement: TWidgetPublicPlacement | null;
}>;

export type TWidgetPublicCatalog = Readonly<{
  format: 'omnidraw.widget-catalog.public.v1';
  generation: number;
  catalogDigestSha256: string;
  healthy: boolean;
  groups: readonly string[];
  entries: readonly TWidgetPublicCatalogEntry[];
  issues: readonly TWidgetPublicIssue[];
}>;

export type TWidgetPublicMutationResult = Readonly<{
  widgetKey: string;
  generation: number;
  catalogDigestSha256: string;
}>;

export type TWidgetPublicFileEntry = Readonly<{
  path: string;
  kind: 'file' | 'directory';
  byteSize: number;
}>;

export type TWidgetPublicFileList = Readonly<{
  entries: readonly TWidgetPublicFileEntry[];
  truncated: boolean;
}>;

export type TWidgetPublicFilePreview = Readonly<{
  path: string;
  byteSize: number;
  binary: boolean;
  truncated: boolean;
  text: string | null;
}>;
