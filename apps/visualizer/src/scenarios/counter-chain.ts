import type { TVisualizerExplainer, TVisualizerScenario } from '../types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const counterChainExplainer: TVisualizerExplainer = {
  title: 'How Counter chain works',
  x: 420,
  y: 610,
  blocks: [
    { kind: 'heading', text: 'Message flow' },
    {
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'Send ' },
        { kind: 'code', text: 'msg.in.increment' },
        { kind: 'text', text: ' to Source Counter. The source actor updates its local context, then emits ' },
        { kind: 'code', text: 'msg.out.incremented' },
        { kind: 'text', text: '.' },
      ],
    },
    {
      kind: 'list',
      items: [
        [{ kind: 'strong', text: 'Source ctx' }, { kind: 'text', text: ' stores total, increment count, and the last increment amount.' }],
        [{ kind: 'strong', text: 'Connection' }, { kind: 'text', text: ' maps ' }, { kind: 'code', text: 'msg.out.incremented' }, { kind: 'text', text: ' into Sink Ledger as ' }, { kind: 'code', text: 'msg.in.incremented' }, { kind: 'text', text: '.' }],
        [{ kind: 'strong', text: 'Sink ctx' }, { kind: 'text', text: ' records each payload and keeps the latest total visible.' }],
      ],
    },
  ],
};

export const counterChainScenario: TVisualizerScenario = {
  id: 'counter-chain',
  name: 'Counter chain',
  description: 'A source actor increments a running total, emits msg.out.incremented, and a sink actor keeps a ledger plus the latest full counter total.',
  canvasId: 'canvas-counter-chain',
  explainer: counterChainExplainer,
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
