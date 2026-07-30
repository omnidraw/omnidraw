import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LOCAL_BROWSER_TENANT_SCOPE } from '../../src/CONSTANTS';

const runtimeMocks = vi.hoisted(() => {
  const setActiveTool = vi.fn();
  const editor = {
    history: {
      redo: vi.fn(),
      undo: vi.fn(),
    },
    setActiveTool,
    state: {
      activeToolId: 'select',
      canRedo: false,
      canUndo: false,
      revision: 0,
      selectedNodeIds: [],
    },
    subscribe: vi.fn(() => () => {}),
  };
  const runtime = {
    boot: vi.fn(async () => {}),
    document: vi.fn(() => null),
    editor: vi.fn(() => editor),
    engine: vi.fn(() => null),
    selectionStyles: vi.fn(() => null),
    shutdown: vi.fn(async () => {}),
    widgetContentFocused: vi.fn(() => false),
  };
  return { runtime, setActiveTool };
});

vi.mock('../../src/runtime', () => ({
  buildRuntime: vi.fn(() => runtimeMocks.runtime),
}));

import { Canvas } from '../../src/components/Canvas';

let dispose: (() => void) | null = null;

function pointerEvent(
  type: string,
  buttons: number,
  x: number,
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: type === 'pointerdown' || type === 'pointerup' ? 0 : -1,
    buttons,
    clientX: x,
    clientY: 20,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
    pressure: { value: buttons === 0 ? 0 : 0.5 },
  });
  return event;
}

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Canvas AI Chat shortcut', () => {
  test('keeps passive and active DOM motion out of Smart traces', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' } as never,
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      transport: {} as never,
      image: {
        deleteImage: vi.fn(async () => ({ ok: true as const })),
        uploadImage: vi.fn(async () => ({
          url: 'test://image',
          width: 1,
          height: 1,
        })),
      },
      store: {
        sidebarVisible: () => true,
        onToggleSidebar: vi.fn(),
      },
      notification: {
        showError: vi.fn(),
        showInfo: vi.fn(),
        showSuccess: vi.fn(),
      },
      themeService: {} as never,
      diagnostics: {
        reproductionTrace: true,
        applicationVersion: 'test',
        buildMode: 'development',
        cangineVersion: 'test',
      },
    }), host);
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledOnce();
    });

    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Developer trace: idle"]',
    )?.click();
    await Promise.resolve();
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Record'))
      ?.click();
    await Promise.resolve();

    const canvasRoot = host.querySelector<HTMLElement>('.vc-canvas-host');
    expect(canvasRoot).not.toBeNull();
    canvasRoot!.hasPointerCapture = () => false;
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Stop'))
      ?.dispatchEvent(pointerEvent('pointerdown', 1, 5));
    await Promise.resolve();
    expect(host.querySelector('.vc-trace-metrics dd')?.textContent).toBe('0');
    for (let index = 0; index < 19; index += 1) {
      canvasRoot?.dispatchEvent(pointerEvent('pointermove', 0, index));
    }
    await Promise.resolve();
    expect(host.querySelector('.vc-trace-metrics dd')?.textContent).toBe('0');
    canvasRoot?.dispatchEvent(pointerEvent('pointermove', 0, 9));
    await Promise.resolve();
    expect(host.querySelector('.vc-trace-metrics dd')?.textContent).toBe('0');

    canvasRoot?.dispatchEvent(pointerEvent('pointerdown', 1, 10));
    canvasRoot?.dispatchEvent(pointerEvent('pointermove', 1, 11));
    canvasRoot?.dispatchEvent(pointerEvent('pointerup', 0, 12));
    await Promise.resolve();
    expect(host.querySelector('.vc-trace-metrics dd')?.textContent).toBe('2');

    for (let index = 0; index < 19; index += 1) {
      canvasRoot?.dispatchEvent(pointerEvent('pointermove', 0, 20 + index));
    }
    await Promise.resolve();
    expect(host.querySelector('.vc-trace-metrics dd')?.textContent).toBe('2');

    canvasRoot?.dispatchEvent(pointerEvent('pointermove', 0, 30));
    await Promise.resolve();
    expect(host.querySelector('.vc-trace-metrics dd')?.textContent).toBe('2');
  });

  test('does not install trace capture listeners without diagnostics', async () => {
    const addEventListener = vi.spyOn(
      HTMLDivElement.prototype,
      'addEventListener',
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' } as never,
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      transport: {} as never,
      image: {
        deleteImage: vi.fn(async () => ({ ok: true as const })),
        uploadImage: vi.fn(async () => ({
          url: 'test://image',
          width: 1,
          height: 1,
        })),
      },
      store: {
        sidebarVisible: () => true,
        onToggleSidebar: vi.fn(),
      },
      notification: {
        showError: vi.fn(),
        showInfo: vi.fn(),
        showSuccess: vi.fn(),
      },
      themeService: {} as never,
      diagnostics: false,
    }), host);
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledOnce();
    });

    const rootCalls = addEventListener.mock.calls.filter((_, index) => {
      const target = addEventListener.mock.contexts[index];
      return (
        target instanceof HTMLDivElement
        && target.classList.contains('vc-canvas-host')
      );
    });
    expect(rootCalls.some(([type]) => type === 'gotpointercapture')).toBe(false);
    expect(rootCalls.filter(([type]) => type === 'pointermove')).toHaveLength(1);
    addEventListener.mockRestore();
  });

  test('selects the Cangine widget creation tool when C is pressed', async () => {
    runtimeMocks.runtime.widgetContentFocused.mockReturnValue(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' } as never,
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      transport: {} as never,
      image: {
        deleteImage: vi.fn(async () => ({ ok: true as const })),
        uploadImage: vi.fn(async () => ({
          url: 'test://image',
          width: 1,
          height: 1,
        })),
      },
      store: {
        sidebarVisible: () => true,
        onToggleSidebar: vi.fn(),
      },
      notification: {
        showError: vi.fn(),
        showInfo: vi.fn(),
        showSuccess: vi.fn(),
      },
      themeService: {} as never,
    }), host);
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledOnce();
    });

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyC',
      key: 'c',
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(runtimeMocks.setActiveTool).toHaveBeenCalledOnce();
    expect(runtimeMocks.setActiveTool).toHaveBeenCalledWith('widget');

    runtimeMocks.setActiveTool.mockClear();
    runtimeMocks.runtime.widgetContentFocused.mockReturnValue(true);
    const canvasSurface = host.querySelector<HTMLElement>(
      '.vc-canvas-engine-host',
    );
    expect(canvasSurface).not.toBeNull();
    const canvasKeydown = vi.fn();
    canvasSurface?.addEventListener('keydown', canvasKeydown);
    canvasSurface?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyC',
      key: 'c',
    }));
    expect(runtimeMocks.setActiveTool).toHaveBeenCalledOnce();
    expect(runtimeMocks.setActiveTool).toHaveBeenCalledWith('widget');
    expect(canvasKeydown).not.toHaveBeenCalled();

    runtimeMocks.setActiveTool.mockClear();
    const widgetContent = document.createElement('div');
    widgetContent.dataset.vibecanvasPortalId = 'widget-1';
    canvasSurface?.append(widgetContent);
    widgetContent.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyC',
      key: 'c',
    }));
    expect(runtimeMocks.setActiveTool).not.toHaveBeenCalled();
  });
});
