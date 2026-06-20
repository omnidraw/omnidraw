import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { join } from "node:path";
import type { TActorState, TJsonSchema, TVibecanvasJson } from "./core/types";

interface IPublicMethods {
    inbox(msg: any): Promise<void>;
    getState(): Promise<TActorState>;
    listen(cb: Function): void;
}

interface IActorConfig {
    vsJson: TVibecanvasJson
    rootDir: string
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
    #functions: Record<string, any> = {}
    #data: Record<string, any>
    #proc: Bun.Subprocess | null = null;


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
        console.log(this.#rootDir, icpClientPath)
        const proc = Bun.spawn(["bun", "run", icpClientPath, "--functionPath", this.#functionPath], {
            cwd: this.#rootDir, // specify a working directory
            env: { ...process.env }, // specify environment variables
            stdout: "pipe",
            stderr: "pipe",
            onExit(proc, exitCode, signalCode, error) {
                // exit handler
            },
            ipc(message, subprocess) {
                console.log(message)
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

        console.log(proc.pid)
    }

    getState() {
        return this.#state
    }

    inbox(msgName: string, msgPayload: any) {
        const validFn = this.#inputMessage[msgName]
        if (!validFn)
            return this.emitMessage('error', `Unknown message name ${msgName}. Allowed message name: ${JSON.stringify(Object.keys(this.#inputMessage))}`)
        if (!validFn(msgPayload))
            return this.emitMessage('error', `Invalid message payload.`)

        //

    }

    private emitMessage(msgName: string, msgPayload: any) {
        if (msgName === 'error') {
            // allow
            const msg = `Error in Actor: ${this.#vsJson.name}\n${JSON.stringify(msgPayload)}`
            console.error(msg)
        }
    }

}