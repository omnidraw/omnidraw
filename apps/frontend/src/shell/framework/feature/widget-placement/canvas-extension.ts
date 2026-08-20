import type {
  ICanvasExtension,
  TCanvasExternalWidgetPreview,
} from "@omnidraw/canvas";
import {
  fnClampWidgetPlacementPosition,
  fnHasWidgetPlacementDragThreshold,
  type TWidgetPlacementPoint,
} from "@/core/widgets/fn.pointer-placement";
import { fnPlacedWidgetNode } from "@/core/widgets/fn.placed-widget-node";
import { fnWidgetPreviewTitleBarColor } from "@/core/widgets/fn.widget-host-theme";
import type { TFrontendRuntime } from "@/shell/runtime/frontend-runtime";
import type { TWidgetPreviewAutomation } from "../canvas-extension/preview-automation";
import type { TWidgetPlacementCoordinator } from "./WidgetPlacementCoordinator";

type TCreateFrontendWidgetPlacementExtensionArgs = Readonly<{
  runtime: TFrontendRuntime;
  placement: TWidgetPlacementCoordinator;
  previewAutomation?: TWidgetPreviewAutomation;
}>;

/**
 * Installs only the host-side external placement bridge. Widget guest/runtime
 * loading remains in the matching lazy Canvas extension.
 */
