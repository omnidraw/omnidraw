import { Schema } from 'effect';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';

export const CANVAS_AUTHORITY_ERROR_CODES = Object.freeze([
  'NOT_FOUND',
  'INVALID_COMMAND',
  'LIMIT_EXCEEDED',
  'CONFLICT',
  'STORE_CONFLICT',
  'POST_COMMIT_FAILURE',
  'UNAVAILABLE',
] as const);

export type TCanvasAuthorityErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_COMMAND'
  | 'LIMIT_EXCEEDED'
  | 'CONFLICT'
  | 'STORE_CONFLICT'
  | 'POST_COMMIT_FAILURE'
  | 'UNAVAILABLE';

export class CanvasAuthorityError extends Schema.TaggedError<CanvasAuthorityError>()(
  'CanvasAuthorityError',
  {
    code: Schema.Literals(CANVAS_AUTHORITY_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TCanvasAuthorityErrorCode | TSemanticFailureFields<TCanvasAuthorityErrorCode>,
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
