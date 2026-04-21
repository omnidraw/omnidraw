import type { IService } from "@vibecanvas/runtime";
import type { IServiceContext } from "@vibecanvas/runtime/interface.js";
import { SyncHook } from "@vibecanvas/tapable";
import type Konva from "konva";
import type { IRuntimeConfig, IRuntimeHooks } from "src/types";
import type { CanvasRegistryService, CrdtService, SceneService, SelectionService } from "..";
import { fxGetCanvasPoint } from "./fx.get-canvas-point";
import { TTool, TToolCanvasPoint, TToolPointerEvent } from "./types";

export interface TToolServiceHooks {
  toolsChange: SyncHook<[]>;
  activeToolChange: SyncHook<[string]>;
}

export class ToolService implements IService<TToolServiceHooks> {
  readonly name = "ToolService";
  readonly hooks: TToolServiceHooks = {
    toolsChange: new SyncHook<[]>,
    activeToolChange: new SyncHook<[string]>,
  };
  #activeToolId = "select";
  readonly #tools = new Map<string, TTool>();
  readonly #runtimeHooks!: IRuntimeHooks;
  #previewOrigin: TToolCanvasPoint | null = null;

  constructor(
    private sceneService: SceneService,
    private canvasRegistry: CanvasRegistryService,
    private crdt: CrdtService,
    private selection: SelectionService,
  ) { }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void | Promise<void> {
    // @ts-expect-error this is safe, start runs before any use
    this.runtimeHooks = ctx.hooks;
  }

  get activeToolId() {
    return this.#activeToolId
  }

  registerTool(tool: TTool) {
    this.#tools.set(tool.id, tool);

    // setup create-draw
    if (tool.behavior.type === "mode" && tool.behavior.mode === "draw-create" && tool.drawCreate) {
      this.#runtimeHooks.pointerDown.tap((event) => {
        if (this.#activeToolId !== tool.id) {
          return;
        }

        const point = fxGetCanvasPoint({ scene: this.sceneService }, { event });
        if (!point) {
          return;
        }

        const preview = tool.drawCreate?.startDraft({ event, point });
        this.#previewOrigin = point;
        if (preview) {
          this.sceneService.setPreviewNode(preview);
        }
      });

      this.#runtimeHooks.pointerMove.tap((event) => {
        if (this.#activeToolId !== tool.id) {
          return;
        }

        if (!this.sceneService.previewNode || !this.#previewOrigin) {
          return;
        }

        const point = fxGetCanvasPoint({ scene: this.sceneService }, { event: event as TToolPointerEvent });
        if (!point) {
          return;
        }

        tool.drawCreate?.updateDraft(this.sceneService.previewNode, {
          draft: this.sceneService.previewNode,
          event: event as TToolPointerEvent,
          point,
          origin: this.#previewOrigin,
          shiftKey: event.evt.shiftKey,
          now: Date.now(),
        });
      });

      this.#runtimeHooks.pointerUp.tap(() => {
        if (this.#activeToolId !== tool.id) {
          return;
        }

        if (!this.sceneService.previewNode) {
          return;
        }

        this.commitPreview();
      });

      this.hooks.activeToolChange.tap((activeToolId) => {
        if (activeToolId === tool.id) {
          return;
        }

        if (!this.sceneService.previewNode) {
          return;
        }

        this.sceneService.clearPreviewState();
      });
    }

    this.hooks.toolsChange.call();
  }

  /**
   * Removes a tool from the editor registry.
   */
  unregisterTool(id: string) {
    const didDelete = this.#tools.delete(id);
    if (!didDelete) {
      return;
    }

    if (this.#activeToolId === id) {
      this.#activeToolId = "select";
      this.hooks.activeToolChange.call(this.#activeToolId);
    }

    this.hooks.toolsChange.call();
  }

  /**
   * Returns one registered tool by id.
   */
  getTool(id: string) {
    return this.#tools.get(id);
  }

  /**
   * Returns registered tools in stable toolbar order.
   * Priority is expected in the range 0..10000.
   */
  getTools() {
    return [...this.#tools.values()].sort((left, right) => {
      const leftPriority = left.priority ?? 10000;
      const rightPriority = right.priority ?? 10000;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return left.label.localeCompare(right.label);
    });
  }

  /**
   * Sets the current active tool if it exists.
   */
  setActiveTool(id: string) {
    if (!this.#tools.has(id)) {
      return;
    }

    if (this.activeToolId === id) {
      return;
    }

    this.activeToolId = id;
    this.hooks.activeToolChange.call(id);
  }

  private commitPreview() {
    if (!this.sceneService.previewNode) {
      return;
    }

    const previewNode = this.sceneService.previewNode;
    previewNode.id(crypto.randomUUID())
    const element = this.canvasRegistry.toElement(previewNode);
    if (!element) {
      this.sceneService.clearPreviewState();
      return;
    }
    const newNode: Konva.Node = previewNode.clone()
    newNode.moveTo(this.sceneService.staticForegroundLayer)
    this.canvasRegistry.attachListeners(newNode);
    const builder = this.crdt.build();
    builder.patchElement(element.id, element);
    builder.commit();
    this.selection.setSelection([newNode]);
    this.selection.setFocusedNode(newNode);
    this.sceneService.clearPreviewState();
  }
}
