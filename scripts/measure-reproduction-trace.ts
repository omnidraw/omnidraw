/**
 * @file Measures bounded local-reduction plus trace capture cost independently
 * of total canvas size.
 */

import type { TRectNode, TSceneNode } from '@omnidraw/cangine';
import type {
  TEditorSceneMutationRequest,
} from '@omnidraw/cangine/editor';
import {
  createReproductionTrace,
} from '../packages/canvas/src/debug-trace/createReproductionTrace';
import {
  fnReduceLocalDocument,
} from '../packages/canvas/src/services/fn.local-document';

const ITERATIONS = 2_000;

function rect(id: string, x = 0): TRectNode {
  return {
    id,
    parentId: null,
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

function document(size: number): ReadonlyMap<string, TSceneNode> {
  return new Map(Array.from({ length: size }, (_, index) => {
    const node = rect(`rect-${index}`);
    return [node.id, node];
  }));
}

function request(index: number): TEditorSceneMutationRequest {
  return {
    transactionId: `transaction-${index}`,
    basisSceneRevision: 0,
    source: 'trace-measurement',
    commands: [{ type: 'upsert', node: rect('rect-0', index + 1) }],
    affectedNodeIds: ['rect-0'],
  };
}

function measure(totalNodes: number, recording: boolean) {
  const nodes = document(totalNodes);
  const trace = createReproductionTrace({
    environment: () => ({
      applicationVersion: 'measurement',
      buildMode: 'development',
      canvasId: 'measurement',
      cangineVersion: '0.2.6',
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
    const reduced = fnReduceLocalDocument(nodes, request(index));
    trace.emit({
      channel: 'document',
      type: 'durable-plan-prepared',
      priority: 'critical',
      correlation: { transactionId: `transaction-${index}` },
      data: {
        nodeIds: reduced.affectedNodeIds,
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
