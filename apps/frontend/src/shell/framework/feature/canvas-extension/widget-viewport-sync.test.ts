import { describe, expect, test } from "bun:test";
import type { TWidgetFrameNode } from "@omnidraw/canvas-contract";
import type { TWidgetViewport } from "@omnidraw/sdk";

import { createWidgetViewportSync } from "./widget-viewport-sync";

function frame(visibility: "visible" | "hidden" = "visible"): TWidgetFrameNode {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "widget-frame",
    parentId: null,
    orderKey: "a0",
    visibility,
    size: { width: 360, height: 320 },
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    extensions: {},
  };
}

describe("createWidgetViewportSync", () => {
  test("streams live resize and fullscreen box changes without authored node updates", () => {
    const container = { clientWidth: 360, clientHeight: 320 } as HTMLElement;
    let callback: ResizeObserverCallback | undefined;
    let observed: Element | undefined;
    let disconnected = false;
    const observer = {
      observe(target: Element) { observed = target; },
      disconnect() { disconnected = true; },
    } as unknown as ResizeObserver;
    const updates: TWidgetViewport[] = [];
    const sync = createWidgetViewportSync({
      container,
      createResizeObserver(next) {
        callback = next;
        return observer;
      },
      devicePixelRatio: () => 2,
      node: frame(),
    });
    const initial = sync.current();
    sync.attach({ setViewport: (viewport) => updates.push(viewport) }, initial);

    expect(observed).toBe(container);
    expect(initial).toMatchObject({ width: 360, height: 320, scale: 2 });
    expect(updates).toHaveLength(0);

    callback?.([{
      target: container,
      contentRect: { width: 864, height: 964 },
    } as unknown as ResizeObserverEntry], observer);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ width: 864, height: 964, scale: 2 });

    callback?.([{
      target: container,
      contentRect: { width: 864, height: 964 },
    } as unknown as ResizeObserverEntry], observer);
    expect(updates).toHaveLength(1);

    sync.updateNode(frame("hidden"));
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({
      width: 864,
      height: 964,
      visibility: "hidden",
    });

    const attached = { setViewport: (viewport: TWidgetViewport) => updates.push(viewport) };
    sync.attach(attached, updates[1]!);
    sync.detach({ setViewport: () => undefined });
    sync.updateNode(frame("visible"));
    expect(updates).toHaveLength(3);
    sync.detach(attached);
    sync.updateNode(frame("hidden"));
    expect(updates).toHaveLength(3);

    sync.disconnect();
    expect(disconnected).toBe(true);
  });
});
