/**
 * Private, transport-neutral procedure declarations.
 *
 * This deliberately contains only the small amount of structure the backend
 * needs to keep input/output validation next to each handler.  The wire
 * protocol and lifecycle are owned by the Effect RPC shell.
 */

const STREAM_TYPE = Symbol.for('omnidraw/private-procedure-stream');
const HANDLER_TYPE = Symbol.for('omnidraw/private-procedure-handler');

type TSchemaLike = Readonly<{
  decode?: (input: unknown) => unknown;
  parse?: (input: unknown) => unknown;
  safeParse?: (input: unknown) => Readonly<{
    success: boolean;
    data?: unknown;
    error?: unknown;
  }>;
}>;

const STATUS_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  ALREADY_EXISTS: 409,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RESOURCE_EXHAUSTED: 429,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

/** Stable private error shape shared by HTTP and RPC adapters. */
export class ProcedureError<Code extends string = string, Data = unknown> extends Error {
  readonly code: Code;
  readonly status: number;
  readonly data: Data;

  constructor(
    code: Code,
    options: Readonly<{
      message?: string;
      status?: number;
      data?: Data;
      cause?: unknown;
    }> = {},
  ) {
    super(options.message ?? code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProcedureError';
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code] ?? 500;
    this.data = options.data as Data;
  }
}

type TStreamMarker<TSchema> = Readonly<{
  readonly [STREAM_TYPE]: true;
  readonly schema: TSchema;
}>;

type TSchemaInput<TSchema> =
  TSchema extends { readonly _zod: { readonly output: infer Value } } ? Value
      : TSchema extends { readonly _input: infer Value } ? Value
        : TSchema extends { decode(input: unknown): infer Value } ? Value
        : TSchema extends { parse(input: unknown): infer Value } ? Value
        : unknown;

type TSchemaOutput<TSchema> =
  TSchema extends TStreamMarker<infer ItemSchema> ? TSchemaOutput<ItemSchema>
    : TSchema extends { readonly _zod: { readonly output: infer Value } } ? Value
        : TSchema extends { readonly _output: infer Value } ? Value
          : TSchema extends { decode(input: unknown): infer Value } ? Value
          : TSchema extends { parse(input: unknown): infer Value } ? Value
          : unknown;

export class PrivateProcedureContract<
  Input = void,
  Output = unknown,
  StreamOutput extends boolean = false,
> {
  readonly inputSchema?: TSchemaLike;
  readonly outputSchema?: TSchemaLike;
  readonly streamOutput: StreamOutput;
  readonly routeMetadata?: Readonly<Record<string, unknown>>;

  constructor(args: Readonly<{
    inputSchema?: TSchemaLike;
    outputSchema?: TSchemaLike;
    streamOutput?: StreamOutput;
    routeMetadata?: Readonly<Record<string, unknown>>;
  }> = {}) {
    this.inputSchema = args.inputSchema;
    this.outputSchema = args.outputSchema;
    this.streamOutput = (args.streamOutput ?? false) as StreamOutput;
    this.routeMetadata = args.routeMetadata;
  }

  input<TSchema>(schema: TSchema): PrivateProcedureContract<TSchemaInput<TSchema>, Output, false> {
    return new PrivateProcedureContract({
      inputSchema: schema as TSchemaLike,
      outputSchema: this.outputSchema,
      routeMetadata: this.routeMetadata,
      streamOutput: false,
    });
  }

  output<TSchema>(schema: TSchema): PrivateProcedureContract<
    Input,
    TSchemaOutput<TSchema>,
    TSchema extends TStreamMarker<unknown> ? true : false
  > {
    const stream = isStreamMarker(schema);
    return new PrivateProcedureContract({
      inputSchema: this.inputSchema,
      outputSchema: (stream ? schema.schema : schema) as TSchemaLike,
      routeMetadata: this.routeMetadata,
      streamOutput: stream,
    }) as PrivateProcedureContract<
      Input,
      TSchemaOutput<TSchema>,
      TSchema extends TStreamMarker<unknown> ? true : false
    >;
  }

  route(metadata: Readonly<Record<string, unknown>>): PrivateProcedureContract<Input, Output, StreamOutput> {
    return new PrivateProcedureContract({
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      routeMetadata: metadata,
      streamOutput: this.streamOutput,
    });
  }

  router<const Routes extends Readonly<Record<string, unknown>>>(routes: Routes): Routes {
    return routes;
  }

  errors(_errors: Readonly<Record<string, unknown>>): PrivateProcedureContract<Input, Output, StreamOutput> {
    return this;
  }
}

export type TPrivateHandlerArgs<Input, Context> = Readonly<{
  context: Context;
  input: Input;
  signal: AbortSignal;
}>;

type TPrivateHandlerResult<Output, StreamOutput extends boolean> =
  StreamOutput extends true
    ? AsyncIterable<Output> | Promise<AsyncIterable<Output>>
    : Output | Promise<Output>;

export type TPrivateHandler<Input, Output, Context, StreamOutput extends boolean> = (
  args: TPrivateHandlerArgs<Input, Context>,
) => TPrivateHandlerResult<Output, StreamOutput>;

export class PrivateProcedure<
  Input = unknown,
  Output = unknown,
  Context = unknown,
  StreamOutput extends boolean = boolean,
