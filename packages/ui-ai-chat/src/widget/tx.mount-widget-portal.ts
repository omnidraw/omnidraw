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
  "keydown",
  "keyup",
] as const;

function isolateHostedContent(
  root: HTMLElement,
  onContentPointerDown?: () => void,
): () => void {
  const stopPropagation = (event: Event) => {
    if (event.type === "pointerdown") {
      onContentPointerDown?.();
    }
    event.stopPropagation();
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
  const releaseContentIsolation = isolateHostedContent(
    content,
    args.onContentPointerDown,
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
