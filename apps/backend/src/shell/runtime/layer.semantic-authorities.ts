import { Effect, Layer, Queue, Stream } from 'effect';
import { fnNormalizeCanonicalJson } from '../../core/fn.canonical-json';
import { AgentServiceError } from '../../core/agent/error.agent-service';
import {
  AgentAuthority,
  AgentProgramError,
  type IAgentAuthority,
} from '../../core/agent/service.agent';
import {
  EventAuthority,
  EventProgramError,
  type IEventAuthority,
} from '../../core/events/service.events';
import {
  FunctionAuthority,
  FunctionProgramError,
  type IFunctionAuthority,
} from '../../core/functions/service.functions';
import {
  ResourceAuthority,
  ResourceProgramError,
  type IResourceAuthority,
} from '../../core/resources/service.resources';
import type { TResourceDescriptor, TResourceErrorCode } from '../../core/resources/types';
import {
  WidgetStateAuthority,
  WidgetStateProgramError,
  type IWidgetStateAuthority,
} from '../../core/widget-state/service.widget-state';
import {
  WidgetAuthority,
  WidgetProgramError,
  type IWidgetAuthority,
} from '../../core/widgets/service.widgets';
import {
  LiveAgent,
  LiveEventPublisher,
  LiveFunctionInvocation,
  LiveResource,
  LiveWidgetCatalog,
  LiveWidgetState,
} from './service.live-mechanics';

