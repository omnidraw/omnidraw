import { describe } from "bun:test";

import type { TVibecanvasJson } from "../src/core/types";

const actorFunctionPath = new URL("./actor-function/functions.ts", import.meta.url).pathname;

export const testActorConfig = {
  slug: "account-funds-test",
  name: "Account Funds Test",
  actor: {
    functionPath: actorFunctionPath,
    initialState: "ready",
    initialData: {
      balance: 0,
    },
    states: {
      ready: {
        func: ["fn.checkFunds", "fx.accountCheck", "tx.addFunds"],
        allowedTargets: ["ready", "error"],
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
    widgetDir: "./widget",
    tool: {
      label: "Account Funds Test",
      behavior: {
        type: "mode",
        mode: "click-create",
      },
    },
  },
} satisfies TVibecanvasJson;

describe("Actor", () => {
  // Test actor config and actor-function folder are prepared above.
});
