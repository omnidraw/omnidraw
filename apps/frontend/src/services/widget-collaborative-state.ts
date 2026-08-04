import {
  createWidgetCollaborativeStatePort,
  type TWidgetCollaborativeStateIdentity,
  type TWidgetCollaborativeStateTransportPort,
  type TWidgetCollaborativeStateTransportSnapshot,
} from '@omnidraw/ui-ai-chat/widget-runtime';
import { orpcWebsocketService } from './orpc-websocket';

function stateInput(identity: TWidgetCollaborativeStateIdentity) {
  return Object.freeze({
    canvasId: identity.canvasId,
    elementId: identity.elementId,
    widgetInstanceId: identity.widgetInstanceId,
  });
}

function transportSnapshot(
  snapshot: Readonly<{
    identity: TWidgetCollaborativeStateIdentity;
    version: number;
    state: TWidgetCollaborativeStateTransportSnapshot['state'];
  }>,
): TWidgetCollaborativeStateTransportSnapshot {
  return Object.freeze({
    identity: Object.freeze({ ...snapshot.identity }),
    version: snapshot.version,
    state: snapshot.state,
  });
}

export const widgetCollaborativeStatePort = createWidgetCollaborativeStatePort({
  isIdentityCurrent() {
    return true;
  },
  openTransport(): TWidgetCollaborativeStateTransportPort {
    let disposed = false;
    const eventIterators = new Set<AsyncIterator<Readonly<{
      snapshot: TWidgetCollaborativeStateTransportSnapshot;
    }>>>();
    const assertAvailable = (): void => {
      if (disposed) {
        throw new Error('Widget collaborative state transport is disposed.');
      }
    };

    return Object.freeze({
      async get({ identity: exactIdentity, signal }) {
        assertAvailable();
        const [error, result] = await orpcWebsocketService.apiService.api
          .widget.runtime.state.get(stateInput(exactIdentity), { signal });
        assertAvailable();
        if (error) throw error;
        if (!result || result.status === 'unavailable') {
          throw new Error('Widget collaborative state target is unavailable.');
        }
        return transportSnapshot(result.snapshot);
      },
      async change({
        identity: exactIdentity,
        expectedVersion,
        state,
        signal,
      }) {
        assertAvailable();
        const [error, result] = await orpcWebsocketService.apiService.api
          .widget.runtime.state.change({
            ...stateInput(exactIdentity),
            expectedVersion,
            state,
          }, { signal });
        assertAvailable();
        if (error) throw error;
        if (!result || result.status === 'unavailable') {
          throw new Error('Widget collaborative state target is unavailable.');
        }
        if (result.status === 'rate-limited') {
          throw new Error(
            `Widget collaborative state mutation rate limit exceeded; retry after ${result.retryAfterMs}ms.`,
          );
        }
        return Object.freeze({
          status: result.status,
          snapshot: transportSnapshot(result.snapshot),
        });
      },
      async events({
        identity: exactIdentity,
        afterVersion,
        signal,
      }) {
        assertAvailable();
        const [error, events] = await orpcWebsocketService.apiService.api
          .widget.runtime.state.events({
            ...stateInput(exactIdentity),
            afterVersion,
          }, { signal });
        assertAvailable();
        if (error || !events) {
          throw error ?? new Error('Widget collaborative state event stream is unavailable.');
        }
        return {
          [Symbol.asyncIterator]() {
            const iterator = events[Symbol.asyncIterator]();
            eventIterators.add(iterator);
            return {
              async next(): Promise<IteratorResult<TWidgetCollaborativeStateTransportSnapshot>> {
                const result = await iterator.next();
                if (result.done) {
                  eventIterators.delete(iterator);
                  return { done: true, value: undefined };
                }
                assertAvailable();
                return {
                  done: false,
                  value: transportSnapshot(result.value.snapshot),
                };
              },
              async return(): Promise<IteratorResult<TWidgetCollaborativeStateTransportSnapshot>> {
                eventIterators.delete(iterator);
                await iterator.return?.();
                return { done: true, value: undefined };
              },
            };
          },
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const iterator of eventIterators) {
          void iterator.return?.().catch(() => undefined);
        }
        eventIterators.clear();
      },
    });
  },
});
