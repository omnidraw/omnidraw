import { describe, expect, it, vi } from "vitest";
import { ToolService } from "../../src/services/tool/ToolService";

class TestHook<TArgs extends unknown[]> {
  readonly listeners: Array<(...args: TArgs) => unknown> = [];

  tap(listener: (...args: TArgs) => unknown) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  call(...args: TArgs) {
    for (const listener of [...this.listeners]) {
      listener(...args);
    }
  }
}

function pointerDown(pointerId: number) {
  return {
    type: "pointer-down",
    pointerId,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    world: { x: 0, y: 0 },
    viewport: { x: 0, y: 0 },
    client: { x: 0, y: 0 },
    deltaWorld: { x: 0, y: 0 },
    deltaViewport: { x: 0, y: 0 },
    pressure: 0,
    tilt: { x: 0, y: 0 },
    timeStamp: pointerId,
    modifiers: {
      alt: false,
      control: false,
      meta: false,
      shift: false,
    },
    hit: null,
  } as const;
}

describe("ToolService Cangine-owned session completion", () => {
  it("allows the next draw to begin when the engine callback completes the session", () => {
    const service = new ToolService();
    const pointerDownHook = new TestHook<[ReturnType<typeof pointerDown>]>();
    const createSession = vi.fn((event: ReturnType<typeof pointerDown>) => ({
      id: `draw-${event.pointerId}`,
      cancel: vi.fn(),
    }));
    service.registerTool({
      id: "rect",
      label: "Rectangle",
      behavior: { type: "mode", mode: "draw-create" },
      createSession,
    });
    service.setActiveTool("rect");
    service.start({
      hooks: {
        pointerDown: pointerDownHook,
        pointerMove: new TestHook(),
        pointerUp: new TestHook(),
        pointerCancel: new TestHook(),
        keydown: new TestHook(),
        destroy: new TestHook(),
      },
    } as never);

    pointerDownHook.call(pointerDown(1));
    expect(service.activeSession?.id).toBe("draw-1");
    expect(service.completeSession("draw-1")).toBe(true);
    expect(service.activeSession).toBeNull();

    pointerDownHook.call(pointerDown(2));
    expect(service.activeSession?.id).toBe("draw-2");
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(service.completeSession("draw-1")).toBe(false);
    expect(service.activeSession?.id).toBe("draw-2");
  });
});
