import type { IService } from "@vibecanvas/runtime";
import type { IServiceContext } from "@vibecanvas/runtime/interface.js";
import { SyncHook } from "@vibecanvas/tapable";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import type {
  TTool,
  TToolPointerEvent,
  TToolSession,
  TToolSessionCancelReason,
} from "./types";
export * from "./types";

export interface TToolServiceHooks {
  toolsChange: SyncHook<[]>;
  activeToolChange: SyncHook<[string]>;
  sessionChange: SyncHook<[TToolSession | null]>;
  error: SyncHook<[unknown]>;
}

/**
 * Product tool/session registry. Preview ownership belongs to the session's
 * engine interaction or transient owner; this service never stores a renderer
 * node and never writes CRDT on its own.
 */
export class ToolService implements IService<TToolServiceHooks> {
  readonly name = "tool";
  readonly hooks: TToolServiceHooks = {
    toolsChange: new SyncHook(),
    activeToolChange: new SyncHook(),
    sessionChange: new SyncHook(),
    error: new SyncHook(),
  };

  readonly #tools = new Map<string, TTool>();
  #activeToolId = "select";
  #activeSession: TToolSession | null = null;
  #runtimeHooks: IRuntimeHooks | null = null;
  #cleanups: Array<() => unknown> = [];

  get activeToolId(): string {
    return this.#activeToolId;
  }

  get activeSession(): TToolSession | null {
    return this.#activeSession;
  }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void {
    if (this.#runtimeHooks !== null) {
      return;
    }
    this.#runtimeHooks = ctx.hooks;
    this.#cleanups = [
      ctx.hooks.pointerDown.tap((event) => {
        this.#beginFromActiveTool(event);
      }),
      ctx.hooks.pointerMove.tap((event) => {
        this.#activeSession?.update?.(event);
      }),
      ctx.hooks.pointerUp.tap((event) => {
        void this.#commitSession(event);
      }),
      ctx.hooks.pointerCancel.tap(() => {
        void this.cancelActiveSession("pointer-cancel");
      }),
      ctx.hooks.keydown.tap((event) => {
        if (event.key !== "Escape") {
          return;
        }
        void this.cancelActiveSession("escape");
        if (this.#tools.has("select")) {
          this.setActiveTool("select");
        }
      }),
      ctx.hooks.destroy.tap(() => {
        void this.cancelActiveSession("destroy");
      }),
    ];
  }

  stop(): void {
    for (const cleanup of this.#cleanups.splice(0)) {
      cleanup();
    }
    this.#runtimeHooks = null;
    void this.cancelActiveSession("destroy");
  }

  registerTool(tool: TTool): () => void {
    if (tool.id.trim().length === 0) {
      throw new TypeError("Tool ID must be non-empty.");
    }
    if (this.#tools.has(tool.id)) {
      this.unregisterTool(tool.id);
    }
    this.#tools.set(tool.id, tool);
    this.hooks.toolsChange.call();
    let registered = true;
    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      this.unregisterTool(tool.id);
    };
  }

  unregisterTool(id: string): void {
    const tool = this.#tools.get(id);
    if (tool === undefined) {
      return;
    }
    if (this.#activeToolId === id) {
      void this.cancelActiveSession("unregister");
      tool.onDeactivate?.();
      this.#activeToolId = this.#tools.has("select") && id !== "select"
        ? "select"
        : "";
      this.hooks.activeToolChange.call(this.#activeToolId);
    }
    this.#tools.delete(id);
    this.hooks.toolsChange.call();
  }

  getTool(id: string): TTool | undefined {
    return this.#tools.get(id);
  }

  getTools(): TTool[] {
    return [...this.#tools.values()].sort((left, right) => {
      const priority = (left.priority ?? 10_000) - (right.priority ?? 10_000);
      return priority || left.label.localeCompare(right.label);
    });
  }

  setActiveTool(id: string): boolean {
    const next = this.#tools.get(id);
    if (next === undefined || id === this.#activeToolId) {
      return false;
    }
    const previous = this.#tools.get(this.#activeToolId);
    void this.cancelActiveSession("tool-change");
    previous?.onDeactivate?.();
    this.#activeToolId = id;
    next.onActivate?.();
    next.onSelect?.();
    this.hooks.activeToolChange.call(id);
    return true;
  }

  beginSession(session: TToolSession): void {
    if (session.id.trim().length === 0) {
      throw new TypeError("Tool session ID must be non-empty.");
    }
    if (this.#activeSession === session) {
      return;
    }
    void this.cancelActiveSession("replaced");
    this.#activeSession = session;
    this.hooks.sessionChange.call(session);
  }

  async cancelActiveSession(reason: TToolSessionCancelReason): Promise<void> {
    const session = this.#activeSession;
    if (session === null) {
      return;
    }
    this.#activeSession = null;
    this.hooks.sessionChange.call(null);
    try {
      await session.cancel(reason);
    } catch (error) {
      this.hooks.error.call(error);
    }
  }

  #beginFromActiveTool(event: TToolPointerEvent): void {
    if (this.#activeSession !== null) {
      return;
    }
    const tool = this.#tools.get(this.#activeToolId);
    const session = tool?.createSession?.(event) ?? null;
    if (session !== null) {
      this.beginSession(session);
    }
  }

  async #commitSession(event: TToolPointerEvent): Promise<void> {
    const session = this.#activeSession;
    if (session === null) {
      return;
    }
    this.#activeSession = null;
    this.hooks.sessionChange.call(null);
    try {
      await session.commit?.(event);
    } catch (error) {
      this.hooks.error.call(error);
      try {
        await session.cancel("commit-failed");
      } catch (cancelError) {
        this.hooks.error.call(cancelError);
      }
    }
  }
}
