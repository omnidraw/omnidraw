import { describe, expect, test } from "bun:test";

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
});