export function createFrontendWidgetPlacementExtension(
  options: TCreateFrontendWidgetPlacementExtensionArgs,
): ICanvasExtension {
  const { runtime: application } = options;
  return {
    name: "omnidraw.frontend-widget-placement",
    install(context) {
      const unbindPreviewAutomation = options.previewAutomation?.bind(context.document);
      type TPlacementRequest = Parameters<TWidgetPlacementCoordinator["beginPointerSession"]>[0];
      type TPointerSession = {
        request: TPlacementRequest;
        pointerId: number;
        origin: TWidgetPlacementPoint;
        nodeId: ReturnType<Crypto["randomUUID"]>;
        dragging: boolean;
        previousUserSelect: string;
        captureTarget: Element | null;
      };
      const ownerDocument = context.config.container.ownerDocument;
      let disposed = false;
      let pointerSession: TPointerSession | null = null;
      let placementPreview: TCanvasExternalWidgetPreview | null = null;

      const resolvePosition = (
        point: TWidgetPlacementPoint,
        bounds: Readonly<{ width: number; height: number }>,
      ): TWidgetPlacementPoint => fnClampWidgetPlacementPosition({
        point: context.placement.clientToWorld(point),
        bounds,
        viewport: context.placement.visibleWorldBounds(),
      });
      const commitPlacement = (
        request: Pick<TPlacementRequest, "reference" | "bounds" | "label">,
        position: TWidgetPlacementPoint,
        nodeId: ReturnType<Crypto["randomUUID"]> = application.ownerWindow.crypto.randomUUID(),
      ): void => {
        const preview = request.reference.source === "draft";
        const node = fnPlacedWidgetNode({
          id: nodeId,
          reference: request.reference,
          bounds: request.bounds,
          label: request.label,
          position,
          instanceId: application.ownerWindow.crypto.randomUUID(),
          ...(preview ? {
            titleBarColor: fnWidgetPreviewTitleBarColor(application.theme.service.getTheme()),
          } : {}),
        });
        context.document.insertAtFront({ source: "omnidraw.widget-place", node });
        context.document.setSelection([node.id], { focusedNodeId: node.id });
      };
      const removePointerListeners = (): void => {
        ownerDocument.removeEventListener("pointermove", onPointerMove);
        ownerDocument.removeEventListener("pointerup", onPointerUp);
        ownerDocument.removeEventListener("pointercancel", onPointerCancel);
        ownerDocument.removeEventListener("keydown", onKeyDown);
      };
      const clearPlacementPreview = (): void => {
        placementPreview?.clear();
      };
      const finishPointerSession = (): TPointerSession | null => {
        const current = pointerSession;
        if (current === null) return null;
        removePointerListeners();
        ownerDocument.body.style.userSelect = current.previousUserSelect;
        if (current.captureTarget?.hasPointerCapture?.(current.pointerId)) {
          current.captureTarget.releasePointerCapture(current.pointerId);
        }
        pointerSession = null;
        placementPreview?.dispose();
        placementPreview = null;
        return current;
      };
      const cancelPointerSession = (): void => {
        const current = finishPointerSession();
        if (current?.dragging) current.request.onDragEnd?.();
      };
      const syncPlacementPreview = (current: TPointerSession, point: TWidgetPlacementPoint): void => {
        const position = resolvePosition(point, current.request.bounds);
        placementPreview ??= context.placement.createWidgetPreview({
          nodeId: current.nodeId,
          title: current.request.label,
        });
        placementPreview.update({
          x: position.x,
          y: position.y,
          width: current.request.bounds.width,
          height: current.request.bounds.height,
        });
      };
      function onPointerMove(event: PointerEvent): void {
        const current = pointerSession;
        if (current === null || event.pointerId !== current.pointerId) return;
        const point = { x: event.clientX, y: event.clientY };
        if (!current.dragging && fnHasWidgetPlacementDragThreshold({
          origin: current.origin,
          point,
          threshold: 6,
        })) {
          current.dragging = true;
          ownerDocument.body.style.userSelect = "none";
          current.request.onDragStart?.();
        }
        if (!current.dragging) return;
        event.preventDefault();
        if (!context.placement.containsClientPoint(point)) {
          clearPlacementPreview();
          return;
        }
        syncPlacementPreview(current, point);
      }
      function onPointerUp(event: PointerEvent): void {
        const current = pointerSession;
        if (current === null || event.pointerId !== current.pointerId) return;
        const point = { x: event.clientX, y: event.clientY };
        const shouldCommit = current.dragging && context.placement.containsClientPoint(point);
        const position = shouldCommit ? resolvePosition(point, current.request.bounds) : null;
        if (current.dragging) event.preventDefault();
        finishPointerSession();
        if (current.dragging) current.request.onDragEnd?.();
        if (position !== null) {
          try {
            commitPlacement(current.request, position, current.nodeId);
          } catch (error) {
            context.config.notification.showError(
              "Widget placement failed",
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }
      function onPointerCancel(event: PointerEvent): void {
        if (event.pointerId === pointerSession?.pointerId) cancelPointerSession();
      }
      function onKeyDown(event: KeyboardEvent): void {
        if (event.key !== "Escape" || pointerSession === null) return;
        event.preventDefault();
        cancelPointerSession();
      }
      const placementPort = {
        isAvailable: () => !disposed
          && !application.signal.aborted
          && context.config.container.isConnected,
        beginPointerSession(args: Parameters<TWidgetPlacementCoordinator["beginPointerSession"]>[0]) {
          if (args.event.button !== 0 || args.event.isPrimary === false) return false;
          cancelPointerSession();
          const captureTarget = args.event.currentTarget instanceof Element
            ? args.event.currentTarget
            : null;
          captureTarget?.setPointerCapture?.(args.event.pointerId);
          pointerSession = {
            request: args,
            pointerId: args.event.pointerId,
            origin: { x: args.event.clientX, y: args.event.clientY },
            nodeId: application.ownerWindow.crypto.randomUUID(),
            dragging: false,
            previousUserSelect: ownerDocument.body.style.userSelect,
            captureTarget,
          };
          ownerDocument.addEventListener("pointermove", onPointerMove, { passive: false });
          ownerDocument.addEventListener("pointerup", onPointerUp, { passive: false });
          ownerDocument.addEventListener("pointercancel", onPointerCancel, { passive: false });
          ownerDocument.addEventListener("keydown", onKeyDown);
          return true;
        },
        async addToCanvas(args: Parameters<TWidgetPlacementCoordinator["addToCanvas"]>[0]) {
          cancelPointerSession();
          const viewport = context.placement.visibleWorldBounds();
          const center = context.placement.viewportCenter();
          const position = fnClampWidgetPlacementPosition({
            point: args.position ?? {
              x: center.x - args.bounds.width / 2,
              y: center.y - args.bounds.height / 2,
            },
            bounds: args.bounds,
            viewport,
          });
          commitPlacement(args, position);
        },
      };
      let unregisterPlacement: (() => void) | undefined;
      try {
        unregisterPlacement = options.placement.register(placementPort);
      } catch (error) {
        unbindPreviewAutomation?.();
        throw error;
      }
      return {
        dispose() {
          disposed = true;
          cancelPointerSession();
          placementPreview?.dispose();
          placementPreview = null;
          unregisterPlacement?.();
          unbindPreviewAutomation?.();
        },
      };
    },
  };
}
