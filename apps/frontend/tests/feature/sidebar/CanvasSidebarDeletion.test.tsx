import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  TCanvasDeletionPlan,
  TCanvasDeletionResult,
} from "../../../src/core/app/private-operation-contract";
import { DeleteCanvasDialog } from "../../../src/shell/framework/feature/sidebar/components/DeleteCanvasDialog";
import { RenameDialog } from "../../../src/shell/framework/feature/sidebar/components/RenameDialog";
import SidebarItem from "../../../src/shell/framework/feature/sidebar/components/SidebarItem";

const canvas = {
  id: "canvas-a",
  name: "Canvas A",
  revision: 4,
  createdAtSec: "2026-08-14 10:00:00",
  updatedAtSec: "2026-08-14 10:01:00",
} as const;

const plan: TCanvasDeletionPlan = {
  canvas,
  itemCount: 3,
  mediaCount: 2,
  retainedChatCount: 1,
};

const result: TCanvasDeletionResult = {
  canvas,
  cleanup: { itemCount: 3, mediaCount: 2, retainedChatCount: 1 },
};

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;

function mount(view: () => unknown): HTMLDivElement {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(view as never, host);
  return host;
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
  document.body.querySelectorAll("[data-popper-positioner]").forEach((node) => node.remove());
});

function pointerEvent(type: string, pointerType: "mouse" | "touch" = "mouse"): Event {
  const EventConstructor = window.PointerEvent ?? window.MouseEvent;
  return new EventConstructor(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "pointerdown" ? 1 : 0,
    pointerType,
  } as PointerEventInit);
}

async function openMenu(): Promise<HTMLButtonElement> {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Options for Canvas A"]')!;
  trigger.dispatchEvent(pointerEvent("pointerdown"));
  trigger.dispatchEvent(pointerEvent("pointerup"));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Rename"));
  return trigger;
}

async function choose(label: "Rename" | "Delete", mode: "pointer" | "touch" | "enter" | "space") {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((candidate) => candidate.textContent?.includes(label));
  expect(item).toBeDefined();
  item!.focus();
  if (mode === "pointer" || mode === "touch") {
    item!.dispatchEvent(pointerEvent("pointermove", mode === "touch" ? "touch" : "mouse"));
    item!.dispatchEvent(pointerEvent("pointerdown", mode === "touch" ? "touch" : "mouse"));
    item!.dispatchEvent(pointerEvent("pointerup", mode === "touch" ? "touch" : "mouse"));
  } else {
    item!.dispatchEvent(new KeyboardEvent("keydown", {
      key: mode === "enter" ? "Enter" : " ",
      code: mode === "enter" ? "Enter" : "Space",
      bubbles: true,
      cancelable: true,
    }));
  }
}

describe("Canvas sidebar menu handoff", () => {
  test("pointer Rename closes the menu, opens the dialog, and Cancel restores trigger focus", async () => {
    const [renameOpen, setRenameOpen] = createSignal(false);
    mount(() => <>
      <SidebarItem name="Canvas A" onRename={() => setRenameOpen(true)} />
      <RenameDialog
        open={renameOpen()}
        onOpenChange={setRenameOpen}
        currentName="Canvas A"
        onRename={() => undefined}
      />
    </>);
    const trigger = await openMenu();
    await choose("Rename", "pointer");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Rename Canvas"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Cancel")!;
    cancel.click();
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Rename Canvas"));
    expect(document.activeElement).toBe(trigger);
  });

  test.each(["pointer", "touch", "enter", "space"] as const)(
    "%s Delete reaches one stable alert-dialog state",
    async (mode) => {
      const [deleteOpen, setDeleteOpen] = createSignal(false);
      const selected = vi.fn(() => setDeleteOpen(true));
      mount(() => <>
        <SidebarItem name="Canvas A" onDelete={selected} />
        <Show when={deleteOpen()}><div role="alertdialog">Delete Canvas</div></Show>
      </>);
      await openMenu();
      await choose("Delete", mode);
      await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(selected).toHaveBeenCalledOnce();
    },
  );
});

describe("DeleteCanvasDialog", () => {
  test("Cancel and Escape send no mutation and the exact plan explains destructive and retained effects", async () => {
    const [open, setOpen] = createSignal(false);
    const onDelete = vi.fn(async () => [null, result] as const);
    let trigger!: HTMLButtonElement;
    mount(() => <>
      <button ref={(element) => { trigger = element; }}>Canvas action trigger</button>
      <DeleteCanvasDialog
        open={open()}
        onOpenChange={setOpen}
        canvas={canvas}
        createDeletionId={() => "deletion-a"}
        onPlan={async () => [null, plan]}
        onDelete={onDelete}
        onDeleted={async () => undefined}
        returnFocus={() => trigger}
      />
    </>);
    trigger.focus();
    setOpen(true);
    await vi.waitFor(() => expect(document.body.textContent).toContain("3 Canvas items"));
    expect(document.body.textContent).toContain("2 media files");
    expect(document.body.textContent).toContain("1 AI Chat history");
    expect(document.body.textContent).toContain("retained, detached, and archived");
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Cancel")!;
    cancel.click();
    await vi.waitFor(() => expect(open()).toBe(false));
    expect(onDelete).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    trigger.focus();
    setOpen(true);
    await vi.waitFor(() => expect(document.body.textContent).toContain("3 Canvas items"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(open()).toBe(false));
    expect(onDelete).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("fences duplicate confirmation, stays open on failure, and permits a safe retry", async () => {
    const [open, setOpen] = createSignal(true);
    let settle!: (value: readonly [never, TCanvasDeletionResult]) => void;
    const pending = new Promise<readonly [never, TCanvasDeletionResult]>((resolve) => { settle = resolve; });
    const failure = { code: "CANVAS_DELETE_COORDINATION_FAILED", status: 503, message: "Deletion could not coordinate chats.", details: null } as never;
    const onDelete = vi.fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValueOnce([failure, undefined])
      .mockResolvedValueOnce([null, result]);
    const onDeleted = vi.fn(async () => undefined);
    mount(() => <DeleteCanvasDialog
      open={open()}
      onOpenChange={setOpen}
      canvas={canvas}
      createDeletionId={() => "deletion-retry"}
      onPlan={async () => [null, plan]}
      onDelete={onDelete}
      onDeleted={onDeleted}
    />);
    const deleteButton = await vi.waitFor(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((candidate) => candidate.textContent === "Delete Canvas");
      expect(button?.disabled).toBe(false);
      return button!;
    });
    deleteButton.click();
    deleteButton.click();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(deleteButton.disabled).toBe(true);

    settle([null as never, result]);
    await vi.waitFor(() => expect(open()).toBe(false));
    expect(onDeleted).toHaveBeenCalledOnce();

    setOpen(true);
    await vi.waitFor(() => expect(document.body.textContent).toContain("3 Canvas items"));
    const retryableDelete = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent === "Delete Canvas")!;
    retryableDelete.click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent)
      .toContain("Deletion could not coordinate chats."));
    expect(open()).toBe(true);
    const retry = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent === "Retry deletion")!;
    retry.click();
    await vi.waitFor(() => expect(open()).toBe(false));
    expect(onDelete).toHaveBeenCalledTimes(3);
  });
});
