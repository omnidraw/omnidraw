import { describe } from "bun:test";
import { dirname } from "node:path"
import type { TVibecanvasJson } from "../src/core/types";
import { Actor } from "../src/Actor";

const rootDir = dirname(new URL(import.meta.url).pathname)
export const testActorConfig = {
  slug: "account-funds-test",
  name: "Account Funds Test",
  actor: {
    relFunctionPath: "./actor-function/functions.ts",
    initialState: "ready",
    initialData: {
      balance: 0,
    },
    states: {
      ready: {
        on: {
          "in.add-funds": {
            func: ["fn.checkFunds", "fx.accountCheck", "tx.addFunds"],
            allowedTargetStates: ["ready"],
          },
          "in.sub-funds": {
            func: ["fn.checkFunds", "fx.accountCheck", "tx.subFunds"],
            allowedTargetStates: ["ready"],
          },
        },
      },
    },
    inputMsgSchema: {
      "in.add-funds": {
        type: "object",
        properties: {
          accountId: { type: "string" },
          amount: { type: "number" },
        },
        required: ["accountId", "amount"],
        additionalProperties: false,
      },
      "in.sub-funds": {
        type: "object",
        properties: {
          accountId: { type: "string" },
          amount: { type: "number" },
        },
        required: ["accountId", "amount"],
        additionalProperties: false,
      },
    },
  },
  widget: {
    relWidgetDir: "./widget",
    tool: {
      label: "Account Funds Test",
      behavior: {
        type: "mode",
        mode: "click-create",
      },
    },
  },
} satisfies TVibecanvasJson;



describe("Actor", async () => {
    const actor = new Actor({
        rootDir,
        vsJson: testActorConfig
    })
    await Bun.sleep(1000)
  // Test actor config and actor-function folder are prepared above.
});
