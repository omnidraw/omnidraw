import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  BUILTIN_THEMES,
  THEME_ID_DARK,
  ThemeService,
} from '@omnidraw/service-theme';
import { createReproductionTrace } from '../../src/debug-trace/createReproductionTrace';
import type { TCanvasDependencies } from '../../src/types';

const runtimeMocks = vi.hoisted(() => {
  let shell = { kind: 'canvas' as const, widgetId: null } as
    | { kind: 'canvas'; widgetId: null }
    | { kind: 'maximized-widget'; widgetId: string };
  let shellListener: ((state: typeof shell) => void) | null = null;
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
    gridVisible: vi.fn(() => true),
    openImagePicker: vi.fn(),
    restoreMaximizedWidget: vi.fn(() => true),
    selectionStyles: vi.fn(() => null),
    shell: vi.fn(() => shell),
    subscribeShell: vi.fn((listener: (state: typeof shell) => void) => {
      shellListener = listener;
      return () => { shellListener = null; };
    }),
    setGridVisible: vi.fn(() => true),
    shutdown: vi.fn(async () => {}),
    widgetContentFocused: vi.fn(() => false),
  };
  return {
    runtime,
    setActiveTool,
    setShell(next: typeof shell) {
      shell = next;
      shellListener?.(next);
    },
    resetShell() {
      shell = { kind: 'canvas', widgetId: null };
      shellListener = null;
    },
  };
});

vi.mock('../../src/runtime', () => ({
  buildRuntime: vi.fn(() => runtimeMocks.runtime),
}));

import { Canvas } from '../../src/components/Canvas';

let dispose: (() => void) | null = null;
const traceOwners: Array<ReturnType<typeof createReproductionTrace>> = [];

const themeService = {
  getTheme: () => BUILTIN_THEMES[0],
  getThemeColorPickerPalette: () => ({ fillQuick: [], strokeQuick: [] }),
  getStrokeWidthOptions: () => [],
  subscribeThemeChange: () => () => {},
} as never;

function createTrace() {
  const trace = createReproductionTrace({
    environment: () => ({
      applicationVersion: 'test',
      buildMode: 'test',
      canvasId: 'canvas-1',
      cangineVersion: 'test',
      browser: 'test',
      platform: 'test',
      viewport: { width: 1_000, height: 800 },
      devicePixelRatio: 1,
    }),
    monotonicNow: () => 0,
    wallClockNow: () => new Date(0),
    defer: (callback) => queueMicrotask(callback),
    schedule: () => () => {},
    writeClipboard: async () => {},
    createObjectUrl: () => 'blob:test',
    revokeObjectUrl: () => {},
    download: () => {},
  });
  traceOwners.push(trace);
  return trace;
}

function dependencies(
  overrides: Partial<TCanvasDependencies> = {},
): TCanvasDependencies {
  return {
    transport: {} as never,
    image: {
      cloneImage: vi.fn(async () => ({ url: 'test://image-clone' })),
      deleteImage: vi.fn(async () => ({ ok: true as const })),
      uploadImage: vi.fn(async () => ({ url: 'test://image' })),
    },
    notification: {
      showError: vi.fn(),
      showInfo: vi.fn(),
      showSuccess: vi.fn(),
    },
    themeService,
    createId: () => 'test-id',
    wait: {
      wait: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    },
    ...overrides,
  };
}

const AI_CHAT_TOOL = Object.freeze({
  kind: 'tool',
  id: 'ai-chat',
  label: 'AI Chat',
  Icon: () => null,
  toolId: 'widget',
  shortcuts: [{ key: 'c', label: 'C' }],
}) satisfies NonNullable<TCanvasDependencies['toolbarContributions']>[number];

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
  for (const trace of traceOwners.splice(0)) trace.dispose();
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  runtimeMocks.resetShell();
});

