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
export type TServerFunctionClientOf<TFunction> = TFunction extends (
  input: infer TInput,
) => Promise<infer TOutput>
  ? TServerFunctionClient<TInput, TOutput>
  : never;

let serverFunctionTransport: IServerFunctionClientTransport | null = null;

export function __setServerFunctionTransport(
  transport: IServerFunctionClientTransport | null,
): void {
  serverFunctionTransport = transport;
}

export function createServerFunctionProxy<TInput, TOutput>(
  functionName: string,
  transport?: IServerFunctionClientTransport,
): TServerFunctionClient<TInput, TOutput> {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(functionName)) {
    throw new TypeError('Server-function proxy name is invalid.');
  }
  return async (input: TInput) => {
    const target = transport ?? serverFunctionTransport;
    if (target === null) {
      throw new Error('The widget server-function transport is not connected.');
    }
    const idempotencyKey = target.createIdempotencyKey();
    if (idempotencyKey.length < 1 || idempotencyKey.length > 200) {
      throw new Error('The widget server-function transport returned an invalid idempotency key.');
    }
    return target.invoke<TOutput>({ functionName, input, idempotencyKey });
  };
}
