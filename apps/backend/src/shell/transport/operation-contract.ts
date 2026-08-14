import { Effect, Schema, Stream } from 'effect';
import { fxConnectAgent } from '../../core/agent/fx.connect';
import { fxReadAgentHistory } from '../../core/agent/fx.history';
import { AgentAuthority, type IAgentAuthority } from '../../core/agent/service.agent';
import { fxCanvasEvents } from '../../core/canvas/fx.events';
import { fxGetCanvasSnapshot } from '../../core/canvas/fx.get-snapshot';
import { fxQueryCanvasItems } from '../../core/canvas/fx.query-items';
import { CanvasAuthority, type ICanvasAuthority } from '../../core/canvas/service.canvas-authority';
import { txExecuteCanvasCommand } from '../../core/canvas/tx.execute-command';
import { fxAgentEventRecords } from '../../core/events/fx.agent-events';
import { fxDbEventRecords } from '../../core/events/fx.db-events';
import { fxNotificationEventRecords } from '../../core/events/fx.notification-events';
import { EventAuthority, type IEventAuthority } from '../../core/events/service.events';
import { txInvokeFunction } from '../../core/functions/tx.invoke';
import { FunctionAuthority, type IFunctionAuthority } from '../../core/functions/service.functions';
import { fxGetResource } from '../../core/resources/fx.get';
import { fxListResources } from '../../core/resources/fx.list';
import { txCreateResource } from '../../core/resources/tx.create';
import {
  ResourceAuthority,
  ResourceProgramError,
  type IResourceAuthority,
} from '../../core/resources/service.resources';
import { fxWidgetStateEvents } from '../../core/widget-state/fx.events';
import { fxGetWidgetState } from '../../core/widget-state/fx.get';
import { txChangeWidgetState } from '../../core/widget-state/tx.change';
import { WidgetStateAuthority, type IWidgetStateAuthority } from '../../core/widget-state/service.widget-state';
import type { TApiContext } from '../api/context';
import { handlers } from '../api/handlers';
import {
  PrivateProcedure,
  ProcedureError,
  parseProcedureInput,
  parseProcedureOutput,
} from '../api/procedure';
import { PrivateWireValue, privateRpcError } from './private-rpc-error';

type TProcedureInput<Procedure> = Procedure extends PrivateProcedure<infer Input, any, any, any>
  ? Input
  : never;
type TProcedurePaths<Tree, StreamOutput extends boolean> = {
  [Key in keyof Tree & string]: Tree[Key] extends PrivateProcedure<any, any, any, infer Stream>
    ? Stream extends StreamOutput ? Key : never
    : Tree[Key] extends Readonly<Record<string, unknown>>
      ? `${Key}.${TProcedurePaths<Tree[Key], StreamOutput>}`
      : never;
}[keyof Tree & string];

export type TPrivateRequestPath = TProcedurePaths<typeof handlers, false>;
export type TPrivateStreamPath = TProcedurePaths<typeof handlers, true>;
export type TPrivateOperationPath = TPrivateRequestPath | TPrivateStreamPath;

type TAssert<T extends true> = T;
type TPathModesAreDisjoint = TAssert<
  [Extract<TPrivateRequestPath, TPrivateStreamPath>] extends [never] ? true : false
>;
void (0 as unknown as TPathModesAreDisjoint);

export type TPrivateOperationRuntime = Readonly<{
  context: TApiContext;
  agent: IAgentAuthority;
  canvas: ICanvasAuthority;
  events: IEventAuthority;
  functions: IFunctionAuthority;
  resources: IResourceAuthority;
  widgetState: IWidgetStateAuthority;
}>;

type TRequestCoreAdapter = (
  input: unknown,
  runtime: TPrivateOperationRuntime,
) => Effect.Effect<unknown, unknown>;
type TStreamCoreAdapter = (
  input: unknown,
  runtime: TPrivateOperationRuntime,
) => Effect.Effect<Stream.Stream<unknown, unknown>, unknown>;

type TIdempotencyMetadata = Readonly<{
  inputKey: 'commandId' | 'operationId';
  frontendReplay: true;
}>;

