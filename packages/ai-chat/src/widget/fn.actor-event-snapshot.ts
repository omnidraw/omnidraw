import type { TActorEvent } from '@vibecanvas/api-actors/contract';
import type { TActorStatus, TWidgetError } from '@vibecanvas/service-db/model';

export type TActorSnapshot = {
  status: TActorStatus;
  state: string;
  context: unknown;
  error: TWidgetError | null;
};

export type TActorEventSnapshotResult = {
  snapshot: TActorSnapshot;
  recovered: boolean;
  error?: TWidgetError;
};

export function fnActorEventSnapshot(args: { snapshot: TActorSnapshot | null; event: TActorEvent }): TActorEventSnapshotResult | null {
  const { event, snapshot } = args;
  if (event.kind !== 'system') return null;

  if (event.type === 'state.changed') {
    return {
      recovered: true,
      snapshot: {
        state: event.to,
        context: snapshot?.context ?? null,
        status: snapshot?.status ?? 'running',
        error: snapshot?.error ?? null,
      },
    };
  }

  if (event.type === 'data.changed') {
    return {
      recovered: true,
      snapshot: {
        state: snapshot?.state ?? 'booting',
        context: event.data,
        status: snapshot?.status ?? 'running',
        error: snapshot?.error ?? null,
      },
    };
  }

  if (event.type === 'snapshot') {
    return {
      recovered: event.cause !== 'error',
      snapshot: {
        state: event.state,
        context: event.data,
        status: event.cause === 'error' ? (snapshot?.status ?? 'running') : 'running',
        error: event.cause === 'error' ? (snapshot?.error ?? null) : null,
      },
    };
  }

  if (event.type === 'error') {
    const error: TWidgetError = {
      phase: 'sandbox-runtime',
      code: event.code,
      message: event.message,
      details: event.details,
      retryable: true,
    };
    return {
      recovered: false,
      error,
      snapshot: {
        status: 'error',
        state: 'error',
        context: {
          code: event.code,
          message: event.message,
          details: event.details,
        },
        error,
      },
    };
  }

  return null;
}
