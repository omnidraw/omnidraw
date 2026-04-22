import type { IPlugin } from "@vibecanvas/runtime";
import Konva from "konva";
import { createComponent, createMemo, createSignal } from "solid-js";
import { render as renderSolid } from "solid-js/web";
import { CanvasContextMenu } from "../../components/CanvasContextMenu";
import { fnIsCanvasGroupNode, fnIsCanvasNode } from "../../core/fn.canvas-node-semantics";
import type {
  ContextMenuService,
  ElementService, GroupService,
  SceneService, SelectionService,
  TContextMenuNode, TContextMenuScope
} from "../../services";
import type { IRuntimeHooks } from "../../types";

function getSelectionPath(
  scene: SceneService,
  node: TContextMenuNode,
): TContextMenuNode[] {
  const path: TContextMenuNode[] = [];
  let current: Konva.Node | null = node;

  while (current && current !== scene.staticForegroundLayer) {
    if (fnIsCanvasNode(current)) {
      path.push(current as TContextMenuNode);
    }

    current = current.getParent();
  }

  return path.reverse();
}

function filterSelection(
  scene: SceneService,
  selection: Konva.Node[],
): TContextMenuNode[] {
  void scene;

  let subSelection = selection.find((node) => {
    const parent = node.getParent();
    return parent && fnIsCanvasGroupNode(parent);
  });
  if (!subSelection) {
    return selection.filter((node): node is TContextMenuNode => {
      return fnIsCanvasNode(node) && node.getStage() !== null;
    });
  }

  const findDeepestSubSelection = () => {
    const deeperSubSelection = selection.find((node) => node.getParent() === subSelection);
    if (!deeperSubSelection) {
      return;
    }

    subSelection = deeperSubSelection;
    findDeepestSubSelection();
  };

  findDeepestSubSelection();

  if (!fnIsCanvasNode(subSelection)) {
    return [];
  }

  return subSelection.getStage() !== null ? [subSelection as TContextMenuNode] : [];
}

function findTargetNode(
  scene: SceneService,
  pointer: { x: number; y: number },
): TContextMenuNode | null {
  const directHit = scene.stage.getIntersection(pointer);
  let current: Konva.Node | null = directHit;
  while (current) {
    if (fnIsCanvasNode(current)) {
      return current as TContextMenuNode;
    }

    current = current.getParent();
  }

  const candidates = scene.staticForegroundLayer.find((node: Konva.Node) => {
    return fnIsCanvasNode(node) && node.isListening();
  }) as TContextMenuNode[];

  const fallbackTarget = [...candidates].reverse().find((node) => {
    const box = node.getClientRect();
    return Konva.Util.haveIntersection(box, {
      x: pointer.x,
      y: pointer.y,
      width: 1,
      height: 1,
    });
  });

  return fallbackTarget ?? null;
}

function resolveSelection(
  scene: SceneService,
  selection: SelectionService,
  target: TContextMenuNode,
): TContextMenuNode[] {
  const currentSelection = selection.selection.filter((node): node is TContextMenuNode => {
    return fnIsCanvasNode(node);
  });
  const activeSelection = filterSelection(scene, currentSelection);
  if (activeSelection.includes(target)) {
    return currentSelection;
  }

  const path = getSelectionPath(scene, target);
  const topLevelNode = path[0];
  const isFlatMultiSelect = currentSelection.length > 1
    && !currentSelection.some((node) => {
      const parent = node.getParent();
      return parent && fnIsCanvasGroupNode(parent);
    });

  if (isFlatMultiSelect && topLevelNode && currentSelection.includes(topLevelNode)) {
    return currentSelection;
  }

  const nextDepth = Math.min(Math.max(currentSelection.length, 1), path.length);
  return path.slice(0, nextDepth);
}

function getMenuScope(targetNode: TContextMenuNode | null, selection: TContextMenuNode[]): TContextMenuScope {
  if (!targetNode) {
    return "canvas";
  }

  return selection.length > 1 ? "selection" : "item";
}

function mountContextMenu(args: {
  scene: SceneService;
  contextMenu: ContextMenuService;
}) {
  const mountElement = args.scene.container.ownerDocument.createElement("div");
  mountElement.className = "absolute inset-0 pointer-events-none";
  args.scene.stage.container().appendChild(mountElement);

  const [version, setVersion] = createSignal(0);
  const syncVersion = () => {
    setVersion((value) => value + 1);
  };

  const offStateChange = args.contextMenu.hooks.stateChange.tap(syncVersion);
  const offProvidersChange = args.contextMenu.hooks.providersChange.tap(syncVersion);

  const disposeRender = renderSolid(() => {
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
        if (open) {
          return;
        }

        args.contextMenu.close();
      },
    });
  }, mountElement);

  return {
    mountElement,
    dispose() {
      offStateChange();
      offProvidersChange();
      disposeRender();
      mountElement.remove();
    },
  };
}

/**
 * Owns right-click hit testing and Solid context menu mount.
 * Feature actions come from ContextMenuService providers.
 */
export function createContextMenuPlugin(): IPlugin<{
  element: ElementService;
  group: GroupService;
  contextMenu: ContextMenuService;
  scene: SceneService;
  selection: SelectionService;
}, IRuntimeHooks> {
  let menuMount: ReturnType<typeof mountContextMenu> | null = null;

  return {
    name: "context-menu",
    apply(ctx) {
      const element = ctx.services.require("element");
      const group = ctx.services.require("group");
      const contextMenu = ctx.services.require("contextMenu");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");

      ctx.hooks.init.tap(() => {
        menuMount = mountContextMenu({ scene, contextMenu });

        const onContextMenu = (event: MouseEvent) => {
          const target = event.target as Node | null;
          if (target && menuMount?.mountElement.contains(target)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          scene.stage.setPointersPositions(event);
          const pointer = scene.stage.getPointerPosition();
          const targetNode = pointer ? findTargetNode(scene, pointer) : null;
          const nextSelection = targetNode
            ? resolveSelection(scene, selection, targetNode)
            : selection.selection.filter((node): node is TContextMenuNode => {
              return fnIsCanvasNode(node);
            });
          const activeSelection = filterSelection(scene, nextSelection);
          const scope = getMenuScope(targetNode, nextSelection);

          if (targetNode) {
            selection.setSelection(nextSelection);
          }

          contextMenu.openAt({
            x: event.clientX,
            y: event.clientY,
            context: {
              scope,
              targetNode,
              targetElement: targetNode ? element.toElement(targetNode) : null,
              targetGroup: targetNode ? group.toGroup(targetNode) : null,
              selection: nextSelection,
              activeSelection,
            },
          });
        };

        const onMouseDown = (event: MouseEvent) => {
          if (event.button !== 0) {
            return;
          }

          contextMenu.close();
        };

        scene.stage.container().addEventListener("contextmenu", onContextMenu);
        scene.stage.container().addEventListener("mousedown", onMouseDown);

        ctx.hooks.destroy.tap(() => {
          scene.stage.container().removeEventListener("contextmenu", onContextMenu);
          scene.stage.container().removeEventListener("mousedown", onMouseDown);
          contextMenu.close();
          menuMount?.dispose();
          menuMount = null;
        });
      });
    },
  };
}
