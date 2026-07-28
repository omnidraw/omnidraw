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

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('Canvas AI Chat shortcut', () => {
  test('selects the Cangine widget creation tool when C is pressed', async () => {
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
  });
});
