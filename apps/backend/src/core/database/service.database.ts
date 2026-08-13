import { Context, Schema, type Effect } from 'effect';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';

export type TCanvasRecord = Readonly<{
  id: string;
  name: string;
  revision: number;
  createdAtSec: string;
  updatedAtSec: string;
}>;

export const DATABASE_PROGRAM_ERROR_CODES = Object.freeze([
  'CANVAS_NOT_FOUND',
  'DATABASE_UNAVAILABLE',
] as const);

export type TDatabaseProgramErrorCode = typeof DATABASE_PROGRAM_ERROR_CODES[number];

export class DatabaseProgramError extends Schema.TaggedError<DatabaseProgramError>()(
  'DatabaseProgramError',
  {
    code: Schema.Literals(DATABASE_PROGRAM_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TDatabaseProgramErrorCode | TSemanticFailureFields<TDatabaseProgramErrorCode>,
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

export interface IDatabaseAuthority {
  readonly listCanvases: () => Effect.Effect<readonly TCanvasRecord[], DatabaseProgramError>;
  readonly findCanvas: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<TCanvasRecord | null, DatabaseProgramError>;
}

export class DatabaseAuthority extends Context.Service<DatabaseAuthority, IDatabaseAuthority>()(
  'omnidraw/backend/DatabaseAuthority',
) {}
