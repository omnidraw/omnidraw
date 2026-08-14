import { Context, Schema, type Effect } from 'effect';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';

export type TCanvasDeletionPlan = Readonly<{
  canvas: Readonly<{
    id: string;
    name: string;
    revision: number;
    createdAtSec: string;
    updatedAtSec: string;
  }>;
  itemCount: number;
  mediaCount: number;
  retainedChatCount: number;
}>;

export type TCanvasDeletionResult = Readonly<{
  canvas: TCanvasDeletionPlan['canvas'];
  cleanup: Readonly<{
    itemCount: number;
    mediaCount: number;
    retainedChatCount: number;
  }>;
}>;

export const CANVAS_DELETION_ERROR_CODES = Object.freeze([
  'CANVAS_DELETE_NOT_FOUND',
  'CANVAS_DELETE_STALE',
  'CANVAS_DELETE_BUSY',
  'CANVAS_DELETE_COORDINATION_FAILED',
] as const);

export type TCanvasDeletionErrorCode = typeof CANVAS_DELETION_ERROR_CODES[number];

export class CanvasDeletionError extends Schema.TaggedError<CanvasDeletionError>()(
  'CanvasDeletionError',
  {
    code: Schema.Literals(CANVAS_DELETION_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TCanvasDeletionErrorCode | TSemanticFailureFields<TCanvasDeletionErrorCode>,
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

export interface ICanvasDeletionStore {
  readonly receipt: (
    args: Readonly<{ deletionId: string; canvasId: string }>,
  ) => Effect.Effect<TCanvasDeletionResult | null, CanvasDeletionError>;
  readonly plan: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<TCanvasDeletionPlan, CanvasDeletionError>;
  readonly commit: (
    args: Readonly<{ deletionId: string; plan: TCanvasDeletionPlan }>,
  ) => Effect.Effect<TCanvasDeletionResult, CanvasDeletionError>;
}

export interface ICanvasChatLifecycle {
  readonly disposeCanvas: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<void, CanvasDeletionError>;
  readonly resumeCanvas: (
    args: Readonly<{ canvasId: string }>,
  ) => Effect.Effect<void, CanvasDeletionError>;
}

export class CanvasDeletionStore extends Context.Service<CanvasDeletionStore, ICanvasDeletionStore>()(
  'omnidraw/backend/CanvasDeletionStore',
) {}

export class CanvasChatLifecycle extends Context.Service<CanvasChatLifecycle, ICanvasChatLifecycle>()(
  'omnidraw/backend/CanvasChatLifecycle',
) {}
