/**
 * @file Runs one in-memory widget actor instance through a Bun child process, validating inbox and output messages around guest transitions.
 * @remarks Actor is the per-instance runtime used by the supervisor; it owns current state/data, serializes inbox processing, and communicates with `icp-client.ts` over IPC instead of importing guest functions directly.
 */

import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { join } from "node:path";
import type { TActorData, TActorState, TInputMessage, TTransition, TJsonSchema, TVibecanvasJson } from "./core/types";
import type { TActorStatus } from "@vibecanvas/service-db/model";

export type TActorSystemEvent =
    | { readonly kind: "system"; readonly actorId: string; readonly type: "ack"; readonly messageId: string; readonly inputName: string }
    | { readonly kind: "system"; readonly actorId: string; readonly type: "state.changed"; readonly from: TActorState; readonly to: TActorState; readonly messageId?: string }
    | { readonly kind: "system"; readonly actorId: string; readonly type: "status.changed"; readonly from: TActorStatus | null; readonly to: TActorStatus }
    | { readonly kind: "system"; readonly actorId: string; readonly type: "data.changed"; readonly data: TActorData; readonly messageId?: string }
    | { readonly kind: "system"; readonly actorId: string; readonly type: "error"; readonly code: string; readonly message: string; readonly details?: unknown; readonly messageId?: string };

export type TActorMessageEvent = {
    readonly kind: "actor";
    readonly actorId: string;
    readonly name: string;
    readonly payload: unknown;
    readonly messageId?: string;
};

export type TActorEvent = TActorSystemEvent | TActorMessageEvent;

type TActorSystemEventInput =
    | Omit<Extract<TActorSystemEvent, { type: "ack" }>, "kind" | "actorId">
    | Omit<Extract<TActorSystemEvent, { type: "state.changed" }>, "kind" | "actorId">
    | Omit<Extract<TActorSystemEvent, { type: "status.changed" }>, "kind" | "actorId">
    | Omit<Extract<TActorSystemEvent, { type: "data.changed" }>, "kind" | "actorId">
    | Omit<Extract<TActorSystemEvent, { type: "error" }>, "kind" | "actorId">;

interface IActorConfig {
    readonly id: string
    readonly vsJson: TVibecanvasJson
    readonly rootDir: string
    readonly state?: TActorState
    readonly data?: TActorData
}

type TInboxQueueItem = {
    readonly messageId: string;
    readonly msgName: TInputMessage;
    readonly msgPayload: any;
}

type TActorChildMessage =
    | { type: "next"; id: number }
    | { type: "setData"; id: number; data: TActorData }
    | { type: "emitMessage"; id: number; msg: any }
    | { type: "done"; id: number }
    | { type: "error"; id?: number; msg: any }
    | { error: boolean; id?: number; msg: any };

type TPendingRun = {
    readonly messageId: string;
    readonly inputName: string;
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
}

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

export function compileJsonSchema(schema: TJsonSchema) {
    return ajv.compile(schema as object);
}

/**
 * Actor Instance
 *
 * In-memory widget actor runtime. Receives input messages, runs transition
 * functions in a Bun child process, owns current state/data, and emits runtime
 * events.
 *
 * Usage modes:
 * - Published mode: owned by ActorSupervisor. Database rows, installed widget
 *   records, and canvas connections are managed outside this class.
 * - Draft mode: owned by AgentService for a wizard session. Draft files provide
 *   the manifest/root directory, and the actor is disposed with the session.
 *
 * Keep this constructor/runtime generic: no DB, supervisor, canvas, or wizard
 * concepts should be added here.
 */
