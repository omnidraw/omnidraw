import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type TChildMessage =
  | { type: "ready" }
  | { type: "setData"; id: number; data: unknown }
  | { type: "emitMessage"; id: number; msg: unknown }
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
});
