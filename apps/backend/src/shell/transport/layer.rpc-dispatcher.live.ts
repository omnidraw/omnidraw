import {
  PrivateProcedure,
  ProcedureError,
  parseProcedureOutput,
} from '#backend/shell/api';
import type { TApiContext } from '#backend/shell/api/context';
import { Effect, Layer, Schema, Stream } from 'effect';
import type { Json } from 'effect/Schema';
import { CanvasAuthorityError } from '../../core/canvas/errors';
import { AgentServiceError } from '../../core/agent/error.agent-service';
import { fxConnectAgent } from '../../core/agent/fx.connect';
import { fxAgentEvents } from '../../core/agent/fx.events';
import { fxReadAgentHistory } from '../../core/agent/fx.history';
import {
  AgentAuthority,
  AgentProgramError,
  type IAgentAuthority,
} from '../../core/agent/service.agent';
import { fxCanvasEvents } from '../../core/canvas/fx.events';
import { fxGetCanvasSnapshot } from '../../core/canvas/fx.get-snapshot';
import { fxQueryCanvasItems } from '../../core/canvas/fx.query-items';
import {
  CanvasAuthority,
  type ICanvasAuthority,
} from '../../core/canvas/service.canvas-authority';
import { txExecuteCanvasCommand } from '../../core/canvas/tx.execute-command';
import { fxDbEventRecords } from '../../core/events/fx.db-events';
import { fxNotificationEventRecords } from '../../core/events/fx.notification-events';
import {
  EventAuthority,
  EventProgramError,
  type IEventAuthority,
} from '../../core/events/service.events';
import { txInvokeFunction } from '../../core/functions/tx.invoke';
import {
  FunctionAuthority,
  FunctionProgramError,
  type IFunctionAuthority,
} from '../../core/functions/service.functions';
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
import {
  WidgetStateAuthority,
  WidgetStateProgramError,
  type IWidgetStateAuthority,
} from '../../core/widget-state/service.widget-state';
import {
  LiveAgent,
  LiveCanvas,
  LiveDatabase,
  LiveEventPublisher,
  LiveFunctionInvocation,
  LiveHumanResourceSecret,
  LiveResource,
  LiveWidgetCatalog,
  LiveWidgetHostConfiguration,
  LiveWidgetLoadAdmission,
  LiveWidgetPreview,
  LiveWidgetState,
} from '../runtime/service.live-mechanics';
import { PrivateRpcError } from './rpc-contract';
import { RpcDispatcher } from './service.rpc-dispatcher';
import { privateOperationContract } from './operation-contract';

function normalizePath(path: string): readonly string[] {
  const segments = path
    .replace(/^\/+|\/+$/g, '')
    .split(/[./]/u)
    .filter(Boolean);
  return segments[0] === 'api' ? segments.slice(1) : segments;
}

function resolveProcedure(path: string): PrivateProcedure {
  const operation = privateOperationContract(path);
  if (operation === null) {
    throw new ProcedureError('NOT_FOUND', {
      message: `Unknown private procedure '${path}'.`,
    });
  }
  return operation.procedure;
}

function wireJson(value: unknown): Json {
  return Schema.decodeUnknownSync(Schema.Json)(value);
}

function rpcError(error: unknown): PrivateRpcError {
  if (error instanceof PrivateRpcError) return error;
  if (error instanceof AgentServiceError) {
    return new PrivateRpcError({
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
    });
  }
  if (
    error instanceof AgentProgramError
    || error instanceof EventProgramError
    || error instanceof FunctionProgramError
    || error instanceof ResourceProgramError
    || error instanceof WidgetStateProgramError
  ) {
    return new PrivateRpcError({
      code: error.code,
      status: error.code.includes('NOT_FOUND') ? 404
        : error.code.includes('CAPACITY') ? 429
          : error.code.includes('CONFLICT') || error.code.includes('CHANGED') ? 409
            : 500,
      message: error.message,
      details: null,
    });
  }
  if (error instanceof CanvasAuthorityError) {
    const status = error.code === 'NOT_FOUND'
      ? 404
      : error.code === 'INVALID_COMMAND'
        ? 400
        : error.code === 'LIMIT_EXCEEDED'
          ? 413
          : error.code === 'CONFLICT' || error.code === 'STORE_CONFLICT'
            ? 409
            : error.code === 'UNAVAILABLE'
              ? 503
              : 500;
    return new PrivateRpcError({
      code: error.code,
      status,
      message: error.message,
      details: error.details,
    });
  }
  if (error instanceof ProcedureError) {
    return new PrivateRpcError({
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.data ?? null,
    });
  }
  return new PrivateRpcError({
    code: 'INTERNAL_SERVER_ERROR',
    status: 500,
    message: 'The backend could not complete this operation.',
    details: null,
  });
}

