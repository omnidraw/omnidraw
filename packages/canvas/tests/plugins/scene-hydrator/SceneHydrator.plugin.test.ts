import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createSceneHydratorPlugin } from "../../../src/plugins/scene-hydrator/SceneHydrator.plugin";

class TestHook<TArgs extends unknown[]> {
  readonly listeners: Array<(...args: TArgs) => unknown> = [];
  tap(listener: (...args: TArgs) => unknown) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
      return true;
    };
  }
  call(...args: TArgs) {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

describe("SceneHydrator plugin", () => {
  it("observes SceneService projection diagnostics without hydrating nodes", () => {
    const projection = new TestHook<[Record<string, unknown>]>();
    const diagnostic = new TestHook<[{
      severity: "warning" | "error";
      code: string;
    }]>();
    const hooks = {
      init: new TestHook<[]>(),
      destroy: new TestHook<[]>(),
      elementDefinitionInvalidated:
        new TestHook<[{ elementIds: readonly string[] }]>(),
    };
    const logging = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const services = new Map<string, unknown>([
      ["logging", logging],
      ["scene", {
        state: "ready",
        diagnostics: () => [],
        hooks: { projection, diagnostic },
      }],
    ]);

    createSceneHydratorPlugin().apply({
      hooks,
      services: {
        require: (name: string) => services.get(name),
      },
      config: {},
    } as never);
    hooks.init.call();
    projection.call({
      status: "applied",
      revision: 1,
      origin: "initial",
      mode: "replace",
    });
    diagnostic.call({
      severity: "error",
      code: "PROJECTION_FAILED",
    });
    hooks.elementDefinitionInvalidated.call({
      elementIds: ["late-definition"],
    });

    expect(logging.log).toHaveBeenCalledWith(expect.objectContaining({
      event: "projection-applied",
    }));
    expect(logging.error).toHaveBeenCalledWith(expect.objectContaining({
      event: "PROJECTION_FAILED",
    }));
    expect(logging.warn).toHaveBeenCalledWith(expect.objectContaining({
      event: "definition-invalidated",
      payload: expect.objectContaining({
        elementIds: ["late-definition"],
      }),
    }));

    hooks.destroy.call();
    projection.call({ status: "noop" });
    expect(logging.log).toHaveBeenCalledTimes(2);
  });
});
