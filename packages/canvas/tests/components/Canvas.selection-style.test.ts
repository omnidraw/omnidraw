import type { TSelectionStyleState } from '@omnidraw/cangine/editor';
import {
  BUILTIN_THEMES,
  type TThemeDefinition,
} from '@omnidraw/service-theme';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';

const controllerState = (
  propertyId: 'background' | 'foreground',
): TSelectionStyleState => ({
  revision: 1,
  status: 'attached',
  selectedRootIds: ['rect'],
  controls: [{
    id: propertyId,
    label: propertyId,
    coverage: {
      selectedRootCount: 1,
      candidateTargetCount: 1,
      eligibleTargetCount: 1,
    },
    value: {
      status: 'shared',
      value: { space: 'srgb', r: 0, g: 0, b: 0, a: 1 },
    },
  }],
  actions: [],
  unavailable: [],
});

const runtimeMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    controller: {
      state: TSelectionStyleState;
      apply: ReturnType<typeof vi.fn>;
      beginContinuous: ReturnType<typeof vi.fn>;
      updateContinuous: ReturnType<typeof vi.fn>;
      endContinuous: ReturnType<typeof vi.fn>;
      listener: ((state: TSelectionStyleState) => void) | null;
      rawListener: ((state: TSelectionStyleState) => void) | null;
      unsubscribe: ReturnType<typeof vi.fn>;
      subscribe(listener: (state: TSelectionStyleState) => void): () => void;
    };
    runtime: object;
  }>,
}));

vi.mock('../../src/runtime', () => ({
  buildRuntime: vi.fn(() => {
    const unsubscribe = vi.fn();
    const controller = {
      state: controllerState('background'),
      apply: vi.fn(),
      beginContinuous: vi.fn(),
      updateContinuous: vi.fn(),
      endContinuous: vi.fn(),
      listener: null as ((state: TSelectionStyleState) => void) | null,
      rawListener: null as ((state: TSelectionStyleState) => void) | null,
      unsubscribe,
      subscribe(listener: (state: TSelectionStyleState) => void) {
        controller.listener = listener;
        controller.rawListener = listener;
        return () => {
          unsubscribe();
          controller.listener = null;
        };
      },
    };
    const editor = {
      history: { redo: vi.fn(), undo: vi.fn() },
      setActiveTool: vi.fn(),
      state: {
        activeToolId: 'select',
        canRedo: false,
        canUndo: false,
        revision: 0,
        selectedNodeIds: ['rect'],
      },
      subscribe: vi.fn(() => () => undefined),
    };
    const runtime = {
      boot: vi.fn(async () => undefined),
      document: vi.fn(() => null),
      editor: vi.fn(() => editor),
      engine: vi.fn(() => null),
      gridVisible: vi.fn(() => true),
      selectionStyles: vi.fn(() => controller),
      setGridVisible: vi.fn(() => true),
      shutdown: vi.fn(async () => undefined),
      widgetContentFocused: vi.fn(() => false),
    };
    runtimeMocks.instances.push({ controller, runtime });
    return runtime;
  }),
}));

import { Canvas } from '../../src/components/Canvas';

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  runtimeMocks.instances.length = 0;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('Canvas selection style binding', () => {
  test('routes UI intent to the current controller and rejects stale snapshots', async () => {
    const [canvas, setCanvas] = createSignal({ id: 'canvas-a' });
    let paletteLabel = 'Blue';
    let paletteColor = '#3b82f6';
    let paletteCode = 'blue' as const;
    let themeListener: ((theme: TThemeDefinition) => void) | null = null;
    const theme = BUILTIN_THEMES[0] as TThemeDefinition;
    const themeService = {
      getTheme: () => theme,
      subscribeThemeChange: (listener: (theme: TThemeDefinition) => void) => {
        themeListener = listener;
        return () => {
          themeListener = null;
        };
      },
      getThemeColorPickerPalette: () => ({
        fillQuick: [{
          code: paletteCode,
          label: paletteLabel,
          color: paletteColor,
          value: { space: 'srgb', r: 59 / 255, g: 130 / 255, b: 246 / 255, a: 1 },
        }],
        strokeQuick: [{
          code: paletteCode,
          label: paletteLabel,
          color: paletteColor,
          value: { space: 'srgb', r: 59 / 255, g: 130 / 255, b: 246 / 255, a: 1 },
        }],
      }),
      getStrokeWidthOptions: () => [],
    } as never;
    const host = document.createElement('div');
    document.body.append(host);
    const props = {
      get canvas() {
        return canvas() as never;
      },
      hostScopeKey: 'test-scope',
      dependencies: {
        transport: {} as never,
        image: {} as never,
        createId: () => 'test-id',
        wait: {
          wait: () => ({ promise: Promise.resolve(), cancel: () => {} }),
        },
        notification: {
          showError: vi.fn(),
          showInfo: vi.fn(),
          showSuccess: vi.fn(),
        },
        themeService,
      },
    };
    dispose = render(() => Canvas(props), host);

    await vi.waitFor(() => {
      expect(host.textContent).toContain('BACKGROUND');
    });
    host.querySelector<HTMLButtonElement>('[aria-label="BACKGROUND Blue"]')
      ?.click();
    expect(runtimeMocks.instances[0]?.controller.apply).toHaveBeenCalledWith(
      {
        propertyId: 'background',
        value: {
          space: 'srgb',
          r: 59 / 255,
          g: 130 / 255,
          b: 246 / 255,
          a: 1,
        },
      },
      {
        intent: {
          schemaVersion: 1,
          role: 'background',
          code: 'blue',
        },
      },
    );

    paletteLabel = 'Red';
    paletteColor = '#ef4444';
    paletteCode = 'blue';
    themeListener?.(theme);
    await vi.waitFor(() => {
      expect(host.querySelector<HTMLElement>(
        '[aria-label="BACKGROUND Red"]',
      )?.style.getPropertyValue('--vc-style-color')).toBe('#ef4444');
    });

    const oldController = runtimeMocks.instances[0]?.controller;
    setCanvas({ id: 'canvas-b' });
    await vi.waitFor(() => {
      expect(runtimeMocks.instances).toHaveLength(2);
    });
    expect(oldController?.unsubscribe).toHaveBeenCalledTimes(1);

    oldController?.rawListener?.(controllerState('foreground'));
    expect(host.textContent).toContain('BACKGROUND');
    expect(host.textContent).not.toContain('COLOR');

    const nextController = runtimeMocks.instances[1]?.controller;
    nextController?.listener?.(controllerState('foreground'));
    await vi.waitFor(() => {
      expect(host.textContent).toContain('COLOR');
    });
    expect(host.textContent).not.toContain('BACKGROUND');
  });
});
