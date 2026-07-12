import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type TChildMessage =
  | { type: "ready" }
  | { type: "next"; id: number }
  | { type: "setData"; id: number; data: unknown }
  | { type: "emitMessage"; id: number; msg: unknown }
  | {
      type: "resourceCall";
      id: number;
      callId: string;
      slot: string;
      kind: "kv" | "secretStore" | "db";
      operation: string;
      args: Record<string, unknown>;
    }
  | { type: "done"; id: number }
  | { type: "error"; id?: number; msg: unknown; error?: boolean };

function waitForChildExit(proc: Bun.Subprocess) {
  return Promise.race([
    proc.exited,
    Bun.sleep(5000).then(() => "timeout"),
  ]);
}

describe("icp-client", () => {
  test("runs source child mode over Bun IPC", async () => {
    const icpClientPath = new URL("../src/icp-client.ts", import.meta.url).pathname;
    const functionPath = new URL("./fixtures/account-fund-actor/actor/functions.ts", import.meta.url).pathname;
    const messages: TChildMessage[] = [];

    const done = new Promise<void>((resolve, reject) => {
      const proc = Bun.spawn([
        process.execPath,
        icpClientPath,
        "--icp-client",
        "--functionPath",
        functionPath,
      ], {
        cwd: new URL("./fixtures/account-fund-actor", import.meta.url).pathname,
        stdout: "pipe",
        stderr: "pipe",
        ipc(message) {
          const childMessage = message as TChildMessage;
          messages.push(childMessage);

          if (childMessage.type === "ready") {
            proc.send({
              type: "run",
              id: 1,
              func: ["tx.addFunds"],
              payload: { accountId: "1", amount: 37 },
              data: { balance: 5 },
            });
            return;
          }

          if (childMessage.type === "setData") {
            proc.send({ type: "ack", id: childMessage.id, action: "setData" });
            return;
          }

          if (childMessage.type === "emitMessage") {
            proc.send({ type: "ack", id: childMessage.id, action: "emitMessage" });
            return;
          }

          if (childMessage.type === "done") {
            resolve();
            proc.kill();
            return;
          }

          if (childMessage.type === "error") {
            reject(new Error(JSON.stringify(childMessage.msg)));
            proc.kill();
          }
        },
      });

      void waitForChildExit(proc).then((result) => {
        if (result === "timeout") {
          proc.kill(9);
          reject(new Error("Timed out waiting for icp-client child"));
        }
      });
    });

    await done;

    expect(messages.map((message) => message.type)).toEqual(["ready", "setData", "emitMessage", "done"]);
    expect(messages.find((message) => message.type === "setData")).toMatchObject({
      type: "setData",
      id: 1,
      data: { balance: 42 },
    });
    expect(messages.find((message) => message.type === "emitMessage")).toMatchObject({
      type: "emitMessage",
      id: 1,
      msg: {
        type: "funds-added",
        payload: { accountId: "1", amount: 37, balance: 42 },
      },
    });
  });

  test("serializes DOMException throws without killing the child", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vibecanvas-icp-domexception-"));
    const functionPath = join(rootDir, "functions.ts");
    await writeFile(functionPath, `
export default {
  fn: {
    "fn.throwDomException": async () => {
      throw new DOMException("The object can not be cloned.", "DataCloneError");
    },
  },
  fx: {},
  tx: {},
};
`);

    const icpClientPath = new URL("../src/icp-client.ts", import.meta.url).pathname;
    const messages: TChildMessage[] = [];
    let proc: Bun.Subprocess | null = null;

    try {
      const gotError = new Promise<TChildMessage>((resolve, reject) => {
        proc = Bun.spawn([
          process.execPath,
          icpClientPath,
          "--icp-client",
          "--functionPath",
          functionPath,
        ], {
          cwd: rootDir,
          stdout: "pipe",
          stderr: "pipe",
          ipc(message) {
            const childMessage = message as TChildMessage;
            messages.push(childMessage);

            if (childMessage.type === "ready") {
              proc?.send({
                type: "run",
                id: 1,
                func: ["fn.throwDomException"],
                payload: {},
                data: {},
              });
              return;
            }

            if (childMessage.type === "error") {
              resolve(childMessage);
            }
          },
        });

        void waitForChildExit(proc).then((result) => {
          if (result !== "timeout") {
            reject(new Error(`icp-client exited before assertion with code ${result}`));
          }
        });
      });

      const errorMessage = await gotError;
      expect(messages.map((message) => message.type)).toEqual(["ready", "error"]);
      expect(errorMessage).toMatchObject({
        type: "error",
        id: 1,
        msg: {
          name: "DataCloneError",
          message: "The object can not be cloned.",
          code: 25,
        },
      });
    } finally {
      (proc as Bun.Subprocess | null)?.kill();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("maps class-specific resource portals and correlates concurrent calls", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vibecanvas-icp-resources-"));
    const functionPath = join(rootDir, "functions.ts");
    await writeFile(functionPath, `
export default {
  fn: {
    "fn.inspect": async (portal) => {
      await portal.emitMessage({
        type: "fn-shape",
        payload: {
          hasResources: "resources" in portal,
          hasSetData: "setData" in portal,
        },
      });
      return portal.next();
    },
  },
  fx: {
    "fx.read": async (portal) => {
      const kv = portal.resources.kv("cache");
      const secrets = portal.resources.secretStore("credentials");
      const db = portal.resources.db("notes");
      const readResults = await Promise.all([
        kv.get("first"),
        kv.get("second"),
        kv.has("present"),
        kv.list({ prefix: "pre", limit: 2 }),
        secrets.get("token"),
        secrets.has("token"),
        secrets.list({ prefix: "tok" }),
        db.invoke("listNotes", { archived: false }),
        db.query("SELECT id FROM notes LIMIT :limit", { limit: 2 }),
      ]);

      await portal.setData({
        readResults,
        readShape: {
          kvCanWrite: typeof kv.set === "function",
          secretCanWrite: typeof secrets.set === "function",
          dbCanWrite: typeof db.execute === "function",
        },
      });

      await portal.next();

      let expiredCode = null;
      try {
        await kv.get("late");
      } catch (error) {
        expiredCode = error.code;
      }
      await portal.emitMessage({ type: "expired-shape", payload: { expiredCode } });
    },
  },
  tx: {
    "tx.write": async (portal, args) => {
      const kv = portal.resources.kv("cache");
      const secrets = portal.resources.secretStore("credentials");
      const db = portal.resources.db("notes");
      const writeResults = await Promise.all([
        kv.set({ key: "nullable", value: null }),
        kv.delete("old"),
        kv.compareAndSet({ key: "counter", expectedRevision: 4, value: 5 }),
        secrets.set({ name: "token", value: "secret-value" }),
        secrets.delete("old-token"),
        secrets.compareAndSet({ name: "token", expectedRevision: 2, value: "rotated-value" }),
        db.execute("UPDATE notes SET archived = :archived", { archived: true }),
      ]);

      await portal.emitMessage({
        type: "tx-shape",
        payload: {
          readData: args.data,
          writeResults,
          kvCanWrite: typeof kv.set === "function",
          secretCanWrite: typeof secrets.set === "function",
          dbCanWrite: typeof db.execute === "function",
        },
      });
    },
  },
};
`);

    const icpClientPath = new URL("../src/icp-client.ts", import.meta.url).pathname;
    const messages: TChildMessage[] = [];
    const resourceCalls: Extract<TChildMessage, { type: "resourceCall" }>[] = [];
    const concurrentGets = new Map<string, Extract<TChildMessage, { type: "resourceCall" }>>();
    let proc: Bun.Subprocess | null = null;

    function responseFor(call: Extract<TChildMessage, { type: "resourceCall" }>): unknown {
      if (call.kind === "kv" && call.operation === "has") return true;
      if (call.kind === "kv" && call.operation === "list") return { items: [], nextCursor: "kv-next" };
      if (call.kind === "kv" && call.operation === "set") return { value: call.args.value, revision: 7 };
      if (call.kind === "kv" && call.operation === "delete") return { deleted: true };
      if (call.kind === "kv" && call.operation === "compareAndSet") {
        return { ok: true, entry: { value: call.args.value, revision: 5 } };
      }
      if (call.kind === "secretStore" && call.operation === "get") return { value: "loaded-token", revision: 2 };
      if (call.kind === "secretStore" && call.operation === "has") return true;
      if (call.kind === "secretStore" && call.operation === "list") return { items: [{ name: "token", revision: 2 }] };
      if (call.kind === "secretStore" && call.operation === "set") return { name: call.args.name, revision: 3 };
      if (call.kind === "secretStore" && call.operation === "delete") return { deleted: true };
      if (call.kind === "secretStore" && call.operation === "compareAndSet") {
        return { ok: true, entry: { name: call.args.name, revision: 3 } };
      }
      if (call.kind === "db" && call.operation === "invoke") return [{ id: "named-result" }];
      if (call.kind === "db" && call.operation === "query") return [{ id: "query-result" }];
      if (call.kind === "db" && call.operation === "execute") return { rowsAffected: 4, lastInsertRowId: 9n };
      throw new Error(`Unexpected resource call ${call.kind}.${call.operation}`);
    }

    try {
      const done = new Promise<void>((resolve, reject) => {
        proc = Bun.spawn([
          process.execPath,
          icpClientPath,
          "--icp-client",
          "--functionPath",
          functionPath,
        ], {
          cwd: rootDir,
          stdout: "pipe",
          stderr: "pipe",
          ipc(message) {
            const childMessage = message as TChildMessage;
            messages.push(childMessage);

            if (childMessage.type === "ready") {
              proc?.send({
                type: "run",
                id: 77,
                func: ["fn.inspect", "fx.read", "tx.write"],
                payload: { input: true },
                data: { initial: true },
              });
              return;
            }

            if (childMessage.type === "resourceCall") {
              resourceCalls.push(childMessage);
              if (
                childMessage.kind === "kv" &&
                childMessage.operation === "get" &&
                (childMessage.args.key === "first" || childMessage.args.key === "second")
              ) {
                concurrentGets.set(childMessage.args.key, childMessage);
                if (concurrentGets.size === 2) {
                  const first = concurrentGets.get("first")!;
                  const second = concurrentGets.get("second")!;
                  proc?.send({
                    type: "resourceResult",
                    callId: second.callId,
                    ok: true,
                    result: { value: "second-result", revision: 2 },
                  });
                  proc?.send({
                    type: "resourceResult",
                    callId: first.callId,
                    ok: true,
                    result: { value: "first-result", revision: 1 },
                  });
                }
                return;
              }

              proc?.send({
                type: "resourceResult",
                callId: childMessage.callId,
                ok: true,
                result: responseFor(childMessage),
              });
              return;
            }

            if (childMessage.type === "setData") {
              proc?.send({ type: "ack", id: childMessage.id, action: "setData" });
              return;
            }

            if (childMessage.type === "emitMessage") {
              proc?.send({ type: "ack", id: childMessage.id, action: "emitMessage" });
              return;
            }

            if (childMessage.type === "next") {
              proc?.send({ type: "ack", id: childMessage.id, action: "next" });
              return;
            }

            if (childMessage.type === "done") {
              resolve();
              proc?.kill();
              return;
            }

            if (childMessage.type === "error") {
              reject(new Error(JSON.stringify(childMessage.msg)));
              proc?.kill();
            }
          },
        });

        void waitForChildExit(proc).then((result) => {
          if (result === "timeout") {
            proc?.kill(9);
            reject(new Error("Timed out waiting for resource IPC assertions"));
          }
        });
      });

      await done;

      const emitted = messages
        .filter((message): message is Extract<TChildMessage, { type: "emitMessage" }> => message.type === "emitMessage")
        .map((message) => message.msg) as Array<{ type: string; payload: any }>;
      const setData = messages.find(
        (message): message is Extract<TChildMessage, { type: "setData" }> => message.type === "setData",
      );

      expect(emitted.find((message) => message.type === "fn-shape")?.payload).toEqual({
        hasResources: false,
        hasSetData: false,
      });
      expect((setData?.data as any).readResults.slice(0, 2)).toEqual([
        { value: "first-result", revision: 1 },
        { value: "second-result", revision: 2 },
      ]);
      expect((setData?.data as any).readShape).toEqual({
        kvCanWrite: false,
        secretCanWrite: false,
        dbCanWrite: false,
      });
      expect(emitted.find((message) => message.type === "tx-shape")?.payload).toMatchObject({
        readData: { readShape: { kvCanWrite: false, secretCanWrite: false, dbCanWrite: false } },
        kvCanWrite: true,
        secretCanWrite: true,
        dbCanWrite: true,
      });
      expect(emitted.find((message) => message.type === "expired-shape")?.payload).toEqual({
        expiredCode: "RESOURCE_CALL_CANCELLED",
      });

      expect(new Set(resourceCalls.map((call) => call.callId)).size).toBe(resourceCalls.length);
      expect(resourceCalls.every((call) => call.id === 77 && call.callId.startsWith("77:"))).toBe(true);
      expect(resourceCalls.map(({ slot, kind, operation, args }) => ({ slot, kind, operation, args }))).toEqual([
        { slot: "cache", kind: "kv", operation: "get", args: { key: "first" } },
        { slot: "cache", kind: "kv", operation: "get", args: { key: "second" } },
        { slot: "cache", kind: "kv", operation: "has", args: { key: "present" } },
        { slot: "cache", kind: "kv", operation: "list", args: { prefix: "pre", limit: 2 } },
        { slot: "credentials", kind: "secretStore", operation: "get", args: { name: "token" } },
        { slot: "credentials", kind: "secretStore", operation: "has", args: { name: "token" } },
        { slot: "credentials", kind: "secretStore", operation: "list", args: { prefix: "tok" } },
        { slot: "notes", kind: "db", operation: "invoke", args: { operation: "listNotes", parameters: { archived: false } } },
        { slot: "notes", kind: "db", operation: "query", args: { sql: "SELECT id FROM notes LIMIT :limit", parameters: { limit: 2 } } },
        { slot: "cache", kind: "kv", operation: "set", args: { key: "nullable", value: null } },
        { slot: "cache", kind: "kv", operation: "delete", args: { key: "old" } },
        { slot: "cache", kind: "kv", operation: "compareAndSet", args: { key: "counter", expectedRevision: 4, value: 5 } },
        { slot: "credentials", kind: "secretStore", operation: "set", args: { name: "token", value: "secret-value" } },
        { slot: "credentials", kind: "secretStore", operation: "delete", args: { name: "old-token" } },
        { slot: "credentials", kind: "secretStore", operation: "compareAndSet", args: { name: "token", expectedRevision: 2, value: "rotated-value" } },
        { slot: "notes", kind: "db", operation: "execute", args: { sql: "UPDATE notes SET archived = :archived", parameters: { archived: true } } },
      ]);
    } finally {
      (proc as Bun.Subprocess | null)?.kill();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("serializes resource failures without logging request args or secrets", async () => {
    const sentinel = "SENTINEL-PLAINTEXT-TOKEN-41fbe3";
    const rootDir = await mkdtemp(join(tmpdir(), "vibecanvas-icp-resource-error-"));
    const functionPath = join(rootDir, "functions.ts");
    await writeFile(functionPath, `
export default {
  fn: {},
  fx: {},
  tx: {
    "tx.storeSecret": async (portal) => portal.resources.secretStore("credentials").set({
      name: "accessToken",
      value: ${JSON.stringify(sentinel)},
    }),
  },
};
`);

    const icpClientPath = new URL("../src/icp-client.ts", import.meta.url).pathname;
    let proc: Bun.Subprocess | null = null;

    try {
      const gotError = new Promise<Extract<TChildMessage, { type: "error" }>>((resolve, reject) => {
        proc = Bun.spawn([
          process.execPath,
          icpClientPath,
          "--icp-client",
          "--debug",
          "--functionPath",
          functionPath,
        ], {
          cwd: rootDir,
          stdout: "pipe",
          stderr: "pipe",
          ipc(message) {
            const childMessage = message as TChildMessage;
            if (childMessage.type === "ready") {
              proc?.send({
                type: "run",
                id: 91,
                func: ["tx.storeSecret"],
                payload: {},
                data: {},
              });
              return;
            }
            if (childMessage.type === "resourceCall") {
              expect(childMessage.args).toEqual({ name: "accessToken", value: sentinel });
              proc?.send({
                type: "resourceResult",
                callId: childMessage.callId,
                ok: false,
                error: {
                  code: "SECRET_OPERATION_FAILED",
                  message: "Secret-store operation failed.",
                  details: { name: "accessToken" },
                },
              });
              return;
            }
            if (childMessage.type === "error") resolve(childMessage);
          },
        });

        void waitForChildExit(proc).then((result) => {
          if (result !== "timeout") reject(new Error(`icp-client exited before resource error assertion: ${result}`));
        });
      });

      const errorMessage = await gotError;
      const activeProc = proc as Bun.Subprocess | null;
      if (!activeProc) throw new Error("icp-client subprocess did not start");
      activeProc.kill();
      await activeProc.exited;
      const stdout = await new Response(activeProc.stdout as ReadableStream<Uint8Array>).text();
      const stderr = await new Response(activeProc.stderr as ReadableStream<Uint8Array>).text();

      expect(errorMessage).toMatchObject({
        type: "error",
        id: 91,
        msg: {
          name: "ActorResourceCallError",
          code: "SECRET_OPERATION_FAILED",
          message: "Secret-store operation failed.",
        },
      });
      expect(JSON.stringify(errorMessage)).not.toContain(sentinel);
      expect(stdout).not.toContain(sentinel);
      expect(stderr).not.toContain(sentinel);
    } finally {
      (proc as Bun.Subprocess | null)?.kill();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("rejects pending resource calls when the parent disconnects", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "vibecanvas-icp-resource-disconnect-"));
    const markerPath = join(rootDir, "disconnect-result.json");
    const functionPath = join(rootDir, "functions.ts");
    await writeFile(functionPath, `
import { writeFile } from "node:fs/promises";

export default {
  fn: {},
  fx: {
    "fx.waitForResource": async (portal) => {
      try {
        await portal.resources.kv("cache").get("waiting");
      } catch (error) {
        await writeFile(${JSON.stringify(markerPath)}, JSON.stringify({ code: error.code, message: error.message }));
      }
    },
  },
  tx: {},
};
`);

    const icpClientPath = new URL("../src/icp-client.ts", import.meta.url).pathname;
    let proc: Bun.Subprocess | null = null;

    try {
      proc = Bun.spawn([
        process.execPath,
        icpClientPath,
        "--icp-client",
        "--functionPath",
        functionPath,
      ], {
        cwd: rootDir,
        stdout: "ignore",
        stderr: "ignore",
        ipc(message) {
          const childMessage = message as TChildMessage;
          if (childMessage.type === "ready") {
            proc?.send({
              type: "run",
              id: 101,
              func: ["fx.waitForResource"],
              payload: {},
              data: {},
            });
            return;
          }
          if (childMessage.type === "resourceCall") proc?.disconnect();
        },
      });

      let marker: string | null = null;
      for (let attempt = 0; attempt < 100 && marker === null; attempt += 1) {
        try {
          marker = await readFile(markerPath, "utf8");
        } catch {
          await Bun.sleep(10);
        }
      }

      expect(marker).not.toBeNull();
      expect(JSON.parse(marker!)).toEqual({
        code: "RESOURCE_CALL_CANCELLED",
        message: "Actor resource call was cancelled because the IPC connection closed.",
      });
      const exitResult = await Promise.race([
        proc.exited,
        Bun.sleep(1000).then(() => "timeout" as const),
      ]);
      expect(exitResult).toBe(0);
    } finally {
      proc?.kill();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
