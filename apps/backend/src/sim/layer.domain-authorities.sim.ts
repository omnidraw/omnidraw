import { Effect, Layer, Stream } from 'effect';
import {
  AgentAuthority,
  AgentProgramError,
  type TAgentConnection,
  type TAgentHistoryEntry,
} from '../core/agent/service.agent';
import type { TAgentEvent, TSequencedEvent } from '../core/events/events';
import {
  EventAuthority,
  EventProgramError,
} from '../core/events/service.events';
import {
  FunctionAuthority,
  type TFunctionInvokeResult,
} from '../core/functions/service.functions';
import {
  ResourceAuthority,
  ResourceProgramError,
} from '../core/resources/service.resources';
import type { TResourceDescriptor } from '../core/resources/types';
import {
  WidgetStateAuthority,
} from '../core/widget-state/service.widget-state';
import {
  DEFAULT_WIDGET_STATE_MAX_MUTATION_RATE_LEDGERS,
  WIDGET_STATE_MUTATION_RATE_LIMIT,
  WIDGET_STATE_MUTATION_RATE_WINDOW_MS,
} from '../core/widget-state/CONSTANTS';
import {
  fnTransitionWidgetStateMutationRate,
  type TWidgetStateMutationRateLedger,
} from '../core/widget-state/fn.mutation-rate';
import type {
  TWidgetStateInstanceIdentity,
  TWidgetStateJson,
  TWidgetStateSnapshot,
  TWidgetStateSubscriptionEvent,
} from '../core/widget-state/types';
import {
  WidgetAuthority,
  WidgetProgramError,
  type TWidgetCatalogEntry,
  type TWidgetPublicationResult,
} from '../core/widgets/service.widgets';

/** All simulation inputs are explicit; no clock, entropy, driver, or global is consulted. */
export function layerAgentAuthoritySim(args: Readonly<{
  connection: TAgentConnection;
}>) {
  const history = new Map<string, readonly TAgentHistoryEntry[]>();
  return Layer.succeed(AgentAuthority, AgentAuthority.of({
    connect: (request) => Effect.sync(() => {
      history.set(`${request.widgetId}\u0000${request.sessionId}`, args.connection.messageHistory);
      return args.connection;
    }),
    history: (request) => Effect.suspend(() => {
      const value = history.get(`${request.widgetId}\u0000${request.sessionId}`);
      return value === undefined
        ? Effect.fail(new AgentProgramError('CHAT_SCOPE_INVALID', 'Simulated chat is not connected.'))
        : Effect.succeed(value);
    }),
  }));
}

export function layerResourceAuthoritySim(args: Readonly<{
  initial?: readonly TResourceDescriptor[];
  createdAtSec: string;
}>) {
  const resources = new Map((args.initial ?? []).map((resource) => [resource.id, resource]));
  let nextId = resources.size;
  return Layer.succeed(ResourceAuthority, ResourceAuthority.of({
    list: (filter) => Effect.sync(() => [...resources.values()]
      .filter((resource) => filter.kind === undefined || resource.kind === filter.kind)
      .filter((resource) => filter.status === undefined || resource.status === filter.status)
      .sort((left, right) => left.id.localeCompare(right.id))),
    get: ({ resourceId }) => Effect.sync(() => resources.get(resourceId) ?? null),
    create: ({ kind, name }) => Effect.suspend(() => {
      if ([...resources.values()].some((resource) => resource.name === name)) {
        return Effect.fail(new ResourceProgramError(
          'RESOURCE_NAME_CONFLICT',
          'Simulated resource name already exists.',
        ));
      }
      nextId += 1;
      const resource: TResourceDescriptor = {
        id: `resource-${nextId}`,
        kind,
        name,
        status: 'ready',
        lastError: null,
        createdAtSec: args.createdAtSec,
        updatedAtSec: args.createdAtSec,
      };
      resources.set(resource.id, resource);
      return Effect.succeed(resource);
    }),
  }));
}

export function layerFunctionAuthoritySim(args: Readonly<{
  result: TFunctionInvokeResult;
}>) {
  return Layer.succeed(FunctionAuthority, FunctionAuthority.of({
    invoke: () => Effect.succeed(args.result),
  }));
}

function identityKey(identity: TWidgetStateInstanceIdentity): string {
  return `${identity.canvasId}\u0000${identity.elementId}\u0000${identity.widgetInstanceId}`;
}

