// @vitest-environment jsdom
import type {
  TCanvasDoc,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { getStroke } from "perfect-freehand";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  TCanvasSceneApplyArgs,
  TCanvasSceneApplyResult,
  TCanvasSceneCommandApplyArgs,
} from "../../../src/engine/CanvasEngineAdapter";
import {
  ProjectionCoordinator,
} from "../../../src/engine/ProjectionCoordinator";
import type {
  TCanvasProjectionTheme,
} from "../../../src/engine/typed";
import type {
  ICanvasEngineOwnershipStage,
  TCanvasEngineOwnershipStageState,
} from "../../../src/engine/interface";
import type {
  TCanvasOwnedPortal,
} from "../../../src/engine/portals/PortalOwnership";
import {
  createBuiltInProjectionRegistry,
} from "../../../src/engine/projection/ProjectionRegistry";
import {
  CanvasProjectionRuntimeError,
  CanvasProjectionRuntimePort,
  type ICanvasProjectionAdapter,
} from "../../../src/engine/projection-runtime/ProjectionRuntimePort";
import type {
  TCanvasPortalContentUpdate,
} from "../../../src/engine/projection-runtime/PortalContentBridge";

const THEME: TCanvasProjectionTheme = {
  id: "projection-runtime-test",
  colors: {
    accent: "#dbeafe",
    accentForeground: "#1e3a8a",
    border: "#d6d3d1",
    canvasBackground: "rgba(168, 162, 158, 0.10)",
    canvasGridMajor: "rgba(71, 85, 105, 0.28)",
    canvasGridMinor: "rgba(71, 85, 105, 0.16)",
    canvasSelectionStroke: "#3b82f6",
    canvasText: "#000000",
    card: "#ffffff",
    destructive: "#dc2626",
    muted: "#e7e5e4",
    mutedForeground: "#57534e",
    ring: "#f59e0b",
    success: "#16a34a",
    warning: "#d97706",
  },
  colorTokens: {
    "@transparent": "transparent",
  },
};

function rect(id: string, x = 0): TElement {
  return {
    id,
    x,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "A",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: "rect",
      w: 100,
      h: 80,
      radius: 0,
      text: null,
    },
    style: {
      backgroundColor: "#ffffff",
    },
  };
}

function image(id: string, url: string): TElement {
  return {
    ...rect(id),
    data: {
      type: "image",
      url,
      base64: null,
      w: 100,
      h: 80,
      crop: {
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        naturalWidth: 100,
        naturalHeight: 80,
      },
    },
  };
}

function widget(id: string, version: number): TElement {
  return {
    ...rect(id),
    data: {
      type: "ui-widget",
      kind: "test-widget",
      w: 320,
      h: 240,
      expanded: true,
      payload: { version },
    },
  };
}

function document(elements: readonly TElement[]): TCanvasDoc {
  return {
    id: "runtime-document",
    name: "Runtime document",
    groups: {},
    elements: Object.fromEntries(elements.map((element) => [element.id, element])),
  };
}

class FakeStage implements ICanvasEngineOwnershipStage {
  readonly label: string;
  readonly #prepareFn: () => void | Promise<void>;
  readonly #commitFn: () => void | Promise<void>;
  readonly #rollbackFn: () => void | Promise<void>;
  #state: TCanvasEngineOwnershipStageState = "staged";

  constructor(args: {
    label: string;
    prepare?(): void | Promise<void>;
    commit?(): void | Promise<void>;
    rollback?(): void | Promise<void>;
  }) {
    this.label = args.label;
    this.#prepareFn = args.prepare ?? (() => undefined);
    this.#commitFn = args.commit ?? (() => undefined);
    this.#rollbackFn = args.rollback ?? (() => undefined);
  }

  get state(): TCanvasEngineOwnershipStageState {
    return this.#state;
  }

  async prepare(): Promise<void> {
    if (this.#state === "prepared") {
      return;
    }
    await this.#prepareFn();
    this.#state = "prepared";
  }

  async commit(): Promise<void> {
    if (this.#state === "committed") {
      return;
    }
    await this.#commitFn();
    this.#state = "committed";
  }

  async rollback(): Promise<void> {
    if (this.#state === "rolled-back" || this.#state === "committed") {
      return;
    }
    await this.#rollbackFn();
    this.#state = "rolled-back";
  }
}

class FakeResourceRegistrationOwner {
  readonly id = "vibecanvas:projection";
  readonly events: string[];
  current: readonly { descriptor: { id: string; type: string; url?: string } }[] = [];

  constructor(events: string[]) {
    this.events = events;
  }

  replace(
    resources: readonly { descriptor: { id: string; type: string; url?: string } }[],
  ): void {
    this.events.push("resources:replace");
    this.current = [...resources];
  }

  clear(): void {
    this.replace([]);
  }

  async preload(): Promise<void> {}

  destroy(): void {
    this.current = [];
  }
}

class FakePortalOwnership {
  readonly events: string[];
  readonly #current = new Map<
    string,
    { portal: TCanvasOwnedPortal; dispose: () => void }
  >();
  failNextCommit: unknown | null = null;

