/**
 * @file Public widget manifest and immutable artifact contract surface.
 */

export type {
  IWidgetArtifactReader,
  IWidgetArtifactStore,
  IWidgetRevisionReader,
} from './interface';
export type {
  TWidgetArtifactDescriptor,
  TWidgetArtifactDigest,
  TWidgetArtifactId,
  TWidgetArtifactKind,
  TWidgetArtifactPut,
  TWidgetArtifactReadCapability,
  TWidgetDefinitionDescriptor,
  TWidgetDefinitionId,
  TWidgetDefinitionStatus,
  TWidgetManifestV2,
  TWidgetRevisionDescriptor,
  TWidgetRevisionId,
  TWidgetServerManifest,
  TWidgetUiManifest,
} from './types';
export {
  fnWidgetManifestAllowsResource,
  fnWidgetRevisionArtifactsMatchManifest,
} from './core/fn.manifest';
