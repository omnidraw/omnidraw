import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Actor, type TActorEvent } from "../src/Actor";
import { ActorResourceError } from "../src/resources/ActorResourceError";
import type { TVibecanvasJson } from "../src/core/types";
import type { TActorResourceCall, TActorResourceGateway } from "../src/resources/resource-types";

async function waitForIdle(actor: Actor) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (actor.isIdle()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for actor to become idle");
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await Bun.sleep(10);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function buildManifest(args: {
  name: string;
  functions: Array<`fn.${string}` | `fx.${string}` | `tx.${string}`>;
  initialData?: TVibecanvasJson["actor"]["initialData"];
  resources?: TVibecanvasJson["actor"]["resources"];
}): TVibecanvasJson {
  return {
    slug: args.name.toLowerCase().replaceAll(" ", "-"),
    name: args.name,
    actor: {
      relFunctionPath: "./functions.ts",
      initialState: "ready",
      initialData: args.initialData ?? {},
      resources: args.resources,
      states: {
        ready: {
          on: {
            run: {
              func: args.functions,
              targetState: "ready",
            },
          },
        },
      },
      inputMsgSchema: {
        run: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
    widget: {
      relWidgetDir: "./widget",
      tool: {
        label: args.name,
        behavior: { type: "action" },
      },
    },
  };
}

describe("Actor resource IPC integration", () => {
  test("correlates concurrent child calls and derives parent-owned run identity and function class", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vibecanvas-actor-resource-ipc-"));
    await writeFile(join(rootDir, "functions.ts"), `
export default {
  fn: {
    "fn.inspect": async (portal) => {
      if ("resources" in portal) throw new Error("fn portal exposed resources");
      if ("setData" in portal) throw new Error("fn portal exposed setData");
      return portal.next();
    },
  },
  fx: {
    "fx.read": async (portal, args) => {
      const kv = portal.resources.kv("preferences");
      if (typeof kv.set === "function") throw new Error("fx portal exposed writes");
      const [first, second] = await Promise.all([kv.get("first"), kv.get("second")]);
      await portal.setData({ ...args.data, reads: [first.value, second.value] });
      return portal.next();
    },
  },
  tx: {
    "tx.write": async (portal, args) => {
      const result = await portal.resources.kv("preferences").set({ key: "combined", value: args.data.reads });
      const transactionResults = await portal.resources.db("notes").execute([
        { sql: "BEGIN IMMEDIATE" },
        { sql: "UPDATE notes SET title = :title WHERE id = :id", parameters: { id: "a", title: "Updated" } },
        { sql: "COMMIT" },
      ]);
      await portal.setData({ ...args.data, writeRevision: result.revision, transactionResultCount: transactionResults.length });
    },
  },
};
`);

    const calls: TActorResourceCall[] = [];
    const completionOrder: string[] = [];
    let resolveFirst: ((result: unknown) => void) | null = null;
    const resourceGateway: TActorResourceGateway = (call) => {
      calls.push(call);
      const callArgs = call.args as Record<string, unknown>;

      if (call.operation === "get" && callArgs.key === "first") {
        return new Promise((resolve) => {
          resolveFirst = (result) => {
            completionOrder.push("first");
            resolve(result);
          };
        });
      }

      if (call.operation === "get" && callArgs.key === "second") {
        completionOrder.push("second");
        setTimeout(() => resolveFirst?.({ value: "first-value", revision: 1 }), 20);
        return Promise.resolve({ value: "second-value", revision: 2 });
      }

      if (call.operation === "set") {
        return Promise.resolve({ value: callArgs.value, revision: 3 });
      }

      if (call.kind === "db" && call.operation === "execute") {
        return Promise.resolve([{ rowsAffected: 0 }, { rowsAffected: 1 }, { rowsAffected: 0 }]);
      }

      return Promise.reject(new Error(`Unexpected resource operation ${call.operation}`));
    };
    const manifest = buildManifest({
      name: "Resource IPC Definition",
      functions: ["fn.inspect", "fx.read", "tx.write"],
      initialData: { started: true },
      resources: {
        preferences: { kind: "kv", required: true, scope: ["read", "write"] },
        notes: { kind: "db", required: true, scope: ["write"], schema: { id: "notes", version: 1 }, arbitrarySql: true },
      },
    });
    const actor = new Actor({
      id: "resource-ipc-actor",
      rootDir,
      vsJson: manifest,
      resourceGateway,
    });

    try {
      actor.start();
      await actor.waitUntilReady();
      const messageId = actor.inbox("run", {});
      await waitForIdle(actor);

      expect(messageId).toBeString();
      expect(actor.getState()).toBe("ready");
      expect(actor.getData()).toEqual({
        started: true,
        reads: ["first-value", "second-value"],
        writeRevision: 3,
        transactionResultCount: 3,
      });
      expect(completionOrder).toEqual(["second", "first"]);
      expect(new Set(calls.map((call) => call.runId)).size).toBe(1);
      expect(calls.map((call) => ({
        actorId: call.actorId,
        definitionName: call.definitionName,
        functionClass: call.functionClass,
        slot: call.slot,
        kind: call.kind,
        operation: call.operation,
        args: call.args,
      }))).toEqual([
        {
          actorId: "resource-ipc-actor",
          definitionName: "Resource IPC Definition",
          functionClass: "fx",
          slot: "preferences",
          kind: "kv",
          operation: "get",
          args: { key: "first" },
        },
        {
          actorId: "resource-ipc-actor",
          definitionName: "Resource IPC Definition",
          functionClass: "fx",
          slot: "preferences",
          kind: "kv",
          operation: "get",
          args: { key: "second" },
        },
        {
          actorId: "resource-ipc-actor",
          definitionName: "Resource IPC Definition",
          functionClass: "tx",
          slot: "preferences",
          kind: "kv",
          operation: "set",
          args: { key: "combined", value: ["first-value", "second-value"] },
        },
        {
          actorId: "resource-ipc-actor",
          definitionName: "Resource IPC Definition",
          functionClass: "tx",
          slot: "notes",
          kind: "db",
          operation: "execute",
          args: { operations: [
            { sql: "BEGIN IMMEDIATE" },
            { sql: "UPDATE notes SET title = :title WHERE id = :id", parameters: { id: "a", title: "Updated" } },
            { sql: "COMMIT" },
          ] },
        },
      ]);
    } finally {
      await actor.closeAndWait();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("returns a redacted gateway ActorResourceError to child code", async () => {
    const sentinel = "SENTINEL-GATEWAY-SECRET-29f4e2";
    const rootDir = await mkdtemp(join(tmpdir(), "vibecanvas-actor-resource-error-"));
    await writeFile(join(rootDir, "functions.ts"), `
export default {
  fn: {},
  fx: {},
  tx: {
    "tx.storeSecret": async (portal) => {
      try {
        await portal.resources.secretStore("credentials").set({
          name: "accessToken",
          value: ${JSON.stringify(sentinel)},
        });
      } catch (error) {
        const received = { code: error.code, message: error.message, details: error.details };
        await portal.setData({ received, serialized: JSON.stringify(received) });
      }
    },
  },
};
`);

    const calls: TActorResourceCall[] = [];
    const events: TActorEvent[] = [];
    const resourceGateway: TActorResourceGateway = async (call) => {
      calls.push(call);
      throw new ActorResourceError(
        "SECRET_OPERATION_FAILED",
        "Secret-store operation failed safely.",
        {
          name: "accessToken",
          revision: 7,
          token: sentinel,
          nested: { label: "safe", value: sentinel },
        },
      );
    };
    const manifest = buildManifest({
      name: "Secret Error Definition",
      functions: ["tx.storeSecret"],
      resources: {
        credentials: { kind: "secretStore", required: true, scope: ["write"] },
      },
    });
    const actor = new Actor({
      id: "secret-error-actor",
      rootDir,
      vsJson: manifest,
      resourceGateway,
    });
    actor.listen((event) => events.push(event));

    try {
      actor.start();
      await actor.waitUntilReady();
      actor.inbox("run", {});
      await waitForIdle(actor);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        actorId: "secret-error-actor",
        definitionName: "Secret Error Definition",
        functionClass: "tx",
        slot: "credentials",
        kind: "secretStore",
        operation: "set",
        args: { name: "accessToken", value: sentinel },
      });
      expect(actor.getData()).toEqual({
        received: {
          code: "SECRET_OPERATION_FAILED",
          message: "Secret-store operation failed safely.",
          details: {
            name: "accessToken",
            revision: 7,
            nested: { label: "safe" },
          },
        },
        serialized: JSON.stringify({
          code: "SECRET_OPERATION_FAILED",
          message: "Secret-store operation failed safely.",
          details: {
            name: "accessToken",
            revision: 7,
            nested: { label: "safe" },
          },
        }),
      });
      expect(JSON.stringify(actor.getData())).not.toContain(sentinel);
      expect(JSON.stringify(events)).not.toContain(sentinel);
    } finally {
      await actor.closeAndWait();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("cancels a forged child resource call after its run is missing", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vibecanvas-actor-resource-late-"));
    const resultPath = join(rootDir, "late-result.json");
    await writeFile(join(rootDir, "functions.ts"), `
import { writeFile } from "node:fs/promises";

export default {
  fn: {},
  fx: {},
  tx: {
    "tx.scheduleLateCall": async () => {
      const callId = "late-missing-run";
      const onMessage = async (message) => {
        if (message?.type !== "resourceResult" || message.callId !== callId) return;
        process.off("message", onMessage);
        await writeFile(${JSON.stringify(resultPath)}, JSON.stringify(message));
      };
      process.on("message", onMessage);
      setTimeout(() => {
        process.send?.({
          type: "resourceCall",
          id: 999999,
          callId,
          slot: "preferences",
          kind: "kv",
          operation: "get",
          args: { key: "late" },
        });
      }, 20);
    },
  },
};
`);

    const gatewayCalls: TActorResourceCall[] = [];
    const manifest = buildManifest({
      name: "Late Resource Definition",
      functions: ["tx.scheduleLateCall"],
      resources: {
        preferences: { kind: "kv", required: true, scope: ["read"] },
      },
    });
    const actor = new Actor({
      id: "late-resource-actor",
      rootDir,
      vsJson: manifest,
      resourceGateway: async (call) => {
        gatewayCalls.push(call);
        return null;
      },
    });

    try {
      actor.start();
      await actor.waitUntilReady();
      actor.inbox("run", {});
      await waitForIdle(actor);
      const result = JSON.parse(await waitForFile(resultPath));

      expect(gatewayCalls).toEqual([]);
      expect(result).toEqual({
        type: "resourceResult",
        callId: "late-missing-run",
        ok: false,
        error: {
          code: "RESOURCE_CALL_CANCELLED",
          message: "Actor resource call belongs to a completed or cancelled run.",
        },
      });
    } finally {
      await actor.closeAndWait();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
