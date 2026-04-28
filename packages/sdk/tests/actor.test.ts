import { describe, expect, test } from "bun:test";
import { createActorRuntime, type TVibecanvasActorDefinition, type TVibecanvasActorOutputMessage } from "../src/actor";

describe("actor runtime", () => {
  test("stores definition and notifies host", () => {
    let observedDefinition: TVibecanvasActorDefinition | null = null;
    const runtime = createActorRuntime({
      onDefinition(definition) {
        observedDefinition = definition;
      },
    });

    const definition: TVibecanvasActorDefinition = {
      name: "Counter",
      inputs: {
        increment: {
          schema: { type: "number" },
        },
      },
      outputs: {
        changed: { schema: { type: "number" } },
      },
    };

    runtime.defineActor(definition);

    expect(runtime.getActorDefinition()).toBe(definition);
    expect(observedDefinition).toBe(definition);
  });

  test("delivers messages to define handlers and imperative handlers", async () => {
    const runtime = createActorRuntime();
    const received: unknown[] = [];

    runtime.defineActor({
      inputs: {
        add: {
          schema: { type: "number" },
          handle(payload) {
            received.push(["define", payload]);
          },
        },
      },
    });

    const cleanup = runtime.onActor("add", async (payload) => {
      received.push(["on", payload]);
    });

    await expect(runtime.deliverActor("add", 3)).resolves.toBe(2);
    expect(received).toEqual([
      ["define", 3],
      ["on", 3],
    ]);

    cleanup();
    await expect(runtime.deliverActor("add", 4)).resolves.toBe(1);
    expect(received).toEqual([
      ["define", 3],
      ["on", 3],
      ["define", 4],
    ]);
  });

  test("emits output messages to host", () => {
    const messages: TVibecanvasActorOutputMessage[] = [];
    const runtime = createActorRuntime({
      onEmit(message) {
        messages.push(message);
      },
    });

    runtime.emitActor("changed", { count: 1 });
    runtime.emitActor("done");

    expect(messages).toEqual([
      { output: "changed", payload: { count: 1 } },
      { output: "done", payload: undefined },
    ]);
  });

  test("returns zero for unknown input ports", async () => {
    const runtime = createActorRuntime();

    await expect(runtime.deliverActor("missing", { ok: true })).resolves.toBe(0);
  });
});
