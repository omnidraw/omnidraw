import { Context, Schema, type Effect } from 'effect';
import type {
  TResourceDescriptor,
  TResourceId,
  TResourceKind,
  TResourceStatus,
} from './types';
import { RESOURCE_ERROR_CODES, type TResourceErrorCode } from './types';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';

export type TResourceCatalogFilter = Readonly<{
  kind?: TResourceKind;
  status?: TResourceStatus;
}>;

export class ResourceProgramError extends Schema.TaggedError<ResourceProgramError>()(
  'ResourceProgramError',
  {
    code: Schema.Literals(RESOURCE_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TResourceErrorCode | TSemanticFailureFields<TResourceErrorCode>,
    message?: string,
    details: TSemanticFailureDetails = EMPTY_SEMANTIC_FAILURE_DETAILS,
    options?: ErrorOptions,
  ) {
    super(typeof codeOrFields === 'string'
      ? { code: codeOrFields, message: message ?? codeOrFields, details }
      : codeOrFields);
    attachSemanticFailureCause(this, options?.cause);
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
