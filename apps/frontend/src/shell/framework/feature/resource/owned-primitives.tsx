import { Portal as WebPortal } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import {
  Show,
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  omit,
  useContext,
  type Component,
  type Element,
} from "solid-js";
import {
  anchoredPopupPortalTarget,
  connectAnchoredPopup,
} from "../../components/ui/anchored-popup";
import { activateModalFocusScope } from "../../components/ui/modal-focus-scope";

type TChildren = Readonly<{ children?: Element }>;

export const Button: Component<JSX.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => {
  const forwarded = omit(props, "children", "type");
  return (
    <button {...forwarded} type={props.type ?? "button"}>
      {props.children}
    </button>
  );
};

type TTextFieldContext = Readonly<{
  disabled(): boolean;
  id: string;
  onChange(value: string): void;
  value(): string;
}>;

const TextFieldContext = createContext<TTextFieldContext>();

const TextFieldRoot: Component<TChildren & Readonly<{
  class?: JSX.HTMLAttributes<HTMLDivElement>["class"];
  disabled?: boolean;
  onChange(value: string): void;
  value: string;
}>> = (props) => {
  const context: TTextFieldContext = {
    disabled: () => props.disabled === true,
    id: createUniqueId(),
    onChange: (value) => props.onChange(value),
    value: () => props.value,
  };
  return (
    <TextFieldContext value={context}>
      <div class={props.class}>{props.children}</div>
    </TextFieldContext>
  );
};

const TextFieldLabel: Component<JSX.LabelHTMLAttributes<HTMLLabelElement>> = (props) => {
  const context = useContext(TextFieldContext);
  const forwarded = omit(props, "children", "for");
  return (
    <label {...forwarded} for={context.id}>
      {props.children}
    </label>
  );
};

const TextFieldInput: Component<JSX.InputHTMLAttributes<HTMLInputElement>> = (props) => {
  const context = useContext(TextFieldContext);
  const forwarded = omit(props, "disabled", "id", "onInput", "value");
  return (
    <input
      {...forwarded}
      id={context.id}
      value={context.value()}
      disabled={props.disabled === true || context.disabled()}
      onInput={(event) => context.onChange(event.currentTarget.value)}
    />
  );
};

const TextFieldTextArea: Component<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => {
  const context = useContext(TextFieldContext);
  const forwarded = omit(props, "disabled", "id", "onInput", "value");
  return (
    <textarea
      {...forwarded}
      id={context.id}
      value={context.value()}
      disabled={props.disabled === true || context.disabled()}
      onInput={(event) => context.onChange(event.currentTarget.value)}
    />
  );
};

export const TextField = Object.freeze({
  Root: TextFieldRoot,
  Label: TextFieldLabel,
  Input: TextFieldInput,
  TextArea: TextFieldTextArea,
});

type TTabsContext = Readonly<{
  id: string;
  onChange(value: string): void;
  value(): string;
}>;

const TabsContext = createContext<TTabsContext>();

function tabToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

const TabsRoot: Component<TChildren & Readonly<{
  class?: JSX.HTMLAttributes<HTMLDivElement>["class"];
  onChange(value: string): void;
  value: string;
}>> = (props) => {
  const context: TTabsContext = {
    id: createUniqueId(),
    onChange: (value) => props.onChange(value),
    value: () => props.value,
  };
  return (
    <TabsContext value={context}>
      <div class={props.class}>{props.children}</div>
    </TabsContext>
  );
};

const TabsList: Component<JSX.HTMLAttributes<HTMLDivElement>> = (props) => {
  const forwarded = omit(props, "children", "role");
  return (
    <div {...forwarded} role="tablist">
      {props.children}
    </div>
  );
};

