import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";

export type TSceneServiceArgs = {
  container: HTMLDivElement;
};

export interface TSceneServiceHooks {
  resize: SyncHook<[number, number]>;
}

export class SceneService implements IService<TSceneServiceHooks>, IStartableService, IStoppableService {
  readonly name = "scene";

  readonly container: HTMLDivElement;
  readonly hooks: TSceneServiceHooks = {
    resize: new SyncHook(),
  };

  stage!: Konva.Stage;
  staticBackgroundLayer!: Konva.Layer;
  staticForegroundLayer!: Konva.Layer;
  dynamicLayer!: Konva.Layer;
  resizeObserver!: ResizeObserver;
  #previewNode: Konva.Node | null = null;
  #started = false;

  constructor(args: TSceneServiceArgs) {
    this.container = args.container;
  }

  start(): void | Promise<void> {
    if (this.#started) {
      return;
    }

    this.stage = this.#createStage();

    const layers = this.#createLayers();
    this.staticBackgroundLayer = layers.staticBackgroundLayer;
    this.staticForegroundLayer = layers.staticForegroundLayer;
    this.dynamicLayer = layers.dynamicLayer;

    this.#attachLayers();
    this.resizeObserver = this.#createResizeObserver();
    this.resizeObserver.observe(this.container);
    this.#started = true;
  }

  stop(): void | Promise<void> {
    if (!this.#started) {
      return;
    }

    this.resizeObserver.disconnect();
    this.stage.destroy();
    this.#started = false;
  }

  #createStage() {
    return new Konva.Stage({
      container: this.container,
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    });
  }

  #createLayers() {
    return {
      staticBackgroundLayer: new Konva.Layer(),
      staticForegroundLayer: new Konva.Layer(),
      dynamicLayer: new Konva.Layer(),
    };
  }

  #attachLayers() {
    this.stage.add(this.staticBackgroundLayer);
    this.stage.add(this.staticForegroundLayer);
    this.stage.add(this.dynamicLayer);
  }

  #createResizeObserver() {
    return new ResizeObserver(() => {
      this.#resizeStageToContainer();
    });
  }

  #resizeStageToContainer() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.stage.size({ width, height });
    this.stage.batchDraw();
    this.hooks.resize.call(width, height);
  }

  get previewNode(): Konva.Node | null {
    return this.#previewNode;
  }

  setPreviewNode(node: Konva.Node | null) {
    if (this.#previewNode === node) {
      return;
    }

    if (node === null) {
      this.clearPreviewState();
      return;
    }

    if (node instanceof Konva.Shape || node instanceof Konva.Group) {
      this.dynamicLayer.add(node);
    }
    this.#previewNode = node;
  }

  clearPreviewState() {
    this.#previewNode?.destroy()
    this.#previewNode = null;
  }
}
