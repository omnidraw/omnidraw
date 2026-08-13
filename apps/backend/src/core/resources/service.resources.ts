import { Context, type Effect } from 'effect';
import type {
  TResourceDescriptor,
  TResourceId,
  TResourceKind,
  TResourceStatus,
} from './types';

export type TResourceCatalogFilter = Readonly<{
  kind?: TResourceKind;
  status?: TResourceStatus;
}>;

export class ResourceProgramError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ResourceProgramError';
    this.code = code;
  }
}

export interface IResourceAuthority {
  readonly list: (
    args: TResourceCatalogFilter,
  ) => Effect.Effect<readonly TResourceDescriptor[], ResourceProgramError>;
  readonly get: (
    args: Readonly<{ resourceId: TResourceId }>,
  ) => Effect.Effect<TResourceDescriptor | null, ResourceProgramError>;
  readonly create: (
    args: Readonly<{ kind: TResourceKind; name: string }>,
  ) => Effect.Effect<TResourceDescriptor, ResourceProgramError>;
}

export class ResourceAuthority extends Context.Service<ResourceAuthority, IResourceAuthority>()(
  'omnidraw/backend/ResourceAuthority',
) {}
