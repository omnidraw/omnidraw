import { Context, type Effect, type Stream } from 'effect';
import type {
  TWidgetStateChangeArgs,
  TWidgetStateChangeResult,
  TWidgetStateGetArgs,
  TWidgetStateGetResult,
  TWidgetStateSubscribeArgs,
  TWidgetStateSubscriptionEvent,
} from './types';

export class WidgetStateProgramError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WidgetStateProgramError';
    this.code = code;
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
