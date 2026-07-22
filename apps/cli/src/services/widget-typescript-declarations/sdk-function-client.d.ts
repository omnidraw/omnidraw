/** @file Browser-side transport contract and generated server-function proxy primitive. */
export type TServerFunctionClientRequest = Readonly<{
    functionName: string;
    input: unknown;
    idempotencyKey: string;
}>;
export interface IServerFunctionClientTransport {
    createIdempotencyKey(): string;
    invoke<TOutput = unknown>(request: TServerFunctionClientRequest): Promise<TOutput>;
}
export type TServerFunctionClient<TInput, TOutput> = (input: TInput) => Promise<TOutput>;
export type TServerFunctionClientOf<TFunction> = TFunction extends (input: infer TInput) => Promise<infer TOutput> ? TServerFunctionClient<TInput, TOutput> : never;
export declare const SERVER_FUNCTION_TRANSPORT_GLOBAL_KEY: '__VIBECANVAS_SERVER_FUNCTION_TRANSPORT_V1__';
export declare function __setServerFunctionTransport(transport: IServerFunctionClientTransport | null): void;
export declare function createServerFunctionProxy<TInput, TOutput>(functionName: string, transport?: IServerFunctionClientTransport): TServerFunctionClient<TInput, TOutput>;
