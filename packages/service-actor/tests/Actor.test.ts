import { describe, expect, test } from "bun:test";
import { dirname } from "node:path"
import type { TVibecanvasJson } from "../src/core/types";
import { Actor } from "../src/Actor";

const rootDir = dirname(new URL(import.meta.url).pathname)
export const testActorConfig = {
    slug: "account-funds-test",
    name: "Account Funds Test",
    actor: {
        relFunctionPath: "./fixtures/fx_account-funds/functions.ts",
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
                    "in.add-funds-with-next-return": {
                        func: ["fn.consumeNextReturn", "tx.addFunds"],
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
            "in.add-funds-with-next-return": {
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

    test("returns next function result over ipc and emits messages", async () => {
        const actor = new Actor({
            rootDir,
            vsJson: testActorConfig
        })
        const messages: any[] = []
        actor.listen((msgName, msgPayload) => {
            messages.push({ msgName, msgPayload })
        })

        await actor.inbox('in.add-funds-with-next-return', {accountId: '1', amount: 42})

        expect(actor.getData()).toEqual({ balance: 42 })
        expect(messages).toEqual([
            {
                msgName: "out",
                msgPayload: { type: "before-next", amount: 42, balance: 0 },
            },
            {
                msgName: "out",
                msgPayload: { type: "after-next", balance: 42 },
            },
        ])

        actor.close()
    })
    // Test actor config and fixtures/fx_account-funds folder are prepared above.
});
