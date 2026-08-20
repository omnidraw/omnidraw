import { X } from "@/shell/framework/components/icons";
import { Portal, type JSX } from "@solidjs/web";
import {
  For,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onSettled,
  untrack,
  type Component,
} from "solid-js";
import styles from "./Toast.module.css";

const TOAST_DURATION_MS = 5_000;
const TOAST_LIMIT = 3;

type ToastComponentProps = Readonly<{ toastId: number }>;
type ToastComponent = Component<ToastComponentProps>;
type ToastPromiseState = "pending" | "fulfilled" | "rejected";
type ToastPromiseComponentProps<T, U = unknown> = ToastComponentProps & Readonly<{
  state: ToastPromiseState;
  data?: T;
  error?: U;
}>;
type ToastPromiseComponent<T, U = unknown> = Component<ToastPromiseComponentProps<T, U>>;
type ShowToastOptions = Readonly<{ region?: string }>;
type ToastEntry = Readonly<{
  id: number;
  component: ToastComponent;
  region?: string;
}>;

let nextToastId = 0;
const [toastEntries, setToastEntries] = createSignal<readonly ToastEntry[]>([]);
const [focusPaused, setFocusPaused] = createSignal(false);
const [pointerPaused, setPointerPaused] = createSignal(false);
const [windowPaused, setWindowPaused] = createSignal(false);

const timersPaused = () => focusPaused() || pointerPaused() || windowPaused();

function show(toastComponent: ToastComponent, options?: ShowToastOptions): number {
  const id = nextToastId++;
  setToastEntries((entries) => [...entries, {
    id,
    component: toastComponent,
    region: options?.region,
  }]);
  return id;
}

function update(id: number, toastComponent: ToastComponent): void {
  setToastEntries((entries) => entries.map((entry) => entry.id === id
    ? { ...entry, component: toastComponent }
    : entry));
}

function promise<T, U = unknown>(
  value: Promise<T> | (() => Promise<T>),
  toastComponent: ToastPromiseComponent<T, U>,
  options?: ShowToastOptions,
): number {
  const id = show((props) => toastComponent({ ...props, state: "pending" }), options);
  void (typeof value === "function" ? value() : value).then(
    (data) => update(id, (props) => toastComponent({ ...props, state: "fulfilled", data })),
    (error: U) => update(id, (props) => toastComponent({ ...props, state: "rejected", error })),
  );
  return id;
}

function dismiss(id: number): number {
  setToastEntries((entries) => entries.filter((entry) => entry.id !== id));
  return id;
}

function clear(): void {
  setToastEntries([]);
}

export const toaster = { show, update, promise, dismiss, clear };

export function Toaster() {
  let list: HTMLOListElement | undefined;
  const visibleEntries = createMemo(() => (
    toastEntries().filter((entry) => entry.region === undefined).slice(0, TOAST_LIMIT)
  ));

  createEffect(
    () => visibleEntries().map((entry) => entry.id),
    () => {
      queueMicrotask(() => {
        if (list !== undefined && !list.contains(list.ownerDocument.activeElement)) {
          setFocusPaused(false);
        }
      });
    },
  );

  onSettled(() => {
    const handleHotkey = (event: KeyboardEvent) => {
      if (!event.altKey || event.code !== "KeyT") return;
      list?.focus({ preventScroll: true });
    };
    const pause = () => setWindowPaused(true);
    const resume = () => setWindowPaused(false);
    document.addEventListener("keydown", handleHotkey);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("keydown", handleHotkey);
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", resume);
      // Cleanup runs in an owned disposal scope in Solid 2. Reset the
      // module-level interaction state after that scope has unwound.
      queueMicrotask(() => {
        setFocusPaused(false);
        setPointerPaused(false);
        setWindowPaused(false);
      });
    };
  });

  const handleFocusOut: JSX.EventHandlerUnion<HTMLOListElement, FocusEvent> = (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setFocusPaused(false);
  };

  const handlePointerLeave: JSX.EventHandlerUnion<HTMLOListElement, PointerEvent> = () => {
    setPointerPaused(false);
  };

  return (
    <Portal>
      <div
        role="region"
        aria-label="Notifications (Alt+T)"
        tabindex="-1"
        data-top-layer=""
        style={{ "pointer-events": visibleEntries().length > 0 ? "auto" : "none" }}
      >
        <ol
          ref={(element) => { list = element; }}
          class={styles.list}
          tabindex="-1"
          onFocusIn={() => setFocusPaused(true)}
          onFocusOut={handleFocusOut}
          onPointerMove={() => setPointerPaused(true)}
          onPointerLeave={handlePointerLeave}
        >
          <For each={visibleEntries()}>{(entry) => {
            const Entry = entry.component;
            return <Entry toastId={entry.id} />;
          }}</For>
        </ol>
      </div>
    </Portal>
  );
}

