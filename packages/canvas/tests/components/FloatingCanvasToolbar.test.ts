import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { FloatingCanvasToolbar } from '../../src/components/FloatingCanvasToolbar';
import type {
  TReproductionTraceOwner,
  TReproductionTraceState,
} from '../../src/debug-trace/typed';

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe('FloatingCanvasToolbar', () => {
  test('renders an ordered host tool contribution and selects its editor tool', () => {
    const onSelectTool = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => FloatingCanvasToolbar({
      activeToolId: null,
      canRedo: false,
      canUndo: false,
      contributions: [{
        kind: 'tool',
        id: 'ai-chat',
        label: 'AI Chat',
        Icon: () => null,
        toolId: 'widget',
        shortcuts: [{ key: 'c', label: 'C' }],
      }],
      gridVisible: true,
      onRedo: () => {},
      onImportImage: () => {},
      onSelectTool,
      onToggleGrid: () => {},
      onUndo: () => {},
    }), host);

    const aiChatButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="AI Chat"]',
    );
    expect(aiChatButton).not.toBeNull();
    expect(host.querySelector(
      'button[aria-label^="Developer trace:"]',
    )).toBeNull();
    expect(aiChatButton?.textContent).toContain('C');

    aiChatButton?.click();

    expect(onSelectTool).toHaveBeenCalledOnce();
    expect(onSelectTool).toHaveBeenCalledWith('widget');
  });

  test('provides the development trace workflow only when an owner is injected', async () => {
    let status: TReproductionTraceState['status'] = 'idle';
    const listeners = new Set<(state: TReproductionTraceState) => void>();
    const state = (): TReproductionTraceState => ({
      status,
      elapsedMs: 0,
      retainedEvents: status === 'idle' ? 0 : 2,
      omittedEvents: 0,
      estimatedBytes: status === 'idle' ? 0 : 256,
      markedSequence: status === 'marked' ? 2 : null,
      enabledChannels: ['system'],
      canStart: status === 'idle',
      canMark: status === 'recording',
      canStop: status === 'recording' || status === 'marked',
      canExport: status === 'stopped',
      canClear: status === 'idle' || status === 'stopped',
    });
    const publish = () => {
      for (const listener of listeners) listener(state());
    };
    const trace = {
      state,
      isRecording: () => status === 'recording' || status === 'marked',
      mode: () => 'smart' as const,
      elapsedMs: () => 0,
      emit: () => {},
      start: () => {
        status = 'recording';
        publish();
        return true;
      },
      mark: () => {
        status = 'marked';
        publish();
        return true;
      },
      stop: () => {
        status = 'stopped';
        publish();
        return true;
      },
      clear: () => {
        status = 'idle';
        publish();
      },
      copy: async () => true,
      download: () => true,
      artifacts: () => null,
      subscribe: (listener: (next: TReproductionTraceState) => void) => {
        listeners.add(listener);
        listener(state());
        return () => listeners.delete(listener);
      },
      subscribeLifecycle: () => () => {},
      dispose: () => {},
    } satisfies TReproductionTraceOwner;
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => FloatingCanvasToolbar({
      activeToolId: null,
      canRedo: false,
      canUndo: false,
      gridVisible: true,
      onRedo: () => {},
      onImportImage: () => {},
      onSelectTool: () => {},
      onToggleGrid: () => {},
      onUndo: () => {},
      trace,
    }), host);

    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Developer trace: idle"]',
    )?.click();
    await Promise.resolve();
    const record = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Record'));
    expect(record).not.toBeUndefined();
    expect(record?.disabled).toBe(false);
    record?.click();
    expect(status).toBe('recording');
    await Promise.resolve();
    expect(host.querySelector(
      'button[aria-label="Developer trace: recording"]',
    )).not.toBeNull();

    const mark = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Mark Failure'));
    mark?.click();
    await Promise.resolve();
    expect(host.querySelector(
      'button[aria-label="Developer trace: marked"]',
    )).not.toBeNull();
    expect(host.textContent).toContain('Capturing 5s tail');
    expect([...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Copy for Agent'))
    ).toBeUndefined();

    const stop = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Stop now'));
    stop?.click();
    await Promise.resolve();
    expect(status).toBe('stopped');
    expect([...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Copy for Agent'))
      ?.disabled).toBe(false);
    expect(host.querySelector('.omnidraw-trace-panel')?.parentElement?.classList)
      .toContain('omnidraw-trace-control');
  });
});
