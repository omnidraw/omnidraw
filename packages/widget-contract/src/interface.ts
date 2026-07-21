/**
 * @file Narrow widget artifact and immutable revision read capabilities.
 */

import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TWidgetArtifactDescriptor,
  TWidgetArtifactId,
  TWidgetArtifactPut,
  TWidgetArtifactReadCapability,
  TWidgetDefinitionId,
  TWidgetRevisionDescriptor,
  TWidgetRevisionId,
} from './types';

export interface IWidgetArtifactReader {
  getArtifact(
    tenant: TTenantContext,
    request: Readonly<{
      artifactId: TWidgetArtifactId;
      readCapability: TWidgetArtifactReadCapability;
    }>,
  ): Promise<TWidgetArtifactDescriptor | null>;

  readArtifact(
    tenant: TTenantContext,
    request: Readonly<{
      artifactId: TWidgetArtifactId;
      readCapability: TWidgetArtifactReadCapability;
    }>,
  ): Promise<Uint8Array | null>;
}

export interface IWidgetArtifactStore extends IWidgetArtifactReader {
  putArtifact(
    tenant: TTenantContext,
    artifact: TWidgetArtifactPut,
  ): Promise<TWidgetArtifactDescriptor>;
}

export interface IWidgetRevisionReader {
  getRevision(
    tenant: TTenantContext,
    revisionId: TWidgetRevisionId,
  ): Promise<TWidgetRevisionDescriptor | null>;

  getActiveRevision(
    tenant: TTenantContext,
    definitionId: TWidgetDefinitionId,
  ): Promise<TWidgetRevisionDescriptor | null>;
}
