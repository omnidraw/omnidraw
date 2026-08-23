import { Effect } from 'effect';
import { SimulationError, SimulationWorld } from './service.simulation-world';

export type TWidgetPublicationState = Readonly<{
  acceptedGeneration: number;
  loadedGeneration: number;
  lastGoodGeneration: number;
}>;

/**
 * Models publication and runtime-load as two logical nodes. A stale load may
 * finish after publication but can never replace the accepted generation.
 */
export function txSimulateWidgetPublicationLoadRace(args: Readonly<{
  before: TWidgetPublicationState;
  publishingGeneration: number;
}>): Effect.Effect<TWidgetPublicationState, SimulationError, SimulationWorld> {
  return Effect.gen(function*() {
    const world = yield* SimulationWorld;
    const order = yield* world.choose({
      stream: 'widget.publication-load',
      label: 'publish-or-load-completes-first',
      optionCount: 2,
    });
    const afterPublish: TWidgetPublicationState = {
      acceptedGeneration: args.publishingGeneration,
      loadedGeneration: order === 0
        ? args.publishingGeneration
        : args.before.loadedGeneration,
      lastGoodGeneration: args.publishingGeneration,
    };
    const afterLateLoad: TWidgetPublicationState = {
      ...afterPublish,
      loadedGeneration: Math.max(
        afterPublish.loadedGeneration,
        afterPublish.acceptedGeneration,
      ),
    };
    yield* world.observe({
      label: 'widget.publication.accepted',
      value: afterLateLoad,
    });
    return afterLateLoad;
  });
}

export type TCancellableCommitState = Readonly<{
  operationId: string;
  commitCount: number;
  acknowledged: boolean;
  cancelled: boolean;
}>;

/** A stable operation id makes a retry after a lost acknowledgement observable exactly once. */
export function txSimulateCancellableCommit(args: Readonly<{
  state: TCancellableCommitState;
  cancelRequested: boolean;
}>): Effect.Effect<TCancellableCommitState, SimulationError, SimulationWorld> {
  return Effect.gen(function*() {
    const world = yield* SimulationWorld;
    if (args.state.commitCount > 0) {
      yield* world.observe({ label: 'operation.duplicate', value: args.state.operationId });
      return args.state;
    }
    const beforeCommit = yield* world.fault({ point: 'operation.before-commit' });
    if (beforeCommit === 'fail-before') {
      return { ...args.state, cancelled: args.cancelRequested };
    }
    const committed: TCancellableCommitState = {
      ...args.state,
      commitCount: 1,
      acknowledged: false,
      cancelled: args.cancelRequested,
    };
    yield* world.observe({ label: 'operation.committed', value: committed.operationId });
    const afterCommit = beforeCommit === 'commit-then-lost-ack'
      ? beforeCommit
      : yield* world.fault({ point: 'operation.after-commit' });
    return afterCommit === 'commit-then-lost-ack'
      ? committed
      : { ...committed, acknowledged: true };
  });
}
