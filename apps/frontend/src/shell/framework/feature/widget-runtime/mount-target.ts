import type {
  IWidgetBrowserMount,
  TWidgetProps,
  TWidgetTheme,
  TWidgetViewport,
} from "@omnidraw/sdk";

type TMountWidgetTargetArgs = Readonly<{
  container: HTMLElement;
  signal?: AbortSignal;
  mount(target: HTMLElement): Promise<IWidgetBrowserMount>;
}>;

function createMountTarget(container: HTMLElement): HTMLElement {
  const target = container.ownerDocument.createElement("div");
  target.dataset.omnidrawWidgetMountTarget = "";
  target.setAttribute("aria-hidden", "true");
  Object.assign(target.style, {
    boxSizing: "border-box",
    gridArea: "1 / 1",
    height: "100%",
    minHeight: "0",
    minWidth: "0",
    overflow: "hidden",
    pointerEvents: "none",
    visibility: "hidden",
    width: "100%",
  });
  // Canvas gives the widget runtime a dedicated content host. A one-cell grid
  // lets the last-good and candidate generations coexist without changing
  // either generation's viewport while the candidate becomes ready.
  container.style.display = "grid";
  container.append(target);
  return target;
}

/**
 * Mounts one browser-widget generation into a fresh Capsule target.
 *
 * Capsule deliberately owns its mount container for the handle lifetime, so a
 * reload cannot reuse that element. The candidate stays visually and
 * interactively hidden until `ready()` succeeds. A rejected candidate cleans
 * up only its own target, leaving the caller's last-good mount untouched.
 */
export async function mountWidgetTarget(
  args: TMountWidgetTargetArgs,
): Promise<IWidgetBrowserMount> {
  const target = createMountTarget(args.container);
  let raw: IWidgetBrowserMount;
  try {
    raw = await args.mount(target);
  } catch (error) {
    target.remove();
    throw error;
  }

  let disposed = false;
  let disposal: Promise<void> | undefined;
  const dispose = (reason?: string): Promise<void> => {
    if (disposal !== undefined) return disposal;
    disposed = true;
    args.signal?.removeEventListener("abort", onAbort);
    disposal = Promise.resolve()
      .then(() => raw.dispose(reason))
      .finally(() => target.remove());
    return disposal;
  };
  const onAbort = (): void => {
    void dispose("aborted").catch(() => undefined);
  };
  args.signal?.addEventListener("abort", onAbort, { once: true });
  if (args.signal?.aborted) onAbort();

  const mounted: IWidgetBrowserMount = Object.freeze({
    async ready(): Promise<void> {
      try {
        await raw.ready();
      } catch (error) {
        await dispose("replacement-failed").catch(() => undefined);
        throw error;
      }
      if (disposed) return;
      target.style.pointerEvents = "auto";
      target.style.visibility = "visible";
      target.removeAttribute("aria-hidden");
    },
    setProps: (value: TWidgetProps) => raw.setProps(value),
    setTheme: (value: TWidgetTheme) => raw.setTheme(value),
    setViewport: (value: TWidgetViewport) => raw.setViewport(value),
    focus: (options?: FocusOptions) => raw.focus(options),
    setSchedulingMode: (mode: "active" | "throttled") => raw.setSchedulingMode(mode),
    freeze: (reason?: string) => raw.freeze(reason),
    resume: (reason?: string) => raw.resume(reason),
    snapshot: (reason?: string) => raw.snapshot(reason),
    diagnostics: () => raw.diagnostics(),
    dispose,
  });
  return mounted;
}