function coreCanvasRequest(
  path: string,
  input: unknown,
  authority: ICanvasAuthority,
): Effect.Effect<unknown, PrivateRpcError> | null {
  const normalized = normalizePath(path).join('.');
  const provide = <A>(program: Effect.Effect<A, CanvasAuthorityError, CanvasAuthority>) => program.pipe(
    Effect.provideService(CanvasAuthority, authority),
    Effect.map((value): unknown => value),
    Effect.mapError(rpcError),
  );
  if (normalized === 'canvas.snapshot') {
    return provide(fxGetCanvasSnapshot(input as Parameters<typeof fxGetCanvasSnapshot>[0]));
  }
  if (normalized === 'canvas.query') {
    return provide(fxQueryCanvasItems(input as Parameters<typeof fxQueryCanvasItems>[0]));
  }
  if (normalized === 'canvas.execute') {
    return provide(txExecuteCanvasCommand(input as Parameters<typeof txExecuteCanvasCommand>[0]));
  }
  return null;
}

type TSemanticAuthorities = Readonly<{
  agent: IAgentAuthority;
  events: IEventAuthority;
  functions: IFunctionAuthority;
  resources: IResourceAuthority;
  widgetState: IWidgetStateAuthority;
}>;

function coreSemanticRequest(
  path: string,
  input: unknown,
  authorities: TSemanticAuthorities,
): Effect.Effect<unknown, PrivateRpcError> | null {
  const normalized = normalizePath(path).join('.');
  const request = input as Readonly<Record<string, unknown>>;
  if (normalized === 'agent.chat.connect') {
    return fxConnectAgent(input as Parameters<typeof fxConnectAgent>[0]).pipe(
      Effect.provideService(AgentAuthority, authorities.agent),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'agent.chat.history') {
    return fxReadAgentHistory(input as Parameters<typeof fxReadAgentHistory>[0]).pipe(
      Effect.provideService(AgentAuthority, authorities.agent),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'resource.resources.list') {
    return fxListResources((input ?? {}) as Parameters<typeof fxListResources>[0]).pipe(
      Effect.provideService(ResourceAuthority, authorities.resources),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'resource.resources.get') {
    return fxGetResource(input as Parameters<typeof fxGetResource>[0]).pipe(
      Effect.provideService(ResourceAuthority, authorities.resources),
      Effect.flatMap((resource) => resource === null
        ? Effect.fail(rpcError(new ResourceProgramError(
          'RESOURCE_NOT_FOUND',
          'Resource was not found.',
        )))
        : Effect.succeed(resource)),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'resource.resources.create') {
    return txCreateResource(input as Parameters<typeof txCreateResource>[0]).pipe(
      Effect.provideService(ResourceAuthority, authorities.resources),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'function.invoke') {
    return txInvokeFunction({
      subject: {
        canvasId: request.canvasId as string,
        elementId: request.elementId as string,
        widgetInstanceId: request.widgetInstanceId as string,
      },
      widgetKey: request.widgetKey as string,
      catalogGeneration: request.catalogGeneration as number,
      functionName: request.functionName as string,
      input: request.input,
    }).pipe(
      Effect.provideService(FunctionAuthority, authorities.functions),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'widget.runtime.state.get') {
    return fxGetWidgetState({ identity: {
      canvasId: request.canvasId as string,
      elementId: request.elementId as string,
      widgetInstanceId: request.widgetInstanceId as string,
    } }).pipe(
      Effect.provideService(WidgetStateAuthority, authorities.widgetState),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'widget.runtime.state.change') {
    return txChangeWidgetState({
      identity: {
        canvasId: request.canvasId as string,
        elementId: request.elementId as string,
        widgetInstanceId: request.widgetInstanceId as string,
      },
      expectedVersion: request.expectedVersion as number,
      state: request.state as Parameters<typeof txChangeWidgetState>[0]['state'],
    }).pipe(
      Effect.provideService(WidgetStateAuthority, authorities.widgetState),
      Effect.mapError(rpcError),
    );
  }
  return null;
}

function coreCanvasStream(
  path: string,
  input: unknown,
  authority: ICanvasAuthority,
): Effect.Effect<Stream.Stream<unknown, PrivateRpcError>, PrivateRpcError> | null {
  if (normalizePath(path).join('.') !== 'canvas.events') return null;
  return fxCanvasEvents(input as Parameters<typeof fxCanvasEvents>[0]).pipe(
    Effect.provideService(CanvasAuthority, authority),
    Effect.map((events) => events.pipe(Stream.mapError(rpcError))),
    Effect.mapError(rpcError),
  );
}

function coreSemanticStream(
  path: string,
  input: unknown,
  authorities: TSemanticAuthorities,
): Effect.Effect<Stream.Stream<unknown, PrivateRpcError>, PrivateRpcError> | null {
  const normalized = normalizePath(path).join('.');
  const request = input as Readonly<Record<string, unknown>>;
  if (normalized === 'agent.events') {
    return fxAgentEvents(input as Parameters<typeof fxAgentEvents>[0]).pipe(
      Effect.provideService(AgentAuthority, authorities.agent),
      Effect.map((stream) => stream.pipe(
        Stream.map((record) => ({ ...record.event, sequence: record.sequence })),
        Stream.mapError(rpcError),
      )),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'db.events') {
    return fxDbEventRecords(input as Parameters<typeof fxDbEventRecords>[0]).pipe(
      Effect.provideService(EventAuthority, authorities.events),
      Effect.map((stream) => stream.pipe(
        Stream.map((record) => ({ ...record.event, sequence: record.sequence })),
        Stream.mapError(rpcError),
      )),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'notification.events') {
    return fxNotificationEventRecords(input as Parameters<typeof fxNotificationEventRecords>[0]).pipe(
      Effect.provideService(EventAuthority, authorities.events),
      Effect.map((stream) => stream.pipe(
        Stream.map((record) => ({ ...record.event, sequence: record.sequence })),
        Stream.mapError(rpcError),
      )),
      Effect.mapError(rpcError),
    );
  }
  if (normalized === 'widget.runtime.state.events') {
    return fxWidgetStateEvents({
      identity: {
        canvasId: request.canvasId as string,
        elementId: request.elementId as string,
        widgetInstanceId: request.widgetInstanceId as string,
      },
      ...(typeof request.afterVersion === 'number'
        ? { afterVersion: request.afterVersion }
        : {}),
    }).pipe(
      Effect.provideService(WidgetStateAuthority, authorities.widgetState),
      Effect.map((stream) => stream.pipe(Stream.mapError(rpcError))),
      Effect.mapError(rpcError),
    );
  }
  return null;
}

function parseInput(path: string, input: unknown): unknown {
  try {
    const operation = privateOperationContract(path);
    if (operation === null) throw new Error(`Unknown private procedure '${path}'.`);
    return operation.decodeInput(input);
  } catch (cause) {
    throw new ProcedureError('BAD_REQUEST', {
      message: 'Input validation failed',
      cause,
    });
  }
}

function parseOutput(procedure: PrivateProcedure, output: unknown): unknown {
  try {
    return parseProcedureOutput(procedure, output);
  } catch (cause) {
    throw new ProcedureError('INTERNAL_SERVER_ERROR', {
      message: 'Procedure output validation failed.',
      cause,
    });
  }
}

export function assertIdempotencyKey(
  path: string,
  input: unknown,
  idempotencyKey: string | undefined,
): void {
  const normalized = normalizePath(path).join('.');
  if (normalized !== 'canvas.execute' || idempotencyKey === undefined) return;
  const commandId = typeof input === 'object' && input !== null
    ? (input as Readonly<Record<string, unknown>>).commandId
    : undefined;
  if (commandId !== idempotencyKey) {
    throw new ProcedureError('BAD_REQUEST', {
      message: 'Canvas command idempotency key must equal commandId.',
    });
  }
}

export function resumeInput(path: string, input: unknown, afterCursor: number | undefined): unknown {
  if (
    afterCursor === undefined
    || typeof input !== 'object'
    || input === null
    || Array.isArray(input)
  ) return input;
  const normalized = normalizePath(path).join('.');
  const cursorKey = normalized === 'canvas.events'
    ? 'afterRevision'
    : normalized === 'widget.catalog.events'
      ? 'afterGeneration'
      : normalized === 'widget.runtime.state.events'
        ? 'afterVersion'
        : normalized === 'agent.events'
          || normalized === 'db.events'
          || normalized === 'notification.events'
          ? 'afterSequence'
          : null;
  if (cursorKey === null || cursorKey in input) return input;
  return { ...input, [cursorKey]: afterCursor };
}

export const layerLiveRpcDispatcher = Layer.effect(
  RpcDispatcher,
  Effect.gen(function*() {
    const agent = yield* LiveAgent;
    const canvas = yield* LiveCanvas;
    const db = yield* LiveDatabase;
    const eventPublisher = yield* LiveEventPublisher;
    const functionInvocation = yield* LiveFunctionInvocation;
    const humanResourceSecret = yield* LiveHumanResourceSecret;
    const resource = yield* LiveResource;
    const widgetCatalog = yield* LiveWidgetCatalog;
    const widgetPreview = yield* LiveWidgetPreview;
    const widgetCapsuleHostConfiguration = yield* LiveWidgetHostConfiguration;
    const widgetRuntimeLoadAdmission = yield* LiveWidgetLoadAdmission;
    const widgetState = yield* LiveWidgetState;
    const canvasAuthority = yield* CanvasAuthority;
    const agentAuthority = yield* AgentAuthority;
    const eventAuthority = yield* EventAuthority;
    const functionAuthority = yield* FunctionAuthority;
    const resourceAuthority = yield* ResourceAuthority;
    const widgetStateAuthority = yield* WidgetStateAuthority;
    const semanticAuthorities = {
      agent: agentAuthority,
      events: eventAuthority,
      functions: functionAuthority,
      resources: resourceAuthority,
      widgetState: widgetStateAuthority,
    };
    const context: TApiContext = {
      agent,
      canvas,
      db,
      eventPublisher,
      functionInvocation,
      humanResourceSecret,
      resource,
      widgetCatalog,
      widgetPreview,
      widgetCapsuleHostConfiguration,
      widgetRuntimeLoadAdmission,
      widgetState,
    };

    return RpcDispatcher.of({
      request: (args) => Effect.gen(function*() {
        const procedure = yield* Effect.try({
          try: () => resolveProcedure(args.path),
          catch: rpcError,
        });
        if (procedure.contract.streamOutput) {
          return yield* Effect.fail(rpcError(new ProcedureError('BAD_REQUEST', {
            message: `Procedure '${args.path}' is streaming.`,
          })));
        }
        const input = yield* Effect.try({
          try: () => {
            const parsed = parseInput(args.path, args.input);
            assertIdempotencyKey(args.path, parsed, args.idempotencyKey);
            return parsed;
          },
          catch: rpcError,
        });
        const coreProgram = coreCanvasRequest(args.path, input, canvasAuthority)
          ?? coreSemanticRequest(args.path, input, semanticAuthorities);
        const result = coreProgram === null
          ? yield* Effect.tryPromise({
            try: (signal) => Promise.resolve(procedure.handler({ context, input, signal })),
            catch: rpcError,
          })
          : yield* coreProgram;
        return yield* Effect.try({
          try: () => wireJson(parseOutput(procedure, result)),
          catch: rpcError,
        });
      }),
      stream: (args) => Stream.scoped(Stream.unwrap(Effect.gen(function*() {
        const procedure = yield* Effect.try({
          try: () => resolveProcedure(args.path),
          catch: rpcError,
        });
        if (!procedure.contract.streamOutput) {
          return Stream.fail(rpcError(new ProcedureError('BAD_REQUEST', {
            message: `Procedure '${args.path}' is not streaming.`,
          })));
        }
        const input = yield* Effect.try({
          try: () => parseInput(
            args.path,
            resumeInput(args.path, args.input, args.afterCursor),
          ),
          catch: rpcError,
        });
        const coreProgram = coreCanvasStream(args.path, input, canvasAuthority)
          ?? coreSemanticStream(args.path, input, semanticAuthorities);
        if (coreProgram !== null) {
          const events = yield* coreProgram;
          return events.pipe(Stream.mapEffect((value) => Effect.try({
            try: () => wireJson(parseOutput(procedure, value)),
            catch: rpcError,
          })));
        }
        const controller = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (active) => Effect.sync(() => active.abort('RPC stream scope closed')),
        );
        const iterable = yield* Effect.tryPromise({
          try: () => Promise.resolve(procedure.handler({
            context,
            input,
            signal: controller.signal,
          })) as Promise<AsyncIterable<unknown>>,
          catch: rpcError,
        });
        return Stream.fromAsyncIterable(iterable, rpcError).pipe(
          Stream.mapEffect((value) => Effect.try({
            try: () => wireJson(parseOutput(procedure, value)),
            catch: rpcError,
          })),
        );
      }))),
    });
  }),
);

export { normalizePath, resolveProcedure, rpcError };