const TabsTrigger: Component<JSX.ButtonHTMLAttributes<HTMLButtonElement> & Readonly<{
  value: string;
}>> = (props) => {
  const context = useContext(TabsContext);
  const selected = () => context.value() === props.value;
  const forwarded = omit(
    props,
    "children",
    "onClick",
    "onKeyDown",
    "type",
    "value",
  );
  const select = () => context.onChange(props.value);
  const handleKeyDown = (event: KeyboardEvent) => {
    const currentTarget = event.currentTarget as HTMLButtonElement;
    const tabList = currentTarget.closest<HTMLElement>("[role=tablist]");
    const tabs = tabList === null
      ? []
      : [...tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
    const currentIndex = tabs.indexOf(currentTarget);
    if (currentIndex < 0 || tabs.length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    const nextValue = next?.dataset.tabValue;
    if (next === undefined || nextValue === undefined) return;
    context.onChange(nextValue);
    next.focus();
  };
  return (
    <button
      {...forwarded}
      id={`${context.id}-${tabToken(props.value)}-tab`}
      type="button"
      role="tab"
      data-tab-value={props.value}
      data-selected={selected() ? "" : undefined}
      aria-selected={selected() ? "true" : "false"}
      aria-controls={`${context.id}-${tabToken(props.value)}-panel`}
      tabindex={selected() ? 0 : -1}
      onClick={select}
      onKeyDown={handleKeyDown}
    >
      {props.children}
    </button>
  );
};

const TabsContent: Component<JSX.HTMLAttributes<HTMLDivElement> & Readonly<{
  value: string;
}>> = (props) => {
  const context = useContext(TabsContext);
  const forwarded = omit(props, "children", "id", "role", "value");
  return (
    <Show when={context.value() === props.value}>
      <div
        {...forwarded}
        id={`${context.id}-${tabToken(props.value)}-panel`}
        role="tabpanel"
        aria-labelledby={`${context.id}-${tabToken(props.value)}-tab`}
        tabindex="0"
      >
        {props.children}
      </div>
    </Show>
  );
};

export const Tabs = Object.freeze({
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
});

type TDialogContext = Readonly<{
  content(): HTMLElement | undefined;
  descriptionId: string;
  onOpenChange(open: boolean): void;
  open(): boolean;
  role(): "dialog" | "alertdialog";
  setContent(element: HTMLElement): void;
  titleId: string;
}>;

const DialogContext = createContext<TDialogContext>();

type TDialogRootProps = TChildren & Readonly<{
  onOpenChange(open: boolean): void;
  open: boolean;
  role?: "dialog" | "alertdialog";
}>;

const OwnedDialogRoot: Component<TDialogRootProps> = (props) => {
  let content: HTMLElement | undefined;
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const context: TDialogContext = {
    content: () => content,
    descriptionId,
    onOpenChange: (open) => props.onOpenChange(open),
    open: () => props.open,
    role: () => props.role ?? "dialog",
    setContent: (element) => { content = element; },
    titleId,
  };

  createEffect(
    () => props.open ? props.onOpenChange : null,
    (onOpenChange) => {
      if (onOpenChange === null) return;
      return activateModalFocusScope({
        content: () => content,
        onEscape: () => onOpenChange(false),
        ownerDocument: content?.ownerDocument ?? document,
      });
    },
  );

  return (
    <DialogContext value={context}>
      {props.children}
    </DialogContext>
  );
};

const DialogRoot: Component<Omit<TDialogRootProps, "role">> = (props) => (
  <OwnedDialogRoot open={props.open} onOpenChange={props.onOpenChange} role="dialog">
    {props.children}
  </OwnedDialogRoot>
);

const AlertDialogRoot: Component<Omit<TDialogRootProps, "role">> = (props) => (
  <OwnedDialogRoot open={props.open} onOpenChange={props.onOpenChange} role="alertdialog">
    {props.children}
  </OwnedDialogRoot>
);

const DialogPortal: Component<TChildren> = (props) => {
  const context = useContext(DialogContext);
  return (
    <Show when={context.open()}>
      <WebPortal>{props.children}</WebPortal>
    </Show>
  );
};

const DialogOverlay: Component<JSX.HTMLAttributes<HTMLDivElement>> = (props) => {
  const context = useContext(DialogContext);
  const forwarded = omit(props, "children", "onPointerDown");
  return (
    <div
      {...forwarded}
      aria-hidden="true"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) context.onOpenChange(false);
      }}
    />
  );
};

const DialogContent: Component<JSX.HTMLAttributes<HTMLDivElement>> = (props) => {
  const context = useContext(DialogContext);
  const forwarded = omit(
    props,
    "aria-describedby",
    "aria-labelledby",
    "aria-modal",
    "children",
    "ref",
    "role",
    "tabindex",
  );
  return (
    <div
      {...forwarded}
      ref={(element) => context.setContent(element)}
      role={context.role()}
      aria-modal="true"
      aria-labelledby={context.titleId}
      aria-describedby={context.descriptionId}
      tabindex="-1"
    >
      {props.children}
    </div>
  );
};

