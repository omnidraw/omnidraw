import { Context, Schema, type Effect, type Stream } from 'effect';
import type {
  TWidgetStateChangeArgs,
  TWidgetStateChangeResult,
  TWidgetStateGetArgs,
  TWidgetStateGetResult,
  TWidgetStateSubscribeArgs,
  TWidgetStateSubscriptionEvent,
} from './types';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';

export const WIDGET_STATE_PROGRAM_ERROR_CODES = Object.freeze([
  'WIDGET_STATE_CAPACITY_UNAVAILABLE',
  'WIDGET_STATE_UNAVAILABLE',
] as const);

export type TWidgetStateProgramErrorCode = typeof WIDGET_STATE_PROGRAM_ERROR_CODES[number];

export class WidgetStateProgramError extends Schema.TaggedError<WidgetStateProgramError>()(
  'WidgetStateProgramError',
  {
    code: Schema.Literals(WIDGET_STATE_PROGRAM_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TWidgetStateProgramErrorCode | TSemanticFailureFields<TWidgetStateProgramErrorCode>,
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

export interface IWidgetStateAuthority {
  readonly get: (
    args: TWidgetStateGetArgs,
  ) => Effect.Effect<TWidgetStateGetResult, WidgetStateProgramError>;
  readonly change: (
    args: TWidgetStateChangeArgs,
  ) => Effect.Effect<TWidgetStateChangeResult, WidgetStateProgramError>;
  readonly events: (
    args: TWidgetStateSubscribeArgs,
  ) => Effect.Effect<Stream.Stream<TWidgetStateSubscriptionEvent, WidgetStateProgramError>, WidgetStateProgramError>;
}

export class WidgetStateAuthority extends Context.Service<WidgetStateAuthority, IWidgetStateAuthority>()(
  'omnidraw/backend/WidgetStateAuthority',
) {}
