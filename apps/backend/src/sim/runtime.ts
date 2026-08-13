import { Layer, ManagedRuntime, Scheduler } from 'effect';
import { TestClock } from 'effect/testing';
import { layerSimulationCapabilities } from './layer.simulation-capabilities';
import { layerSimulationWorld } from './layer.simulation-world';
import { SeededSimulationScheduler } from './scheduler';
import type { SimulationWorld } from './service.simulation-world';
import type { TSimulationConfig } from './types';

export function createSimulationRuntime(config: TSimulationConfig) {
  const clockLayer = TestClock.layer({ warningDelay: '1 hour' });
  const scheduler = new SeededSimulationScheduler(config.rootSeed, {
    replayChoices: config.replay?.schedule,
  });
  // TestClock implements Clock structurally, but the RC.108 Layer type does not
  // subtract its narrower service type from the world's Clock requirement.
  const worldLayer = layerSimulationWorld(config, scheduler).pipe(
    Layer.provide(clockLayer),
  ) as Layer.Layer<SimulationWorld>;
  const worldAndClock = Layer.merge(worldLayer, clockLayer);
  const controlledWorld = layerSimulationCapabilities(config).pipe(
    Layer.provideMerge(worldAndClock),
  );
  const applicationLayer = Layer.merge(
    controlledWorld,
    Layer.succeed(Scheduler.Scheduler)(scheduler),
  );
  const runtime = ManagedRuntime.make(applicationLayer);
  return Object.assign(runtime, { scheduler });
}
