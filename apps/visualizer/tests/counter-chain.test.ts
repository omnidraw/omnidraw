import { afterEach, describe, expect, test } from 'bun:test';
import { VisualizerRuntime } from '../src/runtime';
import { counterChainScenario } from '../src/scenarios/counter-chain';

let runtime: VisualizerRuntime | null = null;

function getActors(snapshot: any) {
  return Object.fromEntries(snapshot.actors.map((actor: any) => [actor.id, actor]));
}

describe('counter-chain visualizer scenario', () => {
  afterEach(async () => {
    await runtime?.stopServices();
    runtime = null;
  });

  test('declares the source, sink, connection, and required effects', () => {
    expect(counterChainScenario.id).toBe('counter-chain');
    expect(counterChainScenario.actors.map((actor) => actor.id)).toEqual(['actor-source', 'actor-sink']);
    expect(counterChainScenario.connections).toEqual([
      {
        id: 'conn-source-sink',
        sourceActorId: 'actor-source',
        targetActorId: 'actor-sink',
        outputName: 'msg.out.incremented',
        label: 'incremented event',
      },
    ]);
    expect(Object.keys(counterChainScenario.effects).sort()).toEqual(['fn.emitIncremented', 'fn.recordIncrement', 'tx.increment']);
  });

  test('boots both actors, increments source, emits output, and records it in sink', async () => {
    runtime = new VisualizerRuntime('counter-chain');
    await runtime.start();
    await runtime.drain();

    await runtime.sendMessage('actor-source', 'msg.in.increment', { by: 3 });
    await runtime.drain();

    const snapshot = runtime.snapshot() as any;
    const actors = getActors(snapshot);
    const source = actors['actor-source'];
    const sink = actors['actor-sink'];

    expect(source.status).toBe('running');
    expect(source.machine_state).toBe('ready');
    expect(source.machine_context).toEqual({ total: 3, increments: 1, lastBy: 3 });
    expect(source.outputs).toHaveLength(1);
    expect(source.outputs[0].output_name).toBe('msg.out.incremented');
    expect(source.outputs[0].payload).toEqual({ total: 3, by: 3, increments: 1 });

    expect(sink.status).toBe('running');
    expect(sink.machine_state).toBe('ready');
    expect(sink.machine_context).toEqual({
      total: 3,
      lastTotal: 3,
      receivedCount: 1,
      received: [{ total: 3, by: 3, increments: 1 }],
    });

    expect(source.inbox.map((row: any) => row.status)).toEqual(['processed', 'processed']);
    expect(sink.inbox.map((row: any) => row.status)).toEqual(['processed', 'processed']);
    expect(snapshot.global.workflowSteps.map((step: any) => `${step.function_kind}:${step.function_name}:${step.status}`)).toEqual([
      'tx:tx.increment:succeeded',
      'fn:fn.emitIncremented:succeeded',
      'fn:fn.recordIncrement:succeeded',
    ]);
  });

  test('defaults increment amount to one and accumulates multiple messages', async () => {
    runtime = new VisualizerRuntime('counter-chain');
    await runtime.start();
    await runtime.drain();

    await runtime.sendMessage('actor-source', 'msg.in.increment', {});
    await runtime.drain();
    await runtime.sendMessage('actor-source', 'msg.in.increment', { by: 4 });
    await runtime.drain();

    const snapshot = runtime.snapshot() as any;
    const actors = getActors(snapshot);

    expect(actors['actor-source'].machine_context).toEqual({ total: 5, increments: 2, lastBy: 4 });
    expect(actors['actor-source'].outputs.map((row: any) => row.payload)).toEqual([
      { total: 1, by: 1, increments: 1 },
      { total: 5, by: 4, increments: 2 },
    ]);
    expect(actors['actor-sink'].machine_context).toEqual({
      total: 5,
      lastTotal: 5,
      receivedCount: 2,
      received: [
        { total: 1, by: 1, increments: 1 },
        { total: 5, by: 4, increments: 2 },
      ],
    });
  });
});