const DialogTitle: Component<JSX.HTMLAttributes<HTMLHeadingElement>> = (props) => {
  const context = useContext(DialogContext);
  const forwarded = omit(props, "children", "id");
  return <h2 {...forwarded} id={context.titleId}>{props.children}</h2>;
};

const DialogDescription: Component<JSX.HTMLAttributes<HTMLParagraphElement>> = (props) => {
  const context = useContext(DialogContext);
  const forwarded = omit(props, "children", "id");
  return <p {...forwarded} id={context.descriptionId}>{props.children}</p>;
};

const DialogCloseButton: Component<JSX.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => {
  const context = useContext(DialogContext);
  const forwarded = omit(props, "children", "onClick", "type");
  return (
    <button
      {...forwarded}
      type={props.type ?? "button"}
      onClick={() => context.onOpenChange(false)}
    >
      {props.children}
    </button>
  );
};

export const Dialog = Object.freeze({
  Root: DialogRoot,
  Portal: DialogPortal,
  Overlay: DialogOverlay,
  Content: DialogContent,
  Title: DialogTitle,
  Description: DialogDescription,
  CloseButton: DialogCloseButton,
});

export const AlertDialog = Object.freeze({
  Root: AlertDialogRoot,
  Portal: DialogPortal,
  Overlay: DialogOverlay,
  Content: DialogContent,
  Title: DialogTitle,
  Description: DialogDescription,
  CloseButton: DialogCloseButton,
});

type TCheckedContext = Readonly<{
  checked(): boolean;
  id: string;
  onChange(checked: boolean): void;
}>;

const CheckboxContext = createContext<TCheckedContext>();

const CONTROL_INPUT_STYLE = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: "0",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  "white-space": "nowrap",
  border: "0",
} as const;

const CheckboxRoot: Component<TChildren & Readonly<{
  checked: boolean;
  class?: JSX.LabelHTMLAttributes<HTMLLabelElement>["class"];
  onChange(checked: boolean): void;
}>> = (props) => {
  const context: TCheckedContext = {
    checked: () => props.checked,
    id: createUniqueId(),
    onChange: (checked) => props.onChange(checked),
  };
  return (
    <CheckboxContext value={context}>
      <label class={props.class} for={context.id}>{props.children}</label>
    </CheckboxContext>
  );
};

const CheckboxInput: Component<JSX.InputHTMLAttributes<HTMLInputElement>> = (props) => {
  const context = useContext(CheckboxContext);
  const forwarded = omit(props, "checked", "id", "onChange", "style", "type");
  return (
    <input
      {...forwarded}
      id={context.id}
      type="checkbox"
      checked={context.checked()}
      style={CONTROL_INPUT_STYLE}
      onChange={(event) => context.onChange(event.currentTarget.checked)}
    />
  );
};

const CheckboxControl: Component<JSX.HTMLAttributes<HTMLSpanElement>> = (props) => {
  const context = useContext(CheckboxContext);
  const forwarded = omit(props, "children");
  return (
    <span
      {...forwarded}
      aria-hidden="true"
      data-checked={context.checked() ? "" : undefined}
    >
      {props.children}
    </span>
  );
};

const CheckboxIndicator: Component<TChildren> = (props) => {
  const context = useContext(CheckboxContext);
  return <Show when={context.checked()}>{props.children}</Show>;
};

const CheckboxLabel: Component<JSX.HTMLAttributes<HTMLSpanElement>> = (props) => {
  const forwarded = omit(props, "children");
  return <span {...forwarded}>{props.children}</span>;
};

export const Checkbox = Object.freeze({
  Root: CheckboxRoot,
  Input: CheckboxInput,
  Control: CheckboxControl,
  Indicator: CheckboxIndicator,
  Label: CheckboxLabel,
});

const SwitchContext = createContext<TCheckedContext>();

const SwitchRoot: Component<TChildren & Readonly<{
  checked: boolean;
  class?: JSX.LabelHTMLAttributes<HTMLLabelElement>["class"];
  onChange(checked: boolean): void;
}>> = (props) => {
  const context: TCheckedContext = {
    checked: () => props.checked,
    id: createUniqueId(),
    onChange: (checked) => props.onChange(checked),
  };
  return (
    <SwitchContext value={context}>
      <label class={props.class} for={context.id}>{props.children}</label>
    </SwitchContext>
  );
};