export type TCursorMetadata = Readonly<{
  inputKey: 'afterSequence' | 'afterRevision' | 'afterGeneration' | 'afterVersion';
}>;

type TPrivateOperationBase = Readonly<{
  path: TPrivateOperationPath;
  procedure: PrivateProcedure;
  errorPolicy: typeof privateRpcError;
  decodeInput(input: unknown): unknown;
  decodeOutput(output: unknown): unknown;
}>;

export type TPrivateOperationContract =
  | TPrivateOperationBase & Readonly<{
      mode: 'request';
      adapter: Readonly<{ kind: 'procedure' }> | Readonly<{ kind: 'core'; run: TRequestCoreAdapter }>;
      idempotency: TIdempotencyMetadata | null;
      cursor: null;
    }>
  | TPrivateOperationBase & Readonly<{
      mode: 'stream';
      adapter: Readonly<{ kind: 'procedure' }> | Readonly<{ kind: 'core'; run: TStreamCoreAdapter }>;
      idempotency: null;
      cursor: TCursorMetadata;
    }>;

function requestAdapter<Procedure extends PrivateProcedure<any, any, any, false>>(
  _procedure: Procedure,
  run: (
    input: TProcedureInput<Procedure>,
    runtime: TPrivateOperationRuntime,
  ) => Effect.Effect<unknown, unknown>,
): TRequestCoreAdapter {
  return (input, runtime) => run(input as TProcedureInput<Procedure>, runtime);
}

function streamAdapter<Procedure extends PrivateProcedure<any, any, any, true>>(
  _procedure: Procedure,
  run: (
    input: TProcedureInput<Procedure>,
    runtime: TPrivateOperationRuntime,
  ) => Effect.Effect<Stream.Stream<unknown, unknown>, unknown>,
): TStreamCoreAdapter {
  return (input, runtime) => run(input as TProcedureInput<Procedure>, runtime);
}

const requestCoreAdapters = Object.freeze({
  'agent.chat.connect': requestAdapter(handlers.agent.chat.connect, (input, runtime) => (
    fxConnectAgent(input).pipe(Effect.provideService(AgentAuthority, runtime.agent))
  )),
  'agent.chat.history': requestAdapter(handlers.agent.chat.history, (input, runtime) => (
    fxReadAgentHistory(input).pipe(Effect.provideService(AgentAuthority, runtime.agent))
  )),
  'canvas.snapshot': requestAdapter(handlers.canvas.snapshot, (input, runtime) => (
    fxGetCanvasSnapshot(input).pipe(Effect.provideService(CanvasAuthority, runtime.canvas))
  )),
  'canvas.query': requestAdapter(handlers.canvas.query, (input, runtime) => (
    fxQueryCanvasItems(input).pipe(Effect.provideService(CanvasAuthority, runtime.canvas))
  )),
  'canvas.execute': requestAdapter(handlers.canvas.execute, (input, runtime) => (
    txExecuteCanvasCommand(input).pipe(Effect.provideService(CanvasAuthority, runtime.canvas))
  )),
  'function.invoke': requestAdapter(handlers.function.invoke, (input, runtime) => (
    txInvokeFunction({
      subject: {
        canvasId: input.canvasId,
        elementId: input.elementId,
        widgetInstanceId: input.widgetInstanceId,
      },
      widgetKey: input.widgetKey,
      catalogGeneration: input.catalogGeneration,
      functionName: input.functionName,
      input: input.input,
    }).pipe(Effect.provideService(FunctionAuthority, runtime.functions))
  )),
  'resource.resources.list': requestAdapter(handlers.resource.resources.list, (input, runtime) => (
    fxListResources(input ?? {}).pipe(Effect.provideService(ResourceAuthority, runtime.resources))
  )),
  'resource.resources.get': requestAdapter(handlers.resource.resources.get, (input, runtime) => (
    fxGetResource(input).pipe(
      Effect.provideService(ResourceAuthority, runtime.resources),
      Effect.flatMap((resource) => resource === null
        ? Effect.fail(new ResourceProgramError('RESOURCE_NOT_FOUND', 'Resource was not found.'))
        : Effect.succeed(resource)),
    )
  )),
  'resource.resources.create': requestAdapter(handlers.resource.resources.create, (input, runtime) => (
    txCreateResource(input).pipe(Effect.provideService(ResourceAuthority, runtime.resources))
  )),
  'widget.runtime.state.get': requestAdapter(handlers.widget.runtime.state.get, (input, runtime) => (
    fxGetWidgetState({ identity: input }).pipe(
      Effect.provideService(WidgetStateAuthority, runtime.widgetState),
    )
  )),
  'widget.runtime.state.change': requestAdapter(handlers.widget.runtime.state.change, (input, runtime) => (
    txChangeWidgetState({
      identity: {
        canvasId: input.canvasId,
        elementId: input.elementId,
        widgetInstanceId: input.widgetInstanceId,
      },
      expectedVersion: input.expectedVersion,
      state: input.state,
    }).pipe(Effect.provideService(WidgetStateAuthority, runtime.widgetState))
  )),
} satisfies Partial<Record<TPrivateRequestPath, TRequestCoreAdapter>>);

