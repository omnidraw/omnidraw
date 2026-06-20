import { describe, expect, test } from "bun:test";
import type { TVibecanvasJson } from "../src/core/types";
import { Actor } from "../src/Actor";
import testActorConfigJson from "./fixtures/account-fund-actor/vibecanvas.json";

const rootDir = new URL("./fixtures/account-fund-actor", import.meta.url).pathname;
const testActorConfig = testActorConfigJson as TVibecanvasJson;

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
});
