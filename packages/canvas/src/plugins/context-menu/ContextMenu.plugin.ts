import type { IPlugin } from "@vibecanvas/runtime";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { createComponent, createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { CanvasContextMenu } from "../../components/CanvasContextMenu";
import {
  fnCanvasTargetsEqual,
} from "../../semantic/fn.target";
import type { TCanvasSemanticHit, TCanvasTarget } from "../../semantic/typed";
import type {
  ContextMenuService,
  SceneService,
  SelectionService,
  TContextMenuScope,
} from "../../services";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
} from "../../types";
import { fnGetSelectionPath } from "../select/fn.get-selection-path";

function menuScope(
  target: TCanvasTarget | null,
  selection: readonly TCanvasTarget[],
): TContextMenuScope {
  if (target === null) {
    return "canvas";
  }
  return selection.length > 1 ? "selection" : "item";
}

function selectionForHit(
  selection: SelectionService,
  hit: TCanvasSemanticHit,
): TCanvasTarget[] {
  if (selection.selection.some((target) => {
    return fnCanvasTargetsEqual(target, hit.target);
  })) {
    return selection.snapshot.selection.map((target) => ({ ...target }));
  }
  const path = fnGetSelectionPath({ hit });
  const depth = Math.min(
    Math.max(selection.selection.length, 1),
    path.length,
  );
  return path.slice(0, depth);
}

function activeSelection(
  document: TCanvasDoc,
  selection: readonly TCanvasTarget[],
): TCanvasTarget[] {
  const selectedGroupIds = new Set(selection.flatMap((target) => {
    return target.kind === "group" ? [target.id] : [];
  }));
  const nested = selection.filter((target) => {
    const parentId = target.kind === "element"
      ? document.elements[target.id]?.parentGroupId
      : document.groups[target.id]?.parentGroupId;
    return parentId !== null
      && parentId !== undefined
      && selectedGroupIds.has(parentId);
  });
  return nested.length === 0
    ? selection.map((target) => ({ ...target }))
    : [{ ...nested.at(-1)! }];
}

function mountContextMenu(args: {
  scene: SceneService;
  contextMenu: ContextMenuService;
}) {
  const mountElement = args.scene.container.ownerDocument.createElement("div");
  mountElement.id = "context-menu";
  args.scene.container.appendChild(mountElement);
  const [version, setVersion] = createSignal(0);
  const sync = () => setVersion((value) => value + 1);
  const offState = args.contextMenu.hooks.stateChange.tap(sync);
  const offProviders = args.contextMenu.hooks.providersChange.tap(sync);
  const disposeRender = render(() => {
    const mounted = createMemo(() => {
      version();
      return args.contextMenu.open;
    });
    const x = createMemo(() => {
      version();
      return args.contextMenu.x;
    });
    const y = createMemo(() => {
      version();
      return args.contextMenu.y;
    });
    const items = createMemo(() => {
      version();
      return args.contextMenu.actions;
    });
    const openRequestId = createMemo(() => {
      version();
      return args.contextMenu.requestId;
    });
    return createComponent(CanvasContextMenu, {
      mounted,
      x,
      y,
      items,
      openRequestId,
      onOpenChange: (open) => {
        if (!open) {
          args.contextMenu.close();
        }
      },
    });
  }, mountElement);
  return {
    mountElement,
    dispose() {
      offState();
      offProviders();
      disposeRender();
      mountElement.remove();
    },
  };
}

/**
 * Product context-menu policy over semantic hit and selection data.
 */
export function createContextMenuPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  return {
    name: "context-menu",
    apply(ctx) {
      const camera = ctx.services.require("camera");
      const contextMenu = ctx.services.require("contextMenu");
      const crdt = ctx.services.require("crdt");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      let menuMount: ReturnType<typeof mountContextMenu> | null = null;

      const onContextMenu = (event: MouseEvent) => {
        const domTarget = event.target !== null
          && typeof event.target === "object"
          && "nodeType" in event.target
          ? event.target as Node
          : null;
        if (
          domTarget !== null
          && menuMount?.mountElement.contains(domTarget)
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();

        const viewport = camera.clientToViewport({
          x: event.clientX,
          y: event.clientY,
        });
        const hit = scene.input.hitTestViewport({ point: viewport })[0] ?? null;
        const nextSelection = hit === null
          ? selection.snapshot.selection
          : selectionForHit(selection, hit);
        if (hit !== null) {
          selection.setSelection(nextSelection);
          selection.setFocusedTarget(nextSelection.at(-1) ?? null);
        }

        const document = crdt.doc();
        const target = hit?.target ?? null;
        const activeTargets = activeSelection(document, nextSelection);
        const resolvedSelection = selection.resolveSelection(
          document,
        );
        const resolvedActiveSelection = activeTargets.flatMap((candidate) => {
          const resolved = selection.resolveTarget(document, candidate);
          return resolved === null ? [] : [resolved];
        });
        contextMenu.openAt({
          x: event.clientX,
          y: event.clientY,
          context: {
            scope: menuScope(target, nextSelection),
            target,
            targetElement: target?.kind === "element"
              ? document.elements[target.id] ?? null
              : null,
            targetGroup: target?.kind === "group"
              ? document.groups[target.id] ?? null
              : null,
            selection: nextSelection,
            activeSelection: activeTargets,
            resolvedSelection,
            resolvedActiveSelection,
            connectionId: null,
          },
        });
      };
      const onPointerDown = (event: PointerEvent) => {
        if (event.button === 0) {
          contextMenu.close();
        }
      };

      ctx.hooks.init.tap(() => {
        menuMount = mountContextMenu({ scene, contextMenu });
        scene.container.addEventListener("contextmenu", onContextMenu);
        scene.container.addEventListener("pointerdown", onPointerDown);
      });
      ctx.hooks.destroy.tap(() => {
        scene.container.removeEventListener("contextmenu", onContextMenu);
        scene.container.removeEventListener("pointerdown", onPointerDown);
        contextMenu.close();
        menuMount?.dispose();
        menuMount = null;
      });
    },
  };
}