export class Actor {
    readonly #id: string;
    #state: TActorState;
    readonly #functionPath: string;
    readonly #rootDir: string;
    readonly #vsJson: TVibecanvasJson
    #inputMessage: Record<string, ValidateFunction<unknown>> = {}
    #outputMessage: Record<string, ValidateFunction<unknown>> = {}
    #data: TActorData
    #proc: Bun.Subprocess | null = null;
    #queue: TInboxQueueItem[] = [];
    #isProcessing = false;
    #nextRunId = 1;
    #pendingRuns = new Map<number, TPendingRun>();
    #listeners = new Set<(event: TActorEvent) => void>();
    #errorTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(config: IActorConfig) {
        this.#id = config.id
        this.#state = config.state ?? config.vsJson.actor.initialState
        this.#vsJson = config.vsJson
        this.#data = config.data ?? config.vsJson.actor.initialData
        Object.entries(config.vsJson.actor.inputMsgSchema ?? {}).forEach(([name, schema]) => {
            this.#inputMessage[name] = compileJsonSchema(schema)
        })
        Object.entries(config.vsJson.actor.outputMsgSchema ?? {}).forEach(([name, schema]) => {
            this.#outputMessage[name] = compileJsonSchema(schema)
        })
        this.#rootDir = config.rootDir
        this.#functionPath = join(config.rootDir, this.#vsJson.actor.relFunctionPath)
    }

    start() {
        if (this.#proc) return;
        this.actorFuncions()
        this.#emitSystemEvent({ type: "status.changed", from: null, to: "running" })
        this.#emitSystemEvent({ type: "state.changed", from: 'booting', to: this.#state })
        this.#scheduleErrorTimeoutIfNeeded()
        this.#processQueue()
    }

    private actorFuncions() {
        const icpClientPath = new URL('icp-client.ts', import.meta.url).pathname
        const proc = Bun.spawn(["bun", "run", icpClientPath, "--functionPath", this.#functionPath], {
            cwd: this.#rootDir,
            env: { ...process.env },
            stdout: "pipe",
            stderr: "pipe",
            ipc: (message) => {
                this.#handleChildMessage(message as TActorChildMessage)
            },
        });
        this.#proc = proc;

        proc.stdout?.pipeTo(new WritableStream({
            write(chunk) {
                process.stdout.write(chunk)
            },
        }))

        proc.stderr?.pipeTo(new WritableStream({
            write(chunk) {
                process.stderr.write(chunk)
            },
        }))
    }

    getId() {
        return this.#id
    }

    getState() {
        return this.#state
    }

    getData() {
        return this.#data
    }

    isIdle() {
        return !this.#isProcessing && this.#queue.length === 0 && this.#pendingRuns.size === 0
    }

    inbox(msgName: string, msgPayload: any): string {
        const validFn = this.#inputMessage[msgName]
        if (!validFn) {
            this.#applyImplicitErrorState()
            throw this.#emitError({ code: "UNKNOWN_INPUT_MESSAGE", message: `Unknown message name ${msgName}. Allowed message name: ${JSON.stringify(Object.keys(this.#inputMessage))}` })
        }
        if (!validFn(msgPayload)) {
            this.#applyImplicitErrorState()
            throw this.#emitError({ code: "INVALID_INPUT_MESSAGE_PAYLOAD", message: `Invalid message payload.`, details: validFn.errors })
        }

        const transition = this.#getTransition(msgName as TInputMessage);
        if (!transition) {
            const state = this.#state;
            this.#applyImplicitErrorState()
            throw this.#emitError({ code: "NO_STATE_TRANSITION", message: `No transition for message ${msgName} in state ${state}` })
        }

        const messageId = crypto.randomUUID();
        this.#queue.push({
            messageId,
            msgName: msgName as TInputMessage,
            msgPayload,
        })
        this.#processQueue()
        return messageId
    }

    listen(cb: (event: TActorEvent) => void) {
        this.#listeners.add(cb)
        return () => this.#listeners.delete(cb)
    }

    close() {
        const wasRunning = this.#proc !== null
        this.#clearErrorTimeout()
        this.#proc?.kill()
        this.#proc = null
        if (wasRunning) this.#emitSystemEvent({ type: "status.changed", from: "running", to: "stopped" })
    }

    #getTransition(msgName: TInputMessage): TTransition | null {
        return this.#vsJson.actor.states[this.#state]?.on[msgName] ?? null
    }

    async #processQueue() {
        if (this.#isProcessing) return;
        const item = this.#queue.shift();
        if (!item) return;

        this.#isProcessing = true;
        try {
            const transition = this.#getTransition(item.msgName);
            if (!transition) {
                throw new Error(`No transition for message ${item.msgName} in state ${this.#state}`)
            }
            await this.#runTransition(transition, item)
            this.#applyTransitionTargetState(transition, item.messageId)
            this.#emitSystemEvent({ type: "ack", messageId: item.messageId, inputName: item.msgName })
        } catch (error) {
            this.#applyImplicitErrorState(item.messageId)
            this.#emitError({
                code: 'ACTOR_TRANSITION_FAILED',
                messageId: item.messageId,
                message: error instanceof Error ? error.message : String(error),
            })
        } finally {
            this.#isProcessing = false;
            this.#processQueue()
        }
    }

    #applyTransitionTargetState(transition: TTransition, messageId: string) {
        if (transition.allowedTargetStates.length !== 1) return;
        const nextState = transition.allowedTargetStates[0];
        if (nextState === this.#state) return;
        const prevState = this.#state;
        this.#state = nextState;
        this.#emitSystemEvent({ type: "state.changed", from: prevState, to: nextState, messageId })
        this.#scheduleErrorTimeoutIfNeeded()
    }

    #applyImplicitErrorState(messageId?: string) {
        if (this.#state === "error") return;
        const prevState = this.#state;
        this.#state = "error";
        this.#emitSystemEvent({ type: "state.changed", from: prevState, to: "error", messageId })
        this.#scheduleErrorTimeoutIfNeeded()
    }

    #scheduleErrorTimeoutIfNeeded() {
        this.#clearErrorTimeout()
        if (this.#state !== "error") return;

        const timeout = this.#getErrorTimeoutMessage()
        if (!timeout) return;

        this.#errorTimeout = setTimeout(() => {
            this.#errorTimeout = null;
            if (this.#state !== "error") return;
            this.#queue.push({
                messageId: crypto.randomUUID(),
                msgName: timeout.msgName,
                msgPayload: {},
            })
            this.#processQueue()
        }, timeout.delayMs)
    }

    #clearErrorTimeout() {
        if (!this.#errorTimeout) return;
        clearTimeout(this.#errorTimeout)
        this.#errorTimeout = null;
    }

    #getErrorTimeoutMessage(): { msgName: TInputMessage; delayMs: number } | null {
        const entries = Object.keys(this.#vsJson.actor.states.error?.on ?? {})
            .map((msgName) => {
                const match = /^timout:(\d+)ms$/.exec(msgName)
                if (!match) return null;
                return { msgName: msgName as TInputMessage, delayMs: Number(match[1]) }
            })
            .filter((item): item is { msgName: TInputMessage; delayMs: number } => item !== null && Number.isFinite(item.delayMs) && item.delayMs >= 0)
            .sort((a, b) => a.delayMs - b.delayMs)

        return entries[0] ?? null;
    }

    #runTransition(transition: TTransition, item: TInboxQueueItem): Promise<void> {
        const proc = this.#proc;
        if (!proc) return Promise.reject(new Error("Actor child process is not running"));

        const id = this.#nextRunId++;
        return new Promise((resolve, reject) => {
            this.#pendingRuns.set(id, { messageId: item.messageId, inputName: item.msgName, resolve, reject })
            proc.send({
                type: "run",
                id,
                func: transition.func,
                payload: item.msgPayload,
                data: this.#data,
            })
        })
    }

    #handleChildMessage(message: TActorChildMessage) {
        if ("error" in message && typeof message.error === "boolean") {
            if (message.error) {
                const id = "id" in message && typeof message.id === "number" ? message.id : undefined;
                this.#rejectPending(id, message.msg)
            }
            return;
        }

        if (!message || typeof message !== "object" || !("type" in message)) return;

        if (message.type === "setData") {
            this.#data = message.data;
            const pending = this.#pendingRuns.get(message.id);
            this.#emitSystemEvent({ type: "data.changed", data: this.#data, messageId: pending?.messageId })
            this.#proc?.send({ type: "ack", id: message.id, action: "setData" })
            return;
        }

        if (message.type === "emitMessage") {
            this.#emitActorMessageFromChild(message.msg, message.id)
            this.#proc?.send({ type: "ack", id: message.id, action: "emitMessage" })
            return;
        }

        if (message.type === "next") {
            this.#proc?.send({ type: "ack", id: message.id, action: "next" })
            return;
        }

        if (message.type === "done") {
            const pending = this.#pendingRuns.get(message.id);
            if (!pending) return;
            this.#pendingRuns.delete(message.id);
            pending.resolve();
            return;
        }

        if (message.type === "error") {
            this.#rejectPending(message.id, message.msg)
        }
    }

    #rejectPending(id: number | undefined, error: unknown) {
        if (typeof id !== "number") {
            for (const [runId, pending] of this.#pendingRuns) {
                this.#pendingRuns.delete(runId)
                pending.reject(error)
            }
            return;
        }

        const pending = this.#pendingRuns.get(id);
        if (!pending) return;
        this.#pendingRuns.delete(id);
        pending.reject(error);
    }

    #emitActorMessageFromChild(msg: any, runId: number) {
        const pending = this.#pendingRuns.get(runId);
        if (!msg || typeof msg !== "object" || typeof msg.type !== "string" || !("payload" in msg)) {
            this.#emitError({
                code: "INVALID_OUTPUT_MESSAGE_SHAPE",
                message: "Output message must be an object with { type, payload }.",
                details: { value: msg },
                messageId: pending?.messageId,
            })
            return;
        }

        this.#emitActorMessage(msg.type, msg.payload, pending?.messageId)
    }

    #emitActorMessage(msgName: string, msgPayload: any, messageId: string | undefined): Error | undefined {
        const validFn = this.#outputMessage[msgName]
        if (!validFn) {
            return this.#emitError({
                code: "UNKNOWN_OUTPUT_MESSAGE",
                message: `Unknown output message name ${msgName}. Allowed message name: ${JSON.stringify(Object.keys(this.#outputMessage))}`,
                details: { outputMessageName: msgName, payload: msgPayload },
                messageId,
            })
        }

        if (!validFn(msgPayload)) {
            return this.#emitError({
                code: "INVALID_OUTPUT_MESSAGE_PAYLOAD",
                message: `Invalid output message payload for ${msgName}.`,
                details: { outputMessageName: msgName, payload: msgPayload, validationErrors: validFn.errors },
                messageId,
            })
        }

        this.#emitEvent({ kind: "actor", actorId: this.#id, name: msgName, payload: msgPayload, messageId })
    }

    #emitError(args: { code: string; message: string; details?: unknown; messageId?: string }): Error {
        this.#emitSystemEvent({ type: "error", ...args })
        return new Error(`Error in Actor: ${this.#vsJson.name}\n${JSON.stringify(args)}`)
    }

    #emitSystemEvent(event: TActorSystemEventInput) {
        this.#emitEvent({ kind: "system", actorId: this.#id, ...event } as TActorSystemEvent)
    }

    #emitEvent(event: TActorEvent) {
        for (const listener of this.#listeners) {
            listener(event)
        }
    }

}
