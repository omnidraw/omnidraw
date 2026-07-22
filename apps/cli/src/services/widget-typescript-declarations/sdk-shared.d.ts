export type TVibecanvasJsonValue = string | number | boolean | null | TVibecanvasJsonValue[] | {
    [key: string]: TVibecanvasJsonValue | undefined;
};
export type TUnsubscribe = () => void;
export type TSdkError = {
    readonly code: string;
    readonly message: string;
    readonly details?: TVibecanvasJsonValue;
};
