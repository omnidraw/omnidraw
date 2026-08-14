import type {
  TWidgetCatalogSnapshot,
} from '../catalog/typed';
import type {
  TOmnidrawToolIcon,
  TWidgetManifestV1,
} from '@omnidraw/sdk/contract';

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

export type TWidgetDeletionSource = 'draft' | 'published';

export type TWidgetDeletionPlacement = Readonly<{
  canvasId: string;
  itemId: string;
  itemRevision: number;
  createdAtSec: string;
  instanceId: string;
  type: 'widget-instance' | 'widget-preview';
}>;

export type TWidgetDeletionMount = Readonly<{
  chatId: string;
  name: string;
  relativePath: string;
  linkTarget: string;
}>;

export type TWidgetDeletionCleanupObservation = Readonly<{
  placements: readonly TWidgetDeletionPlacement[];
  mounts: readonly TWidgetDeletionMount[];
}>;

export type TWidgetDeletionCleanupCapability = Readonly<{
  observe(args: Readonly<{
    widgetKey: string;
    source: TWidgetDeletionSource;
    deleteDraft: boolean;
  }>): Promise<TWidgetDeletionCleanupObservation>;
  retireDraft(widgetKey: string): Promise<void>;
  removePlacement(args: Readonly<{
    operationId: string;
    widgetKey: string;
    placement: TWidgetDeletionPlacement;
  }>): Promise<void>;
  removeMount(args: Readonly<{
    widgetKey: string;
    mount: TWidgetDeletionMount;
  }>): Promise<void>;
}>;

export type TWidgetDeletionPlan = Readonly<{
  planToken: string;
  widgetKey: string;
  source: TWidgetDeletionSource;
  catalogDigestSha256: string;
  pairedDraftPresent: boolean;
  placementCount: number;
  previewPlacementCount: number;
  publishedPlacementCount: number;
  chatMountCount: number;
  resourcesPreserved: true;
}>;

export type TWidgetDeletionResult = Readonly<{
  status: 'committed';
  operationId: string;
  widgetKey: string;
  source: TWidgetDeletionSource;
  generation: number;
  catalogDigestSha256: string;
  removedPlacementCount: number;
  removedChatMountCount: number;
  resourcesPreserved: true;
}>;

export type TWidgetFilesystemManagementCapability = Readonly<{
  planDeletion(args: Readonly<{
    widgetKey: string;
    source: TWidgetDeletionSource;
  }>): Promise<TWidgetDeletionPlan>;
  commitDeletion(args: Readonly<{
    planToken: string;
    operationId: string;
    signal?: AbortSignal;
  }>): Promise<TWidgetDeletionResult>;
  recoverDeletions(): Promise<void>;
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
