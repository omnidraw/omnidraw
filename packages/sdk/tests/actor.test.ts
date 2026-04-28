import { describe, expect, test } from "bun:test";
import { createActorRuntime, type TVibecanvasActorDefinition, type TVibecanvasActorOutputMessage } from "../src/actor";

describe("actor runtime", () => {
  test("stores definition, notifies host, and returns actor", () => {
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

    const actor = runtime.defineActor(definition);

    expect(runtime.getActorDefinition()).toBe(definition);
    expect(observedDefinition).toBe(definition);
    expect(typeof actor.send).toBe("function");
    expect(typeof actor.receive).toBe("function");
  });

  test("delivers messages to define handlers and actor receive handlers", async () => {
    const runtime = createActorRuntime();
    const received: unknown[] = [];

    const actor = runtime.defineActor({
      inputs: {
        add: {
          schema: { type: "number" },
          handle(payload) {
            received.push(["define", payload]);
          },
        },
      },
    });

    const cleanup = actor.receive("add", async (payload) => {
      received.push(["receive", payload]);
    });

    await expect(runtime.deliverActor("add", 3)).resolves.toBe(2);
    expect(received).toEqual([
      ["define", 3],
      ["receive", 3],
    ]);

    cleanup();
    await expect(runtime.deliverActor("add", 4)).resolves.toBe(1);
    expect(received).toEqual([
      ["define", 3],
      ["receive", 3],
      ["define", 4],
    ]);
  });

  test("actor sends output messages to host", () => {
    const messages: TVibecanvasActorOutputMessage[] = [];
    const runtime = createActorRuntime({
      onSend(message) {
        messages.push(message);
      },
    });

    const actor = runtime.defineActor({
      outputs: {
        changed: {
          schema: {
            type: "object",
            properties: { count: { type: "number" } },
            required: ["count"],
            additionalProperties: false,
          },
        },
      },
    });
    actor.send("changed", { count: 1 });
    actor.send("done");

    expect(messages).toEqual([
      { output: "changed", payload: { count: 1 } },
      { output: "done", payload: undefined },
    ]);
  });

  test("returns zero for unknown input ports", async () => {
    const runtime = createActorRuntime();

    await expect(runtime.deliverActor("missing", { ok: true })).resolves.toBe(0);
  });

  test("does not deliver input when payload misses input schema", async () => {
    const runtime = createActorRuntime();
    const received: unknown[] = [];

    const actor = runtime.defineActor({
      inputs: {
        add: {
          schema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
          handle(payload) {
            received.push(["define", payload]);
          },
        },
      },
    });

    actor.receive("add", (payload) => {
      received.push(["receive", payload]);
    });

    await expect(runtime.deliverActor("add", { nope: true })).resolves.toBe(0);
    expect(received).toEqual([]);

    await expect(runtime.deliverActor("add", { title: "ok" })).resolves.toBe(2);
    expect(received).toEqual([
      ["define", { title: "ok" }],
      ["receive", { title: "ok" }],
    ]);
  });

  test("throws when output payload misses output schema and does not notify host", () => {
    const messages: TVibecanvasActorOutputMessage[] = [];
    const runtime = createActorRuntime({
      onSend(message) {
        messages.push(message);
      },
    });
    const actor = runtime.defineActor({
      outputs: {
        changed: {
          schema: {
            type: "object",
            properties: { count: { type: "number" } },
            required: ["count"],
            additionalProperties: false,
          },
        },
      },
    });

    expect(() => actor.send("changed", { count: "wrong" })).toThrow(/Actor output "changed" schema mismatch/);
    expect(messages).toEqual([]);

    actor.send("changed", { count: 2 });
    expect(messages).toEqual([{ output: "changed", payload: { count: 2 } }]);
  });
});
