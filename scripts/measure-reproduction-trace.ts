/**
 * @file Measures bounded Cangine scene reduction plus trace capture cost
 * independently of total canvas size.
 */

import type {
  TLayerNode,
  TRectNode,
  TSceneSnapshot,
  TSerializedSceneCommand,
} from '@omnidraw/cangine';
import {
  createSceneReductionState,
  reduceSerializedSceneCommands,
} from '@omnidraw/cangine/scene';
import {
  createReproductionTrace,
} from '../packages/canvas/src/debug-trace/createReproductionTrace';

const ITERATIONS = 2_000;

function rect(id: string, x = 0): TRectNode {
  return {
    id,
    parentId: 'content',
    orderKey: id,
    kind: 'rect',
    transform: {
      position: { x, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    size: { width: 100, height: 60 },
  };
}

function document(size: number): TSceneSnapshot {
  const content: TLayerNode = {
    id: 'content',
    parentId: null,
    orderKey: 'A',
    kind: 'layer',
    role: 'content',
    coordinateSpace: 'world',
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
  };
  return {
    schemaVersion: '1.0.0',
    rootLayerIds: [content.id],
    nodes: [
      content,
      ...Array.from({ length: size }, (_, index) => rect(`rect-${index}`)),
    ],
  };
}

function commands(index: number): readonly TSerializedSceneCommand[] {
  return [{ type: 'upsert', node: rect('rect-0', index + 1) }];
}

function measure(totalNodes: number, recording: boolean) {
  const state = createSceneReductionState(document(totalNodes));
  const trace = createReproductionTrace({
    environment: () => ({
      applicationVersion: 'measurement',
      buildMode: 'development',
      canvasId: 'measurement',
      cangineVersion: '0.6.0',
      browser: 'bun',
      platform: process.platform,
      viewport: { width: 1_000, height: 800 },
      devicePixelRatio: 1,
    }),
    monotonicNow: () => performance.now(),
    wallClockNow: () => new Date(0),
    defer: (callback) => queueMicrotask(callback),
    schedule: () => () => {},
    writeClipboard: async () => {},
    createObjectUrl: () => '',
    revokeObjectUrl: () => {},
    download: () => {},
  });
  if (recording) trace.start(['document', 'system']);
  const startedAt = performance.now();
  for (let index = 0; index < ITERATIONS; index += 1) {
    const reduction = reduceSerializedSceneCommands(state, commands(index));
    trace.emit({
      channel: 'document',
      type: 'durable-plan-prepared',
      priority: 'critical',
      correlation: { transactionId: `transaction-${index}` },
      data: {
        nodeIds: reduction.changes.map((change) => change.nodeId),
        operationCount: 1,
      },
    });
  }
  const durationMs = performance.now() - startedAt;
  return {
    totalNodes,
    affectedNodes: 1,
    recording,
    iterations: ITERATIONS,
    durationMs: Math.round(durationMs * 100) / 100,
    microsecondsPerIteration: Math.round(
      (durationMs * 1_000 / ITERATIONS) * 100,
    ) / 100,
    retainedTraceEvents: trace.state().retainedEvents,
  };
}

console.log(JSON.stringify([
  measure(100, false),
  measure(10_000, false),
  measure(100, true),
  measure(10_000, true),
], null, 2));
