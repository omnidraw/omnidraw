import { Context, Schema, type Effect, type Stream } from 'effect';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';

export type TWidgetCatalogEntry = Readonly<{
  widgetKey: string;
  generation: number;
  catalogDigestSha256: string;
  draftManifestDigestSha256: string | null;
  available: boolean;
}>;

export type TWidgetPublicationRequest = Readonly<{
  widgetKey: string;
  expectedGeneration: number;
  expectedCatalogDigestSha256: string;
  expectedManifestDigestSha256: string;
}>;

export type TWidgetPublicationResult = Readonly<{
  widgetKey: string;
  generation: number;
  published: boolean;
}>;

export const WIDGET_PROGRAM_ERROR_CODES = Object.freeze([
  'WIDGET_CATALOG_CHANGED',
  'WIDGET_CURSOR_INVALID',
  'WIDGET_NOT_FOUND',
  'WIDGET_UNAVAILABLE',
] as const);

export type TWidgetProgramErrorCode = typeof WIDGET_PROGRAM_ERROR_CODES[number];

export class WidgetProgramError extends Schema.TaggedError<WidgetProgramError>()(
  'WidgetProgramError',
  {
    code: Schema.Literals(WIDGET_PROGRAM_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TWidgetProgramErrorCode | TSemanticFailureFields<TWidgetProgramErrorCode>,
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

export interface IWidgetAuthority {
  readonly catalog: () => Effect.Effect<readonly TWidgetCatalogEntry[], WidgetProgramError>;
  readonly publish: (
    args: TWidgetPublicationRequest,
  ) => Effect.Effect<TWidgetPublicationResult, WidgetProgramError>;
  readonly events: (
    args: Readonly<{ afterGeneration?: number }>,
  ) => Effect.Effect<Stream.Stream<TWidgetPublicationResult, WidgetProgramError>, WidgetProgramError>;
}

export class WidgetAuthority extends Context.Service<WidgetAuthority, IWidgetAuthority>()(
  'omnidraw/backend/WidgetAuthority',
) {}
