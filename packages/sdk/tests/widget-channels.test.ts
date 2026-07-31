import { afterEach, describe, expect, test } from 'bun:test';
import {
  capsuleGuestMock,
  loadWidgetSdk,
} from './capsule-guest.mock';

const {
  deleteWidgetLocalState,
  emitWidgetOutput,
  getWidgetLocalState,
  getWidgetProps,
  getWidgetTheme,
  listWidgetLocalStateKeys,
  registerWidgetSnapshotHooks,
  setWidgetLocalState,
  subscribeWidgetLifecycle,
  subscribeWidgetProps,
  subscribeWidgetTheme,
} = await loadWidgetSdk();

afterEach(() => {
  capsuleGuestMock.reset();
});

describe('Capsule guest channels', () => {
  test('reads channels, delivers updates, emits outputs, and disposes listeners', () => {
    capsuleGuestMock.props = { count: 1 };
    capsuleGuestMock.theme = {
      format: 'omnidraw.widget-theme.v1',
      appearance: 'dark',
      tokens: {
        background: '#000',
        foreground: '#fff',
        surface: '#111',
        surfaceForeground: '#fff',
        muted: '#222',
        mutedForeground: '#aaa',
        primary: '#fd0',
        primaryForeground: '#000',
        accent: '#333',
        accentForeground: '#fff',
        destructive: '#f00',
        success: '#0f0',
        border: '#444',
      },
    };
    expect(getWidgetProps()).toEqual({ count: 1 });
    expect(getWidgetTheme()).toEqual(capsuleGuestMock.theme);

    const props: unknown[] = [];
    const themes: unknown[] = [];
    const lifecycle: unknown[] = [];
    const stopProps = subscribeWidgetProps((value) => props.push(value));
    const stopTheme = subscribeWidgetTheme((value) => themes.push(value));
    const stopLifecycle = subscribeWidgetLifecycle((value) => lifecycle.push(value));

    capsuleGuestMock.emitProps({ count: 2 });
    capsuleGuestMock.emitTheme({
      ...capsuleGuestMock.theme as Record<string, unknown>,
      appearance: 'light',
    });
    capsuleGuestMock.emitLifecycle({ state: 'throttled', generation: 2 });
    expect(props).toEqual([{ count: 2 }]);
    expect(themes).toEqual([expect.objectContaining({ appearance: 'light' })]);
    expect(lifecycle).toEqual([{ state: 'throttled', generation: 2 }]);

    stopProps();
    stopProps();
    stopTheme();
    stopLifecycle();
    expect(capsuleGuestMock.listenerCounts()).toEqual({
      props: 0,
      theme: 0,
      lifecycle: 0,
    });

    emitWidgetOutput({
      type: 'notification',
      tone: 'success',
      message: 'Saved',
    });
    expect(capsuleGuestMock.outputs).toEqual([{
      type: 'notification',
      tone: 'success',
      message: 'Saved',
    }]);
  });

  test('wraps volatile local state and the sealed snapshot hook registration', () => {
    expect(getWidgetLocalState('draft')).toBeUndefined();
    setWidgetLocalState('draft', { title: 'Capsule' });
    setWidgetLocalState('other', 1);
    expect(getWidgetLocalState('draft')).toEqual({ title: 'Capsule' });
    expect(listWidgetLocalStateKeys()).toEqual(['draft', 'other']);
    expect(deleteWidgetLocalState('draft')).toBe(true);
    expect(deleteWidgetLocalState('draft')).toBe(false);

    const hooks = {
      capture: () => ({ selected: true }),
      restore: () => undefined,
    };
    registerWidgetSnapshotHooks(hooks);
    expect(capsuleGuestMock.snapshotHooks).toBe(hooks);
  });
});