const sequenceEvent = <Event>(record: Readonly<{ sequence: number; event: Event }>): Event & { sequence: number } => ({
  ...record.event,
  sequence: record.sequence,
});

const streamCoreAdapters = Object.freeze({
  'agent.events': streamAdapter(handlers.agent.events, (input, runtime) => (
    fxAgentEventRecords(input).pipe(
      Effect.provideService(EventAuthority, runtime.events),
      Effect.map((events) => events.pipe(Stream.map(sequenceEvent))),
    )
  )),
  'canvas.events': streamAdapter(handlers.canvas.events, (input, runtime) => (
    fxCanvasEvents(input).pipe(Effect.provideService(CanvasAuthority, runtime.canvas))
  )),
  'db.events': streamAdapter(handlers.db.events, (input, runtime) => (
    fxDbEventRecords(input).pipe(
      Effect.provideService(EventAuthority, runtime.events),
      Effect.map((events) => events.pipe(Stream.map(sequenceEvent))),
    )
  )),
  'notification.events': streamAdapter(handlers.notification.events, (input, runtime) => (
    fxNotificationEventRecords(input).pipe(
      Effect.provideService(EventAuthority, runtime.events),
      Effect.map((events) => events.pipe(Stream.map(sequenceEvent))),
    )
  )),
  'widget.runtime.state.events': streamAdapter(handlers.widget.runtime.state.events, (input, runtime) => (
    fxWidgetStateEvents({
      identity: {
        canvasId: input.canvasId,
        elementId: input.elementId,
        widgetInstanceId: input.widgetInstanceId,
      },
      ...(input.afterVersion === undefined ? {} : { afterVersion: input.afterVersion }),
    }).pipe(Effect.provideService(WidgetStateAuthority, runtime.widgetState))
  )),
} satisfies Partial<Record<TPrivateStreamPath, TStreamCoreAdapter>>);

const idempotencyByPath = Object.freeze({
  'canvas.execute': Object.freeze({ inputKey: 'commandId', frontendReplay: true }),
  'widget.deletion.commit': Object.freeze({ inputKey: 'operationId', frontendReplay: true }),
} satisfies Partial<Record<TPrivateRequestPath, TIdempotencyMetadata>>);

const cursorByPath = Object.freeze({
  'agent.events': Object.freeze({ inputKey: 'afterSequence' }),
  'canvas.events': Object.freeze({ inputKey: 'afterRevision' }),
  'db.events': Object.freeze({ inputKey: 'afterSequence' }),
  'notification.events': Object.freeze({ inputKey: 'afterSequence' }),
  'widget.catalog.events': Object.freeze({ inputKey: 'afterGeneration' }),
  'widget.runtime.state.events': Object.freeze({ inputKey: 'afterVersion' }),
} satisfies Record<TPrivateStreamPath, TCursorMetadata>);