> {
  readonly [HANDLER_TYPE] = true;
  readonly contract: PrivateProcedureContract<Input, Output, StreamOutput>;
  readonly handler: TPrivateHandler<Input, Output, Context, StreamOutput>;

  constructor(
    contract: PrivateProcedureContract<Input, Output, StreamOutput>,
    handler: TPrivateHandler<Input, Output, Context, StreamOutput>,
  ) {
    this.contract = contract;
    this.handler = handler;
  }

  /** Direct in-process edge used by backend tests and bounded HTTP adapters. */
  callable(args: Readonly<{ context: Context }>): (
    input: Input,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) => Promise<StreamOutput extends true ? AsyncGenerator<Output, void, unknown> : Output> {
    return async (input, options) => {
      let parsedInput: unknown;
      try {
        parsedInput = parseProcedureInput(this, input);
      } catch (cause) {
        throw new ProcedureError('BAD_REQUEST', {
          message: 'Input validation failed',
          cause,
        });
      }
      const signal = options?.signal ?? new AbortController().signal;
      const result = await this.handler({
        context: args.context,
        input: parsedInput,
        signal,
      } as TPrivateHandlerArgs<Input, Context>);
      if (this.contract.streamOutput) {
        return validateAsyncIterable(this, result as AsyncIterable<unknown>) as never;
      }
      return parseProcedureOutput(this, result) as never;
    };
  }
}

type THandlerBuilder<Contract, Context> =
  Contract extends PrivateProcedureContract<infer Input, infer Output, infer StreamOutput>
    ? Readonly<{
        handler: (
          handler: TPrivateHandler<Input, Output, Context, StreamOutput>,
        ) => PrivateProcedure<Input, Output, Context, StreamOutput>;
      }>
    : Contract extends Readonly<Record<string, unknown>>
      ? { readonly [Key in keyof Contract]: THandlerBuilder<Contract[Key], Context> }
      : never;

type TContextualHandlerBuilder<Contract, Context> = THandlerBuilder<Contract, Context> & Readonly<{
  router: <Handlers>(handlers: Handlers) => Handlers;
}>;

function buildHandlerTree<Contract, Context>(contract: Contract): THandlerBuilder<Contract, Context> {
  if (contract instanceof PrivateProcedureContract) {
    return Object.freeze({
      handler: (handler: TPrivateHandler<unknown, unknown, Context, boolean>) => (
        new PrivateProcedure(contract, handler)
      ),
    }) as THandlerBuilder<Contract, Context>;
  }
  const entries = Object.entries(contract as Readonly<Record<string, unknown>>)
    .map(([key, value]) => [key, buildHandlerTree(value)] as const);
  return Object.fromEntries(entries) as unknown as THandlerBuilder<Contract, Context>;
}

export function implement<Contract>(contract: Contract): Readonly<{
  $context: <Context>() => TContextualHandlerBuilder<Contract, Context>;
}> {
  return Object.freeze({
    $context: <Context>() => {
      const tree = buildHandlerTree<Contract, Context>(contract) as TContextualHandlerBuilder<Contract, Context>;
      Object.defineProperty(tree, 'router', {
        configurable: false,
        enumerable: false,
        value: <Handlers>(handlers: Handlers) => handlers,
        writable: false,
      });
      return Object.freeze(tree) as TContextualHandlerBuilder<Contract, Context>;
    },
  }) as Readonly<{
    $context: <Context>() => TContextualHandlerBuilder<Contract, Context>;
  }>;
}

export const pc = new PrivateProcedureContract();

export function eventIterator<TSchema>(schema: TSchema): TStreamMarker<TSchema> {
  return Object.freeze({ [STREAM_TYPE]: true, schema });
}

export function populateProcedureRouterPaths<Router>(router: Router): Router {
  return router;
}

export function isPrivateProcedure(value: unknown): value is PrivateProcedure {
  return typeof value === 'object'
    && value !== null
    && HANDLER_TYPE in value;
}

export function isPrivateProcedureContract(value: unknown): value is PrivateProcedureContract {
  return value instanceof PrivateProcedureContract;
}

function isStreamMarker(value: unknown): value is TStreamMarker<unknown> {
  return typeof value === 'object'
    && value !== null
    && STREAM_TYPE in value;
}

function parseWithSchema(schema: TSchemaLike | undefined, input: unknown): unknown {
  if (schema === undefined) return input;
  if (typeof schema.decode === 'function') return schema.decode(input);
  if (typeof schema.parse === 'function') return schema.parse(input);
  if (typeof schema.safeParse === 'function') {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    throw result.error;
  }
  return input;
}

export function parseProcedureInput(procedure: PrivateProcedure<any, any, any, any>, input: unknown): unknown {
  return parseWithSchema(procedure.contract.inputSchema, input);
}

export function parseProcedureOutput(procedure: PrivateProcedure<any, any, any, any>, output: unknown): unknown {
  return parseWithSchema(procedure.contract.outputSchema, output);
}

async function* validateAsyncIterable(
  procedure: PrivateProcedure<any, any, any, any>,
  iterable: AsyncIterable<unknown>,
): AsyncGenerator<unknown> {
  for await (const value of iterable) {
    yield parseProcedureOutput(procedure, value);
  }
}

type TInferProcedureInput<Contract> =
  Contract extends PrivateProcedureContract<infer Input, unknown, boolean> ? Input
    : Contract extends Readonly<Record<string, unknown>>
      ? { readonly [Key in keyof Contract]: TInferProcedureInput<Contract[Key]> }
      : never;

type TInferProcedureOutput<Contract> =
  Contract extends PrivateProcedureContract<unknown, infer Output, boolean> ? Output
    : Contract extends Readonly<Record<string, unknown>>
      ? { readonly [Key in keyof Contract]: TInferProcedureOutput<Contract[Key]> }
      : never;

export type InferProcedureRouterInputs<Contract> = TInferProcedureInput<Contract>;
export type InferProcedureRouterOutputs<Contract> = TInferProcedureOutput<Contract>;
