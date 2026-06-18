import type { TActorState, TJsonSchema, TVibecanvasJson } from "./core/types";
import * as z from "zod"
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

interface IPublicMethods {
    inbox(msg: any): Promise<void>;
    getState(): Promise<TActorState>;
    listen(cb: Function): void;
}

interface IActorConfig {
    state: TActorState,
    vsJson: TVibecanvasJson
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
    #vsJson: TVibecanvasJson
    #inputMessage: Record<string, ValidateFunction<unknown>> = {}
    #outputMessage: Record<string, ValidateFunction<unknown>> = {}
    #data: any = undefined

    constructor(config: IActorConfig) {
        this.#state = config.state
        this.#vsJson = config.vsJson
        Object.entries(config.vsJson.actor.inputMsgSchema ?? {}).forEach(([name, schema]) => {
            this.#inputMessage[name] = compileJsonSchema(schema)
        })
        Object.entries(config.vsJson.actor.outputMsgSchema ?? {}).forEach(([name, schema]) => {
            this.#outputMessage[name] = compileJsonSchema(schema)
        })
    }

    getState() {
        return this.#state
    }

    inbox(msgName: string, msgPayload: any) {
        const validFn = this.#inputMessage[msgName]
        if(!validFn)
            return this.emitMessage('error', `Unknown message name ${msgName}. Allowed message name: ${JSON.stringify(Object.keys(this.#inputMessage))}`)
        if(!validFn(msgPayload))
            return this.emitMessage('error', `Invalid message payload.`)

        //

    }

    private emitMessage(msgName: string, msgPayload: any) {
        if(msgName === 'error') {
            // allow
            const msg = `Error in Actor: ${this.#vsJson.name}\n${JSON.stringify(msgPayload)}`
            console.error(msg)
        }
    }

}