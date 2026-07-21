/**
 * @file UI-agnostic widget manifest, artifact, definition, and revision types.
 */

import type { TResourceRequirement } from '@vibecanvas/resource-runtime';
import type { TOrganizationId } from '@vibecanvas/tenant-core';

export type TWidgetDefinitionId = string;
export type TWidgetRevisionId = string;
export type TWidgetArtifactId = string;
export type TWidgetArtifactDigest = string;
export type TWidgetArtifactReadCapability = string;

export type TWidgetArtifactKind = 'ui' | 'server' | 'source' | 'source_map';
export type TWidgetDefinitionStatus = 'draft' | 'published' | 'archived';

export type TWidgetUiManifest = Readonly<{
  entry: string;
}>;

export type TWidgetServerManifest = Readonly<{
  entry: string;
  runtimeAbi: string;
}>;

export type TWidgetManifestV2 = Readonly<{
  schemaVersion: 2;
  name: string;
  slug: string;
  description?: string;
  ui: TWidgetUiManifest;
  server?: TWidgetServerManifest;
  resources?: readonly TResourceRequirement[];
}>;

export type TWidgetArtifactDescriptor = Readonly<{
  orgId: TOrganizationId;
  id: TWidgetArtifactId;
  kind: TWidgetArtifactKind;
  digestSha256: TWidgetArtifactDigest;
  byteSize: number;
}>;

export type TWidgetArtifactPut = Readonly<{
  kind: TWidgetArtifactKind;
  digestSha256: TWidgetArtifactDigest;
  bytes: Uint8Array;
}>;

export type TWidgetDefinitionDescriptor = Readonly<{
  orgId: TOrganizationId;
  id: TWidgetDefinitionId;
  slug: string;
  name: string;
  status: TWidgetDefinitionStatus;
  activeRevisionId: TWidgetRevisionId | null;
}>;

export type TWidgetRevisionDescriptor = Readonly<{
  orgId: TOrganizationId;
  id: TWidgetRevisionId;
  definitionId: TWidgetDefinitionId;
  revisionNumber: number;
  manifest: TWidgetManifestV2;
  contractDigestSha256: string;
  uiArtifact: TWidgetArtifactDescriptor;
  serverArtifact: TWidgetArtifactDescriptor | null;
}>;
