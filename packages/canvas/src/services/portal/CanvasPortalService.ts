import type { IService } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import type {
  TCanvasPortalViewportState,
  TCanvasProjectedPortalContent,
} from "../../engine/typed";
import type { CrdtService } from "../crdt/CrdtService";

export type TCanvasPortalRenderState = Readonly<{
  element: TElement;
  content: TCanvasProjectedPortalContent;
  viewport: TCanvasPortalViewportState;
}>;

export type TCanvasPortalRenderHandle = {
  update?(state: TCanvasPortalRenderState): void | Promise<void>;
  dispose(): void | Promise<void>;
};

export type TCanvasPortalRendererMountArgs = TCanvasPortalRenderState & {
  host: HTMLDivElement;
  portalId: string;
};

export type TCanvasPortalRenderer = {
  id: string;
  priority?: number;
  matches(state: TCanvasPortalRenderState): boolean;
  mount(
    args: TCanvasPortalRendererMountArgs,
  ):
    | void
    | (() => void)
    | TCanvasPortalRenderHandle
    | Promise<void | (() => void) | TCanvasPortalRenderHandle>;
};

export type TCanvasPortalMountArgs = {
  portalId: string;
  elementId: string;
  host: HTMLDivElement;
  initialContent: TCanvasProjectedPortalContent;
  initialViewport: TCanvasPortalViewportState;
  onContentUpdate(
    listener: (content: TCanvasProjectedPortalContent) => void,
  ): () => void;
  onViewportUpdate(
    listener: (viewport: TCanvasPortalViewportState) => void,
  ): () => void;
};

export type TCanvasPortalServiceHooks = {
  renderersChange: SyncHook<[]>;
  error: SyncHook<[unknown, string]>;
};

type TActivePortalMount = {
  portalId: string;
  elementId: string;
  host: HTMLDivElement;
  content: TCanvasProjectedPortalContent;
  viewport: TCanvasPortalViewportState;
  rendererId: string | null;
  renderHandle: TCanvasPortalRenderHandle | null;
  generation: number;
  refreshRequested: boolean;
  refreshPromise: Promise<void> | null;
  disposePromise: Promise<void> | null;
  disposed: boolean;
};

function cloneContent(
  content: TCanvasProjectedPortalContent,
): TCanvasProjectedPortalContent {
  return JSON.parse(JSON.stringify(content)) as TCanvasProjectedPortalContent;
}

function cloneViewport(
  viewport: TCanvasPortalViewportState,
): TCanvasPortalViewportState {
  return { ...viewport };
}

function toRenderHandle(
  value: void | (() => void) | TCanvasPortalRenderHandle,
): TCanvasPortalRenderHandle {
  if (typeof value === "function") {
    return { dispose: value };
  }
  if (value === undefined) {
    return { dispose: () => undefined };
  }
  return value;
}

/**
 * Renderer-neutral owner for projected DOM portal content. Product extensions
 * register by persisted widget data; no scene node or engine object escapes.
 */