function codeOf(error: unknown, fallback: string): string {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : fallback;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function agentFailure(error: unknown): AgentProgramError {
  return new AgentProgramError(
    error instanceof AgentServiceError ? error.code : codeOf(error, 'AGENT_UNAVAILABLE'),
    messageOf(error, 'Agent authority is unavailable.'),
    { cause: error },
  );
}

export function agentAuthorityFromLive(args: Readonly<{
  agent: typeof LiveAgent.Service;
  events: typeof LiveEventPublisher.Service;
}>): IAgentAuthority {
  return AgentAuthority.of({
    connect: (request) => Effect.tryPromise({
      try: () => args.agent.connectChat(
        request.widgetId,
        request.sessionId,
        request.canvasId,
        request.mode,
      ),
      catch: agentFailure,
    }).pipe(Effect.map((connection) => ({
      vcJson: connection.vcJson === null
        ? null
        : fnNormalizeCanonicalJson(connection.vcJson),
      messageHistory: connection.messageHistory.map((entry) => ({
        entryId: entry.entryId,
        message: fnNormalizeCanonicalJson(entry.message),
      })),
    }))),
    history: (request) => Effect.tryPromise({
      try: () => args.agent.getChatHistory(request.widgetId, request.sessionId),
      catch: agentFailure,
    }).pipe(Effect.map((history) => history.map((entry) => ({
      entryId: entry.entryId,
      message: fnNormalizeCanonicalJson(entry.message),
    })))),
    events: (request) => Effect.sync(() => Stream.fromAsyncIterable(
      args.events.subscribeAgentEventRecords(request),
      agentFailure,
    ).pipe(Stream.map((record) => ({
      sequence: record.sequence,
      event: fnNormalizeCanonicalJson(record.event) as typeof record.event,
    })))),
  });
}

export const layerAgentAuthorityLive = Layer.effect(
  AgentAuthority,
  Effect.gen(function*() {
    return agentAuthorityFromLive({
      agent: yield* LiveAgent,
      events: yield* LiveEventPublisher,
    });
  }),
);

function eventFailure(error: unknown): EventProgramError {
  return new EventProgramError(
    codeOf(error, 'EVENT_UNAVAILABLE'),
    messageOf(error, 'Event authority is unavailable.'),
    { cause: error },
  );
}

export function eventAuthorityFromLive(
  events: typeof LiveEventPublisher.Service,
): IEventAuthority {
  return EventAuthority.of({
    publishAgent: (event) => Effect.try({
      try: () => events.publishAgentEvent(event),
      catch: eventFailure,
    }),
    agent: (request) => Effect.sync(() => Stream.fromAsyncIterable(
      events.subscribeAgentEventRecords(request),
      eventFailure,
    )),
    db: (request) => Effect.sync(() => Stream.fromAsyncIterable(
      events.subscribeDbEventRecords(request.canvasId, request),
      eventFailure,
    )),
    notifications: (request) => Effect.sync(() => Stream.fromAsyncIterable(
      events.subscribeNotificationRecords(request),
      eventFailure,
    )),
  });
}

export const layerEventAuthorityLive = Layer.effect(
  EventAuthority,
  Effect.map(LiveEventPublisher, eventAuthorityFromLive),
);

function resourceFailure(error: unknown): ResourceProgramError {
  return new ResourceProgramError(
    codeOf(error, 'RESOURCE_UNAVAILABLE'),
    messageOf(error, 'Resource authority is unavailable.'),
    { cause: error },
  );
}

export function resourceAuthorityFromLive(
  resources: typeof LiveResource.Service,
): IResourceAuthority {
  const descriptor = (value: Awaited<ReturnType<typeof resources.getResource>>): TResourceDescriptor | null => {
    if (value === null) return null;
    const lastError = typeof value.lastError === 'object' && value.lastError !== null
      && 'code' in value.lastError && typeof value.lastError.code === 'string'
      && 'message' in value.lastError && typeof value.lastError.message === 'string'
      ? {
        code: value.lastError.code as TResourceErrorCode,
        message: value.lastError.message,
        ...('details' in value.lastError && typeof value.lastError.details === 'object'
          && value.lastError.details !== null
          ? { details: value.lastError.details as Readonly<Record<string, unknown>> }
          : {}),
      }
      : null;
    return { ...value, lastError };
  };
  return ResourceAuthority.of({
    list: (request) => Effect.tryPromise({
      try: async () => (await resources.listResources(request)).map(descriptor) as TResourceDescriptor[],
      catch: resourceFailure,
    }),
    get: (request) => Effect.tryPromise({
      try: async () => descriptor(await resources.getResource(request.resourceId)),
      catch: resourceFailure,
    }),
    create: (request) => Effect.tryPromise({
      try: async () => descriptor(await resources.createResource(request))!,
      catch: resourceFailure,
    }),
  });
}

export const layerResourceAuthorityLive = Layer.effect(
  ResourceAuthority,
  Effect.map(LiveResource, resourceAuthorityFromLive),
);

function functionFailure(error: unknown): FunctionProgramError {
  return new FunctionProgramError(
    codeOf(error, 'FUNCTION_UNAVAILABLE'),
    messageOf(error, 'Function authority is unavailable.'),
    { cause: error },
  );
}

export function functionAuthorityFromLive(
  functions: typeof LiveFunctionInvocation.Service,
): IFunctionAuthority {
  return FunctionAuthority.of({
    invoke: (request) => Effect.tryPromise({
      try: (signal) => functions.invokeFunction({
        canvasId: request.subject.canvasId,
        elementId: request.subject.elementId,
        widgetInstanceId: request.subject.widgetInstanceId,
        widgetKey: request.widgetKey,
        catalogGeneration: request.catalogGeneration,
        functionName: request.functionName,
        input: request.input,
      }, signal),
      catch: functionFailure,
    }),
  });
}

export const layerFunctionAuthorityLive = Layer.effect(
  FunctionAuthority,
  Effect.map(LiveFunctionInvocation, functionAuthorityFromLive),
);

function stateFailure(error: unknown): WidgetStateProgramError {
  return new WidgetStateProgramError(
    codeOf(error, 'WIDGET_STATE_UNAVAILABLE'),
    messageOf(error, 'Widget state authority is unavailable.'),
    { cause: error },
  );
}

export function widgetStateAuthorityFromLive(
  state: typeof LiveWidgetState.Service,
): IWidgetStateAuthority {
  return WidgetStateAuthority.of({
    get: (request) => Effect.tryPromise({
      try: () => state.get(request),
      catch: stateFailure,
    }),
    change: (request) => Effect.tryPromise({
      try: () => state.change(request),
      catch: stateFailure,
    }),
    events: (request) => Effect.tryPromise({
      try: () => state.subscribe(request),
      catch: stateFailure,
    }).pipe(Effect.flatMap((result) => result.status === 'subscribed'
      ? Effect.succeed(Stream.fromAsyncIterable(result.events, stateFailure))
      : Effect.fail(new WidgetStateProgramError(
        result.status === 'capacity-unavailable'
          ? 'WIDGET_STATE_CAPACITY_UNAVAILABLE'
          : 'WIDGET_STATE_UNAVAILABLE',
        'Widget state subscription is unavailable.',
      )))),
  });
}

export const layerWidgetStateAuthorityLive = Layer.effect(
  WidgetStateAuthority,
  Effect.map(LiveWidgetState, widgetStateAuthorityFromLive),
);

function widgetFailure(error: unknown): WidgetProgramError {
  return new WidgetProgramError(
    codeOf(error, 'WIDGET_UNAVAILABLE'),
    messageOf(error, 'Widget authority is unavailable.'),
    { cause: error },
  );
}

export function widgetAuthorityFromLive(
  catalog: typeof LiveWidgetCatalog.Service,
): IWidgetAuthority & Readonly<{ close(): void }> {
  type TPublication = Readonly<{ widgetKey: string; generation: number; published: boolean }>;
  const history: TPublication[] = [];
  const listeners = new Set<(event: TPublication) => void>();
  const unsubscribe = catalog.subscribe((event) => {
    const snapshot = catalog.current();
    for (const widgetKey of event.changedWidgetKeys) {
      const published = snapshot.entries[widgetKey]?.published?.health === 'healthy';
      const publication = Object.freeze({
        widgetKey,
        generation: event.generation,
        published,
      });
      history.push(publication);
      if (history.length > 256) history.splice(0, history.length - 256);
      for (const listener of listeners) listener(publication);
    }
  });
  const authority = WidgetAuthority.of({
    catalog: () => Effect.try({
      try: () => {
        const snapshot = catalog.current();
        return Object.values(snapshot.entries).map((entry) => ({
          widgetKey: entry.slug,
          generation: snapshot.generation,
          catalogDigestSha256: snapshot.digestSha256,
          draftManifestDigestSha256: entry.draft?.manifestDigestSha256 ?? null,
          available: entry.placeable && entry.published?.health === 'healthy',
        }));
      },
      catch: widgetFailure,
    }),
    publish: (request) => Effect.tryPromise({
      try: async () => {
        const before = catalog.current();
        const draft = before.entries[request.widgetKey]?.draft;
        if (
          before.generation !== request.expectedGeneration
          || before.digestSha256 !== request.expectedCatalogDigestSha256
          || draft?.manifestDigestSha256 !== request.expectedManifestDigestSha256
        ) {
          throw Object.assign(new Error('Widget catalog generation changed.'), {
            code: 'WIDGET_CATALOG_CHANGED',
          });
        }
        const mutation = await catalog.buildAndPublish({
          widgetKey: request.widgetKey,
          expectedCatalogDigestSha256: request.expectedCatalogDigestSha256,
          expectedManifestDigestSha256: request.expectedManifestDigestSha256,
        });
        const after = mutation.snapshot;
        return {
          widgetKey: request.widgetKey,
          generation: after.generation,
          published: after.entries[request.widgetKey]?.published?.health === 'healthy',
        };
      },
      catch: widgetFailure,
    }),
    events: (request) => Effect.sync(() => {
      const latestGeneration = history.at(-1)?.generation ?? 0;
      if ((request.afterGeneration ?? 0) > latestGeneration) {
        return Stream.fail(new WidgetProgramError(
          'WIDGET_CURSOR_INVALID',
          'Widget publication cursor is ahead of authority; refresh the catalog.',
        ));
      }
      return Stream.callback<TPublication, WidgetProgramError>((queue) => Effect.acquireRelease(
        Effect.sync(() => {
          const afterGeneration = request.afterGeneration ?? 0;
          const listener = (event: TPublication) => {
            if (event.generation > afterGeneration) Queue.offerUnsafe(queue, event);
          };
          listeners.add(listener);
          for (const event of history) listener(event);
          return listener;
        }),
        (listener) => Effect.sync(() => listeners.delete(listener)),
      ));
    }),
  });
  return Object.assign(authority, {
    close(): void {
      unsubscribe();
      history.splice(0);
      listeners.clear();
    },
  });
}

export const layerWidgetAuthorityLive = Layer.effect(
  WidgetAuthority,
  Effect.gen(function*() {
    const authority = widgetAuthorityFromLive(yield* LiveWidgetCatalog);
    yield* Effect.addFinalizer(() => Effect.sync(() => authority.close()));
    return authority;
  }),
);

export const layerSemanticAuthoritiesLive = Layer.mergeAll(
  layerAgentAuthorityLive,
  layerEventAuthorityLive,
  layerResourceAuthorityLive,
  layerFunctionAuthorityLive,
  layerWidgetStateAuthorityLive,
  layerWidgetAuthorityLive,
);
