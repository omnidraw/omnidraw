import type { TWidgetActivation } from '@omnidraw/cangine/editor';
import { describe, expect, test, vi } from 'vitest';
import { createPreviewActions } from '../../src/canvas-extension/preview-actions';
import { fnCreatePreviewWidgetNode } from '../../src/canvas-extension/fn.canvas-widget';
import { publicCatalog } from '../widget-public-catalog.fixture';

const activation = (
  dropdownItemId: 'reload' | 'rebuild' | 'publish' | 'remove',
): TWidgetActivation => ({
  type: 'dropdown-item',
  widgetId: 'preview-1',
  itemId: 'preview-actions',
  dropdownItemId,
});

function createHarness(options: Readonly<{
  publication?: () => Promise<readonly [Error | undefined, object | undefined]>;
}> = {}) {
  const node = fnCreatePreviewWidgetNode({
    id: 'preview-1',
    parentId: null,
    orderKey: 'a',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 320 },
    title: 'Camera',
    instanceId: 'instance-1',
    widgetKey: 'camera',
    titleBarColor: { space: 'srgb', r: 1, g: 0.5, b: 0, a: 1 },
  });
  let currentNode: typeof node | null = node;
  let menuListener: ((state: never) => void) | null = null;
  const menu = {
    subscribe: vi.fn((listener: (state: never) => void) => {
      menuListener = listener;
      return vi.fn();
    }),
    open: vi.fn(() => true),
  };
  const owner = {
    reload: vi.fn(async () => undefined),
    rebuild: vi.fn(async () => undefined),
  };
  const buildAndPublish = vi.fn(options.publication ?? (async () => [
    undefined,
    { widgetKey: 'camera', generation: 2, catalogDigestSha256: 'b'.repeat(64) },
  ] as const));
  const transport = {
    api: {
      widget: {
        catalog: { get: vi.fn(async () => [undefined, publicCatalog()] as const) },
        publication: { buildAndPublish },
      },
    },
  };
  const notification = {
    showInfo: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
  };
  const remove = vi.fn(() => {
    currentNode = null;
  });
  const actions = createPreviewActions({
    transport: transport as never,
    menu: menu as never,
    notification,
    readNode: () => currentNode,
    readOwner: () => owner as never,
    remove,
  });
  return {
    actions,
    buildAndPublish,
    menu,
    menuListener: () => menuListener,
    notification,
    owner,
    remove,
    transport,
  };
}

describe('Preview action routing', () => {
  test('routes Reload and Rebuild as distinct owner operations', async () => {
    const harness = createHarness();

    await harness.actions.activate(activation('reload'));
    await harness.actions.activate(activation('rebuild'));

    expect(harness.owner.reload).toHaveBeenCalledOnce();
    expect(harness.owner.rebuild).toHaveBeenCalledOnce();
    harness.actions.destroy();
  });

  test('routes the same typed activation produced by keyboard menu selection', async () => {
    const harness = createHarness();

    await harness.actions.activate(activation('reload'));

    expect(harness.owner.reload).toHaveBeenCalledOnce();
    harness.actions.destroy();
  });

  test('publishes with both current digest fences and leaves the Preview open', async () => {
    const harness = createHarness();

    await harness.actions.activate(activation('publish'));

    expect(harness.buildAndPublish).toHaveBeenCalledWith({
      widgetKey: 'camera',
      expectedManifestDigestSha256: 'a'.repeat(64),
      expectedCatalogDigestSha256: 'a'.repeat(64),
    });
    expect(harness.remove).not.toHaveBeenCalled();
    expect(harness.notification.showInfo).toHaveBeenCalledOnce();
    expect(harness.notification.showSuccess).toHaveBeenCalledOnce();
    expect(harness.notification.showError).not.toHaveBeenCalled();
    harness.actions.destroy();
  });

  test('coalesces duplicate in-flight publication for one Preview', async () => {
    let finish: ((value: readonly [undefined, object]) => void) | undefined;
    const publication = () => new Promise<readonly [undefined, object]>((resolve) => {
      finish = resolve;
    });
    const harness = createHarness({ publication });

    const first = harness.actions.activate(activation('publish'));
    const second = harness.actions.activate(activation('publish'));
    await vi.waitFor(() => expect(harness.buildAndPublish).toHaveBeenCalledOnce());
    finish?.([undefined, {}]);
    await Promise.all([first, second]);

    expect(harness.transport.api.widget.catalog.get).toHaveBeenCalledOnce();
    expect(harness.notification.showSuccess).toHaveBeenCalledOnce();
    harness.actions.destroy();
  });

  test('reports stale publication fences without removing the Preview', async () => {
    const harness = createHarness({
      publication: async () => [new Error('Catalog digest is stale.'), undefined],
    });

    await harness.actions.activate(activation('publish'));

    expect(harness.notification.showError).toHaveBeenCalledWith(
      'Could not build and publish',
      'Catalog digest is stale.',
    );
    expect(harness.notification.showSuccess).not.toHaveBeenCalled();
    expect(harness.remove).not.toHaveBeenCalled();
    harness.actions.destroy();
  });

  test('uses the shared durable removal callback and ignores stale activations', async () => {
    const harness = createHarness();

    await harness.actions.activate(activation('remove'));
    await harness.actions.activate(activation('reload'));

    expect(harness.remove).toHaveBeenCalledOnce();
    expect(harness.owner.reload).not.toHaveBeenCalled();
    harness.actions.destroy();
  });

  test('enhances only the Preview menu presentation and cleans up its listener', () => {
    const harness = createHarness();
    const listener = harness.menuListener();
    expect(listener).not.toBeNull();

    listener?.({
      open: true,
      id: 'widget-dropdown:preview-1:preview-actions',
      anchor: { x: 10, y: 20 },
      data: { widgetId: 'preview-1', headerItemId: 'preview-actions' },
      highlightedItemId: 'reload',
      items: [
        { id: 'reload', text: 'Reload' },
        { id: 'rebuild', text: 'Rebuild' },
        { id: 'publish', text: 'Publish' },
        { id: 'remove', text: 'Remove' },
      ],
    } as never);

    expect(harness.menu.open).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'remove',
          destructive: true,
          separatorBefore: true,
        }),
      ]),
    }));
    harness.actions.destroy();
    expect(harness.menu.subscribe.mock.results[0]?.value).toHaveBeenCalledOnce();
  });

  test('ignores action activations after cleanup', async () => {
    const harness = createHarness();
    harness.actions.destroy();

    await harness.actions.activate(activation('reload'));

    expect(harness.owner.reload).not.toHaveBeenCalled();
  });
});
