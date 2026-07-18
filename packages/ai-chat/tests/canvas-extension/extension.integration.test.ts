import { ThemeService } from "@vibecanvas/service-theme";
import { buildRuntime } from "@vibecanvas/canvas/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiChatCanvasExtension } from "../../src/canvas-extension";
import {
  createMockDocHandle,
  createTestApplication,
  createTestChatBrowser,
  createTestContainer,
  createTestWidgetBrowser,
  ensureCanvasDom,
} from "../test-setup";

describe("AI Chat canvas extension", () => {
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    container?.remove();
    container = undefined;
  });

  it("registers AI/widget capabilities before hydration and tears down its stream and portal", async () => {
    ensureCanvasDom();
    container = createTestContainer();

    let resolveNext: ((value: IteratorResult<unknown>) => void) | undefined;
    const returnStream = vi.fn(async () => {
      resolveNext?.({ done: true, value: undefined });
      return { done: true, value: undefined } as IteratorResult<unknown>;
    });
    const actorEvents = vi.fn(async () => [null, {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>((resolve) => {
            resolveNext = resolve;
          }),
          return: returnStream,
        };
      },
    }] as const);
    const listDefinitions = vi.fn(async () => [null, []] as const);

    const extension = createAiChatCanvasExtension({
      chatApi: {} as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: listDefinitions, get: vi.fn() },
            instances: {} as never,
            events: actorEvents,
          },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: createTestWidgetBrowser(),
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "extension-test",
      container,
      docHandle: createMockDocHandle(),
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();

    expect(runtime.services.require("tool").getTool("ai")?.label).toBe("AI Chat");
    expect(container.querySelector("#widget-portal")).not.toBeNull();
    expect(listDefinitions).toHaveBeenCalledOnce();
    expect(actorEvents).toHaveBeenCalledOnce();

    await runtime.shutdown();

    expect(runtime.services.require("tool").getTool("ai")).toBeUndefined();
    expect(container.querySelector("#widget-portal")).toBeNull();
    expect(returnStream).toHaveBeenCalledOnce();
  });

  it("closes actor and agent streams that resolve after runtime shutdown", async () => {
    ensureCanvasDom();
    container = createTestContainer();

    let resolveActorEvents!: (value: readonly [null, AsyncIterable<unknown>]) => void;
    let resolveAgentEvents!: (value: readonly [null, AsyncIterable<unknown>]) => void;
    const actorEvents = vi.fn(() => new Promise<readonly [null, AsyncIterable<unknown>]>((resolve) => {
      resolveActorEvents = resolve;
    }));
    const agentEvents = vi.fn(() => new Promise<readonly [null, AsyncIterable<unknown>]>((resolve) => {
      resolveAgentEvents = resolve;
    }));
    const actorReturn = vi.fn(async () => ({ done: true, value: undefined }) as IteratorResult<unknown>);
    const agentReturn = vi.fn(async () => ({ done: true, value: undefined }) as IteratorResult<unknown>);
    const stream = (returnStream: typeof actorReturn): AsyncIterable<unknown> => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>(() => {}),
          return: returnStream,
        };
      },
    });

    const extension = createAiChatCanvasExtension({
      chatApi: {} as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: vi.fn(async () => [null, []] as const), get: vi.fn() },
            instances: {} as never,
            events: actorEvents,
          },
          agent: { events: agentEvents },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: createTestWidgetBrowser(),
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "late-stream-test",
      container,
      docHandle: createMockDocHandle(),
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();
    await runtime.shutdown();
    resolveActorEvents([null, stream(actorReturn)]);
    resolveAgentEvents([null, stream(agentReturn)]);

    await vi.waitFor(() => {
      expect(actorReturn).toHaveBeenCalledOnce();
      expect(agentReturn).toHaveBeenCalledOnce();
    });
  });
});
