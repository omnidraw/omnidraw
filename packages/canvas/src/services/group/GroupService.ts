import { throttle } from "@solid-primitives/scheduled";
import type { IService, IStartableService } from "@vibecanvas/runtime";
import { IServiceContext } from "@vibecanvas/runtime/interface.js";
import type { TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { VC_NODE_KIND_ATTR } from "../../core/CONSTANTS";
import { fnGetNodeZIndex } from "../../core/fn.get-node-z-index";
import { fnSortByPriority } from "../../core/fn.sort-by-priority";
import { isCanvasElementNode, isCanvasGroupNode } from "../../core/GUARDS";
import { txSetNodeZIndex } from "../../core/tx.set-node-z-index";
import type { CameraService } from "../../services/camera/CameraService";
import type { ContextMenuService } from "../../services/context-menu/ContextMenuService";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { HistoryService } from "../../services/history/HistoryService";
import type { LoggingService } from "../../services/logging/LoggingService";
import type { RenderOrderService } from "../../services/render-order/RenderOrderService";
import type { SceneService } from "../../services/scene/SceneService";
import { CanvasMode } from "../../services/selection/CONSTANTS";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import { TCrdtBuilder } from "../crdt/fxBuilder";
import { ElementService } from "../element/ElementService";
import { fnIsSceneNode } from "./fn.scene-node";
import { fnToGroupPatch } from "./fn.to-group-patch";
import { fxCreateGroupBoundary } from "./fx.create-group-boundary";
import { txCreateGroupCloneDrag } from "./tx.create-group-clone-drag";
import { txGroupSelection } from "./tx.group-selection";
import { txSetupGroupNode } from "./tx.setup-group-node";
import { txSyncDraggability } from "./tx.sync-draggability";
import { txSyncGroupBoundaries, type TGroupBoundary } from "./tx.sync-group-boundaries";
import { txUngroupSelection } from "./tx.ungroup-selection";
import { TGroupDefinition, TGroupServiceHooks } from "./types";

const CANVAS_GROUP_NODE_KIND = "group";

const getNodeZIndex = (node: Konva.Group | Konva.Shape) => fnGetNodeZIndex({ node });
const setNodeZIndex = (node: Konva.Group | Konva.Shape, zIndex: string) => txSetNodeZIndex({}, { node, zIndex });

function createGroupNode(group: TGroup) {
  const node = new Konva.Group({
    id: group.id,
    draggable: true,
  });

  node.setAttr(VC_NODE_KIND_ATTR, CANVAS_GROUP_NODE_KIND);
  node.setAttr("vcGroupCreatedAt", group.createdAt);
  setNodeZIndex(node, group.zIndex);
  return node;
}

function sortChildrenByPersistedOrder(scene: SceneService, parent: Konva.Layer | Konva.Group) {
  const children = parent.getChildren().filter((node) => {
    return fnIsSceneNode({ scene, node });
  });

  children
    .slice()
    .sort((left, right) => {
      const zCompare = getNodeZIndex(left).localeCompare(getNodeZIndex(right));
      if (zCompare !== 0) {
        return zCompare;
      }

      return left.id().localeCompare(right.id());
    })
    .forEach((child, index) => {
      child.zIndex(index);
    });
}

/**
 * Owns group node hydration, boundary UI, and basic group/ungroup behavior.
 */
export class GroupService implements IService<TGroupServiceHooks>, IStartableService {
  name = "group";
  #boundaries = new Map<string, TGroupBoundary>();
  readonly #groups = new Map<string, TGroupDefinition>();
  readonly hooks: TGroupServiceHooks = { groupsChange: new SyncHook() };

  constructor(
    private camera: CameraService,
    private element: ElementService,
    private contextMenu: ContextMenuService,
    private crdt: CrdtService,
    private history: HistoryService,
    private logging: LoggingService,
    private scene: SceneService,
    private renderOrder: RenderOrderService,
    private selection: SelectionService,
    private theme: ThemeService,
  ) {
  }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void | Promise<void> {
    const refreshBoundaries = () => {
      txSyncGroupBoundaries({
        scene: this.scene,
        selection: this.selection,
        theme: this.theme,
        boundaries: this.#boundaries,
        createGroupBoundary: (group) => fxCreateGroupBoundary({ Rect: Konva.Rect, scene: this.scene, theme: this.theme }, { group }),
      }, {});
    };

    const syncDraggability = () => {
      txSyncDraggability({ scene: this.scene, selection: this.selection }, {});
    };

    const setupNode = (group: Konva.Group) => {
      return txSetupGroupNode({
        element: this.element,
        crdt: this.crdt,
        history: this.history,
        logging: this.logging,
        selection: this.selection,
        hooks: ctx.hooks,
        Shape: Konva.Shape,
        refreshBoundaries,
        startCloneDrag: (groupNode) => {
          txCreateGroupCloneDrag({
            element: this.element,
            crdt: this.crdt,
            scene: this.scene,
            renderOrder: this.renderOrder,
            selection: this.selection,
            setupGroupNode: setupNode,
            createId: () => crypto.randomUUID(),
            getNodeZIndex,
            setNodeZIndex,
            attachListeners: (node) => this.attachListeners(node),
            toGroup: (node) => this.toGroup(node),
          }, {
            sourceGroup: groupNode,
          });
        },
        createThrottledPatch: (callback) => throttle(callback, 100),
        now: () => performance.now(),
      }, { group });
    };

    const runGroupSelection = () => {
      txGroupSelection({
        Group: Konva.Group,
        Shape: Konva.Shape,
        Layer: Konva.Layer,
        element: this.element,
        group: this,
        crdt: this.crdt,
        history: this.history,
        scene: this.scene,
        selection: this.selection,
        setupNode,
        createGroupNode: (group) => createGroupNode(group),
        sortChildrenByPersistedOrder: (parent) => sortChildrenByPersistedOrder(this.scene, parent),
        getNodeZIndex,
        now: () => Date.now(),
        createId: () => crypto.randomUUID(),
      }, {});
    };

    const runUngroupSelection = () => {
      txUngroupSelection({
        Group: Konva.Group,
        Shape: Konva.Shape,
        Layer: Konva.Layer,
        element: this.element,
        group: this,
        crdt: this.crdt,
        history: this.history,
        scene: this.scene,
        selection: this.selection,
        setupNode,
        createGroupNode: (group) => createGroupNode(group),
        getNodeZIndex,
        now: () => Date.now(),
      }, {});
    };

    this.selection.hooks.change.tap(() => {
      refreshBoundaries();
      syncDraggability();
    });

    this.camera.hooks.change.tap(refreshBoundaries);

    this.theme.hooks.change.tap(() => {
      refreshBoundaries();
      this.scene.dynamicLayer.batchDraw();
    });

    ctx.hooks.init.tap(() => {
      refreshBoundaries();
      syncDraggability();
    });

    this.contextMenu.registerProvider("group", ({ scope, activeSelection }) => {
      const selectedGroups = [...activeSelection].reverse().filter((node): node is Konva.Group => {
        return isCanvasGroupNode(node);
      });

      const actions = [] as Array<{
        id: string;
        label: string;
        disabled?: boolean;
        priority?: number;
        onSelect: () => void;
      }>;

      if (scope !== "canvas" && activeSelection.length > 1) {
        actions.push({
          id: "group-selection",
          label: "Group",
          priority: 200,
          onSelect: () => {
            this.selection.setSelection(activeSelection);
            runGroupSelection();
          },
        });
      }

      if (scope !== "canvas" && selectedGroups.length > 0) {
        actions.push({
          id: "ungroup-selection",
          label: "Ungroup",
          priority: 210,
          onSelect: () => {
            this.selection.setSelection(activeSelection);
            runUngroupSelection();
          },
        });
      }

      return actions;
    });

    this.registerGroup({
      id: "group",
      matchesNode: (node) => {
        return node instanceof Konva.Group && node.getAttr(VC_NODE_KIND_ATTR) === CANVAS_GROUP_NODE_KIND;
      },
      toGroup: (node) => {
        if (!(node instanceof Konva.Group) || node.getAttr(VC_NODE_KIND_ATTR) !== CANVAS_GROUP_NODE_KIND) {
          return null;
        }

        return fnToGroupPatch({
          groupService: this,
          group: node,
          getNodeZIndex,
          fallbackCreatedAt: Date.now(),
        });
      },
      createNode: (group) => createGroupNode(group),
      attachListeners: (node) => {
        setupNode(node);
        return true;
      },
    });

    ctx.hooks.keydown.tap((event) => {
      if (this.selection.mode !== CanvasMode.SELECT) {
        return;
      }

      const isMeta = event.metaKey || event.ctrlKey;
      if (!isMeta || event.key.toLowerCase() !== "g") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) {
        runUngroupSelection();
        return;
      }

      runGroupSelection();
    });

    ctx.hooks.destroy.tap(() => {
      this.#boundaries.forEach((boundary) => {
        boundary.hide();
        boundary.node.destroy();
      });
      this.#boundaries.clear();
      this.contextMenu.unregisterProvider("group");
      this.unregisterGroup("group");
    });
  }


  /**
   * Serializes one runtime node into one persisted group.
   */
  toGroup(node: Konva.Node) {
    const definition = this.getGroupDefinitionByNode(node);
    if (!definition) {
      return null;
    }

    return definition.toGroup(node)
  }

  /**
   * Returns the first matching group definition for one runtime node.
   * Groups are single-owner registrations.
   */
  getGroupDefinitionByNode(node: Konva.Node) {
    return this.getGroups().find((definition) => definition.matchesNode(node)) ?? null;
  }

  getGroups() {
    return fnSortByPriority([...this.#groups.values()]);
  }

  /**
   * Attaches runtime listeners to an existing node.
   * For groups this is single-owner.
   */
  attachListeners(node: Konva.Node) {
    const groupDefinition = this.getGroupDefinitionByNode(node);
    if (groupDefinition?.attachListeners) {
      return groupDefinition.attachListeners(node as Konva.Group);
    }

    return false;
  }

  registerGroup(definition: TGroupDefinition) {
    this.#groups.set(definition.id, definition);
    this.hooks.groupsChange.call();

    return () => {
      this.unregisterGroup(definition.id);
    };
  }

  unregisterGroup(id: string) {
    const didDelete = this.#groups.delete(id);
    if (!didDelete) {
      return;
    }

    this.hooks.groupsChange.call();
  }

  /**
   * Remove group
   */
  removeGroup(node: unknown, builder: TCrdtBuilder) {
    if(!isCanvasGroupNode(node)) return builder
    console.log('removeGroupById', node)
    node.children.forEach(child => {
      if(isCanvasGroupNode(child)) {
        this.removeGroup(child, builder)
      } else if(isCanvasElementNode(child)) {
        this.element.removeElement(child, builder)
      }
    })
    node.destroy()

    return builder;
  }

  /**
   * Creates one runtime node from one persisted group.
   * Groups are single-owner registrations.
   */
  createNodeFromGroup(group: TGroup) {
    for (const definition of this.getGroups()) {
      const node = definition.createNode(group);
      if (!node) {
        continue;
      }

      definition.attachListeners?.(node);
      node.setAttr(VC_NODE_KIND_ATTR, 'group');
      return node;
    }

    return null;
  }
}
