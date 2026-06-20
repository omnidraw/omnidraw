import { describe, expect, test } from "bun:test";
import type { TVibecanvasJson } from "../src/core/types";
import { Actor } from "../src/Actor";
import testActorConfigJson from "./fixtures/account-fund-actor/vibecanvas.json";
import bookkeeperActorConfigJson from "./fixtures/account-bookkeeper-actor/vibecanvas.json";

const rootDir = new URL("./fixtures/account-fund-actor", import.meta.url).pathname;
const bookkeeperRootDir = new URL("./fixtures/account-bookkeeper-actor", import.meta.url).pathname;
const testActorConfig = testActorConfigJson as TVibecanvasJson;
const bookkeeperActorConfig = bookkeeperActorConfigJson as TVibecanvasJson;

describe("Actor", () => {
    test("runs guest functions in child process and updates data", async () => {
        const actor = new Actor({
            id: "fund-actor-1",
            rootDir,
            vsJson: testActorConfig
        })

        await actor.inbox('add-funds', {accountId: '1', amount: 100})

        expect(actor.getId()).toBe("fund-actor-1")
        expect(actor.getData()).toEqual({ balance: 100 })

        actor.close()
    })

    test("queues inbox messages and processes one message at a time", async () => {
        const actor = new Actor({
            id: "fund-actor-queue",
            rootDir,
            vsJson: testActorConfig
        })

        await Promise.all([
            actor.inbox('add-funds', {accountId: '1', amount: 100}),
            actor.inbox('sub-funds', {accountId: '1', amount: 30}),
            actor.inbox('add-funds', {accountId: '1', amount: 5}),
        ])

        expect(actor.getData()).toEqual({ balance: 75 })

        actor.close()
    })

    test("returns next function result over ipc and emits messages", async () => {
        const actor = new Actor({
            id: "fund-actor-next-return",
            rootDir,
            vsJson: testActorConfig
        })
        const messages: any[] = []
        actor.listen((msgName, msgPayload) => {
            messages.push({ msgName, msgPayload })
        })

        await actor.inbox('add-funds-with-next-return', {accountId: '1', amount: 42})

        expect(actor.getData()).toEqual({ balance: 42 })
        expect(messages).toEqual([
            {
                msgName: "before-next",
                msgPayload: { amount: 42, balance: 0 },
            },
            {
                msgName: "funds-added",
                msgPayload: { accountId: "1", amount: 42, balance: 42 },
            },
            {
                msgName: "after-next",
                msgPayload: { balance: 42 },
            },
        ])

        actor.close()
    })

    test("emits validation error for invalid output payload but still acks guest", async () => {
        const actor = new Actor({
            id: "fund-actor-invalid-output",
            rootDir,
            vsJson: testActorConfig
        })
        const messages: any[] = []
        actor.listen((msgName, msgPayload) => {
            messages.push({ msgName, msgPayload })
        })

        await actor.inbox('emit-invalid-output', {})

        expect(messages[0].msgName).toBe("error")
        expect(messages[0].msgPayload.code).toBe("INVALID_OUTPUT_MESSAGE_PAYLOAD")

        actor.close()
    })

    test("bookkeeper actor persists funds-added messages emitted by fund actor", async () => {
        const fundActor = new Actor({
            id: "fund-actor-connected-source",
            rootDir,
            vsJson: testActorConfig
        })
        const bookkeeperActor = new Actor({
            id: "bookkeeper-actor-connected-target",
            rootDir: bookkeeperRootDir,
            vsJson: bookkeeperActorConfig
        })

        const routedMessages: Promise<void>[] = []
        fundActor.listen((msgName, msgPayload) => {
            if (msgName === "funds-added") {
                routedMessages.push(bookkeeperActor.inbox(msgName, msgPayload))
            }
        })

        await fundActor.inbox('add-funds', {accountId: '1', amount: 100})
        await Promise.all(routedMessages)

        expect(bookkeeperActor.getData()).toEqual({
            entries: [
                {
                    accountId: "1",
                    amount: 100,
                    balance: 100,
                },
            ],
        })

        fundActor.close()
        bookkeeperActor.close()
    })
});