const SwitchInput: Component<JSX.InputHTMLAttributes<HTMLInputElement>> = (props) => {
  const context = useContext(SwitchContext);
  const forwarded = omit(
    props,
    "aria-checked",
    "checked",
    "id",
    "onChange",
    "role",
    "style",
    "type",
  );
  return (
    <input
      {...forwarded}
      id={context.id}
      type="checkbox"
      role="switch"
      checked={context.checked()}
      aria-checked={context.checked() ? "true" : "false"}
      style={CONTROL_INPUT_STYLE}
      onChange={(event) => context.onChange(event.currentTarget.checked)}
    />
  );
};

const SwitchControl: Component<JSX.HTMLAttributes<HTMLSpanElement>> = (props) => {
  const context = useContext(SwitchContext);
  const forwarded = omit(props, "children");
  return (
    <span
      {...forwarded}
      aria-hidden="true"
      data-checked={context.checked() ? "" : undefined}
    >
      {props.children}
    </span>
  );
};

const SwitchThumb: Component<JSX.HTMLAttributes<HTMLSpanElement>> = (props) => {
  const context = useContext(SwitchContext);
  return <span {...props} data-checked={context.checked() ? "" : undefined} />;
};

const SwitchLabel: Component<JSX.HTMLAttributes<HTMLSpanElement>> = (props) => {
  const forwarded = omit(props, "children");
  return <span {...forwarded}>{props.children}</span>;
};

export const Switch = Object.freeze({
  Root: SwitchRoot,
  Input: SwitchInput,
  Control: SwitchControl,
  Thumb: SwitchThumb,
  Label: SwitchLabel,
});

type TDropdownContext = Readonly<{
  close(returnFocus?: boolean): void;
  content(): HTMLElement | undefined;
  menuId: string;
  openWithFocus(intent: "first" | "last"): void;
  open(): boolean;
  setContent(element: HTMLElement): void;
  setTrigger(element: HTMLButtonElement): void;
  toggle(): void;
  trigger(): HTMLButtonElement | undefined;
  triggerId: string;
}>;

const DropdownContext = createContext<TDropdownContext>();

const DropdownRoot: Component<TChildren> = (props) => {
  let trigger: HTMLButtonElement | undefined;
  let content: HTMLElement | undefined;
  const [open, setOpen] = createSignal(false);
  const triggerId = createUniqueId();
  const menuId = createUniqueId();
  let openFocusIntent: "first" | "last" = "first";
  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) queueMicrotask(() => trigger?.focus());
  };
  const menuItems = () => content === undefined
    ? []
    : [...content.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  const focusItem = (index: number) => {
    const items = menuItems();
    if (items.length === 0) return;
    items[(index + items.length) % items.length]?.focus();
  };
  const openWithFocus = (intent: "first" | "last") => {
    openFocusIntent = intent;
    if (open()) {
      queueMicrotask(() => focusItem(intent === "first" ? 0 : -1));
    } else setOpen(true);
  };
  const context: TDropdownContext = {
    close,
    content: () => content,
    menuId,
    openWithFocus,
    open,
    setContent: (element) => { content = element; },
    setTrigger: (element) => { trigger = element; },
    toggle: () => {
      if (open()) close();
      else openWithFocus("first");
    },
    trigger: () => trigger,
    triggerId,
  };
  createEffect(
    open,
    (isOpen) => {
      if (!isOpen) return;
      const focusIntent = openFocusIntent;
      openFocusIntent = "first";
      const ownerDocument = trigger?.ownerDocument ?? document;
      const ownerWindow = ownerDocument.defaultView ?? window;
      let active = true;
      let disconnectPopup: (() => void) | undefined;
      const isWithinDropdown = (target: EventTarget | null) => {
        const NodeConstructor = ownerWindow.Node;
        return target instanceof NodeConstructor
          && (trigger?.contains(target) === true || content?.contains(target) === true);
      };
      const handlePointerDown = (event: PointerEvent) => {
        if (isWithinDropdown(event.target)) return;
        close();
      };
      const handleFocusIn = (event: FocusEvent) => {
        if (isWithinDropdown(event.target)) return;
        close();
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!isWithinDropdown(event.target)) {
          close();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          close(true);
          return;
        }
        if (event.key === "Tab") {
          close();
          return;
        }
        const items = menuItems();
        const current = items.indexOf(ownerDocument.activeElement as HTMLButtonElement);
        let next: number | null = null;
        if (event.key === "ArrowDown") next = current < 0 ? 0 : current + 1;
        if (event.key === "ArrowUp") next = current < 0 ? items.length - 1 : current - 1;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = items.length - 1;
        if (next === null) return;
        event.preventDefault();
        focusItem(next);
      };
      queueMicrotask(() => {
        const anchor = trigger;
        const popup = content;
        if (!active || anchor?.isConnected !== true || popup?.isConnected !== true) return;
        popup.style.minWidth = `${anchor.getBoundingClientRect().width}px`;
        disconnectPopup = connectAnchoredPopup({
          alignment: "end",
          anchor,
          popup,
        }).disconnect;
        focusItem(focusIntent === "first" ? 0 : -1);
      });
      ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
      ownerDocument.addEventListener("focusin", handleFocusIn, true);
      ownerDocument.addEventListener("keydown", handleKeyDown, true);
      return () => {
        active = false;
        disconnectPopup?.();
        ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
        ownerDocument.removeEventListener("focusin", handleFocusIn, true);
        ownerDocument.removeEventListener("keydown", handleKeyDown, true);
      };
    },
  );
  return (
    <DropdownContext value={context}>
      {props.children}
    </DropdownContext>
  );
};

