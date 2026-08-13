import { createCatalogInvalidation } from "../../../src/shell/framework/feature/sidebar/ports";
import { WidgetCatalogProvider } from "../../../src/shell/framework/feature/sidebar/widgets/WidgetCatalogProvider";
import { useWidgetCatalog } from "../../../src/shell/framework/feature/sidebar/widgets/WidgetCatalogProvider";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { publicCatalog } from '../widget-public-catalog.fixture';

const lifecycle = {
  fork<A, E>(
    program: Effect.Effect<A, E>,
    observer: Readonly<{ onSuccess?(value: A): void; onError?(error: E): void }> = {},
  ) {
    return Effect.runCallback(program.pipe(
      Effect.tap((value) => Effect.sync(() => observer.onSuccess?.(value))),
      Effect.catch((error) => Effect.sync(() => observer.onError?.(error))),
    ));
  },
};

describe("WidgetCatalogProvider", () => {
  it("interrupts a pending event stream before it acquires an iterator", async () => {
    let resolveEvents!: (value: readonly [null, AsyncIterable<unknown>]) => void;
    const events = vi.fn(() => new Promise<readonly [null, AsyncIterable<unknown>]>((resolve) => {
      resolveEvents = resolve;
    }));
    const acquireIterator = vi.fn(() => ({
      next: () => new Promise<IteratorResult<unknown>>(() => {}),
    }));
    const controller = {
      apiService: {
        api: {
          widget: {
            catalog: {
              events,
              get: vi.fn(async () => [null, publicCatalog([])] as const),
            },
          },
        },
      },
      browser: {
        setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
        clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      },
      invalidation: createCatalogInvalidation(),
      lifecycle,
      subscribeReconnect: () => () => undefined,
      application: {},
    } as never;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(() => (
      <WidgetCatalogProvider controller={controller}>
        <div />
      </WidgetCatalogProvider>
    ), host);

    await vi.waitFor(() => expect(events).toHaveBeenCalledOnce());
    dispose();
    resolveEvents([null, {
      [Symbol.asyncIterator]: acquireIterator,
    }]);

    await Promise.resolve();
    expect(acquireIterator).not.toHaveBeenCalled();
    host.remove();
  });

  it("keeps the last catalog visible and exposes a terminal update-stream failure", async () => {
    const controller = {
      apiService: {
        api: {
          widget: {
            catalog: {
              events: vi.fn(async () => [null, {
                async *[Symbol.asyncIterator]() {
                  throw new Error("catalog replay capacity exhausted");
                },
              }] as const),
              get: vi.fn(async () => [null, publicCatalog([])] as const),
            },
          },
        },
      },
      browser: {
        setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
        clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      },
      invalidation: createCatalogInvalidation(),
      lifecycle,
      subscribeReconnect: () => () => undefined,
      application: {},
    } as never;
    const Status = () => {
      const value = useWidgetCatalog();
      return <output>{`${value.catalog() === null ? "missing" : "ready"}|${value.error()}`}</output>;
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(() => (
      <WidgetCatalogProvider controller={controller}>
        <Status />
      </WidgetCatalogProvider>
    ), host);

    await vi.waitFor(() => expect(host.textContent).toContain("ready|Widget catalog updates are unavailable: catalog replay capacity exhausted"));
    dispose();
    host.remove();
  });
});