function procedureEntries(
  tree: Readonly<Record<string, unknown>>,
  prefix = '',
): readonly Readonly<{ path: string; procedure: PrivateProcedure }>[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (value instanceof PrivateProcedure) return [{ path, procedure: value }];
    if (typeof value === 'object' && value !== null) {
      return procedureEntries(value as Readonly<Record<string, unknown>>, path);
    }
    throw new Error(`Private operation '${path}' is not executable.`);
  });
}

const contracts = procedureEntries(handlers).map(({ path: rawPath, procedure }) => {
  const path = rawPath as TPrivateOperationPath;
  const mode = procedure.contract.streamOutput ? 'stream' : 'request';
  const coreAdapter = mode === 'stream'
    ? streamCoreAdapters[path as keyof typeof streamCoreAdapters]
    : requestCoreAdapters[path as keyof typeof requestCoreAdapters];
  const idempotency = mode === 'request'
    ? idempotencyByPath[path as keyof typeof idempotencyByPath] ?? null
    : null;
  const cursor = mode === 'stream'
    ? cursorByPath[path as TPrivateStreamPath]
    : null;
  return [path, Object.freeze({
    path,
    mode,
    procedure,
    adapter: coreAdapter === undefined
      ? Object.freeze({ kind: 'procedure' as const })
      : Object.freeze({ kind: 'core' as const, run: coreAdapter }),
    errorPolicy: privateRpcError,
    idempotency,
    cursor,
    decodeInput: (input: unknown) => parseProcedureInput(procedure, input),
    decodeOutput: (output: unknown) => parseProcedureOutput(procedure, output),
  })] as const;
});

export const PRIVATE_OPERATION_CONTRACTS: ReadonlyMap<TPrivateOperationPath, TPrivateOperationContract> = (
  new Map(contracts) as ReadonlyMap<TPrivateOperationPath, TPrivateOperationContract>
);

/** Serializable projection used to generate and verify the frontend mirror. */
export const PRIVATE_OPERATION_MANIFEST = Object.freeze(contracts.map(([, contract]) => Object.freeze({
  path: contract.path,
  mode: contract.mode,
  adapter: contract.adapter.kind,
  errorPolicy: 'private-rpc-v1' as const,
  idempotencyInputKey: contract.idempotency?.inputKey ?? null,
  cursorInputKey: contract.cursor?.inputKey ?? null,
})));

export const PRIVATE_REQUEST_PATHS = Object.freeze(
  contracts.filter(([, contract]) => contract.mode === 'request').map(([path]) => path as TPrivateRequestPath),
);
export const PRIVATE_STREAM_PATHS = Object.freeze(
  contracts.filter(([, contract]) => contract.mode === 'stream').map(([path]) => path as TPrivateStreamPath),
);

export const PrivateRequestPath = Schema.Literals(PRIVATE_REQUEST_PATHS);
export const PrivateStreamPath = Schema.Literals(PRIVATE_STREAM_PATHS);
export { PrivateWireValue };

export function privateOperationContract(path: string): TPrivateOperationContract | null {
  return PRIVATE_OPERATION_CONTRACTS.get(path as TPrivateOperationPath) ?? null;
}

export function applyOperationCursor(
  contract: TPrivateOperationContract,
  input: unknown,
  afterCursor: number | undefined,
): unknown {
  if (
    contract.cursor === null
    || afterCursor === undefined
    || typeof input !== 'object'
    || input === null
    || Array.isArray(input)
    || contract.cursor.inputKey in input
  ) return input;
  return { ...input, [contract.cursor.inputKey]: afterCursor };
}

export function assertOperationIdempotency(
  contract: TPrivateOperationContract,
  input: unknown,
  idempotencyKey: string | undefined,
): void {
  if (contract.idempotency === null || idempotencyKey === undefined) return;
  const inputKey = typeof input === 'object' && input !== null
    ? (input as Readonly<Record<string, unknown>>)[contract.idempotency.inputKey]
    : undefined;
  if (inputKey !== idempotencyKey) {
    throw new ProcedureError('BAD_REQUEST', {
      message: `Canvas command idempotency key must equal ${contract.idempotency.inputKey}.`,
    });
  }
}
