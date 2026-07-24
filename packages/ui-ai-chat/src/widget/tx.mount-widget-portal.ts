import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TWidgetError } from "@vibecanvas/service-db/model";
import type {
  IWidgetConfig,
  TWidgetRenderArgs,
  TWidgetRenderCleanup,
  TWidgetTitleBarPortal,
} from "./interface";
import { txRenderWidgetError } from "./tx.render-widget-error";

type TPortal = Readonly<{
  document: Document;
}>;

type TArgs = Readonly<{
  host: HTMLDivElement;
  element: TElement;
  config: IWidgetConfig | null;
  error: TWidgetError | null;
  titleBar?: TWidgetTitleBarPortal;
  onContentPointerDown?(): void;
  resizeBoundary?: {
    enabled: boolean;
  };
  capsuleLifecycle?: TWidgetRenderArgs["capsuleLifecycle"];
}>;

function cleanupRender(cleanup: TWidgetRenderCleanup | void): void {
  if (typeof cleanup === "function") {
    cleanup();
  }
}

const HOSTED_EVENT_TYPES = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "wheel",
  "click",
  "dblclick",
  "contextmenu",
  "keydown",
  "keyup",
] as const;

const RESIZE_EVENT_BAND_PX = 8;

function isCanvasResizeBoundary(
  root: HTMLElement,
  event: Event,
  resizeBoundary: Readonly<{ enabled: boolean }>,
): boolean {
  if (
    !resizeBoundary.enabled
    || !event.type.startsWith("pointer")
  ) {
    return false;
  }
  const pointer = event as PointerEvent;
  const bounds = root.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return false;
  }
  return pointer.clientX <= bounds.left + RESIZE_EVENT_BAND_PX
    || pointer.clientX >= bounds.right - RESIZE_EVENT_BAND_PX
    || pointer.clientY >= bounds.bottom - RESIZE_EVENT_BAND_PX;
}

function isolateHostedContent(
  root: HTMLElement,
  onContentPointerDown?: () => void,
  resizeBoundary: Readonly<{ enabled: boolean }> = { enabled: false },
): () => void {
  const stopPropagation = (event: Event) => {
    if (!isCanvasResizeBoundary(root, event, resizeBoundary)) {
      if (event.type === "pointerdown") {
        onContentPointerDown?.();
      }
      event.stopPropagation();
    }
  };
  root.dataset.hostedWidgetRoot = "true";
  for (const type of HOSTED_EVENT_TYPES) {
    root.addEventListener(type, stopPropagation);
  }
  return () => {
    for (const type of HOSTED_EVENT_TYPES) {
      root.removeEventListener(type, stopPropagation);
    }
  };
}

export function txMountWidgetPortal(
  portal: TPortal,
  args: TArgs,
): () => void {
  args.host.replaceChildren();
  args.host.dataset.widgetPortalElementId = args.element.id;
  const surface = portal.document.createElement("div");
  surface.dataset.widgetPortalSurface = args.element.id;
  surface.style.cssText = [
    "box-sizing:border-box",
    "position:relative",
    "width:100%",
    "height:100%",
    "overflow:hidden",
  ].join(";");
  args.host.appendChild(surface);

  if (args.error !== null) {
    txRenderWidgetError(
      { document: portal.document },
      { root: surface, error: args.error },
    );
    return () => args.host.replaceChildren();
  }

  const content = portal.document.createElement("div");
  content.dataset.widgetContentRoot = args.element.id;
  content.style.boxSizing = "border-box";
  content.style.width = "100%";
  content.style.height = "100%";
  content.style.overflow = "auto";
  const resizeBoundary = args.resizeBoundary ?? {
    enabled: args.element.data.type === "ui-widget"
        || args.element.data.type === "widget-instance"
      ? args.element.data.window !== "fullscreen"
      : false,
  };
  const releaseContentIsolation = isolateHostedContent(
    content,
    args.onContentPointerDown,
    resizeBoundary,
  );
  surface.appendChild(content);

  let cleanup: TWidgetRenderCleanup | void;
  try {
    cleanup = args.config?.renderDom?.({
      root: content,
      element: args.element,
      ...(args.titleBar === undefined ? {} : { titleBar: args.titleBar }),
      ...(args.capsuleLifecycle === undefined
        ? {}
        : { capsuleLifecycle: args.capsuleLifecycle }),
    });
    if (args.config?.renderDom === undefined) {
      const status = portal.document.createElement("div");
      status.setAttribute("role", "status");
      status.textContent = "Widget renderer unavailable.";
      content.replaceChildren(status);
    }
  } catch (error) {
    txRenderWidgetError(
      { document: portal.document },
      {
        root: surface,
        error: {
          phase: "dom-render",
          code: "WIDGET_RUNTIME_MOUNT_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      },
    );
  }

  return () => {
    cleanupRender(cleanup);
    releaseContentIsolation();
    args.host.replaceChildren();
  };
}
