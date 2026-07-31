import { describe, expect, test, vi } from 'vitest';
import { createReproductionTrace } from '../../src/debug-trace/createReproductionTrace';

function fixture() {
  let monotonic = 100;
  let nextScheduleId = 0;
  const clipboard: string[] = [];
  const downloads: Array<Readonly<{ filename: string; url: string }>> = [];
  const scheduled = new Map<number, () => void>();
  const trace = createReproductionTrace({
    environment: () => ({
      applicationVersion: 'test',
      buildMode: 'test',
      canvasId: 'canvas-a',
      cangineVersion: '0.5.3',
      browser: 'test',
      platform: 'test',
      viewport: { width: 1_000, height: 800 },
      devicePixelRatio: 2,
    }),
    monotonicNow: () => monotonic,
    wallClockNow: () => new Date('2026-07-30T00:00:00.000Z'),
    defer: (callback) => queueMicrotask(callback),
    schedule: (callback) => {
      nextScheduleId += 1;
      const scheduleId = nextScheduleId;
      scheduled.set(scheduleId, callback);
      return () => scheduled.delete(scheduleId);
    },
    writeClipboard: async (text) => {
      clipboard.push(text);
    },
    createObjectUrl: () => 'blob:test',
    revokeObjectUrl: vi.fn(),
    download: (args) => downloads.push(args),
  });
  return {
    trace,
    clipboard,
    downloads,
    runScheduled() {
      const callbacks = [...scheduled.values()];
      scheduled.clear();
      for (const callback of callbacks) callback();
    },
    advance(ms: number) {
      monotonic += ms;
    },
  };
}

describe('createReproductionTrace', () => {
  test('is inert until started and requires clear before another recording', async () => {
    const test = fixture();
    const lifecycle: boolean[] = [];
    test.trace.subscribeLifecycle((recording) => lifecycle.push(recording));
    test.trace.emit({ channel: 'system', type: 'ignored' });
    expect(test.trace.state().retainedEvents).toBe(0);

    expect(test.trace.start([
      'system',
      'input.dom',
      'input.engine',
      'transform',
      'document',
      'transport',
    ])).toBe(true);
    test.advance(25);
    test.trace.emit({
      channel: 'input.dom',
      type: 'pointer-down',
      priority: 'critical',
      correlation: { gestureId: 'dom-gesture-a', pointerId: '1' },
    });
    test.trace.emit({
      channel: 'input.engine',
      type: 'pointer-down',
      priority: 'critical',
      correlation: { pointerId: '1', nodeId: 'node-a' },
    });
    test.trace.emit({
      channel: 'transform',
      type: 'transform-commit',
      priority: 'critical',
      correlation: { gestureId: 'cangine-gesture-a', pointerId: '1' },
    });
    test.trace.emit({
      channel: 'document',
      type: 'local-request',
      priority: 'critical',
      correlation: { transactionId: 'transaction-a' },
    });
    test.trace.emit({
      channel: 'document',
      type: 'pending-queued',
      priority: 'critical',
      correlation: {
        transactionId: 'transaction-a',
        commandId: 'command-a',
      },
    });
    expect(test.trace.mark()).toBe(true);
    expect(test.trace.state().status).toBe('marked');
    expect(test.trace.stop()).toBe(true);
    expect(test.trace.start()).toBe(false);

    const artifact = test.trace.artifacts()?.copy;
    expect(artifact?.text).toContain('g1@');
    expect(artifact?.text).toContain('[MARK]');
    expect(artifact?.text).toContain('transform=commit');
    expect(artifact?.text).not.toContain('dom-gesture-a');
    expect(artifact?.text).not.toContain('cangine-gesture-a');
    expect(artifact?.text).not.toContain('transaction-a');
    expect(artifact?.text).not.toContain('command-a');
    expect(artifact?.text).not.toContain('schemaVersion');
    expect(artifact?.text).not.toContain('"priority"');
    expect(artifact?.summary.gestureChains).toContainEqual({
      gestureId: 'dom-gesture-a',
      sequences: expect.any(Array),
      channels: expect.arrayContaining([
        'input.dom',
        'input.engine',
        'transform',
        'document',
      ]),
    });
    await expect(test.trace.copy()).resolves.toBe(true);
    expect(test.clipboard).toHaveLength(1);
    expect(test.trace.download()).toBe(true);
    expect(test.downloads[0]?.filename).toMatch(
      /^omnidraw-trace-canvas-a-/,
    );
    expect(lifecycle).toEqual([false, true, false]);

    test.trace.clear();
    expect(test.trace.state().status).toBe('idle');
    expect(test.trace.start()).toBe(true);
  });

  test('records enabled channels and exports after the marked tail', () => {
    const test = fixture();
    test.trace.start(['system', 'document']);
    test.trace.emit({ channel: 'input.dom', type: 'pointer-down' });
    test.trace.emit({ channel: 'document', type: 'local-request' });
    test.trace.mark();

    expect(test.trace.state().retainedEvents).toBe(2);
    expect(test.trace.state().status).toBe('marked');
    expect(test.trace.state().canExport).toBe(false);
    expect(test.trace.artifacts()).toBeNull();
    test.advance(5_000);
    test.runScheduled();
    expect(test.trace.state().status).toBe('stopped');
    expect(test.trace.artifacts()?.copy.text).not.toContain('"pointer-down"');
    expect(test.trace.artifacts()?.copy.text).toContain('[MARK]');
    expect(test.trace.artifacts()?.copy.text).not.toContain('trace-stopped');
  });

  test('expires a transform correlation before a later unrelated mutation', async () => {
    const test = fixture();
    test.trace.start(['system', 'transform', 'document']);
    test.trace.emit({
      channel: 'transform',
      type: 'transform-commit',
      priority: 'critical',
      correlation: { gestureId: 'failed-gesture', pointerId: '1' },
    });
    await Promise.resolve();
    test.trace.emit({
      channel: 'document',
      type: 'local-request',
      priority: 'critical',
      correlation: { transactionId: 'unrelated-transaction' },
    });
    test.trace.stop();

    const artifact = test.trace.artifacts()?.copy;
    expect(artifact?.summary.anomalies.map((entry) => entry.rule)).toContain(
      'transform-commit-without-editor-mutation',
    );
    expect(artifact?.summary.gestureChains).toContainEqual({
      gestureId: 'failed-gesture',
      sequences: expect.any(Array),
      channels: ['transform'],
    });
  });

  test('retires transaction and command correlations at terminal boundaries', () => {
    const test = fixture();
    test.trace.start(['system', 'transform', 'document', 'transport']);
    test.trace.emit({
      channel: 'transform',
      type: 'transform-commit',
      correlation: { gestureId: 'gesture-a', pointerId: '1' },
    });
    test.trace.emit({
      channel: 'document',
      type: 'local-request',
      correlation: { transactionId: 'transaction-a' },
    });
    test.trace.emit({
      channel: 'document',
      type: 'pending-queued',
      correlation: {
        transactionId: 'transaction-a',
        commandId: 'command-a',
      },
    });
    test.trace.emit({
      channel: 'document',
      type: 'pending-retired',
      correlation: {
        transactionId: 'transaction-a',
        commandId: 'command-a',
      },
    });
    test.trace.emit({
      channel: 'transport',
      type: 'late-observation',
      correlation: { commandId: 'command-a' },
    });
    test.trace.stop();

    const text = test.trace.artifacts()?.download.text ?? '';
    const late = text
      .split('\n')
      .find((line) => line.includes('"type":"late-observation"'));
    expect(late).not.toContain('"gestureId"');
  });
});