export class CanvasPortalService
implements IService<TCanvasPortalServiceHooks> {
  readonly name = "portal";
  readonly hooks: TCanvasPortalServiceHooks = {
    renderersChange: new SyncHook(),
    error: new SyncHook(),
  };

  readonly #renderers = new Map<string, TCanvasPortalRenderer>();
  readonly #mounts = new Set<TActivePortalMount>();

  constructor(private readonly crdt: Pick<CrdtService, "doc" | "hooks">) {}

  registerRenderer(renderer: TCanvasPortalRenderer): () => void {
    if (renderer.id.trim().length === 0) {
      throw new TypeError("Canvas portal renderer ID must be non-empty.");
    }
    if (this.#renderers.has(renderer.id)) {
      throw new TypeError(
        `Canvas portal renderer '${renderer.id}' is already registered.`,
      );
    }
    this.#renderers.set(renderer.id, renderer);
    this.hooks.renderersChange.call();
    this.#refreshAll();
    let registered = true;
    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      if (this.#renderers.delete(renderer.id)) {
        this.hooks.renderersChange.call();
        this.#refreshAll();
      }
    };
  }

  async mount(args: TCanvasPortalMountArgs): Promise<() => void> {
    if ([...this.#mounts].some((mount) => mount.portalId === args.portalId)) {
      throw new TypeError(
        `Canvas portal '${args.portalId}' is already mounted.`,
      );
    }
    const mount: TActivePortalMount = {
      portalId: args.portalId,
      elementId: args.elementId,
      host: args.host,
      content: cloneContent(args.initialContent),
      viewport: cloneViewport(args.initialViewport),
      rendererId: null,
      renderHandle: null,
      generation: 0,
      refreshRequested: false,
      refreshPromise: null,
      disposePromise: null,
      disposed: false,
    };
    this.#mounts.add(mount);

    const removeContentListener = args.onContentUpdate((content) => {
      mount.content = cloneContent(content);
      this.#scheduleRefresh(mount);
    });
    const removeViewportListener = args.onViewportUpdate((viewport) => {
      mount.viewport = cloneViewport(viewport);
      this.#scheduleRefresh(mount);
    });
    const removeDocumentListener = this.crdt.hooks.change.tap((summary) => {
      if (
        summary.fullReload
        || summary.elements.changes[mount.elementId] !== undefined
      ) {
        this.#scheduleRefresh(mount);
      }
    });

    try {
      await this.#requestRefresh(mount);
    } catch (error) {
      removeDocumentListener();
      removeViewportListener();
      removeContentListener();
      this.#mounts.delete(mount);
      await this.#disposeMount(mount);
      throw error;
    }

    let mounted = true;
    return () => {
      if (!mounted) {
        return;
      }
      mounted = false;
      removeDocumentListener();
      removeViewportListener();
      removeContentListener();
      this.#mounts.delete(mount);
      void this.#disposeMount(mount);
    };
  }

  #scheduleRefresh(mount: TActivePortalMount): void {
    void this.#requestRefresh(mount).catch((error: unknown) => {
      if (!mount.disposed) {
        this.hooks.error.call(error, mount.portalId);
      }
    });
  }

  #requestRefresh(mount: TActivePortalMount): Promise<void> {
    if (mount.disposed) {
      return Promise.resolve();
    }
    mount.generation += 1;
    mount.refreshRequested = true;
    if (mount.refreshPromise !== null) {
      return mount.refreshPromise;
    }
    const refreshPromise = Promise.resolve().then(() => {
      return this.#drainRefreshLane(mount);
    });
    mount.refreshPromise = refreshPromise;
    void refreshPromise.then(
      () => {
        if (mount.refreshPromise === refreshPromise) {
          mount.refreshPromise = null;
        }
      },
      () => {
        if (mount.refreshPromise === refreshPromise) {
          mount.refreshPromise = null;
        }
      },
    );
    return refreshPromise;
  }

  async #drainRefreshLane(mount: TActivePortalMount): Promise<void> {
    while (!mount.disposed && mount.refreshRequested) {
      mount.refreshRequested = false;
      await this.#refresh(mount, mount.generation);
    }
  }

  async #refresh(
    mount: TActivePortalMount,
    generation: number,
  ): Promise<void> {
    if (mount.disposed || mount.generation !== generation) {
      return;
    }
    const element = this.crdt.doc()?.elements[mount.elementId];
    if (element === undefined) {
      await this.#showFallback(
        mount,
        `Widget '${mount.elementId}' is no longer available.`,
        generation,
      );
      return;
    }
    const state: TCanvasPortalRenderState = {
      element,
      content: cloneContent(mount.content),
      viewport: cloneViewport(mount.viewport),
    };
    const renderer = this.#resolveRenderer(state, mount.portalId);

    if (
      renderer !== null
      && mount.rendererId === renderer.id
      && mount.renderHandle?.update !== undefined
    ) {
      try {
        await mount.renderHandle.update(state);
      } catch (error) {
        if (mount.disposed || mount.generation !== generation) {
          return;
        }
        this.hooks.error.call(error, mount.portalId);
        await this.#showFallback(
          mount,
          `Widget '${mount.elementId}' could not be updated.`,
          generation,
        );
      }
      return;
    }

    await this.#disposeHandle(mount);
    if (mount.disposed || mount.generation !== generation) {
      return;
    }
    mount.host.replaceChildren();

    if (renderer === null) {
      await this.#showFallback(
        mount,
        `Widget renderer unavailable for '${mount.elementId}'.`,
        generation,
      );
      return;
    }

    try {
      const value = await renderer.mount({
        ...state,
        host: mount.host,
        portalId: mount.portalId,
      });
      const handle = toRenderHandle(value);
      if (mount.disposed || mount.generation !== generation) {
        await handle.dispose();
        return;
      }
      mount.rendererId = renderer.id;
      mount.renderHandle = handle;
    } catch (error) {
      if (mount.disposed || mount.generation !== generation) {
        return;
      }
      this.hooks.error.call(error, mount.portalId);
      await this.#showFallback(
        mount,
        `Widget '${mount.elementId}' could not be mounted.`,
        generation,
      );
    }
  }

  #resolveRenderer(
    state: TCanvasPortalRenderState,
    portalId: string,
  ): TCanvasPortalRenderer | null {
    return [...this.#renderers.values()]
      .sort((left, right) => {
        return (right.priority ?? 0) - (left.priority ?? 0)
          || left.id.localeCompare(right.id);
      })
      .find((renderer) => {
        try {
          return renderer.matches(state);
        } catch (error) {
          this.hooks.error.call(error, portalId);
          return false;
        }
      }) ?? null;
  }

  async #showFallback(
    mount: TActivePortalMount,
    message: string,
    generation: number,
  ): Promise<void> {
    if (mount.disposed || mount.generation !== generation) {
      return;
    }
    await this.#disposeHandle(mount);
    if (mount.disposed || mount.generation !== generation) {
      return;
    }
    mount.rendererId = null;
    const fallback = mount.host.ownerDocument.createElement("div");
    fallback.setAttribute("role", "status");
    fallback.dataset.canvasPortalFallback = "true";
    fallback.style.cssText = [
      "box-sizing:border-box",
      "display:grid",
      "place-items:center",
      "width:100%",
      "height:100%",
      "padding:12px",
      "color:#7f1d1d",
      "background:rgba(254,226,226,.96)",
      "font:12px/1.4 system-ui,sans-serif",
      "text-align:center",
    ].join(";");
    fallback.textContent = message;
    mount.host.replaceChildren(fallback);
  }

  async #disposeHandle(mount: TActivePortalMount): Promise<void> {
    const handle = mount.renderHandle;
    mount.renderHandle = null;
    mount.rendererId = null;
    if (handle === null) {
      return;
    }
    try {
      await handle.dispose();
    } catch (error) {
      this.hooks.error.call(error, mount.portalId);
    }
  }

  #disposeMount(mount: TActivePortalMount): Promise<void> {
    if (mount.disposePromise !== null) {
      return mount.disposePromise;
    }
    mount.disposed = true;
    mount.generation += 1;
    mount.refreshRequested = false;
    mount.host.replaceChildren();
    const inFlight = mount.refreshPromise;
    mount.disposePromise = (async () => {
      if (inFlight !== null) {
        await inFlight.catch(() => undefined);
      }
      await this.#disposeHandle(mount);
      mount.host.replaceChildren();
    })();
    return mount.disposePromise;
  }

  #refreshAll(): void {
    for (const mount of this.#mounts) {
      this.#scheduleRefresh(mount);
    }
  }
}