export function layerWidgetStateAuthoritySim(args: Readonly<{
  initialState: TWidgetStateJson;
  initialVersion?: number;
  now: () => number;
  mutationRateLimit?: number;
  mutationRateWindowMs?: number;
  maxMutationRateLedgers?: number;
}>) {
  const snapshots = new Map<string, TWidgetStateSnapshot>();
  const history = new Map<string, TWidgetStateSubscriptionEvent[]>();
  const mutationRateLedgers = new Map<string, TWidgetStateMutationRateLedger>();
  const mutationRateLimit = args.mutationRateLimit
    ?? WIDGET_STATE_MUTATION_RATE_LIMIT;
  const mutationRateWindowMs = args.mutationRateWindowMs
    ?? WIDGET_STATE_MUTATION_RATE_WINDOW_MS;
  const maxMutationRateLedgers = args.maxMutationRateLedgers
    ?? DEFAULT_WIDGET_STATE_MAX_MUTATION_RATE_LEDGERS;
  const admitMutation = (identity: TWidgetStateInstanceIdentity) => {
    const transition = fnTransitionWidgetStateMutationRate({
      scope: JSON.stringify([identity.widgetInstanceId]),
      now: args.now(),
      limit: mutationRateLimit,
      windowMs: mutationRateWindowMs,
      maxLedgers: maxMutationRateLedgers,
      ledgers: [...mutationRateLedgers.entries()],
    });
    mutationRateLedgers.clear();
    for (const [scope, ledger] of transition.ledgers) {
      mutationRateLedgers.set(scope, ledger);
    }
    return transition.admission;
  };
  const snapshotFor = (identity: TWidgetStateInstanceIdentity): TWidgetStateSnapshot => {
    const key = identityKey(identity);
    const existing = snapshots.get(key);
    if (existing !== undefined) return existing;
    const created = {
      identity,
      version: args.initialVersion ?? 0,
      state: args.initialState,
    } as const;
    snapshots.set(key, created);
    history.set(key, [{ type: 'snapshot', reason: 'initial', snapshot: created }]);
    return created;
  };
  return Layer.succeed(WidgetStateAuthority, WidgetStateAuthority.of({
    get: ({ identity }) => Effect.sync(() => ({ status: 'found', snapshot: snapshotFor(identity) })),
    change: (request) => Effect.sync(() => {
      const admission = admitMutation(request.identity);
      if (!admission.allowed) {
        return {
          status: 'rate-limited' as const,
          retryAfterMs: admission.retryAfterMs,
        };
      }
      const current = snapshotFor(request.identity);
      if (current.version !== request.expectedVersion) {
        return { status: 'conflict' as const, snapshot: current };
      }
      const next = {
        identity: request.identity,
        version: current.version + 1,
        state: request.state,
      } as const;
      const key = identityKey(request.identity);
      snapshots.set(key, next);
      history.get(key)!.push({ type: 'changed', snapshot: next });
      return { status: 'changed' as const, snapshot: next };
    }),
    events: (request) => Effect.suspend(() => {
      const current = snapshotFor(request.identity);
      if ((request.afterVersion ?? current.version) > current.version) {
        return Effect.succeed(Stream.succeed({
          type: 'snapshot',
          reason: 'resync',
          snapshot: current,
        } as const));
      }
      return Effect.succeed(Stream.fromIterable(
        history.get(identityKey(request.identity))!
          .filter((event) => event.snapshot.version > (request.afterVersion ?? -1)),
      ));
    }),
  }));
}

export function layerEventAuthoritySim(args: Readonly<{
  initialAgentEvents?: readonly TSequencedEvent<TAgentEvent>[];
}>) {
  const agentEvents = [...(args.initialAgentEvents ?? [])];
  return Layer.succeed(EventAuthority, EventAuthority.of({
    publishAgent: (event) => Effect.sync(() => {
      const sequence = (agentEvents.at(-1)?.sequence ?? 0) + 1;
      agentEvents.push({ event, sequence });
      return sequence;
    }),
    agent: (request) => Effect.succeed(
      (request.afterSequence ?? 0) > (agentEvents.at(-1)?.sequence ?? 0)
        ? Stream.fail(new EventProgramError(
            'EVENT_CURSOR_INVALID',
            'Simulated event cursor is ahead of authority; resync is required.',
          ))
        : Stream.fromIterable(
            agentEvents.filter((record) => record.sequence > (request.afterSequence ?? 0)),
          ),
    ),
    db: () => Effect.succeed(Stream.empty),
    notifications: () => Effect.succeed(Stream.empty),
  }));
}

export function layerWidgetAuthoritySim(args: Readonly<{
  entries: readonly TWidgetCatalogEntry[];
}>) {
  const entries = new Map(args.entries.map((entry) => [entry.widgetKey, entry]));
  const publications: TWidgetPublicationResult[] = [];
  return Layer.succeed(WidgetAuthority, WidgetAuthority.of({
    catalog: () => Effect.sync(() => [...entries.values()]
      .sort((left, right) => left.widgetKey.localeCompare(right.widgetKey))),
    publish: (request) => Effect.suspend(() => {
      const entry = entries.get(request.widgetKey);
      if (entry === undefined) {
        return Effect.fail(new WidgetProgramError('WIDGET_NOT_FOUND', 'Simulated widget was not found.'));
      }
      if (entry.generation !== request.expectedGeneration) {
        return Effect.fail(new WidgetProgramError(
          'WIDGET_CATALOG_CHANGED',
          'Simulated widget generation changed.',
        ));
      }
      if (
        entry.catalogDigestSha256 !== request.expectedCatalogDigestSha256
        || entry.draftManifestDigestSha256 !== request.expectedManifestDigestSha256
      ) {
        return Effect.fail(new WidgetProgramError(
          'WIDGET_CATALOG_CHANGED',
          'Simulated widget publication fence changed.',
        ));
      }
      const result = {
        widgetKey: entry.widgetKey,
        generation: entry.generation + 1,
        published: true,
      } as const;
      entries.set(entry.widgetKey, {
        ...entry,
        generation: result.generation,
        catalogDigestSha256: `sim-catalog-${result.generation}`,
        available: true,
      });
      publications.push(result);
      return Effect.succeed(result);
    }),
    events: (request) => Effect.succeed(
      (request.afterGeneration ?? 0) > (
        publications.at(-1)?.generation
          ?? Math.max(0, ...[...entries.values()].map((entry) => entry.generation))
      )
        ? Stream.fail(new WidgetProgramError(
            'WIDGET_CURSOR_INVALID',
            'Simulated widget cursor is ahead of authority; refresh the catalog.',
          ))
        : Stream.fromIterable(
            publications.filter((event) => event.generation > (request.afterGeneration ?? 0)),
          ),
    ),
  }));
}
