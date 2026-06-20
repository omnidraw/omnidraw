import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { join } from "node:path";
import type { TActorState, TInputMessage, TTransition, TJsonSchema, TVibecanvasJson } from "./core/types";

interface IActorConfig {
    vsJson: TVibecanvasJson
    rootDir: string
}

type TInboxQueueItem = {
    readonly msgName: TInputMessage;
    readonly msgPayload: any;
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
}

type TActorChildMessage =
    | { type: "next"; id: number }
    | { type: "setData"; id: number; data: Record<string, any> }
    | { type: "emitMessage"; id: number; msg: any }
    | { type: "done"; id: number }
    | { type: "error"; id?: number; msg: any }
    | { error: boolean; msg: any };

type TPendingRun = {
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
 * In memory state. Receives msgs and does state transitions
 */
export class Actor {
    #state: TActorState;
    #functionPath: string;
    #rootDir: string;
    #vsJson: TVibecanvasJson
    #inputMessage: Record<string, ValidateFunction<unknown>> = {}
    #outputMessage: Record<string, ValidateFunction<unknown>> = {}
    #data: Record<string, any>
    #proc: Bun.Subprocess | null = null;
    #queue: TInboxQueueItem[] = [];
    #isProcessing = false;
    #nextRunId = 1;
    #pendingRuns = new Map<number, TPendingRun>();
    #listeners = new Set<(msgName: string, msgPayload: any) => void>();

    constructor(config: IActorConfig) {
        this.#state = config.vsJson.actor.initialState
        this.#vsJson = config.vsJson
        this.#data = config.vsJson.actor.initialData
        Object.entries(config.vsJson.actor.inputMsgSchema ?? {}).forEach(([name, schema]) => {
            this.#inputMessage[name] = compileJsonSchema(schema)
        })
        Object.entries(config.vsJson.actor.outputMsgSchema ?? {}).forEach(([name, schema]) => {
            this.#outputMessage[name] = compileJsonSchema(schema)
        })
        this.#rootDir = config.rootDir
        this.#functionPath = join(config.rootDir, this.#vsJson.actor.relFunctionPath)
        this.actorFuncions()
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

    getState() {
        return this.#state
    }

    getData() {
        return this.#data
    }

    inbox(msgName: string, msgPayload: any): Promise<void> {
        const validFn = this.#inputMessage[msgName]
        if (!validFn)
            return Promise.reject(this.emitMessage('error', `Unknown message name ${msgName}. Allowed message name: ${JSON.stringify(Object.keys(this.#inputMessage))}`))
        if (!validFn(msgPayload))
            return Promise.reject(this.emitMessage('error', `Invalid message payload.`))

        const transition = this.#getTransition(msgName as TInputMessage);
        if (!transition) {
            return Promise.reject(this.emitMessage('error', `No transition for message ${msgName} in state ${this.#state}`))
        }

        return new Promise((resolve, reject) => {
            this.#queue.push({
                msgName: msgName as TInputMessage,
                msgPayload,
                resolve,
                reject,
            })
            this.#processQueue()
        })
    }

    listen(cb: (msgName: string, msgPayload: any) => void) {
        this.#listeners.add(cb)
        return () => this.#listeners.delete(cb)
    }

    close() {
        this.#proc?.kill()
        this.#proc = null
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
            await this.#runTransition(transition, item.msgPayload)
            item.resolve()
        } catch (error) {
            item.reject(error)
        } finally {
            this.#isProcessing = false;
            this.#processQueue()
        }
    }

    #runTransition(transition: TTransition, msgPayload: any): Promise<void> {
        const proc = this.#proc;
        if (!proc) return Promise.reject(new Error("Actor child process is not running"));

        const id = this.#nextRunId++;
        return new Promise((resolve, reject) => {
            this.#pendingRuns.set(id, { resolve, reject })
            proc.send({
                type: "run",
                id,
                func: transition.func,
                payload: msgPayload,
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
            this.#proc?.send({ type: "ack", id: message.id, action: "setData" })
            return;
        }

        if (message.type === "emitMessage") {
            this.#emitGuestMessage(message.msg)
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

    #emitGuestMessage(msg: any) {
        if (!msg || typeof msg !== "object" || typeof msg.type !== "string" || !("payload" in msg)) {
            this.emitMessage("error", {
                code: "INVALID_OUTPUT_MESSAGE_SHAPE",
                message: "Output message must be an object with { type, payload }.",
                value: msg,
            })
            return;
        }

        this.emitMessage(msg.type, msg.payload)
    }

    private emitMessage(msgName: string, msgPayload: any) {
        if (msgName === 'error') {
            const msg = `Error in Actor: ${this.#vsJson.name}\n${JSON.stringify(msgPayload)}`
            console.error(msg)
            for (const listener of this.#listeners) {
                listener(msgName, msgPayload)
            }
            return new Error(msg)
        }

        const validFn = this.#outputMessage[msgName]
        if (!validFn) {
            return this.emitMessage("error", {
                code: "UNKNOWN_OUTPUT_MESSAGE",
                message: `Unknown output message name ${msgName}. Allowed message name: ${JSON.stringify(Object.keys(this.#outputMessage))}`,
                outputMessageName: msgName,
                payload: msgPayload,
            })
        }

        if (!validFn(msgPayload)) {
            return this.emitMessage("error", {
                code: "INVALID_OUTPUT_MESSAGE_PAYLOAD",
                message: `Invalid output message payload for ${msgName}.`,
                outputMessageName: msgName,
                payload: msgPayload,
                validationErrors: validFn.errors,
            })
        }

        for (const listener of this.#listeners) {
            listener(msgName, msgPayload)
        }
    }

}