  constructor(events: string[]) {
    this.events = events;
  }

  stage(
    _ownerId: string,
    portals: readonly TCanvasOwnedPortal[],
  ): ICanvasEngineOwnershipStage {
    const desired = new Map(portals.map((portal) => [portal.portalId, portal]));
    const pending = new Map<string, { portal: TCanvasOwnedPortal; dispose: () => void }>();
    return new FakeStage({
      label: "portals",
      prepare: async () => {
        this.events.push("portals:prepare");
        for (const [portalId, portal] of desired) {
          if (this.#current.has(portalId)) {
            continue;
          }
          const dispose = await portal.mount({
            portalId,
            host: globalThis.document.createElement("div"),
          });
          pending.set(portalId, {
            portal,
            dispose: dispose ?? (() => undefined),
          });
        }
      },
      commit: () => {
        this.events.push("portals:commit");
        const failure = this.failNextCommit;
        this.failNextCommit = null;
        if (failure !== null) {
          throw failure;
        }
        for (const [portalId, current] of this.#current) {
          if (!desired.has(portalId)) {
            current.dispose();
            this.#current.delete(portalId);
          }
        }
        for (const [portalId, portal] of desired) {
          const existing = this.#current.get(portalId);
          if (existing !== undefined) {
            if (existing.portal.registrationKey !== portal.registrationKey) {
              throw new TypeError(`Portal '${portalId}' changed registration identity.`);
            }
            existing.portal = portal;
          } else {
            this.#current.set(portalId, pending.get(portalId)!);
          }
        }
      },
      rollback: () => {
        this.events.push("portals:rollback");
        for (const portal of pending.values()) {
          portal.dispose();
        }
      },
    });
  }

  async release(ownerId: string): Promise<void> {
    const stage = this.stage(ownerId, []);
    await stage.prepare();
    await stage.commit();
  }
}

class FakeAdapter implements ICanvasProjectionAdapter {
  readonly events: string[] = [];
  readonly resources = new FakeResourceRegistrationOwner(this.events);
  readonly portals = new FakePortalOwnership(this.events);
  readonly replaceCalls: TCanvasSceneApplyArgs[] = [];
  readonly commandCalls: TCanvasSceneCommandApplyArgs[] = [];
  failNext: { fatal: boolean } | null = null;
  #revision = 0;

  createResourceRegistrationOwner() {
    return this.resources;
  }

  async applyScene(
    args: TCanvasSceneApplyArgs,
  ): Promise<TCanvasSceneApplyResult> {
    this.replaceCalls.push(args);
    return this.#apply("scene:replace");
  }

  async applyCommands(
    args: TCanvasSceneCommandApplyArgs,
  ): Promise<TCanvasSceneApplyResult> {
    this.commandCalls.push(args);
    return this.#apply("scene:commands");
  }

  async #apply(
    event: string,
  ): Promise<TCanvasSceneApplyResult> {
    this.events.push(event);
    const failure = this.failNext;
    this.failNext = null;
    if (failure !== null) {
      return {
        ok: false,
        revision: this.#revision,
        error: new Error("fake adapter failure"),
        fatal: failure.fatal,
      };
    }
    this.#revision += 1;
    return { ok: true, revision: this.#revision };
  }
}

function harness(args?: {
  mountContent?: ConstructorParameters<typeof CanvasProjectionRuntimePort>[0]["mountContent"];
  onPresentationCommitError?: ConstructorParameters<
    typeof CanvasProjectionRuntimePort
  >[0]["onPresentationCommitError"];
}) {
  const adapter = new FakeAdapter();
  const mountContent = args?.mountContent ?? (() => undefined);
  const runtime = new CanvasProjectionRuntimePort({
    adapter,
    mountContent,
    readViewportSize: () => ({ width: 1_000, height: 800 }),
    preloadResources: false,
    ...(args?.onPresentationCommitError === undefined
      ? {}
      : { onPresentationCommitError: args.onPresentationCommitError }),
  });
  const coordinator = new ProjectionCoordinator({
    registry: createBuiltInProjectionRegistry(),
    theme: THEME,
    dependencies: { getStroke },
    runtime,
  });
  return { adapter, coordinator, runtime };
}

