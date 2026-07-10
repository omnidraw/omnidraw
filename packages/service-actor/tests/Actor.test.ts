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

async function waitFor(predicate: () => boolean, message: string) {
    for (let index = 0; index < 200; index += 1) {
        if (predicate()) return
        await Bun.sleep(10)
    }
    throw new Error(message)
}

describe("Actor", () => {
    const waitingTimeoutConfig: TVibecanvasJson = {
        ...testActorConfig,
        actor: {
            ...testActorConfig.actor,
            states: {
                ...testActorConfig.actor.states,
                ready: {
                    on: {
                        ...testActorConfig.actor.states.ready?.on,
                        celebrateReady: {
                            func: ["fn.noop"],
                            allowedTargetStates: ["waiting.celebrating"],
                        },
                    },
                },
                "waiting.celebrating": {
                    on: {
                        "timeout:20ms": {
                            func: ["fn.noop"],
                            allowedTargetStates: ["ready"],
                        },
                    },
                },
            },
            inputMsgSchema: {
                ...testActorConfig.actor.inputMsgSchema,
                celebrateReady: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                },
            },
        },
    };

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

    test("sends timeout system message after entering waiting state", async () => {
        const actor = new Actor({
            id: "fund-actor-waiting-timeout-enter",
            rootDir,
            vsJson: waitingTimeoutConfig
        })
        const messages: TActorEvent[] = []
        actor.listen((event) => {
            messages.push(event)
        })

        actor.start()
        actor.inbox("celebrateReady", {})
        await waitForIdle(actor)
        expect(actor.getState()).toBe("waiting.celebrating")

        await Bun.sleep(40)
        await waitForIdle(actor)

        expect(actor.getState()).toBe("ready")
        expect(messages.some(event => event.kind === "system" && event.type === "ack" && event.inputName === "timeout:20ms")).toBe(true)

        actor.close()
    })

    test("schedules state timeout for actors restored in waiting state", async () => {
        const actor = new Actor({
            id: "fund-actor-waiting-timeout-start",
            rootDir,
            vsJson: waitingTimeoutConfig,
            state: "waiting.celebrating",
        })
        const messages: TActorEvent[] = []
        actor.listen((event) => {
            messages.push(event)
        })

        actor.start()
        expect(actor.getState()).toBe("waiting.celebrating")

        await actor.waitUntilReady()

        await Bun.sleep(40)
        await waitForIdle(actor)

        expect(actor.getState()).toBe("ready")
        expect(messages.some(event => event.kind === "system" && event.type === "ack" && event.inputName === "timeout:20ms")).toBe(true)

        actor.close()
    })

    test("drops direct user timeout messages that are not in input schema", async () => {
        const actor = new Actor({
            id: "fund-actor-timeout-user-input",
            rootDir,
            vsJson: waitingTimeoutConfig
        })
        const messages: TActorEvent[] = []
        actor.listen((event) => {
            messages.push(event)
        })
        actor.start()

        const messageId = actor.inbox("timeout:20ms", {})

        expect(messageId).toBeString()
        expect(actor.getState()).toBe("ready")
        expect(messages).toContainEqual({
            kind: "actor",
            actorId: "fund-actor-timeout-user-input",
            name: "DROP_MESSAGE",
            payload: expect.objectContaining({
                inputName: "timeout:20ms",
                code: "UNKNOWN_INPUT_MESSAGE",
            }),
            messageId,
        })

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

    test("drops inbox messages when input validation fails", () => {
        const actor = new Actor({
            id: "fund-actor-invalid-input-error",
            rootDir,
            vsJson: testActorConfig
        })
        const messages: TActorEvent[] = []
        actor.listen((event) => {
            messages.push(event)
        })

        actor.start()

        const messageId = actor.inbox('add-funds', { accountId: '1', amount: 'bad' })
        expect(messageId).toBeString()
        expect(actor.getState()).toBe("ready")
        expect(messages.some(event => event.kind === "system" && event.type === "state.changed" && event.to === "error")).toBe(false)
        expect(messages.some(event => event.kind === "system" && event.type === "error" && event.messageId === messageId)).toBe(false)
        expect(messages).toContainEqual({
            kind: "actor",
            actorId: "fund-actor-invalid-input-error",
            name: "DROP_MESSAGE",
            payload: expect.objectContaining({
                inputName: "add-funds",
                inputPayload: { accountId: "1", amount: "bad" },
                code: "INVALID_INPUT_MESSAGE_PAYLOAD",
            }),
            messageId,
        })

        actor.close()
    })

    test("drops inbox messages when current state has no transition", () => {
        const noTransitionConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialState: "waiting",
                states: {
                    ...testActorConfig.actor.states,
                    waiting: { on: {} },
                },
            },
        }
        const actor = new Actor({
            id: "fund-actor-no-transition-drop",
            rootDir,
            vsJson: noTransitionConfig
        })
        const messages: TActorEvent[] = []
        actor.listen((event) => {
            messages.push(event)
        })

        actor.start()

        const messageId = actor.inbox('add-funds', { accountId: '1', amount: 10 })
        expect(messageId).toBeString()
        expect(actor.getState()).toBe("waiting")
        expect(messages.some(event => event.kind === "system" && event.type === "state.changed" && event.to === "error")).toBe(false)
        expect(messages.some(event => event.kind === "system" && event.type === "error" && event.messageId === messageId)).toBe(false)
        expect(messages).toContainEqual({
            kind: "actor",
            actorId: "fund-actor-no-transition-drop",
            name: "DROP_MESSAGE",
            payload: expect.objectContaining({
                inputName: "add-funds",
                inputPayload: { accountId: "1", amount: 10 },
                code: "NO_STATE_TRANSITION",
                details: { state: "waiting" },
            }),
            messageId,
        })

        actor.close()
    })

    test("moves to implicit base error state when transition function throws", async () => {
        const errorConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                states: {
                    ...testActorConfig.actor.states,
                    ready: {
                        on: {
                            ...testActorConfig.actor.states.ready?.on,
                            explode: {
                                func: ["fn.throw"],
                                allowedTargetStates: ["ready"],
                            },
                        },
                    },
                    error: {
                        on: {},
                    },
                },
                inputMsgSchema: {
                    ...testActorConfig.actor.inputMsgSchema,
                    explode: {
                        type: "object",
                        properties: {},
                        additionalProperties: false,
                    },
                },
            },
        }
        const actor = new Actor({
            id: "fund-actor-error",
            rootDir,
            vsJson: errorConfig
        })
        const messages: TActorEvent[] = []
        actor.listen((event) => {
            messages.push(event)
        })

        actor.start()
        actor.inbox("explode", {})
        await waitForIdle(actor)

        expect(actor.getState()).toBe("error")
        expect(messages).toContainEqual({
            kind: "system",
            actorId: "fund-actor-error",
            type: "state.changed",
            from: "ready",
            to: "error",
            messageId: expect.any(String),
        })
        expect(messages.some(event => event.kind === "system" && event.type === "error" && event.code === "ACTOR_TRANSITION_FAILED")).toBe(true)

        actor.close()
    })

    test("sends timout system message after reaching error state", async () => {
        const timeoutConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                states: {
                    ...testActorConfig.actor.states,
                    ready: {
                        on: {
                            ...testActorConfig.actor.states.ready?.on,
                            explode: {
                                func: ["fn.throw"],
                                allowedTargetStates: ["ready"],
                            },
                        },
                    },
                    error: {
                        on: {
                            "timout:20ms": {
                                func: ["fn.noop"],
                                allowedTargetStates: ["ready"],
                            },
                        },
                    },
                },
                inputMsgSchema: {
                    ...testActorConfig.actor.inputMsgSchema,
                    explode: {
                        type: "object",
                        properties: {},
                        additionalProperties: false,
                    },
                },
            },
        }
        const actor = new Actor({
            id: "fund-actor-error-timeout",
            rootDir,
            vsJson: timeoutConfig
        })
        const messages: TActorEvent[] = []
        actor.listen((event) => {
            messages.push(event)
        })

        actor.start()
        actor.inbox("explode", {})
        await waitForIdle(actor)
        expect(actor.getState()).toBe("error")

        await Bun.sleep(40)
        await waitForIdle(actor)

        expect(actor.getState()).toBe("ready")
        expect(messages.some(event => event.kind === "system" && event.type === "ack" && event.inputName === "timout:20ms")).toBe(true)

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

    test("runs exit, transition, enter, and immediate activity in one serialized lane", async () => {
        const lifecycleConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialData: { events: [], ticks: 0 },
                states: {
                    ready: {
                        onExit: ["tx.record"],
                        on: {
                            start: { func: ["tx.record"], targetState: "busy.counting" },
                        },
                    },
                    "busy.counting": {
                        onEnter: ["tx.record"],
                        onExit: ["tx.record"],
                        activity: {
                            everyMs: 20,
                            runImmediately: true,
                            func: ["tx.activityTick"],
                        },
                        on: {
                            stop: { func: ["fn.noop"], targetState: "ready" },
                        },
                    },
                    error: { on: {} },
                },
                inputMsgSchema: {
                    start: { type: "object", additionalProperties: false },
                    stop: { type: "object", additionalProperties: false },
                },
            },
        }
        const actor = new Actor({ id: "lifecycle-order", rootDir, vsJson: lifecycleConfig })
        const events: TActorEvent[] = []
        actor.listen(event => events.push(event))
        actor.start()
        await actor.waitUntilReady()

        const messageId = actor.inbox("start", {})
        await waitFor(() => (actor.getData() as any).ticks >= 1, "activity did not run")

        expect(actor.getState()).toBe("busy.counting")
        expect(actor.getData()).toMatchObject({
            events: ["lifecycle.exit", "transition", "lifecycle.enter"],
            ticks: expect.any(Number),
        })
        const ackIndex = events.findIndex(event => event.kind === "system" && event.type === "ack" && event.messageId === messageId)
        const enterDataIndex = events.findIndex(event => event.kind === "system" && event.type === "data.changed" && (event.data as any).events?.includes("lifecycle.enter"))
        expect(ackIndex).toBeGreaterThan(enterDataIndex)

        actor.inbox("stop", {})
        await waitFor(() => actor.getState() === "ready" || actor.getState() === "error", "stop transition did not run")
        expect(events.filter(event => event.kind === "system" && event.type === "error")).toEqual([])
        expect(actor.getState()).toBe("ready")
        const ticksAfterStop = (actor.getData() as any).ticks
        await Bun.sleep(60)
        expect((actor.getData() as any).ticks).toBe(ticksAfterStop)
        actor.close()
    })

    test("runs restored-state enter and resumes its activity", async () => {
        const restoredConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialData: { events: [], ticks: 0 },
                states: {
                    "busy.counting": {
                        onEnter: ["tx.record"],
                        activity: { everyMs: 20, runImmediately: true, func: ["tx.activityTick"] },
                        on: {},
                    },
                    error: { on: {} },
                },
            },
        }
        const actor = new Actor({
            id: "restored-activity",
            rootDir,
            vsJson: restoredConfig,
            state: "busy.counting",
            data: { events: [], ticks: 0 },
        })
        actor.start()
        await actor.waitUntilReady()
        await waitFor(() => (actor.getData() as any).ticks >= 1, "restored activity did not run")
        expect((actor.getData() as any).events).toEqual(["lifecycle.enter"])
        actor.close()
    })

    test("activity error handler recovers in place and keeps messages responsive", async () => {
        const recoveryConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialData: { recovered: 0 },
                states: {
                    ready: {
                        on: { start: { func: ["fn.noop"], targetState: "busy.counting" } },
                    },
                    "busy.counting": {
                        activity: {
                            everyMs: 20,
                            runImmediately: true,
                            func: ["fn.throw"],
                            onError: { func: ["tx.recover"], recover: "stay" },
                        },
                        on: { stop: { func: ["fn.noop"], targetState: "ready" } },
                    },
                    error: { on: {} },
                },
                inputMsgSchema: {
                    start: { type: "object", additionalProperties: false },
                    stop: { type: "object", additionalProperties: false },
                },
            },
        }
        const actor = new Actor({ id: "activity-recovery", rootDir, vsJson: recoveryConfig })
        actor.start()
        actor.inbox("start", {})
        await waitFor(() => (actor.getData() as any).recovered >= 1, "activity did not recover")
        actor.inbox("stop", {})
        await waitFor(() => actor.getState() === "ready", "stop was blocked by activity recovery")
        expect(actor.getState()).toBe("ready")
        actor.close()
    })

    test("enter failure can recover by re-entering the target state once", async () => {
        const enterRecoveryConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialData: { events: [], recovered: 0 },
                states: {
                    ready: { on: { start: { func: ["fn.noop"], targetState: "busy.counting" } } },
                    "busy.counting": {
                        onEnter: ["tx.failFirstEnter"],
                        onError: { func: ["tx.recover"], recover: "stay" },
                        on: {},
                    },
                    error: { on: {} },
                },
                inputMsgSchema: { start: { type: "object", additionalProperties: false } },
            },
        }
        const actor = new Actor({ id: "enter-recovery", rootDir, vsJson: enterRecoveryConfig })
        actor.start()
        actor.inbox("start", {})
        await waitForIdle(actor)
        expect(actor.getState()).toBe("busy.counting")
        expect(actor.getData()).toMatchObject({ enterAttempted: true, recovered: 1, events: ["lifecycle.enter"] })
        actor.close()
    })

    test("implicit error transition skips state onExit", async () => {
        const implicitErrorConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialState: "busy.counting",
                initialData: { events: [] },
                states: {
                    "busy.counting": {
                        onExit: ["tx.record"],
                        activity: { everyMs: 20, runImmediately: true, func: ["fn.throw"] },
                        on: {},
                    },
                    error: { onEnter: ["tx.record"], on: {} },
                },
                inputMsgSchema: {},
            },
        }
        const actor = new Actor({ id: "implicit-error-no-exit", rootDir, vsJson: implicitErrorConfig })
        actor.start()
        await actor.waitUntilReady()
        await waitFor(() => actor.getState() === "error", "activity failure did not enter error")
        expect((actor.getData() as any).events).not.toContain("lifecycle.exit")
        actor.close()
    })

    test("onExit failure can recover by reactivating the source state", async () => {
        const exitRecoveryConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialData: { events: [] },
                states: {
                    ready: {
                        onEnter: ["tx.record"],
                        onExit: ["fn.throw"],
                        on: {
                            start: {
                                func: ["fn.noop"],
                                targetState: "busy.counting",
                                onError: { func: ["tx.recoverTransition"], recover: "stay" },
                            },
                        },
                    },
                    "busy.counting": { on: {} },
                    error: { on: {} },
                },
                inputMsgSchema: { start: { type: "object", additionalProperties: false } },
            },
        }
        const actor = new Actor({ id: "exit-recovery", rootDir, vsJson: exitRecoveryConfig })
        const events: TActorEvent[] = []
        actor.listen(event => events.push(event))
        actor.start()
        await actor.waitUntilReady()
        const messageId = actor.inbox("start", {})
        await waitForIdle(actor)

        expect(actor.getState()).toBe("ready")
        expect(actor.getData()).toMatchObject({
            events: ["lifecycle.enter", "lifecycle.enter"],
            recoverySource: "transition",
        })
        expect(events.some(event => event.kind === "system" && event.type === "ack" && event.messageId === messageId)).toBe(true)
        expect(events).toContainEqual(expect.objectContaining({
            kind: "system",
            type: "error",
            details: { phase: "state.exit", recovered: true },
        }))
        actor.close()
    })

    test("activity error can recover to another state and runs normal exit/enter hooks", async () => {
        const targetRecoveryConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialState: "busy.counting",
                initialData: { events: [], recovered: 0 },
                states: {
                    "busy.counting": {
                        onExit: ["tx.record"],
                        activity: {
                            everyMs: 20,
                            runImmediately: true,
                            func: ["fn.throw"],
                            onError: { func: ["tx.recover"], recover: { targetState: "ready" } },
                        },
                        on: {},
                    },
                    ready: { onEnter: ["tx.record"], on: {} },
                    error: { on: {} },
                },
                inputMsgSchema: {},
            },
        }
        const actor = new Actor({ id: "activity-target-recovery", rootDir, vsJson: targetRecoveryConfig })
        actor.start()
        await actor.waitUntilReady()
        await waitFor(() => actor.getState() === "ready", "activity target recovery did not finish")
        expect(actor.getData()).toMatchObject({
            recovered: 1,
            events: ["lifecycle.exit", "lifecycle.enter"],
        })
        actor.close()
    })

    test("error handler failure enters implicit error without recursion", async () => {
        const handlerFailureConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                states: {
                    ready: {
                        on: {
                            explode: {
                                func: ["fn.throw"],
                                targetState: "busy",
                                onError: { func: ["fn.throw"], recover: "stay" },
                            },
                        },
                    },
                    busy: { on: {} },
                    error: { on: {} },
                },
                inputMsgSchema: { explode: { type: "object", additionalProperties: false } },
            },
        }
        const actor = new Actor({ id: "handler-failure", rootDir, vsJson: handlerFailureConfig })
        const events: TActorEvent[] = []
        actor.listen(event => events.push(event))
        actor.start()
        actor.inbox("explode", {})
        await waitForIdle(actor)
        expect(actor.getState()).toBe("error")
        expect(events.filter(event => event.kind === "system" && event.type === "error" && event.code === "ACTOR_ERROR_HANDLER_FAILED")).toHaveLength(1)
        actor.close()
    })

    test("self transition does not restart lifecycle hooks", async () => {
        const selfConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialState: "busy",
                initialData: { events: [] },
                states: {
                    busy: {
                        onEnter: ["tx.record"],
                        onExit: ["tx.record"],
                        on: { refresh: { func: ["fn.noop"], targetState: "busy" } },
                    },
                    error: { on: {} },
                },
                inputMsgSchema: { refresh: { type: "object", additionalProperties: false } },
            },
        }
        const actor = new Actor({ id: "self-lifecycle", rootDir, vsJson: selfConfig })
        actor.start()
        await actor.waitUntilReady()
        actor.inbox("refresh", {})
        await waitForIdle(actor)
        expect((actor.getData() as any).events).toEqual(["lifecycle.enter"])
        actor.close()
    })

    test("drops a queued external message made stale by an earlier state change", async () => {
        const staleConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                states: {
                    ready: { on: { go: { func: ["fn.noop"], targetState: "busy" } } },
                    busy: { on: {} },
                    error: { on: {} },
                },
                inputMsgSchema: { go: { type: "object", additionalProperties: false } },
            },
        }
        const actor = new Actor({ id: "stale-message", rootDir, vsJson: staleConfig })
        const events: TActorEvent[] = []
        actor.listen(event => events.push(event))
        actor.start()
        actor.inbox("go", {})
        const staleMessageId = actor.inbox("go", {})
        await waitForIdle(actor)
        expect(actor.getState()).toBe("busy")
        expect(events).toContainEqual(expect.objectContaining({
            kind: "actor",
            name: "DROP_MESSAGE",
            messageId: staleMessageId,
            payload: expect.objectContaining({ code: "STALE_STATE_MESSAGE" }),
        }))
        expect(events.some(event => event.kind === "system" && event.type === "state.changed" && event.to === "error")).toBe(false)
        actor.close()
    })

    test("passes primitive input payloads through IPC", async () => {
        const primitiveConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                states: {
                    ready: { on: { text: { func: ["fn.noop"], targetState: "ready" } } },
                    error: { on: {} },
                },
                inputMsgSchema: { text: { type: "string" } },
            },
        }
        const actor = new Actor({ id: "primitive-payload", rootDir, vsJson: primitiveConfig })
        const events: TActorEvent[] = []
        actor.listen(event => events.push(event))
        actor.start()
        const messageId = actor.inbox("text", "hello")
        await waitForIdle(actor)
        expect(events.some(event => event.kind === "system" && event.type === "ack" && event.messageId === messageId)).toBe(true)
        actor.close()
    })

    test("runs legacy multi-target functions but preserves their no-state-change behavior", async () => {
        const legacyConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialData: { events: [] },
                states: {
                    ready: {
                        on: {
                            go: {
                                func: ["tx.record"],
                                allowedTargetStates: ["busy", "waiting"],
                            },
                        },
                    },
                    busy: { on: {} },
                    waiting: { on: {} },
                    error: { on: {} },
                },
                inputMsgSchema: { go: { type: "object", additionalProperties: false } },
            },
        }
        const actor = new Actor({ id: "legacy-multi-target", rootDir, vsJson: legacyConfig })
        actor.start()
        actor.inbox("go", {})
        await waitForIdle(actor)
        expect(actor.getState()).toBe("ready")
        expect((actor.getData() as any).events).toEqual(["transition"])
        expect(actor.getDefinitionWarnings()).toHaveLength(1)
        actor.close()
    })

    test("delays the first activity tick when runImmediately is not enabled", async () => {
        const delayedActivityConfig: TVibecanvasJson = {
            ...testActorConfig,
            actor: {
                ...testActorConfig.actor,
                initialState: "busy",
                initialData: { ticks: 0 },
                states: {
                    busy: {
                        activity: { everyMs: 40, func: ["tx.activityTick"] },
                        on: {},
                    },
                    error: { on: {} },
                },
                inputMsgSchema: {},
            },
        }
        const actor = new Actor({ id: "delayed-activity", rootDir, vsJson: delayedActivityConfig })
        actor.start()
        await actor.waitUntilReady()
        expect((actor.getData() as any).ticks).toBe(0)
        await Bun.sleep(20)
        expect((actor.getData() as any).ticks).toBe(0)
        await waitFor(() => (actor.getData() as any).ticks === 1, "delayed activity did not run")
        actor.close()
        await Bun.sleep(60)
        expect((actor.getData() as any).ticks).toBe(1)
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
