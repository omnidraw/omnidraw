import { createCatalogInvalidation } from "../../src/sidebar/ports";
import { WidgetCatalogProvider } from "../../src/sidebar/widgets/WidgetCatalogProvider";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

describe("WidgetCatalogProvider", () => {
  it("closes an event stream that resolves after the provider unmounts", async () => {
    let resolveEvents!: (value: readonly [null, AsyncIterable<unknown>]) => void;
    const events = vi.fn(() => new Promise<readonly [null, AsyncIterable<unknown>]>((resolve) => {
      resolveEvents = resolve;
    }));
    const returnStream = vi.fn(async () => ({ done: true, value: undefined }) as IteratorResult<unknown>);
    const controller = {
      apiService: {
        api: {
          agent: {
            events,
            widgets: {
              catalog: vi.fn(async () => [null, { generation: 1 }] as const),
            },
          },
        },
      },
      browser: {
        setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
        clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      },
      invalidation: createCatalogInvalidation(),
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
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>(() => {}),
          return: returnStream,
        };
      },
    }]);

    await vi.waitFor(() => expect(returnStream).toHaveBeenCalledOnce());
    host.remove();
  });
});