describe("CanvasProjectionRuntimePort", () => {
  it("uses initial replacement, then incremental commands for a one-element update", async () => {
    const { adapter, coordinator } = harness();
    await coordinator.hydrateInitial(document([rect("one")]), 1);
    await coordinator.enqueue({
      document: document([rect("one", 40)]),
      revision: 2,
      origin: "remote",
    });

    expect(adapter.replaceCalls).toHaveLength(1);
    expect(adapter.commandCalls).toHaveLength(1);
    expect(adapter.commandCalls[0]?.commands.every((command) => {
      return command.type === "upsert";
    })).toBe(true);
    expect(adapter.commandCalls[0]?.commands.some((command) => {
      return command.type === "upsert" && command.node.id.includes("one");
    })).toBe(true);
  });

  it("passes explicit full reloads through snapshot replacement", async () => {
    const { adapter, coordinator } = harness();
    await coordinator.hydrateInitial(document([rect("one")]), 1);
    await coordinator.enqueue({
      document: document([rect("one", 10)]),
      revision: 2,
      origin: "remote",
      fullReload: true,
    });

    expect(adapter.replaceCalls).toHaveLength(2);
    expect(adapter.commandCalls).toHaveLength(0);
  });

  it("prepares ownership before scene mutation and commits afterward", async () => {
    const { adapter, coordinator } = harness();
    await coordinator.hydrateInitial(document([widget("widget", 1)]), 1);

    expect(adapter.events).toEqual([
      "resources:replace",
      "portals:prepare",
      "scene:replace",
      "portals:commit",
    ]);
  });

  it("swaps resource URL generations through the single projection owner", async () => {
    const { adapter, coordinator } = harness();
    await coordinator.hydrateInitial(
      document([image("image", "https://example.invalid/one.png")]),
      1,
    );
    const firstId = adapter.resources.current[0]?.descriptor.id;
    await coordinator.enqueue({
      document: document([image("image", "https://example.invalid/two.png")]),
      revision: 2,
      origin: "remote",
    });

    expect(adapter.resources.current).toHaveLength(1);
    expect(adapter.resources.current[0]?.descriptor.id).not.toBe(firstId);
    expect(adapter.resources.current[0]?.descriptor.url).toBe(
      "https://example.invalid/two.png",
    );
  });

  it("keeps a committed projection authoritative after presentation commit failure", async () => {
    const presentationErrors: { stage: string; error: unknown }[] = [];
    const { adapter, coordinator } = harness({
      onPresentationCommitError: (error) => {
        presentationErrors.push(error);
      },
    });
    await coordinator.hydrateInitial(
      document([image("image", "https://example.invalid/one.png")]),
      1,
    );
    adapter.portals.failNextCommit = new Error(
      "intentional portal presentation failure",
    );

    const result = await coordinator.enqueue({
      document: document([image("image", "https://example.invalid/two.png")]),
      revision: 2,
      origin: "remote",
    });

    expect(result).toMatchObject({ status: "applied", revision: 2 });
    expect(coordinator.lastAppliedRevision).toBe(2);
    expect(adapter.resources.current[0]?.descriptor.url).toBe(
      "https://example.invalid/two.png",
    );
    expect(presentationErrors).toEqual([
      {
        stage: "portals",
        error: expect.objectContaining({
          message: "intentional portal presentation failure",
        }),
      },
    ]);
  });

  it("keeps one portal mount, updates content on commit, preserves it on rollback, and unmounts", async () => {
    const updates: number[] = [];
    const dispose = vi.fn();
    const mount = vi.fn((args: {
      initialContent: { payload?: Record<string, unknown> };
      onContentUpdate(listener: TCanvasPortalContentUpdate): () => void;
    }) => {
      updates.push(args.initialContent.payload?.version as number);
      args.onContentUpdate((content) => {
        if (content.type === "ui-widget") {
          updates.push(content.payload?.version as number);
        }
      });
      return dispose;
    });
    const { adapter, coordinator } = harness({
      mountContent: mount as ConstructorParameters<
        typeof CanvasProjectionRuntimePort
      >[0]["mountContent"],
    });
    await coordinator.hydrateInitial(document([widget("widget", 1)]), 1);
    await coordinator.enqueue({
      document: document([widget("widget", 2)]),
      revision: 2,
      origin: "remote",
    });
    adapter.failNext = { fatal: false };
    const failed = await coordinator.enqueue({
      document: document([widget("widget", 3)]),
      revision: 3,
      origin: "remote",
    });
    await coordinator.enqueue({
      document: document([widget("widget", 4)]),
      revision: 4,
      origin: "remote",
    });
    await coordinator.enqueue({
      document: document([]),
      revision: 5,
      origin: "remote",
    });

    expect(failed.status).toBe("failed");
    expect(mount).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([1, 2, 4]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("surfaces adapter failure metadata through a canvas-owned error", async () => {
    const { adapter, coordinator } = harness();
    await coordinator.hydrateInitial(document([rect("one")]), 1);
    adapter.failNext = { fatal: true };

    const result = await coordinator.enqueue({
      document: document([rect("one", 90)]),
      revision: 2,
      origin: "local",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBeInstanceOf(CanvasProjectionRuntimeError);
      expect(result.error).toMatchObject({
        code: "ADAPTER_APPLY_FAILED",
        revision: 2,
        fatal: true,
      });
    }
    expect(adapter.events.slice(-5)).toEqual([
      "resources:replace",
      "portals:prepare",
      "scene:commands",
      "portals:rollback",
      "resources:replace",
    ]);
  });

  it("tears down portal/resource ownership idempotently", async () => {
    const dispose = vi.fn();
    const { adapter, coordinator, runtime } = harness({
      mountContent: () => dispose,
    });
    await coordinator.hydrateInitial(
      document([
        image("image", "https://example.invalid/image.png"),
        widget("widget", 1),
      ]),
      1,
    );

    await runtime.destroy();
    await runtime.destroy();

    expect(adapter.resources.current).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
