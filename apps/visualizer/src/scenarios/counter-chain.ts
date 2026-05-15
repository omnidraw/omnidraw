import type { TVisualizerScenario } from '../types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const counterChainScenario: TVisualizerScenario = {
  id: 'counter-chain',
  name: 'Counter chain',
  description: 'A source actor increments a running total, emits msg.out.incremented, and a sink actor keeps a ledger plus the latest full counter total.',
  canvasId: 'canvas-counter-chain',
  actors: [
    {
      id: 'actor-source',
      definitionId: 'def-source',
      revisionId: 'rev-source',
      elementId: 'element-source',
      displayName: 'Source Counter',
      x: 260,
      y: 390,
      initialState: 'idle',
      initialContext: { total: 0, increments: 0, lastBy: 0 },
      machineConfig: {
        initialState: 'idle',
        initialContext: { total: 0, increments: 0, lastBy: 0 },
        states: {
          idle: { on: { 'msg.in.booting': { target: 'ready' }, 'msg.in.increment': { target: 'ready', actions: ['tx.increment', 'fn.emitIncremented'] } } },
          ready: { on: { 'msg.in.increment': { target: 'ready', actions: ['tx.increment', 'fn.emitIncremented'] } } },
        },
      },
    },
    {
      id: 'actor-sink',
      definitionId: 'def-sink',
      revisionId: 'rev-sink',
      elementId: 'element-sink',
      displayName: 'Sink Ledger',
      x: 760,
      y: 390,
      initialState: 'idle',
      initialContext: { total: 0, lastTotal: 0, receivedCount: 0, received: [] },
      machineConfig: {
        initialState: 'idle',
        initialContext: { total: 0, lastTotal: 0, receivedCount: 0, received: [] },
        states: {
          idle: { on: { 'msg.in.booting': { target: 'ready' }, 'msg.in.incremented': { target: 'ready', actions: ['fn.recordIncrement'] } } },
          ready: { on: { 'msg.in.incremented': { target: 'ready', actions: ['fn.recordIncrement'] } } },
        },
      },
    },
  ],
  connections: [
    { id: 'conn-source-sink', sourceActorId: 'actor-source', targetActorId: 'actor-sink', outputName: 'msg.out.incremented', label: 'incremented event' },
  ],
  effects: {
    'tx.increment': ({ context, message }) => {
      const record = asRecord(context);
      const by = asRecord(message.payload).by;
      const amount = typeof by === 'number' ? by : 1;
      const total = (typeof record.total === 'number' ? record.total : 0) + amount;
      const increments = (typeof record.increments === 'number' ? record.increments : 0) + 1;
      return { context: { ...record, total, increments, lastBy: amount } };
    },
    'fn.emitIncremented': ({ context }) => {
      const record = asRecord(context);
      const total = typeof record.total === 'number' ? record.total : 0;
      const by = typeof record.lastBy === 'number' ? record.lastBy : 1;
      const increments = typeof record.increments === 'number' ? record.increments : 0;
      return { outputs: [{ name: 'msg.out.incremented', payload: { total, by, increments } }] };
    },
    'fn.recordIncrement': ({ context, message }) => {
      const record = asRecord(context);
      const payload = asRecord(message.payload);
      const received = Array.isArray(record.received) ? record.received : [];
      const total = typeof payload.total === 'number'
        ? payload.total
        : (typeof record.total === 'number' ? record.total : 0);
      const receivedCount = (typeof record.receivedCount === 'number' ? record.receivedCount : received.length) + 1;
      return {
        context: {
          ...record,
          total,
          lastTotal: total,
          receivedCount,
          received: [...received, payload],
        },
      };
    },
  },
};
