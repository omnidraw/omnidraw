import { Context, Schema, type Effect, type Stream } from 'effect';
import type { TAgentEvent, TDbEvent, TNotificationEvent, TSequencedEvent } from './events';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';

export const EVENT_PROGRAM_ERROR_CODES = Object.freeze([
  'EVENT_CURSOR_INVALID',
  'EVENT_REPLAY_UNAVAILABLE',
  'EVENT_SUBSCRIBER_OVERFLOW',
  'EVENT_UNAVAILABLE',
] as const);

export type TEventProgramErrorCode = typeof EVENT_PROGRAM_ERROR_CODES[number];

export class EventProgramError extends Schema.TaggedError<EventProgramError>()(
  'EventProgramError',
  {
    code: Schema.Literals(EVENT_PROGRAM_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TEventProgramErrorCode | TSemanticFailureFields<TEventProgramErrorCode>,
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

export interface IEventAuthority {
  readonly publishAgent: (event: TAgentEvent) => Effect.Effect<number, EventProgramError>;
  readonly agent: (
    args: Readonly<{ afterSequence?: number }>,
  ) => Effect.Effect<Stream.Stream<TSequencedEvent<TAgentEvent>, EventProgramError>, EventProgramError>;
  readonly db: (
    args: Readonly<{ canvasId: string; afterSequence?: number }>,
  ) => Effect.Effect<Stream.Stream<TSequencedEvent<TDbEvent>, EventProgramError>, EventProgramError>;
  readonly notifications: (
    args: Readonly<{ afterSequence?: number }>,
  ) => Effect.Effect<Stream.Stream<TSequencedEvent<TNotificationEvent>, EventProgramError>, EventProgramError>;
}

export class EventAuthority extends Context.Service<EventAuthority, IEventAuthority>()(
  'omnidraw/backend/EventAuthority',
) {}
