import { describe, expect, test } from "bun:test";
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


describe("Actor", () => {
    test("runs guest functions in child process and updates data", async () => {
        const actor = new Actor({
            rootDir,
            vsJson: testActorConfig
        })

        await actor.inbox('in.add-funds', {accountId: '1', amount: 100})

        expect(actor.getData()).toEqual({ balance: 100 })

        actor.close()
    })

    test("queues inbox messages and processes one message at a time", async () => {
        const actor = new Actor({
            rootDir,
            vsJson: testActorConfig
        })

        await Promise.all([
            actor.inbox('in.add-funds', {accountId: '1', amount: 100}),
            actor.inbox('in.sub-funds', {accountId: '1', amount: 30}),
            actor.inbox('in.add-funds', {accountId: '1', amount: 5}),
        ])

        expect(actor.getData()).toEqual({ balance: 75 })

        actor.close()
    })
    // Test actor config and actor-function folder are prepared above.
});
