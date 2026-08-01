import type {
  TCanvasCommand,
  TCanvasDocumentTransport,
  TCanvasEvent,
} from '@omnidraw/canvas-contract';
import type { TReproductionTraceSink } from './typed';

function eventFacts(event: TCanvasEvent): Readonly<Record<string, unknown>> {
  if (event.type === 'items-changed') {
    return {
      eventType: event.type,
      revision: event.revision,
      commandId: event.commandId,
      changedCount: event.changedItems.length,
      deletedCount: event.deletedItemIds.length,
      affectedNodeIds: [
        ...event.changedItems.map((item) => item.id),
        ...event.deletedItemIds,
      ],
    };
  }
  return {
    eventType: event.type,
    revision: event.revision,
  };
}

function commandFacts(command: TCanvasCommand): Readonly<Record<string, unknown>> {
  return {
    baseRevision: command.baseRevision,
    operationCount: command.operations.length,
    preconditionCount: command.preconditions.length,
    operationTypes: command.operations.map((operation) => operation.type),
    affectedNodeIds: command.operations.map((operation) => (
      operation.type === 'insert' || operation.type === 'replace'
        ? operation.item.id
        : operation.itemId
    )),
  };
}

function errorFacts(error: unknown): Readonly<Record<string, unknown>> {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
}

export function createTracedCanvasDocumentTransport(
  transport: TCanvasDocumentTransport,
  trace: TReproductionTraceSink | null,
): TCanvasDocumentTransport {
  if (trace === null) return transport;
  return Object.freeze({
    async getSnapshot(args) {
      const startedAt = trace.elapsedMs();
      trace.emit({
        channel: 'transport',
        type: 'snapshot-dispatched',
        priority: 'high',
        correlation: { canvasId: args.canvasId },
      });
      try {
        const snapshot = await transport.getSnapshot(args);
        trace.emit({
          channel: 'transport',
          type: 'snapshot-received',
          priority: 'high',
          correlation: { canvasId: args.canvasId },
          data: {
            durationMs: trace.elapsedMs() - startedAt,
            revision: snapshot.revision,
            itemCount: snapshot.items.length,
          },
        });
        return snapshot;
      } catch (error) {
        trace.emit({
          channel: 'transport',
          type: 'snapshot-failed',
          priority: 'critical',
          correlation: { canvasId: args.canvasId },
          data: {
            durationMs: trace.elapsedMs() - startedAt,
            error: errorFacts(error),
          },
        });
        throw error;
      }
    },
    async execute(command) {
      const startedAt = trace.elapsedMs();
      trace.emit({
        channel: 'transport',
        type: 'execute-dispatched',
        priority: 'critical',
        correlation: {
          canvasId: command.canvasId,
          commandId: command.commandId,
        },
        data: commandFacts(command),
      });
      try {
        const event = await transport.execute(command);
        trace.emit({
          channel: 'transport',
          type: 'execute-received',
          priority: 'critical',
          correlation: {
            canvasId: command.canvasId,
            commandId: command.commandId,
          },
          data: {
            durationMs: trace.elapsedMs() - startedAt,
            ...eventFacts(event),
          },
        });
        return event;
      } catch (error) {
        trace.emit({
          channel: 'transport',
          type: 'execute-failed',
          priority: 'critical',
          correlation: {
            canvasId: command.canvasId,
            commandId: command.commandId,
          },
          data: {
            durationMs: trace.elapsedMs() - startedAt,
            error: errorFacts(error),
          },
        });
        throw error;
      }
    },
    subscribe(args) {
      const startedAt = trace.elapsedMs();
      trace.emit({
        channel: 'transport',
        type: 'events-subscribed',
        priority: 'high',
        correlation: { canvasId: args.canvasId },
        data: { afterRevision: args.afterRevision },
      });
      const iterator = transport.subscribe(args)[Symbol.asyncIterator]();
      let ended = false;
      const emitEnded = (): void => {
        if (ended) return;
        ended = true;
        trace.emit({
          channel: 'transport',
          type: 'events-ended',
          priority: 'high',
          correlation: { canvasId: args.canvasId },
          data: { durationMs: trace.elapsedMs() - startedAt },
        });
      };
      const emitFailed = (error: unknown): void => {
        if (ended) return;
        ended = true;
        trace.emit({
          channel: 'transport',
          type: 'events-failed',
          priority: 'critical',
          correlation: { canvasId: args.canvasId },
          data: {
            durationMs: trace.elapsedMs() - startedAt,
            error: errorFacts(error),
          },
        });
      };
      const tracedIterator: AsyncIterableIterator<TCanvasEvent> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          try {
            const result = await iterator.next();
            if (result.done) {
              emitEnded();
              return result;
            }
            const event = result.value;
            trace.emit({
              channel: 'transport',
              type: 'event-received',
              priority: 'critical',
              correlation: {
                canvasId: args.canvasId,
                ...(event.type === 'items-changed'
                  ? { commandId: event.commandId }
                  : {}),
              },
              data: eventFacts(event),
            });
            return result;
          } catch (error) {
            emitFailed(error);
            throw error;
          }
        },
        async return(value) {
          try {
            const result = iterator.return === undefined
              ? { done: true, value }
              : await iterator.return(value);
            emitEnded();
            return result;
          } catch (error) {
            emitFailed(error);
            throw error;
          }
        },
      };
      return tracedIterator;
    },
  });
}