describe('Canvas host contributions', () => {
  test('unmounts canvas overlays and restores by Escape for the exclusive widget shell', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' },
      hostScopeKey: 'test-scope',
      dependencies: dependencies(),
    }), host);
    await vi.waitFor(() => expect(host.querySelector('.vc-canvas-toolbar-anchor')).not.toBeNull());

    runtimeMocks.setShell({ kind: 'maximized-widget', widgetId: 'widget-1' });
    await vi.waitFor(() => expect(host.querySelector('.vc-canvas-toolbar-anchor')).toBeNull());
    expect(host.querySelector('.vc-selection-style-menu')).toBeNull();

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    host.querySelector('.vc-canvas-host')?.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'r',
    }));
    expect(runtimeMocks.setActiveTool).not.toHaveBeenCalledWith('rect');

    const escape = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    });
    document.dispatchEvent(escape);
    expect(runtimeMocks.runtime.restoreMaximizedWidget).toHaveBeenCalledOnce();

    runtimeMocks.runtime.restoreMaximizedWidget.mockClear();
    const widgetContent = document.createElement('button');
    widgetContent.dataset.omnidrawPortalId = 'widget-1';
    widgetContent.addEventListener('keydown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    host.querySelector('.vc-canvas-engine-host')?.append(widgetContent);
    widgetContent.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: 'Escape',
    }));
    await Promise.resolve();
    expect(runtimeMocks.runtime.restoreMaximizedWidget).toHaveBeenCalledOnce();

    runtimeMocks.runtime.restoreMaximizedWidget.mockClear();
    const widgetModalRoot = document.createElement('div');
    widgetModalRoot.setAttribute('role', 'dialog');
    const widgetModal = document.createElement('button');
    widgetModalRoot.dataset.omnidrawPortalId = 'widget-1';
    widgetModalRoot.append(widgetModal);
    widgetModal.addEventListener('keydown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    host.querySelector('.vc-canvas-engine-host')?.append(widgetModalRoot);
    widgetModal.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: 'Escape',
    }));
    await Promise.resolve();
    expect(runtimeMocks.runtime.restoreMaximizedWidget).not.toHaveBeenCalled();

    const nativeDialog = document.createElement('dialog');
    nativeDialog.open = true;
    nativeDialog.dataset.omnidrawPortalId = 'widget-1';
    const nativeDialogButton = document.createElement('button');
    nativeDialog.append(nativeDialogButton);
    host.querySelector('.vc-canvas-engine-host')?.append(nativeDialog);
    nativeDialogButton.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: 'Escape',
    }));
    await Promise.resolve();
    expect(runtimeMocks.runtime.restoreMaximizedWidget).not.toHaveBeenCalled();

    runtimeMocks.setShell({ kind: 'canvas', widgetId: null });
    await vi.waitFor(() => expect(host.querySelector('.vc-canvas-toolbar-anchor')).not.toBeNull());
  });

  test('renders and uses core tools without product extensions', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' },
      hostScopeKey: 'test-scope',
      dependencies: dependencies(),
    }), host);
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledOnce();
    });

    expect(host.querySelector('[aria-label="AI Chat"]')).toBeNull();
    expect(host.querySelector('[aria-label="Toggle sidebar"]')).toBeNull();
    const productKey = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'c',
    });
    document.dispatchEvent(productKey);
    expect(productKey.defaultPrevented).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'r',
    }));
    expect(runtimeMocks.setActiveTool).toHaveBeenCalledWith('rect');
  });

  test('keeps passive and active DOM motion out of Smart traces', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' },
      hostScopeKey: 'test-scope',
      dependencies: dependencies({ diagnostics: createTrace() }),
    }), host);
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledOnce();
    });
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      code: 'KeyG',
      key: 'g',
    }));
    expect(runtimeMocks.runtime.setGridVisible).toHaveBeenCalledWith(false);
    host.querySelector<HTMLButtonElement>('button[aria-label="Grid"]')?.click();
    expect(runtimeMocks.runtime.setGridVisible).toHaveBeenLastCalledWith(true);

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
      canvas: { id: 'canvas-1' },
      hostScopeKey: 'test-scope',
      dependencies: dependencies(),
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
      canvas: { id: 'canvas-1' },
      hostScopeKey: 'test-scope',
      dependencies: dependencies({ toolbarContributions: [AI_CHAT_TOOL] }),
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
    widgetContent.dataset.omnidrawPortalId = 'widget-1';
    canvasSurface?.append(widgetContent);
    widgetContent.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyC',
      key: 'c',
    }));
    expect(runtimeMocks.setActiveTool).not.toHaveBeenCalled();
  });

  test('runs a host action contribution through its primary shortcut', async () => {
    const onActivate = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' },
      hostScopeKey: 'test-scope',
      dependencies: dependencies({
        toolbarContributions: [{
          kind: 'action',
          id: 'shell-panel',
          label: 'Toggle shell panel',
          Icon: () => null,
          placement: 'persistent',
          shortcuts: [{ key: 'b', label: 'Ctrl+B', primary: true }],
          onActivate,
        }],
      }),
    }), host);
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledOnce();
    });

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'b',
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onActivate).toHaveBeenCalledOnce();
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle shell panel"]',
    )?.click();
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  test('routes document shortcuts to only the active canvas root', async () => {
    const activateA = vi.fn();
    const activateB = vi.fn();
    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    document.body.append(hostA, hostB);
    const contribution = (id: string, onActivate: () => void) => ({
      kind: 'action' as const,
      id,
      label: `Action ${id}`,
      Icon: () => null,
      shortcuts: [{ key: 'b', label: 'Ctrl+B', primary: true }],
      onActivate,
    });
    const disposeA = render(() => Canvas({
      canvas: { id: 'canvas-a' },
      hostScopeKey: 'test-scope-a',
      dependencies: dependencies({
        toolbarContributions: [contribution('a', activateA)],
      }),
    }), hostA);
    const disposeB = render(() => Canvas({
      canvas: { id: 'canvas-b' },
      hostScopeKey: 'test-scope-b',
      dependencies: dependencies({
        toolbarContributions: [contribution('b', activateB)],
      }),
    }), hostB);
    dispose = () => {
      disposeB();
      disposeA();
    };
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledTimes(2);
    });

    hostA.querySelector<HTMLElement>('.vc-canvas-host')?.dispatchEvent(
      pointerEvent('pointerdown', 1, 10),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'b',
    }));
    expect(activateA).toHaveBeenCalledOnce();
    expect(activateB).not.toHaveBeenCalled();

    hostB.querySelector<HTMLElement>('.vc-canvas-host')?.dispatchEvent(
      pointerEvent('pointerdown', 1, 20),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'b',
    }));
    expect(activateA).toHaveBeenCalledOnce();
    expect(activateB).toHaveBeenCalledOnce();
  });

  test('binds keyboard and blur effects to the canvas owner realm', async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const ownerDocument = iframe.contentDocument!;
    const ownerWindow = iframe.contentWindow!;
    const host = ownerDocument.createElement('div');
    ownerDocument.body.append(host);
    const addDocumentListener = vi.spyOn(ownerDocument, 'addEventListener');
    const addWindowListener = vi.spyOn(ownerWindow, 'addEventListener');
    const removeDocumentListener = vi.spyOn(ownerDocument, 'removeEventListener');
    const removeWindowListener = vi.spyOn(ownerWindow, 'removeEventListener');
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' },
      hostScopeKey: 'test-scope',
      dependencies: dependencies(),
    }), host);
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledOnce();
    });

    expect(addDocumentListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
      true,
    );
    expect(addWindowListener).toHaveBeenCalledWith(
      'blur',
      expect.any(Function),
    );
    runtimeMocks.runtime.setGridVisible.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    expect(runtimeMocks.runtime.setGridVisible).not.toHaveBeenCalled();
    ownerDocument.dispatchEvent(new ownerWindow.KeyboardEvent(
      'keydown',
      { key: 'g' },
    ));
    expect(runtimeMocks.runtime.setGridVisible).toHaveBeenCalledWith(false);

    dispose();
    dispose = null;
    expect(removeDocumentListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
      true,
    );
    expect(removeWindowListener).toHaveBeenCalledWith(
      'blur',
      expect.any(Function),
    );
  });

  test('applies theme variables only to the owning canvas host', async () => {
    const shell = document.createElement('div');
    const host = document.createElement('div');
    document.body.append(shell, host);
    const instanceTheme = new ThemeService();
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' },
      hostScopeKey: 'test-scope',
      dependencies: dependencies({ themeService: instanceTheme }),
    }), host);
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledOnce();
    });
    const canvasRoot = host.querySelector<HTMLElement>('.vc-canvas-host')!;

    instanceTheme.setTheme(THEME_ID_DARK);

    expect(canvasRoot.dataset.themeId).toBe(THEME_ID_DARK);
    expect(canvasRoot.dataset.themeAppearance).toBe('dark');
    expect(canvasRoot.style.getPropertyValue('--background')).toBe(
      instanceTheme.getTheme().ui.background,
    );
    expect(shell.dataset.themeId).toBeUndefined();
    expect(shell.style.getPropertyValue('--background')).toBe('');
    expect(shell.classList.contains('dark')).toBe(false);
  });

  test('registers runtime retirement and lets the host await shutdown', async () => {
    let retireRuntime!: () => Promise<void>;
    let releaseShutdown!: () => void;
    const shutdownBlocked = new Promise<void>((resolve) => {
      releaseShutdown = resolve;
    });
    const unregister = vi.fn();
    runtimeMocks.runtime.shutdown.mockImplementationOnce(() => shutdownBlocked);
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => Canvas({
      canvas: { id: 'canvas-1' },
      hostScopeKey: 'test-scope',
      dependencies: dependencies({
        runtimeRetirement: {
          register: (retire) => {
            retireRuntime = retire;
            return unregister;
          },
        },
      }),
    }), host);
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.boot).toHaveBeenCalledOnce();
    });

    let retirementComplete = false;
    const retiring = retireRuntime().then(() => {
      retirementComplete = true;
    });
    await vi.waitFor(() => {
      expect(runtimeMocks.runtime.shutdown).toHaveBeenCalledOnce();
    });
    expect(retirementComplete).toBe(false);

    releaseShutdown();
    await retiring;
    expect(retirementComplete).toBe(true);

    dispose();
    dispose = null;
    await vi.waitFor(() => {
      expect(unregister).toHaveBeenCalledOnce();
    });
  });
});
