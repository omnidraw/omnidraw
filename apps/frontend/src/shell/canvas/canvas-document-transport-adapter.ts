import type {
  TCanvasCommand,
  TCanvasDocumentTransport,
  TCanvasEvent,
  TCanvasItemsChangedEvent,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';

export type TCanvasDocumentApi = Readonly<{
  snapshot(
    input: Readonly<{ canvasId: string }>,
  ): Promise<readonly [
    unknown,
    TCanvasSnapshot | null | undefined,
    ...unknown[],
  ]>;
  execute(
    command: TCanvasCommand,
  ): Promise<readonly [
    unknown,
    TCanvasItemsChangedEvent | null | undefined,
    ...unknown[],
  ]>;
  query(
    input: TCanvasItemQuery,
  ): Promise<readonly [
    unknown,
    TCanvasItemPage | null | undefined,
    ...unknown[],
  ]>;
  events(
    input: Readonly<{ canvasId: string; afterRevision: number }>,
  ): Promise<readonly [
    unknown,
    AsyncIterable<TCanvasEvent> | null | undefined,
    ...unknown[],
  ]>;
}>;

function transportError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export function createCanvasDocumentTransport(
  api: TCanvasDocumentApi,
): TCanvasDocumentTransport {
  return Object.freeze({
    async getSnapshot(input) {
      const [error, snapshot] = await api.snapshot(input);
      if (error || !snapshot) {
        throw transportError(error, 'Canvas snapshot is unavailable.');
      }
      return snapshot;
    },
    async execute(command) {
      const [error, event] = await api.execute(command);
      if (error || !event) {
        throw transportError(error, 'Canvas command was rejected.');
      }
      return event;
    },
    async query(query) {
      const [error, page] = await api.query(query);
      if (error || !page) {
        throw transportError(error, 'Canvas query is unavailable.');
      }
      return page;
    },
    subscribe(input) {
      const done = Object.freeze({
        done: true,
        value: undefined,
      }) satisfies IteratorReturnResult<undefined>;
      let iterator: AsyncIterator<TCanvasEvent> | null = null;
      let opening: Promise<AsyncIterator<TCanvasEvent>> | null = null;
      let closed = false;
      let iteratorClose: Promise<void> | null = null;
      let settleClosed!: (
        result: IteratorReturnResult<undefined>,
      ) => void;
      const closedResult = new Promise<IteratorReturnResult<undefined>>(
        (resolve) => {
          settleClosed = resolve;
        },
      );
      const closeIterator = (
        activeIterator: AsyncIterator<TCanvasEvent>,
      ): Promise<void> => {
        iteratorClose ??= (async () => {
          try {
            await activeIterator.return?.();
          } catch {
            // A transport close failure cannot keep the local runtime alive.
          }
        })();
        return iteratorClose;
      };
      const open = (): Promise<AsyncIterator<TCanvasEvent>> => {
        opening ??= api.events(input).then(([error, events]) => {
          if (error || !events) {
            throw transportError(error, 'Canvas event stream is unavailable.');
          }
          iterator = events[Symbol.asyncIterator]();
          return iterator;
        });
        return opening;
      };
      const subscription: AsyncIterableIterator<TCanvasEvent> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          if (closed) return done;
          const nextResult = open()
            .then(async (activeIterator) => {
              if (closed) {
                await closeIterator(activeIterator);
                return done;
              }
              try {
                return await activeIterator.next();
              } catch (error) {
                if (closed) return done;
                throw error;
              }
            })
            .catch((error) => {
              if (closed) return done;
              throw error;
            });
          return Promise.race([nextResult, closedResult]);
        },
        async return() {
          if (closed) {
            if (iteratorClose !== null) await iteratorClose;
            return done;
          }
          closed = true;
          settleClosed(done);
          if (iterator !== null) {
            await closeIterator(iterator);
          } else if (opening !== null) {
            void opening.then(closeIterator).catch(() => undefined);
          }
          return done;
        },
      };
      return subscription;
    },
  });
}
