import { describe, expect, test } from "bun:test";
import type { TVibecanvasJson } from "../src/core/types";
import { Actor, type TActorEvent } from "../src/Actor";
import testActorConfigJson from "./fixtures/account-fund-actor/vibecanvas.json";
import bookkeeperActorConfigJson from "./fixtures/account-bookkeeper-actor/vibecanvas.json";
import pingPongActorConfigJson from "./fixtures/ping-pong-actor/vibecanvas.json";

const rootDir = new URL("./fixtures/account-fund-actor", import.meta.url).pathname;
const bookkeeperRootDir = new URL("./fixtures/account-bookkeeper-actor", import.meta.url).pathname;
const pingPongRootDir = new URL("./fixtures/ping-pong-actor", import.meta.url).pathname;
const testActorConfig = testActorConfigJson as TVibecanvasJson;
const bookkeeperActorConfig = bookkeeperActorConfigJson as TVibecanvasJson;
const pingPongActorConfig = pingPongActorConfigJson as TVibecanvasJson;

async function waitForIdle(actor: Actor) {
    for (let index = 0; index < 100; index += 1) {
        if (actor.isIdle()) return
        await Bun.sleep(10)
    }
    throw new Error("Timed out waiting for actor to become idle")
}

describe("Actor", () => {
    test("runs guest functions in child process and updates data", async () => {
        const actor = new Actor({
            id: "fund-actor-1",
            rootDir,
            vsJson: testActorConfig
        })

        actor.start()
        const messageId = actor.inbox('add-funds', {accountId: '1', amount: 100})
        await waitForIdle(actor)

        expect(messageId).toBeString()
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

        actor.start()
        const messageIds = [
            actor.inbox('add-funds', {accountId: '1', amount: 100}),
            actor.inbox('sub-funds', {accountId: '1', amount: 30}),
            actor.inbox('add-funds', {accountId: '1', amount: 5}),
        ]
        await waitForIdle(actor)

        expect(new Set(messageIds).size).toBe(3)
        expect(actor.getData()).toEqual({ balance: 75 })

        actor.close()
    })

    test("returns next function result over ipc and emits messages", async () => {
        const actor = new Actor({
            id: "fund-actor-next-return",
            rootDir,
            vsJson: testActorConfig
        })
        const messages: TActorEvent[] = []
        actor.listen((event) => {
            messages.push(event)
        })

        actor.start()
        actor.inbox('add-funds-with-next-return', {accountId: '1', amount: 42})
        await waitForIdle(actor)

        expect(actor.getData()).toEqual({ balance: 42 })
        expect(messages.filter(event => event.kind === "actor").map(event => ({
            name: event.name,
            payload: event.payload,
        }))).toEqual([
            {
                name: "before-next",
                payload: { amount: 42, balance: 0 },
            },
            {
                name: "funds-added",
                payload: { accountId: "1", amount: 42, balance: 42 },
            },
            {
                name: "after-next",
                payload: { balance: 42 },
            },
        ])
        expect(messages.some(event => event.kind === "system" && event.type === "data.changed")).toBe(true)
        expect(messages.some(event => event.kind === "system" && event.type === "ack")).toBe(true)

        actor.close()
    })

    test("emits validation error for invalid output payload but still acks guest", async () => {
        const actor = new Actor({
            id: "fund-actor-invalid-output",
            rootDir,
            vsJson: testActorConfig
        })
        const messages: TActorEvent[] = []
        actor.listen((event) => {
            messages.push(event)
        })

        actor.start()
        actor.inbox('emit-invalid-output', {})
        await waitForIdle(actor)

        const errorEvent = messages.find(event => event.kind === "system" && event.type === "error")
        expect(errorEvent?.kind).toBe("system")
        expect(errorEvent?.type).toBe("error")
        expect(errorEvent?.code).toBe("INVALID_OUTPUT_MESSAGE_PAYLOAD")

        actor.close()
    })

    test("applies valid target state changes after transitions", async () => {
        const actor = new Actor({
            id: "ping-pong-actor",
            rootDir: pingPongRootDir,
            vsJson: pingPongActorConfig
        })

        expect(actor.getState()).toBe("ready.ping")

        actor.start()
        actor.inbox("hit", {})
        await waitForIdle(actor)

        expect(actor.getState()).toBe("ready.pong")
        expect(actor.getData()).toEqual({ count: 1 })

        actor.inbox("hit", {})
        await waitForIdle(actor)

        expect(actor.getState()).toBe("ready.ping")
        expect(actor.getData()).toEqual({ count: 2 })

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

        fundActor.start()
        bookkeeperActor.start()

        const routedMessages: string[] = []
        fundActor.listen((event) => {
            if (event.kind === "actor" && event.name === "funds-added") {
                routedMessages.push(bookkeeperActor.inbox(event.name, event.payload))
            }
        })

        fundActor.inbox('add-funds', {accountId: '1', amount: 100})
        await waitForIdle(fundActor)
        await waitForIdle(bookkeeperActor)

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