const DropdownTrigger: Component<JSX.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => {
  const context = useContext(DropdownContext);
  const forwarded = omit(props, "aria-expanded", "children", "onClick", "onKeyDown", "ref", "type");
  return (
    <button
      {...forwarded}
      ref={(element) => context.setTrigger(element)}
      id={context.triggerId}
      type="button"
      aria-haspopup="menu"
      aria-expanded={context.open() ? "true" : "false"}
      aria-controls={context.menuId}
      data-expanded={context.open() ? "" : undefined}
      onClick={() => context.toggle()}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        context.openWithFocus(event.key === "ArrowDown" ? "first" : "last");
      }}
    >
      {props.children}
    </button>
  );
};

const DropdownPortal: Component<TChildren> = (props) => {
  const context = useContext(DropdownContext);
  const trigger = context.trigger();
  return (
    <Show when={context.open()}>
      <WebPortal mount={trigger === undefined ? undefined : anchoredPopupPortalTarget(trigger)}>
        {props.children}
      </WebPortal>
    </Show>
  );
};

const DropdownContent: Component<JSX.HTMLAttributes<HTMLDivElement>> = (props) => {
  const context = useContext(DropdownContext);
  const forwarded = omit(props, "children", "ref", "role", "style");
  return (
    <Show when={context.open()}>
      <div
        {...forwarded}
        ref={(element) => context.setContent(element)}
        id={context.menuId}
        role="menu"
        aria-labelledby={context.triggerId}
        data-anchored-popup="owned-dropdown-menu"
        style={{
          "overflow-y": "auto",
        }}
      >
        {props.children}
      </div>
    </Show>
  );
};

const DropdownItem: Component<Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> & Readonly<{
  onSelect(): void;
}>> = (props) => {
  const context = useContext(DropdownContext);
  const [highlighted, setHighlighted] = createSignal(false);
  const forwarded = omit(
    props,
    "children",
    "onBlur",
    "onClick",
    "onFocus",
    "onPointerMove",
    "onSelect",
    "role",
    "tabindex",
    "type",
  );
  return (
    <button
      {...forwarded}
      type="button"
      role="menuitem"
      tabindex="-1"
      data-highlighted={highlighted() ? "" : undefined}
      onFocus={() => setHighlighted(true)}
      onBlur={() => setHighlighted(false)}
      onPointerMove={(event) => event.currentTarget.focus()}
      onClick={() => {
        props.onSelect();
        context.close(true);
      }}
    >
      {props.children}
    </button>
  );
};

export const DropdownMenu = Object.freeze({
  Root: DropdownRoot,
  Trigger: DropdownTrigger,
  Portal: DropdownPortal,
  Content: DropdownContent,
  Item: DropdownItem,
});
