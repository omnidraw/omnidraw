import { describe, expect, test } from 'vitest';
import {
  REPRODUCTION_TRACE_COPY_BUDGET_BYTES,
  REPRODUCTION_TRACE_DOWNLOAD_BUDGET_BYTES,
} from '../../src/debug-trace/CONSTANTS';
import {
  fnBuildReproductionTraceArtifact,
  fnCompactReproductionTraceEvents,
  fnPrepareReproductionTraceEvent,
  fnSanitizeReproductionTraceValue,
} from '../../src/debug-trace/fn.reproduction-trace';
import type {
  TReproductionTraceEvent,
  TReproductionTraceHeader,
} from '../../src/debug-trace/typed';

const header: TReproductionTraceHeader = {
  kind: 'omnidraw-developer-trace',
  schemaVersion: 1,
  mode: 'smart',
  startedAt: '2026-07-30T00:00:00.000Z',
  environment: {
    applicationVersion: 'test',
    buildMode: 'test',
    canvasId: 'canvas-a',
    cangineVersion: '0.6.0',
    browser: 'test',
    platform: 'test',
    viewport: { width: 1_000, height: 800 },
    devicePixelRatio: 2,
  },
  enabledChannels: ['input.dom', 'transform', 'document', 'transport', 'system'],
  budgets: {
    copyBytes: 128 * 1_024,
    downloadBytes: 2 * 1_024 * 1_024,
    maxEvents: 12_000,
    markTailMs: 5_000,
  },
};

function traceEvent(
  sequence: number,
  type: string,
  overrides: Partial<TReproductionTraceEvent> = {},
): TReproductionTraceEvent {
  return {
    sequence,
    elapsedMs: sequence,
    channel: 'input.dom',
    type,
    priority: 'normal',
    ...overrides,
  };
}

