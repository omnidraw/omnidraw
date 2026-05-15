import type { TVisualizerExplainer, TVisualizerScenario } from '../types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const pingPongExplainer: TVisualizerExplainer = {
  title: 'How Ping pong network works',
  x: 420,
  y: 520,
  blocks: [
    { kind: 'heading', text: 'One-way ping to pong' },
    {
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'Send ' },
        { kind: 'code', text: 'msg.in.ping' },
        { kind: 'text', text: ' to Ping Actor. Ping updates its local count and emits ' },
        { kind: 'code', text: 'msg.out.pong' },
        { kind: 'text', text: ', which is routed to Pong Actor as ' },
        { kind: 'code', text: 'msg.in.pong' },
        { kind: 'text', text: '.' },
      ],
    },
    {
      kind: 'list',
      items: [
        [{ kind: 'strong', text: 'Ping Actor' }, { kind: 'text', text: ' runs ' }, { kind: 'code', text: 'fn.bump' }, { kind: 'text', text: ' and ' }, { kind: 'code', text: 'fx.makePong' }, { kind: 'text', text: '.' }],
        [{ kind: 'strong', text: 'Pong Actor' }, { kind: 'text', text: ' only records the incoming pong in local context; it does not emit a reply.' }],
        [{ kind: 'strong', text: 'Timeline' }, { kind: 'text', text: ' shows the input event, output event, and routed input with shared correlation.' }],
      ],
    },
  ],
};

export const pingPongScenario: TVisualizerScenario = {
  id: 'ping-pong',
  name: 'Ping pong network',
  description: 'Two actors bounce messages through an output connection. Send msg.in.ping to Ping to start.',
  canvasId: 'canvas-ping-pong',
  explainer: pingPongExplainer,
  actors: [
    {
      id: 'actor-ping',
      definitionId: 'def-ping',
      revisionId: 'rev-ping',
      elementId: 'element-ping',
      displayName: 'Ping Actor',
      x: 300,
      y: 180,
      initialState: 'idle',
      initialContext: { count: 0, last: 'none' },
      machineConfig: {
        initialState: 'idle',
        initialContext: { count: 0, last: 'none' },
        states: {
          idle: {
            on: {
              'msg.in.booting': { target: 'ready', actions: ['fn.boot'] },
              'msg.in.ping': { target: 'ready', actions: ['fn.bump', 'fx.makePong'] },
            },
          },
          ready: {
            on: {
              'msg.in.ping': { target: 'ready', actions: ['fn.bump', 'fx.makePong'] },
            },
          },
        },
      },
    },
    {
      id: 'actor-pong',
      definitionId: 'def-pong',
      revisionId: 'rev-pong',
      elementId: 'element-pong',
      displayName: 'Pong Actor',
      x: 760,
      y: 180,
      initialState: 'idle',
      initialContext: { count: 0, last: 'none' },
      machineConfig: {
        initialState: 'idle',
        initialContext: { count: 0, last: 'none' },
        states: {
          idle: {
            on: {
              'msg.in.booting': { target: 'ready', actions: ['fn.boot'] },
              'msg.in.pong': { target: 'ready', actions: ['fn.bump'] },
            },
          },
          ready: {
            on: {
              'msg.in.pong': { target: 'ready', actions: ['fn.bump'] },
            },
          },
        },
      },
    },
  ],
  connections: [
    { id: 'conn-ping-pong', sourceActorId: 'actor-ping', targetActorId: 'actor-pong', outputName: 'msg.out.pong', label: 'pong output' },
  ],
  effects: {
    'fn.boot': ({ context }) => ({ context: { ...asRecord(context), booted: true } }),
    'fn.bump': ({ context, message }) => {
      const record = asRecord(context);
      const count = typeof record.count === 'number' ? record.count : 0;
      return { context: { ...record, count: count + 1, last: message.name } };
    },
    'fx.makePong': ({ message }) => ({ outputs: [{ name: 'msg.out.pong', payload: { from: 'ping', echo: message.payload } }] }),
  },
};
