// @vitest-environment jsdom
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import { describe, expect, it, vi } from "vitest";
import type {
  TWidgetCapsuleCanvasLifecycleSource,
  TWidgetCapsuleCanvasLifecycleState,
} from "../../src/widget/interface";
import {
  txMountCommittedWidgetRuntime,
} from "../../src/widget/tx.mount-committed-widget-runtime";

function widget(
  revisionId: string,
  uiProps: Record<string, unknown> = {},
): TElement {
  return {
    id: "widget",
    x: 0,
    y: 0,
    rotation: 0,
    zIndex: "A",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: "widget-instance",
      definitionId: "11111111-1111-4111-8111-111111111111",
      revisionId,
      instanceId: "33333333-3333-4333-8333-333333333333",
      uiProps,
      w: 320,
      h: 200,
      expanded: true,
    },
    style: {},
  };
}

function lifecycleFixture(initial: TWidgetCapsuleCanvasLifecycleState) {
  let current = initial;
  const listeners = new Set<
    (state: TWidgetCapsuleCanvasLifecycleState) => void
  >();
  const source: TWidgetCapsuleCanvasLifecycleSource = {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    emit(next: TWidgetCapsuleCanvasLifecycleState) {
      current = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
  };
}

function activeLifecycle(): TWidgetCapsuleCanvasLifecycleState {
  return {
    viewport: {
      width: 320,
      height: 168,
      scale: 2,
      visibility: "visible",
      distance: 0,
      priority: 90,
      occlusion: 0,
    },
    focused: true,
    frozen: false,
    collapsed: false,
    canvasMaximized: false,
  };
}

function owner(order?: string[]) {
  return {
    setProps: vi.fn(),
    setViewport: vi.fn(),
    setFocused: vi.fn(),
    freeze: vi.fn(async () => {
      order?.push("freeze");
    }),
    resume: vi.fn(async () => {
      order?.push("resume");
    }),
    diagnostics: vi.fn(() => null),
    destroy: vi.fn(async () => {
      order?.push("destroy");
    }),
  };
}

describe("txMountCommittedWidgetRuntime", () => {
  it("forwards viewport, focus, freeze/resume and destroys idempotently", async () => {
    let current = widget("22222222-2222-4222-8222-222222222222");
    const change = new SyncHook<[]>();
    const lifecycle = lifecycleFixture(activeLifecycle());
    const mountedOwner = owner();
    const renderOwned = vi.fn(() => mountedOwner);
    const cleanup = txMountCommittedWidgetRuntime({
      canvasId: "canvas",
      crdtService: {
        doc: () => ({ elements: { widget: current } }),
        hooks: { change },
      } as never,
      runtime: { renderOwned } as never,
    }, {
      elementId: "widget",
      root: document.createElement("div"),
      capsuleLifecycle: lifecycle.source,
    });

    expect(renderOwned).toHaveBeenCalledOnce();
    expect(mountedOwner.setProps).toHaveBeenCalledWith({});
    expect(renderOwned).toHaveBeenCalledWith(expect.objectContaining({
      initialViewport: activeLifecycle().viewport,
      initiallyFrozen: false,
    }));
    expect(mountedOwner.setViewport).toHaveBeenCalledWith(
      activeLifecycle().viewport,
    );
    expect(mountedOwner.setFocused).toHaveBeenCalledWith(
      true,
      { preventScroll: true },
    );
    expect(mountedOwner.resume).toHaveBeenCalledWith("canvas-widget-visible");

    const collapsed: TWidgetCapsuleCanvasLifecycleState = {
      ...activeLifecycle(),
      viewport: {
        ...activeLifecycle().viewport,
        visibility: "hidden",
        priority: -100,
        occlusion: 1,
      },
      focused: false,
      frozen: true,
      collapsed: true,
    };
    lifecycle.emit(collapsed);
    lifecycle.emit(collapsed);
    expect(mountedOwner.setFocused).toHaveBeenLastCalledWith(false, undefined);
    expect(mountedOwner.freeze).toHaveBeenCalledOnce();
    expect(mountedOwner.freeze).toHaveBeenCalledWith(
      "canvas-widget-collapsed",
    );

    cleanup();
    cleanup();
    await vi.waitFor(() => {
      expect(mountedOwner.destroy).toHaveBeenCalledOnce();
    });

    lifecycle.emit(activeLifecycle());
    expect(mountedOwner.resume).toHaveBeenCalledOnce();
    void current;
  });

  it("updates persisted UI props without remounting and stops after teardown", async () => {
    let current = widget(
      "22222222-2222-4222-8222-222222222222",
      { count: 1 },
    );
    const change = new SyncHook<[]>();
    const mountedOwner = owner();
    const renderOwned = vi.fn(() => mountedOwner);
    const cleanup = txMountCommittedWidgetRuntime({
      canvasId: "canvas",
      crdtService: {
        doc: () => ({ elements: { widget: current } }),
        hooks: { change },
      } as never,
      runtime: { renderOwned } as never,
    }, {
      elementId: "widget",
      root: document.createElement("div"),
    });

    expect(mountedOwner.setProps).toHaveBeenCalledWith({ count: 1 });
    current = widget(
      "22222222-2222-4222-8222-222222222222",
      { count: 2, label: "updated" },
    );
    change.call();
    await vi.waitFor(() => {
      expect(mountedOwner.setProps).toHaveBeenLastCalledWith({
        count: 2,
        label: "updated",
      });
    });
    expect(renderOwned).toHaveBeenCalledOnce();
    expect(mountedOwner.destroy).not.toHaveBeenCalled();

    cleanup();
    await vi.waitFor(() => expect(mountedOwner.destroy).toHaveBeenCalledOnce());
    const propCalls = mountedOwner.setProps.mock.calls.length;
    current = widget(
      "22222222-2222-4222-8222-222222222222",
      { count: 3 },
    );
    change.call();
    expect(mountedOwner.setProps).toHaveBeenCalledTimes(propCalls);
  });

  it("awaits old revision destruction before mounting the replacement", async () => {
    let current = widget("22222222-2222-4222-8222-222222222222");
    const change = new SyncHook<[]>();
    const lifecycle = lifecycleFixture(activeLifecycle());
    const order: string[] = [];
    let releaseFirstDestroy!: () => void;
    const first = owner(order);
    first.destroy.mockImplementation(() => {
      order.push("destroy:first:start");
      return new Promise<void>((resolve) => {
        releaseFirstDestroy = () => {
          order.push("destroy:first:end");
          resolve();
        };
      });
    });
    const second = owner(order);
    const renderOwned = vi.fn()
      .mockImplementationOnce(() => {
        order.push("render:first");
        return first;
      })
      .mockImplementationOnce(() => {
        order.push("render:second");
        return second;
      });
    const cleanup = txMountCommittedWidgetRuntime({
      canvasId: "canvas",
      crdtService: {
        doc: () => ({ elements: { widget: current } }),
        hooks: { change },
      } as never,
      runtime: { renderOwned } as never,
    }, {
      elementId: "widget",
      root: document.createElement("div"),
      capsuleLifecycle: lifecycle.source,
    });
    await Promise.resolve();

    current = widget("44444444-4444-4444-8444-444444444444");
    change.call();
    await vi.waitFor(() => {
      expect(first.destroy).toHaveBeenCalledWith(
        "canvas-widget-revision-replaced",
      );
    });
    expect(renderOwned).toHaveBeenCalledOnce();

    releaseFirstDestroy();
    await vi.waitFor(() => {
      expect(renderOwned).toHaveBeenCalledTimes(2);
    });
    expect(order.indexOf("destroy:first:end")).toBeLessThan(
      order.indexOf("render:second"),
    );

    cleanup();
    await vi.waitFor(() => {
      expect(second.destroy).toHaveBeenCalledOnce();
    });
  });
});
