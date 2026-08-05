import type {
  TWidgetCatalogSnapshot,
} from '../catalog/typed';
import type {
  TOmnidrawToolIcon,
  TWidgetManifestV1,
} from '@omnidraw/widget-contract';

export type TWidgetDraftConfig = Readonly<{
  name: string;
  description: string;
  tool: Readonly<{
    label: string;
    icon: TOmnidrawToolIcon | null;
    group: string | null;
    priority: number;
  }>;
}>;

export type TWidgetFilesystemCatalogMutationResult = Readonly<{
  widgetKey: string;
  generation: number;
  catalogDigestSha256: string;
  snapshot: TWidgetCatalogSnapshot;
}>;

export type TWidgetFilesystemFileEntry = Readonly<{
  path: string;
  kind: 'file' | 'directory';
  byteSize: number;
}>;

export type TWidgetFilesystemFilePreview = Readonly<{
  path: string;
  byteSize: number;
  binary: boolean;
  truncated: boolean;
  text: string | null;
}>;

export type TWidgetFilesystemManagementCapability = Readonly<{
  saveDraftConfig(args: Readonly<{
    widgetKey: string;
    expectedManifestDigestSha256: string;
    config: TWidgetDraftConfig;
    signal?: AbortSignal;
  }>): Promise<TWidgetFilesystemCatalogMutationResult>;
  publishMetadata(args: Readonly<{
    widgetKey: string;
    expectedManifestDigestSha256: string;
    expectedCatalogDigestSha256: string;
    signal?: AbortSignal;
  }>): Promise<TWidgetFilesystemCatalogMutationResult>;
  buildAndPublish(args: Readonly<{
    widgetKey: string;
    expectedManifestDigestSha256: string;
    expectedCatalogDigestSha256: string;
    signal?: AbortSignal;
  }>): Promise<TWidgetFilesystemCatalogMutationResult>;
  listFiles(args: Readonly<{
    widgetKey: string;
    source: 'draft' | 'published';
  }>): readonly TWidgetFilesystemFileEntry[];
  readFile(args: Readonly<{
    widgetKey: string;
    source: 'draft' | 'published';
    path: string;
    maximumBytes: number;
  }>): Promise<TWidgetFilesystemFilePreview>;
}>;

export type TWidgetDraftConfigManifest = Pick<
  TWidgetManifestV1,
  '$schema' | 'schemaVersion' | 'slug' | 'ui' | 'server' | 'resources'
> & TWidgetDraftConfig;
