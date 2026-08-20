import { render } from "@solidjs/web";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TRouteResource } from "../../../src/shell/framework/pages/resource";
import { GenericResourcePage } from "../../../src/shell/framework/feature/resource/GenericResourcePage";
import { FrontendRuntimeProvider } from "../../../src/shell/framework/runtime-context";
import type { TFrontendRuntime } from "../../../src/shell/runtime/frontend-runtime";
import { settleSolidUpdate } from "../../settled";

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  searchParams: { tab: "data" },
  setSearchParams: vi.fn(),
}));
const toasts = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => router.navigate,
  useSearchParams: () => [router.searchParams, router.setSearchParams],
}));
vi.mock("../../../src/shell/framework/components/ui/Toast", () => ({
  showErrorToast: toasts.error,
  showSuccessToast: toasts.success,
}));

const kvResource = (id: string, name: string): TRouteResource => ({
  id,
  kind: "kv",
  name,
  status: "ready",
  createdAtSec: "1",
  updatedAtSec: "2",
});

function deferredResult<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await settleSolidUpdate();
  document.body.replaceChildren();
  router.searchParams.tab = "data";
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("generic resource secret reveal", () => {
  test("checks the injected owner document before exposing a secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(document.visibilityState).toBe("visible");
    const ownerDocument = document.implementation.createHTMLDocument("secondary owner");
    Object.defineProperty(ownerDocument, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    let resolveReveal!: (result: readonly [null, {
      kind: "secretStore";
      name: string;
      value: string;
      revision: number;
    }]) => void;
    const reveal = new Promise<readonly [null, {
      kind: "secretStore";
      name: string;
      value: string;
      revision: number;
    }]>((resolve) => { resolveReveal = resolve; });
    const safeRequest = vi.fn((path: string) => {
      if (path === "resource.resources.data") {
        return Promise.resolve([null, {
          kind: "secretStore" as const,
          entries: [{
            name: "production/token",
            revision: 7,
            createdAtSec: "1",
            updatedAtSec: "2",
          }],
          nextCursor: null,
        }] as const);
      }
      if (path === "resource.resources.dataRevealSecret") return reveal;
      throw new Error(`Unexpected request: ${path}`);
    });
    const runtime = {
      ownerWindow: window,
      ownerDocument,
      api: { safeRequest },
      fork: vi.fn(() => () => undefined),
      store: { set: vi.fn() },
      catalogInvalidation: { invalidate: vi.fn() },
    } as unknown as TFrontendRuntime;
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => (
      <FrontendRuntimeProvider runtime={runtime}>
        <GenericResourcePage resource={{
          id: "secret-resource",
          kind: "secretStore",
          name: "Production secrets",
          status: "ready",
          createdAtSec: "1",
          updatedAtSec: "2",
        }} />
      </FrontendRuntimeProvider>
    ), host);

    const revealButton = await vi.waitFor(() => {
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="Reveal secret value"]');
      expect(button).not.toBeNull();
      return button!;
    });
    revealButton.click();
    await vi.waitFor(() => expect(safeRequest).toHaveBeenCalledWith(
      "resource.resources.dataRevealSecret",
      { resourceId: "secret-resource", name: "production/token" },
    ));

    resolveReveal([null, {
      kind: "secretStore",
      name: "production/token",
      value: "do-not-expose",
      revision: 7,
    }]);
    await settleSolidUpdate();

    expect(host.textContent).not.toContain("do-not-expose");
    expect(host.textContent).toContain("••••••••");
    expect(host.querySelector('button[aria-label="Reveal secret value"]')).not.toBeNull();
    expect(runtime.fork).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().map(String).join("\n")).not.toMatch(/STRICT_READ_UNTRACKED|REACTIVE_WRITE|REACTIVITY_HALTED/);
    warn.mockRestore();
  });

  test("ignores a rename completion after routing from resource A to B", async () => {
    router.searchParams.tab = "overview";
    const rename = deferredResult<readonly [null, unknown]>();
    const safeRequest = vi.fn((path: string) => {
      if (path === "resource.resources.rename") return rename.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const runtime = {
      ownerWindow: window,
      ownerDocument: document,
      api: { safeRequest },
      fork: vi.fn(() => () => undefined),
      store: { set: vi.fn() },
      catalogInvalidation: { invalidate: vi.fn() },
    } as unknown as TFrontendRuntime;
    const [resource, setResource] = createSignal(kvResource("resource-a", "Resource A"));
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => (
      <FrontendRuntimeProvider runtime={runtime}>
        <GenericResourcePage resource={resource()} />
      </FrontendRuntimeProvider>
    ), host);

    await settleSolidUpdate();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Display name"]')
      ?? host.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    input!.value = "Renamed A";
    input!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Renamed A" }));
    await settleSolidUpdate();
    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save name");
    expect(save?.disabled).toBe(false);
    save!.click();
    await vi.waitFor(() => expect(safeRequest).toHaveBeenCalledWith(
      "resource.resources.rename",
      { resourceId: "resource-a", name: "Renamed A" },
    ));

    setResource(kvResource("resource-b", "Resource B"));
    rename.resolve([null, {}]);
    await settleSolidUpdate();
    await settleSolidUpdate();

    expect(host.textContent).toContain("Resource B");
    expect(host.textContent).not.toContain("Renamed A");
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(runtime.catalogInvalidation.invalidate).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  test("does not continue a resource deletion after disposal", async () => {
    router.searchParams.tab = "overview";
    const deletion = deferredResult<readonly [null, unknown]>();
    const safeRequest = vi.fn((path: string) => {
      if (path === "resource.resources.delete") return deletion.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const runtime = {
      ownerWindow: window,
      ownerDocument: document,
      api: { safeRequest },
      fork: vi.fn(() => () => undefined),
      store: { set: vi.fn() },
      catalogInvalidation: { invalidate: vi.fn() },
    } as unknown as TFrontendRuntime;
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => (
      <FrontendRuntimeProvider runtime={runtime}>
        <GenericResourcePage resource={kvResource("resource-a", "Resource A")} />
      </FrontendRuntimeProvider>
    ), host);

    await settleSolidUpdate();
    const openDelete = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Delete");
    openDelete!.click();
    await settleSolidUpdate();
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    const confirmDelete = [...dialog!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Delete resource");
    confirmDelete!.click();
    await vi.waitFor(() => expect(safeRequest).toHaveBeenCalledWith(
      "resource.resources.delete",
      { resourceId: "resource-a" },
    ));

    dispose();
    dispose = undefined;
    deletion.resolve([null, {}]);
    await settleSolidUpdate();

    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(runtime.catalogInvalidation.invalidate).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
