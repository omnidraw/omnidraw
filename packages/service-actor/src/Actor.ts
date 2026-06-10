import type { TActorState } from "./core/types";


interface IPublicMethods {
    inbox(msg: any): Promise<void>;
    getState(): Promise<TActorState>;
    listen(cb: Function): void;
}

interface IActorConfig {
    state: TActorState
}

export class Actor {
    #state: TActorState;

    constructor(config: IActorConfig) {
        this.#state = config.state
    }

}