import { createSignal, type JSX } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { CreateCanvasDialog } from "../../../src/shell/framework/feature/sidebar/components/CreateCanvasDialog";
import { CreateResourceDialog } from "../../../src/shell/framework/feature/sidebar/components/CreateResourceDialog";
import Sidebar from "../../../src/shell/framework/feature/sidebar/components/Sidebar";
import {
  createCatalogInvalidation,
  type TSidebarController,
} from "../../../src/shell/framework/feature/sidebar/ports";
import styles from "../../../src/shell/framework/feature/sidebar/components/SidebarDialog.module.css";
import { WidgetCatalogProvider } from "../../../src/shell/framework/feature/sidebar/widgets/WidgetCatalogProvider";
import { publicCatalog } from "../widget-public-catalog.fixture";
import { settleSolidUpdate } from "../../settled";

const cleanups: Array<() => void> = [];

function mount(view: () => JSX.Element): void {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(view, host);
  cleanups.push(() => {
    dispose();
    host.remove();
  });
}

function findButton(label: string): HTMLButtonElement {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === label)!;
}

function press(target: EventTarget, key: string, shiftKey = false): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, shiftKey }));
}

function pressBackdrop(): void {
  const overlay = document.body.querySelector<HTMLElement>(`.${styles.overlay}`)!;
  overlay.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("owned sidebar create dialogs", () => {
  test("Sidebar snapshots its reactive controller injection across the complete resource create flow", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const resources: Array<{
      id: string;
      kind: "kv" | "secretStore" | "db";
      name: string;
      status: string;
    }> = [];
    const listResources = vi.fn(async () => [undefined, [...resources]] as const);
    const createResource = vi.fn(async (value: { kind: "kv" | "secretStore" | "db"; name: string }) => {
      resources.push({ id: `resource-${resources.length}`, status: "ready", ...value });
      return [undefined, resources.at(-1)] as const;
    });
    const invalidation = createCatalogInvalidation();
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
    const value = {
      apiService: {
        api: {
          canvas: {
            create: vi.fn(),
            list: vi.fn(async () => [undefined, []] as const),
            update: vi.fn(),
            deletionPlan: vi.fn(),
            remove: vi.fn(),
          },
          resource: { resources: { list: listResources, create: createResource } },
          widget: {
            catalog: {
              get: vi.fn(async () => [undefined, publicCatalog([])] as const),
              events: vi.fn(async () => [undefined, {
                async *[Symbol.asyncIterator]() { /* no live events in this fixture */ },
              }] as const),
            },
          },
        },
      },
      application: {
        pathname: () => "/c/canvas-1",
        canvases: () => [],
        navigate: vi.fn(),
        canvasCreated: vi.fn(),
        canvasUpdated: vi.fn(),
        canvasesReplaced: vi.fn(),
        themeAppearance: () => "light" as const,
        setThemeAppearance: vi.fn(),
        toggleSidebar: vi.fn(),
        notifyError: vi.fn(),
        notifySuccess: vi.fn(),
      },
      browser: {
        createIdempotencyKey: () => "operation-1",
        setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
        clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      },
      invalidation,
      lifecycle,
      subscribeReconnect: () => () => undefined,
    } as unknown as TSidebarController;

    mount(() => {
      const [injectedController] = createSignal(value);
      return <WidgetCatalogProvider controller={value}>
        <Sidebar controller={injectedController()} />
      </WidgetCatalogProvider>;
    });

    await vi.waitFor(() => expect(document.body.querySelector('button[aria-label="Add resource"]')).not.toBeNull());
    const kinds = ["kv", "secretStore", "db"] as const;
    for (const [index, kind] of kinds.entries()) {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="Add resource"]')!.click();
      const name = await vi.waitFor(() => {
        const input = document.body.querySelector<HTMLInputElement>('input[placeholder="Shared preferences"]');
        expect(input).not.toBeNull();
        return input!;
      });
      const select = document.body.querySelector<HTMLSelectElement>("select")!;
      select.value = kind;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      name.value = `Resource ${index}`;
      name.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await settleSolidUpdate();
      findButton("Create resource").click();
      await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    }
    expect(createResource).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(listResources.mock.calls.length).toBeGreaterThanOrEqual(4));

    const diagnostics = [...warnings.mock.calls, ...errors.mock.calls]
      .flat()
      .map(String)
      .join("\n");
    expect(diagnostics).not.toContain("STRICT_READ_UNTRACKED");
  });

  test("resource dialog opens repeatedly through a reactive prop getter without Solid diagnostics", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let setOpen!: (open: boolean) => boolean;
    const onCreate = vi.fn(async () => true);
    mount(() => {
      const [open, writeOpen] = createSignal(false);
      const [handlers] = createSignal({
        onOpenChange: writeOpen,
        onCreate,
      });
      setOpen = writeOpen;
      return <CreateResourceDialog
        open={open()}
        onOpenChange={handlers().onOpenChange}
        onCreate={handlers().onCreate}
      />;
    });

    for (let review = 0; review < 3; review += 1) {
      setOpen(true);
      const name = await vi.waitFor(() => {
        const input = document.body.querySelector<HTMLInputElement>('input[placeholder="Shared preferences"]');
        expect(input).not.toBeNull();
        return input!;
      });
      name.value = `Resource ${review}`;
      name.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await settleSolidUpdate();
      findButton("Create resource").click();
      await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    }
    expect(onCreate).toHaveBeenCalledTimes(3);

    const diagnostics = [...warnings.mock.calls, ...errors.mock.calls]
      .flat()
      .map(String)
      .join("\n");
    expect(diagnostics).not.toContain("STRICT_READ_UNTRACKED");
  });

  test("Canvas creation stays absent while closed and preserves modal keyboard, backdrop, and focus semantics", async () => {
    const [open, setOpen] = createSignal(false);
    const onCanvasCreated = vi.fn();
    let trigger!: HTMLButtonElement;
    mount(() => <>
      <button ref={(element) => { trigger = element; }} onClick={() => setOpen(true)}>Open canvas creation</button>
      <CreateCanvasDialog
        open={open()}
        onOpenChange={setOpen}
        onCanvasCreated={onCanvasCreated}
      />
    </>);

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    trigger.focus();
    trigger.click();
    const dialog = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(value).not.toBeNull();
      return value!;
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)).not.toBeNull();
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)).not.toBeNull();

    const input = document.body.querySelector<HTMLInputElement>('input[placeholder="Untitled Canvas"]')!;
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    input.value = "  Project Atlas  ";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settleSolidUpdate();
    const create = findButton("Create Canvas");
    expect(create.disabled).toBe(false);
    press(input, "Tab", true);
    expect(document.activeElement).toBe(create);
    press(create, "Tab");
    expect(document.activeElement).toBe(input);

    press(input, "Escape");
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onCanvasCreated).not.toHaveBeenCalled();

    trigger.click();
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull());
    findButton("Create Canvas").click();
    expect(onCanvasCreated).toHaveBeenCalledOnce();
    expect(onCanvasCreated).toHaveBeenCalledWith("Project Atlas");
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    trigger.click();
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull());
    pressBackdrop();
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("resource creation resets each review, fences duplicate submits, and restores focus after every close path", async () => {
    const [open, setOpen] = createSignal(false);
    let resolveCreate!: (created: boolean) => void;
    const pendingCreate = new Promise<boolean>((resolve) => { resolveCreate = resolve; });
    const onCreate = vi.fn(() => pendingCreate);
    let trigger!: HTMLButtonElement;
    mount(() => <>
      <button ref={(element) => { trigger = element; }} onClick={() => setOpen(true)}>Open resource creation</button>
      <CreateResourceDialog open={open()} onOpenChange={setOpen} onCreate={onCreate} />
    </>);

    trigger.focus();
    trigger.click();
    const name = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLInputElement>('input[placeholder="Shared preferences"]');
      expect(value).not.toBeNull();
      return value!;
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(name));
    findButton("Create resource").click();
    const alert = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>('[role="alert"]');
      expect(value?.textContent).toContain("Resource name is required.");
      return value!;
    });
    expect(name.getAttribute("aria-describedby")).toBe(alert.id);

    const kind = document.body.querySelector<HTMLSelectElement>("select")!;
    kind.value = "db";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    name.value = " Primary data ";
    name.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settleSolidUpdate();
    expect(document.body.textContent).toContain("The database starts empty.");
    kind.focus();
    press(kind, "Tab", true);
    expect(document.activeElement).toBe(findButton("Create resource"));

    const create = findButton("Create resource");
    create.click();
    create.click();
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith({ kind: "db", name: "Primary data" });
    await settleSolidUpdate();
    expect(create.disabled).toBe(true);
    resolveCreate(true);
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    trigger.click();
    const resetName = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLInputElement>('input[placeholder="Shared preferences"]');
      expect(value).not.toBeNull();
      return value!;
    });
    await settleSolidUpdate();
    expect(resetName.value).toBe("");
    press(resetName, "Escape");
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    trigger.click();
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull());
    pressBackdrop();
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("resource creation fences an old submission across close and reopen", async () => {
    const [open, setOpen] = createSignal(false);
    const pending: Array<{
      promise: Promise<boolean>;
      resolve(created: boolean): void;
    }> = [];
    const onCreate = vi.fn(() => {
      let resolve!: (created: boolean) => void;
      const promise = new Promise<boolean>((complete) => { resolve = complete; });
      pending.push({ promise, resolve });
      return promise;
    });
    let trigger!: HTMLButtonElement;
    mount(() => <>
      <button ref={(element) => { trigger = element; }} onClick={() => setOpen(true)}>Open resource creation</button>
      <CreateResourceDialog open={open()} onOpenChange={setOpen} onCreate={onCreate} />
    </>);

    trigger.click();
    const firstName = await vi.waitFor(() => {
      const input = document.body.querySelector<HTMLInputElement>('input[placeholder="Shared preferences"]');
      expect(input).not.toBeNull();
      return input!;
    });
    firstName.value = "First resource";
    firstName.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settleSolidUpdate();
    findButton("Create resource").click();
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(document.body.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

    press(firstName, "Escape");
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    trigger.click();
    const secondName = await vi.waitFor(() => {
      const input = document.body.querySelector<HTMLInputElement>('input[placeholder="Shared preferences"]');
      expect(input).not.toBeNull();
      return input!;
    });
    await settleSolidUpdate();
    expect(secondName.value).toBe("");
    expect(findButton("Create resource").disabled).toBe(false);

    secondName.value = "Second resource";
    secondName.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settleSolidUpdate();
    findButton("Create resource").click();
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    const currentSubmit = document.body.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(currentSubmit.disabled).toBe(true);
    expect(currentSubmit.textContent).toBe("Creating…");

    pending[0]!.resolve(true);
    await settleSolidUpdate();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(currentSubmit.disabled).toBe(true);
    expect(currentSubmit.textContent).toBe("Creating…");

    pending[1]!.resolve(true);
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    expect(onCreate).toHaveBeenNthCalledWith(1, { kind: "kv", name: "First resource" });
    expect(onCreate).toHaveBeenNthCalledWith(2, { kind: "kv", name: "Second resource" });
  });
});
