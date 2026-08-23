import { render, type JSX } from "@solidjs/web";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StructureChangeDialog } from "../../../src/shell/framework/feature/db-resource/components/StructureChangeDialog";
import {
  Toaster,
  showToast,
  toaster,
} from "../../../src/shell/framework/components/ui/Toast";
import {
  AlertDialog,
  Checkbox,
  Dialog,
  DropdownMenu,
  Switch,
  Tabs,
  TextField,
} from "../../../src/shell/framework/feature/resource/owned-primitives";
import { settleSolidUpdate } from "../../settled";

const cleanups: Array<() => void> = [];
let warnings: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;

function mount(view: () => JSX.Element): void {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(view, host);
  cleanups.push(() => {
    dispose();
    host.remove();
  });
}

function press(target: EventTarget, key: string, shiftKey = false): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, shiftKey }));
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await settleSolidUpdate();
  const diagnostics = [...warnings.mock.calls, ...errors.mock.calls]
    .flat()
    .map(String)
    .join("\n");
  expect(diagnostics).not.toContain("STRICT_READ_UNTRACKED");
  toaster.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("owned resource primitives", () => {
  test("tabs expose the tab contract and activate adjacent panels from the keyboard", async () => {
    const [selected, setSelected] = createSignal("summary");
    mount(() => (
      <Tabs.Root value={selected()} onChange={setSelected}>
        <Tabs.List>
          <Tabs.Trigger value="summary">Summary</Tabs.Trigger>
          <Tabs.Trigger value="data">Data</Tabs.Trigger>
          <Tabs.Trigger value="sql">SQL</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="summary">Summary panel</Tabs.Content>
        <Tabs.Content value="data">Data panel</Tabs.Content>
        <Tabs.Content value="sql">SQL panel</Tabs.Content>
      </Tabs.Root>
    ));

    const list = document.body.querySelector<HTMLElement>('[role="tablist"]')!;
    const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(3);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.tabIndex).toBe(0);
    expect(document.body.querySelector('[role="tabpanel"]')?.textContent).toBe("Summary panel");

    tabs[0]!.focus();
    press(tabs[0]!, "ArrowRight");
    await settleSolidUpdate();
    expect(selected()).toBe("data");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    const panel = document.body.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(panel.textContent).toBe("Data panel");
    expect(tabs[1]?.getAttribute("aria-controls")).toBe(panel.id);

    press(tabs[1]!, "End");
    await settleSolidUpdate();
    expect(selected()).toBe("sql");
    expect(document.activeElement).toBe(tabs[2]);
  });

  test("dialogs trap focus, close on Escape and backdrop, and restore trigger focus", async () => {
    const [open, setOpen] = createSignal(false);
    let trigger!: HTMLButtonElement;
    mount(() => <>
      <Toaster />
      <button ref={(element) => { trigger = element; }} onClick={() => setOpen(true)}>Open editor</button>
      <Dialog.Root open={open()} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="test-overlay" />
          <Dialog.Content>
            <Dialog.Title>Edit entry</Dialog.Title>
            <Dialog.Description>Update the resource value.</Dialog.Description>
            <button autofocus>First action</button>
            <Dialog.CloseButton>Close editor</Dialog.CloseButton>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>);

    const applicationRoot = document.body.firstElementChild as HTMLElement;
    applicationRoot.inert = false;
    applicationRoot.setAttribute("aria-hidden", "false");
    showToast("Background notice");
    await settleSolidUpdate();
    trigger.focus();
    trigger.click();
    const dialog = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(value).not.toBeNull();
      return value!;
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent)
      .toBe("Edit entry");
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Update the resource value.");

    const actions = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
    await vi.waitFor(() => expect(document.activeElement).toBe(actions[0]));
    expect(applicationRoot.inert).toBe(true);
    expect(applicationRoot.getAttribute("aria-hidden")).toBe("true");

    trigger.focus();
    expect(document.activeElement).toBe(actions[0]);
    document.dispatchEvent(new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      code: "KeyT",
      key: "t",
    }));
    expect(document.activeElement).toBe(actions[0]);
    press(actions[0]!, "Tab", true);
    expect(document.activeElement).toBe(actions[1]);
    press(actions[1]!, "Tab");
    expect(document.activeElement).toBe(actions[0]);

    press(actions[0]!, "Escape");
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(applicationRoot.inert).toBe(false);
    expect(applicationRoot.getAttribute("aria-hidden")).toBe("false");

    trigger.click();
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull());
    document.body.querySelector<HTMLElement>(".test-overlay")!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("keeps focus when reactive editor state changes while a dialog stays open", async () => {
    const [editor, setEditor] = createSignal<{ key: string; value: string } | null>(null);
    mount(() => <>
      <button onClick={() => setEditor({ key: "settings", value: "{}" })}>Open value</button>
      <Dialog.Root open={editor() !== null} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Edit value</Dialog.Title>
            <Dialog.Description>Update the resource value.</Dialog.Description>
            <TextField.Root value={editor()?.key ?? ""} onChange={(key) => setEditor((current) => current === null ? null : { ...current, key })}>
              <TextField.Label>Key</TextField.Label>
              <TextField.Input />
            </TextField.Root>
            <TextField.Root value={editor()?.value ?? ""} onChange={(value) => setEditor((current) => current === null ? null : { ...current, value })}>
              <TextField.Label>JSON value</TextField.Label>
              <TextField.TextArea />
            </TextField.Root>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>);

    document.body.querySelector<HTMLButtonElement>("button")!.click();
    const textarea = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLTextAreaElement>("textarea");
      expect(value).not.toBeNull();
      return value!;
    });
    textarea.focus();
    textarea.value = '{"enabled":true}';
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: "e", inputType: "insertText" }));
    await settleSolidUpdate();

    expect(editor()?.value).toBe('{"enabled":true}');
    expect(document.activeElement).toBe(textarea);
  });

  test("only the topmost modal owns focus and nested close restores its parent scope", async () => {
    const [outerOpen, setOuterOpen] = createSignal(false);
    const [innerOpen, setInnerOpen] = createSignal(false);
    let outsideTrigger!: HTMLButtonElement;
    let innerTrigger!: HTMLButtonElement;
    mount(() => <>
      <button ref={(element) => { outsideTrigger = element; }} onClick={() => setOuterOpen(true)}>
        Open outer dialog
      </button>
      <Dialog.Root open={outerOpen()} onOpenChange={setOuterOpen}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Outer editor</Dialog.Title>
            <Dialog.Description>Edit the resource.</Dialog.Description>
            <button
              ref={(element) => { innerTrigger = element; }}
              onClick={() => setInnerOpen(true)}
            >Open confirmation</button>
            <Dialog.CloseButton>Close outer</Dialog.CloseButton>
            <AlertDialog.Root open={innerOpen()} onOpenChange={setInnerOpen}>
              <AlertDialog.Portal>
                <AlertDialog.Overlay />
                <AlertDialog.Content>
                  <AlertDialog.Title>Confirm change</AlertDialog.Title>
                  <AlertDialog.Description>Review the destructive operation.</AlertDialog.Description>
                  <AlertDialog.CloseButton>Cancel confirmation</AlertDialog.CloseButton>
                  <button type="button">Confirm</button>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>);

    outsideTrigger.focus();
    outsideTrigger.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(innerTrigger));
    innerTrigger.focus();
    innerTrigger.click();
    const inner = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>('[role="alertdialog"]');
      expect(value).not.toBeNull();
      return value!;
    });
    const cancel = [...inner.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Cancel confirmation")!;
    await vi.waitFor(() => expect(document.activeElement).toBe(cancel));

    innerTrigger.focus();
    expect(document.activeElement).toBe(cancel);
    press(cancel, "Escape");
    await vi.waitFor(() => expect(document.body.querySelector('[role="alertdialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(innerTrigger));
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    press(innerTrigger, "Escape");
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(outsideTrigger));
  });

  test("dropdown menus preserve open focus intent and release document focus when it leaves", async () => {
    const selected = vi.fn();
    mount(() => <>
      <Toaster />
      <button class="outside-focus">Outside control</button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>Object actions</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => selected("rename")}>Rename table</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => selected("drop")}>Drop table</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>);

    const trigger = document.body.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    trigger.click();
    const menu = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>('[role="menu"]');
      expect(value).not.toBeNull();
      return value!;
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
    expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    await vi.waitFor(() => expect(document.activeElement).toBe(items[0]));
    press(items[0]!, "ArrowDown");
    await settleSolidUpdate();
    expect(document.activeElement).toBe(items[1]);
    expect(items[1]?.hasAttribute("data-highlighted")).toBe(true);
    items[1]!.click();
    await settleSolidUpdate();
    expect(selected).toHaveBeenCalledWith("drop");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    press(trigger, "ArrowDown");
    await vi.waitFor(() => {
      const values = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      expect(values).toHaveLength(2);
      expect(document.activeElement).toBe(values[0]);
    });
    press(document.activeElement!, "Escape");
    await vi.waitFor(() => expect(document.body.querySelector('[role="menu"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    press(trigger, "ArrowUp");
    await vi.waitFor(() => {
      const values = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      expect(values).toHaveLength(2);
      expect(document.activeElement).toBe(values[1]);
    });
    press(document.activeElement!, "Escape");
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    press(trigger, "ArrowDown");
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Rename table"));
    const outside = document.body.querySelector<HTMLButtonElement>(".outside-focus")!;
    outside.focus();
    await vi.waitFor(() => expect(document.body.querySelector('[role="menu"]')).toBeNull());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(outside);
    const outsideArrow = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    });
    outside.dispatchEvent(outsideArrow);
    expect(outsideArrow.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside);

    press(trigger, "ArrowDown");
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Rename table"));
    document.dispatchEvent(new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      code: "KeyT",
      key: "t",
    }));
    const toastList = document.body.querySelector<HTMLOListElement>("ol")!;
    await vi.waitFor(() => expect(document.activeElement).toBe(toastList));
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("dropdown menus measure, flip, clamp, and bound their portaled content near the viewport edge", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_024);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches('[aria-haspopup="menu"]')) return domRect(990, 730, 30, 20);
      if (this.matches('[data-anchored-popup="owned-dropdown-menu"]')) {
        return domRect(0, 0, 180, 120);
      }
      return domRect(0, 0, 0, 0);
    });
    const host = document.createElement("div");
    host.style.overflow = "hidden";
    host.setAttribute("data-omnidraw-theme-scope", "test");
    document.body.append(host);
    const dispose = render(() => (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>Edge actions</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => undefined}>Rename edge</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => undefined}>Delete edge</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    ), host);
    cleanups.push(() => {
      dispose();
      host.remove();
    });

    host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click();
    const menu = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>('[data-anchored-popup="owned-dropdown-menu"]');
      expect(value).not.toBeNull();
      expect(value?.style.visibility).toBe("visible");
      return value!;
    });
    expect(host.contains(menu)).toBe(false);
    expect(menu.dataset.anchoredSide).toBe("top");
    expect(menu.style.left).toBe("836px");
    expect(menu.style.top).toBe("606px");
    expect(menu.style.maxWidth).toBe("1008px");
    expect(menu.style.maxHeight).toBe("752px");
    expect(menu.style.minWidth).toBe("30px");
    expect(menu.style.overflowY).toBe("auto");
  });

  test("text, checkbox, and switch controls keep native labels and state", async () => {
    const [text, setText] = createSignal("initial");
    const [checked, setChecked] = createSignal(false);
    const [enabled, setEnabled] = createSignal(false);
    mount(() => <>
      <TextField.Root value={text()} onChange={setText}>
        <TextField.Label>Resource key</TextField.Label>
        <TextField.Input />
      </TextField.Root>
      <Checkbox.Root checked={checked()} onChange={setChecked}>
        <Checkbox.Input />
        <Checkbox.Control class="checkbox-control"><Checkbox.Indicator>✓</Checkbox.Indicator></Checkbox.Control>
        <Checkbox.Label>Confirm change</Checkbox.Label>
      </Checkbox.Root>
      <Switch.Root checked={enabled()} onChange={setEnabled}>
        <Switch.Input />
        <Switch.Control class="switch-control"><Switch.Thumb /></Switch.Control>
        <Switch.Label>Allow NULL</Switch.Label>
      </Switch.Root>
    </>);

    const textInput = document.body.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
    const textLabel = [...document.body.querySelectorAll<HTMLLabelElement>("label")]
      .find((label) => label.textContent === "Resource key")!;
    expect(textLabel.htmlFor).toBe(textInput.id);
    textInput.value = "updated";
    textInput.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const controls = [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    controls[0]!.click();
    controls[1]!.click();
    await settleSolidUpdate();
    expect(text()).toBe("updated");
    expect(checked()).toBe(true);
    expect(document.body.querySelector(".checkbox-control")?.hasAttribute("data-checked")).toBe(true);
    expect(enabled()).toBe(true);
    expect(controls[1]?.getAttribute("role")).toBe("switch");
    expect(controls[1]?.getAttribute("aria-checked")).toBe("true");
    expect(document.body.querySelector(".switch-control")?.hasAttribute("data-checked")).toBe(true);
  });

  test("the structure editor exposes a native declared-type select and submits its value", async () => {
    const onSubmit = vi.fn();
    mount(() => (
      <StructureChangeDialog
        open
        kind="createTable"
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
      />
    ));

    const dialog = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(value).not.toBeNull();
      return value!;
    });
    const typeLabel = [...dialog.querySelectorAll<HTMLLabelElement>("label")]
      .find((label) => label.textContent === "Declared type")!;
    const typeSelect = document.getElementById(typeLabel.htmlFor) as HTMLSelectElement;
    expect(typeSelect.tagName).toBe("SELECT");
    expect([...typeSelect.options].map((option) => option.value)).toEqual([
      "TEXT",
      "INTEGER",
      "REAL",
      "BLOB",
      "ANY",
    ]);
    typeSelect.value = "INTEGER";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    const inputFor = (labelText: string) => {
      const label = [...dialog.querySelectorAll<HTMLLabelElement>("label")]
        .find((candidate) => candidate.textContent === labelText)!;
      return document.getElementById(label.htmlFor) as HTMLInputElement;
    };
    const tableName = inputFor("Table name");
    tableName.focus();
    tableName.value = "events";
    tableName.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settleSolidUpdate();
    expect(document.activeElement).toBe(tableName);

    const columnName = inputFor("Initial column name");
    columnName.focus();
    columnName.value = "event_id";
    columnName.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settleSolidUpdate();
    expect(document.activeElement).toBe(columnName);

    [...dialog.querySelectorAll<HTMLButtonElement>('button[type="submit"]')][0]!.click();
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "createTable",
      table: "events",
      columns: [{
        name: "event_id",
        declaredType: "INTEGER",
        nullable: true,
        primaryKeyOrder: 1,
      }],
      strict: true,
      withoutRowid: false,
    });
  });
});
