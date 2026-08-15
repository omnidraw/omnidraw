import { ProcedureError } from '#backend/shell/api';
import type { TApiContext } from '#backend/shell/api/context';
import { Effect, Layer, Schema, Stream } from 'effect';
import type { Json } from 'effect/Schema';
import {
  AgentAuthority,
} from '../../core/agent/service.agent';
import {
  CanvasAuthority,
} from '../../core/canvas/service.canvas-authority';
import {
  CanvasChatLifecycle,
  CanvasDeletionStore,
} from '../../core/canvas/service.canvas-deletion';
import {
  EventAuthority,
} from '../../core/events/service.events';
import {
  FunctionAuthority,
} from '../../core/functions/service.functions';
import {
  ResourceAuthority,
} from '../../core/resources/service.resources';
import {
  WidgetStateAuthority,
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
  LiveWidgetAuthoring,
  LiveWidgetHostConfiguration,
  LiveWidgetLoadAdmission,
  LiveWidgetPreview,
  LiveWidgetState,
} from '../runtime/service.live-mechanics';
import { PrivateRpcError } from './rpc-contract';
import { RpcDispatcher } from './service.rpc-dispatcher';
import {
  applyOperationCursor,
  assertOperationIdempotency,
  privateOperationContract,
  type TPrivateOperationContract,
  type TPrivateOperationRuntime,
} from './operation-contract';

function wireJson(value: unknown): Json {
  return Schema.decodeUnknownSync(Schema.Json)(value);
}

function decodeOperationInput(operation: TPrivateOperationContract, input: unknown): unknown {
  try {
    return operation.decodeInput(input);
  } catch (cause) {
    throw new ProcedureError('BAD_REQUEST', { message: 'Input validation failed', cause });
  }
}

function encodeOperationOutput(operation: TPrivateOperationContract, output: unknown): Json {
  try {
    return wireJson(operation.decodeOutput(output));
  } catch (cause) {
    throw new ProcedureError('INTERNAL_SERVER_ERROR', {
      message: 'Procedure output validation failed.',
      cause,
    });
  }
}

function requireOperation(
  path: string,
): TPrivateOperationContract {
  const operation = privateOperationContract(path);
  if (operation !== null) return operation;
  throw new ProcedureError('NOT_FOUND', {
    message: `Unknown private procedure '${path}'.`,
  });
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
    const widgetAuthoring = yield* LiveWidgetAuthoring;
    const widgetPreview = yield* LiveWidgetPreview;
    const widgetCapsuleHostConfiguration = yield* LiveWidgetHostConfiguration;
    const widgetRuntimeLoadAdmission = yield* LiveWidgetLoadAdmission;
    const widgetState = yield* LiveWidgetState;
    const canvasAuthority = yield* CanvasAuthority;
    const canvasDeletionStore = yield* CanvasDeletionStore;
    const canvasChatLifecycle = yield* CanvasChatLifecycle;
    const agentAuthority = yield* AgentAuthority;
    const eventAuthority = yield* EventAuthority;
    const functionAuthority = yield* FunctionAuthority;
    const resourceAuthority = yield* ResourceAuthority;
    const widgetStateAuthority = yield* WidgetStateAuthority;
    const context: TApiContext = {
      agent,
      canvas,
      db,
      eventPublisher,
      functionInvocation,
      humanResourceSecret,
      resource,
      widgetCatalog,
      widgetAuthoring,
      widgetPreview,
      widgetCapsuleHostConfiguration,
      widgetRuntimeLoadAdmission,
      widgetState,
    };
    const operationRuntime: TPrivateOperationRuntime = {
      context,
      agent: agentAuthority,
      canvas: canvasAuthority,
      canvasDeletionStore,
      canvasChatLifecycle,
      events: eventAuthority,
      functions: functionAuthority,
      resources: resourceAuthority,
      widgetState: widgetStateAuthority,
    };

    return RpcDispatcher.of({
      request: (args) => Effect.gen(function*() {
        const operation = yield* Effect.try({
          try: () => requireOperation(args.path),
          catch: (error) => new PrivateRpcError({
            code: 'NOT_FOUND',
            status: 404,
            message: error instanceof Error ? error.message : 'Unknown private procedure.',
            details: null,
          }),
        });
        if (operation.mode !== 'request') {
          return yield* Effect.fail(operation.errorPolicy(new ProcedureError('BAD_REQUEST', {
            message: `Procedure '${args.path}' is streaming.`,
          })));
        }
        const input = yield* Effect.try({
          try: () => {
            const parsed = decodeOperationInput(operation, args.input);
            assertOperationIdempotency(operation, parsed, args.idempotencyKey);
            return parsed;
          },
          catch: operation.errorPolicy,
        });
        const result = operation.adapter.kind === 'procedure'
          ? yield* Effect.tryPromise({
            try: (signal) => Promise.resolve(operation.procedure.handler({ context, input, signal })),
            catch: operation.errorPolicy,
          })
          : yield* operation.adapter.run(input, operationRuntime).pipe(
            Effect.mapError(operation.errorPolicy),
          );
        return yield* Effect.try({
          try: () => encodeOperationOutput(operation, result),
          catch: operation.errorPolicy,
        });
      }),
      stream: (args) => Stream.scoped(Stream.unwrap(Effect.gen(function*() {
        const operation = yield* Effect.try({
          try: () => requireOperation(args.path),
          catch: (error) => new PrivateRpcError({
            code: 'NOT_FOUND',
            status: 404,
            message: error instanceof Error ? error.message : 'Unknown private procedure.',
            details: null,
          }),
        });
        if (operation.mode !== 'stream') {
          return Stream.fail(operation.errorPolicy(new ProcedureError('BAD_REQUEST', {
            message: `Procedure '${args.path}' is not streaming.`,
          })));
        }
        const input = yield* Effect.try({
          try: () => decodeOperationInput(
            operation,
            applyOperationCursor(operation, args.input, args.afterCursor),
          ),
          catch: operation.errorPolicy,
        });
        if (operation.adapter.kind === 'core') {
          const events = yield* operation.adapter.run(input, operationRuntime).pipe(
            Effect.mapError(operation.errorPolicy),
          );
          return events.pipe(
            Stream.mapError(operation.errorPolicy),
            Stream.mapEffect((value) => Effect.try({
              try: () => encodeOperationOutput(operation, value),
              catch: operation.errorPolicy,
            })),
          );
        }
        const controller = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (active) => Effect.sync(() => active.abort('RPC stream scope closed')),
        );
        const iterable = yield* Effect.tryPromise({
          try: () => Promise.resolve(operation.procedure.handler({
            context,
            input,
            signal: controller.signal,
          })) as Promise<AsyncIterable<unknown>>,
          catch: operation.errorPolicy,
        });
        return Stream.fromAsyncIterable(iterable, operation.errorPolicy).pipe(
          Stream.mapEffect((value) => Effect.try({
            try: () => encodeOperationOutput(operation, value),
            catch: operation.errorPolicy,
          })),
        );
      }))),
    });
  }),
);