describe('reproduction trace pure pipeline', () => {
  test('reduces Smart input to causal boundaries and compact dimensions', () => {
    const passive = {
      channel: 'input.engine' as const,
      type: 'pointer-move',
      data: { world: { x: 10, y: 20 }, hit: { nodeId: 'node-a' } },
    };
    expect(fnPrepareReproductionTraceEvent({
      event: passive,
      mode: 'smart',
    })).toBeNull();
    expect(fnPrepareReproductionTraceEvent({
      event: passive,
      mode: 'advanced',
    })).toBe(passive);

    expect(fnPrepareReproductionTraceEvent({
      mode: 'smart',
      event: {
        channel: 'input.dom',
        type: 'pointer-down',
        data: {
          phase: 1,
          pointerType: 'mouse',
          button: 0,
          buttons: 1,
          pressure: 0.5,
          client: { x: 10, y: 20 },
          viewport: { x: 10, y: 20 },
          modifiers: {
            alt: false,
            control: false,
            meta: false,
            shift: true,
          },
          cancelable: true,
          defaultPrevented: false,
          target: { role: 'canvas' },
          captureOwner: null,
        },
      },
    })?.data).toEqual({
      pointer: 'mouse',
      button: 0,
      buttons: 1,
      at: [10, 20],
      mods: ['shift'],
      target: { role: 'canvas' },
    });
  });

  test('redacts secrets, data URLs, cycles, and bounded structures', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = fnSanitizeReproductionTraceValue({
      authorization: 'Bearer secret',
      nested: {
        image: 'data:image/png;base64,abcdef',
        long: 'x'.repeat(900),
        message: 'request failed with Bearer should-not-export',
      },
      cyclic,
    });

    expect(result.redacted).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(result.value)).not.toContain('Bearer secret');
    expect(JSON.stringify(result.value)).not.toContain('base64,abcdef');
    expect(JSON.stringify(result.value)).not.toContain('should-not-export');
    expect(JSON.stringify(result.value)).toContain('secret-key');
    expect(JSON.stringify(result.value)).toContain('cyclic-reference');
  });

  test('coalesces repetitive samples while preserving first and last', () => {
    const compacted = fnCompactReproductionTraceEvents([
      traceEvent(1, 'pointer-down', { priority: 'critical' }),
      traceEvent(2, 'pointer-move', { priority: 'low' }),
      traceEvent(3, 'pointer-move', { priority: 'low' }),
      traceEvent(4, 'pointer-move', { priority: 'low' }),
      traceEvent(5, 'pointer-move', { priority: 'low' }),
      traceEvent(6, 'pointer-up', { priority: 'critical' }),
    ]);

    expect(compacted.coalesced).toBe(2);
    expect(compacted.summarized).toBe(1);
    expect(compacted.events.map((event) => event.sequence)).toEqual([
      1, 2, 4, 5, 6,
    ]);
    expect(compacted.events.map((event) => event.type)).toContain(
      'samples-coalesced',
    );
  });

  test('retains modifier, target, direction, and observed-state changes', () => {
    const move = (
      sequence: number,
      x: number,
      data: Readonly<Record<string, unknown>> = {},
    ) => traceEvent(sequence, 'pointer-move', {
      priority: 'low',
      data: {
        client: { x, y: 0 },
        modifiers: { shift: false },
        target: { nodeId: 'node-a' },
        ...data,
      },
    });
    const compacted = fnCompactReproductionTraceEvents([
      move(1, 0),
      move(2, 10),
      move(3, 20),
      move(4, 10),
      move(5, 0, { modifiers: { shift: true } }),
      move(6, -10, { target: { nodeId: 'node-b' } }),
      traceEvent(7, 'state-observed', {
        channel: 'editor',
        data: { revision: 1, selectedNodeIds: ['node-a'] },
      }),
      traceEvent(8, 'state-observed', {
        channel: 'editor',
        data: { revision: 2, selectedNodeIds: ['node-b'] },
      }),
    ]);
    const sequences = compacted.events.map((event) => event.sequence);

    expect(sequences).toEqual(expect.arrayContaining([3, 4, 5, 6, 7, 8]));
    expect(compacted.events.find(
      (event) => event.sequence === 5,
    )?.data).toMatchObject({ modifiers: { shift: true } });
  });

  test('stays inside the exact copy budget and reports omissions', () => {
    const events = [
      traceEvent(1, 'pointer-down', {
        priority: 'critical',
        correlation: { pointerId: '1', gestureId: 'gesture-a' },
      }),
      ...Array.from({ length: 2_000 }, (_, index) => traceEvent(
        index + 2,
        `sample-${index}`,
        {
          priority: 'low',
          data: {
            valueA: 'x'.repeat(500),
            valueB: 'x'.repeat(500),
            valueC: 'x'.repeat(500),
            valueD: 'x'.repeat(500),
            index,
          },
        },
      )),
      traceEvent(2_002, 'failure-marked', {
        channel: 'system',
        priority: 'critical',
      }),
      traceEvent(2_003, 'pointer-up', {
        priority: 'critical',
        correlation: { pointerId: '1', gestureId: 'gesture-a' },
      }),
    ];
    const artifact = fnBuildReproductionTraceArtifact({
      budgetBytes: REPRODUCTION_TRACE_COPY_BUDGET_BYTES,
      events,
      header,
      markedSequence: 2_002,
      omittedBeforeExport: 0,
      status: 'stopped',
    });

    expect(artifact.bytes).toBeLessThanOrEqual(
      REPRODUCTION_TRACE_COPY_BUDGET_BYTES,
    );
    expect(artifact.summary.omissions.omitted).toBeGreaterThan(0);
    expect(artifact.text).toContain('[MARK]');
    expect(artifact.text).toContain('g1@');
    expect(artifact.text).toContain('click');

    const download = fnBuildReproductionTraceArtifact({
      budgetBytes: REPRODUCTION_TRACE_DOWNLOAD_BUDGET_BYTES,
      events,
      header,
      markedSequence: 2_002,
      omittedBeforeExport: 0,
      status: 'stopped',
    });
    expect(download.bytes).toBeLessThanOrEqual(
      REPRODUCTION_TRACE_DOWNLOAD_BUDGET_BYTES,
    );
    expect(download.summary.omissions.omitted).toBeGreaterThan(0);
    expect(download.text).toContain('"type":"failure-marked"');
  });

  test('reports only mechanically supported broken-edge candidates', () => {
    const events = [
      traceEvent(1, 'transform-begin', {
        channel: 'transform',
        priority: 'critical',
        correlation: { gestureId: 'gesture-a', pointerId: '1' },
      }),
      traceEvent(2, 'projection-applied', {
        channel: 'document',
        priority: 'critical',
        correlation: {
          gestureId: 'gesture-b',
          transactionId: 'transaction-b',
        },
      }),
      traceEvent(3, 'execute-failed', {
        channel: 'transport',
        priority: 'critical',
        correlation: { commandId: 'command-c' },
      }),
    ];
    const artifact = fnBuildReproductionTraceArtifact({
      budgetBytes: REPRODUCTION_TRACE_COPY_BUDGET_BYTES,
      events,
      header,
      markedSequence: null,
      omittedBeforeExport: 0,
      status: 'stopped',
    });

    expect(artifact.summary.anomalies.map((entry) => entry.rule)).toEqual([
      'transform-without-terminal',
      'projection-without-command-dispatch',
      'command-failure',
    ]);
    expect(artifact.summary.anomalies.every(
      (entry) => entry.kind === 'possible anomaly',
    )).toBe(true);
  });

  test('compresses a marked click into one aliased gesture and flags its missing edge', () => {
    const events = [
      traceEvent(1, 'pointer-down', {
        priority: 'critical',
        correlation: { gestureId: 'long-gesture-id', pointerId: '1' },
        data: { at: [10.123, 20.987] },
      }),
      traceEvent(2, 'pointer-down', {
        channel: 'input.engine',
        correlation: { gestureId: 'long-gesture-id', pointerId: '1' },
        data: { world: [10, 20] },
      }),
      traceEvent(3, 'pointer-up', {
        priority: 'critical',
        correlation: { gestureId: 'long-gesture-id', pointerId: '1' },
        data: { at: [10.123, 20.987] },
      }),
      traceEvent(4, 'failure-marked', {
        channel: 'system',
        priority: 'critical',
      }),
    ];
    const artifact = fnBuildReproductionTraceArtifact({
      budgetBytes: REPRODUCTION_TRACE_COPY_BUDGET_BYTES,
      events,
      header,
      markedSequence: 4,
      omittedBeforeExport: 0,
      status: 'stopped',
    });

    expect(artifact.text).toContain(
      'g1@1-3 #1-3 [MARK] click empty [10.1,21]→[10.1,21] input=dom>engine transform=none',
    );
    expect(artifact.text).not.toContain('long-gesture-id');
    expect(artifact.summary.anomalies.map((entry) => entry.rule)).toContain(
      'marked-gesture-without-transform',
    );
  });

  test('folds a successful gesture persistence chain into one outcome row', () => {
    const correlation = {
      gestureId: 'gesture-long',
      pointerId: '1',
      nodeId: 'node-long',
    };
    const events = [
      traceEvent(1, 'pointer-down', {
        correlation,
        data: { at: [10, 20] },
      }),
      traceEvent(2, 'pointer-down', {
        channel: 'input.engine',
        correlation,
      }),
      traceEvent(3, 'transform-begin', {
        channel: 'transform',
        correlation,
        data: { at: [1, 2], handle: 'move', nodes: ['node-long'] },
      }),
      traceEvent(4, 'transform-commit', {
        channel: 'transform',
        correlation,
        data: { at: [11, 12], handle: 'move', nodes: ['node-long'] },
      }),
      traceEvent(5, 'local-request', {
        channel: 'document',
        correlation: {
          ...correlation,
          transactionId: 'transaction-long',
        },
        data: { accepted: 7 },
      }),
      traceEvent(6, 'command-dispatched', {
        channel: 'document',
        correlation: {
          ...correlation,
          transactionId: 'transaction-long',
          commandId: 'command-long',
        },
      }),
      traceEvent(7, 'execute-received', {
        channel: 'transport',
        correlation: {
          gestureId: correlation.gestureId,
          commandId: 'command-long',
        },
        data: { durationMs: 9.44, revision: 8 },
      }),
      traceEvent(8, 'acknowledgement-accepted', {
        channel: 'document',
        correlation: {
          ...correlation,
          transactionId: 'transaction-long',
          commandId: 'command-long',
        },
        data: { accepted: 8 },
      }),
    ];
    const artifact = fnBuildReproductionTraceArtifact({
      budgetBytes: REPRODUCTION_TRACE_COPY_BUDGET_BYTES,
      events,
      header,
      markedSequence: null,
      omittedBeforeExport: 0,
      status: 'stopped',
    });

    expect(artifact.text).toContain(
      'g1@1-8 #1-8 drag n1 [1,2]→[11,12] input=dom>engine transform=commit persist=ok r7→8 9.4ms',
    );
    expect(artifact.text).not.toContain('gesture-long');
    expect(artifact.text).not.toContain('node-long');
    expect(artifact.text).not.toContain('transaction-long');
    expect(artifact.text).not.toContain('command-long');
  });
});
