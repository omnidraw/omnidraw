import type { TActorRuntimeState, TMessageMap, TVibecanvasJsonValue } from './shared';
export { __setServerFunctionTransport, createServerFunctionProxy, SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY, } from './function-client';
export { __setCollaborativeStateTransport, changeCollaborativeState, COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY, getCollaborativeState, subscribeCollaborativeState, } from './collaborative-state-client';
export type { ICollaborativeStateTransport, TCollaborativeStateSnapshot, } from './collaborative-state-client';
export type { IServerFunctionClientTransport, TServerFunctionClient, TServerFunctionClientOf, TServerFunctionClientRequest, } from './function-client';
export type { TWidgetManifestV2, TWidgetServerManifest, TWidgetUiManifest, } from '@vibecanvas/widget-contract';
export type TWidgetActor<TContext = TVibecanvasJsonValue, TInput extends TMessageMap = TMessageMap> = {
    /** Arrow-reactive actor machine state. Use as `${() => actor.state.value}`. */
    readonly state: {
        value: TActorRuntimeState;
    };
    /** Arrow-reactive actor context/data. Use as `${() => actor.context.value}`. */
    readonly context: {
        value: TContext;
    };
    /** Send an input message to this widget's own actor. */
    sendMessage<TName extends keyof TInput & string>(name: TName, payload: TInput[TName]): Promise<void>;
};
type TSendMessage = (name: string, payload: TVibecanvasJsonValue) => Promise<void>;
export declare const actor: TWidgetActor;
export declare function __setActorSnapshot(snapshot: {
    state: TActorRuntimeState;
    context: TVibecanvasJsonValue;
}): void;
export declare function __setSendMessage(fn: TSendMessage): void;
export type { TActorRuntimeState, TMessageMap, TVibecanvasJsonValue } from './shared';
