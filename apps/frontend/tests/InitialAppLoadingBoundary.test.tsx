import { render, type JSX } from "@solidjs/web";
import { createRouter, memoryHistory } from "@solidjs/router";
import { lazy, Loading, type Component } from "solid-js";
import { afterEach, describe, expect, test, vi } from "vitest";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("initial application loading boundary", () => {
  test("owns the pending read from an initially matched lazy route", async () => {
    let resolveRoute!: (module: { default: Component }) => void;
    const LazyRoute = lazy(() => new Promise<{ default: Component }>((resolve) => {
      resolveRoute = resolve;
    }));
    const Router = createRouter({
      history: memoryHistory("/"),
      routes: [{ path: "/", component: LazyRoute }],
    });
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const host = document.createElement("div");
    document.body.append(host);

    dispose = render(() => (
      <Loading fallback={null}>
        <Router>
          {(props): JSX.Element => props.children}
        </Router>
      </Loading>
    ), host);

    expect(warnings.mock.calls.flat().map(String).join("\n"))
      .not.toContain("ASYNC_OUTSIDE_LOADING_BOUNDARY");

    resolveRoute({ default: () => <p>Lazy route ready</p> });
    await vi.waitFor(() => expect(host.textContent).toContain("Lazy route ready"));
  });
});
