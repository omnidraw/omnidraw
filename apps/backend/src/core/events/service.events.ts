import { Context, type Effect, type Stream } from 'effect';
import type { TAgentEvent, TDbEvent, TNotificationEvent, TSequencedEvent } from './events';

export class EventProgramError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EventProgramError';
    this.code = code;
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
