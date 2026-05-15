import type { TVisualizerScenario } from '../types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const pingPongScenario: TVisualizerScenario = {
  id: 'ping-pong',
  name: 'Ping pong network',
  description: 'Two actors bounce messages through an output connection. Send msg.in.ping to Ping to start.',
  canvasId: 'canvas-ping-pong',
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