type ToastVariant = "default" | "error" | "success" | "warning";

type ToastProps = {
  toastId: number;
  title?: string;
  description?: string;
  variant?: ToastVariant;
};

const variantStyles: Record<ToastVariant, { container: string; progress: string; title: string }> = {
  default: {
    container: styles.default,
    progress: styles.progressDefault,
    title: styles.titleDefault,
  },
  error: {
    container: styles.error,
    progress: styles.progressError,
    title: styles.titleError,
  },
  success: {
    container: styles.success,
    progress: styles.progressSuccess,
    title: styles.titleSuccess,
  },
  warning: {
    container: styles.warning,
    progress: styles.progressWarning,
    title: styles.titleWarning,
  },
};

export function Toast(props: ToastProps) {
  const toastId = untrack(() => props.toastId);
  const variant = () => props.variant ?? "default";
  const [progress, setProgress] = createSignal(100);
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  let remainingMs = TOAST_DURATION_MS;
  let startedAt: number | null = null;
  let closeTimer: number | undefined;
  let progressTimer: number | undefined;
  let pointerStartX: number | null = null;

  const toastClass = () => [styles.toast, variantStyles[variant()].container].join(" ");
  const titleClass = () => [styles.title, variantStyles[variant()].title].join(" ");
  const progressClass = () => [styles.progressFill, variantStyles[variant()].progress].join(" ");

  const clearRunningTimers = () => {
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    if (progressTimer !== undefined) window.clearInterval(progressTimer);
    closeTimer = undefined;
    progressTimer = undefined;
  };

  const currentRemaining = () => startedAt === null
    ? remainingMs
    : Math.max(0, remainingMs - (Date.now() - startedAt));

  const writeProgress = (value: number) => {
    setProgress(Math.max(0, Math.min(100, value / TOAST_DURATION_MS * 100)));
  };

  const pauseTimer = () => {
    if (startedAt === null) return;
    remainingMs = currentRemaining();
    startedAt = null;
    clearRunningTimers();
  };

  const startTimer = () => {
    if (startedAt !== null) return;
    if (remainingMs <= 0) {
      toaster.dismiss(toastId);
      return;
    }
    startedAt = Date.now();
    closeTimer = window.setTimeout(() => {
      remainingMs = 0;
      startedAt = null;
      clearRunningTimers();
      setProgress(0);
      toaster.dismiss(toastId);
    }, remainingMs);
    progressTimer = window.setInterval(() => writeProgress(currentRemaining()), 50);
  };

  createEffect(
    () => timersPaused(),
    (paused) => {
      if (!paused) startTimer();
      return pauseTimer;
    },
  );

  const close = () => toaster.dismiss(toastId);

  return (
    <li
      class={toastClass()}
      role={variant() === "error" ? "alert" : "status"}
      aria-live={variant() === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-labelledby={props.title ? titleId : undefined}
      aria-describedby={props.description ? descriptionId : undefined}
      tabindex="0"
      data-opened=""
      data-omnidraw-toast-variant={variant()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        if (event.button === 0) pointerStartX = event.clientX;
      }}
      onPointerUp={(event) => {
        if (pointerStartX !== null && event.clientX - pointerStartX > 50) close();
        pointerStartX = null;
      }}
      onPointerCancel={() => { pointerStartX = null; }}
    >
      <div class={styles.contentRow}>
        <div class={styles.body}>
          {props.title && (
            <div id={titleId} class={titleClass()}>
              {props.title}
            </div>
          )}
          {props.description && (
            <div id={descriptionId} class={styles.description}>
              {props.description}
            </div>
          )}
        </div>
        <button type="button" class={styles.closeButton} aria-label="Close" onClick={close}>
          <X size={14} class={styles.closeIcon} />
        </button>
      </div>
      <div class={styles.progressTrack} aria-hidden="true">
        <div class={progressClass()} style={{ width: `${progress()}%` }} />
      </div>
    </li>
  );
}

export function showToast(title: string, description?: string) {
  return toaster.show((props) => (
    <Toast toastId={props.toastId} title={title} description={description} />
  ));
}

export function showErrorToast(title: string, description?: string) {
  return toaster.show((props) => (
    <Toast toastId={props.toastId} title={title} description={description} variant="error" />
  ));
}

export function showSuccessToast(title: string, description?: string) {
  return toaster.show((props) => (
    <Toast toastId={props.toastId} title={title} description={description} variant="success" />
  ));
}

export function showWarningToast(title: string, description?: string) {
  return toaster.show((props) => (
    <Toast toastId={props.toastId} title={title} description={description} variant="warning" />
  ));
}
