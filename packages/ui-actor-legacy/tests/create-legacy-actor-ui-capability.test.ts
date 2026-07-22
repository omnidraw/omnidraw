import { describe, expect, test, vi } from 'vitest';
import { createLegacyActorUiCapability } from '../src';

describe('legacy actor UI capability', () => {
  test('discovers and reconciles legacy definitions only when explicitly installed', async () => {
    let definitions = [{
      name: 'Weather',
      health: 'ready',
      error: null,
      updated_at: '2026-07-20T00:00:00.000Z',
    }];
    let invalidateCatalog: () => void = () => undefined;
    const list = vi.fn(async () => [undefined, definitions] as const);
    const get = vi.fn(async () => [undefined, {
      def: {
        name: 'Weather',
        widget: { tool: { label: 'Weather', icon: null } },
      },
      widgetCode: [{ path: 'main.ts', content: 'export default {}' }],
    }] as const);
    const registerWidget = vi.fn();
    const unregisterWidget = vi.fn();
    const unsubscribe = vi.fn();
    const capability = createLegacyActorUiCapability({
      browser: {} as never,
      transport: {
        api: {
          actors: {
            definitions: { list, get },
          },
        },
      } as never,
    });
    const plugin = capability.createWidgetPlugin({
      application: {
        logError: vi.fn(),
        subscribeCatalogInvalidation: (
          _kind: 'resources' | 'widgets',
          listener: () => void,
        ) => {
          invalidateCatalog = listener;
          return unsubscribe;
        },
      } as never,
      widgetManager: {
        registerWidget,
        unregisterWidget,
        setDefinitionError: vi.fn(),
        clearDefinitionError: vi.fn(),
      },
    });
    let init: () => void = () => undefined;
    let initAsync: () => Promise<void> = async () => undefined;
    let destroy: () => void = () => undefined;
    const hooks = {
      init: { tap: (listener: () => void) => { init = listener; } },
      initAsync: { tapPromise: (listener: () => Promise<void>) => { initAsync = listener; } },
      destroy: { tap: (listener: () => void) => { destroy = listener; } },
    };

    plugin.apply({ hooks } as never);
    init();
    await initAsync();

    expect(list).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith({ name: 'Weather' });
    expect(registerWidget).toHaveBeenCalledWith(expect.objectContaining({
      id: 'Weather',
      dataType: 'widget',
      actor: { actorDefinitionName: 'Weather' },
      sandbox: { arrowjs: { 'main.ts': 'export default {}' } },
    }));

    invalidateCatalog();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenCalledOnce();
    expect(registerWidget).toHaveBeenCalledOnce();

    definitions = [{
      ...definitions[0]!,
      updated_at: '2026-07-20T00:01:00.000Z',
    }];
    invalidateCatalog();
    await vi.waitFor(() => expect(registerWidget).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenCalledTimes(2);

    definitions = [];
    invalidateCatalog();
    await vi.waitFor(() => expect(unregisterWidget).toHaveBeenCalledWith('Weather'));

    destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
