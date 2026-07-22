import type { TVibecanvasJsonValue } from './shared';
export type TCollaborativeStateSnapshot<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue> = Readonly<{
    version: number;
    value: TValue;
}>;
export interface ICollaborativeStateTransport {
    get<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(): Promise<TCollaborativeStateSnapshot<TValue>>;
    change<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(value: TValue): Promise<TCollaborativeStateSnapshot<TValue>>;
    next<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(afterVersion: number, waitId: string): Promise<TCollaborativeStateSnapshot<TValue>>;
    cancel(waitId: string): void | Promise<void>;
}
export declare const COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY: '__VIBECANVAS_COLLABORATIVE_STATE_TRANSPORT_V1__';
export declare function __setCollaborativeStateTransport(value: ICollaborativeStateTransport | null): void;
export declare function getCollaborativeState<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(): Promise<TValue>;
export declare function changeCollaborativeState<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(value: TValue): Promise<TValue>;
export declare function subscribeCollaborativeState<TValue extends TVibecanvasJsonValue = TVibecanvasJsonValue>(listener: (value: TValue) => void): () => void;
